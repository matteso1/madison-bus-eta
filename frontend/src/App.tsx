import { useState, useCallback, useEffect } from 'react';
import MapView from './components/MapView';
import type { StopClickEvent, VehicleData, TrackedBus, TripPlan } from './components/MapView';
import TopBar from './components/layout/TopBar';
import BottomTabs from './components/layout/BottomTabs';
import type { TabId } from './components/layout/BottomTabs';
import ContextPanel from './components/panel/ContextPanel';
import TrackingOverlay from './components/TrackingOverlay';

export default function App() {
  const [tab, setTab] = useState<TabId>('map');
  const [selectedRoute, setSelectedRoute] = useState('ALL');
  const [selectedStop, setSelectedStop] = useState<StopClickEvent | null>(null);
  const [routes, setRoutes] = useState<Array<{ rt: string; rtnm: string }>>([]);
  const [busCount, setBusCount] = useState(0);
  const [delayedCount, setDelayedCount] = useState(0);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [trackedBus, setTrackedBus] = useState<TrackedBus | null>(null);
  const [activeTripPlan, setActiveTripPlan] = useState<TripPlan | null>(null);
  const [liveVehicles, setLiveVehicles] = useState<VehicleData[]>([]);
  const [highlightedStops, setHighlightedStops] = useState<Array<{stpid: string; stpnm: string; lat: number; lon: number; routes: string[]}>>([]);

  // Auto-request geolocation on mount
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation([pos.coords.longitude, pos.coords.latitude]);
      },
      () => {},
      { timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  const handleRoutesLoaded = useCallback((r: Array<{ rt: string; rtnm: string }>) => {
    setRoutes(r);
  }, []);

  const handleLiveDataUpdated = useCallback((vehicles: VehicleData[], delayed: number) => {
    setBusCount(vehicles.length);
    setDelayedCount(delayed);
    setLiveVehicles(vehicles);
  }, []);

  const handleNearbyStopsLoaded = useCallback((stops: Array<{stpid: string; stpnm: string; lat: number; lon: number; routes: string[]}>) => {
    setHighlightedStops(stops);
  }, []);

  const handleStopClick = useCallback((stop: StopClickEvent) => {
    setSelectedStop(stop);
    setTab('map');
    setActiveTripPlan(null);
    setHighlightedStops([]);
  }, []);

  const handleRouteSelect = useCallback((rt: string) => {
    setSelectedRoute(rt);
    setSelectedStop(null);
    setTrackedBus(null);
    setActiveTripPlan(null);
    setHighlightedStops([]);
  }, []);

  const handleStopClear = useCallback(() => {
    setSelectedStop(null);
  }, []);

  const handleUserLocation = useCallback((lat: number, lon: number) => {
    setUserLocation([lon, lat]);
  }, []);

  const handleTrackBus = useCallback((bus: TrackedBus) => {
    setTrackedBus(bus);
    setSelectedStop(null);
  }, []);

  const handleStopTracking = useCallback(() => {
    setTrackedBus(null);
  }, []);

  const handleTripPlanSelect = useCallback((plan: TripPlan) => {
    setActiveTripPlan(plan);
    setSelectedRoute(plan.routeId);
    setHighlightedStops([]);
  }, []);

  const handleTripPlanClear = useCallback(() => {
    setActiveTripPlan(null);
    setSelectedRoute('ALL');
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
            trackedBus={trackedBus}
            activeTripPlan={activeTripPlan}
            highlightedStops={highlightedStops}
            onRoutesLoaded={handleRoutesLoaded}
            onLiveDataUpdated={handleLiveDataUpdated}
            onStopClick={handleStopClick}
          />

          {trackedBus && (
            <TrackingOverlay
              trackedBus={trackedBus}
              vehicles={liveVehicles}
              onStopTracking={handleStopTracking}
            />
          )}

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
          userLocation={userLocation}
          onRouteSelect={handleRouteSelect}
          onStopClear={handleStopClear}
          onStopSelect={handleStopClick}
          onUserLocation={handleUserLocation}
          onTrackBus={handleTrackBus}
          onTripPlanSelect={handleTripPlanSelect}
          onTripPlanClear={handleTripPlanClear}
          activeTripPlan={activeTripPlan}
          onNearbyStopsLoaded={handleNearbyStopsLoaded}
        />
      </div>
    </div>
  );
}
