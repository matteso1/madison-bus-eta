import { useEffect, useState } from 'react';
import axios from 'axios';

interface TopBarProps {
  busCount: number;
  delayedCount: number;
  selectedRoute: string;
  routes: Array<{ rt: string; rtnm: string }>;
  onRouteChange: (rt: string) => void;
}

export default function TopBar({ busCount, delayedCount, selectedRoute, routes, onRouteChange }: TopBarProps) {
  const [mae, setMae] = useState<number | null>(null);
  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    const fetchMae = async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/drift/check`);
        setMae(res.data?.baseline_mae_sec ?? null);
      } catch {
        // silent
      }
    };
    fetchMae();
    const t = setInterval(fetchMae, 120_000);
    return () => clearInterval(t);
  }, [API_BASE]);

  return (
    <div style={{
      height: 48,
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 16,
      flexShrink: 0,
      zIndex: 10,
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="live-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--signal)' }} />
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
          Madison Metro
        </span>
        <span style={{
          fontSize: 9,
          fontFamily: 'var(--font-data)',
          color: 'var(--signal)',
          background: 'var(--signal-dim)',
          border: '1px solid rgba(0,212,255,0.25)',
          borderRadius: 3,
          padding: '1px 5px',
          letterSpacing: '0.1em',
        }}>
          LIVE
        </span>
      </div>

      {/* Route filter */}
      <select
        value={selectedRoute}
        onChange={e => onRouteChange(e.target.value)}
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--text-primary)',
          fontSize: 12,
          padding: '4px 8px',
          cursor: 'pointer',
          fontFamily: 'var(--font-ui)',
        }}
      >
        <option value="ALL">All Routes</option>
        {routes.map(r => (
          <option key={r.rt} value={r.rt}>Route {r.rt} — {r.rtnm}</option>
        ))}
      </select>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Live stats */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
        <div style={{ color: 'var(--text-secondary)' }}>
          <span className="data-num" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{busCount}</span>
          {' '}buses
        </div>
        {delayedCount > 0 && (
          <div style={{ color: 'var(--warning)' }} className="data-num">
            {delayedCount} late
          </div>
        )}
        {mae !== null && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '3px 8px',
          }}>
            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>MAE</span>
            <span className="data-num" style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 600 }}>
              {Math.round(mae)}s
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
