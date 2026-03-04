import { useState, useEffect } from 'react';
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
}

interface NearbyStopData {
  stop: Stop;
  distance: number;
  predictions: Prediction[];
}

interface NearbyStopsProps {
  userLocation: [number, number] | null;  // [lon, lat]
  onStopSelect: (stop: Stop) => void;
  onTrackBus: (vid: string, route: string, destination: string) => void;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function NearbyStops({ userLocation, onStopSelect, onTrackBus }: NearbyStopsProps) {
  const [nearbyStops, setNearbyStops] = useState<NearbyStopData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userLocation) {
      setLoading(false);
      return;
    }

    const [lon, lat] = userLocation;
    let cancelled = false;

    async function fetchNearby() {
      try {
        // Fetch all routes
        const routesRes = await axios.get(`${API_BASE}/routes`);
        const routes = routesRes.data?.['bustime-response']?.routes || [];
        const routeIds: string[] = routes.map((r: { rt: string }) => r.rt);

        // Fetch stops for all routes in batches
        const allStops = new Map<string, Stop & { routes: string[] }>();
        const batchSize = 5;
        for (let i = 0; i < routeIds.length; i += batchSize) {
          const batch = routeIds.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map((rt) =>
              axios.get(`${API_BASE}/stops?rt=${rt}`).catch(() => null)
            )
          );
          if (cancelled) return;
          results.forEach((res, idx) => {
            if (!res) return;
            const stops = res.data?.['bustime-response']?.stops || [];
            stops.forEach((s: { stpid: string; stpnm: string; lat: number; lon: number }) => {
              const existing = allStops.get(s.stpid);
              if (existing) {
                if (!existing.routes.includes(batch[idx])) {
                  existing.routes.push(batch[idx]);
                }
              } else {
                allStops.set(s.stpid, {
                  stpid: s.stpid,
                  stpnm: s.stpnm,
                  lat: s.lat,
                  lon: s.lon,
                  routes: [batch[idx]],
                });
              }
            });
          });
        }

        // Sort by distance, take top 8
        const sorted = [...allStops.values()]
          .map(s => ({
            stop: { stpid: s.stpid, stpnm: s.stpnm, lat: s.lat, lon: s.lon },
            distance: haversineMeters(lat, lon, s.lat, s.lon),
            predictions: [] as Prediction[],
          }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 8);

        // Fetch predictions for nearest stops
        const withPredictions = await Promise.all(
          sorted.map(async (item) => {
            try {
              const res = await axios.get(`${API_BASE}/predictions?stpid=${item.stop.stpid}`);
              const preds = res.data?.['bustime-response']?.prd || [];
              const predArr = Array.isArray(preds) ? preds : [preds];
              item.predictions = predArr
                .filter((p: { prdctdn: string }) => p.prdctdn !== 'DLY' && parseInt(p.prdctdn) <= 30)
                .slice(0, 3)
                .map((p: { rt: string; des: string; prdctdn: string; vid: string; dly: boolean | string }) => ({
                  route: p.rt,
                  destination: p.des,
                  minutes: p.prdctdn === 'DUE' ? 0 : parseInt(p.prdctdn),
                  vid: p.vid,
                  delayed: p.dly === true || p.dly === 'true',
                }));
            } catch { /* prediction fetch failed for this stop */ }
            return item;
          })
        );

        if (!cancelled) {
          setNearbyStops(withPredictions.filter(s => s.predictions.length > 0));
        }
      } catch (err) {
        console.error('Failed to fetch nearby stops:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchNearby();
    const timer = setInterval(fetchNearby, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userLocation]);

  if (!userLocation) {
    return (
      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
        Enable location to see nearby stops
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
        Finding nearby stops...
      </div>
    );
  }

  if (nearbyStops.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
        No buses arriving nearby in the next 30 minutes
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--text-primary)',
      }}>
        Nearby Stops
      </div>

      {nearbyStops.map((item) => (
        <div key={item.stop.stpid}>
          <button
            onClick={() => onStopSelect(item.stop)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer',
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}>
                {item.stop.stpnm}
              </span>
              <span className="data-num" style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
              }}>
                {item.distance < 1000
                  ? `${Math.round(item.distance)}m`
                  : `${(item.distance / 1000).toFixed(1)}km`}
              </span>
            </div>
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {item.predictions.map((pred) => (
              <ArrivalCard
                key={pred.vid}
                route={pred.route}
                destination={pred.destination}
                minutes={pred.minutes}
                delayed={pred.delayed}
                onTrack={() => onTrackBus(pred.vid, pred.route, pred.destination)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
