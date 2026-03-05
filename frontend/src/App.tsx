import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import MapView from './components/MapView';
import type { StopClickEvent, VehicleData, TrackedBus, TripPlan, BusClickEvent } from './components/MapView';
import TopBar from './components/layout/TopBar';
import BottomTabs from './components/layout/BottomTabs';
import type { TabId } from './components/layout/BottomTabs';
import ContextPanel from './components/panel/ContextPanel';
import TrackingOverlay from './components/TrackingOverlay';
import BusInfoPanel from './components/BusInfoPanel';
import { useIsMobile } from './hooks/useIsMobile';
import MobileApp from './mobile/MobileApp';

export default function App() {
  const isMobile = useIsMobile();
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
  const [clickedBus, setClickedBus] = useState<BusClickEvent | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

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

  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  // Fetch system-wide bus count when on All Routes view
  useEffect(() => {
    if (selectedRoute !== 'ALL') return;
    const fetchAllBuses = async () => {
      try {
        const res = await axios.get(`${API_BASE}/vehicles`);
        const apiErr = res.data?.['bustime-response']?.error;
        const vehicles = res.data?.['bustime-response']?.vehicle;
        if (apiErr && !vehicles) {
          const errMsg = Array.isArray(apiErr) ? apiErr[0]?.msg || String(apiErr[0]) : (typeof apiErr === 'string' ? apiErr : apiErr.msg || 'API error');
          setApiError(String(errMsg));
          return;
        }
        setApiError(null);
        const arr = Array.isArray(vehicles) ? vehicles : vehicles ? [vehicles] : [];
        setBusCount(arr.length);
        setDelayedCount(arr.filter((v: any) => v.dly === true || v.dly === 'true').length);
      } catch {}
    };
    fetchAllBuses();
    const timer = setInterval(fetchAllBuses, 30000);
    return () => clearInterval(timer);
  }, [selectedRoute, API_BASE]);

  const handleLiveDataUpdated = useCallback((vehicles: VehicleData[], delayed: number) => {
    setBusCount(vehicles.length);
    setDelayedCount(delayed);
    setLiveVehicles(vehicles);
  }, []);

  const handleApiError = useCallback((error: string | null) => {
    setApiError(error);
  }, []);

  const handleStopClick = useCallback((stop: StopClickEvent) => {
    setSelectedStop(stop);
    setTab('map');
    setActiveTripPlan(null);
  }, []);

  const handleRouteSelect = useCallback((rt: string) => {
    setSelectedRoute(rt);
    setSelectedStop(null);
    setTrackedBus(null);
    setActiveTripPlan(null);
  }, []);

  const handleStopClear = useCallback(() => {
    setSelectedStop(null);
  }, []);

  const handleUserLocation = useCallback((lat: number, lon: number) => {
    setUserLocation([lon, lat]);
  }, []);

  const handleBusClick = useCallback((bus: BusClickEvent) => {
    setClickedBus(bus);
  }, []);

  const handleTrackBus = useCallback((bus: TrackedBus) => {
    setTrackedBus(bus);
    setSelectedStop(null);
    setClickedBus(null);
  }, []);

  const handleStopTracking = useCallback(() => {
    setTrackedBus(null);
  }, []);

  const handleTripPlanSelect = useCallback((plan: TripPlan) => {
    setActiveTripPlan(plan);
    setSelectedRoute(plan.routeId);
  }, []);

  const handleTripPlanClear = useCallback(() => {
    setActiveTripPlan(null);
    setSelectedRoute('ALL');
  }, []);

  if (isMobile) {
    return <MobileApp />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      {apiError && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.95)',
          padding: '10px 16px',
          fontFamily: 'var(--font-ui)',
          fontSize: 13,
          lineHeight: 1.5,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          position: 'relative',
        }}>
          <div style={{ flex: 1 }}>
            <strong>Live bus data temporarily unavailable.</strong>{' '}
            Madison Metro's API has run out of requests. This is outside our control and will reset automatically.{' '}
            Help by emailing{' '}
            <a href="mailto:mymetrobus@cityofmadison.com?subject=API%20Rate%20Limit%20Increase%20Request%20for%20Madison%20Bus%20ETA&body=Hi%20Madison%20Metro%20team%2C%0A%0AI%20use%20the%20Madison%20Bus%20ETA%20app%20(madisonbuseta.com)%20to%20check%20live%20bus%20arrivals%20and%20it%20has%20been%20really%20helpful.%20Unfortunately%20the%20app%20sometimes%20hits%20the%20API%20request%20limit.%20Would%20it%20be%20possible%20to%20increase%20the%20API%20quota%3F%0A%0AThank%20you!" style={{ color: '#fff', textDecoration: 'underline' }}>
              mymetrobus@cityofmadison.com
            </a>{' '}
            to request a higher API limit.
          </div>
          <button onClick={() => setApiError(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', opacity: 0.7, padding: 4 }}>x</button>
        </div>
      )}
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
            selectedStop={selectedStop}
            userLocation={userLocation}
            trackedBus={trackedBus}
            activeTripPlan={activeTripPlan}
            onRoutesLoaded={handleRoutesLoaded}
            onLiveDataUpdated={handleLiveDataUpdated}
            onStopClick={handleStopClick}
            onBusClick={handleBusClick}
            onApiError={handleApiError}
          />

          {trackedBus && (
            <TrackingOverlay
              trackedBus={trackedBus}
              vehicles={liveVehicles}
              onStopTracking={handleStopTracking}
            />
          )}

          {clickedBus && !trackedBus && (
            <BusInfoPanel
              bus={clickedBus}
              onClose={() => setClickedBus(null)}
              onTrackBus={handleTrackBus}
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
          onUserLocation={handleUserLocation}
          onTrackBus={handleTrackBus}
          onTripPlanSelect={handleTripPlanSelect}
          onTripPlanClear={handleTripPlanClear}
          activeTripPlan={activeTripPlan}
        />
      </div>
    </div>
  );
}
