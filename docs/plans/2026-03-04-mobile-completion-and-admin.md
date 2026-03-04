# Mobile Feature Completion + Admin Analytics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the mobile rider experience (StopArrivals, live tracking ETA, trip planner) and add a password-protected admin analytics page.

**Architecture:** Four independent features built on the existing mobile component tree and Flask backend. StopArrivals and TrackingBar ETA are small additions to MobileApp state. The trip planner reuses the existing `/api/trip-plan` + Nominatim + OSRM stack from desktop. Admin analytics adds a `usage_events` table, request-logging middleware, and a Flask-rendered HTML dashboard.

**Tech Stack:** React 19, TypeScript, framer-motion, Flask, PostgreSQL, Jinja2 templates

---

### Task 1: StopArrivals Component

Create the expanded stop arrivals view that shows all upcoming buses at a selected stop with confidence bands.

**Files:**
- Create: `frontend/src/mobile/StopArrivals.tsx`

**Context:**
- The `ArrivalCard` component already exists at `frontend/src/mobile/ArrivalCard.tsx` and accepts an optional `confidence` prop with `{ low, median, high }`.
- The desktop `StopPredictions` component fetches `/predictions?stpid=` and then `/api/conformal-prediction` in parallel for confidence bands.
- The conformal prediction endpoint is `POST /api/conformal-prediction` with body `{ route, stop_id, api_prediction_min, vehicle_id }`. Response: `{ eta_low_min, eta_median_min, eta_high_min, confidence, stratum, model_available }`.

**Implementation:**

```tsx
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import ArrivalCard from './ArrivalCard';

const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

interface Stop {
  stpid: string;
  stpnm: string;
  lat: number;
  lon: number;
}

interface Prediction {
  route: string;
  destination: string;
  minutes: number;
  vid: string;
  delayed: boolean;
}

interface ConformalResult {
  eta_low_min: number;
  eta_median_min: number;
  eta_high_min: number;
  model_available: boolean;
}

interface StopArrivalsProps {
  stop: Stop;
  distance: number;
  onBack: () => void;
  onTrackBus: (vid: string, route: string, destination: string) => void;
}

export default function StopArrivals({ stop, distance, onBack, onTrackBus }: StopArrivalsProps) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [conformalMap, setConformalMap] = useState<Record<string, ConformalResult>>({});
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function fetchPredictions() {
      try {
        const res = await axios.get(`${API_BASE}/predictions?stpid=${stop.stpid}`);
        const preds = res.data?.['bustime-response']?.prd || [];
        const predArr = Array.isArray(preds) ? preds : [preds];

        const filtered = predArr
          .filter((p: any) => p.prdctdn !== 'DLY' && (p.prdctdn === 'DUE' || parseInt(p.prdctdn) <= 30))
          .map((p: any) => ({
            route: p.rt,
            destination: p.des,
            minutes: p.prdctdn === 'DUE' ? 0 : parseInt(p.prdctdn),
            vid: p.vid,
            delayed: p.dly === true || p.dly === 'true',
          }));

        if (cancelledRef.current) return;
        setPredictions(filtered);
        setLoading(false);

        // Fetch conformal predictions in parallel (non-blocking)
        const conformal: Record<string, ConformalResult> = {};
        await Promise.all(
          filtered.map(async (pred: Prediction) => {
            try {
              const res = await axios.post(`${API_BASE}/api/conformal-prediction`, {
                route: pred.route,
                stop_id: stop.stpid,
                api_prediction_min: pred.minutes,
                vehicle_id: pred.vid,
              });
              if (res.data?.model_available) {
                conformal[pred.vid] = res.data;
              }
            } catch {}
          })
        );
        if (!cancelledRef.current) setConformalMap(conformal);
      } catch (err) {
        console.error('StopArrivals fetch failed:', err);
        if (!cancelledRef.current) setLoading(false);
      }
    }

    fetchPredictions();
    const timer = setInterval(fetchPredictions, 15000);
    return () => {
      cancelledRef.current = true;
      clearInterval(timer);
    };
  }, [stop.stpid]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header with back button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--signal)',
            fontSize: 18,
            cursor: 'pointer',
            padding: '4px 8px',
            minHeight: 44,
            minWidth: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="Back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            {stop.stpnm}
          </div>
          <span className="data-num" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {distance < 1000 ? `${Math.round(distance)}m` : `${(distance / 1000).toFixed(1)}km`}
          </span>
        </div>
      </div>

      {/* Arrivals list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
          Loading arrivals...
        </div>
      ) : predictions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
          No buses arriving in the next 30 minutes
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {predictions.map((pred) => {
            const conf = conformalMap[pred.vid];
            return (
              <ArrivalCard
                key={pred.vid}
                route={pred.route}
                destination={pred.destination}
                minutes={pred.minutes}
                delayed={pred.delayed}
                confidence={conf ? { low: conf.eta_low_min, median: conf.eta_median_min, high: conf.eta_high_min } : undefined}
                onTrack={() => onTrackBus(pred.vid, pred.route, pred.destination)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
```

