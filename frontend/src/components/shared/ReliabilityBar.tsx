// 5-segment reliability bar. score = 0..1
interface ReliabilityBarProps {
  score: number; // 0..1
  label?: string;
  showLabel?: boolean;
}

export default function ReliabilityBar({ score, label, showLabel = true }: ReliabilityBarProps) {
  const filled = Math.round(score * 5);
  const color = score >= 0.8 ? '#00d4ff' : score >= 0.6 ? '#10b981' : score >= 0.4 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {showLabel && label && (
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 20 }}>{label}</span>
      )}
      <div style={{ display: 'flex', gap: 2 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: i <= filled ? color : 'var(--border-bright)',
              transition: 'background 0.3s',
            }}
          />
        ))}
      </div>
    </div>
  );
}
