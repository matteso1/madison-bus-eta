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
    'A': [238, 67, 52],
    'B': [128, 188, 0],
    'C': [120, 120, 200],
    'D': [120, 120, 200],
    'E': [60, 150, 220],
    'F': [60, 150, 220],
    'G': [60, 150, 220],
    'H': [60, 150, 220],
    'J': [60, 150, 220],
    'L': [194, 163, 255],
    'O': [194, 163, 255],
    'P': [60, 150, 220],
    'R': [194, 163, 255],
    'S': [194, 163, 255],
    'W': [60, 150, 220],
    '0': [255, 167, 38],
    '2': [255, 167, 38],
    '4': [255, 167, 38],
    '5': [255, 167, 38],
    '6': [255, 167, 38],
    '7': [255, 167, 38],
    '8': [255, 167, 38],
    '10': [0, 188, 212],
    '13': [0, 188, 212],
    '15': [0, 188, 212],
    '18': [0, 188, 212],
    '19': [0, 188, 212],
    '21': [0, 188, 212],
    '22': [0, 188, 212],
    '25': [0, 188, 212],
    '28': [0, 188, 212],
    '29': [0, 188, 212],
    '30': [255, 112, 67],
    '31': [255, 112, 67],
    '32': [255, 112, 67],
    '33': [255, 112, 67],
    '34': [255, 112, 67],
    '35': [255, 112, 67],
    '37': [255, 112, 67],
    '38': [255, 112, 67],
    '39': [255, 112, 67],
    '44': [171, 71, 188],
    '47': [171, 71, 188],
    '50': [171, 71, 188],
    '51': [171, 71, 188],
    '52': [171, 71, 188],
    '55': [171, 71, 188],
    '56': [171, 71, 188],
    '57': [171, 71, 188],
    '58': [171, 71, 188],
    '61': [76, 175, 80],
    '62': [76, 175, 80],
    '63': [76, 175, 80],
    '64': [76, 175, 80],
    '67': [76, 175, 80],
    '68': [76, 175, 80],
    '70': [38, 166, 154],
    '71': [38, 166, 154],
    '72': [38, 166, 154],
    '73': [38, 166, 154],
    '75': [38, 166, 154],
    '78': [38, 166, 154],
    '74': [38, 166, 154],
    '76': [38, 166, 154],
    '80': [120, 120, 200],
    '81': [120, 120, 200],
    '82': [120, 120, 200],
    '83': [120, 120, 200],
    '84': [120, 120, 200],
    '85': [120, 120, 200],
};

const DEFAULT_ROUTE_COLOR: [number, number, number] = [140, 180, 220];


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

export interface BusClickEvent {
    vid: string;
    route: string;
    destination: string;
    delayed: boolean;
    position: [number, number];
}

interface MapViewProps {
    selectedRoute: string;
    userLocation: [number, number] | null;
    trackedBus: TrackedBus | null;
    activeTripPlan: TripPlan | null;
    highlightedStops: Array<{stpid: string; stpnm: string; lat: number; lon: number; routes: string[]}>;
    onRoutesLoaded: (routes: Array<{ rt: string; rtnm: string }>) => void;
    onLiveDataUpdated: (vehicles: VehicleData[], delayedCount: number) => void;
    onStopClick: (stop: StopClickEvent) => void;
    onBusClick?: (bus: BusClickEvent) => void;
    onMapClick?: (lngLat: [number, number]) => void;
}


