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

    // Auto-pan to trip route when selected
    useEffect(() => {
        if (!activeTripPlan || !mapRef.current) return;
        const bounds = new maplibregl.LngLatBounds();
        if (userLocation) bounds.extend(userLocation);
        bounds.extend([activeTripPlan.originStop.lon, activeTripPlan.originStop.lat]);
        bounds.extend([activeTripPlan.destStop.lon, activeTripPlan.destStop.lat]);
        bounds.extend([activeTripPlan.finalDestination.lon, activeTripPlan.finalDestination.lat]);
        mapRef.current.fitBounds(bounds, {
            padding: { top: 80, bottom: 80, left: 60, right: 400 },
            maxZoom: 15, duration: 1000,
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

        let bestSegment: [number, number][] | null = null;
        let bestScore = Infinity;

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

            // Forward direction: origin appears before dest in the pattern
            if (oIdx < dIdx) {
                const score = oDist + dDist;
                if (score < bestScore) {
                    bestScore = score;
                    bestSegment = path.slice(oIdx, dIdx + 1);
                }
            }
            // Reverse direction: origin appears after dest, so reverse the slice
            if (dIdx < oIdx) {
                const score = oDist + dDist;
                if (score < bestScore) {
                    bestScore = score;
                    bestSegment = path.slice(dIdx, oIdx + 1).reverse();
                }
            }
        }

        // Fallback: straight line between origin and dest stops
        if (!bestSegment) {
            bestSegment = [oPos, dPos];
        }

        return bestSegment;
    }, [activeTripPlan, patternsData]);

    // Walking dashed paths for trip
    const tripWalkPaths = useMemo(() => {
        if (!activeTripPlan || !userLocation) return [];
        const paths: { path: [number, number][] }[] = [];

        paths.push({
            path: [userLocation, [activeTripPlan.originStop.lon, activeTripPlan.originStop.lat]],
        });

        const fd = activeTripPlan.finalDestination;
        const dsPos: [number, number] = [activeTripPlan.destStop.lon, activeTripPlan.destStop.lat];
        const fdPos: [number, number] = [fd.lon, fd.lat];
        if (Math.abs(dsPos[0] - fdPos[0]) > 0.0001 || Math.abs(dsPos[1] - fdPos[1]) > 0.0001) {
            paths.push({ path: [dsPos, fdPos] });
        }

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

        // 3) Trip bus route segment — highlighted bright cyan
        if (tripRouteSegment) {
            L.push(new PathLayer({
                id: 'trip-segment',
                data: [{ path: tripRouteSegment }],
                getPath: (d: any) => d.path,
                getColor: [0, 212, 255, 255],
                getWidth: 7,
                widthMinPixels: 5,
                capRounded: true,
                jointRounded: true,
            }));
        }

        // 4) Trip walking dashed lines — bright white
        if (tripWalkPaths.length > 0) {
            L.push(new PathLayer({
                id: 'trip-walk-paths',
                data: tripWalkPaths,
                getPath: (d: any) => d.path,
                getColor: [255, 255, 255, 200],
                getWidth: 5,
                widthMinPixels: 4,
                capRounded: true,
                getDashArray: [8, 6],
                dashJustified: true,
                extensions: [dashExtension],
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

        // 7) Trip origin/dest stop markers — large and prominent like Google Maps
        if (activeTripPlan) {
            L.push(new ScatterplotLayer({
                id: 'trip-stops',
                data: [
                    { position: [activeTripPlan.originStop.lon, activeTripPlan.originStop.lat], label: 'origin' },
                    { position: [activeTripPlan.destStop.lon, activeTripPlan.destStop.lat], label: 'dest' },
                ],
                getPosition: (d: any) => d.position,
                getFillColor: (d: any) => d.label === 'origin' ? [16, 185, 129] : [0, 212, 255],
                getLineColor: [255, 255, 255],
                getRadius: 80,
                radiusMinPixels: 12,
                radiusMaxPixels: 20,
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
