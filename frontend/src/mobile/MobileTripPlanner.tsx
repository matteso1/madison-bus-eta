import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import type { TripPlan } from '../components/MapView';

const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

interface MobileTripPlannerProps {
  userLocation: [number, number] | null;  // [lon, lat]
  onTripSelect: (plan: TripPlan) => void;
  onClose: () => void;
  activePlan: TripPlan | null;
}

interface StopResult {
  stpid: string;
  stpnm: string;
  lat: number;
  lon: number;
  routes: string[];
}

interface PlaceResult {
  name: string;
  fullName: string;
  lat: number;
  lon: number;
  type: string;
}

interface TripOption {
  routeId: string;
  routeName?: string;
  originStop: StopResult;
  destStop: StopResult;
  walkToMin: number;
  busTimeMin: number | null;
  walkFromMin: number;
  totalMin: number | null;
  nextBusMin: number | null;
}

interface Destination {
  lat: number;
  lon: number;
  name: string;
}

export default function MobileTripPlanner({ userLocation, onTripSelect, onClose, activePlan }: MobileTripPlannerProps) {
  const [query, setQuery] = useState('');
  const [stopResults, setStopResults] = useState<StopResult[]>([]);
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [tripOptions, setTripOptions] = useState<TripOption[]>([]);
  const [loadingTrip, setLoadingTrip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<number | null>(null);
  const tripRequestId = useRef(0);
  const showDropdown = stopResults.length > 0 || placeResults.length > 0;

  // Cleanup search timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  // Search both stops and places in parallel
  const searchAll = useCallback(async (q: string) => {
    if (q.length < 2) {
      setStopResults([]);
      setPlaceResults([]);
      return;
    }
    setSearching(true);

    const stopsProm = axios
      .get(`${API_BASE}/api/stops/search`, { params: { q, limit: 5 } })
      .then(res => (res.data.stops || []) as StopResult[])
      .catch(() => [] as StopResult[]);

    // Search Nominatim with two strategies for better partial matching
    const placesProm = q.length >= 3
      ? Promise.all([
          axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
              q: `${q}, Madison, WI`,
              format: 'json',
              limit: 5,
              viewbox: '-89.6,43.2,-89.1,42.95',
              bounded: 1,
            },
            headers: { 'User-Agent': 'MadisonBusETA/1.0' },
          }).catch(() => ({ data: [] })),
          axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
              q: `${q}`,
              format: 'json',
              limit: 3,
              viewbox: '-89.6,43.2,-89.1,42.95',
              bounded: 1,
            },
            headers: { 'User-Agent': 'MadisonBusETA/1.0' },
          }).catch(() => ({ data: [] })),
        ]).then(([r1, r2]) => {
          const seen = new Set<string>();
          const combined: PlaceResult[] = [];
          for (const r of [...(r1.data || []), ...(r2.data || [])]) {
            const key = `${parseFloat(r.lat).toFixed(4)},${parseFloat(r.lon).toFixed(4)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            combined.push({
              name: r.display_name.split(',')[0].trim(),
              fullName: r.display_name.split(',').slice(0, 3).join(',').trim(),
              lat: parseFloat(r.lat),
              lon: parseFloat(r.lon),
              type: r.type || r.class || '',
            });
          }
          return combined.slice(0, 5);
        })
      : Promise.resolve([] as PlaceResult[]);

    const [stops, places] = await Promise.all([stopsProm, placesProm]);
    // Only replace results if new search found something
    if (stops.length > 0 || places.length > 0) {
      setStopResults(stops);
      setPlaceResults(places);
    }
    setSearching(false);
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setDestination(null);
    setTripOptions([]);
    setError(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => searchAll(val), 400);
  };

  const handleClear = () => {
    setQuery('');
    setStopResults([]);
    setPlaceResults([]);
    setTripOptions([]);
    setDestination(null);
    setError(null);
    onClose();
  };

  const planTrip = async (dest: Destination) => {
    if (!userLocation) {
      setError('Location not available');
      return;
    }
    const requestId = ++tripRequestId.current;
    setLoadingTrip(true);
    setTripOptions([]);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/trip-plan`, {
        params: { olat: userLocation[1], olon: userLocation[0], dlat: dest.lat, dlon: dest.lon },
      });
      if (requestId !== tripRequestId.current) return;
      const options: TripOption[] = (res.data.options || []).slice(0, 5);
      setTripOptions(options);
      if (options.length === 0) {
        setError('No direct bus routes found. Try a destination closer to a bus route, or try a different search.');
      }
    } catch {
      if (requestId !== tripRequestId.current) return;
      setError('Could not plan trip. Try again.');
    } finally {
      if (requestId === tripRequestId.current) setLoadingTrip(false);
    }
  };

  const handleSelectStop = (stop: StopResult) => {
    const dest = { lat: stop.lat, lon: stop.lon, name: stop.stpnm };
    setQuery(stop.stpnm);
    setStopResults([]);
    setPlaceResults([]);
    setDestination(dest);
    planTrip(dest);
  };

  const handleSelectPlace = (place: PlaceResult) => {
    const dest = { lat: place.lat, lon: place.lon, name: place.name };
    setQuery(place.name);
    setStopResults([]);
    setPlaceResults([]);
    setDestination(dest);
    planTrip(dest);
  };

  const handleSelectTrip = (opt: TripOption) => {
    if (!destination) return;
    onTripSelect({
      routeId: opt.routeId,
      originStop: opt.originStop,
      destStop: opt.destStop,
      finalDestination: destination,
      walkToMin: opt.walkToMin,
      walkFromMin: opt.walkFromMin,
    });
  };

  const walkTimeStr = (min: number) => min < 1 ? '<1 min walk' : `${Math.round(min)} min walk`;

  return (
    <div style={{ fontFamily: 'var(--font-ui)' }}>
      {/* Header */}
      <div style={{
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: 12,
      }}>
        Where to?
      </div>

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <input
          type="text"
          placeholder="Search stops, restaurants, places..."
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          autoFocus
          style={{
            width: '100%',
            height: 44,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '0 40px 0 14px',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-ui)',
            fontSize: 14,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {query.length > 0 && (
          <button
            onClick={handleClear}
            aria-label="Clear search"
            style={{
              position: 'absolute',
              right: 4,
              top: 2,
              width: 40,
              height: 40,
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 18,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            x
          </button>
        )}

        {/* Search results dropdown */}
        {showDropdown && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
            zIndex: 20,
            maxHeight: 300,
            overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }} className="panel-scroll">
            {/* Stops section */}
            {stopResults.length > 0 && (
              <>
                <div style={{
                  padding: '6px 14px',
                  fontSize: 9,
                  fontFamily: 'var(--font-data)',
                  color: 'var(--text-dim)',
                  letterSpacing: '0.1em',
                  background: 'var(--surface-2)',
                  borderBottom: '1px solid var(--border)',
                }}>
                  BUS STOPS
                </div>
                {stopResults.map(stop => (
                  <button
                    key={`stop-${stop.stpid}`}
                    onClick={() => handleSelectStop(stop)}
                    style={dropdownItemStyle}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        marginBottom: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {stop.stpnm}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {stop.routes.slice(0, 5).map(rt => (
                          <span key={rt} className="data-num" style={{
                            fontSize: 9,
                            background: 'var(--signal-dim)',
                            color: 'var(--signal)',
                            borderRadius: 3,
                            padding: '1px 4px',
                          }}>
                            {rt}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </>
            )}

            {/* Places section */}
            {placeResults.length > 0 && (
              <>
                <div style={{
                  padding: '6px 14px',
                  fontSize: 9,
                  fontFamily: 'var(--font-data)',
                  color: 'var(--text-dim)',
                  letterSpacing: '0.1em',
                  background: 'var(--surface-2)',
                  borderBottom: '1px solid var(--border)',
                }}>
                  PLACES
                </div>
                {placeResults.map((place, i) => (
                  <button
                    key={`place-${i}`}
                    onClick={() => handleSelectPlace(place)}
                    style={dropdownItemStyle}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        marginBottom: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {place.name}
                      </div>
                      <div style={{
                        fontSize: 10,
                        color: 'var(--text-dim)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {place.fullName}
                      </div>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Searching indicator */}
      {searching && (
        <div style={{
          textAlign: 'center',
          padding: '16px 0',
          color: 'var(--text-secondary)',
          fontSize: 12,
        }}>
          Searching...
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 10,
          padding: '10px 12px',
          fontSize: 12,
          color: '#fca5a5',
          lineHeight: 1.5,
          marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      {/* Loading trip indicator */}
      {loadingTrip && (
        <div style={{
          textAlign: 'center',
          padding: '24px 0',
          color: 'var(--text-secondary)',
          fontSize: 12,
        }}>
          <div className="live-dot" style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: 'var(--signal)',
            margin: '0 auto 12px',
          }} />
          Finding routes...
        </div>
      )}

      {/* Trip options */}
      {tripOptions.length > 0 && (
        <div>
          <div style={{
            fontSize: 10,
            color: 'var(--text-secondary)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-data)',
            marginBottom: 10,
          }}>
            Route Options
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tripOptions.map((opt, idx) => {
              const isActive = activePlan?.routeId === opt.routeId &&
                activePlan?.originStop.stpid === opt.originStop.stpid;
              return (
                <button
                  key={idx}
                  onClick={() => handleSelectTrip(opt)}
                  style={{
                    width: '100%',
                    background: isActive ? 'rgba(0,212,255,0.08)' : 'var(--surface-2)',
                    border: `1px solid ${isActive ? 'rgba(0,212,255,0.4)' : 'var(--border)'}`,
                    borderRadius: 10,
                    padding: 14,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                    minHeight: 44,
                  }}
                >
                  {/* Route header */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 10,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="data-num" style={{
                        background: 'var(--signal-dim)',
                        color: isActive ? 'var(--signal)' : 'var(--signal)',
                        fontWeight: 700,
                        fontSize: 14,
                        padding: '4px 8px',
                        borderRadius: 6,
                      }}>
                        {opt.routeId}
                      </span>
                      {opt.routeName && (
                        <span style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                        }}>
                          {opt.routeName}
                        </span>
                      )}
                    </div>
                    {opt.totalMin != null && (
                      <span className="data-num" style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: isActive ? 'var(--signal)' : 'var(--text-primary)',
                      }}>
                        ~{Math.round(opt.totalMin)} min
                      </span>
                    )}
                  </div>

                  {/* Trip steps */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Walk to stop */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <circle cx="12" cy="5" r="2" />
                        <path d="M10 22V18L7 15V11l3-3 3 3v4l-3 3v4" />
                      </svg>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {walkTimeStr(opt.walkToMin)} to <span style={{ color: 'var(--text-primary)' }}>{opt.originStop.stpnm}</span>
                      </div>
                    </div>

                    {/* Ride bus */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <rect x="3" y="3" width="18" height="14" rx="2" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                        <circle cx="7" cy="21" r="1" />
                        <circle cx="17" cy="21" r="1" />
                      </svg>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Ride Route {opt.routeId}
                        {opt.nextBusMin != null && (
                          <span style={{ color: 'var(--signal)', fontWeight: 600 }}>
                            {' '}&middot; next bus in {opt.nextBusMin}m
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Next bus countdown */}
                    {opt.nextBusMin != null && (
                      <div style={{
                        marginLeft: 24,
                        marginTop: 2,
                        fontSize: 13,
                        fontWeight: 600,
                        fontFamily: 'var(--font-data)',
                        color: opt.nextBusMin <= 1 ? 'var(--signal)' : 'var(--text-primary)',
                      }}>
                        {opt.nextBusMin <= 0 ? 'Bus arriving now' : `Bus in ${opt.nextBusMin} min`}
                      </div>
                    )}

                    {/* Walk from stop (only if >1 min) */}
                    {opt.walkFromMin > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <circle cx="12" cy="5" r="2" />
                          <path d="M10 22V18L7 15V11l3-3 3 3v4l-3 3v4" />
                        </svg>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {walkTimeStr(opt.walkFromMin)} to <span style={{ color: 'var(--signal)' }}>{destination?.name || 'destination'}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Active plan label */}
                  {isActive && (
                    <div style={{
                      marginTop: 10,
                      textAlign: 'center',
                      fontSize: 10,
                      fontFamily: 'var(--font-data)',
                      color: 'var(--signal)',
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                    }}>
                      VIEWING ON MAP
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!destination && !loadingTrip && !error && !showDropdown && query.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '32px 16px',
          color: 'var(--text-dim)',
          fontSize: 12,
          lineHeight: 1.6,
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 12px', display: 'block' }}>
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          Search for a restaurant, building, address, or bus stop -- we'll find the best bus route there.
        </div>
      )}
    </div>
  );
}

const dropdownItemStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--border)',
  padding: '10px 14px',
  cursor: 'pointer',
  textAlign: 'left',
  display: 'flex',
  alignItems: 'center',
  transition: 'background 0.1s',
  minHeight: 44,
};
