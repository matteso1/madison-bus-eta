import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Clock, TrendingUp, AlertCircle, Search, Bus } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './RoutePlanner.css';

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";

// Debounce helper
const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// Geocoding using Nominatim (free, no API key needed)
const geocodeAddress = async (query) => {
    if (!query || query.trim().length < 2) {
        return [];
    }
    
    try {
        // Clean query - remove "Madison, WI" if already present to avoid duplication
        let cleanQuery = query.trim();
        if (cleanQuery.toLowerCase().includes('madison')) {
            // Already has Madison, use as-is
        } else {
            cleanQuery = `${cleanQuery}, Madison, WI`;
        }
        
        // Prioritize Madison, WI results with bounding box
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?` +
            `q=${encodeURIComponent(cleanQuery)}&` +
            `format=json&` +
            `limit=8&` +
            `addressdetails=1&` +
            `bounded=1&` +
            `viewbox=-89.6,43.2,-89.2,43.0&` + // Madison bounding box
            `countrycodes=us`,
            {
                headers: {
                    'User-Agent': 'Madison-Bus-ETA/1.0' // Required by Nominatim
                }
            }
        );
        
        if (!response.ok) {
            console.warn('Geocoding API error:', response.status);
            return [];
        }
        
        const data = await response.json();
        
        // Filter and prioritize Madison results
        const madisonResults = data
            .filter(item => {
                const addr = item.address || {};
                const city = (addr.city || addr.town || addr.village || '').toLowerCase();
                const state = (addr.state || '').toLowerCase();
                return city.includes('madison') || state === 'wisconsin' || state === 'wi';
            })
            .map(item => {
                // Create a cleaner display name
                const addr = item.address || {};
                let display = item.display_name;
                
                // Try to create a shorter, more useful display
                const parts = [];
                if (addr.house_number && addr.road) {
                    parts.push(`${addr.house_number} ${addr.road}`);
                } else if (addr.road) {
                    parts.push(addr.road);
                }
                if (addr.neighbourhood || addr.suburb) {
                    parts.push(addr.neighbourhood || addr.suburb);
                }
                if (parts.length > 0) {
                    display = parts.join(', ') + ', Madison, WI';
                }
                
                // Create a unique key for deduplication
                const key = `${addr.house_number || ''}_${addr.road || ''}_${addr.neighbourhood || addr.suburb || ''}`.toLowerCase();
                
                return {
                    display: display,
                    fullDisplay: item.display_name,
                    lat: parseFloat(item.lat),
                    lon: parseFloat(item.lon),
                    address: item.display_name,
                    key: key,
                    houseNumber: addr.house_number,
                    road: addr.road,
                    neighbourhood: addr.neighbourhood || addr.suburb
                };
            });
        
        // Deduplicate by key, keeping the first occurrence
        const seen = new Set();
        const unique = madisonResults.filter(item => {
            if (seen.has(item.key)) {
                return false;
            }
            seen.add(item.key);
            return true;
        });
        
        // Sort: prioritize results with house numbers if query looks like an address
        const hasNumber = /^\d+/.test(query.trim());
        if (hasNumber) {
            unique.sort((a, b) => {
                const aHasNum = !!a.houseNumber;
                const bHasNum = !!b.houseNumber;
                if (aHasNum && !bHasNum) return -1;
                if (!aHasNum && bHasNum) return 1;
                return 0;
            });
        }
        
        return unique.slice(0, 5); // Limit to 5 best results
    } catch (err) {
        console.error('Geocoding error:', err);
        return [];
    }
};

// Fix Leaflet default icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function RoutePlanner() {
    const [origin, setOrigin] = useState({ lat: null, lon: null, name: '' });
    const [destination, setDestination] = useState({ lat: null, lon: null, name: '' });
    const [useCurrentLocation, setUseCurrentLocation] = useState(false);
    const [routes, setRoutes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [stops, setStops] = useState([]);
    const [stopsMap, setStopsMap] = useState(new Map());
    
    // Address autocomplete states
    const [originSuggestions, setOriginSuggestions] = useState([]);
    const [destinationSuggestions, setDestinationSuggestions] = useState([]);
    const [showOriginSuggestions, setShowOriginSuggestions] = useState(false);
    const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);
    const [originSearching, setOriginSearching] = useState(false);
    const [destinationSearching, setDestinationSearching] = useState(false);
    const originInputRef = useRef(null);
    const destinationInputRef = useRef(null);
    const originSearchTimeoutRef = useRef(null);
    const destinationSearchTimeoutRef = useRef(null);

    useEffect(() => {
        if (useCurrentLocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setOrigin({
                        lat: position.coords.latitude,
                        lon: position.coords.longitude,
                        name: 'Your Location'
                    });
                },
                (err) => {
                    setError('Could not get your location. Please enter it manually.');
                    setUseCurrentLocation(false);
                }
            );
        }
    }, [useCurrentLocation]);

    // Debounced search functions
    const handleOriginSearch = (query) => {
        // Clear previous timeout
        if (originSearchTimeoutRef.current) {
            clearTimeout(originSearchTimeoutRef.current);
        }
        
        if (query.length < 2) {
            setOriginSuggestions([]);
            setShowOriginSuggestions(false);
            setOriginSearching(false);
            return;
        }
        
        setOriginSearching(true);
        
        // Debounce the API call
        originSearchTimeoutRef.current = setTimeout(async () => {
            try {
                const results = await geocodeAddress(query);
                setOriginSuggestions(results);
                setShowOriginSuggestions(results.length > 0);
            } catch (err) {
                console.error('Origin search error:', err);
                setOriginSuggestions([]);
            } finally {
                setOriginSearching(false);
            }
        }, 400); // 400ms debounce
    };

    const handleDestinationSearch = (query) => {
        // Clear previous timeout
        if (destinationSearchTimeoutRef.current) {
            clearTimeout(destinationSearchTimeoutRef.current);
        }
        
        if (query.length < 2) {
            setDestinationSuggestions([]);
            setShowDestinationSuggestions(false);
            setDestinationSearching(false);
            return;
        }
        
        setDestinationSearching(true);
        
        // Debounce the API call
        destinationSearchTimeoutRef.current = setTimeout(async () => {
            try {
                const results = await geocodeAddress(query);
                setDestinationSuggestions(results);
                setShowDestinationSuggestions(results.length > 0);
            } catch (err) {
                console.error('Destination search error:', err);
                setDestinationSuggestions([]);
            } finally {
                setDestinationSearching(false);
            }
        }, 400); // 400ms debounce
    };

    // Select origin from suggestions
    const selectOrigin = (suggestion) => {
        setOrigin({
            lat: suggestion.lat,
            lon: suggestion.lon,
            name: suggestion.display
        });
        setShowOriginSuggestions(false);
        setOriginSuggestions([]);
        setOriginSearching(false);
        // Clear any pending searches
        if (originSearchTimeoutRef.current) {
            clearTimeout(originSearchTimeoutRef.current);
        }
    };

    // Select destination from suggestions
    const selectDestination = (suggestion) => {
        setDestination({
            lat: suggestion.lat,
            lon: suggestion.lon,
            name: suggestion.display
        });
        setShowDestinationSuggestions(false);
        setDestinationSuggestions([]);
        setDestinationSearching(false);
        // Clear any pending searches
        if (destinationSearchTimeoutRef.current) {
            clearTimeout(destinationSearchTimeoutRef.current);
        }
    };

    const findNearbyStops = async (lat, lon, radius = 1.0) => {
        try {
            const response = await fetch(`${API_BASE}/stops/nearby?lat=${lat}&lon=${lon}&radius=${radius}`);
            
            if (!response.ok) {
                console.error(`HTTP error! status: ${response.status}`);
                const errorText = await response.text();
                console.error('Error response:', errorText);
                throw new Error(`Server error: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('Stops API response:', { count: data.count, hasStops: !!data.stops, error: data.error });
            
            // If cache doesn't exist, try to build it
            if (data.error && data.error.includes('Stop cache not built')) {
                console.log('Stop cache not found, building it...');
                setError('Building stop cache... This may take a minute.');
                
                // Build the cache
                const buildResponse = await fetch(`${API_BASE}/viz/build-stop-cache`, { method: 'POST' });
                const buildData = await buildResponse.json();
                
                if (buildData.success) {
                    setError(null);
                    // Retry finding stops
                    const retryResponse = await fetch(`${API_BASE}/stops/nearby?lat=${lat}&lon=${lon}&radius=${radius}`);
                    const retryData = await retryResponse.json();
                    console.log('After cache build, found stops:', retryData.count);
                    return retryData.stops || [];
                } else {
                    setError('Failed to build stop cache. Please try again.');
                    return [];
                }
            }
            
            if (data.error) {
                console.error('API returned error:', data.error);
                setError(data.error);
                return [];
            }
            
            const stops = data.stops || [];
            console.log(`Found ${stops.length} stops near (${lat}, ${lon})`);
            return stops;
        } catch (err) {
            console.error('Error finding stops:', err);
            setError('Failed to find nearby stops: ' + err.message);
            return [];
        }
    };

    const getMLPrediction = async (route, stopId) => {
        try {
            // First get API prediction
            const apiResponse = await fetch(`${API_BASE}/predictions?rt=${route}&stpid=${stopId}`);
            const apiData = await apiResponse.json();
            const predictions = apiData['bustime-response']?.prd || [];
            
            if (predictions.length === 0) return null;
            
            const apiPred = parseInt(predictions[0].prdctdn) || 0;
            
            // Get ML-enhanced prediction
            const mlResponse = await fetch(`${API_BASE}/predict/enhanced`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    route,
                    stop_id: stopId,
                    api_prediction: apiPred
                })
            });
            
            if (mlResponse.ok) {
                const mlData = await mlResponse.json();
                return {
                    api_prediction: apiPred,
                    ml_prediction: mlData.predicted_minutes || apiPred,
                    confidence: mlData.confidence || 0.8,
                    improvement: mlData.improvement_percent || 0
                };
            }
            return { api_prediction: apiPred, ml_prediction: apiPred, confidence: 0.5 };
        } catch (err) {
            console.error('ML prediction error:', err);
            return null;
        }
    };

    const planRoute = async () => {
        if (!origin.lat || !destination.lat) {
            setError('Please set both origin and destination');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // Find nearby stops
            const originStops = await findNearbyStops(origin.lat, origin.lon);
            const destStops = await findNearbyStops(destination.lat, destination.lon);

            if (originStops.length === 0 || destStops.length === 0) {
                setError(`Could not find nearby bus stops. Found ${originStops.length} stops near origin and ${destStops.length} near destination. Try a different location or increase the search radius.`);
                setLoading(false);
                return;
            }

            // Get all routes serving these stops
            const allRoutes = new Set();
            originStops.forEach(s => {
                if (s.routes) s.routes.forEach(r => allRoutes.add(r));
            });
            destStops.forEach(s => {
                if (s.routes) s.routes.forEach(r => allRoutes.add(r));
            });

            // Find routes that serve BOTH origin and destination
            const commonRoutes = Array.from(allRoutes).filter(route => {
                const hasOrigin = originStops.some(s => s.routes && s.routes.includes(route));
                const hasDest = destStops.some(s => s.routes && s.routes.includes(route));
                return hasOrigin && hasDest;
            });

            if (commonRoutes.length === 0) {
                setError(`No routes found that serve both locations. Found ${originStops.length} stops near origin and ${destStops.length} near destination, but no routes connect them. Try different locations.`);
                setLoading(false);
                return;
            }

            // For each route that serves both stops, get ML predictions
            const routeOptions = [];
            for (const route of commonRoutes.slice(0, 10)) {
                // Find stops that serve this route for both origin and destination
                const originStop = originStops.find(s => s.routes && s.routes.includes(route));
                const destStop = destStops.find(s => s.routes && s.routes.includes(route));

                // Skip if we don't have a stop for this route at both locations
                if (!originStop || !destStop) continue;
                
                // Make sure we're going in the right direction (destination should be after origin)
                // For now, just check if we have predictions for both

                try {
                    const originPred = await getMLPrediction(route, originStop.stpid);
                    const destPred = await getMLPrediction(route, destStop.stpid);

                    if (originPred && destPred) {
                        // Calculate travel time (time from origin to destination)
                        // If destination prediction is less than origin, they might be going wrong direction
                        // Just use the difference, but ensure it's positive
                        const travelTime = Math.max(0, destPred.ml_prediction - originPred.ml_prediction);
                        const totalTime = originPred.ml_prediction + travelTime;
                        const reliability = (originPred.confidence + destPred.confidence) / 2;
                        
                        routeOptions.push({
                            route,
                            originStop: originStop.stpnm || `Stop ${originStop.stpid}`,
                            destStop: destStop.stpnm || `Stop ${destStop.stpid}`,
                            originStopId: originStop.stpid,
                            destStopId: destStop.stpid,
                            waitTime: originPred.ml_prediction,
                            travelTime: travelTime,
                            totalTime,
                            reliability,
                            mlImprovement: (originPred.improvement + destPred.improvement) / 2,
                            apiWait: originPred.api_prediction,
                            mlWait: originPred.ml_prediction
                        });
                    }
                } catch (predErr) {
                    console.warn(`Failed to get predictions for route ${route}:`, predErr);
                    // Continue to next route
                }
            }

            // Sort by total time and reliability
            routeOptions.sort((a, b) => {
                const scoreA = a.totalTime - (a.reliability * 5); // Prefer reliable routes
                const scoreB = b.totalTime - (b.reliability * 5);
                return scoreA - scoreB;
            });

            setRoutes(routeOptions);
            setStops([...originStops, ...destStops]);
            
            // Store stop coordinates for walking distance calculations
            const allStopsMap = new Map();
            [...originStops, ...destStops].forEach(stop => {
                allStopsMap.set(stop.stpid, stop);
            });
            setStopsMap(allStopsMap);
        } catch (err) {
            setError('Failed to plan route: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="route-planner">
            <div className="planner-header">
                <h2>ML-Powered Route Planner</h2>
                <p>Uses our machine learning model to find the fastest, most reliable routes</p>
            </div>

            <div className="planner-controls">
                <div className="location-input">
                    <label>
                        <MapPin size={20} />
                        Origin
                    </label>
                    <div className="location-row">
                        <div className="address-input-wrapper">
                            <Search size={18} className="search-icon" />
                            <input
                                ref={originInputRef}
                                type="text"
                                placeholder="Search address in Madison, WI..."
                                value={origin.name === 'Your Location' ? 'Your Location' : origin.name}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    setOrigin({ ...origin, name: value });
                                    if (value !== 'Your Location') {
                                        handleOriginSearch(value);
                                    }
                                }}
                                onFocus={() => {
                                    if (originSuggestions.length > 0 || originSearching) {
                                        setShowOriginSuggestions(true);
                                    }
                                }}
                                onBlur={() => {
                                    setTimeout(() => setShowOriginSuggestions(false), 200);
                                }}
                            />
                            {(showOriginSuggestions && originSuggestions.length > 0) && (
                                <div className="suggestions-dropdown" onMouseDown={(e) => e.preventDefault()}>
                                    {originSuggestions.map((suggestion, idx) => (
                                        <div
                                            key={idx}
                                            className="suggestion-item"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                selectOrigin(suggestion);
                                            }}
                                        >
                                            <MapPin size={16} className="suggestion-icon" />
                                            <div className="suggestion-text">{suggestion.display}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {originSearching && (
                                <div className="suggestions-dropdown">
                                    <div className="suggestion-item searching">
                                        <div className="suggestion-text">Searching...</div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <button
                            className="use-location-btn"
                            onClick={() => setUseCurrentLocation(!useCurrentLocation)}
                        >
                            <span style={{ fontSize: '1rem' }}>📍</span>
                            {useCurrentLocation ? 'Using GPS' : 'Use My Location'}
                        </button>
                    </div>
                    {origin.lat && (
                        <div className="coords">
                            {origin.lat.toFixed(4)}, {origin.lon.toFixed(4)}
                        </div>
                    )}
                </div>

                <div className="location-input">
                    <label>
                        <MapPin size={20} />
                        Destination
                    </label>
                    <div className="address-input-wrapper">
                        <Search size={18} className="search-icon" />
                        <input
                            ref={destinationInputRef}
                            type="text"
                            placeholder="Search address in Madison, WI..."
                            value={destination.name}
                            onChange={(e) => {
                                const value = e.target.value;
                                setDestination({ ...destination, name: value });
                                handleDestinationSearch(value);
                            }}
                            onFocus={() => {
                                if (destinationSuggestions.length > 0 || destinationSearching) {
                                    setShowDestinationSuggestions(true);
                                }
                            }}
                            onBlur={() => {
                                setTimeout(() => setShowDestinationSuggestions(false), 200);
                            }}
                        />
                            {(showDestinationSuggestions && destinationSuggestions.length > 0) && (
                                <div className="suggestions-dropdown" onMouseDown={(e) => e.preventDefault()}>
                                    {destinationSuggestions.map((suggestion, idx) => (
                                        <div
                                            key={idx}
                                            className="suggestion-item"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                selectDestination(suggestion);
                                            }}
                                        >
                                            <MapPin size={16} className="suggestion-icon" />
                                            <div className="suggestion-text">{suggestion.display}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {destinationSearching && (
                                <div className="suggestions-dropdown">
                                    <div className="suggestion-item searching">
                                        <div className="suggestion-text">Searching...</div>
                                    </div>
                                </div>
                            )}
                    </div>
                    {destination.lat && (
                        <div className="coords">
                            {destination.lat.toFixed(4)}, {destination.lon.toFixed(4)}
                        </div>
                    )}
                </div>

                <button
                    className="plan-route-btn"
                    onClick={planRoute}
                    disabled={loading || !origin.lat || !destination.lat}
                >
                    {loading ? 'Planning...' : 'Find Best Route (ML-Powered)'}
                </button>
            </div>

            {error && (
                <div className="error-message">
                    <AlertCircle size={20} />
                    {error}
                </div>
            )}

            <div className="planner-map">
                <MapContainer
                    center={[43.0731, -89.4012]}
                    zoom={13}
                    style={{ height: '400px', width: '100%' }}
                    onClick={(e) => {
                        if (!origin.lat) {
                            setOrigin({ lat: e.latlng.lat, lon: e.latlng.lng, name: '' });
                        } else if (!destination.lat) {
                            setDestination({ lat: e.latlng.lat, lon: e.latlng.lng, name: '' });
                        }
                    }}
                >
                    <TileLayer
                        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                        attribution='&copy; OpenStreetMap'
                    />
                    {origin.lat && (
                        <Marker position={[origin.lat, origin.lon]}>
                            <Popup>Origin: {origin.name || 'Your location'}</Popup>
                        </Marker>
                    )}
                    {destination.lat && (
                        <Marker position={[destination.lat, destination.lon]}>
                            <Popup>Destination: {destination.name || 'Destination'}</Popup>
                        </Marker>
                    )}
                    {stops.map((stop, idx) => (
                        <Marker key={idx} position={[stop.lat, stop.lon]}>
                            <Popup>{stop.stpnm || `Stop ${stop.stpid}`}</Popup>
                        </Marker>
                    ))}
                </MapContainer>
            </div>

            {routes.length > 0 && (
                <div className="route-results">
                    <h3>Recommended Routes (Ranked by ML Predictions)</h3>
                    <div className="routes-list">
                        {routes.map((route, idx) => (
                            <RouteOption 
                                key={idx} 
                                route={route} 
                                isBest={idx === 0}
                                origin={origin}
                                destination={destination}
                                stopsMap={stopsMap}
                            />
                        ))}
                    </div>
                </div>
            )}

            <div className="disclaimer">
                <AlertCircle size={20} />
                <div>
                    <strong>⚠️ College Student Disclaimer:</strong> This was built by a student who's probably 
                    procrastinating on actual homework. The ML model is trained on limited data and might be 
                    hilariously wrong. Don't trust machines blindly—always check the actual bus schedule! 
                    If you miss your bus because of this, blame the algorithm, not me. 🚌💀
                </div>
            </div>
        </div>
    );
}

// Route Option Component with Google Maps-like directions
function RouteOption({ route, isBest, origin, destination, stopsMap }) {
    const [expanded, setExpanded] = useState(isBest); // Auto-expand best route
    const [walkingDistance, setWalkingDistance] = useState({ origin: null, dest: null });
    
    useEffect(() => {
        // Calculate walking distances using actual stop coordinates
        if (expanded && origin.lat && destination.lat) {
            // Haversine formula for distance calculation
            const calcDistance = (lat1, lon1, lat2, lon2) => {
                const R = 3959; // Earth radius in miles
                const dLat = (lat2 - lat1) * Math.PI / 180;
                const dLon = (lon2 - lon1) * Math.PI / 180;
                const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                    Math.sin(dLon/2) * Math.sin(dLon/2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                return R * c;
            };
            
            // Get actual stop coordinates
            const originStop = stopsMap.get(route.originStopId);
            const destStop = stopsMap.get(route.destStopId);
            
            if (originStop && originStop.lat && originStop.lon) {
                const originDist = calcDistance(origin.lat, origin.lon, originStop.lat, originStop.lon);
                setWalkingDistance(prev => ({ ...prev, origin: originDist }));
            }
            
            if (destStop && destStop.lat && destStop.lon) {
                const destDist = calcDistance(destination.lat, destination.lon, destStop.lat, destStop.lon);
                setWalkingDistance(prev => ({ ...prev, dest: destDist }));
            }
        }
    }, [expanded, origin, destination, route.originStopId, route.destStopId, stopsMap]);
    
    const walkingTime = (distance) => {
        // Average walking speed: 3 mph = 0.05 miles/min
        return Math.ceil(distance / 0.05);
    };
    
    return (
        <div className={`route-option ${isBest ? 'best' : ''}`}>
            <div className="route-header">
                <div className="route-number">Route {route.route}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {isBest && <span className="best-badge">Best Option</span>}
                    <button 
                        className="expand-btn"
                        onClick={() => setExpanded(!expanded)}
                    >
                        <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{expanded ? '▲' : '▼'}</span>
                    </button>
                </div>
            </div>
            
            <div className="route-summary">
                <div className="route-timing-summary">
                    <Clock size={16} />
                    <span><strong>~{route.totalTime.toFixed(0)} min</strong> total</span>
                    <span className="timing-breakdown">
                        ({route.mlWait.toFixed(0)} min wait + ~{route.travelTime.toFixed(0)} min travel)
                    </span>
                </div>
                <div className="route-reliability-summary">
                    <TrendingUp size={16} />
                    <span>{(route.reliability * 100).toFixed(0)}% reliable</span>
                </div>
            </div>
            
            {expanded && (
                <div className="route-directions">
                    <h4>Step-by-Step Directions</h4>
                    
                    <div className="direction-step">
                        <div className="step-icon walking">
                            <span style={{ fontSize: '1.2rem' }}>🚶</span>
                        </div>
                        <div className="step-content">
                            <div className="step-title">Walk to bus stop</div>
                            <div className="step-detail">{route.originStop}</div>
                            <div className="step-time">
                                {walkingDistance.origin ? `~${walkingTime(walkingDistance.origin)} min walk` : '~2-5 min walk'}
                            </div>
                        </div>
                    </div>
                    
                    <div className="direction-step">
                        <div className="step-icon bus">
                            <Bus size={20} />
                        </div>
                        <div className="step-content">
                            <div className="step-title">Take Route {route.route}</div>
                            <div className="step-detail">From {route.originStop} to {route.destStop}</div>
                            <div className="step-time">
                                Wait: {route.mlWait.toFixed(0)} min | Travel: ~{route.travelTime.toFixed(0)} min
                            </div>
                            {route.mlImprovement > 0 && (
                                <div className="ml-note">
                                    ML prediction: {route.mlWait.toFixed(0)} min (vs API: {route.apiWait.toFixed(0)} min)
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <div className="direction-step">
                        <div className="step-icon walking">
                            <span style={{ fontSize: '1.2rem' }}>🚶</span>
                        </div>
                        <div className="step-content">
                            <div className="step-title">Walk to destination</div>
                            <div className="step-detail">{destination.name || 'Your destination'}</div>
                            <div className="step-time">
                                {walkingDistance.dest ? `~${walkingTime(walkingDistance.dest)} min walk` : '~2-5 min walk'}
                            </div>
                        </div>
                    </div>
                    
                    <div className="route-stops-detail">
                        <div className="stop-detail">
                            <strong>Origin Stop:</strong> {route.originStop} (ID: {route.originStopId})
                        </div>
                        <div className="stop-detail">
                            <strong>Destination Stop:</strong> {route.destStop} (ID: {route.destStopId})
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default RoutePlanner;