**Commit:** `git add frontend/src/mobile/StopArrivals.tsx && git commit -m "feat: add StopArrivals expanded view component"`

---

### Task 2: Wire StopArrivals into MobileApp

Add the `stop` view state to MobileApp so tapping a stop name in NearbyStops opens StopArrivals.

**Files:**
- Modify: `frontend/src/mobile/MobileApp.tsx`

**Changes:**

1. Add import for StopArrivals:
```tsx
import StopArrivals from './StopArrivals';
```

2. Add state for the selected stop (after `trackedDestination` state):
```tsx
const [selectedStop, setSelectedStop] = useState<{ stpid: string; stpnm: string; lat: number; lon: number; distance: number } | null>(null);
```

3. Add `handleStopSelect` callback (replace the existing empty `onStopSelect` logic):
```tsx
const handleStopSelect = useCallback((stop: { stpid: string; stpnm: string; lat: number; lon: number }, distance: number) => {
  setSelectedStop({ ...stop, distance });
  setView('stop');
  setSheetState('half');
}, []);
```

4. Add `handleBackToNearby` callback:
```tsx
const handleBackToNearby = useCallback(() => {
  setSelectedStop(null);
  setView('nearby');
  setSheetState('half');
}, []);
```

5. Update the BottomSheet content to handle `view === 'stop'`:
```tsx
{view === 'tracking' && trackedBus ? (
  <TrackingBar
    route={trackedBus.route}
    destination={trackedDestination}
    minutes={null}
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
```

6. Update the `NearbyStops` `onStopSelect` prop type. The current `NearbyStops` component's `onStopSelect` takes `(stop: Stop) => void`. We need to also pass the distance. Modify `NearbyStops.tsx` interface:

In `frontend/src/mobile/NearbyStops.tsx`, change the interface:
```tsx
interface NearbyStopsProps {
  userLocation: [number, number] | null;
  onStopSelect: (stop: Stop, distance: number) => void;  // added distance param
  onTrackBus: (vid: string, route: string, destination: string) => void;
}
```

And update the stop name button's onClick:
```tsx
onClick={() => onStopSelect(item.stop, item.distance)}
```

**Commit:** `git add frontend/src/mobile/MobileApp.tsx frontend/src/mobile/NearbyStops.tsx && git commit -m "feat: wire StopArrivals into MobileApp with stop view state"`

---

### Task 3: TrackingBar Live ETA Polling

Add prediction polling to MobileApp when tracking a bus, and pass live minutes to TrackingBar.

**Files:**
- Modify: `frontend/src/mobile/MobileApp.tsx`
- Modify: `frontend/src/mobile/TrackingBar.tsx`

**Changes to MobileApp.tsx:**

1. Add state for tracking ETA (after `trackedDestination` state):
```tsx
const [trackingMinutes, setTrackingMinutes] = useState<number | null>(null);
const [trackingStopName, setTrackingStopName] = useState<string>('');
```

2. Add a `useEffect` that polls predictions when tracking:
```tsx
// Poll predictions for tracked bus every 15 seconds
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
    } catch {
      // Prediction fetch failed, keep existing value
    }
  }

  fetchTrackingETA();
  const timer = setInterval(fetchTrackingETA, 15000);
  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}, [trackedBus]);
```

3. Reset tracking ETA when stopping tracking. In `handleStopTracking`:
```tsx
const handleStopTracking = useCallback(() => {
  setTrackedBus(null);
  setTrackedDestination('');
  setTrackingMinutes(null);
  setTrackingStopName('');
  setSelectedRoute('ALL');
  setView('nearby');
  setSheetState('half');
}, []);
```

4. Pass live minutes to TrackingBar:
```tsx
<TrackingBar
  route={trackedBus.route}
  destination={trackedDestination}
  minutes={trackingMinutes}
  nextStop={trackingStopName}
  onStopTracking={handleStopTracking}
/>
```

**Changes to TrackingBar.tsx:**

Add `nextStop` prop and display it:

