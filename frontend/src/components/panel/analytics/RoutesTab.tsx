import { useEffect, useState } from 'react';
import axios from 'axios';
import ReliabilityBar from '../../shared/ReliabilityBar';

type SortKey = 'mae' | 'reliability_score' | 'route_id';

export default function RoutesTab() {
  const [routes, setRoutes] = useState<any[]>([]);
  const [sort, setSort] = useState<SortKey>('mae');
  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    axios.get(`${API_BASE}/api/route-reliability`).then(res => {
      setRoutes(res.data.routes || []);
    }).catch(() => {});
  }, [API_BASE]);

  const sorted = [...routes].sort((a, b) => {
    if (sort === 'mae') return (a.avg_error || 0) - (b.avg_error || 0);
    if (sort === 'reliability_score') return (b.reliability_score || 0) - (a.reliability_score || 0);
    return a.route_id.localeCompare(b.route_id);
  });

  const sortBtn = (key: SortKey, label: string) => (
    <button
      onClick={() => setSort(key)}
      style={{
        background: sort === key ? 'var(--signal-dim)' : 'transparent',
        border: `1px solid ${sort === key ? 'rgba(0,212,255,0.3)' : 'var(--border)'}`,
        color: sort === key ? 'var(--signal)' : 'var(--text-secondary)',
        borderRadius: 4,
        padding: '3px 8px',
        fontSize: 10,
        cursor: 'pointer',
        fontFamily: 'var(--font-data)',
        letterSpacing: '0.06em',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="fade-in" style={{ padding: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Routes
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {sortBtn('mae', 'MAE')}
          {sortBtn('reliability_score', 'RELIABILITY')}
          {sortBtn('route_id', 'ID')}
        </div>
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '32px 1fr 80px 48px',
        gap: 8,
        padding: '4px 0',
        borderBottom: '1px solid var(--border)',
        marginBottom: 4,
      }}>
        {['RT', 'Reliability', 'MAE', 'W2m'].map(h => (
          <span key={h} style={{ fontSize: 9, color: 'var(--text-secondary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</span>
        ))}
      </div>

      {sorted.map((r: any) => (
        <div
          key={r.route_id}
          style={{
            display: 'grid',
            gridTemplateColumns: '32px 1fr 80px 48px',
            gap: 8,
            alignItems: 'center',
            padding: '7px 0',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span className="data-num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            {r.route_id}
          </span>
          <ReliabilityBar score={r.reliability_score} showLabel={false} />
          <span className="data-num" style={{ fontSize: 11, color: 'var(--text-primary)' }}>
            {Math.round(r.avg_error)}s
          </span>
          <span className="data-num" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {r.within_2min_pct != null ? `${Math.round(r.within_2min_pct)}%` : '—'}
          </span>
        </div>
      ))}

      {sorted.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: '32px 0' }}>
          No route data yet
        </div>
      )}
    </div>
  );
}
