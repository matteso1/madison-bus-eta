interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number; // positive = better, negative = worse
  deltaUnit?: string;
  accent?: boolean;
  dim?: boolean;
}

export default function MetricCard({ label, value, unit, delta, deltaUnit, accent, dim }: MetricCardProps) {
  return (
    <div style={{
      background: 'var(--surface-2)',
      border: `1px solid ${accent ? 'var(--border-bright)' : 'var(--border)'}`,
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span className="data-num" style={{
          fontSize: 20,
          fontWeight: 600,
          color: dim ? 'var(--text-secondary)' : accent ? 'var(--signal)' : 'var(--text-primary)',
        }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{unit}</span>
        )}
      </div>
      {delta !== undefined && (
        <div style={{
          fontSize: 10,
          color: delta >= 0 ? 'var(--success)' : 'var(--danger)',
          marginTop: 2,
          fontFamily: 'var(--font-data)',
        }}>
          {delta >= 0 ? '+' : ''}{delta}{deltaUnit}
        </div>
      )}
    </div>
  );
}
