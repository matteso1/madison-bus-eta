import { useState, useCallback } from 'react';
import MapView from './components/MapView';
import type { StopClickEvent, VehicleData } from './components/MapView';
import TopBar from './components/layout/TopBar';
import BottomTabs from './components/layout/BottomTabs';
import type { TabId } from './components/layout/BottomTabs';
import ContextPanel from './components/panel/ContextPanel';

export default function App() {
  const [tab, setTab] = useState<TabId>('map');
  const [selectedRoute, setSelectedRoute] = useState('ALL');
  const [selectedStop, setSelectedStop] = useState<StopClickEvent | null>(null);
  const [routes, setRoutes] = useState<Array<{ rt: string; rtnm: string }>>([]);
  const [busCount, setBusCount] = useState(0);
  const [delayedCount, setDelayedCount] = useState(0);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);

  const handleRoutesLoaded = useCallback((r: Array<{ rt: string; rtnm: string }>) => {
    setRoutes(r);
  }, []);

  const handleLiveDataUpdated = useCallback((vehicles: VehicleData[], delayed: number) => {
    setBusCount(vehicles.length);
    setDelayedCount(delayed);
  }, []);

  const handleStopClick = useCallback((stop: StopClickEvent) => {
    setSelectedStop(stop);
    setTab('map');
  }, []);

  const handleRouteSelect = useCallback((rt: string) => {
    setSelectedRoute(rt);
    setSelectedStop(null);
  }, []);

  const handleStopClear = useCallback(() => {
    setSelectedStop(null);
  }, []);

  const handleUserLocation = useCallback((lat: number, lon: number) => {
    setUserLocation([lon, lat]); // DeckGL uses [lon, lat]
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <TopBar
        busCount={busCount}
        delayedCount={delayedCount}
        selectedRoute={selectedRoute}
        routes={routes}
        onRouteChange={handleRouteSelect}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <MapView
            selectedRoute={selectedRoute}
            userLocation={userLocation}
            onRoutesLoaded={handleRoutesLoaded}
            onLiveDataUpdated={handleLiveDataUpdated}
            onStopClick={handleStopClick}
          />

          <BottomTabs
            active={tab}
            onChange={setTab}
            busCount={busCount}
            delayedCount={delayedCount}
          />
        </div>

        <ContextPanel
          tab={tab}
          selectedRoute={selectedRoute}
          selectedStop={selectedStop}
          busCount={busCount}
          delayedCount={delayedCount}
          onRouteSelect={handleRouteSelect}
          onStopClear={handleStopClear}
          onStopSelect={handleStopClick}
          onUserLocation={handleUserLocation}
        />
      </div>
    </div>
  );
}
