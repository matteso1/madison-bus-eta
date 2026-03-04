interface ArrivalCardProps {
  route: string;
  destination: string;
  minutes: number;
  delayed: boolean;
  confidence?: {
    low: number;
    median: number;
    high: number;
  };
  onTrack?: () => void;
}

export default function ArrivalCard({ route, destination, minutes, delayed, confidence, onTrack }: ArrivalCardProps) {
  const isDue = minutes <= 1;
  const etaColor = isDue ? 'var(--signal)' : 'var(--text-primary)';

  return (
    <div style={{
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '12px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minHeight: 56,
    }}>
      {/* Route badge */}
      <div style={{
        background: 'var(--signal-dim)',
        color: 'var(--signal)',
        fontFamily: 'var(--font-data)',
        fontWeight: 700,
        fontSize: 14,
        padding: '4px 8px',
        borderRadius: 6,
        minWidth: 36,
        textAlign: 'center',
        flexShrink: 0,
      }}>
        {route}
      </div>

      {/* Destination + confidence */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 13,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {destination}
        </div>

        {confidence && (
          <div style={{ marginTop: 4 }}>
            <ConfidenceBar low={confidence.low} median={confidence.median} high={confidence.high} />
          </div>
        )}
      </div>

      {/* ETA */}
      <div style={{
        textAlign: 'right',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
      }}>
        <span className="data-num" style={{
          fontSize: isDue ? 18 : 22,
          fontWeight: 700,
          color: etaColor,
          lineHeight: 1,
        }}>
          {isDue ? 'DUE' : minutes}
        </span>
        {!isDue && (
          <span style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 10,
            color: 'var(--text-secondary)',
            marginTop: 2,
          }}>
            min
          </span>
        )}
        {delayed && (
          <span style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 9,
            color: 'var(--warning)',
            fontWeight: 600,
            marginTop: 2,
          }}>
            DELAYED
          </span>
        )}
      </div>

      {/* Track button */}
      {onTrack && minutes <= 15 && (
        <button
          onClick={(e) => { e.stopPropagation(); onTrack(); }}
          style={{
            background: 'var(--signal-dim)',
            color: 'var(--signal)',
            border: 'none',
            borderRadius: 8,
            padding: '8px 12px',
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
            minHeight: 44,
            minWidth: 44,
          }}
        >
          Track
        </button>
      )}
    </div>
  );
}

function ConfidenceBar({ low, median, high }: { low: number; median: number; high: number }) {
  const range = high - low;
  if (range <= 0) return null;
  const medianPct = ((median - low) / range) * 100;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 14 }}>
      <span className="data-num" style={{ fontSize: 9, color: 'var(--text-dim)' }}>
        {low.toFixed(0)}
      </span>
      <div style={{
        flex: 1,
        height: 3,
        background: 'var(--border)',
        borderRadius: 2,
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          left: `${medianPct}%`,
          top: -2,
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'var(--signal)',
          transform: 'translateX(-50%)',
        }} />
      </div>
      <span className="data-num" style={{ fontSize: 9, color: 'var(--text-dim)' }}>
        {high.toFixed(0)}
      </span>
    </div>
  );
}
