import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import ConfidenceBand from '../../shared/ConfidenceBand';

interface NearbyStopsProps {
  onBack: () => void;
  onUserLocation: (lat: number, lon: number) => void;
  onStopSelect: (stpid: string, stpnm: string, route: string) => void;
}

interface NearbyStop {
  stpid: string;
  stpnm: string;
  lat: number;
  lon: number;
  routes: string[];
  distance_miles: number;
}

interface Arrival {
  route: string;
  destination: string;
  apiMinutes: number;
  mlLow: number;
  mlMedian: number;
  mlHigh: number;
  delayed: boolean;
}

interface StopWithArrivals extends NearbyStop {
  arrivals: Arrival[];
  loading: boolean;
}

export default function NearbyStops({ onBack, onUserLocation, onStopSelect }: NearbyStopsProps) {
  const [locError, setLocError] = useState<string | null>(null);
  const [locating, setLocating] = useState(true);
  const [stops, setStops] = useState<StopWithArrivals[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  const loadArrivals = useCallback(async (stop: NearbyStop): Promise<Arrival[]> => {
    try {
      const res = await axios.get(`${API_BASE}/predictions?stpid=${stop.stpid}`);
      const prdArray = res.data?.['bustime-response']?.prd || [];
      const prds = Array.isArray(prdArray) ? prdArray : [prdArray];

      const arrivals: Arrival[] = [];
      for (const prd of prds.slice(0, 3)) {
        const apiMinutes = parseInt(prd.prdctdn) || 0;
        try {
          const ml = await axios.post(`${API_BASE}/api/predict-arrival-v2`, {
            route: prd.rt,
            stop_id: stop.stpid,
            vehicle_id: prd.vid,
            api_prediction: apiMinutes,
          });
          arrivals.push({
            route: prd.rt,
            destination: prd.des,
            apiMinutes,
            mlLow: Math.round(ml.data.eta_low_min),
            mlMedian: Math.round(ml.data.eta_median_min),
            mlHigh: Math.round(ml.data.eta_high_min),
            delayed: prd.dly === true || prd.dly === 'true',
          });
        } catch {
          arrivals.push({
            route: prd.rt,
            destination: prd.des,
            apiMinutes,
            mlLow: Math.round(apiMinutes * 0.85),
            mlMedian: apiMinutes,
            mlHigh: Math.round(apiMinutes * 1.3),
            delayed: prd.dly === true || prd.dly === 'true',
          });
        }
      }
      return arrivals;
    } catch {
      return [];
    }
  }, [API_BASE]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocError('Geolocation not supported by your browser');
      setLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        setLocating(false);
        onUserLocation(lat, lon);

        try {
          const res = await axios.get(`${API_BASE}/stops/nearby?lat=${lat}&lon=${lon}&radius=0.4`);
          const nearbyStops: NearbyStop[] = (res.data.stops || []).slice(0, 6);

          // Init with loading state
          setStops(nearbyStops.map(s => ({ ...s, arrivals: [], loading: true })));

          // Auto-expand first stop and load its arrivals
          if (nearbyStops.length > 0) {
            setExpanded(nearbyStops[0].stpid);
            const firstArrivals = await loadArrivals(nearbyStops[0]);
            setStops(prev => prev.map(s =>
              s.stpid === nearbyStops[0].stpid ? { ...s, arrivals: firstArrivals, loading: false } : s
            ));
          }
        } catch {
          setLocError('Could not load nearby stops. The stop cache may be building — try again in a moment.');
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocError('Location access denied. Enable location in your browser to see nearby stops.');
        } else {
          setLocError('Could not get your location. Try again.');
        }
      },
      { timeout: 8000, maximumAge: 30000 }
    );
  }, [API_BASE, onUserLocation, loadArrivals]);

  const handleExpand = async (stop: StopWithArrivals) => {
    if (expanded === stop.stpid) {
      setExpanded(null);
      return;
    }
    setExpanded(stop.stpid);
    if (stop.arrivals.length === 0 && !stop.loading) {
      setStops(prev => prev.map(s => s.stpid === stop.stpid ? { ...s, loading: true } : s));
      const arrivals = await loadArrivals(stop);
      setStops(prev => prev.map(s => s.stpid === stop.stpid ? { ...s, arrivals, loading: false } : s));
    }
  };

  const feetAway = (miles: number) => {
    const ft = miles * 5280;
    return ft < 600 ? `${Math.round(ft)} ft` : `${(miles * 1760).toFixed(0)} yd`;
  };

  return (
    <div className="fade-in" style={{ padding: '14px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Near Me</div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
            Stops within walking distance
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

      {/* Locating spinner */}
      {locating && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)', fontSize: 12 }}>
          <div className="live-dot" style={{
            width: 10, height: 10, borderRadius: '50%',
            background: 'var(--signal)', margin: '0 auto 12px',
          }} />
          Getting your location...
        </div>
      )}

      {/* Error */}
      {locError && (
        <div style={{
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: 8,
          padding: '12px',
          fontSize: 12,
          color: '#fca5a5',
          lineHeight: 1.5,
        }}>
          {locError}
        </div>
      )}

      {/* Stop list */}
      {stops.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {stops.map(stop => (
            <div
              key={stop.stpid}
              style={{
                background: 'var(--surface-2)',
                border: `1px solid ${expanded === stop.stpid ? 'var(--border-bright)' : 'var(--border)'}`,
                borderRadius: 8,
                overflow: 'hidden',
                transition: 'border-color 0.15s',
              }}
            >
              {/* Stop header row */}
              <button
                onClick={() => handleExpand(stop)}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {stop.stpnm}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="data-num" style={{ fontSize: 10, color: 'var(--signal)' }}>
                      {feetAway(stop.distance_miles)}
                    </span>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {stop.routes.slice(0, 6).map(rt => (
                        <span
                          key={rt}
                          onClick={e => { e.stopPropagation(); onStopSelect(stop.stpid, stop.stpnm, rt); }}
                          style={{
                            fontSize: 9,
                            fontFamily: 'var(--font-data)',
                            fontWeight: 700,
                            background: 'var(--signal-dim)',
                            color: 'var(--signal)',
                            border: '1px solid rgba(0,212,255,0.2)',
                            borderRadius: 3,
                            padding: '1px 5px',
                            cursor: 'pointer',
                          }}
                        >
                          {rt}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8, flexShrink: 0 }}>
                  {expanded === stop.stpid ? '▲' : '▼'}
                </span>
              </button>

              {/* Expanded arrivals */}
              {expanded === stop.stpid && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px' }}>
                  {stop.loading ? (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>
                      Loading arrivals...
                    </div>
                  ) : stop.arrivals.length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>
                      No buses arriving soon
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {stop.arrivals.map((arr, i) => (
                        <div key={i}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className="data-num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                                {arr.route}
                              </span>
                              {arr.delayed && (
                                <span style={{
                                  fontSize: 9,
                                  background: 'rgba(239,68,68,0.15)',
                                  color: 'var(--danger)',
                                  border: '1px solid rgba(239,68,68,0.25)',
                                  borderRadius: 3,
                                  padding: '1px 4px',
                                  fontFamily: 'var(--font-data)',
                                }}>DELAYED</span>
                              )}
                            </div>
                            <span style={{ fontSize: 10, color: 'var(--text-secondary)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {arr.destination}
                            </span>
                          </div>
                          <ConfidenceBand low={arr.mlLow} median={arr.mlMedian} high={arr.mlHigh} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* No stops found */}
      {!locating && !locError && stops.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: '32px 0' }}>
          No stops found within 0.4 miles of your location
        </div>
      )}
    </div>
  );
}