```tsx
interface TrackingBarProps {
  route: string;
  destination: string;
  minutes: number | null;
  nextStop?: string;
  onStopTracking: () => void;
}

export default function TrackingBar({ route, destination, minutes, nextStop, onStopTracking }: TrackingBarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '4px 0',
    }}>
      {/* Route badge */}
      <div style={{
        background: 'var(--signal-dim)',
        color: 'var(--signal)',
        fontFamily: 'var(--font-data)',
        fontWeight: 700,
        fontSize: 14,
        padding: '4px 8px',
        borderRadius: 6,
      }}>
        {route}
      </div>

      {/* Destination + next stop */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 13,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {destination}
        </div>
        {nextStop && (
          <div style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 11,
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            Next: {nextStop}
          </div>
        )}
      </div>

      {/* ETA */}
      {minutes !== null && (
        <span className="data-num" style={{
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--signal)',
        }}>
          {minutes <= 1 ? 'DUE' : `${minutes}m`}
        </span>
      )}

      {/* Stop button */}
      <button
        onClick={onStopTracking}
        style={{
          background: 'var(--danger)',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: '8px 14px',
          fontFamily: 'var(--font-ui)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          minHeight: 44,
        }}
      >
        Stop
      </button>
    </div>
  );
}
```

**Commit:** `git add frontend/src/mobile/MobileApp.tsx frontend/src/mobile/TrackingBar.tsx && git commit -m "feat: add live ETA polling to mobile bus tracking"`

---

### Task 4: MobileTripPlanner Component

Port the desktop trip planner search + results into a mobile-optimized component. This reuses all existing backend endpoints.

**Files:**
- Create: `frontend/src/mobile/MobileTripPlanner.tsx`

**Context:**
- Desktop `TripPlanner.tsx` is at `frontend/src/components/panel/map/TripPlanner.tsx`
- It searches via two sources: `GET /api/stops/search?q=<query>&limit=5` and Nominatim geocoding
- Trip planning via `GET /api/trip-plan?olat=&olon=&dlat=&dlon=`
- Response `options[]` contain: `routeId`, `routeName`, `originStop: {stpid, stpnm, lat, lon}`, `destStop: {stpid, stpnm, lat, lon}`, `walkToMin`, `busTimeMin`, `walkFromMin`, `totalMin`, `nextBusMin`
- The `TripPlan` interface from MapView: `{ routeId, originStop, destStop, finalDestination: {lat, lon, name}, walkToMin, walkFromMin }`

**Implementation:**

