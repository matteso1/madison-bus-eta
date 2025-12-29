import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapView.css';

// Helper function to format passenger load
const formatPassengerLoad = (load) => {
    switch (load) {
        case 'EMPTY': return 'Empty';
        case 'HALF_EMPTY': return 'Half Empty';
        case 'FEW_SEATS_LEFT': return 'Few Seats Left';
        case 'FULL': return 'Full';
        case 'STANDING_ROOM_ONLY': return 'Standing Room Only';
        default: return 'N/A';
    }
};

// Helper function to format timestamp
const formatTimestamp = (timestamp) => {
    if (!timestamp || typeof timestamp !== 'string') return 'N/A';
    try {
        // Expected format: "20251021 08:44"
        const year = timestamp.substring(0, 4);
        const month = timestamp.substring(4, 6);
        const day = timestamp.substring(6, 8);
        const time = timestamp.substring(9);

        const date = new Date(`${year}-${month}-${day}T${time}`);
        if (isNaN(date)) return 'Invalid Date';

        return date.toLocaleTimeString();
    } catch (e) {
        return 'Invalid Date';
    }
};

// Custom Icon Creation
const createLiveBusIcon = (isDelayed) => {
    const iconHtml = `
        <div class="live-bus-icon-wrapper ${isDelayed ? 'delayed' : ''}">
            <svg class="bus-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 8H4V6C4 4.89543 4.89543 4 6 4H18C19.1046 4 20 4.89543 20 6V8ZM20 8V16H22V8.5C22 8.22386 21.7761 8 21.5 8H20ZM4 8V16H2V8.5C2 8.22386 2.22386 8 2.5 8H4ZM4 16V18C4 19.1046 4.89543 20 6 20H7C7 20.5523 7.44772 21 8 21C8.55228 21 9 20.5523 9 20H15C15 20.5523 15.4477 21 16 21C16.5523 21 17 20.5523 17 20H18C19.1046 20 20 19.1046 20 18V16H4Z" fill="#FFF"/></svg>
        </div>
    `;
    return new L.divIcon({
        html: iconHtml,
        className: 'custom-live-bus-icon',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -20]
    });
};

const createBusStopIcon = () => {
    return new L.divIcon({
        html: `<div class="bus-stop-icon"></div>`,
        className: 'custom-bus-stop-icon',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
        popupAnchor: [0, -10]
    });
};

const DEFAULT_POS = [43.0731, -89.4012];

