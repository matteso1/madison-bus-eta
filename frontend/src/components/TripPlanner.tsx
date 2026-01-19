import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
    MapPin, Navigation, Search, X, Clock,
    Footprints, Bus, AlertTriangle, Star, Loader2,
    ChevronRight, ArrowRight
} from 'lucide-react';

interface Stop {
    stpid: string;
    stpnm: string;
    lat: number;
    lon: number;
    routes?: string[];
}

interface TripOption {
    route: string;
    destination: string;
    departure_stop: string;
    departure_stop_id: string;
    walk_time_min: number;
    walk_distance_mi: number;
    api_eta_min: number;
    ml_eta_min: number;
    ml_eta_low: number;
    ml_eta_high: number;
    total_time_min: number;
    vehicle_id: string;
    delayed: boolean;
    fastest?: boolean;
}

interface TripPlannerProps {
    onSelectTrip?: (trip: TripOption) => void;
    onClose?: () => void;
}

const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

export default function TripPlanner({ onSelectTrip, onClose }: TripPlannerProps) {
    const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
    const [locationLoading, setLocationLoading] = useState(false);
    const [locationError, setLocationError] = useState<string | null>(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Stop[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [selectedDestination, setSelectedDestination] = useState<Stop | null>(null);

    const [tripOptions, setTripOptions] = useState<TripOption[]>([]);
    const [planningTrip, setPlanningTrip] = useState(false);
    const [tripError, setTripError] = useState<string | null>(null);

    // Get user location
    const getUserLocation = useCallback(() => {
        setLocationLoading(true);
        setLocationError(null);

        if (!navigator.geolocation) {
            setLocationError('Geolocation not supported');
            setLocationLoading(false);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                setUserLocation({
                    lat: position.coords.latitude,
                    lon: position.coords.longitude
                });
                setLocationLoading(false);
            },
            (error) => {
                setLocationError(error.message);
                setLocationLoading(false);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }, []);

    // Auto-get location on mount
    useEffect(() => {
        getUserLocation();
    }, [getUserLocation]);

    // Search stops debounced
    useEffect(() => {
        if (searchQuery.length < 2) {
            setSearchResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setSearchLoading(true);
            try {
                const res = await axios.get(`${API_BASE}/api/search-stops?q=${encodeURIComponent(searchQuery)}&limit=8`);
                setSearchResults(res.data.stops || []);
            } catch (e) {
                console.error('Search error:', e);
                setSearchResults([]);
            } finally {
                setSearchLoading(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Plan trip when destination selected
    useEffect(() => {
        if (!userLocation || !selectedDestination) return;

        const planTrip = async () => {
            setPlanningTrip(true);
            setTripError(null);

            try {
                const res = await axios.post(`${API_BASE}/api/plan-trip`, {
                    from_lat: userLocation.lat,
                    from_lon: userLocation.lon,
                    to_stop_id: selectedDestination.stpid
                });

                if (res.data.options?.length > 0) {
                    setTripOptions(res.data.options);
                } else {
                    setTripError(res.data.error || 'No routes found');
                    setTripOptions([]);
                }
            } catch (e: any) {
                setTripError(e.response?.data?.error || 'Failed to plan trip');
                setTripOptions([]);
            } finally {
                setPlanningTrip(false);
            }
        };

        planTrip();
    }, [userLocation, selectedDestination]);

    const selectStop = (stop: Stop) => {
        setSelectedDestination(stop);
        setSearchQuery(stop.stpnm);
        setSearchResults([]);
    };

    const clearDestination = () => {
        setSelectedDestination(null);
        setSearchQuery('');
        setTripOptions([]);
        setTripError(null);
    };

    return (
        <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700 rounded-2xl p-5 shadow-2xl max-w-md w-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Navigation className="w-5 h-5 text-emerald-400" />
                    Trip Planner
                </h2>
                {onClose && (
                    <button onClick={onClose} className="text-slate-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                )}
            </div>

            {/* Location Section */}
            <div className="mb-4">
                <label className="text-xs text-slate-500 uppercase tracking-wide mb-1 block">Your Location</label>
                <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                    {userLocation ? (
                        <div className="flex items-center gap-2 text-emerald-400">
                            <MapPin className="w-4 h-4" />
                            <span className="text-sm">
                                {userLocation.lat.toFixed(4)}, {userLocation.lon.toFixed(4)}
                            </span>
                            <button
                                onClick={getUserLocation}
                                className="ml-auto text-xs text-slate-400 hover:text-white"
                            >
                                Refresh
                            </button>
                        </div>
                    ) : locationLoading ? (
                        <div className="flex items-center gap-2 text-slate-400">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-sm">Getting location...</span>
                        </div>
                    ) : (
                        <div>
                            {locationError && (
                                <p className="text-xs text-red-400 mb-2">{locationError}</p>
                            )}
                            <button
                                onClick={getUserLocation}
                                className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300"
                            >
                                <MapPin className="w-4 h-4" />
                                Enable location
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Destination Search */}
            <div className="mb-4">
                <label className="text-xs text-slate-500 uppercase tracking-wide mb-1 block">Where to?</label>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search stops..."
                        className="w-full bg-slate-800/50 border border-slate-700/50 rounded-xl pl-10 pr-10 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                    {searchQuery && (
                        <button
                            onClick={clearDestination}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}

                    {/* Search Results Dropdown */}
                    {searchResults.length > 0 && !selectedDestination && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden z-10 shadow-xl">
                            {searchResults.map((stop) => (
                                <button
                                    key={stop.stpid}
                                    onClick={() => selectStop(stop)}
                                    className="w-full px-4 py-3 text-left hover:bg-slate-700/50 transition-colors flex items-center gap-3"
                                >
                                    <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                    <div>
                                        <div className="text-sm text-white">{stop.stpnm}</div>
                                        <div className="text-xs text-slate-500">
                                            {stop.routes?.slice(0, 4).join(', ')}
                                            {stop.routes && stop.routes.length > 4 && ` +${stop.routes.length - 4}`}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {searchLoading && (
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Searching...
                    </p>
                )}
            </div>

            {/* Trip Options */}
            {planningTrip ? (
                <div className="py-8 text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mx-auto mb-2" />
                    <p className="text-slate-400">Finding best routes...</p>
                </div>
            ) : tripError ? (
                <div className="py-6 text-center">
                    <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">{tripError}</p>
                </div>
            ) : tripOptions.length > 0 ? (
                <div className="space-y-2">
                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                        Trip Options • ML-Optimized
                    </p>
                    {tripOptions.map((option, idx) => (
                        <button
                            key={idx}
                            onClick={() => onSelectTrip?.(option)}
                            className={`w-full rounded-xl p-4 text-left transition-all ${option.fastest
                                    ? 'bg-emerald-500/20 border-2 border-emerald-500/50 hover:bg-emerald-500/30'
                                    : 'bg-slate-800/50 border border-slate-700/50 hover:bg-slate-700/50'
                                }`}
                        >
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg font-bold text-white">Route {option.route}</span>
                                    {option.fastest && (
                                        <span className="flex items-center gap-1 text-xs bg-emerald-500/30 text-emerald-300 px-2 py-0.5 rounded-full">
                                            <Star className="w-3 h-3" />
                                            FASTEST
                                        </span>
                                    )}
                                    {option.delayed && (
                                        <span className="text-xs bg-red-500/30 text-red-300 px-2 py-0.5 rounded-full">
                                            DELAYED
                                        </span>
                                    )}
                                </div>
                                <div className="text-right">
                                    <div className="text-2xl font-bold text-emerald-400">
                                        {option.total_time_min}
                                    </div>
                                    <div className="text-xs text-slate-500">min total</div>
                                </div>
                            </div>

                            <div className="text-sm text-slate-400 mb-2">{option.destination}</div>

                            <div className="flex items-center gap-4 text-xs text-slate-500">
                                <span className="flex items-center gap-1">
                                    <Footprints className="w-3 h-3" />
                                    {option.walk_time_min}m walk
                                </span>
                                <ArrowRight className="w-3 h-3" />
                                <span className="flex items-center gap-1">
                                    <Bus className="w-3 h-3" />
                                    {option.ml_eta_low}-{option.ml_eta_high}m wait
                                </span>
                                <span className="ml-auto text-slate-600">
                                    API: {option.api_eta_min}m
                                </span>
                            </div>

                            <div className="mt-2 text-xs text-slate-500">
                                From {option.departure_stop}
                            </div>
                        </button>
                    ))}
                </div>
            ) : selectedDestination ? (
                <div className="py-6 text-center">
                    <Bus className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">No buses found heading there soon</p>
                </div>
            ) : null}
        </div>
    );
}
