import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import MapView from '../components/MapView';
import type { TrackedBus, VehicleData, StopClickEvent, BusClickEvent, TripPlan } from '../components/MapView';
import BottomSheet from './BottomSheet';
import NearbyStops from './NearbyStops';
import StopArrivals from './StopArrivals';
import MobileTripPlanner from './MobileTripPlanner';
import TrackingBar from './TrackingBar';

type MobileView = 'nearby' | 'stop' | 'tracking';
type SheetState = 'peek' | 'half' | 'full';

export default function MobileApp() {
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [trackedBus, setTrackedBus] = useState<TrackedBus | null>(null);
  const [selectedRoute, setSelectedRoute] = useState('ALL');
  const [view, setView] = useState<MobileView>('nearby');
  const [sheetState, setSheetState] = useState<SheetState>('half');
  const [trackedDestination, setTrackedDestination] = useState('');
  const [selectedStop, setSelectedStop] = useState<{ stpid: string; stpnm: string; lat: number; lon: number; distance: number } | null>(null);
  const [trackingMinutes, setTrackingMinutes] = useState<number | null>(null);
  const [trackingStopName, setTrackingStopName] = useState<string>('');
  const [activeTripPlan, setActiveTripPlan] = useState<TripPlan | null>(null);
  const [showTripPlanner, setShowTripPlanner] = useState(false);
  const [flyToTrigger, setFlyToTrigger] = useState(0);
  const [apiError, setApiError] = useState<string | null>(null);

  // Geolocation on mount
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation([pos.coords.longitude, pos.coords.latitude]);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, []);

  const handleRoutesLoaded = useCallback((_r: Array<{ rt: string; rtnm: string }>) => {
    // Routes loaded by MapView -- mobile doesn't need to store them
  }, []);

  const handleLiveDataUpdated = useCallback((_vehicles: VehicleData[], _delayed: number) => {
    // Live data updates from MapView -- mobile uses NearbyStops for arrivals
  }, []);

  const handleStopClick = useCallback((stop: StopClickEvent) => {
    const lat = stop.lat ?? 0;
    const lon = stop.lon ?? 0;
    setSelectedStop({ stpid: stop.stpid, stpnm: stop.stpnm, lat, lon, distance: 0 });
    setView('stop');
    setSheetState('half');
  }, []);

  const handleBusClick = useCallback((bus: BusClickEvent) => {
    setSelectedRoute(bus.route);
  }, []);

  const handleApiError = useCallback((error: string | null) => {
    setApiError(error);
  }, []);

  const handleRouteClick = useCallback((routeId: string) => {
    setSelectedRoute(routeId);
  }, []);

  const handleShowAll = useCallback(() => {
    setSelectedRoute('ALL');
    setTrackedBus(null);
    setTrackedDestination('');
    setTrackingMinutes(null);
    setTrackingStopName('');
    setView('nearby');
    setSheetState('half');
  }, []);

  const handleStopSelect = useCallback((stop: { stpid: string; stpnm: string; lat: number; lon: number }, distance: number) => {
    setSelectedStop({ ...stop, distance });
    setView('stop');
    setSheetState('half');
  }, []);

  const handleBackToNearby = useCallback(() => {
    setSelectedStop(null);
    setView('nearby');
    setSheetState('half');
  }, []);

  const handleTripSelect = useCallback((plan: TripPlan) => {
    setActiveTripPlan(plan);
    setSelectedRoute(plan.routeId);
    setSheetState('peek');
  }, []);

  const handleTripClose = useCallback(() => {
    setShowTripPlanner(false);
    setActiveTripPlan(null);
    setSelectedRoute('ALL');
  }, []);

  const handleTrackBus = useCallback((vid: string, route: string, destination: string) => {
    setTrackedBus({
      vid,
      route,
      stopId: '',
      stopName: '',
    });
    setTrackedDestination(destination);
    setSelectedRoute(route);
    setView('tracking');
    setSheetState('peek');
    setShowTripPlanner(false);
    setActiveTripPlan(null);
  }, []);

  const handleStopTracking = useCallback(() => {
    setTrackedBus(null);
    setTrackedDestination('');
    setTrackingMinutes(null);
    setTrackingStopName('');
    setSelectedRoute('ALL');
    setView('nearby');
    setSheetState('half');
  }, []);

  const handleLocateMe = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation([pos.coords.longitude, pos.coords.latitude]);
        setFlyToTrigger(prev => prev + 1);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  // Poll live ETA when tracking a bus
  useEffect(() => {
    if (!trackedBus) return;
    let cancelled = false;
    const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

    async function fetchTrackingETA() {
      try {
        const res = await axios.get(`${API_BASE}/predictions?vid=${trackedBus!.vid}`);
        const preds = res.data?.['bustime-response']?.prd || [];
        const predArr = Array.isArray(preds) ? preds : [preds];
        if (predArr.length > 0 && !cancelled) {
          const first = predArr[0];
          const mins = first.prdctdn === 'DUE' ? 0 : (first.prdctdn === 'DLY' ? null : parseInt(first.prdctdn));
          setTrackingMinutes(mins);
          setTrackingStopName(first.stpnm || '');
        }
      } catch { /* tracking poll failed */ }
    }

    fetchTrackingETA();
    const timer = setInterval(fetchTrackingETA, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [trackedBus]);

  return (
    <div style={{
      height: '100dvh',
      width: '100vw',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* API error banner */}
      {apiError && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          background: 'rgba(239, 68, 68, 0.95)',
          padding: '12px 16px',
          fontFamily: 'var(--font-ui)',
          fontSize: 13,
          lineHeight: 1.5,
          color: '#fff',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Live bus data temporarily unavailable</div>
          <div style={{ opacity: 0.9 }}>
            Madison Metro's API has run out of requests for now. This is a limitation of the free API tier
            and is outside our control. Data will resume automatically when the limit resets.
          </div>
          <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>
            Want to help? Email{' '}
            <a href="mailto:mymetrobus@cityofmadison.com?subject=API%20Rate%20Limit%20Increase%20Request%20%E2%80%94%20Madison%20Bus%20ETA%20%28madisonbuseta.com%29&body=Hi%20Madison%20Metro%20team%2C%0A%0AI%27m%20a%20UW-Madison%20student%20who%20regularly%20uses%20Madison%20Bus%20ETA%20%28madisonbuseta.com%29%2C%20a%20free%20app%20built%20by%20a%20fellow%20Badger%20that%20provides%20ML-powered%20real-time%20bus%20arrival%20predictions.%20It%20has%20become%20a%20go-to%20tool%20for%20students%20trying%20to%20catch%20buses%20in%20the%20Wisconsin%20cold.%0A%0AThe%20app%20relies%20on%20the%20public%20bus%20tracker%20API%2C%20but%20it%20occasionally%20runs%20out%20of%20its%20daily%20request%20allotment%2C%20which%20means%20live%20bus%20data%20goes%20dark%20for%20all%20users.%20A%20higher%20API%20quota%20would%20make%20a%20big%20difference%20for%20the%20students%20and%20community%20members%20who%20depend%20on%20it.%0A%0AYou%20can%20learn%20more%20about%20the%20project%20here%3A%20https%3A%2F%2Fwww.linkedin.com%2Fposts%2Fnilsmatteson_madison-uwmadison-transit-share-7431096513965142017-AYy4%0A%0AThe%20developer%20can%20be%20reached%20at%20nilsmatteson%40wisc.edu%20or%20nilsmatteson%40icloud.com%20if%20you%20would%20like%20to%20discuss%20this%20further.%0A%0AThank%20you%20for%20the%20great%20transit%20system%20and%20for%20considering%20this%20request%21" style={{ color: '#fff', textDecoration: 'underline' }}>
              mymetrobus@cityofmadison.com
            </a>{' '}
            to request a higher API limit for Madison Bus ETA.
          </div>
          <button
            onClick={() => setApiError(null)}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: 'none',
              border: 'none',
              color: '#fff',
              fontSize: 18,
              cursor: 'pointer',
              opacity: 0.7,
              padding: 4,
            }}
          >x</button>
        </div>
      )}

      {/* Map fills entire screen */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <MapView
          selectedRoute={selectedRoute}
          selectedStop={null}
          userLocation={userLocation}
          trackedBus={trackedBus}
          activeTripPlan={activeTripPlan}
          flyToTrigger={flyToTrigger}
          onRoutesLoaded={handleRoutesLoaded}
          onLiveDataUpdated={handleLiveDataUpdated}
          onStopClick={handleStopClick}
          onBusClick={handleBusClick}
          showAllBuses={true}
          onRouteClick={handleRouteClick}
          onApiError={handleApiError}
        />

        {/* Locate me button */}
        <button
          onClick={handleLocateMe}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            width: 44,
            height: 44,
            borderRadius: 22,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--signal)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 5,
            fontSize: 18,
          }}
          aria-label="Locate me"
        >
          {/* Simple crosshair icon */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
          </svg>
        </button>

        {selectedRoute !== 'ALL' && !trackedBus && !activeTripPlan && (
          <button
            onClick={handleShowAll}
            style={{
              position: 'absolute',
              top: 16,
              left: 16,
              padding: '8px 14px',
              borderRadius: 20,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              zIndex: 5,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              backdropFilter: 'blur(8px)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            All Routes
          </button>
        )}

        {selectedRoute !== 'ALL' && !trackedBus && !activeTripPlan && (
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 130,
              padding: '8px 12px',
              borderRadius: 20,
              background: 'var(--signal)',
              color: '#080810',
              fontFamily: 'var(--font-data)',
              fontSize: 13,
              fontWeight: 700,
              zIndex: 5,
            }}
          >
            Route {selectedRoute}
          </div>
        )}
      </div>

      {/* Bottom sheet */}
      <BottomSheet
        state={sheetState}
        onStateChange={setSheetState}
      >
        {view === 'tracking' && trackedBus ? (
          <TrackingBar
            route={trackedBus.route}
            destination={trackedDestination}
            minutes={trackingMinutes}
            nextStop={trackingStopName}
            onStopTracking={handleStopTracking}
          />
        ) : view === 'stop' && selectedStop ? (
          <StopArrivals
            stop={selectedStop}
            distance={selectedStop.distance}
            onBack={handleBackToNearby}
            onTrackBus={handleTrackBus}
          />
        ) : showTripPlanner ? (
          <MobileTripPlanner
            userLocation={userLocation}
            onTripSelect={handleTripSelect}
            onClose={handleTripClose}
            activePlan={activeTripPlan}
          />
        ) : (
          <>
            <button
              onClick={() => {
                setShowTripPlanner(true);
                setSheetState('full');
              }}
              style={{
                width: '100%',
                padding: '14px 16px',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-ui)',
                fontSize: 14,
                textAlign: 'left',
                cursor: 'pointer',
                marginBottom: 16,
                minHeight: 44,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Where to?
            </button>
            <NearbyStops
              userLocation={userLocation}
              onStopSelect={handleStopSelect}
              onTrackBus={handleTrackBus}
            />
          </>
        )}
      </BottomSheet>
    </div>
  );
}
