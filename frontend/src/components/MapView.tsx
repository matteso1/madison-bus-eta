import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import { Map, Marker } from '@vis.gl/react-maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import axios from 'axios';

const INITIAL_VIEW_STATE = {
    longitude: -89.384,
    latitude: 43.073,
    zoom: 12,
    pitch: 0,
    bearing: 0
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const ROUTE_COLORS: Record<string, [number, number, number]> = {
    'A': [238, 51, 37],
    'B': [128, 188, 0],
    'C': [51, 51, 102],
    'D': [51, 51, 102],
    'E': [34, 114, 181],
    'F': [34, 114, 181],
    'G': [34, 114, 181],
    'H': [34, 114, 181],
    'J': [34, 114, 181],
    'L': [194, 163, 255],
    'O': [194, 163, 255],
    'P': [34, 114, 181],
    'R': [194, 163, 255],
    'S': [194, 163, 255],
    'W': [34, 114, 181],
    '28': [34, 114, 181],
    '38': [34, 114, 181],
    '55': [194, 163, 255],
    '80': [51, 51, 102],
    '81': [51, 51, 102],
    '82': [51, 51, 102],
    '84': [51, 51, 102],
};

const predictionCache: Record<string, { prediction: any; timestamp: number }> = {};
const CACHE_TTL = 60000;

export interface StopClickEvent {
    stpid: string;
    stpnm: string;
    route: string;
}

export interface VehicleData {
    position: [number, number];
    route: string;
    vid: string;
    des: string;
    dly: boolean;
    color: [number, number, number];
}

export interface TrackedBus {
    vid: string;
    route: string;
    stopId: string;
    stopName: string;
    stopPosition?: [number, number];
}

export interface TripPlan {
    routeId: string;
    originStop: { stpid: string; stpnm: string; lat: number; lon: number };
    destStop: { stpid: string; stpnm: string; lat: number; lon: number };
    finalDestination: { lat: number; lon: number; name: string };
    walkToMin: number;
    walkFromMin: number;
}

interface MapViewProps {
    selectedRoute: string;
    userLocation: [number, number] | null;
    trackedBus: TrackedBus | null;
    activeTripPlan: TripPlan | null;
    onRoutesLoaded: (routes: Array<{ rt: string; rtnm: string }>) => void;
    onLiveDataUpdated: (vehicles: VehicleData[], delayedCount: number) => void;
    onStopClick: (stop: StopClickEvent) => void;
    onMapClick?: (lngLat: [number, number]) => void;
}

const dashExtension = new PathStyleExtension({ dash: true });

export default function MapView({
    selectedRoute, userLocation, trackedBus, activeTripPlan,
    onRoutesLoaded, onLiveDataUpdated, onStopClick, onMapClick
}: MapViewProps) {
    const [liveData, setLiveData] = useState<VehicleData[]>([]);
    const [patternsData, setPatternsData] = useState<any[]>([]);
    const [stopsData, setStopsData] = useState<any[]>([]);
    const [hoveredVehicle, setHoveredVehicle] = useState<string | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);

    const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

    const getMLPrediction = useCallback(async (vehicle: VehicleData, apiPrediction = 10) => {
        const cacheKey = `${vehicle.vid}-${vehicle.route}`;
        const cached = predictionCache[cacheKey];
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.prediction;
        try {
            const res = await axios.post(`${API_BASE}/api/predict-arrival-v2`, {
                route: vehicle.route,
                stop_id: 'live_tracking',
                vehicle_id: vehicle.vid,
                api_prediction: apiPrediction
            });
            predictionCache[cacheKey] = { prediction: res.data, timestamp: Date.now() };
            return res.data;
        } catch { return null; }
    }, [API_BASE]);

    useEffect(() => {
        if (!hoveredVehicle) return;
        const vehicle = liveData.find(v => v.vid === hoveredVehicle);
        if (vehicle) getMLPrediction(vehicle);
    }, [hoveredVehicle, liveData, getMLPrediction]);

    // Load stops for selected route
    useEffect(() => {
        if (selectedRoute === 'ALL') { setStopsData([]); return; }
        axios.get(`${API_BASE}/stops?rt=${selectedRoute}`).then(res => {
            const stops = res.data?.['bustime-response']?.stops || [];
            setStopsData(stops.map((s: any) => ({
                position: [parseFloat(s.lon), parseFloat(s.lat)],
                stpid: s.stpid,
                stpnm: s.stpnm,
                route: selectedRoute
            })));
        }).catch(() => setStopsData([]));
    }, [selectedRoute, API_BASE]);

    // Load routes + patterns ONCE (no routeReliability dependency = no double-render)
    useEffect(() => {
        const load = async () => {
            try {
                const routesRes = await axios.get(`${API_BASE}/routes`);
                const routeList = routesRes.data['bustime-response']?.routes || [];
                onRoutesLoaded(routeList);

                const patternResponses = await Promise.all(
                    routeList.map((r: any) =>
                        axios.get(`${API_BASE}/patterns?rt=${r.rt}`).catch(() => null)
                    )
                );

                const allPatterns: any[] = [];
                patternResponses.forEach((res, i) => {
                    if (!res?.data?.['bustime-response']?.ptr) return;
                    const rt = routeList[i].rt;
                    const color = ROUTE_COLORS[rt] || [100, 100, 100];

                    const ptrs = res.data['bustime-response'].ptr;
                    const patterns = Array.isArray(ptrs) ? ptrs : [ptrs];
                    patterns.forEach((p: any) => {
                        if (!p?.pt?.length) return;
                        const path: [number, number][] = [];
                        const stops: { idx: number; stpid: string; stpnm: string; pos: [number, number] }[] = [];
                        p.pt.forEach((pt: any, idx: number) => {
                            const pos: [number, number] = [parseFloat(pt.lon), parseFloat(pt.lat)];
                            path.push(pos);
                            if (pt.typ === 'S' && pt.stpid) {
                                stops.push({ idx, stpid: String(pt.stpid), stpnm: pt.stpnm || '', pos });
                            }
                        });
                        allPatterns.push({ path, stops, color, route: rt, pid: p.pid, dir: p.rtdir });
                    });
                });
                setPatternsData(allPatterns);
            } catch (e) {
                console.error('Failed to load routes/patterns:', e);
            }
        };
        load();
    }, [API_BASE, onRoutesLoaded]);

    // Live vehicle polling — faster when tracking
    useEffect(() => {
        const interval = trackedBus ? 8000 : 15000;
        const fetchLive = async () => {
            try {
                const res = await axios.get(`${API_BASE}/vehicles`);
                const vehicles = res.data?.['bustime-response']?.vehicle;
                if (!vehicles) return;
                const arr = Array.isArray(vehicles) ? vehicles : [vehicles];
                const mapped: VehicleData[] = arr.map((v: any) => ({
                    position: [parseFloat(v.lon), parseFloat(v.lat)],
                    route: v.rt,
                    vid: v.vid,
                    des: v.des,
                    dly: v.dly === true || v.dly === 'true',
                    color: ROUTE_COLORS[v.rt] || [150, 150, 150],
                }));
                setLiveData(mapped);
                onLiveDataUpdated(mapped, mapped.filter(v => v.dly).length);
            } catch (e) {
                console.error('Live fetch error:', e);
            }
        };
        fetchLive();
        const timer = setInterval(fetchLive, interval);
        return () => clearInterval(timer);
    }, [API_BASE, onLiveDataUpdated, trackedBus]);

    // Auto-pan to tracked bus
    useEffect(() => {
        if (!trackedBus || !mapRef.current) return;
        const bus = liveData.find(v => v.vid === trackedBus.vid);
        if (!bus) return;
        const bounds = new maplibregl.LngLatBounds();
        bounds.extend(bus.position as [number, number]);
        if (trackedBus.stopPosition) bounds.extend(trackedBus.stopPosition);
        if (userLocation) bounds.extend(userLocation);
        mapRef.current.fitBounds(bounds, {
            padding: { top: 80, bottom: 120, left: 60, right: 400 },
            maxZoom: 16, duration: 1000,
        });
    }, [trackedBus, liveData, userLocation]);

    // Auto-pan to trip route when selected — frame the full journey including walking
    useEffect(() => {
        if (!activeTripPlan || !mapRef.current) return;
        const bounds = new maplibregl.LngLatBounds();
        if (userLocation) bounds.extend(userLocation);
        bounds.extend([activeTripPlan.originStop.lon, activeTripPlan.originStop.lat]);
        bounds.extend([activeTripPlan.destStop.lon, activeTripPlan.destStop.lat]);
        bounds.extend([activeTripPlan.finalDestination.lon, activeTripPlan.finalDestination.lat]);
        mapRef.current.fitBounds(bounds, {
            padding: { top: 100, bottom: 100, left: 80, right: 420 },
            maxZoom: 16, duration: 1000,
        });
    }, [activeTripPlan, userLocation]);

    // ── Derived data ──

    const filteredPatterns = useMemo(() => {
        if (trackedBus) return patternsData.filter(p => p.route === trackedBus.route);
        if (activeTripPlan) return patternsData.filter(p => p.route === activeTripPlan.routeId);
        return selectedRoute === 'ALL' ? patternsData : patternsData.filter(p => p.route === selectedRoute);
    }, [patternsData, selectedRoute, trackedBus, activeTripPlan]);

    const filteredLive = useMemo(() => {
        if (trackedBus) return liveData.filter(v => v.route === trackedBus.route);
        if (selectedRoute === 'ALL') return [];
        return liveData.filter(v => v.route === selectedRoute);
    }, [liveData, selectedRoute, trackedBus]);

    const trackedVehicle = useMemo(() => {
        if (!trackedBus) return null;
        return liveData.find(v => v.vid === trackedBus.vid) || null;
    }, [liveData, trackedBus]);

    // Delayed buses for all-routes view (clean red dots instead of heatmap)
    const delayedBuses = useMemo(() => {
        if (selectedRoute !== 'ALL') return [];
        return liveData.filter(v => v.dly);
    }, [liveData, selectedRoute]);

    // Extract bus route segment by matching stop IDs in pattern data
    const tripData = useMemo(() => {
        if (!activeTripPlan) return null;
        const routePatterns = patternsData.filter(p => p.route === activeTripPlan.routeId);
        const oId = activeTripPlan.originStop.stpid;
        const dId = activeTripPlan.destStop.stpid;

        let bestSegment: [number, number][] | null = null;
        let bestFullPath: [number, number][] | null = null;
        let segmentStops: { stpid: string; stpnm: string; pos: [number, number] }[] = [];

        for (const pattern of routePatterns) {
            const path = pattern.path as [number, number][];
            const stops = pattern.stops || [];
            const oStop = stops.find((s: any) => s.stpid === oId);
            const dStop = stops.find((s: any) => s.stpid === dId);

            if (oStop && dStop && oStop.idx !== dStop.idx) {
                const lo = Math.min(oStop.idx, dStop.idx);
                const hi = Math.max(oStop.idx, dStop.idx);
                bestSegment = oStop.idx < dStop.idx
                    ? path.slice(lo, hi + 1)
                    : path.slice(lo, hi + 1).reverse();
                bestFullPath = path;
                // Only include stops BETWEEN origin and dest on this segment
                segmentStops = stops
                    .filter((s: any) => s.idx >= lo && s.idx <= hi && s.stpid !== oId && s.stpid !== dId)
                    .map((s: any) => ({ stpid: s.stpid, stpnm: s.stpnm, pos: s.pos }));
                break;
            }
            if (!bestFullPath) {
                bestFullPath = path;
            }
        }

        // Fallback: geographic proximity matching
        if (!bestSegment && routePatterns.length > 0) {
            const oPos: [number, number] = [activeTripPlan.originStop.lon, activeTripPlan.originStop.lat];
            const dPos: [number, number] = [activeTripPlan.destStop.lon, activeTripPlan.destStop.lat];
            for (const pattern of routePatterns) {
                const path = pattern.path as [number, number][];
                let oi = 0, di = 0, od = Infinity, dd = Infinity;
                for (let i = 0; i < path.length; i++) {
                    const d1 = Math.hypot(path[i][0] - oPos[0], path[i][1] - oPos[1]);
                    const d2 = Math.hypot(path[i][0] - dPos[0], path[i][1] - dPos[1]);
                    if (d1 < od) { od = d1; oi = i; }
                    if (d2 < dd) { dd = d2; di = i; }
                }
                if (oi !== di) {
                    bestSegment = oi < di ? path.slice(oi, di + 1) : path.slice(di, oi + 1).reverse();
                    bestFullPath = path;
                    const lo = Math.min(oi, di), hi = Math.max(oi, di);
                    segmentStops = (pattern.stops || [])
                        .filter((s: any) => s.idx >= lo && s.idx <= hi && s.stpid !== oId && s.stpid !== dId)
                        .map((s: any) => ({ stpid: s.stpid, stpnm: s.stpnm, pos: s.pos }));
                    break;
                }
            }
        }

        if (!bestSegment && bestFullPath) {
            bestSegment = bestFullPath;
        }

        return { segment: bestSegment, fullPath: bestFullPath, segmentStops };
    }, [activeTripPlan, patternsData]);

    // Walking routes via OSRM (actual street-following paths)
    const [tripWalkPaths, setTripWalkPaths] = useState<{ path: [number, number][]; label: string }[]>([]);

    useEffect(() => {
        if (!activeTripPlan || !userLocation) { setTripWalkPaths([]); return; }

        const fetchWalkRoute = async (from: [number, number], to: [number, number]): Promise<[number, number][]> => {
            try {
                const url = `https://router.project-osrm.org/route/v1/foot/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`;
                const res = await axios.get(url);
                const coords = res.data?.routes?.[0]?.geometry?.coordinates;
                if (coords?.length >= 2) return coords as [number, number][];
            } catch { /* fall through */ }
            return [from, to]; // straight line fallback
        };

        const load = async () => {
            const paths: { path: [number, number][]; label: string }[] = [];
            const originPos: [number, number] = [activeTripPlan.originStop.lon, activeTripPlan.originStop.lat];
            const walkTo = await fetchWalkRoute(userLocation, originPos);
            paths.push({ path: walkTo, label: 'walk-to' });

            const fd = activeTripPlan.finalDestination;
            const destStopPos: [number, number] = [activeTripPlan.destStop.lon, activeTripPlan.destStop.lat];
            const finalDestPos: [number, number] = [fd.lon, fd.lat];
            const delta = Math.abs(destStopPos[0] - finalDestPos[0]) + Math.abs(destStopPos[1] - finalDestPos[1]);
            if (delta > 0.0001) {
                const walkFrom = await fetchWalkRoute(destStopPos, finalDestPos);
                paths.push({ path: walkFrom, label: 'walk-from' });
            }
            setTripWalkPaths(paths);
        };
        load();
    }, [activeTripPlan, userLocation]);

    // Tracking line path
    const trackingPath = useMemo(() => {
        if (!trackedVehicle || !trackedBus?.stopPosition) return null;
        return [{ path: [trackedVehicle.position, trackedBus.stopPosition] }];
    }, [trackedVehicle, trackedBus]);

    // ── Layers (order = render order: first = bottom, last = top) ──

    const layers = useMemo(() => {
        const L: any[] = [];

        // 1) Background route paths — hidden entirely during trip mode for clean Google Maps look
        if (filteredPatterns.length > 0 && !activeTripPlan) {
            L.push(new PathLayer({
                id: 'route-paths',
                data: filteredPatterns,
                getPath: (d: any) => d.path,
                getColor: (d: any) => [...d.color, trackedBus ? 50 : 160],
                getWidth: 3,
                widthMinPixels: 1.5,
                capRounded: true,
                jointRounded: true,
            }));
        }

        // 2) Delayed bus indicators — only on all-routes view, hidden during trip/tracking
        if (delayedBuses.length > 0 && !activeTripPlan && !trackedBus) {
            L.push(new ScatterplotLayer({
                id: 'delayed-indicators',
                data: delayedBuses,
                getPosition: (d: any) => d.position,
                getFillColor: [239, 68, 68],
                getLineColor: [255, 255, 255],
                getRadius: 60,
                radiusMinPixels: 7,
                radiusMaxPixels: 16,
                stroked: true,
                lineWidthMinPixels: 2,
                opacity: 0.9,
            }));
        }

        // 3) Trip: full route pattern dimmed (context)
        if (tripData?.fullPath) {
            L.push(new PathLayer({
                id: 'trip-route-full',
                data: [{ path: tripData.fullPath }],
                getPath: (d: any) => d.path,
                getColor: [66, 133, 244, 60],
                getWidth: 4,
                widthMinPixels: 2,
                capRounded: true,
                jointRounded: true,
            }));
        }

        // 4) Trip: highlighted segment between origin and dest stops
        if (tripData?.segment) {
            L.push(new PathLayer({
                id: 'trip-segment',
                data: [{ path: tripData.segment }],
                getPath: (d: any) => d.path,
                getColor: [66, 133, 244, 255],
                getWidth: 8,
                widthMinPixels: 5,
                capRounded: true,
                jointRounded: true,
            }));
        }

        // 5) Trip walking lines — thin grey dotted
        if (tripWalkPaths.length > 0) {
            L.push(new PathLayer({
                id: 'trip-walk-paths',
                data: tripWalkPaths,
                getPath: (d: any) => d.path,
                getColor: [160, 160, 170, 200],
                getWidth: 4,
                widthMinPixels: 3,
                capRounded: true,
                getDashArray: [2, 3],
                dashJustified: true,
                extensions: [new PathStyleExtension({ dash: true })],
            }));
        }

        // 5) Tracking dashed line (bus → stop)
        if (trackingPath) {
            L.push(new PathLayer({
                id: 'tracking-path',
                data: trackingPath,
                getPath: (d: any) => d.path,
                getColor: [0, 212, 255, 100],
                getWidth: 3,
                widthMinPixels: 2,
                capRounded: true,
                getDashArray: [8, 6],
                dashJustified: true,
                extensions: [dashExtension],
            }));
        }

        // ── Everything below here renders ON TOP of all lines ──

        // 6) Stop dots — normal route view only (not during trip)
        if (stopsData.length > 0 && !trackedBus && !activeTripPlan) {
            L.push(new ScatterplotLayer({
                id: 'stops',
                data: stopsData,
                pickable: true,
                opacity: 0.9,
                stroked: true,
                filled: true,
                radiusMinPixels: 5,
                radiusMaxPixels: 12,
                lineWidthMinPixels: 1.5,
                getPosition: (d: any) => d.position,
                getRadius: 25,
                getFillColor: [15, 15, 26],
                getLineColor: [0, 212, 255],
                onClick: ({ object }) => {
                    if (object) onStopClick({ stpid: object.stpid, stpnm: object.stpnm, route: object.route });
                }
            }));
        }

        // 6b) Trip: only stops along the segment between origin and dest
        if (activeTripPlan && tripData?.segmentStops?.length) {
            L.push(new ScatterplotLayer({
                id: 'trip-segment-stops',
                data: tripData.segmentStops,
                getPosition: (d: any) => d.pos,
                getFillColor: [15, 15, 26],
                getLineColor: [66, 133, 244],
                getRadius: 25,
                radiusMinPixels: 4,
                radiusMaxPixels: 8,
                stroked: true,
                lineWidthMinPixels: 1.5,
                opacity: 0.85,
            }));
        }

        // 7) Trip origin/dest markers — compact with white border
        if (activeTripPlan) {
            L.push(new ScatterplotLayer({
                id: 'trip-stops',
                data: [
                    { position: [activeTripPlan.originStop.lon, activeTripPlan.originStop.lat], label: 'origin' },
                    { position: [activeTripPlan.destStop.lon, activeTripPlan.destStop.lat], label: 'dest' },
                ],
                getPosition: (d: any) => d.position,
                getFillColor: (d: any) => d.label === 'origin' ? [66, 133, 244] : [234, 67, 53],
                getLineColor: [255, 255, 255],
                getRadius: 60,
                radiusMinPixels: 8,
                radiusMaxPixels: 14,
                stroked: true,
                lineWidthMinPixels: 2.5,
                opacity: 1,
            }));
        }

        // 8) Bus dots — hidden during trip mode for clean map
        const nonTracked = trackedBus
            ? filteredLive.filter(v => v.vid !== trackedBus.vid)
            : filteredLive;

        if (nonTracked.length > 0 && !activeTripPlan) {
            L.push(new ScatterplotLayer({
                id: 'live-buses',
                data: nonTracked,
                pickable: true,
                opacity: trackedBus ? 0.35 : 1,
                stroked: true,
                filled: true,
                radiusMinPixels: trackedBus ? 5 : 8,
                radiusMaxPixels: trackedBus ? 10 : 20,
                lineWidthMinPixels: 2,
                getPosition: (d: any) => d.position,
                getRadius: 50,
                getFillColor: (d: any) => d.dly ? [239, 68, 68] : d.color,
                getLineColor: [255, 255, 255],
                onHover: ({ object }) => setHoveredVehicle(object ? object.vid : null),
            }));
        }

        return L;
    }, [filteredPatterns, filteredLive, stopsData, delayedBuses, onStopClick,
        trackedBus, trackingPath, activeTripPlan, tripData, tripWalkPaths]);

    return (
        <DeckGL
            initialViewState={INITIAL_VIEW_STATE}
            controller={true}
            layers={layers}
            style={{ width: '100%', height: '100%' }}
            onClick={({ coordinate }) => {
                if (onMapClick && coordinate) {
                    onMapClick([coordinate[0], coordinate[1]]);
                }
            }}
            getTooltip={({ object }) => {
                if (!object) return null;

                if (object.stpid) {
                    return {
                        html: `<div style="background:rgba(8,8,16,0.95);color:#e2e8f0;padding:10px 14px;border-radius:8px;font-family:Inter,sans-serif;border:1px solid #1e1e2e;">
                            <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${object.stpnm}</div>
                            <div style="font-size:10px;color:#64748b;font-family:JetBrains Mono,monospace;">Stop #${object.stpid}</div>
                            <div style="font-size:10px;color:#00d4ff;margin-top:6px;">Click for ML predictions</div>
                        </div>`,
                        style: { backgroundColor: 'transparent' }
                    };
                }

                if (object.vid) {
                    const cacheKey = `${object.vid}-${object.route}`;
                    const mlPrediction = predictionCache[cacheKey]?.prediction;

                    let etaHtml = '';
                    if (mlPrediction?.model_available) {
                        const lo = Math.round(mlPrediction.eta_low_min);
                        const hi = Math.round(mlPrediction.eta_high_min);
                        const med = Math.round(mlPrediction.eta_median_min);
                        etaHtml = `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #1e1e2e;">
                            <div style="font-size:9px;color:#64748b;letter-spacing:0.08em;margin-bottom:4px;">ML-CORRECTED ETA</div>
                            <div style="font-size:18px;color:#00d4ff;font-weight:700;font-family:JetBrains Mono,monospace;">${lo}–${hi} min</div>
                            <div style="font-size:10px;color:#64748b;margin-top:2px;">median ${med} min</div>
                        </div>`;
                    }

                    return {
                        html: `<div style="background:rgba(8,8,16,0.95);color:#e2e8f0;padding:12px 16px;border-radius:8px;font-family:Inter,sans-serif;border:1px solid #1e1e2e;min-width:200px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                                <span style="font-weight:600;font-size:14px;">Route ${object.route}</span>
                                <span style="font-size:9px;padding:2px 6px;border-radius:3px;background:${object.dly ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)'};color:${object.dly ? '#ef4444' : '#10b981'};font-family:JetBrains Mono,monospace;">${object.dly ? 'DELAYED' : 'ON TIME'}</span>
                            </div>
                            <div style="font-size:11px;color:#64748b;">${object.des || 'Unknown destination'}</div>
                            <div style="font-size:10px;color:#374151;font-family:JetBrains Mono,monospace;margin-top:2px;">VID ${object.vid}</div>
                            ${etaHtml}
                        </div>`,
                        style: { backgroundColor: 'transparent' }
                    };
                }

                return null;
            }}
        >
            <Map
                reuseMaps
                mapLib={maplibregl}
                mapStyle={MAP_STYLE}
                onLoad={(e) => { mapRef.current = e.target; }}
            >
                {/* Pulsing user location */}
                {userLocation && (
                    <Marker longitude={userLocation[0]} latitude={userLocation[1]} anchor="center">
                        <div className="user-loc-marker">
                            <div className="pulse-ring" />
                            <div className="pulse-ring-2" />
                            <div className="dot" />
                        </div>
                    </Marker>
                )}

                {/* Tracked bus highlight */}
                {trackedVehicle && (
                    <Marker longitude={trackedVehicle.position[0]} latitude={trackedVehicle.position[1]} anchor="center">
                        <div className="tracked-bus-marker">
                            <div className="bus-ring" />
                            <div className="bus-dot" />
                        </div>
                    </Marker>
                )}

                {/* Tracked bus destination stop pin */}
                {trackedBus?.stopPosition && (
                    <Marker longitude={trackedBus.stopPosition[0]} latitude={trackedBus.stopPosition[1]} anchor="bottom">
                        <div className="dest-pin-marker">
                            <div className="pin"><div className="pin-inner" /></div>
                            <div className="pin-shadow" />
                        </div>
                    </Marker>
                )}

                {/* Trip origin stop label */}
                {activeTripPlan && (
                    <Marker longitude={activeTripPlan.originStop.lon} latitude={activeTripPlan.originStop.lat} anchor="bottom" offset={[0, -12]}>
                        <div className="trip-label trip-label--origin">
                            <span className="trip-label__route">{activeTripPlan.routeId}</span>
                            <span className="trip-label__name">{activeTripPlan.originStop.stpnm}</span>
                        </div>
                    </Marker>
                )}

                {/* Trip dest stop label */}
                {activeTripPlan && (
                    <Marker longitude={activeTripPlan.destStop.lon} latitude={activeTripPlan.destStop.lat} anchor="bottom" offset={[0, -12]}>
                        <div className="trip-label trip-label--dest">
                            <span className="trip-label__name">{activeTripPlan.destStop.stpnm}</span>
                        </div>
                    </Marker>
                )}

                {/* Trip final destination pin */}
                {activeTripPlan && (
                    <Marker longitude={activeTripPlan.finalDestination.lon} latitude={activeTripPlan.finalDestination.lat} anchor="bottom">
                        <div className="dest-pin-marker">
                            <div className="pin"><div className="pin-inner" /></div>
                            <div className="pin-shadow" />
                        </div>
                    </Marker>
                )}
            </Map>
        </DeckGL>
    );
}
