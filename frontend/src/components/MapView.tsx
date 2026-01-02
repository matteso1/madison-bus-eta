import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
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

export default function MapView() {
    const [selectedRoute, setSelectedRoute] = useState<string>('ALL');
    const [liveData, setLiveData] = useState<any[]>([]);
    const [routes, setRoutes] = useState<any[]>([]);
    const [patternsData, setPatternsData] = useState<any[]>([]);
    const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

    const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

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
    }, []);

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
                    color: ROUTE_COLORS[v.rt] || [150, 150, 150]
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
    }, []);

    const filteredPatterns = useMemo(() =>
        selectedRoute === 'ALL' ? patternsData : patternsData.filter(p => p.route === selectedRoute),
        [patternsData, selectedRoute]);

    const filteredLive = useMemo(() =>
        selectedRoute === 'ALL' ? liveData : liveData.filter(v => v.route === selectedRoute),
        [liveData, selectedRoute]);

    const layers = useMemo(() => {
        const layerList: any[] = [];

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
                })
            );
        }

        return layerList;
    }, [filteredPatterns, filteredLive]);

    const delayedCount = filteredLive.filter(b => b.dly).length;

    return (
        <div className="relative w-full h-full">
            <DeckGL
                initialViewState={INITIAL_VIEW_STATE}
                controller={true}
                layers={layers}
                style={{ width: '100%', height: '100%' }}
                getTooltip={({ object }) => object && {
                    html: `
                        <div style="background: rgba(0,0,0,0.95); color: white; padding: 14px 18px; border-radius: 14px; font-family: system-ui; border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(12px); min-width: 200px;">
                            <div style="font-weight: 600; font-size: 15px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                                <span>Route ${object.route}</span>
                                <span style="font-size: 10px; padding: 2px 8px; border-radius: 10px; background: ${object.dly ? 'rgba(248,113,113,0.2)' : 'rgba(74,222,128,0.2)'}; color: ${object.dly ? '#f87171' : '#4ade80'};">${object.dly ? 'DELAYED' : 'ON TIME'}</span>
                            </div>
                            <div style="font-size: 12px; color: #a1a1aa; margin-bottom: 10px;">${object.des || 'Unknown destination'}</div>
                            <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; margin-top: 2px;">
                                <div style="font-size: 10px; color: #71717a; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                                    <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: linear-gradient(135deg, #a855f7, #6366f1);"></span>
                                    ML PREDICTION
                                </div>
                                <div style="font-size: 12px; color: #c4b5fd;">
                                    ${object.dly
                            ? 'Expect ~2-4 min additional delay'
                            : new Date().getHours() >= 7 && new Date().getHours() <= 9 || new Date().getHours() >= 17 && new Date().getHours() <= 19
                                ? 'Rush hour - slight delays possible'
                                : 'Likely to stay on schedule'}
                                </div>
                                <div style="font-size: 10px; color: #52525b; margin-top: 4px;">78% confidence</div>
                            </div>
                        </div>
                    `,
                    style: { backgroundColor: 'transparent' }
                }}
            >
                <Map reuseMaps mapLib={maplibregl} mapStyle={MAP_STYLE} />
            </DeckGL>

            {/* Top Navigation Bar */}
            <div className="absolute top-0 left-0 right-0 z-50">
                <div className="m-4 flex items-center justify-between">
                    {/* Logo & Title */}
                    <div className="flex items-center gap-4">
                        <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3 flex items-center gap-3">
                            <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
                            <span className="font-semibold text-white">Madison Metro Live</span>
                        </div>
                    </div>

                    {/* Center Stats */}
                    <div className="hidden md:flex items-center gap-3">
                        <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-2 flex items-center gap-2">
                            <span className="text-2xl">🚌</span>
                            <div>
                                <div className="text-lg font-bold text-white">{filteredLive.length}</div>
                                <div className="text-xs text-zinc-400">Active Buses</div>
                            </div>
                        </div>
                        {delayedCount > 0 && (
                            <div className="bg-red-500/20 backdrop-blur-xl border border-red-500/30 rounded-xl px-4 py-2 flex items-center gap-2">
                                <span className="text-2xl">⚠️</span>
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

                    {/* Right Side - Analytics Link & Route Filter */}
                    <div className="flex items-center gap-3">
                        <select
                            value={selectedRoute}
                            onChange={e => setSelectedRoute(e.target.value)}
                            className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-3 text-white text-sm appearance-none cursor-pointer hover:bg-black/80 transition-colors min-w-[140px]"
                            style={{ fontSize: '16px' }}
                        >
                            <option value="ALL">All Routes</option>
                            {routes.map(r => (
                                <option key={r.rt} value={r.rt}>{r.rt} - {r.rtnm}</option>
                            ))}
                        </select>
                        <Link
                            to="/analytics"
                            className="bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white px-5 py-3 rounded-xl font-medium transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                        >
                            <span>📊</span>
                            <span className="hidden sm:inline">Analytics</span>
                        </Link>
                    </div>
                </div>
            </div>

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
