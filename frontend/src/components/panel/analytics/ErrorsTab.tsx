import { useEffect, useState } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';

export default function ErrorsTab() {
  const [horizonData, setHorizonData] = useState<any[]>([]);
  const [hourlyData, setHourlyData] = useState<any[]>([]);
  const [worst, setWorst] = useState<any[]>([]);
  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    axios.get(`${API_BASE}/api/diagnostics/error-by-horizon`).then(res => {
      setHorizonData(res.data.buckets || []);
    }).catch(() => {});

    axios.get(`${API_BASE}/api/diagnostics/hourly-bias`).then(res => {
      setHourlyData(res.data.hourly || []);
    }).catch(() => {});

    axios.get(`${API_BASE}/api/diagnostics/worst-predictions`).then(res => {
      setWorst((res.data.worst_predictions || []).slice(0, 8));
    }).catch(() => {});
  }, [API_BASE]);

  const maxMae = Math.max(...horizonData.map((d: any) => d.mae || 0), 1);

  return (
    <div className="fade-in" style={{ padding: '14px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
        Error Analysis
      </div>

      {/* Error by horizon */}
      {horizonData.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            MAE by Prediction Horizon
          </div>
          <div style={{ height: 100 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={horizonData} margin={{ top: 2, right: 2, bottom: 2, left: -18 }}>
                <XAxis dataKey="horizon" tick={{ fontSize: 9, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={28} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
                  formatter={(v: any) => [`${Math.round(v)}s`, 'MAE']}
                />
                <Bar dataKey="mae" radius={[3, 3, 0, 0]}>
                  {horizonData.map((d: any, i: number) => (
                    <Cell key={i} fill={d.mae / maxMae > 0.7 ? '#f59e0b' : '#00d4ff'} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Hourly bias strip */}
      {hourlyData.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            Hourly Bias (24h strip)
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            {Array.from({ length: 24 }, (_, h) => {
              const hour = hourlyData.find((d: any) => d.hour === h);
              const bias = hour?.bias ?? 0;
              const maxBias = 60;
              const intensity = Math.min(Math.abs(bias) / maxBias, 1);
              const color = bias > 0 ? `rgba(245,158,11,${0.2 + intensity * 0.7})` : `rgba(0,212,255,${0.2 + intensity * 0.7})`;
              return (
                <div
                  key={h}
                  title={`${h}:00 — bias: ${hour ? Math.round(bias) : 0}s`}
                  style={{
                    flex: 1,
                    height: 24,
                    borderRadius: 2,
                    background: hour ? color : 'var(--border)',
                    cursor: 'default',
                  }}
                />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>0h</span>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>12h</span>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>23h</span>
          </div>
        </div>
      )}

      {/* Worst predictions table */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
          Worst Predictions (7d)
        </div>
        {worst.map((p: any, i: number) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '6px 0',
              borderBottom: i < worst.length - 1 ? '1px solid var(--border)' : 'none',
              fontSize: 11,
            }}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="data-num" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{p.route}</span>
              <span style={{ color: 'var(--text-secondary)' }}>Stop {p.stop_id}</span>
            </div>
            <span className="data-num" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              {Math.round(p.error_seconds / 60)}m
            </span>
          </div>
        ))}
        {worst.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: '16px 0' }}>
            No prediction data yet
          </div>
        )}
      </div>
    </div>
  );
}
