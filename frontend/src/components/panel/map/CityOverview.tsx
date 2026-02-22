import { useEffect, useState } from 'react';
import axios from 'axios';
import MetricCard from '../../shared/MetricCard';
import ReliabilityBar from '../../shared/ReliabilityBar';
import StatusBadge from '../../shared/StatusBadge';

interface CityOverviewProps {
  busCount: number;
  delayedCount: number;
  onRouteSelect: (rt: string) => void;
  onTripPlan: () => void;
}

export default function CityOverview({ busCount, delayedCount, onRouteSelect, onTripPlan }: CityOverviewProps) {
  const [reliability, setReliability] = useState<any[]>([]);
  const [drift, setDrift] = useState<any>(null);
  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    axios.get(`${API_BASE}/api/route-reliability`).then(res => {
      const sorted = (res.data.routes || []).sort((a: any, b: any) => b.reliability_score - a.reliability_score);
      setReliability(sorted.slice(0, 8));
    }).catch(() => {});

    axios.get(`${API_BASE}/api/drift/check`).then(res => {
      setDrift(res.data);
    }).catch(() => {});
  }, [API_BASE]);

  const onTimePct = busCount > 0 ? Math.round(((busCount - delayedCount) / busCount) * 100) : null;

  return (
    <div className="fade-in" style={{ padding: '16px 14px' }}>
      {/* Where to? — Uber-style trip planner CTA */}
      <button
        onClick={onTripPlan}
        style={{
          width: '100%',
          background: 'var(--surface-2)',
          border: '1px solid var(--border-bright)',
          borderRadius: 12,
          color: 'var(--text-secondary)',
          fontSize: 14,
          fontWeight: 500,
          padding: '14px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 10,
          transition: 'all 0.15s',
          fontFamily: 'var(--font-ui)',
          textAlign: 'left',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'var(--signal)';
          e.currentTarget.style.color = 'var(--text-primary)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--border-bright)';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }}
      >
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'var(--signal-dim)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 16, color: 'var(--signal)' }}>&#10132;</span>
        </div>
        Where to?
      </button>

      <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
        System Overview
      </div>

      {/* Live stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <MetricCard label="Active Buses" value={busCount} accent />
        <MetricCard label="On Time" value={onTimePct !== null ? `${onTimePct}%` : '—'} />
        <MetricCard label="Delayed" value={delayedCount} dim={delayedCount === 0} />
        {drift?.baseline_mae_sec && (
          <MetricCard label="Model MAE" value={`${Math.round(drift.baseline_mae_sec)}s`} />
        )}
      </div>

      {/* Model health */}
      {drift && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            Model Health
          </div>
          <div style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                {drift.model?.version || 'No model'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                {drift.model?.age_days != null ? `${drift.model.age_days}d old` : 'age unknown'}
              </div>
            </div>
            <StatusBadge status={drift.status || 'UNKNOWN'} />
          </div>
        </div>
      )}

      {/* Route reliability */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
          Routes by Reliability
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {reliability.map(r => (
            <button
              key={r.route_id}
              onClick={() => onRouteSelect(r.route_id)}
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 7,
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transition: 'border-color 0.15s',
                width: '100%',
                textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-bright)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 24 }}>
                  {r.route_id}
                </span>
                <ReliabilityBar score={r.reliability_score} showLabel={false} />
              </div>
              <span className="data-num" style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                {Math.round(r.avg_error)}s MAE
              </span>
            </button>
          ))}
          {reliability.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: '16px 0' }}>
              No reliability data yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
