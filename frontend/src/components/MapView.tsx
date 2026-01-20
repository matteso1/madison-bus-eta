import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import DeckGL from '@deck.gl/react';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Map } from '@vis.gl/react-maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import axios from 'axios';
import { Bus, AlertTriangle, BarChart3, MapPin, X, Clock, TrendingUp } from 'lucide-react';

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

// Cache for ML predictions
const predictionCache: Record<string, { prediction: any; timestamp: number }> = {};
const CACHE_TTL = 60000;

interface StopPrediction {
    route: string;
    destination: string;
    apiMinutes: number;
    mlMinutes: number;
    mlLow: number;
    mlHigh: number;
    delayed: boolean;
    vid: string;
}

interface RouteReliability {
    route_id: string;
    reliability_score: number;
    rating: string;
    avg_error: number;
}

export default function MapView() {
    const [selectedRoute, setSelectedRoute] = useState<string>('ALL');
    const [liveData, setLiveData] = useState<any[]>([]);
    const [routes, setRoutes] = useState<any[]>([]);
    const [patternsData, setPatternsData] = useState<any[]>([]);
    const [stopsData, setStopsData] = useState<any[]>([]);
    const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
    const [routeReliability, setRouteReliability] = useState<Record<string, RouteReliability>>({});

    // Stop modal state
    const [selectedStop, setSelectedStop] = useState<any>(null);
    const [stopPredictions, setStopPredictions] = useState<StopPrediction[]>([]);
    const [loadingPredictions, setLoadingPredictions] = useState(false);

    // Hover state for triggering ML prediction
    const [hoveredVehicle, setHoveredVehicle] = useState<string | null>(null);

    const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

    // Fetch route reliability on mount
    useEffect(() => {
        const fetchReliability = async () => {
            try {
                const res = await axios.get(`${API_BASE}/api/route-reliability`);
                const reliabilityMap: Record<string, RouteReliability> = {};
                (res.data.routes || []).forEach((r: RouteReliability) => {
                    reliabilityMap[r.route_id] = r;
                });
                setRouteReliability(reliabilityMap);
            } catch (e) {
                console.error('Failed to fetch route reliability:', e);
            }
        };
        fetchReliability();
    }, [API_BASE]);

    // Function to get ML prediction for a vehicle - triggers on hover
    const getMLPrediction = useCallback(async (vehicle: any, apiPrediction: number = 10) => {
        const cacheKey = `${vehicle.vid}-${vehicle.route}`;
        const cached = predictionCache[cacheKey];

        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.prediction;
        }

        try {
            const response = await axios.post(`${API_BASE}/api/predict-arrival-v2`, {
                route: vehicle.route,
                stop_id: vehicle.nextStop || 'live_tracking',
                vehicle_id: vehicle.vid,
                api_prediction: apiPrediction
            });

            const prediction = response.data;
            predictionCache[cacheKey] = { prediction, timestamp: Date.now() };
            return prediction;
        } catch (error) {
            console.error('ML prediction error:', error);
            return null;
        }
    }, [API_BASE]);

    // Trigger ML prediction when hovering over a vehicle
    useEffect(() => {
        if (hoveredVehicle) {
            const vehicle = liveData.find(v => v.vid === hoveredVehicle);
            if (vehicle) {
                getMLPrediction(vehicle);
            }
        }
    }, [hoveredVehicle, liveData, getMLPrediction]);

    // Fetch stops for selected route
    useEffect(() => {
        const fetchStops = async () => {
            if (selectedRoute === 'ALL') {
                setStopsData([]);
                return;
            }

            try {
                const res = await axios.get(`${API_BASE}/stops?rt=${selectedRoute}`);
                const stops = res.data?.['bustime-response']?.stops || [];
                const mapped = stops.map((s: any) => ({
                    position: [parseFloat(s.lon), parseFloat(s.lat)],
                    stpid: s.stpid,
                    stpnm: s.stpnm,
                    route: selectedRoute
                }));
                setStopsData(mapped);
            } catch (e) {
                console.error('Failed to fetch stops:', e);
                setStopsData([]);
            }
        };
        fetchStops();
    }, [selectedRoute, API_BASE]);

    // Fetch predictions for a stop when clicked
    const fetchStopPredictions = async (stop: any) => {
        setLoadingPredictions(true);
        setSelectedStop(stop);
        setStopPredictions([]);

        try {
            // Get predictions from Madison Metro API
            const res = await axios.get(`${API_BASE}/predictions?stpid=${stop.stpid}`);
            const prdArray = res.data?.['bustime-response']?.prd || [];
            const predictions = Array.isArray(prdArray) ? prdArray : [prdArray];

            // Get ML corrections for each prediction
            const mlPredictions: StopPrediction[] = [];

            for (const prd of predictions.slice(0, 5)) { // Limit to 5
                const apiMinutes = parseInt(prd.prdctdn) || 0;

                try {
                    const mlRes = await axios.post(`${API_BASE}/api/predict-arrival-v2`, {
                        route: prd.rt,
                        stop_id: stop.stpid,
                        vehicle_id: prd.vid,
                        api_prediction: apiMinutes
                    });

                    mlPredictions.push({
                        route: prd.rt,
                        destination: prd.des,
                        apiMinutes,
                        mlMinutes: Math.round(mlRes.data.eta_median_min),
                        mlLow: Math.round(mlRes.data.eta_low_min),
                        mlHigh: Math.round(mlRes.data.eta_high_min),
                        delayed: prd.dly === true || prd.dly === 'true',
                        vid: prd.vid
                    });
                } catch {
                    // Fallback if ML fails
                    mlPredictions.push({
                        route: prd.rt,
                        destination: prd.des,
                        apiMinutes,
                        mlMinutes: apiMinutes,
                        mlLow: Math.round(apiMinutes * 0.85),
                        mlHigh: Math.round(apiMinutes * 1.3),
                        delayed: prd.dly === true || prd.dly === 'true',
                        vid: prd.vid
                    });
                }
            }

            setStopPredictions(mlPredictions);
        } catch (e) {
            console.error('Failed to fetch stop predictions:', e);
        } finally {
            setLoadingPredictions(false);
        }
    };

    useEffect(() => {
        const fetchRoutesAndPatterns = async () => {
            try {
                const routesRes = await axios.get(`${API_BASE}/routes`);
                const routeList = routesRes.data['bustime-response']?.routes || [];
                setRoutes(routeList);

                const patternPromises = routeList.map((r: any) =>
                    axios.get(`${API_BASE}/patterns?rt=${r.rt}`).catch(() => null)
                );

                const patternResponses = await Promise.all(patternPromises);
                const allPatterns: any[] = [];

                patternResponses.forEach((res, index) => {
                    if (!res?.data?.['bustime-response']?.ptr) return;
                    const rt = routeList[index].rt;
                    const color = ROUTE_COLORS[rt] || [100, 100, 100];
                    const ptrs = res.data['bustime-response'].ptr;
                    const patterns = Array.isArray(ptrs) ? ptrs : [ptrs];

                    patterns.forEach((p: any) => {
                        if (!p?.pt?.length) return;
                        allPatterns.push({
                            path: p.pt.map((pt: any) => [parseFloat(pt.lon), parseFloat(pt.lat)]),
                            color: color,
                            route: rt
                        });
                    });
                });

                setPatternsData(allPatterns);
            } catch (error) {
                console.error("Error fetching routes/patterns:", error);
            }
        };
        fetchRoutesAndPatterns();
    }, [API_BASE]);

    useEffect(() => {
        const fetchLive = async () => {
            try {
                const res = await axios.get(`${API_BASE}/vehicles`);
                const vehicles = res.data?.['bustime-response']?.vehicle;
                if (!vehicles) return;

                const arr = Array.isArray(vehicles) ? vehicles : [vehicles];
                const mapped = arr.map((v: any) => ({
                    position: [parseFloat(v.lon), parseFloat(v.lat)],
                    route: v.rt,
                    vid: v.vid,
                    des: v.des,
                    dly: v.dly === true || v.dly === 'true',
                    color: ROUTE_COLORS[v.rt] || [150, 150, 150],
                    prdctdn: v.prdctdn // API countdown if available
                }));
                setLiveData(mapped);
                setLastUpdate(new Date());
            } catch (e) {
                console.error('Live fetch error:', e);
            }
        };
        fetchLive();
        const interval = setInterval(fetchLive, 15000);
        return () => clearInterval(interval);
    }, [API_BASE]);

    const filteredPatterns = useMemo(() =>
        selectedRoute === 'ALL' ? patternsData : patternsData.filter(p => p.route === selectedRoute),
        [patternsData, selectedRoute]);

    const filteredLive = useMemo(() =>
        selectedRoute === 'ALL' ? liveData : liveData.filter(v => v.route === selectedRoute),
        [liveData, selectedRoute]);

    const layers = useMemo(() => {
        const layerList: any[] = [];

        // Route paths
        if (filteredPatterns.length > 0) {
            layerList.push(
                new PathLayer({
                    id: 'route-paths',
                    data: filteredPatterns,
                    getPath: (d: any) => d.path,
                    getColor: (d: any) => [...d.color, 180],
                    getWidth: 4,
                    widthMinPixels: 2,
                    capRounded: true,
                    jointRounded: true,
                })
            );
        }

        // Stops layer (only when route selected)
        if (stopsData.length > 0) {
            layerList.push(
                new ScatterplotLayer({
                    id: 'stops',
                    data: stopsData,
                    pickable: true,
                    opacity: 0.8,
                    stroked: true,
                    filled: true,
                    radiusScale: 1,
                    radiusMinPixels: 5,
                    radiusMaxPixels: 12,
                    lineWidthMinPixels: 1,
                    getPosition: (d: any) => d.position,
                    getRadius: 30,
                    getFillColor: [255, 255, 255, 200],
                    getLineColor: [100, 100, 100],
                    onClick: ({ object }) => {
                        if (object) fetchStopPredictions(object);
                    }
                })
            );
        }

        // Live buses
        if (filteredLive.length > 0) {
            layerList.push(
                new ScatterplotLayer({
                    id: 'live-buses',
                    data: filteredLive,
                    pickable: true,
                    opacity: 1,
                    stroked: true,
                    filled: true,
                    radiusScale: 1,
                    radiusMinPixels: 8,
                    radiusMaxPixels: 20,
                    lineWidthMinPixels: 2,
                    getPosition: (d: any) => d.position,
                    getRadius: 50,
                    getFillColor: (d: any) => d.color,
                    getLineColor: [255, 255, 255],
                    onHover: ({ object }) => {
                        if (object) {
                            setHoveredVehicle(object.vid);
                        }
                    }
                })
            );
        }

        return layerList;
    }, [filteredPatterns, filteredLive, stopsData]);

    const delayedCount = filteredLive.filter(b => b.dly).length;

    // Get reliability badge for a route
    const getReliabilityBadge = (routeId: string) => {
        const rel = routeReliability[routeId];
        if (!rel) return '';
        if (rel.rating === 'Excellent') return '🟢';
        if (rel.rating === 'Good') return '🟡';
        return '🔴';
    };

    return (
        <div className="relative w-full h-full">
            <DeckGL
                initialViewState={INITIAL_VIEW_STATE}
                controller={true}
                layers={layers}
                style={{ width: '100%', height: '100%' }}
                getTooltip={({ object }) => {
                    if (!object) return null;

                    // Check if it's a stop
                    if (object.stpid) {
                        return {
                            html: `
                                <div style="background: rgba(0,0,0,0.95); color: white; padding: 12px 16px; border-radius: 12px; font-family: system-ui; border: 1px solid rgba(255,255,255,0.15);">
                                    <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${object.stpnm}</div>
                                    <div style="font-size: 11px; color: #71717a;">Stop #${object.stpid}</div>
                                    <div style="font-size: 10px; color: #10b981; margin-top: 6px;">Click for ML predictions →</div>
                                </div>
                            `,
                            style: { backgroundColor: 'transparent' }
                        };
                    }

                    // It's a bus
                    const cacheKey = `${object.vid}-${object.route}`;
                    const cached = predictionCache[cacheKey];
                    const mlPrediction = cached?.prediction;

                    let predictionSection = '';

                    if (mlPrediction && mlPrediction.model_available) {
                        const etaLow = Math.round(mlPrediction.eta_low_min);
                        const etaHigh = Math.round(mlPrediction.eta_high_min);
                        const etaMedian = Math.round(mlPrediction.eta_median_min);
                        const apiEta = Math.round(mlPrediction.api_prediction_min);

                        let etaColor = '#4ade80';
                        if (etaMedian > 15) etaColor = '#fbbf24';
                        if (etaMedian > 25) etaColor = '#f87171';

                        predictionSection = `
                            <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; margin-top: 8px;">
                                <div style="font-size: 10px; color: #71717a; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                                    <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: linear-gradient(135deg, #10b981, #06b6d4);"></span>
                                    ML-CORRECTED ETA
                                </div>
                                <div style="font-size: 22px; color: ${etaColor}; font-weight: 700; margin-bottom: 4px;">
                                    ${etaLow}-${etaHigh} min
                                </div>
                                <div style="font-size: 11px; color: #71717a;">
                                    API: ${apiEta} min → ML: ${etaMedian} min
                                </div>
                                <div style="font-size: 10px; color: #52525b; margin-top: 4px;">
                                    80% confidence • v${mlPrediction.model_version || 'latest'}
                                </div>
                            </div>
                        `;
                    } else {
                        predictionSection = `
                            <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; margin-top: 8px;">
                                <div style="font-size: 11px; color: #71717a;">
                                    ${object.dly ? '⚠️ Delays reported' : '✓ On schedule'}
                                </div>
                                <div style="font-size: 10px; color: #52525b; margin-top: 4px;">
                                    Hover to load ML prediction...
                                </div>
                            </div>
                        `;
                    }

                    return {
                        html: `
                            <div style="background: rgba(0,0,0,0.95); color: white; padding: 14px 18px; border-radius: 14px; font-family: system-ui; border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(12px); min-width: 240px;">
                                <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                                    <span>Route ${object.route}</span>
                                    <span style="font-size: 10px; padding: 2px 8px; border-radius: 10px; background: ${object.dly ? 'rgba(248,113,113,0.2)' : 'rgba(74,222,128,0.2)'}; color: ${object.dly ? '#f87171' : '#4ade80'};">${object.dly ? 'DELAYED' : 'ON TIME'}</span>
                                </div>
                                <div style="font-size: 12px; color: #a1a1aa; margin-bottom: 2px;">${object.des || 'Unknown destination'}</div>
                                <div style="font-size: 10px; color: #52525b;">Vehicle ${object.vid}</div>
                                ${predictionSection}
                            </div>
                        `,
                        style: { backgroundColor: 'transparent' }
                    };
                }}
            >
                <Map reuseMaps mapLib={maplibregl} mapStyle={MAP_STYLE} />
            </DeckGL>

            {/* Stop Predictions Modal */}
            {selectedStop && (
                <div className="absolute inset-0 z-60 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <MapPin className="w-5 h-5 text-emerald-400" />
                                    {selectedStop.stpnm}
                                </h3>
                                <p className="text-sm text-slate-400">Stop #{selectedStop.stpid}</p>
                            </div>
                            <button
                                onClick={() => setSelectedStop(null)}
                                className="text-slate-400 hover:text-white transition-colors"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        {loadingPredictions ? (
                            <div className="py-8 text-center text-slate-400">
                                <Clock className="w-8 h-8 mx-auto mb-2 animate-pulse" />
                                <p>Loading ML predictions...</p>
                            </div>
                        ) : stopPredictions.length === 0 ? (
                            <div className="py-8 text-center text-slate-400">
                                <Bus className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                <p>No buses approaching this stop</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <p className="text-xs text-slate-500 mb-2">ML-CORRECTED ARRIVALS</p>
                                {stopPredictions.map((pred, idx) => (
                                    <div key={idx} className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <span className="font-bold text-white">Route {pred.route}</span>
                                                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${pred.delayed ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                                                    {pred.delayed ? 'DELAYED' : 'ON TIME'}
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-2xl font-bold text-emerald-400">
                                                    {pred.mlLow}-{pred.mlHigh}
                                                </div>
                                                <div className="text-xs text-slate-500">minutes</div>
                                            </div>
                                        </div>
                                        <div className="text-sm text-slate-400">{pred.destination}</div>
                                        <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                                            <TrendingUp className="w-3 h-3" />
                                            <span>API: {pred.apiMinutes}m → ML: {pred.mlMinutes}m</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Top Navigation Bar */}
            <div className="absolute top-0 left-0 right-0 z-50">
                <div className="m-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3 flex items-center gap-3">
                            <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
                            <span className="font-semibold text-white">Madison Metro Live</span>
                        </div>
                    </div>

                    <div className="hidden md:flex items-center gap-3">
                        <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-2 flex items-center gap-2">
                            <Bus className="w-6 h-6 text-emerald-400" />
                            <div>
                                <div className="text-lg font-bold text-white">{filteredLive.length}</div>
                                <div className="text-xs text-zinc-400">Active Buses</div>
                            </div>
                        </div>
                        {delayedCount > 0 && (
                            <div className="bg-red-500/20 backdrop-blur-xl border border-red-500/30 rounded-xl px-4 py-2 flex items-center gap-2">
                                <AlertTriangle className="w-6 h-6 text-red-400" />
                                <div>
                                    <div className="text-lg font-bold text-red-400">{delayedCount}</div>
                                    <div className="text-xs text-red-300">Delayed</div>
                                </div>
                            </div>
                        )}
                        <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-2">
                            <div className="text-xs text-zinc-400">Last Update</div>
                            <div className="text-sm font-mono text-white">{lastUpdate.toLocaleTimeString()}</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <select
                            value={selectedRoute}
                            onChange={e => setSelectedRoute(e.target.value)}
                            className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-3 text-white text-sm appearance-none cursor-pointer hover:bg-black/80 transition-colors min-w-[160px]"
                            style={{ fontSize: '16px' }}
                        >
                            <option value="ALL">All Routes</option>
                            {routes.map(r => (
                                <option key={r.rt} value={r.rt}>
                                    {getReliabilityBadge(r.rt)} {r.rt} - {r.rtnm}
                                </option>
                            ))}
                        </select>
                        <Link
                            to="/analytics"
                            className="bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white px-5 py-3 rounded-xl font-medium transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                        >
                            <BarChart3 className="w-5 h-5" />
                            <span className="hidden sm:inline">Analytics</span>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Hint for stops */}
            {selectedRoute !== 'ALL' && stopsData.length > 0 && (
                <div className="absolute bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-50">
                    <div className="bg-black/80 backdrop-blur-xl border border-emerald-500/30 rounded-xl px-4 py-2 text-sm text-emerald-400 flex items-center gap-2">
                        <MapPin className="w-4 h-4" />
                        Click on a stop for ML-corrected arrivals
                    </div>
                </div>
            )}

            {/* Mobile Bottom Stats */}
            <div className="md:hidden absolute bottom-4 left-4 right-4 z-50">
                <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="text-center">
                            <div className="text-xl font-bold text-white">{filteredLive.length}</div>
                            <div className="text-xs text-zinc-400">Buses</div>
                        </div>
                        {delayedCount > 0 && (
                            <div className="text-center">
                                <div className="text-xl font-bold text-red-400">{delayedCount}</div>
                                <div className="text-xs text-red-300">Delayed</div>
                            </div>
                        )}
                    </div>
                    <Link
                        to="/analytics"
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                    >
                        📊 Analytics
                    </Link>
                </div>
            </div>
        </div>
    );
}
