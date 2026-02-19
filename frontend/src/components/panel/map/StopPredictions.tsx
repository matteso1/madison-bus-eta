import { useEffect, useState } from 'react';
import axios from 'axios';
import type { StopClickEvent, TrackedBus } from '../../MapView';

interface StopPredictionsProps {
  stop: StopClickEvent;
  selectedRoute: string;
  onClose: () => void;
  onTrackBus?: (bus: TrackedBus) => void;
}

interface Prediction {
  route: string;
  destination: string;
  minutes: number;
  delayed: boolean;
  vid: string;
}

export default function StopPredictions({ stop, selectedRoute, onClose, onTrackBus }: StopPredictionsProps) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [stopLatLon, setStopLatLon] = useState<[number, number] | null>(null);
  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPredictions([]);
    setStopLatLon(null);

    const load = async () => {
      try {
        try {
          const stopsRes = await axios.get(`${API_BASE}/stops?rt=${stop.route}`);
          const allStops = stopsRes.data?.['bustime-response']?.stops || [];
          const thisStop = allStops.find((s: any) => String(s.stpid) === String(stop.stpid));
          if (thisStop && !cancelled) {
            setStopLatLon([parseFloat(thisStop.lon), parseFloat(thisStop.lat)]);
          }
        } catch {}

        if (cancelled) return;

        const res = await axios.get(`${API_BASE}/predictions?stpid=${stop.stpid}`);
        const prdArray = res.data?.['bustime-response']?.prd || [];
        const allPrds = Array.isArray(prdArray) ? prdArray : [prdArray];
        const routeFiltered = selectedRoute && selectedRoute !== 'ALL'
          ? allPrds.filter((p: any) => p.rt === selectedRoute)
          : allPrds;
        const prds = routeFiltered
          .filter((p: any) => {
            const mins = p.prdctdn === 'DUE' ? 0 : (parseInt(p.prdctdn) || 999);
            return mins <= 30;
          })
          .slice(0, 3);

        if (!cancelled) {
          setPredictions(prds.map((prd: any) => ({
            route: prd.rt,
            destination: prd.des,
            minutes: prd.prdctdn === 'DUE' ? 0 : (parseInt(prd.prdctdn) || 0),
            delayed: prd.dly === true || prd.dly === 'true',
            vid: prd.vid,
          })));
        }
      } catch (e) {
        console.error('Stop predictions error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const timer = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [stop.stpid, stop.route, selectedRoute, API_BASE]);

  const handleTrack = (pred: Prediction) => {
    if (!onTrackBus) return;
    onTrackBus({
      vid: pred.vid,
      route: pred.route,
      stopId: stop.stpid,
      stopName: stop.stpnm,
      stopPosition: stopLatLon || undefined,
    });
  };

  return (
    <div className="fade-in" style={{ padding: '14px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
            {stop.stpnm}
          </div>
          <div className="data-num" style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
            Stop #{stop.stpid}
          </div>
        </div>
        <button
          onClick={onClose}
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

      <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
        Upcoming Arrivals
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)', fontSize: 12 }}>
          Loading predictions...
        </div>
      ) : predictions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)', fontSize: 12 }}>
          No buses approaching this stop
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {predictions.map((pred) => (
            <div
              key={`${pred.vid}-${pred.route}`}
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {pred.route}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      → {pred.destination}
                    </span>
                    {pred.delayed && (
                      <span style={{
                        fontSize: 9,
                        background: 'rgba(239,68,68,0.15)',
                        color: 'var(--danger)',
                        borderRadius: 3,
                        padding: '1px 5px',
                        fontFamily: 'var(--font-data)',
                      }}>
                        DELAYED
                      </span>
                    )}
                  </div>
                </div>
                <div style={{
                  fontSize: pred.minutes === 0 ? 18 : 22,
                  fontWeight: 700,
                  color: pred.minutes <= 1 ? 'var(--signal)' : 'var(--text-primary)',
                  fontFamily: 'var(--font-data)',
                  lineHeight: 1,
                }}>
                  {pred.minutes === 0 ? 'DUE' : `${pred.minutes}`}
                  {pred.minutes > 0 && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 2 }}>min</span>}
                </div>
              </div>

              {onTrackBus && pred.minutes <= 15 && (
                <button
                  onClick={() => handleTrack(pred)}
                  style={{
                    width: '100%',
                    marginTop: 6,
                    background: 'var(--signal-dim)',
                    border: '1px solid rgba(0,212,255,0.3)',
                    borderRadius: 6,
                    color: 'var(--signal)',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '7px 12px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-ui)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,255,0.2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'var(--signal-dim)')}
                >
                  ◉ Track This Bus
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
