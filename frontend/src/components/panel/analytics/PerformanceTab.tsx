import { useEffect, useState } from 'react';
import axios from 'axios';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import MetricCard from '../../shared/MetricCard';

export default function PerformanceTab() {
  const [history, setHistory] = useState<any[]>([]);
  const [coverage, setCoverage] = useState<any>(null);
  const [training, setTraining] = useState<any[]>([]);
  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    axios.get(`${API_BASE}/api/ml-training-history`).then(res => {
      const runs = res.data.runs || [];
      setTraining(runs.slice(0, 5));
      // Build MAE trend from runs (oldest to newest)
      const trend = [...runs].reverse().map((r: any, i: number) => ({
        day: i + 1,
        mae: r.mae ? Math.round(r.mae) : null,
      })).filter((d: any) => d.mae !== null);
      setHistory(trend);
    }).catch(() => {});

    axios.get(`${API_BASE}/api/model-diagnostics/coverage`).then(res => {
      // coverage is an array of {threshold, percentage}, total_predictions
      const cvg = res.data;
      const c1m = cvg.coverage?.find((c: any) => c.threshold === '1min')?.percentage;
      const c2m = cvg.coverage?.find((c: any) => c.threshold === '2min')?.percentage;
      const c30s = cvg.coverage?.find((c: any) => c.threshold === '30s')?.percentage;
      setCoverage({
        within_30s_pct: c30s,
        within_1min_pct: c1m,
        within_2min_pct: c2m,
        total_predictions: cvg.total_predictions,
      });
    }).catch(() => {});
  }, [API_BASE]);

  const latestMae = training[0]?.mae ? Math.round(training[0].mae) : null;
  const prevMae = training[1]?.mae ? Math.round(training[1].mae) : null;
  const maeDelta = latestMae !== null && prevMae !== null ? prevMae - latestMae : undefined;

  return (
    <div className="fade-in" style={{ padding: '14px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
        Performance
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <MetricCard
          label="Current MAE"
          value={latestMae !== null ? `${latestMae}s` : '—'}
          delta={maeDelta}
          deltaUnit="s"
          accent={latestMae !== null && latestMae < 60}
        />
        <MetricCard
          label="Within 1min"
          value={coverage?.within_30s_pct != null ? `${Math.round(coverage.within_1min_pct)}%` : '—'}
        />
        <MetricCard
          label="Within 2min"
          value={coverage?.within_2min_pct != null ? `${Math.round(coverage.within_2min_pct)}%` : '—'}
          accent
        />
        <MetricCard
          label="Predictions"
          value={coverage?.total_predictions ?? '—'}
        />
      </div>

      {/* MAE trend chart */}
      {history.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            MAE Trend (training runs)
          </div>
          <div style={{ height: 80 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 2, right: 2, bottom: 2, left: -20 }}>
                <defs>
                  <linearGradient id="maeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" hide />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: '#64748b' }} width={30} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
                  formatter={(v: any) => [`${v}s`, 'MAE']}
                  labelFormatter={() => ''}
                />
                <Area type="monotone" dataKey="mae" stroke="#00d4ff" strokeWidth={1.5} fill="url(#maeGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Training runs */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
          Recent Training Runs
        </div>
        {training.slice(0, 5).map((run: any, i: number) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '7px 0',
              borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div>
              <div className="data-num" style={{ fontSize: 11, color: 'var(--text-primary)' }}>
                {run.version}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                {run.samples_used?.toLocaleString()} samples
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="data-num" style={{ fontSize: 12, color: run.mae < 60 ? 'var(--signal)' : 'var(--text-primary)' }}>
                {run.mae ? `${Math.round(run.mae)}s` : '—'}
              </span>
              {run.deployed && (
                <span style={{
                  fontSize: 9,
                  background: 'var(--signal-dim)',
                  color: 'var(--signal)',
                  border: '1px solid rgba(0,212,255,0.25)',
                  borderRadius: 3,
                  padding: '1px 5px',
                  fontFamily: 'var(--font-data)',
                }}>
                  LIVE
                </span>
              )}
            </div>
          </div>
        ))}
        {training.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: '16px 0' }}>
            No training runs yet
          </div>
        )}
      </div>
    </div>
  );
}