```tsx
import { useState, useRef, useCallback } from 'react';
import axios from 'axios';
import type { TripPlan } from '../components/MapView';

const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

interface StopResult {
  stpid: string;
  stpnm: string;
  lat: number;
  lon: number;
  routes: string[];
}

interface PlaceResult {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

interface TripOption {
  routeId: string;
  routeName: string;
  originStop: { stpid: string; stpnm: string; lat: number; lon: number };
  destStop: { stpid: string; stpnm: string; lat: number; lon: number };
  walkToMin: number;
  busTimeMin: number;
  walkFromMin: number;
  totalMin: number;
  nextBusMin: number | null;
}

interface MobileTripPlannerProps {
  userLocation: [number, number] | null;  // [lon, lat]
  onTripSelect: (plan: TripPlan) => void;
  onClose: () => void;
  activePlan: TripPlan | null;
}

export default function MobileTripPlanner({ userLocation, onTripSelect, onClose, activePlan }: MobileTripPlannerProps) {
  const [query, setQuery] = useState('');
  const [stopResults, setStopResults] = useState<StopResult[]>([]);
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [tripOptions, setTripOptions] = useState<TripOption[]>([]);
  const [destination, setDestination] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [planning, setPlanning] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const searchAll = useCallback(async (q: string) => {
    if (q.length < 2) {
      setStopResults([]);
      setPlaceResults([]);
      return;
    }

    // Stop search
    try {
      const res = await axios.get(`${API_BASE}/api/stops/search`, { params: { q, limit: 5 } });
      setStopResults(res.data?.stops || []);
    } catch {
      setStopResults([]);
    }

    // Nominatim place search (only for 3+ chars)
    if (q.length >= 3) {
      try {
        const [r1, r2] = await Promise.all([
          axios.get('https://nominatim.openstreetmap.org/search', {
            params: { q: `${q}, Madison, WI`, format: 'json', limit: 5, viewbox: '-89.6,43.2,-89.1,42.95', bounded: 1 },
            headers: { 'User-Agent': 'MadisonBusETA/1.0' },
          }).catch(() => null),
          axios.get('https://nominatim.openstreetmap.org/search', {
            params: { q, format: 'json', limit: 3, viewbox: '-89.6,43.2,-89.1,42.95', bounded: 1 },
            headers: { 'User-Agent': 'MadisonBusETA/1.0' },
          }).catch(() => null),
        ]);

        const seen = new Set<string>();
        const places: PlaceResult[] = [];
        [...(r1?.data || []), ...(r2?.data || [])].forEach((p: any) => {
          const key = `${parseFloat(p.lat).toFixed(4)},${parseFloat(p.lon).toFixed(4)}`;
          if (!seen.has(key) && places.length < 5) {
            seen.add(key);
            const parts = (p.display_name || '').split(',').slice(0, 3).join(',');
            places.push({ name: p.display_name?.split(',')[0] || q, address: parts, lat: parseFloat(p.lat), lon: parseFloat(p.lon) });
          }
        });
        setPlaceResults(places);
      } catch {
        setPlaceResults([]);
      }
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    setShowDropdown(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchAll(value), 400);
  };

  const planTrip = async (dest: { lat: number; lon: number; name: string }) => {
    if (!userLocation) return;
    setPlanning(true);
    setDestination(dest);
    setShowDropdown(false);

    try {
      const res = await axios.get(`${API_BASE}/api/trip-plan`, {
        params: { olat: userLocation[1], olon: userLocation[0], dlat: dest.lat, dlon: dest.lon },
      });
      setTripOptions((res.data.options || []).slice(0, 5));
    } catch {
      setTripOptions([]);
    }
    setPlanning(false);
  };

  const handleSelectStop = (stop: StopResult) => {
    setQuery(stop.stpnm);
    planTrip({ lat: stop.lat, lon: stop.lon, name: stop.stpnm });
  };

  const handleSelectPlace = (place: PlaceResult) => {
    setQuery(place.name);
    planTrip({ lat: place.lat, lon: place.lon, name: place.name });
  };

  const handleSelectTrip = (opt: TripOption) => {
    if (!destination) return;
    onTripSelect({
      routeId: opt.routeId,
      originStop: opt.originStop,
      destStop: opt.destStop,
      finalDestination: destination,
      walkToMin: opt.walkToMin,
      walkFromMin: opt.walkFromMin,
    });
  };

  const isActivePlan = (opt: TripOption) =>
    activePlan?.routeId === opt.routeId &&
    activePlan?.originStop.stpid === opt.originStop.stpid;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Search bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{
          flex: 1,
          position: 'relative',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => setShowDropdown(true)}
            placeholder="Where to?"
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-ui)',
              fontSize: 14,
              padding: '12px 8px',
              minHeight: 44,
            }}
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                setShowDropdown(false);
                setTripOptions([]);
                setDestination(null);
                onClose();
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: 4,
                fontSize: 16,
                minHeight: 44,
                minWidth: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Clear search"
            >
              x
            </button>
          )}
        </div>
      </div>

      {/* Search results dropdown */}
      {showDropdown && (stopResults.length > 0 || placeResults.length > 0) && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          background: 'var(--surface)',
          borderRadius: 10,
          border: '1px solid var(--border)',
          padding: 8,
          maxHeight: 300,
          overflowY: 'auto',
        }}>
          {stopResults.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', padding: '4px 8px' }}>
                Bus Stops
              </div>
              {stopResults.map((s) => (
                <button
                  key={s.stpid}
                  onClick={() => handleSelectStop(s)}
                  style={{
                    background: 'none',
                    border: 'none',
                    textAlign: 'left',
                    padding: '10px 8px',
                    cursor: 'pointer',
                    borderRadius: 6,
                    minHeight: 44,
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-primary)' }}>
                    {s.stpnm}
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {s.routes.slice(0, 5).map((r) => (
                      <span key={r} style={{
                        background: 'var(--signal-dim)',
                        color: 'var(--signal)',
                        fontFamily: 'var(--font-data)',
                        fontSize: 10,
                        padding: '2px 5px',
                        borderRadius: 4,
                      }}>
                        {r}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </>
          )}

          {placeResults.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', padding: '4px 8px', marginTop: stopResults.length > 0 ? 8 : 0 }}>
                Places
              </div>
              {placeResults.map((p, i) => (
                <button
                  key={i}
                  onClick={() => handleSelectPlace(p)}
                  style={{
                    background: 'none',
                    border: 'none',
                    textAlign: 'left',
                    padding: '10px 8px',
                    cursor: 'pointer',
                    borderRadius: 6,
                    minHeight: 44,
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-primary)' }}>
                    {p.name}
                  </div>
                  <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {p.address}
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Trip planning state */}
      {planning && (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
          Finding routes...
        </div>
      )}

      {/* Trip options */}
      {!showDropdown && tripOptions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
            Routes to {destination?.name}
          </div>
          {tripOptions.map((opt, i) => {
            const active = isActivePlan(opt);
            return (
              <button
                key={i}
                onClick={() => handleSelectTrip(opt)}
                style={{
                  background: active ? 'var(--signal-dim)' : 'var(--surface-2)',
                  border: `1px solid ${active ? 'var(--signal)' : 'var(--border)'}`,
                  borderRadius: 10,
                  padding: 14,
                  cursor: 'pointer',
                  textAlign: 'left',
                  minHeight: 44,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      background: 'var(--signal-dim)',
                      color: 'var(--signal)',
                      fontFamily: 'var(--font-data)',
                      fontWeight: 700,
                      fontSize: 14,
                      padding: '4px 8px',
                      borderRadius: 6,
                    }}>
                      {opt.routeId}
                    </span>
                    <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-primary)' }}>
                      {opt.routeName}
                    </span>
                  </div>
                  <span className="data-num" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    ~{Math.round(opt.totalMin)}min
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-secondary)' }}>
                    Walk {Math.round(opt.walkToMin)}min to {opt.originStop.stpnm}
                  </div>
                  <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-primary)' }}>
                    Ride Route {opt.routeId} ({Math.round(opt.busTimeMin)}min)
                    {opt.nextBusMin !== null && (
                      <span style={{ color: 'var(--signal)', marginLeft: 6 }}>
                        {opt.nextBusMin === 0 ? 'Bus arriving now' : `Next bus in ${opt.nextBusMin}m`}
                      </span>
                    )}
                  </div>
                  {opt.walkFromMin > 1 && (
                    <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-secondary)' }}>
                      Walk {Math.round(opt.walkFromMin)}min to destination
                    </div>
                  )}
                </div>

                {active && (
                  <div style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--signal)',
                    marginTop: 6,
                    textTransform: 'uppercase',
                  }}>
                    Viewing on map
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

**Commit:** `git add frontend/src/mobile/MobileTripPlanner.tsx && git commit -m "feat: add MobileTripPlanner component with search and trip options"`

---

### Task 5: Wire MobileTripPlanner into MobileApp

Integrate the trip planner into MobileApp with the search bar at the top of the bottom sheet, and connect `activeTripPlan` to MapView.

**Files:**
- Modify: `frontend/src/mobile/MobileApp.tsx`

**Changes:**

1. Add imports:
```tsx
import MobileTripPlanner from './MobileTripPlanner';
import type { TripPlan } from '../components/MapView';
```

2. Add state:
```tsx
const [activeTripPlan, setActiveTripPlan] = useState<TripPlan | null>(null);
const [showTripPlanner, setShowTripPlanner] = useState(false);
```

3. Add callbacks:
```tsx
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
```

4. Pass `activeTripPlan` to MapView (it already accepts this prop, it was passed as `null` before):
```tsx
<MapView
  selectedRoute={selectedRoute}
  selectedStop={null}
  userLocation={userLocation}
  trackedBus={trackedBus}
  activeTripPlan={activeTripPlan}
  ...
