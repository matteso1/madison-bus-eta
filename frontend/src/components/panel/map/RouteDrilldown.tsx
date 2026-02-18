import { useEffect, useState } from 'react';
import axios from 'axios';
import ReliabilityBar from '../../shared/ReliabilityBar';
import MetricCard from '../../shared/MetricCard';

interface RouteDrilldownProps {
  route: string;
  onClose: () => void;
}

export default function RouteDrilldown({ route, onClose }: RouteDrilldownProps) {
  const [routeData, setRouteData] = useState<any>(null);
  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    axios.get(`${API_BASE}/api/route-reliability`).then(res => {
      const found = (res.data.routes || []).find((r: any) => r.route_id === route);
      setRouteData(found || null);
    }).catch(() => {});
  }, [route, API_BASE]);

  const score = routeData?.reliability_score ?? 0;

  return (
    <div className="fade-in" style={{ padding: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            Route
          </div>
          <div className="data-num" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
            {route}
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
          All Routes
        </button>
      </div>

      {routeData && (
        <>
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ReliabilityBar score={score} showLabel={false} />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {routeData.rating}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            <MetricCard label="Avg MAE" value={`${Math.round(routeData.avg_error)}s`} />
            <MetricCard label="Within 2min" value={`${Math.round(routeData.within_2min_pct ?? 0)}%`} accent />
            <MetricCard label="Reliability" value={`${Math.round(score * 100)}%`} />
            <MetricCard label="Predictions" value={routeData.prediction_count ?? '—'} />
          </div>

          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Click a stop on the map to see ML-corrected arrivals for this route.
          </div>
        </>
      )}

      {!routeData && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '24px 0', textAlign: 'center' }}>
          No reliability data for route {route} yet
        </div>
      )}
    </div>
  );
}
