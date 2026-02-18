import { useEffect, useState } from 'react';
import axios from 'axios';
import MetricCard from '../../shared/MetricCard';
import StatusBadge from '../../shared/StatusBadge';

export default function SystemPanel() {
  const [drift, setDrift] = useState<any>(null);
  const [collector, setCollector] = useState<any>(null);
  const [training, setTraining] = useState<any[]>([]);
  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    const load = async () => {
      try {
        const [driftRes, collectorRes, trainingRes] = await Promise.all([
          axios.get(`${API_BASE}/api/drift/check`),
          axios.get(`${API_BASE}/collector/status`).catch(() => null),
          axios.get(`${API_BASE}/api/ml-training-history`).catch(() => null),
        ]);
        setDrift(driftRes.data);
        if (collectorRes) setCollector(collectorRes.data);
        if (trainingRes) setTraining((trainingRes.data.runs || []).slice(0, 5));
      } catch (e) {
        console.error('System panel load error:', e);
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [API_BASE]);

  return (
    <div className="fade-in panel-scroll" style={{ padding: '14px', height: '100%' }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
        System
      </div>

      {/* Model health */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
          Model Health
        </div>
        <div style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '12px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div className="data-num" style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 2 }}>
                {drift?.model?.version || 'No model deployed'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                {drift?.model?.age_days != null ? `${drift.model.age_days} days old` : 'age unknown'}
              </div>
            </div>
            <StatusBadge status={drift?.status || 'UNKNOWN'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <MetricCard label="Baseline MAE" value={drift?.baseline_mae_sec != null ? `${Math.round(drift.baseline_mae_sec)}s` : '—'} />
            <MetricCard label="Recent MAE" value={drift?.recent_ml_mae_sec != null ? `${Math.round(drift.recent_ml_mae_sec)}s` : '—'} accent />
          </div>

          {drift?.recommendation && (
            <div style={{
              marginTop: 10,
              fontSize: 11,
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              padding: '8px',
              background: 'var(--bg)',
              borderRadius: 6,
            }}>
              {drift.recommendation}
            </div>
          )}
        </div>
      </div>

      {/* Drift status */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
          Drift Detection
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <MetricCard
            label="Drift %"
            value={drift?.drift_pct != null ? `${drift.drift_pct > 0 ? '+' : ''}${drift.drift_pct?.toFixed(1)}%` : '—'}
            dim={drift?.drift_pct == null}
          />
          <MetricCard
            label="Matched (48h)"
            value={drift?.matched_predictions_48h ?? '—'}
          />
          <MetricCard
            label="API MAE (7d)"
            value={drift?.api_mae_sec != null ? `${Math.round(drift.api_mae_sec)}s` : '—'}
            dim
          />
          <MetricCard
            label="Predictions (7d)"
            value={drift?.prediction_count_7d != null ? drift.prediction_count_7d.toLocaleString() : '—'}
          />
        </div>
      </div>

      {/* Data pipeline */}
      {collector && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            Data Pipeline
          </div>
          <div style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 12px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>Collector</span>
              <StatusBadge status={collector.collector_running ? 'OK' : 'CRITICAL'} small />
            </div>
            {collector.last_updated && (
              <div className="data-num" style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                Last: {new Date(collector.last_updated).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Training history */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
          Training History
        </div>
        {training.map((run: any, i: number) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 0',
              borderBottom: i < training.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div>
              <div className="data-num" style={{ fontSize: 11, color: 'var(--text-primary)' }}>
                {run.version}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                {run.deployment_reason?.replace(/_/g, ' ')}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="data-num" style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                {run.mae ? `${Math.round(run.mae)}s` : '—'}
              </span>
              {run.deployed ? (
                <StatusBadge status="OK" small />
              ) : (
                <span style={{ fontSize: 9, color: 'var(--text-secondary)', fontFamily: 'var(--font-data)' }}>SKIP</span>
              )}
            </div>
          </div>
        ))}
        {training.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: '16px 0' }}>
            No training runs logged yet
          </div>
        )}
      </div>
    </div>
  );
}
