interface TrackingBarProps {
  route: string;
  destination: string;
  minutes: number | null;
  onStopTracking: () => void;
}

export default function TrackingBar({ route, destination, minutes, onStopTracking }: TrackingBarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '4px 0',
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
      }}>
        {route}
      </div>

      {/* Destination */}
      <div style={{
        flex: 1,
        fontFamily: 'var(--font-ui)',
        fontSize: 13,
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {destination}
      </div>

      {/* ETA */}
      {minutes !== null && (
        <span className="data-num" style={{
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--signal)',
        }}>
          {minutes <= 1 ? 'DUE' : `${minutes}m`}
        </span>
      )}

      {/* Stop button */}
      <button
        onClick={onStopTracking}
        style={{
          background: 'var(--danger)',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: '8px 14px',
          fontFamily: 'var(--font-ui)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          minHeight: 44,
        }}
      >
        Stop
      </button>
    </div>
  );
}
