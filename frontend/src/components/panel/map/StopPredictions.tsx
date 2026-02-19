import { useEffect, useState } from 'react';
import axios from 'axios';
import ConfidenceBand from '../../shared/ConfidenceBand';
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
  apiMinutes: number;
  mlLow: number;
  mlMedian: number;
  mlHigh: number;
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
        const prds = selectedRoute && selectedRoute !== 'ALL'
          ? allPrds.filter((p: any) => p.rt === selectedRoute)
          : allPrds;

        const results: Prediction[] = [];
        for (const prd of prds.slice(0, 5)) {
          if (cancelled) return;
          const apiMinutes = prd.prdctdn === 'DUE' ? 0 : (parseInt(prd.prdctdn) || 0);
          try {
            const mlRes = await axios.post(`${API_BASE}/api/predict-arrival-v2`, {
              route: prd.rt,
              stop_id: stop.stpid,
              vehicle_id: prd.vid,
              api_prediction: apiMinutes,
            });
            results.push({
              route: prd.rt,
              destination: prd.des,
              apiMinutes,
              mlLow: Math.round(mlRes.data.eta_low_min),
              mlMedian: Math.round(mlRes.data.eta_median_min),
              mlHigh: Math.round(mlRes.data.eta_high_min),
              delayed: prd.dly === true || prd.dly === 'true',
              vid: prd.vid,
            });
          } catch {
            results.push({
              route: prd.rt,
              destination: prd.des,
              apiMinutes,
              mlLow: Math.round(apiMinutes * 0.85),
              mlMedian: apiMinutes,
              mlHigh: Math.round(apiMinutes * 1.3),
              delayed: prd.dly === true || prd.dly === 'true',
              vid: prd.vid,
            });
          }
        }
        if (!cancelled) setPredictions(results);
      } catch (e) {
        console.error('Stop predictions error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [stop.stpid, stop.route, API_BASE]);

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
        ML-Corrected Arrivals
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="data-num" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {pred.route}
                  </span>
                  {pred.delayed && (
                    <span style={{
                      fontSize: 9,
                      background: 'rgba(239,68,68,0.15)',
                      color: 'var(--danger)',
                      border: '1px solid rgba(239,68,68,0.3)',
                      borderRadius: 3,
                      padding: '1px 5px',
                      fontFamily: 'var(--font-data)',
                    }}>
                      DELAYED
                    </span>
                  )}
                </div>
                <div className="data-num" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  API: {pred.apiMinutes}m
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>
                {pred.destination}
              </div>
              <ConfidenceBand low={pred.mlLow} median={pred.mlMedian} high={pred.mlHigh} />

              {/* Track Bus Button */}
              {onTrackBus && (
                <button
                  onClick={() => handleTrack(pred)}
                  style={{
                    width: '100%',
                    marginTop: 10,
                    background: 'var(--signal-dim)',
                    border: '1px solid rgba(0,212,255,0.3)',
                    borderRadius: 6,
                    color: 'var(--signal)',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '8px 12px',
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
                  <span style={{ fontSize: 14 }}>&#9673;</span>
                  Track This Bus
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