/>
```

5. Update BottomSheet content. The trip planner search bar should appear when the user is not tracking and not viewing stop arrivals. When `showTripPlanner` is true OR there are active trip results, show the planner. Otherwise show the "Where to?" button + NearbyStops:

```tsx
<BottomSheet state={sheetState} onStateChange={setSheetState}>
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
      {/* Where to? button */}
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
```

6. When tracking starts, close trip planner. In `handleTrackBus`:
```tsx
const handleTrackBus = useCallback((vid: string, route: string, destination: string) => {
  setTrackedBus({ vid, route, stopId: '', stopName: '' });
  setTrackedDestination(destination);
  setSelectedRoute(route);
  setView('tracking');
  setSheetState('peek');
  setShowTripPlanner(false);
  setActiveTripPlan(null);
}, []);
```

**Commit:** `git add frontend/src/mobile/MobileApp.tsx && git commit -m "feat: integrate trip planner into mobile with Where to? button and map overlay"`

---

### Task 6: Usage Events Table + Logging Middleware

Add the `usage_events` table and a Flask `after_request` hook that logs every request.

**Files:**
- Modify: `backend/app.py`

**Context:**
- The Flask app is at line 46: `app = Flask(__name__)`
- CORS is at line 47: `CORS(app)`
- The app uses `os.getenv('DATABASE_URL')` throughout with SQLAlchemy for DB access
- There are no existing before/after request hooks

**Changes:**

1. After line 47 (`CORS(app)`), add the table creation and middleware:

```python
# --- Usage Analytics ---
import hashlib
from functools import lru_cache

