import { useEffect, useState, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { ColumnLayer } from '@deck.gl/layers';
import { HexagonLayer } from '@deck.gl/aggregation-layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import { PathLayer } from '@deck.gl/layers';
import { Map } from '@vis.gl/react-maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import axios from 'axios';
import { Play, Pause, Layers } from 'lucide-react';

// Madison, WI coordinates
const INITIAL_VIEW_STATE = {
    longitude: -89.384,
    latitude: 43.073,
    zoom: 12,
    pitch: 45,
    bearing: 0
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

export default function MapView() {
    const [heatmapData, setHeatmapData] = useState<any[]>([]);
    const [tripsData, setTripsData] = useState<any[]>([]);
    const [liveData, setLiveData] = useState<any[]>([]);
    const [routes, setRoutes] = useState<any[]>([]);
    const [selectedRoute, setSelectedRoute] = useState<string>('ALL');
    const [patternsData, setPatternsData] = useState<any[]>([]);


    // Animation State

    // Animation State
    const [time, setTime] = useState(0);
    const [animationSpeed, setAnimationSpeed] = useState(5);
    const [isPlaying, setIsPlaying] = useState(true);

    // Layer Toggles
    const [showHeatmap, setShowHeatmap] = useState(true);
    const [showTrips, setShowTrips] = useState(true);
    const [showLive, setShowLive] = useState(true);

    // Animation loop
    useEffect(() => {
        let animation: number;
        const animate = () => {
            if (isPlaying) {
                setTime(t => (t + animationSpeed) % 86400);
            }
            animation = requestAnimationFrame(animate);
        };
        animation = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animation);
    }, [isPlaying, animationSpeed]);

    // Base API URL
    const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

    // Initial Data Fetch (Historical + Stops)
    useEffect(() => {
        const fetchData = async () => {
            try {
                // Mapping to available endpoints in app.py
                const [heatmapRes, routesRes] = await Promise.all([
                    axios.get(`${API_BASE}/viz/geo-heatmap`),
                    axios.get(`${API_BASE}/routes`)
                ]);

                if (heatmapRes.data) {
                    setHeatmapData(heatmapRes.data);
                }

                setTripsData([]); // /viz/trips not currently available in backend

                if (routesRes.data['bustime-response']?.routes) {
                    setRoutes(routesRes.data['bustime-response'].routes);
                }
            } catch (error) {
                console.error("Error fetching geo data:", error);
            }
        };
        fetchData();
    }, []);

    // Live Data Polling
    useEffect(() => {
        if (!showLive) return;

        const fetchLive = async () => {
            try {
                const res = await axios.get(`${API_BASE}/vehicles`); // Standard endpoint
                const data = res.data;
                if (data['bustime-response']?.vehicle) {
                    const vehicles = data['bustime-response'].vehicle;
                    const list = Array.isArray(vehicles) ? vehicles : [vehicles];
                    setLiveData(list.map((v: any) => ({
                        position: [parseFloat(v.lon), parseFloat(v.lat)],
                        angle: parseInt(v.hdg, 10) || 0,
                        color: v.dly ? [255, 0, 0] : [0, 255, 0], // Red if delayed
                        id: v.vid,
                        route: v.rt,
                        des: v.des, // Destination
                        spd: v.spd, // Speed
                        dly: v.dly  // Delay status
                    })));
                }
            } catch (e) {
                console.error("Error fetching live vehicles", e);
            }
        };

        fetchLive();
        const interval = setInterval(fetchLive, 2000); // Poll every 2s
        return () => clearInterval(interval);
    }, [showLive]);

    // Fetch patterns when route changes
    useEffect(() => {
        const fetchPatterns = async () => {
            if (selectedRoute === 'ALL') {
                setPatternsData([]);
                return;
            }
            try {
                const res = await axios.get(`${API_BASE}/patterns?rt=${selectedRoute}`);
                // Verify response structure matches (app.py: returns { "bustime-response": { "ptr": [...] } })
                if (res.data['bustime-response']?.ptr) {
                    // Need to flatten/process patterns for DeckGL if format differs
                    // Assuming backend returns standard bustime format, we might need to parse 'pt' array
                    const ptrs = res.data['bustime-response'].ptr;
                    const list = Array.isArray(ptrs) ? ptrs : [ptrs];

                    // Convert to DeckGL path format
                    const formattedPatterns = list.map((p: any) => ({
                        path: p.pt.map((pt: any) => [pt.lon, pt.lat]),
                        color: [255, 255, 255]
                    }));
                    setPatternsData(formattedPatterns);
                }
            } catch (e) {
                console.error("Error fetching patterns", e);
            }
        };
        fetchPatterns();
    }, [selectedRoute]);

    const filteredTrips = selectedRoute === 'ALL'
        ? tripsData
        : tripsData.filter(d => d.route === selectedRoute);

    const filteredLive = selectedRoute === 'ALL'
        ? liveData
        : liveData.filter(d => d.route === selectedRoute);

    const layers = useMemo(() => [
        showHeatmap && heatmapData.length > 0 && new HexagonLayer({
            id: 'heatmap',
            data: heatmapData,
            getPosition: (d: any) => [d.lon, d.lat],
            pickable: true,
            extruded: true,
            radius: 200,
            elevationScale: 50, // Taller for drama
            opacity: 0.6,
            colorRange: [
                [0, 255, 255],   // Cyan
                [60, 80, 255],   // Blue-ish
                [120, 0, 255],   // Purple
                [255, 0, 255]    // Magenta
            ],
            upperPercentile: 98,
            coverage: 0.9,
            material: {
                ambient: 0.64,
                diffuse: 0.6,
                shininess: 32,
                specularColor: [51, 51, 51]
            },
            transitions: {
                elevationScale: 3000
            }
        }),
        // Static Route Overlay
        new PathLayer({
            id: 'route-patterns',
            data: patternsData,
            getPath: (d: any) => d.path,
            getColor: (d: any) => d.color || [255, 255, 255],
            getWidth: 20,
            widthMinPixels: 2,
            capRounded: true,
            jointRounded: true
        }),
        showTrips && tripsData.length > 0 && new TripsLayer({
            id: 'trips',
            data: filteredTrips,
            getPath: (d: any) => d.path,
            getTimestamps: (d: any) => d.timestamps,
            getColor: (d: any) => d.color || [253, 128, 93],
            opacity: 0.8,
            widthMinPixels: 3,
            jointRounded: true,
            capRounded: true,
            trailLength: 600,
            currentTime: time,
            shadowEnabled: false
        }),
        showLive && new ColumnLayer({
            id: 'live-bus-3d',
            data: filteredLive,
            diskResolution: 12,
            radius: 50,
            extruded: true,
            pickable: true,
            elevationScale: 50,
            getPosition: (d: any) => d.position,
            getFillColor: (d: any) => d.color,
            getLineColor: [0, 0, 0],
            getElevation: 20,
            offset: [0, 0]
        }),
    ].filter(Boolean), [
        showHeatmap, heatmapData,
        patternsData,
        showTrips, filteredTrips, time,
        showLive, filteredLive
    ]);

    return (
        <div className="relative w-full h-full">
            <DeckGL
                initialViewState={INITIAL_VIEW_STATE}
                controller={true}
                layers={layers}
                style={{ width: '100%', height: '100%' }}
                getTooltip={({ object }) => object && {
                    html: `
                        <div style="background: #1f2937; color: white; padding: 12px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); font-family: system-ui;">
                            <div style="font-weight: bold; font-size: 14px; margin-bottom: 4px;">Route ${object.route}</div>
                            <div style="font-size: 12px; color: #9ca3af; margin-bottom: 8px;">To ${object.des || 'Unknown'}</div>
                            <div style="display: flex; gap: 12px; font-size: 11px;">
                                <div>
                                    <span style="color: #9ca3af;">Speed:</span>
                                    <span style="margin-left: 4px; font-weight: 500;">${object.spd || 0} mph</span>
                                </div>
                                <div>
                                    <span style="color: #9ca3af;">Status:</span>
                                    <span style="margin-left: 4px; font-weight: 500; color: ${object.dly ? '#ef4444' : '#22c55e'}">
                                        ${object.dly ? 'Delayed' : 'On Time'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    `,
                    style: {
                        backgroundColor: 'transparent',
                        fontSize: '0.8em'
                    }
                }}
            >
                <Map
                    reuseMaps
                    mapLib={maplibregl}
                    mapStyle={MAP_STYLE}
                />
            </DeckGL>

            {/* Controls */}
            <div className="absolute bottom-8 right-8 bg-black/80 backdrop-blur-md p-6 rounded-2xl border border-gray-800 text-white w-80 shadow-2xl">
                <div className="flex items-center gap-2 mb-4 border-b border-gray-700 pb-2">
                    <Layers className="w-5 h-5 text-blue-400" />
                    <h3 className="font-bold text-lg">Visualization Layers</h3>
                </div>

                <div className="space-y-3 mb-6">
                    <label className="flex items-center justify-between cursor-pointer group">
                        <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${showLive ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-gray-600'}`} />
                            <span className="group-hover:text-white text-gray-300 transition-colors">Live Traffic (Real-Time)</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={showLive}
                            onChange={e => setShowLive(e.target.checked)}
                            className="accent-green-500"
                        />
                    </label>

                    <label className="flex items-center justify-between cursor-pointer group">
                        <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${showTrips ? 'bg-orange-500' : 'bg-gray-600'}`} />
                            <span className="group-hover:text-white text-gray-300 transition-colors">Historical Trends (24h)</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={showTrips}
                            onChange={e => setShowTrips(e.target.checked)}
                            className="accent-orange-500"
                        />
                    </label>

                    <label className="flex items-center justify-between cursor-pointer group">
                        <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${showHeatmap ? 'bg-red-500' : 'bg-gray-600'}`} />
                            <span className="group-hover:text-white text-gray-300 transition-colors">Density Heatmap (3D)</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={showHeatmap}
                            onChange={e => setShowHeatmap(e.target.checked)}
                            className="accent-red-500"
                        />
                    </label>



                    {/* Route Filter */}
                    <div className="pt-2">
                        <label className="text-xs text-gray-400 block mb-1">Filter Route</label>
                        <select
                            value={selectedRoute}
                            onChange={e => setSelectedRoute(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 rounded p-1 text-sm text-white"
                        >
                            <option value="ALL">All Routes</option>
                            {routes.map(r => (
                                <option key={r.rt} value={r.rt}>{r.rt} - {r.rtnm}</option>
                            ))}
                        </select>
                    </div>
                </div>



                <div className="border-t border-gray-700 pt-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono text-gray-400">HISTORICAL TIME</span>
                        <span className="text-xl font-bold font-mono text-orange-400">
                            {Math.floor(time / 3600).toString().padStart(2, '0')}:
                            {Math.floor((time % 3600) / 60).toString().padStart(2, '0')}
                        </span>
                    </div>

                    <input
                        type="range"
                        min="0"
                        max="86400"
                        value={time}
                        onChange={e => {
                            setTime(Number(e.target.value));
                            setIsPlaying(false); // Pause on scrub
                        }}
                        className="w-full mb-4 accent-orange-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setIsPlaying(!isPlaying)}
                                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                            >
                                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                            </button>
                            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
                                {isPlaying ? 'Playing' : 'Paused'}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 bg-black/40 rounded-lg p-1">
                            <button
                                onClick={() => setAnimationSpeed(Math.max(1, animationSpeed / 2))}
                                className={`px-2 py-1 text-xs rounded ${animationSpeed < 5 ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                1x
                            </button>
                            <button
                                onClick={() => setAnimationSpeed(5)}
                                className={`px-2 py-1 text-xs rounded ${animationSpeed === 5 ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                5x
                            </button>
                            <button
                                onClick={() => setAnimationSpeed(20)}
                                className={`px-2 py-1 text-xs rounded ${animationSpeed === 20 ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                20x
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div >
    );
}
