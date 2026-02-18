import { useState } from 'react';
import type { TabId } from '../layout/BottomTabs';
import type { StopClickEvent, TrackedBus, TripPlan } from '../MapView';
import CityOverview from './map/CityOverview';
import RouteDrilldown from './map/RouteDrilldown';
import StopPredictions from './map/StopPredictions';
import NearbyStops from './map/NearbyStops';
import TripPlanner from './map/TripPlanner';
import AnalyticsPanel from './analytics/AnalyticsPanel';
import SystemPanel from './system/SystemPanel';

interface ContextPanelProps {
  tab: TabId;
  selectedRoute: string;
  selectedStop: StopClickEvent | null;
  busCount: number;
  delayedCount: number;
  userLocation: [number, number] | null;
  onRouteSelect: (rt: string) => void;
  onStopClear: () => void;
  onStopSelect: (stop: StopClickEvent) => void;
  onUserLocation: (lat: number, lon: number) => void;
  onTrackBus: (bus: TrackedBus) => void;
  onTripPlanSelect: (plan: TripPlan) => void;
  onTripPlanClear: () => void;
  activeTripPlan: TripPlan | null;
}

export default function ContextPanel({
  tab,
  selectedRoute,
  selectedStop,
  busCount,
  delayedCount,
  userLocation,
  onRouteSelect,
  onStopClear,
  onStopSelect,
  onUserLocation,
  onTrackBus,
  onTripPlanSelect,
  onTripPlanClear,
  activeTripPlan,
}: ContextPanelProps) {
  const [showNearby, setShowNearby] = useState(false);
  const [showTripPlanner, setShowTripPlanner] = useState(false);

  const handleRouteSelect = (rt: string) => {
    setShowNearby(false);
    setShowTripPlanner(false);
    onRouteSelect(rt);
  };

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
            <StopPredictions stop={selectedStop} onClose={onStopClear} onTrackBus={onTrackBus} />
          ) : showTripPlanner ? (
            <TripPlanner
              userLocation={userLocation}
              onBack={() => { setShowTripPlanner(false); onTripPlanClear(); }}
              onTripSelect={onTripPlanSelect}
              onUserLocation={onUserLocation}
              activePlan={activeTripPlan}
            />
          ) : showNearby ? (
            <NearbyStops
              onBack={() => setShowNearby(false)}
              onUserLocation={onUserLocation}
              onStopSelect={(stpid, stpnm, route) => {
                setShowNearby(false);
                onStopSelect({ stpid, stpnm, route });
              }}
            />
          ) : selectedRoute !== 'ALL' ? (
            <RouteDrilldown route={selectedRoute} onClose={() => handleRouteSelect('ALL')} />
          ) : (
            <CityOverview
              busCount={busCount}
              delayedCount={delayedCount}
              onRouteSelect={handleRouteSelect}
              onNearMe={() => setShowNearby(true)}
              onTripPlan={() => setShowTripPlanner(true)}
            />
          )}
        </div>
      )}

      {tab === 'analytics' && <AnalyticsPanel />}

      {tab === 'system' && <SystemPanel />}
    </div>
  );
}
