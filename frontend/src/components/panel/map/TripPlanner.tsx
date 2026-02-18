import { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import ConfidenceBand from '../../shared/ConfidenceBand';
import type { TripPlan } from '../../MapView';

interface TripPlannerProps {
  userLocation: [number, number] | null;
  onBack: () => void;
  onTripSelect: (plan: TripPlan) => void;
  onUserLocation: (lat: number, lon: number) => void;
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
  mlEta?: { low: number; median: number; high: number };
}

interface Destination {
  lat: number;
  lon: number;
  name: string;
}

export default function TripPlanner({ userLocation, onBack, onTripSelect, onUserLocation, activePlan }: TripPlannerProps) {
  const [query, setQuery] = useState('');
  const [stopResults, setStopResults] = useState<StopResult[]>([]);
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [tripOptions, setTripOptions] = useState<TripOption[]>([]);
  const [loadingTrip, setLoadingTrip] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<number | null>(null);
  const tripRequestId = useRef(0);
  const showDropdown = stopResults.length > 0 || placeResults.length > 0;

  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    if (userLocation) return;
    let cancelled = false;
    setLocating(true);
    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        onUserLocation(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
      },
      () => {
        if (cancelled) return;
        setError('Could not get your location. Enable location access to plan trips.');
        setLocating(false);
      },
      { timeout: 10000, maximumAge: 30000 }
    );
    return () => { cancelled = true; };
  }, [userLocation, onUserLocation]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  // Search both stops and places — keep previous results if new search returns empty
  const searchAll = useCallback(async (q: string) => {
    if (q.length < 2) { setStopResults([]); setPlaceResults([]); return; }
    setSearching(true);

    const stopsProm = axios
      .get(`${API_BASE}/api/stops/search`, { params: { q, limit: 5 } })
      .then(res => res.data.stops || [])
      .catch(() => []);

    // Search Nominatim with multiple strategies for better partial matching
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
          }).catch(() => ({ data: [] })),
          axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
              q: `${q}`,
              format: 'json',
              limit: 3,
              viewbox: '-89.6,43.2,-89.1,42.95',
              bounded: 1,
            },
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
      : Promise.resolve([]);

    const [stops, places] = await Promise.all([stopsProm, placesProm]);
    // Only replace results if new search found something — prevents
    // partial-word queries from clearing good results
    if (stops.length > 0 || places.length > 0) {
      setStopResults(stops);
      setPlaceResults(places);
    }
    setSearching(false);
  }, [API_BASE]);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setDestination(null);
    setTripOptions([]);
    setError(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => searchAll(val), 400);
  };

  const planTrip = async (dest: Destination) => {
    if (!userLocation) { setError('Location not available'); return; }
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
    <div className="fade-in" style={{ padding: '14px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Where to?</div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
            Search any place or bus stop
          </div>
        </div>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '3px 8px',
            fontSize: 11,
          }}
        >
          Back
        </button>
      </div>

      {/* Origin indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: locating ? 'var(--warning)' : userLocation ? 'var(--success)' : 'var(--text-dim)',
          border: '2px solid var(--surface)',
          boxShadow: userLocation ? '0 0 6px rgba(16,185,129,0.5)' : 'none',
          flexShrink: 0,
        }} />
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {locating ? 'Getting your location...' : userLocation ? 'Your location' : 'Location unavailable'}
        </div>
      </div>

      <div style={{ width: 1, height: 16, background: 'var(--border-bright)', marginLeft: 4.5, marginBottom: 8 }} />

      {/* Destination search */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <div style={{ position: 'absolute', left: 12, top: 12, color: 'var(--signal)', fontSize: 14, pointerEvents: 'none' }}>
          &#9679;
        </div>
        <input
          type="text"
          className="trip-search-input"
          placeholder="Search stops, restaurants, places..."
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          autoFocus
        />

        {/* Combined search results dropdown */}
        {showDropdown && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'var(--surface)',
            border: '1px solid var(--border-bright)',
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
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {stop.stpnm}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {stop.routes.slice(0, 5).map(rt => (
                          <span key={rt} className="data-num" style={{
                            fontSize: 9, background: 'var(--signal-dim)', color: 'var(--signal)',
                            borderRadius: 3, padding: '1px 4px',
                          }}>
                            {rt}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, marginLeft: 8, flexShrink: 0 }}>&#128655;</span>
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
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {place.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {place.fullName}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, marginLeft: 8, flexShrink: 0 }}>&#128205;</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {searching && (
        <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-secondary)', fontSize: 12 }}>
          Searching...
        </div>
      )}

      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 8,
          padding: '10px 12px',
          fontSize: 12,
          color: '#fca5a5',
          lineHeight: 1.5,
          marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      {loadingTrip && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)', fontSize: 12 }}>
          <div className="live-dot" style={{
            width: 10, height: 10, borderRadius: '50%',
            background: 'var(--signal)', margin: '0 auto 12px',
          }} />
          Finding routes...
        </div>
      )}

      {/* Trip options */}
      {tripOptions.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
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
                    padding: '14px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--border-bright)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--border)'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="data-num" style={{
                        fontSize: 16, fontWeight: 700,
                        color: isActive ? 'var(--signal)' : 'var(--text-primary)',
                      }}>
                        {opt.routeId}
                      </span>
                      {opt.routeName && (
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{opt.routeName}</span>
                      )}
                    </div>
                    {opt.totalMin != null && (
                      <span className="data-num" style={{
                        fontSize: 13, fontWeight: 600,
                        color: isActive ? 'var(--signal)' : 'var(--text-primary)',
                      }}>
                        ~{Math.round(opt.totalMin)} min
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 20, textAlign: 'center', fontSize: 12 }}>&#128694;</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {walkTimeStr(opt.walkToMin)} to <span style={{ color: 'var(--text-primary)' }}>{opt.originStop.stpnm}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 20, textAlign: 'center', fontSize: 12 }}>&#128652;</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        Ride Route {opt.routeId}
                        {opt.nextBusMin != null && (
                          <span style={{ color: 'var(--signal)', fontWeight: 600 }}>
                            {' '}&middot; next bus in {opt.nextBusMin}m
                          </span>
                        )}
                      </div>
                    </div>

                    {opt.mlEta && (
                      <div style={{ marginLeft: 28, marginTop: 2 }}>
                        <ConfidenceBand low={opt.mlEta.low} median={opt.mlEta.median} high={opt.mlEta.high} />
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 20, textAlign: 'center', fontSize: 12 }}>&#128694;</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {walkTimeStr(opt.walkFromMin)} to <span style={{ color: 'var(--signal)' }}>{destination?.name || 'destination'}</span>
                      </div>
                    </div>
                  </div>

                  {isActive && (
                    <div style={{
                      marginTop: 10, textAlign: 'center', fontSize: 10,
                      color: 'var(--signal)', fontWeight: 600, letterSpacing: '0.08em',
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

      {!destination && !loadingTrip && !error && !showDropdown && query.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '32px 16px',
          color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.6,
        }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>&#128205;</div>
          Search for a restaurant, building, address, or bus stop — we'll find the best bus route there.
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
};
