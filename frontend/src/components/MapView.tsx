import { useEffect, useState, useMemo, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Map } from '@vis.gl/react-maplibre';
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

interface MapViewProps {
    selectedRoute: string;
    onRoutesLoaded: (routes: Array<{ rt: string; rtnm: string }>) => void;
    onLiveDataUpdated: (vehicles: VehicleData[], delayedCount: number) => void;
    onStopClick: (stop: StopClickEvent) => void;
}

export default function MapView({ selectedRoute, onRoutesLoaded, onLiveDataUpdated, onStopClick }: MapViewProps) {
    const [liveData, setLiveData] = useState<VehicleData[]>([]);
    const [patternsData, setPatternsData] = useState<any[]>([]);
    const [stopsData, setStopsData] = useState<any[]>([]);
    const [routeReliability, setRouteReliability] = useState<Record<string, { reliability_score: number }>>({});
    const [hoveredVehicle, setHoveredVehicle] = useState<string | null>(null);

    const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

    // Fetch route reliability for path coloring
    useEffect(() => {
        axios.get(`${API_BASE}/api/route-reliability`).then(res => {
            const map: Record<string, any> = {};
            (res.data.routes || []).forEach((r: any) => { map[r.route_id] = r; });
            setRouteReliability(map);
        }).catch(() => {});
    }, [API_BASE]);

    // Preload ML prediction on vehicle hover
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

    // Load routes + patterns
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
                    const baseColor = ROUTE_COLORS[rt] || [100, 100, 100];
                    const rel = routeReliability[rt];
                    // Interpolate color toward amber if unreliable
                    const score = rel?.reliability_score ?? 0.7;
                    const color: [number, number, number] = score >= 0.7
                        ? baseColor
                        : [
                            Math.round(baseColor[0] * score + 245 * (1 - score)),
                            Math.round(baseColor[1] * score + 158 * (1 - score)),
                            Math.round(baseColor[2] * score + 11 * (1 - score)),
                          ];

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
    }, [API_BASE, routeReliability, onRoutesLoaded]);

    // Live vehicle polling
    useEffect(() => {
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
        const interval = setInterval(fetchLive, 15000);
        return () => clearInterval(interval);
    }, [API_BASE, onLiveDataUpdated]);

    const filteredPatterns = useMemo(() =>
        selectedRoute === 'ALL' ? patternsData : patternsData.filter(p => p.route === selectedRoute),
        [patternsData, selectedRoute]);

    const filteredLive = useMemo(() =>
        selectedRoute === 'ALL' ? liveData : liveData.filter(v => v.route === selectedRoute),
        [liveData, selectedRoute]);

    const layers = useMemo(() => {
        const layerList: any[] = [];

        if (filteredPatterns.length > 0) {
            layerList.push(new PathLayer({
                id: 'route-paths',
                data: filteredPatterns,
                getPath: (d: any) => d.path,
                getColor: (d: any) => [...d.color, 200],
                getWidth: 4,
                widthMinPixels: 2,
                capRounded: true,
                jointRounded: true,
            }));
        }

        if (stopsData.length > 0) {
            layerList.push(new ScatterplotLayer({
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

        if (filteredLive.length > 0) {
            layerList.push(new ScatterplotLayer({
                id: 'live-buses',
                data: filteredLive,
                pickable: true,
                opacity: 1,
                stroked: true,
                filled: true,
                radiusMinPixels: 8,
                radiusMaxPixels: 20,
                lineWidthMinPixels: 2,
                getPosition: (d: any) => d.position,
                getRadius: 50,
                getFillColor: (d: any) => d.dly ? [239, 68, 68] : d.color,
                getLineColor: [255, 255, 255],
                onHover: ({ object }) => setHoveredVehicle(object ? object.vid : null),
            }));
        }

        return layerList;
    }, [filteredPatterns, filteredLive, stopsData, onStopClick]);

    return (
        <DeckGL
            initialViewState={INITIAL_VIEW_STATE}
            controller={true}
            layers={layers}
            style={{ width: '100%', height: '100%' }}
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
            }}
        >
            <Map reuseMaps mapLib={maplibregl} mapStyle={MAP_STYLE} />
        </DeckGL>
    );
}
