// Horizontal confidence band: low ──●──── high min
interface ConfidenceBandProps {
  low: number;
  median: number;
  high: number;
  unit?: string;
}

export default function ConfidenceBand({ low, median, high, unit = 'min' }: ConfidenceBandProps) {
  const range = high - low || 1;
  const medianPct = ((median - low) / range) * 100;

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="data-num" style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{low}{unit}</span>
        <span className="data-num" style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 600 }}>{median}{unit}</span>
        <span className="data-num" style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{high}{unit}</span>
      </div>
      <div style={{
        position: 'relative',
        height: 4,
        background: 'var(--border-bright)',
        borderRadius: 2,
      }}>
        <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          background: 'var(--signal-dim)',
          borderRadius: 2,
        }} />
        <div style={{
          position: 'absolute',
          left: `${medianPct}%`,
          top: -4,
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: 'var(--signal)',
          transform: 'translateX(-50%)',
          boxShadow: '0 0 6px var(--signal-glow)',
        }} />
      </div>
    </div>
  );
}
