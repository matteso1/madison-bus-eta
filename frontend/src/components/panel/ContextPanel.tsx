import type { TabId } from '../layout/BottomTabs';
import type { StopClickEvent } from '../MapView';
import CityOverview from './map/CityOverview';
import RouteDrilldown from './map/RouteDrilldown';
import StopPredictions from './map/StopPredictions';
import AnalyticsPanel from './analytics/AnalyticsPanel';
import SystemPanel from './system/SystemPanel';

interface ContextPanelProps {
  tab: TabId;
  selectedRoute: string;
  selectedStop: StopClickEvent | null;
  busCount: number;
  delayedCount: number;
  onRouteSelect: (rt: string) => void;
  onStopClear: () => void;
}

export default function ContextPanel({
  tab,
  selectedRoute,
  selectedStop,
  busCount,
  delayedCount,
  onRouteSelect,
  onStopClear,
}: ContextPanelProps) {
  return (
    <div style={{
      width: 380,
      flexShrink: 0,
      height: '100%',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {tab === 'map' && (
        <div className="panel-scroll" style={{ flex: 1 }}>
          {selectedStop ? (
            <StopPredictions stop={selectedStop} onClose={onStopClear} />
          ) : selectedRoute !== 'ALL' ? (
            <RouteDrilldown route={selectedRoute} onClose={() => onRouteSelect('ALL')} />
          ) : (
            <CityOverview
              busCount={busCount}
              delayedCount={delayedCount}
              onRouteSelect={onRouteSelect}
            />
          )}
        </div>
      )}

      {tab === 'analytics' && <AnalyticsPanel />}

      {tab === 'system' && <SystemPanel />}
    </div>
  );
}
