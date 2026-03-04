import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import MapView from '../components/MapView';
import type { TrackedBus, VehicleData, StopClickEvent, BusClickEvent } from '../components/MapView';
import BottomSheet from './BottomSheet';
import NearbyStops from './NearbyStops';
import StopArrivals from './StopArrivals';
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

  const handleStopClick = useCallback((_stop: StopClickEvent) => {
    // On mobile, stop clicks are handled via NearbyStops, not map taps
  }, []);

  const handleBusClick = useCallback((_bus: BusClickEvent) => {
    // On mobile, bus interaction is through the bottom sheet
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
      {/* Map fills entire screen */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <MapView
          selectedRoute={selectedRoute}
          selectedStop={null}
          userLocation={userLocation}
          trackedBus={trackedBus}
          activeTripPlan={null}
          onRoutesLoaded={handleRoutesLoaded}
          onLiveDataUpdated={handleLiveDataUpdated}
          onStopClick={handleStopClick}
          onBusClick={handleBusClick}
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
        ) : (
          <NearbyStops
            userLocation={userLocation}
            onStopSelect={handleStopSelect}
            onTrackBus={handleTrackBus}
          />
        )}
      </BottomSheet>
    </div>
  );
}
