type Status = 'OK' | 'EXCELLENT' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';

const STATUS_COLORS: Record<Status, { bg: string; text: string }> = {
  OK:       { bg: 'rgba(16,185,129,0.15)', text: '#10b981' },
  EXCELLENT:{ bg: 'rgba(0,212,255,0.12)',  text: '#00d4ff' },
  WARNING:  { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b' },
  CRITICAL: { bg: 'rgba(239,68,68,0.15)',  text: '#ef4444' },
  UNKNOWN:  { bg: 'rgba(100,116,139,0.15)',text: '#64748b' },
};

interface StatusBadgeProps {
  status: string;
  small?: boolean;
}

export default function StatusBadge({ status, small }: StatusBadgeProps) {
  const key = status?.toUpperCase() as Status;
  const colors = STATUS_COLORS[key] || STATUS_COLORS.UNKNOWN;
  return (
    <span style={{
      background: colors.bg,
      color: colors.text,
      border: `1px solid ${colors.text}30`,
      borderRadius: 4,
      padding: small ? '1px 6px' : '2px 8px',
      fontSize: small ? 9 : 10,
      fontFamily: 'var(--font-data)',
      fontWeight: 600,
      letterSpacing: '0.06em',
    }}>
      {key}
    </span>
  );
}