const MapView = ({ selectedRoute, selectedDir, apiBase }) => {
    const [patternCoords, setPatternCoords] = useState([]);
    const [allPatterns, setAllPatterns] = useState([]);
    const [stops, setStops] = useState([]);
    const [vehicles, setVehicles] = useState([]);
    const [liveTracking, setLiveTracking] = useState(false);
    const [lastVehicleUpdate, setLastVehicleUpdate] = useState(null);
    const [isochrone, setIsochrone] = useState(null);
    const [isoMinutes, setIsoMinutes] = useState(15);
    const [showIso, setShowIso] = useState(false);
    const [useIsoNow, setUseIsoNow] = useState(true);
    const [whenIso, setWhenIso] = useState('');
    const [expectedWait, setExpectedWait] = useState(null);
    const [stopsOnRoute, setStopsOnRoute] = useState([]);
    const [pattern, setPattern] = useState(null);

    // Isochrone fetch (optional quick access via CTRL+click on map center later)
    const fetchIsochrone = useCallback(async (center = DEFAULT_POS, minutes = 15, whenOpt = null) => {
        try {
            const whenParam = whenOpt ? `&when=${encodeURIComponent(whenOpt)}` : '';
            const url = `${apiBase}/viz/isochrone?lat=${center[0]}&lon=${center[1]}&minutes=${minutes}${whenParam}`;
            const res = await fetch(url);
            const data = await res.json();
            setIsochrone(data);
            const ew = data?.assumptions?.expected_wait_min;
            setExpectedWait(typeof ew === 'number' ? ew : null);
        } catch (e) {
            setIsochrone(null);
            setExpectedWait(null);
        }
    }, [apiBase]);

    // Toggle isochrone on demand
    useEffect(() => {
        if (!showIso) { setIsochrone(null); setExpectedWait(null); return; }
        const whenVal = useIsoNow ? 'now' : (whenIso || null);
        (async () => { await fetchIsochrone(DEFAULT_POS, isoMinutes, whenVal); })();
    }, [showIso, isoMinutes, apiBase, useIsoNow, whenIso, fetchIsochrone]);

    // Helper: rough meters per degree at Madison lat
    const metersPerDeg = useCallback((lat) => {
        const latRad = (lat * Math.PI) / 180;
        const mPerLat = 111132.0;
        const mPerLon = 111320.0 * Math.cos(latRad);
        return { mPerLat, mPerLon };
    }, []);

    // Distance from point to segment (approx meters)
    const pointToSegmentDistanceM = useCallback((lat, lon, a, b) => {
        const { mPerLat, mPerLon } = metersPerDeg(lat);
        const x = (lon - a[1]) * mPerLon;
        const y = (lat - a[0]) * mPerLat;
        const x1 = (b[1] - a[1]) * mPerLon;
        const y1 = (b[0] - a[0]) * mPerLat;
        const segLen2 = x1 * x1 + y1 * y1 || 1e-6;
        let t = (x * x1 + y * y1) / segLen2;
        t = Math.max(0, Math.min(1, t));
        const projX = x1 * t;
        const projY = y1 * t;
        const dx = x - projX;
        const dy = y - projY;
        return Math.sqrt(dx * dx + dy * dy);
    }, [metersPerDeg]);

    // Snap stops to nearest segment of any displayed pattern (within 40m)
    useEffect(() => {
        if (!stops || stops.length === 0 || allPatterns.length === 0) {
            setStopsOnRoute(stops || []);
            return;
        }
        const thresholdM = 40;
        const mergedSegments = [];
        allPatterns.forEach(p => {
            for (let i = 1; i < p.coords.length; i++) {
                mergedSegments.push([p.coords[i - 1], p.coords[i]]);
            }
        });
        const snapped = stops.map(s => {
            const lat = parseFloat(s.lat);
            const lon = parseFloat(s.lon);
            if (Number.isNaN(lat) || Number.isNaN(lon)) return s;
            let best = { d: Infinity, a: null, b: null };
            for (const [a, b] of mergedSegments) {
                const d = pointToSegmentDistanceM(lat, lon, a, b);
                if (d < best.d) best = { d, a, b };
            }
            if (best.d <= thresholdM) {
                // Project onto segment a-b approximately
                const { mPerLat, mPerLon } = metersPerDeg(lat);
                const ax = 0, ay = 0;
                const bx = (best.b[1] - best.a[1]) * mPerLon;
                const by = (best.b[0] - best.a[0]) * mPerLat;
                const px = (lon - best.a[1]) * mPerLon;
                const py = (lat - best.a[0]) * mPerLat;
                const segLen2 = bx * bx + by * by || 1e-6;
                let t = ((px - ax) * bx + (py - ay) * by) / segLen2;
                t = Math.max(0, Math.min(1, t));
                const projLon = best.a[1] + (bx * t) / mPerLon;
                const projLat = best.a[0] + (by * t) / mPerLat;
                return { ...s, lat: projLat, lon: projLon, _snapped: true };
            }
            return s;
        });
        // Keep only stops aligned to a displayed pattern; fallback to all if none snapped
        const filtered = snapped.filter(s => s._snapped);
        setStopsOnRoute(filtered.length > 0 ? filtered : snapped);
    }, [stops, allPatterns, pointToSegmentDistanceM, metersPerDeg]);

    // Fetch patterns (route polylines) for selected route+direction
    useEffect(() => {
        if (!selectedRoute || !selectedDir) {
            setPatternCoords([]);
            setAllPatterns([]);
            return;
        }

        const controller = new AbortController();

        fetch(`${apiBase}/patterns?rt=${selectedRoute}&dir=${encodeURIComponent(selectedDir)}`, { signal: controller.signal })
            .then(res => res.json())
            .then(data => {
                console.log("Patterns API response:", data);

                // Check for API errors
                if (data.error) {
                    setPatternCoords([]);
                    setAllPatterns([]);
                    return;
                }

                // Handle the BusTime API response structure
                const bustimeResponse = data['bustime-response'];
                if (!bustimeResponse) {
                    setPatternCoords([]);
                    setAllPatterns([]);
                    return;
                }

                // Get patterns array
                let patterns = bustimeResponse.ptr;
                if (!patterns) {
                    setPatternCoords([]);
                    setAllPatterns([]);
                    return;
                }

                // Ensure patterns is an array
                if (!Array.isArray(patterns)) {
                    patterns = [patterns];
                }

                if (patterns.length === 0) {
                    setPatternCoords([]);
                    setAllPatterns([]);
                    return;
                }

                // Process each pattern separately
                const processedPatterns = patterns.map(pattern => {
                    let points = pattern.pt;
                    if (!points) return null;

                    if (!Array.isArray(points)) {
                        points = [points];
                    }

                    // Convert to coordinates array for this pattern
                    const coords = points
                        .map(pt => [parseFloat(pt.lat), parseFloat(pt.lon)])
                        .filter(pair =>
                            pair.every(num => typeof num === "number" && !isNaN(num))
                        );

                    return {
                        coords,
                        patternId: pattern.pid,
                        direction: pattern.rtdir
                    };
                }).filter(pattern => pattern && pattern.coords.length > 0);

                if (processedPatterns.length === 0) {
                    console.warn("No valid patterns found for route/direction");
                    setPatternCoords([]);
                    setAllPatterns([]);
                    return;
                }

                console.log(`Found ${processedPatterns.length} valid patterns`);
                processedPatterns.forEach((pattern, index) => {
                    console.log(`Pattern ${index + 1}: ${pattern.coords.length} points, direction: ${pattern.direction}`);
                });

                // For now, use the first pattern for the main route line
                // (we'll render all patterns separately in the JSX)
                setAllPatterns(processedPatterns);
                setPatternCoords(processedPatterns[0].coords);
            })
            .catch(err => {
                if (err.name !== 'AbortError') {
                    console.error("Error fetching patterns:", err);
                    setPatternCoords([]);
                    setAllPatterns([]);
                }
            })
            .finally(() => { });
        return () => controller.abort();
    }, [selectedRoute, selectedDir, apiBase]);

    // Fetch stops (bus stop markers)
    useEffect(() => {
        if (!selectedRoute || !selectedDir) {
            setStops([]);
            return;
        }

        const controller = new AbortController();
        fetch(`${apiBase}/stops?rt=${selectedRoute}&dir=${encodeURIComponent(selectedDir)}`, { signal: controller.signal })
            .then(res => res.json())
            .then(data => {
                console.log("Stops API response:", data);

                if (data.error) {
                    console.error("Error fetching stops:", data.error);
                    setStops([]);
                    return;
                }

                const bustimeResponse = data['bustime-response'];
                if (bustimeResponse && bustimeResponse.stops) {
                    setStops(bustimeResponse.stops);
                } else {
                    setStops([]);
                }
            })
            .catch(err => {
                if (err.name !== 'AbortError') {
                    console.error("Error fetching stops:", err);
                    setStops([]);
                }
            });
        return () => controller.abort();
    }, [selectedRoute, selectedDir, apiBase]);

    // Live vehicle tracking with smart caching
    useEffect(() => {
        if (!liveTracking || !selectedRoute) {
            setVehicles([]);
            return;
        }

        const fetchVehicles = async () => {
            try {
                console.log("Fetching live vehicle data...");
                const response = await fetch(`${apiBase}/vehicles?rt=${selectedRoute}`);
                const data = await response.json();

                if (data.error) {
                    console.error("Error fetching vehicles:", data.error);
                    return;
                }

                const bustimeResponse = data['bustime-response'];
                if (bustimeResponse && bustimeResponse.vehicle) {
                    let vehicleList = bustimeResponse.vehicle;
                    if (!Array.isArray(vehicleList)) {
                        vehicleList = [vehicleList];
                    }

                    // Filter vehicles by direction if we have that info
                    const filteredVehicles = vehicleList.filter(vehicle => {
                        // For now, show all vehicles on the route
                        // Later we could filter by direction if the API provides that
                        return true;
                    });

                    setVehicles(filteredVehicles);
                    setLastVehicleUpdate(new Date());
                    console.log(`Found ${filteredVehicles.length} live vehicles`);
                }
            } catch (err) {
                console.error("Error fetching vehicles:", err);
            }
        };

        // Fetch immediately
        fetchVehicles();

        // Set up interval for updates (every 10 seconds)
        const interval = setInterval(fetchVehicles, 10000);

        return () => clearInterval(interval);
    }, [liveTracking, selectedRoute, apiBase]);

    // Derive fallback single polyline from fetched patterns
    useEffect(() => {
        if (allPatterns.length > 0) {
            setPattern(allPatterns[0].coords);
        } else {
            setPattern(null);
        }
    }, [allPatterns]);

    // Fit map to current pattern
    const FitBounds = ({ coords }) => {
        const map = useMap();
        useEffect(() => {
            if (!coords || coords.length < 2) return;
            try {
                const bounds = L.latLngBounds(coords);
                map.fitBounds(bounds, { padding: [30, 30] });
            } catch (e) {
                // no-op
            }
        }, [coords, map]);
        return null;
    };

    return (
        <div className="map-view-wrapper">
            <div className="map-controls">
                <div className="control-item">
                    <input
                        type="checkbox"
                        id="live-tracking"
                        checked={liveTracking}
                        onChange={(e) => setLiveTracking(e.target.checked)}
                    />
                    <label htmlFor="live-tracking">Live Bus Tracking</label>
                </div>
                <div className="control-item" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                        type="checkbox"
                        id="show-iso"
                        checked={showIso}
                        onChange={(e) => setShowIso(e.target.checked)}
                    />
                    <label htmlFor="show-iso">Reachable area (isochrone)</label>
                    <input
                        type="number"
                        min={5} max={60} step={5}
                        value={isoMinutes}
                        onChange={(e) => setIsoMinutes(parseInt(e.target.value || '15', 10))}
                        style={{ width: 70 }}
                    />
                    <span>min</span>
                    <span style={{ marginLeft: 8, opacity: 0.8 }}>|</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                            type="checkbox"
                            checked={useIsoNow}
                            onChange={(e) => setUseIsoNow(e.target.checked)}
                        />
                        Use now
                    </label>
                    {!useIsoNow && (
                        <input
                            type="datetime-local"
                            value={whenIso}
                            onChange={(e) => setWhenIso(e.target.value)}
                        />
                    )}
                    {expectedWait != null && (
                        <span style={{ marginLeft: 8, fontStyle: 'italic' }}>wait ≈ {expectedWait.toFixed(1)} min</span>
                    )}
                </div>
                {lastVehicleUpdate && (
                    <div className="last-update-notice">
                        Last update: {lastVehicleUpdate.toLocaleTimeString()}
                    </div>
                )}
            </div>
            <div className="map-view">
                <MapContainer center={DEFAULT_POS} zoom={13} style={{ height: '100%', width: '100%' }}>
                    {/* Isochrone overlays (if fetched) */}
                    {isochrone?.walk?.polygon && (
                        <Polyline positions={isochrone.walk.polygon} pathOptions={{ color: '#22c55e', weight: 2, opacity: 0.6 }} />
                    )}
                    {isochrone?.walk_transit?.polygon && (
                        <Polyline positions={isochrone.walk_transit.polygon} pathOptions={{ color: '#ef4444', weight: 2, opacity: 0.5 }} />
                    )}
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution="&copy; OpenStreetMap contributors"
                    />
                    {/* Render all discovered patterns for the chosen direction */}
                    {allPatterns.map(p => (
                        <Polyline key={p.patternId} pathOptions={{ color: '#0f172a', weight: 4, opacity: 0.8 }} positions={p.coords} />
                    ))}
                    {/* Fallback main polyline */}
                    {pattern && <Polyline pathOptions={{ color: '#0f172a', weight: 3, opacity: 0.5 }} positions={pattern} />}

                    <FitBounds coords={pattern || patternCoords} />

                    {/* Render bus stop markers */}
                    {stopsOnRoute.map(stop => (
                        <Marker
                            key={stop.stpid}
                            position={[parseFloat(stop.lat), parseFloat(stop.lon)]}
                            icon={createBusStopIcon()}
                        >
                            <Popup>
                                <div>
                                    <strong>{stop.stpnm}</strong>
                                    <br />
                                    Stop ID: {stop.stpid}
                                    <Predictions stpid={stop.stpid} apiBase={apiBase} />
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    {/* Render live bus markers */}
                    {liveTracking && vehicles.map(vehicle => (
                        <Marker
                            key={vehicle.vid}
                            position={[parseFloat(vehicle.lat), parseFloat(vehicle.lon)]}
                            icon={createLiveBusIcon(vehicle.dly === 'true' || vehicle.dly === true)}
                        >
                            <Popup>
                                <div>
                                    <strong>Bus #{vehicle.vid}</strong>
                                    <br />
                                    <strong>Route:</strong> {vehicle.rt}
                                    <br />
                                    <strong>Destination:</strong> {vehicle.des}
                                    <br />
                                    <strong>Status:</strong> {vehicle.dly === 'true' || vehicle.dly === true ? 'DELAYED' : 'On Time'}
                                    {vehicle.spd && <><br /><strong>Speed:</strong> {vehicle.spd} mph</>}
                                    {vehicle.psgld && <><br /><strong>Passenger Load:</strong> {formatPassengerLoad(vehicle.psgld)}</>}
                                    {vehicle.tmstmp && <><br /><strong>Last Update:</strong> {formatTimestamp(vehicle.tmstmp)}</>}
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    {/* Heatmap Layer */}
                    {/* HeatmapLayer component was removed from imports, so this will be commented out or removed if not needed */}
                    {/* <HeatmapLayer heatmapData={heatmapData} showHeatmap={showHeatmap} /> */}
                </MapContainer>
            </div>
        </div>
    );
};

// Inline predictions component to avoid alert popups
const Predictions = ({ stpid, apiBase }) => {
    const [loading, setLoading] = useState(false);
    const [items, setItems] = useState(null);
    const load = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`${apiBase}/predictions?stpid=${stpid}`);
            const data = await res.json();
            const prds = data['bustime-response']?.prd || [];
            setItems(prds.slice(0, 5));
        } catch (e) {
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [stpid, apiBase]);

    return (
        <div style={{ marginTop: 8 }}>
            <button onClick={load} disabled={loading}>
                {loading ? 'Loading…' : 'Show predictions'}
            </button>
            {items && (
                <ul style={{ marginTop: 6, paddingLeft: 16 }}>
                    {items.length === 0 && <li>No predictions available</li>}
                    {items.map((p, idx) => (
                        <li key={idx}>
                            {(p.rtnm || p.rt)} in {p.prdctdn} min{p.des ? ` → ${p.des}` : ''}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default MapView;