import { useEffect, useState, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Map } from '@vis.gl/react-maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import axios from 'axios';

// Madison, WI coordinates - 2D view
const INITIAL_VIEW_STATE = {
    longitude: -89.384,
    latitude: 43.073,
    zoom: 12,
    pitch: 0,  // Flat 2D
    bearing: 0
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Color palette for routes
const ROUTE_COLORS: Record<string, [number, number, number]> = {
    'A': [238, 51, 37],      // Red
    'B': [128, 188, 0],      // Green
    'C': [51, 51, 102],      // Navy
    'D': [51, 51, 102],
    'E': [34, 114, 181],     // Blue
    'F': [34, 114, 181],
    'G': [34, 114, 181],
    'H': [34, 114, 181],
    'J': [34, 114, 181],
    'L': [194, 163, 255],    // Purple
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

    // Fetch routes and patterns on mount
    useEffect(() => {
        const fetchRoutesAndPatterns = async () => {
            try {
                const routesRes = await axios.get(`${API_BASE}/routes`);
                const routeList = routesRes.data['bustime-response']?.routes || [];
                setRoutes(routeList);

                // Fetch all patterns in parallel
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

    // Live vehicle polling - ALWAYS ON
    useEffect(() => {
        const fetchLive = async () => {
            try {
                const res = await axios.get(`${API_BASE}/vehicles`);
                const data = res.data;
                if (data['bustime-response']?.vehicle) {
                    const vehicles = data['bustime-response'].vehicle;
                    const list = Array.isArray(vehicles) ? vehicles : [vehicles];
                    setLiveData(list.map((v: any) => ({
                        position: [parseFloat(v.lon), parseFloat(v.lat)],
                        color: v.dly ? [255, 60, 60] : ROUTE_COLORS[v.rt] || [0, 200, 100],
                        id: v.vid,
                        route: v.rt,
                        des: v.des,
                        dly: v.dly
                    })));
                    setLastUpdate(new Date());
                }
            } catch (e) {
                console.error("Error fetching live vehicles", e);
            }
        };

        fetchLive();
        const interval = setInterval(fetchLive, 10000); // Poll every 10s
        return () => clearInterval(interval);
    }, []);

    // Filter data based on selected route
    const filteredLive = useMemo(() => {
        if (selectedRoute === 'ALL') return liveData;
        return liveData.filter(d => d.route === selectedRoute);
    }, [liveData, selectedRoute]);

    const filteredPatterns = useMemo(() => {
        if (selectedRoute === 'ALL') return patternsData;
        return patternsData.filter(d => d.route === selectedRoute);
    }, [patternsData, selectedRoute]);

    // Build layers - SIMPLE 2D
    const layers = useMemo(() => {
        const layerList: any[] = [];

        // Route lines (PathLayer)
        if (filteredPatterns.length > 0) {
            layerList.push(
                new PathLayer({
                    id: 'route-patterns',
                    data: filteredPatterns,
                    getPath: (d: any) => d.path,
                    getColor: (d: any) => [...d.color, 100], // Semi-transparent
                    getWidth: 15,
                    widthMinPixels: 2,
                    capRounded: true,
                    jointRounded: true,
                })
            );
        }

        // Live bus markers (ScatterplotLayer - simpler than IconLayer)
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

    return (
        <div className="relative w-full h-full">
            <DeckGL
                initialViewState={INITIAL_VIEW_STATE}
                controller={true}
                layers={layers}
                style={{ width: '100%', height: '100%' }}
                getTooltip={({ object }) => object && {
                    html: `
                        <div style="background: #1a1a1a; color: white; padding: 12px; border-radius: 8px; font-family: system-ui; border: 1px solid #333;">
                            <div style="font-weight: bold; font-size: 16px; margin-bottom: 4px;">Route ${object.route}</div>
                            <div style="font-size: 13px; color: #aaa; margin-bottom: 6px;">${object.des || 'Unknown destination'}</div>
                            <div style="font-size: 12px; color: ${object.dly ? '#ff6060' : '#60ff60'}; font-weight: 600;">
                                ${object.dly ? '⚠ DELAYED' : '✓ On Time'}
                            </div>
                        </div>
                    `,
                    style: { backgroundColor: 'transparent' }
                }}
            >
                <Map
                    reuseMaps
                    mapLib={maplibregl}
                    mapStyle={MAP_STYLE}
                />
            </DeckGL>

            {/* Simple Control Panel */}
            <div className="absolute top-4 left-4 bg-black/80 backdrop-blur-md p-4 rounded-xl border border-gray-700 text-white w-64">
                <h2 className="font-bold text-lg mb-3">Madison Metro</h2>

                {/* Route Filter */}
                <label className="text-xs text-gray-400 block mb-1">Filter Route</label>
                <select
                    value={selectedRoute}
                    onChange={e => setSelectedRoute(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm text-white mb-4"
                >
                    <option value="ALL">All Routes</option>
                    {routes.map(r => (
                        <option key={r.rt} value={r.rt}>{r.rt} - {r.rtnm}</option>
                    ))}
                </select>

                {/* Stats */}
                <div className="text-sm space-y-2 border-t border-gray-700 pt-3">
                    <div className="flex justify-between">
                        <span className="text-gray-400">Live Buses</span>
                        <span className="font-mono text-green-400">{filteredLive.length}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-400">Delayed</span>
                        <span className="font-mono text-red-400">
                            {filteredLive.filter(b => b.dly).length}
                        </span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                        <span>Updated</span>
                        <span>{lastUpdate.toLocaleTimeString()}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
