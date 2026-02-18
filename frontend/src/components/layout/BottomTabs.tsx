export type TabId = 'map' | 'analytics' | 'system';

interface BottomTabsProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  busCount: number;
  delayedCount: number;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'map', label: 'MAP' },
  { id: 'analytics', label: 'ANALYTICS' },
  { id: 'system', label: 'SYSTEM' },
];

export default function BottomTabs({ active, onChange, busCount, delayedCount }: BottomTabsProps) {
  return (
    <div style={{
      position: 'absolute',
      bottom: 16,
      left: 16,
      zIndex: 20,
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      background: 'rgba(8,8,16,0.85)',
      backdropFilter: 'blur(12px)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '3px 4px',
    }}>
      {TABS.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            background: active === tab.id ? 'var(--signal-dim)' : 'transparent',
            border: active === tab.id ? '1px solid rgba(0,212,255,0.3)' : '1px solid transparent',
            borderRadius: 7,
            color: active === tab.id ? 'var(--signal)' : 'var(--text-secondary)',
            fontFamily: 'var(--font-data)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.1em',
            padding: '5px 14px',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {tab.label}
        </button>
      ))}

      <div style={{
        height: 20,
        width: 1,
        background: 'var(--border)',
        margin: '0 4px',
      }} />

      <div style={{ padding: '0 8px', fontSize: 11, color: 'var(--text-secondary)' }}>
        <span className="data-num" style={{ color: 'var(--text-primary)' }}>{busCount}</span> buses
        {delayedCount > 0 && (
          <span style={{ color: 'var(--warning)', marginLeft: 8 }} className="data-num">
            {delayedCount} late
          </span>
        )}
      </div>
    </div>
  );
}
