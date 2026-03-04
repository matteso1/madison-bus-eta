# Mobile Feature Completion + Admin Analytics Design

**Date:** 2026-03-04
**Status:** Approved

## Context

Phase 1 (ML fix) and Phase 2 (mobile rider PWA) shipped. The mobile app works but is missing key features to match or beat Google Maps for transit: no stop detail view, no live tracking ETA, no trip planner, and no way to gauge user interest. This design covers the four features needed to close those gaps.

## Feature 1: StopArrivals Expanded View

**Problem:** Tapping a stop name in NearbyStops does nothing. Users can only see the top 3 arrivals per stop.

**Solution:** New `StopArrivals.tsx` component. Tapping a stop name transitions `view` to `'stop'`, expands the sheet to `half`, and renders all upcoming arrivals (not capped at 3) with confidence bands from `/api/conformal-prediction`.

**Flow:**
- Tap stop name in NearbyStops -> MobileApp sets `view: 'stop'`, stores `selectedStop`
- Sheet auto-expands to `half`
- StopArrivals fetches `/predictions?stpid=` every 15 seconds
- For each arrival, also calls `/api/conformal-prediction` for confidence bands
- Renders: stop name header with back arrow, distance, then ArrivalCard list (still filtered to <=30 min, no 3-item cap)
- Back button returns to `nearby` view
- Track button on any arrival works the same as in NearbyStops

**New file:** `frontend/src/mobile/StopArrivals.tsx`
**Modified:** `frontend/src/mobile/MobileApp.tsx` (new view state, selectedStop state, onStopSelect wired)

## Feature 2: TrackingBar Live ETA

**Problem:** TrackingBar always shows `minutes={null}`. No live ETA polling on mobile.

**Solution:** MobileApp polls `/predictions?vid=<vid>` every 15 seconds when in tracking view. Extracts the countdown from the response and passes it to TrackingBar.

**Flow:**
- When `view === 'tracking'`, a new useEffect starts a 15s interval
- Calls `GET /predictions?vid=<vid>`
- Parses the first prediction from `bustime-response.prd`
- Extracts `prdctdn` (minutes) and `stpnm` (next stop name)
- Passes both to TrackingBar as props
- Cleanup clears the interval when tracking stops

**Modified:** `frontend/src/mobile/MobileApp.tsx` (new polling effect), `frontend/src/mobile/TrackingBar.tsx` (display next stop name)

## Feature 3: Mobile Trip Planner

**Problem:** No destination search on mobile. Users can't search "sushi express" and see which bus to take.

**Solution:** Port the desktop TripPlanner into the mobile bottom sheet. Reuse all existing backend endpoints and the MapView trip overlay.

**Backend endpoints (all existing, no changes needed):**
- `GET /api/stops/search?q=<query>&limit=5` -- fuzzy stop name search
- `GET /api/trip-plan?olat=&olon=&dlat=&dlon=` -- direct-route trip planning
- Nominatim geocoding (called from frontend)
- OSRM walking routes (called from MapView)

**Mobile components:**
- Search bar pinned at top of BottomSheet content area (above NearbyStops)
- Tapping search bar expands sheet to `full`
- 400ms debounced dual-source search (stop cache + Nominatim), same logic as desktop `TripPlanner.tsx`
- Dropdown shows "BUS STOPS" and "PLACES" sections
- Selecting a destination calls `/api/trip-plan` and shows trip option cards
- Selecting a trip option: sheet collapses to `peek`, `activeTripPlan` state flows to MapView which draws the walk + bus route overlay (already supported)
- Compact trip info bar in peek state shows route, total time, next bus countdown
- "X" clears the trip and returns to NearbyStops

**New file:** `frontend/src/mobile/MobileTripPlanner.tsx`
**Modified:** `frontend/src/mobile/MobileApp.tsx` (activeTripPlan state, search bar integration, new view state)

## Feature 4: Admin Analytics Page

**Problem:** No visitor tracking or usage metrics. Can't gauge interest before making the app live.

**Solution:** Lightweight request logging in the backend + a password-protected admin dashboard served as a Flask HTML page.

**Backend changes:**

New table:
```sql
CREATE TABLE usage_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  ip_hash VARCHAR(64) NOT NULL,
  user_agent TEXT,
  endpoint VARCHAR(200),
  route VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_usage_events_created ON usage_events(created_at DESC);
CREATE INDEX idx_usage_events_type ON usage_events(event_type, created_at DESC);
```

Request logging middleware:
- Runs on every request (or a sampled subset to limit DB writes)
- Hashes IP with SHA-256 (no raw IPs stored)
- Stores: event_type='page_view' or 'api_call', hashed IP, user agent, endpoint path, route if present
- Skip logging for /admin, /health, and static asset requests

New endpoints:
- `GET /admin` -- serves the dashboard HTML page
- `GET /api/admin/usage?days=7` -- returns aggregated usage data
- Password protection via `ADMIN_PASSWORD` env var, checked with a simple session cookie

Dashboard shows:
- Daily visitors chart (last 7/30 days)
- Total API calls
- Unique visitors (by hashed IP)
- Top endpoints by call count
- Top routes by popularity
- Current day's activity

**New files:** `backend/templates/admin.html`, usage logging middleware in `backend/app.py`

## Non-Goals

- Transfer-based trip planning (only direct routes, same as desktop)
- Offline support
- Push notifications
- User accounts beyond the single admin password
- Real-time WebSocket push
