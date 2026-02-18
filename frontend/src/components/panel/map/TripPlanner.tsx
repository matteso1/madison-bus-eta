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
  distance_miles?: number;
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

export default function TripPlanner({ userLocation, onBack, onTripSelect, onUserLocation, activePlan }: TripPlannerProps) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StopResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedDest, setSelectedDest] = useState<StopResult | null>(null);
  const [tripOptions, setTripOptions] = useState<TripOption[]>([]);
  const [loadingTrip, setLoadingTrip] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<number | null>(null);

  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  // Request location if not available
  useEffect(() => {
    if (userLocation) return;
    setLocating(true);
    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onUserLocation(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
      },
      () => {
        setError('Could not get your location. Enable location access to plan trips.');
        setLocating(false);
      },
      { timeout: 10000, maximumAge: 30000 }
    );
  }, [userLocation, onUserLocation]);

  const searchStops = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await axios.get(`${API_BASE}/api/stops/search`, { params: { q, limit: 10 } });
      setSearchResults(res.data.stops || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [API_BASE]);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setSelectedDest(null);
    setTripOptions([]);
    setError(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => searchStops(val), 300);
  };

  const handleSelectDest = async (stop: StopResult) => {
    setSelectedDest(stop);
    setQuery(stop.stpnm);
    setSearchResults([]);

    if (!userLocation) {
      setError('Location not available');
      return;
    }

    setLoadingTrip(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/trip-plan`, {
        params: {
          olat: userLocation[1],
          olon: userLocation[0],
          dlat: stop.lat,
          dlon: stop.lon,
        }
      });
      const options: TripOption[] = (res.data.options || []).slice(0, 5);
      setTripOptions(options);

      if (options.length === 0) {
        setError('No direct bus routes found between these locations. Try a destination closer to a bus route.');
      }
    } catch (e) {
      setError('Could not plan trip. Try again.');
    } finally {
      setLoadingTrip(false);
    }
  };

  const handleSelectTrip = (opt: TripOption) => {
    onTripSelect({
      routeId: opt.routeId,
      originStop: { stpid: opt.originStop.stpid, stpnm: opt.originStop.stpnm, lat: opt.originStop.lat, lon: opt.originStop.lon },
      destStop: { stpid: opt.destStop.stpid, stpnm: opt.destStop.stpnm, lat: opt.destStop.lat, lon: opt.destStop.lon },
      walkToMin: opt.walkToMin,
      walkFromMin: opt.walkFromMin,
    });
  };

  const walkTimeStr = (min: number) => {
    if (min < 1) return '<1 min walk';
    return `${Math.round(min)} min walk`;
  };

  return (
    <div className="fade-in" style={{ padding: '14px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Where to?</div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
            Find the best bus route
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

      {/* Vertical connector */}
      <div style={{ width: 1, height: 16, background: 'var(--border-bright)', marginLeft: 4.5, marginBottom: 8 }} />

      {/* Destination search */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <div style={{ position: 'absolute', left: 12, top: 12, color: 'var(--signal)', fontSize: 14, pointerEvents: 'none' }}>
          &#9679;
        </div>
        <input
          type="text"
          className="trip-search-input"
          placeholder="Search for a stop..."
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          autoFocus
        />

        {/* Search results dropdown */}
        {searchResults.length > 0 && (
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
            maxHeight: 240,
            overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}>
            {searchResults.map(stop => (
              <button
                key={stop.stpid}
                onClick={() => handleSelectDest(stop)}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  padding: '10px 14px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>
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
                <span className="data-num" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                  #{stop.stpid}
                </span>
              </button>
            ))}
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
                  {/* Route header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="data-num" style={{
                        fontSize: 16, fontWeight: 700,
                        color: isActive ? 'var(--signal)' : 'var(--text-primary)',
                      }}>
                        {opt.routeId}
                      </span>
                      {opt.routeName && (
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {opt.routeName}
                        </span>
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

                  {/* Trip steps */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Walk to stop */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 20, textAlign: 'center', fontSize: 12 }}>&#128694;</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {walkTimeStr(opt.walkToMin)} to <span style={{ color: 'var(--text-primary)' }}>{opt.originStop.stpnm}</span>
                      </div>
                    </div>

                    {/* Bus ride */}
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

                    {/* ML ETA */}
                    {opt.mlEta && (
                      <div style={{ marginLeft: 28, marginTop: 2 }}>
                        <ConfidenceBand low={opt.mlEta.low} median={opt.mlEta.median} high={opt.mlEta.high} />
                      </div>
                    )}

                    {/* Walk from stop */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 20, textAlign: 'center', fontSize: 12 }}>&#128694;</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {walkTimeStr(opt.walkFromMin)} to <span style={{ color: 'var(--signal)' }}>{selectedDest?.stpnm || 'destination'}</span>
                      </div>
                    </div>
                  </div>

                  {isActive && (
                    <div style={{
                      marginTop: 10,
                      textAlign: 'center',
                      fontSize: 10,
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

      {/* Empty state hint */}
      {!selectedDest && !loadingTrip && !error && searchResults.length === 0 && query.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '32px 16px',
          color: 'var(--text-dim)',
          fontSize: 12,
          lineHeight: 1.6,
        }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>&#128652;</div>
          Search for a bus stop to find the best route from your current location.
        </div>
      )}
    </div>
  );
}
