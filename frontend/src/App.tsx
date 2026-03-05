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
        if (apiErr) {
          const errMsg = Array.isArray(apiErr) ? apiErr[0]?.msg || String(apiErr[0]) : (typeof apiErr === 'string' ? apiErr : apiErr.msg || 'API error');
          setApiError(String(errMsg));
          return;
        }
        const arr = Array.isArray(vehicles) ? vehicles : vehicles ? [vehicles] : [];
        // If 0 buses during service hours (6am-11pm), likely API quota exhausted
        const hour = new Date().getHours();
        if (arr.length === 0 && hour >= 6 && hour < 23) {
          setApiError('No buses returned — Madison Metro API may be out of requests.');
        } else {
          setApiError(null);
        }
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
            <a href="mailto:mymetrobus@cityofmadison.com?subject=API%20Rate%20Limit%20Increase%20Request%20%E2%80%94%20Madison%20Bus%20ETA%20%28madisonbuseta.com%29&body=Hi%20Madison%20Metro%20team%2C%0A%0AI%27m%20a%20UW-Madison%20student%20who%20regularly%20uses%20Madison%20Bus%20ETA%20%28madisonbuseta.com%29%2C%20a%20free%20app%20built%20by%20a%20fellow%20Badger%20that%20provides%20ML-powered%20real-time%20bus%20arrival%20predictions.%20It%20has%20become%20a%20go-to%20tool%20for%20students%20trying%20to%20catch%20buses%20in%20the%20Wisconsin%20cold.%0A%0AThe%20app%20relies%20on%20the%20public%20bus%20tracker%20API%2C%20but%20it%20occasionally%20runs%20out%20of%20its%20daily%20request%20allotment%2C%20which%20means%20live%20bus%20data%20goes%20dark%20for%20all%20users.%20A%20higher%20API%20quota%20would%20make%20a%20big%20difference%20for%20the%20students%20and%20community%20members%20who%20depend%20on%20it.%0A%0AYou%20can%20learn%20more%20about%20the%20project%20here%3A%20https%3A%2F%2Fwww.linkedin.com%2Fposts%2Fnilsmatteson_madison-uwmadison-transit-share-7431096513965142017-AYy4%0A%0AThe%20developer%20can%20be%20reached%20at%20nilsmatteson%40wisc.edu%20or%20nilsmatteson%40icloud.com%20if%20you%20would%20like%20to%20discuss%20this%20further.%0A%0AThank%20you%20for%20the%20great%20transit%20system%20and%20for%20considering%20this%20request%21" style={{ color: '#fff', textDecoration: 'underline' }}>
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
