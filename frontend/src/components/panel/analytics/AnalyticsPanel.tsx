import { useState } from 'react';
import PerformanceTab from './PerformanceTab';
import ErrorsTab from './ErrorsTab';
import RoutesTab from './RoutesTab';

type SubTab = 'performance' | 'errors' | 'routes';

const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: 'performance', label: 'Performance' },
  { id: 'errors', label: 'Errors' },
  { id: 'routes', label: 'Routes' },
];

export default function AnalyticsPanel() {
  const [sub, setSub] = useState<SubTab>('performance');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sub-pill navigation */}
      <div style={{
        display: 'flex',
        gap: 4,
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setSub(tab.id)}
            style={{
              background: sub === tab.id ? 'var(--surface-2)' : 'transparent',
              border: `1px solid ${sub === tab.id ? 'var(--border-bright)' : 'transparent'}`,
              borderRadius: 6,
              color: sub === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: 11,
              padding: '4px 12px',
              cursor: 'pointer',
              transition: 'all 0.15s',
              fontFamily: 'var(--font-ui)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="panel-scroll" style={{ flex: 1 }}>
        {sub === 'performance' && <PerformanceTab />}
        {sub === 'errors' && <ErrorsTab />}
        {sub === 'routes' && <RoutesTab />}
      </div>
    </div>
  );
}