export default function MapView({
    selectedRoute, userLocation, trackedBus, activeTripPlan, highlightedStops,
    onRoutesLoaded, onLiveDataUpdated, onStopClick, onBusClick, onMapClick
}: MapViewProps) {
    const [liveData, setLiveData] = useState<VehicleData[]>([]);
    const [allRoutePatterns, setAllRoutePatterns] = useState<any[]>([]);
    const [routePatterns, setRoutePatterns] = useState<any[]>([]);
    const [stopsData, setStopsData] = useState<any[]>([]);
    const routeDirectionsRef = useRef<any[]>([]);
    const [stopPredictions, setStopPredictions] = useState<Record<string, {route: string; minutes: number; destination: string}[]>>({});
    const mapRef = useRef<maplibregl.Map | null>(null);

    const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

    // ML predictions are fetched per-stop (in StopPredictions and TrackingOverlay),
    // not on bus hover — bus tooltip just shows route/destination info.

    // Load structured route data: directions, patterns, ordered stops
    useEffect(() => {
        if (selectedRoute === 'ALL') {
            setStopsData([]);
            setRoutePatterns([]);
            routeDirectionsRef.current = [];
            return;
        }
        let cancelled = false;
        setStopsData([]);
        setRoutePatterns([]);
        routeDirectionsRef.current = [];

        const loadRouteDetail = async () => {
            try {
                const res = await axios.get(`${API_BASE}/api/route-detail?rt=${selectedRoute}`);
                if (cancelled) return;
                const detail = res.data;
                const color = ROUTE_COLORS[selectedRoute] || DEFAULT_ROUTE_COLOR;

                const allStops: any[] = [];
                const allPatterns: any[] = [];
                const seenStops = new Set<string>();

                for (const dir of detail.directions || []) {
                    for (const pat of dir.patterns || []) {
                        const path: [number, number][] = pat.path || [];
                        const stops = (pat.stops || []).map((s: any, idx: number) => ({
                            idx, stpid: String(s.stpid), stpnm: s.stpnm,
                            pos: [s.lon, s.lat] as [number, number],
                        }));
                        allPatterns.push({
                            path, stops, color, route: selectedRoute,
                            pid: pat.pid, dir: dir.id, isPrimary: pat.is_primary,
                        });
                    }

                    for (const s of dir.stops || []) {
                        const sid = String(s.stpid);
                        if (seenStops.has(sid)) continue;
                        seenStops.add(sid);
                        allStops.push({
                            position: [s.lon, s.lat] as [number, number],
                            stpid: sid,
                            stpnm: s.stpnm,
                            route: selectedRoute,
                            direction: dir.id,
                        });
                    }
                }

                if (!cancelled) {
                    routeDirectionsRef.current = detail.directions || [];
                    setRoutePatterns(allPatterns);
                    setStopsData(allStops);
                }
            } catch (e) {
                console.error('Route detail load failed:', e);
                if (cancelled) return;
                // Fallback: load stops the old way
                try {
                    const res = await axios.get(`${API_BASE}/stops?rt=${selectedRoute}`);
                    if (cancelled) return;
                    const stops = res.data?.['bustime-response']?.stops || [];
                    setStopsData(stops.map((s: any) => ({
                        position: [parseFloat(s.lon), parseFloat(s.lat)],
                        stpid: String(s.stpid),
                        stpnm: s.stpnm,
                        route: selectedRoute,
                    })));
                } catch { setStopsData([]); }
            }
        };
        loadRouteDetail();
        return () => { cancelled = true; };
    }, [selectedRoute, API_BASE]);

    // Fetch route-level predictions for stop tooltips
    useEffect(() => {
        if (selectedRoute === 'ALL' || activeTripPlan) { setStopPredictions({}); return; }
        const fetchPredictions = async () => {
            try {
                const res = await axios.get(`${API_BASE}/predictions?rt=${selectedRoute}`);
                const preds = res.data?.['bustime-response']?.prd;
                if (!preds) return;
                const arr = Array.isArray(preds) ? preds : [preds];
                const grouped: Record<string, {route: string; minutes: number; destination: string}[]> = {};
                arr.forEach((p: any) => {
                    const stpid = String(p.stpid);
                    const mins = parseInt(p.prdctdn === 'DUE' ? '0' : p.prdctdn, 10);
                    if (!grouped[stpid]) grouped[stpid] = [];
                    if (grouped[stpid].length < 3) {
                        grouped[stpid].push({ route: p.rt, minutes: mins, destination: p.des || '' });
                    }
                });
                setStopPredictions(grouped);
            } catch { setStopPredictions({}); }
        };
        fetchPredictions();
        const timer = setInterval(fetchPredictions, 30000);
        return () => clearInterval(timer);
    }, [selectedRoute, activeTripPlan, API_BASE]);

    const parsePatternResponse = useCallback((res: any, rt: string): any[] => {
        const parsed: any[] = [];
        if (!res?.data?.['bustime-response']?.ptr) return parsed;
        const color = ROUTE_COLORS[rt] || DEFAULT_ROUTE_COLOR;
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
            parsed.push({ path, stops, color, route: rt, pid: p.pid, dir: p.rtdir });
        });
        return parsed;
    }, []);

    // Load route list + all-routes patterns (for the city overview map)
    useEffect(() => {
        const load = async () => {
            try {
                const routesRes = await axios.get(`${API_BASE}/routes`);
                const routeList = routesRes.data['bustime-response']?.routes || [];
                onRoutesLoaded(routeList);

                const allPatterns: any[] = [];
                const BATCH_SIZE = 5;
                for (let i = 0; i < routeList.length; i += BATCH_SIZE) {
                    const batch = routeList.slice(i, i + BATCH_SIZE);
                    const batchResults = await Promise.all(
                        batch.map((r: any) =>
                            axios.get(`${API_BASE}/patterns?rt=${r.rt}`).catch(() => null)
                        )
                    );
                    batchResults.forEach((res, j) => {
                        const rt = batch[j].rt;
                        allPatterns.push(...parsePatternResponse(res, rt));
                    });
                }
                setAllRoutePatterns(allPatterns);
            } catch (e) {
                console.error('Failed to load routes/patterns:', e);
            }
        };
        load();
    }, [API_BASE, onRoutesLoaded, parsePatternResponse]);

    // Live vehicle polling — only when a specific route is selected (bus dots aren't shown on overview)
    useEffect(() => {
        const isTracking = !!trackedBus;
        const hasRoute = selectedRoute !== 'ALL';
        const routeToFetch = trackedBus?.route || (hasRoute ? selectedRoute : null);

        if (!routeToFetch) {
            setLiveData([]);
            return;
        }

        const interval = isTracking ? 5000 : 10000;

        const fetchLive = async () => {
            try {
                const res = await axios.get(`${API_BASE}/vehicles?rt=${routeToFetch}`);
                const vehicles = res.data?.['bustime-response']?.vehicle;
                if (!vehicles) { setLiveData([]); return; }
                const arr = Array.isArray(vehicles) ? vehicles : [vehicles];
                const mapped: VehicleData[] = arr.map((v: any) => ({
                    position: [parseFloat(v.lon), parseFloat(v.lat)],
                    route: v.rt,
                    vid: v.vid,
                    des: v.des,
                    dly: v.dly === true || v.dly === 'true',
                    color: ROUTE_COLORS[v.rt] || DEFAULT_ROUTE_COLOR,
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
    }, [API_BASE, onLiveDataUpdated, trackedBus, selectedRoute]);

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

    // Use direction-aware route patterns when available, fall back to all-route patterns
    const patternsData = useMemo(() => {
        if (selectedRoute === 'ALL') return allRoutePatterns;
        if (routePatterns.length > 0) return routePatterns;
        return allRoutePatterns.filter(p => p.route === selectedRoute);
    }, [selectedRoute, allRoutePatterns, routePatterns]);

    const filteredPatterns = useMemo(() => {
        if (trackedBus) return patternsData.filter(p => p.route === trackedBus.route);
        if (activeTripPlan) return patternsData.filter(p => p.route === activeTripPlan.routeId);
        if (selectedRoute === 'ALL') return patternsData;
        // For a selected route, show only primary patterns (one per direction) for cleaner visuals
        const primaries = patternsData.filter(p => p.route === selectedRoute && p.isPrimary);
        return primaries.length > 0 ? primaries : patternsData.filter(p => p.route === selectedRoute);
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

    // (delayed bus indicators removed per user feedback)

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

    // ── Layers (order = render order: first = bottom, last = top) ──

    const layers = useMemo(() => {
        const L: any[] = [];

        // 1) Route paths — hidden during trip mode, bolder when a single route is selected
        if (filteredPatterns.length > 0 && !activeTripPlan) {
            const isSingleRoute = selectedRoute !== 'ALL' || !!trackedBus;
            L.push(new PathLayer({
                id: 'route-paths',
                data: filteredPatterns,
                getPath: (d: any) => d.path,
                getColor: (d: any) => [...d.color, trackedBus ? 80 : (isSingleRoute ? 220 : 160)],
                getWidth: isSingleRoute ? 5 : 3,
                widthMinPixels: isSingleRoute ? 3 : 1.5,
                capRounded: true,
                jointRounded: true,
            }));
        }

        // (delayed indicators removed — cluttered and unlabeled on the All Routes view)

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

        // ── Everything below here renders ON TOP of all lines ──

        // 6) Stop dots — visible during route view and tracking, hidden during trip
        if (stopsData.length > 0 && !activeTripPlan) {
            L.push(new ScatterplotLayer({
                id: 'stops',
                data: stopsData,
                pickable: true,
                opacity: trackedBus ? 0.5 : 0.9,
                stroked: true,
                filled: true,
                radiusMinPixels: trackedBus ? 4 : 5,
                radiusMaxPixels: trackedBus ? 8 : 12,
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

        // 7b) Nearby stops highlights — visible when NearbyStops panel is active
        if (highlightedStops.length > 0 && !activeTripPlan) {
            L.push(new ScatterplotLayer({
                id: 'nearby-stops',
                data: highlightedStops.map(s => ({
                    position: [s.lon, s.lat],
                    stpid: s.stpid,
                    stpnm: s.stpnm,
                    routes: s.routes,
                })),
                pickable: true,
                getPosition: (d: any) => d.position,
                getFillColor: [16, 185, 129],
                getLineColor: [255, 255, 255],
                getRadius: 40,
                radiusMinPixels: 7,
                radiusMaxPixels: 14,
                stroked: true,
                lineWidthMinPixels: 2,
                opacity: 1,
                onClick: ({ object }) => {
                    if (object) onStopClick({ stpid: object.stpid, stpnm: object.stpnm, route: object.routes?.[0] || '' });
                }
            }));
        }

        // 8) Live bus dots — bright white with thick dark border, clearly bigger than stops
        const nonTracked = trackedBus
            ? filteredLive.filter(v => v.vid !== trackedBus.vid)
            : filteredLive;

        if (nonTracked.length > 0 && !activeTripPlan) {
            L.push(new ScatterplotLayer({
                id: 'live-buses',
                data: nonTracked,
                pickable: true,
                opacity: trackedBus ? 0.4 : 1,
                stroked: true,
                filled: true,
                radiusMinPixels: trackedBus ? 6 : 10,
                radiusMaxPixels: trackedBus ? 12 : 22,
                lineWidthMinPixels: 2.5,
                getPosition: (d: any) => d.position,
                getRadius: 50,
                getFillColor: [255, 255, 255],
                getLineColor: [30, 30, 50],
                onClick: ({ object }) => {
                    if (object && onBusClick) {
                        onBusClick({
                            vid: object.vid,
                            route: object.route,
                            destination: object.des,
                            delayed: object.dly,
                            position: object.position,
                        });
                    }
                },
            }));
        }

        return L;
    }, [filteredPatterns, filteredLive, stopsData, onStopClick, onBusClick,
        trackedBus, activeTripPlan, tripData, tripWalkPaths, highlightedStops, selectedRoute]);

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
                    const preds = stopPredictions[object.stpid];
                    let predsHtml = '';
                    if (preds?.length) {
                        predsHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #1e1e2e;">` +
                            preds.map((p: {destination: string; minutes: number}) => `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:3px;">
                                <span style="font-size:11px;color:#94a3b8;">${p.destination}</span>
                                <span style="font-size:12px;font-weight:600;color:#00d4ff;font-family:JetBrains Mono,monospace;">${p.minutes === 0 ? 'DUE' : p.minutes + ' min'}</span>
                            </div>`).join('') + `</div>`;
                    }
                    return {
                        html: `<div style="background:rgba(8,8,16,0.95);color:#e2e8f0;padding:10px 14px;border-radius:8px;font-family:Inter,sans-serif;border:1px solid #1e1e2e;box-shadow:0 4px 12px rgba(0,0,0,0.5);">
                            <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${object.stpnm}</div>
                            <div style="font-size:10px;color:#64748b;font-family:JetBrains Mono,monospace;">Stop #${object.stpid}</div>
                            ${predsHtml || '<div style="font-size:10px;color:#00d4ff;margin-top:6px;">Click for ML predictions</div>'}
                        </div>`,
                        style: { backgroundColor: 'transparent', zIndex: '100', pointerEvents: 'none' }
                    };
                }

                if (object.vid) {
                    return {
                        html: `<div style="background:rgba(8,8,16,0.95);color:#e2e8f0;padding:12px 16px;border-radius:8px;font-family:Inter,sans-serif;border:1px solid #1e1e2e;min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.5);">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                                <span style="font-weight:700;font-size:16px;color:#00d4ff;">Route ${object.route}</span>
                                <span style="font-size:9px;padding:2px 6px;border-radius:3px;background:${object.dly ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)'};color:${object.dly ? '#ef4444' : '#10b981'};font-family:JetBrains Mono,monospace;">${object.dly ? 'DELAYED' : 'ON TIME'}</span>
                            </div>
                            <div style="font-size:12px;color:#e2e8f0;font-weight:500;">→ ${object.des || 'Unknown'}</div>
                            <div style="font-size:10px;color:#475569;font-family:JetBrains Mono,monospace;margin-top:4px;">Bus ${object.vid}</div>
                            <div style="font-size:10px;color:#00d4ff;margin-top:6px;">Click a stop for arrival times</div>
                        </div>`,
                        style: { backgroundColor: 'transparent', zIndex: '100', pointerEvents: 'none' }
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
