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
                        allPatterns.push({
                            path: p.pt.map((pt: any) => [parseFloat(pt.lon), parseFloat(pt.lat)]),
                            color,
                            route: rt
                        });
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

    // Extract the bus route segment between origin and dest stops
    const tripRouteSegment = useMemo(() => {
        if (!activeTripPlan) return null;
        const routePatterns = patternsData.filter(p => p.route === activeTripPlan.routeId);
        const oPos: [number, number] = [activeTripPlan.originStop.lon, activeTripPlan.originStop.lat];
        const dPos: [number, number] = [activeTripPlan.destStop.lon, activeTripPlan.destStop.lat];

        const MATCH_THRESHOLD = 0.004; // ~400m in degrees
        const directDist = Math.hypot(oPos[0] - dPos[0], oPos[1] - dPos[1]);

        let bestSegment: [number, number][] | null = null;
        let bestSegLen = 0;

        for (const pattern of routePatterns) {
            const path = pattern.path as [number, number][];

            // Find ALL candidate indices near origin and near destination
            const oCandidates: { idx: number; dist: number }[] = [];
            const dCandidates: { idx: number; dist: number }[] = [];

            for (let i = 0; i < path.length; i++) {
                const d1 = Math.hypot(path[i][0] - oPos[0], path[i][1] - oPos[1]);
                const d2 = Math.hypot(path[i][0] - dPos[0], path[i][1] - dPos[1]);
                if (d1 < MATCH_THRESHOLD) oCandidates.push({ idx: i, dist: d1 });
                if (d2 < MATCH_THRESHOLD) dCandidates.push({ idx: i, dist: d2 });
            }

            // Try all O→D combinations, pick the one that produces a
            // reasonable-length segment (should be >= direct distance)
            for (const o of oCandidates) {
                for (const d of dCandidates) {
                    if (o.idx === d.idx) continue;
                    const segment = o.idx < d.idx
                        ? path.slice(o.idx, d.idx + 1)
                        : path.slice(d.idx, o.idx + 1).reverse();

                    // Compute geographic length of the segment
                    let segLen = 0;
                    for (let i = 1; i < segment.length; i++) {
                        segLen += Math.hypot(segment[i][0] - segment[i - 1][0], segment[i][1] - segment[i - 1][1]);
                    }

                    // Prefer segments that are at least as long as the direct distance
                    // (a real bus route between two stops is always >= straight-line)
                    // Among valid segments, pick the shortest one (most direct path)
                    const isReasonable = segLen >= directDist * 0.8;
                    if (isReasonable && segment.length >= 2) {
                        if (!bestSegment || segLen < bestSegLen) {
                            bestSegLen = segLen;
                            bestSegment = segment;
                        }
                    }
                }
            }
        }

        // Fallback: if candidate matching failed, use single-closest-point approach
        if (!bestSegment) {
            for (const pattern of routePatterns) {
                const path = pattern.path as [number, number][];
                let oIdx = 0, dIdx = 0;
                let oDist = Infinity, dDist = Infinity;
                for (let i = 0; i < path.length; i++) {
                    const d1 = Math.hypot(path[i][0] - oPos[0], path[i][1] - oPos[1]);
                    const d2 = Math.hypot(path[i][0] - dPos[0], path[i][1] - dPos[1]);
                    if (d1 < oDist) { oDist = d1; oIdx = i; }
                    if (d2 < dDist) { dDist = d2; dIdx = i; }
                }
                if (oIdx !== dIdx) {
                    bestSegment = oIdx < dIdx
                        ? path.slice(oIdx, dIdx + 1)
                        : path.slice(dIdx, oIdx + 1).reverse();
                    break;
                }
            }
        }

        // Ultimate fallback: show the full route pattern (always visible)
        if (!bestSegment || bestSegment.length < 2) {
            if (routePatterns.length > 0) {
                bestSegment = routePatterns[0].path as [number, number][];
            } else {
                bestSegment = [oPos, dPos];
            }
        }

        console.log('[TripSegment]', {
            route: activeTripPlan.routeId,
            patterns: routePatterns.length,
            oPos, dPos,
            segmentPoints: bestSegment.length,
            segmentLen: bestSegLen.toFixed(4),
        });

        return bestSegment;
    }, [activeTripPlan, patternsData]);

    // Walking paths for trip
    const tripWalkPaths = useMemo(() => {
        if (!activeTripPlan || !userLocation) return [];
        const paths: { path: [number, number][] }[] = [];

        // Walk from user location to origin bus stop
        const originPos: [number, number] = [activeTripPlan.originStop.lon, activeTripPlan.originStop.lat];
        paths.push({ path: [userLocation, originPos] });

        // Walk from destination bus stop to final destination (if different)
        const fd = activeTripPlan.finalDestination;
        const destStopPos: [number, number] = [activeTripPlan.destStop.lon, activeTripPlan.destStop.lat];
        const finalDestPos: [number, number] = [fd.lon, fd.lat];
        const destDelta = Math.abs(destStopPos[0] - finalDestPos[0]) + Math.abs(destStopPos[1] - finalDestPos[1]);
        if (destDelta > 0.0001) {
            paths.push({ path: [destStopPos, finalDestPos] });
        }

        console.log('[TripWalk]', {
            userLoc: userLocation,
            originStop: originPos,
            destStop: destStopPos,
            finalDest: finalDestPos,
            pathCount: paths.length,
        });

        return paths;
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

        // 3) Trip bus route segment — thick Google Maps blue
        if (tripRouteSegment) {
            L.push(new PathLayer({
                id: 'trip-segment',
                data: [{ path: tripRouteSegment }],
                getPath: (d: any) => d.path,
                getColor: [66, 133, 244, 255],
                getWidth: 10,
                widthMinPixels: 7,
                capRounded: true,
                jointRounded: true,
            }));
        }

        // 4) Trip walking lines — solid grey, thinner, renders ON TOP of bus segment
        if (tripWalkPaths.length > 0) {
            L.push(new PathLayer({
                id: 'trip-walk-paths',
                data: tripWalkPaths,
                getPath: (d: any) => d.path,
                getColor: [180, 180, 180, 230],
                getWidth: 5,
                widthMinPixels: 4,
                capRounded: true,
                jointRounded: true,
            }));
            // Dotted overlay to create walking effect
            L.push(new ScatterplotLayer({
                id: 'trip-walk-dots',
                data: tripWalkPaths.flatMap(wp => {
                    const pts: { position: [number, number] }[] = [];
                    const [a, b] = wp.path;
                    const dx = b[0] - a[0], dy = b[1] - a[1];
                    const dist = Math.hypot(dx, dy);
                    const step = 0.001; // ~100m spacing between dots
                    const count = Math.max(2, Math.floor(dist / step));
                    for (let i = 0; i <= count; i++) {
                        const t = i / count;
                        pts.push({ position: [a[0] + dx * t, a[1] + dy * t] });
                    }
                    return pts;
                }),
                getPosition: (d: any) => d.position,
                getFillColor: [255, 255, 255, 255],
                getRadius: 15,
                radiusMinPixels: 3,
                radiusMaxPixels: 5,
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

        // 6) Stop dots — hidden during trip mode and tracking for clean map
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
                getRadius: 30,
                getFillColor: [15, 15, 26],
                getLineColor: [0, 212, 255],
                onClick: ({ object }) => {
                    if (object) onStopClick({ stpid: object.stpid, stpnm: object.stpnm, route: object.route });
                }
            }));
        }

        // 7) Trip origin/dest stop markers — large Google Maps style
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
                getRadius: 100,
                radiusMinPixels: 14,
                radiusMaxPixels: 22,
                stroked: true,
                lineWidthMinPixels: 3,
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
        trackedBus, trackingPath, activeTripPlan, tripRouteSegment, tripWalkPaths]);

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