_usage_engine = None

def _get_usage_engine():
    global _usage_engine
    if _usage_engine is not None:
        return _usage_engine
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        return None
    from sqlalchemy import create_engine
    _usage_engine = create_engine(database_url, pool_size=2, pool_pre_ping=True)
    return _usage_engine

def _ensure_usage_table():
    engine = _get_usage_engine()
    if not engine:
        return
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS usage_events (
                    id SERIAL PRIMARY KEY,
                    event_type VARCHAR(50) NOT NULL,
                    ip_hash VARCHAR(64) NOT NULL,
                    user_agent TEXT,
                    endpoint VARCHAR(200),
                    route VARCHAR(20),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at DESC)
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_usage_events_type ON usage_events(event_type, created_at DESC)
            """))
            conn.commit()
    except Exception as e:
        logging.debug(f"Usage table creation failed: {e}")

_ensure_usage_table()

# Skip logging for these prefixes
_SKIP_LOG_PREFIXES = ('/admin', '/health', '/favicon', '/static')

@app.after_request
def log_usage(response):
    try:
        path = request.path
        if any(path.startswith(p) for p in _SKIP_LOG_PREFIXES):
            return response
        engine = _get_usage_engine()
        if not engine:
            return response

        ip_raw = request.headers.get('X-Forwarded-For', request.remote_addr) or ''
        ip_hash = hashlib.sha256(ip_raw.split(',')[0].strip().encode()).hexdigest()
        user_agent = (request.headers.get('User-Agent') or '')[:500]
        route_param = request.args.get('rt', '')[:20]
        event_type = 'page_view' if path == '/' or path.startswith('/assets') else 'api_call'

        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO usage_events (event_type, ip_hash, user_agent, endpoint, route, created_at)
                VALUES (:type, :ip, :ua, :endpoint, :route, NOW())
            """), {
                'type': event_type,
                'ip': ip_hash,
                'ua': user_agent,
                'endpoint': path[:200],
                'route': route_param,
            })
            conn.commit()
    except Exception as e:
        logging.debug(f"Usage logging failed: {e}")
    return response
