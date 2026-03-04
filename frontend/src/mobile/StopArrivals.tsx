import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import ArrivalCard from './ArrivalCard';

const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

interface Stop {
  stpid: string;
  stpnm: string;
  lat: number;
  lon: number;
}

interface Prediction {
  route: string;
  destination: string;
  minutes: number;
  vid: string;
  delayed: boolean;
  confidence?: { low: number; median: number; high: number };
}

interface StopArrivalsProps {
  stop: Stop;
  distance: number;
  onBack: () => void;
  onTrackBus: (vid: string, route: string, destination: string) => void;
}

export default function StopArrivals({ stop, distance, onBack, onTrackBus }: StopArrivalsProps) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function fetchArrivals() {
      try {
        const res = await axios.get(`${API_BASE}/predictions?stpid=${stop.stpid}`);
        if (cancelledRef.current) return;

        const preds = res.data?.['bustime-response']?.prd || [];
        const predArr = Array.isArray(preds) ? preds : [preds];

        const filtered: Prediction[] = predArr
          .filter((p: { prdctdn: string }) => {
            if (p.prdctdn === 'DLY') return false;
            if (p.prdctdn === 'DUE') return true;
            const mins = parseInt(p.prdctdn);
            return !isNaN(mins) && mins <= 30;
          })
          .map((p: { rt: string; des: string; prdctdn: string; vid: string; dly: boolean | string }) => ({
            route: p.rt,
            destination: p.des,
            minutes: p.prdctdn === 'DUE' ? 0 : parseInt(p.prdctdn),
            vid: p.vid,
            delayed: p.dly === true || p.dly === 'true',
          }));

        // Fetch conformal predictions (non-blocking enhancement)
        const withConfidence = await Promise.all(
          filtered.map(async (pred) => {
            try {
              const confRes = await axios.post(`${API_BASE}/api/conformal-prediction`, {
                route: pred.route,
                stop_id: stop.stpid,
                api_prediction_min: pred.minutes,
                vehicle_id: pred.vid,
              });
              if (cancelledRef.current) return pred;
              const data = confRes.data;
              if (data.model_available) {
                return {
                  ...pred,
                  confidence: {
                    low: data.eta_low_min,
                    median: data.eta_median_min,
                    high: data.eta_high_min,
                  },
                };
              }
            } catch {
              // Conformal prediction failed -- use prediction without confidence
            }
            return pred;
          })
        );

        if (!cancelledRef.current) {
          setPredictions(withConfidence);
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to fetch arrivals:', err);
        if (!cancelledRef.current) {
          setPredictions([]);
          setLoading(false);
        }
      }
    }

    fetchArrivals();
    const timer = setInterval(fetchArrivals, 15000);

    return () => {
      cancelledRef.current = true;
      clearInterval(timer);
    };
  }, [stop.stpid]);

  const distanceLabel = distance < 1000
    ? `${Math.round(distance)}m`
    : `${(distance / 1000).toFixed(1)}km`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Header: back button + stop name + distance */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 4,
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: 'var(--signal)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 44,
            minHeight: 44,
            flexShrink: 0,
          }}
          aria-label="Back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {stop.stpnm}
          </div>
          <span className="data-num" style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
          }}>
            {distanceLabel}
          </span>
        </div>
      </div>

      {/* Content: loading, empty, or arrival cards */}
      {loading ? (
        <div style={{
          textAlign: 'center',
          padding: 20,
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-ui)',
        }}>
          Loading arrivals...
        </div>
      ) : predictions.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: 20,
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-ui)',
        }}>
          No upcoming arrivals at this stop
        </div>
      ) : (
        predictions.map((pred) => (
          <ArrivalCard
            key={pred.vid}
            route={pred.route}
            destination={pred.destination}
            minutes={pred.minutes}
            delayed={pred.delayed}
            confidence={pred.confidence}
            onTrack={() => onTrackBus(pred.vid, pred.route, pred.destination)}
          />
        ))
      )}
    </div>
  );
}