```

**Commit:** `git add backend/app.py && git commit -m "feat: add usage_events table and request logging middleware"`

---

### Task 7: Admin Usage API Endpoint

Add the `GET /api/admin/usage` endpoint that returns aggregated usage data.

**Files:**
- Modify: `backend/app.py`

**Changes:**

Add these routes after the existing `/api/admin/cache-clear` endpoint (around line 5030):

```python
@app.route("/api/admin/usage", methods=["GET"])
def admin_usage():
    """Return aggregated usage statistics."""
    password = request.args.get('password', '')
    admin_pw = os.getenv('ADMIN_PASSWORD', '')
    if not admin_pw or password != admin_pw:
        return jsonify({"error": "Unauthorized"}), 401

    days = int(request.args.get('days', 7))
    engine = _get_usage_engine()
    if not engine:
        return jsonify({"error": "Database not configured"}), 500

    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            # Daily page views and unique visitors
            daily = conn.execute(text("""
                SELECT DATE(created_at) as day,
                       COUNT(*) as total_requests,
                       COUNT(DISTINCT ip_hash) as unique_visitors,
                       COUNT(*) FILTER (WHERE event_type = 'api_call') as api_calls,
                       COUNT(*) FILTER (WHERE event_type = 'page_view') as page_views
                FROM usage_events
                WHERE created_at > NOW() - make_interval(days => :days)
                GROUP BY DATE(created_at)
                ORDER BY day DESC
            """), {"days": days}).fetchall()

            # Top endpoints
            top_endpoints = conn.execute(text("""
                SELECT endpoint, COUNT(*) as count
                FROM usage_events
                WHERE created_at > NOW() - make_interval(days => :days)
                  AND event_type = 'api_call'
                GROUP BY endpoint
                ORDER BY count DESC
                LIMIT 20
            """), {"days": days}).fetchall()

            # Top routes
            top_routes = conn.execute(text("""
                SELECT route, COUNT(*) as count
                FROM usage_events
                WHERE created_at > NOW() - make_interval(days => :days)
                  AND route != ''
                GROUP BY route
                ORDER BY count DESC
                LIMIT 20
            """), {"days": days}).fetchall()

            # Totals
            totals = conn.execute(text("""
                SELECT COUNT(*) as total,
                       COUNT(DISTINCT ip_hash) as unique_visitors,
                       COUNT(*) FILTER (WHERE event_type = 'api_call') as api_calls
                FROM usage_events
                WHERE created_at > NOW() - make_interval(days => :days)
            """), {"days": days}).fetchone()

        return jsonify({
            "days": days,
            "totals": {
                "requests": totals[0] if totals else 0,
                "unique_visitors": totals[1] if totals else 0,
                "api_calls": totals[2] if totals else 0,
            },
            "daily": [
                {
                    "date": str(r[0]),
                    "requests": r[1],
                    "unique_visitors": r[2],
                    "api_calls": r[3],
                    "page_views": r[4],
                }
                for r in daily
            ],
            "top_endpoints": [{"endpoint": r[0], "count": r[1]} for r in top_endpoints],
            "top_routes": [{"route": r[0], "count": r[1]} for r in top_routes],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
```

**Commit:** `git add backend/app.py && git commit -m "feat: add admin usage API endpoint with daily stats"`

---

### Task 8: Admin Dashboard HTML Page

Create a Flask-rendered admin dashboard that visualizes usage data. This is a standalone HTML template served by Flask, not part of the React app.

**Files:**
- Create: `backend/templates/admin.html`
- Modify: `backend/app.py` (add the `/admin` route)

**Admin route in app.py** (add near the existing admin endpoints):

```python
@app.route("/admin")
def admin_dashboard():
    """Password-protected admin dashboard."""
    password = request.args.get('password', '')
    admin_pw = os.getenv('ADMIN_PASSWORD', '')
    if not admin_pw or password != admin_pw:
        return '''
        <html>
        <head><title>Admin</title><style>
            body { background: #080810; color: #e0e0e0; font-family: Inter, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
            form { background: #0f0f1a; padding: 32px; border-radius: 12px; border: 1px solid #1e1e2e; }
            input { background: #080810; border: 1px solid #1e1e2e; color: #e0e0e0; padding: 10px 14px; border-radius: 8px; font-size: 14px; width: 200px; margin-right: 8px; }
            button { background: #00d4ff; color: #080810; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; }
        </style></head>
        <body>
            <form method="GET">
                <div style="margin-bottom: 16px; font-weight: 600;">Admin Dashboard</div>
                <input name="password" type="password" placeholder="Password" autofocus />
                <button type="submit">Enter</button>
            </form>
        </body></html>
        ''', 401

    from flask import render_template
    return render_template('admin.html', password=password)
```

**Admin HTML template** (`backend/templates/admin.html`):

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Madison Bus ETA - Admin</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #080810; color: #e0e0e0; font-family: 'Inter', -apple-system, sans-serif; padding: 24px; }
        .header { font-size: 20px; font-weight: 700; margin-bottom: 24px; color: #ffffff; }
        .header span { color: #00d4ff; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
        .card { background: #0f0f1a; border: 1px solid #1e1e2e; border-radius: 12px; padding: 20px; }
        .card-label { font-size: 11px; color: #888; text-transform: uppercase; font-weight: 600; margin-bottom: 8px; }
        .card-value { font-size: 28px; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: #00d4ff; }
        .card-sub { font-size: 12px; color: #666; margin-top: 4px; }
        .section { margin-bottom: 32px; }
        .section-title { font-size: 14px; font-weight: 600; color: #aaa; margin-bottom: 12px; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #1e1e2e; font-size: 13px; }
        th { color: #888; font-weight: 600; font-size: 11px; text-transform: uppercase; }
        td { font-family: 'JetBrains Mono', monospace; }
        .bar { height: 20px; background: #00d4ff22; border-radius: 4px; position: relative; }
        .bar-fill { height: 100%; background: #00d4ff; border-radius: 4px; }
        .controls { display: flex; gap: 8px; margin-bottom: 24px; }
        .controls button { background: #0f0f1a; border: 1px solid #1e1e2e; color: #e0e0e0; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; }
        .controls button.active { background: #00d4ff22; border-color: #00d4ff; color: #00d4ff; }
        .chart { display: flex; align-items: flex-end; gap: 4px; height: 120px; padding: 8px 0; }
        .chart-bar { flex: 1; background: #00d4ff33; border-radius: 3px 3px 0 0; min-width: 20px; position: relative; }
        .chart-bar:hover { background: #00d4ff66; }
        .chart-label { font-size: 9px; color: #666; text-align: center; margin-top: 4px; }
        .loading { text-align: center; padding: 40px; color: #666; }
    </style>
</head>
<body>
    <div class="header">Madison Bus ETA <span>Admin</span></div>

    <div class="controls">
        <button class="active" onclick="loadData(7)">7 Days</button>
        <button onclick="loadData(14)">14 Days</button>
        <button onclick="loadData(30)">30 Days</button>
    </div>

    <div id="content"><div class="loading">Loading...</div></div>

    <script>
        const password = '{{ password }}';
        let currentDays = 7;

        async function loadData(days) {
            currentDays = days;
            document.querySelectorAll('.controls button').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');

            try {
                const res = await fetch(`/api/admin/usage?days=${days}&password=${encodeURIComponent(password)}`);
                const data = await res.json();
                render(data);
            } catch (e) {
                document.getElementById('content').innerHTML = '<div class="loading">Failed to load data</div>';
            }
        }

        function render(data) {
            const t = data.totals;
            const daily = data.daily.reverse();
            const maxReq = Math.max(...daily.map(d => d.requests), 1);

            let html = `
                <div class="grid">
                    <div class="card">
                        <div class="card-label">Total Requests</div>
                        <div class="card-value">${t.requests.toLocaleString()}</div>
                        <div class="card-sub">Last ${data.days} days</div>
                    </div>
                    <div class="card">
                        <div class="card-label">Unique Visitors</div>
                        <div class="card-value">${t.unique_visitors.toLocaleString()}</div>
                        <div class="card-sub">By IP hash</div>
                    </div>
                    <div class="card">
                        <div class="card-label">API Calls</div>
                        <div class="card-value">${t.api_calls.toLocaleString()}</div>
                        <div class="card-sub">Endpoint hits</div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">Daily Requests</div>
                    <div class="chart">
                        ${daily.map(d => `
                            <div style="flex: 1; display: flex; flex-direction: column; align-items: center;">
                                <div class="chart-bar" style="height: ${(d.requests / maxReq) * 100}%" title="${d.date}: ${d.requests} requests"></div>
                                <div class="chart-label">${d.date.slice(5)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">Daily Breakdown</div>
                    <table>
                        <tr><th>Date</th><th>Requests</th><th>Visitors</th><th>API Calls</th></tr>
                        ${data.daily.map(d => `
                            <tr>
                                <td>${d.date}</td>
                                <td>${d.requests.toLocaleString()}</td>
                                <td>${d.unique_visitors.toLocaleString()}</td>
                                <td>${d.api_calls.toLocaleString()}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>

                <div class="section">
                    <div class="section-title">Top Endpoints</div>
                    <table>
                        <tr><th>Endpoint</th><th>Calls</th><th></th></tr>
                        ${data.top_endpoints.slice(0, 15).map(e => `
                            <tr>
                                <td>${e.endpoint}</td>
                                <td>${e.count.toLocaleString()}</td>
                                <td><div class="bar" style="width: 100px;"><div class="bar-fill" style="width: ${(e.count / (data.top_endpoints[0]?.count || 1)) * 100}%"></div></div></td>
                            </tr>
                        `).join('')}
                    </table>
                </div>

                <div class="section">
                    <div class="section-title">Top Routes</div>
                    <table>
                        <tr><th>Route</th><th>Views</th><th></th></tr>
                        ${data.top_routes.slice(0, 15).map(r => `
                            <tr>
                                <td>${r.route}</td>
                                <td>${r.count.toLocaleString()}</td>
                                <td><div class="bar" style="width: 100px;"><div class="bar-fill" style="width: ${(r.count / (data.top_routes[0]?.count || 1)) * 100}%"></div></div></td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
            `;

            document.getElementById('content').innerHTML = html;
        }

        loadData(7);
    </script>
</body>
</html>
```

**Commit:** `git add backend/templates/admin.html backend/app.py && git commit -m "feat: add password-protected admin dashboard with usage charts"`

---

### Task 9: Build Verification and Push

Verify the frontend builds without TypeScript errors and push all changes.

**Files:** None (verification only)

**Steps:**

1. Run the frontend build:
```bash
cd frontend && npm run build
```
Expected: Clean build with no TypeScript errors.

2. If there are TypeScript errors, fix them.

3. Push to main:
```bash
git push origin main
```
If rejected (non-fast-forward from auto-deploy):
```bash
git pull --rebase origin main && git push origin main
```

**Commit:** Only if fixes are needed from build errors.
