# ML Fix + Mobile Rider PWA Design

**Date:** 2026-03-03
**Status:** Approved

## Context

The app gained traction via LinkedIn -- UW-Madison students want to use it on their phones to catch buses. The audit revealed:

- **ML inference is silently broken** (XGBoost pickle deserialization error on every prediction)
- **Training pipeline has failed 10 consecutive days** (collector outage Feb 19-27 poisoned the training window, recovering now)
- **No mobile support** (380px fixed side panel, completely broken on phones)
- **DB has minor inefficiencies** (missing indexes, ~10% dead tuples on large tables)
- **Backend caching is reasonable** (8-15s TTL per worker, but per-worker isolation means multiple workers = multiple API calls)

## Phase 1: Fix ML + Infra Stabilization

### 1.1 XGBoost Native Format Migration

**Problem:** Model saved with `joblib.dump()` under older XGBoost. Current runtime's XGBoost dropped the `gpu_id` attribute. Every prediction silently fails, backend falls back to raw API ETAs.

**Solution:**
- Switch `train_regression.py` to save models with `model.save_model('filename.ubj')` (native XGBoost Universal Binary JSON format) instead of `joblib.dump()`.
- Update `model_registry.py` load function to use `xgb.Booster()` + `.load_model()` for `.ubj` files, with fallback to joblib for legacy `.pkl` files.
- Update `backend/app.py` `_get_model()` singleton to handle the new format.
- **Immediate unblock:** Write a one-time migration script to re-export `quantile_latest.pkl` to `quantile_latest.ubj`, commit and push. ML inference resumes without waiting for nightly training.

**Files changed:** `ml/training/train_regression.py`, `ml/models/model_registry.py`, `backend/app.py`, `ml/models/saved/` (new .ubj file).

### 1.2 Database Index Optimization

Add two indexes (non-blocking, `CREATE INDEX CONCURRENTLY`):

1. `idx_weather_obs_observed_at ON weather_observations(observed_at DESC)` -- eliminates 1M+ sequential scans for "latest weather" lookups.
2. `idx_predictions_vid_created ON predictions(vid, created_at DESC)` -- the predictions table has 449M cumulative rows scanned. Covers the common "recent predictions for vehicle" query pattern.

### 1.3 Dead Code Cleanup

- Remove `consumer: python collector/consumer.py` from root `Procfile` (file is deleted).
- `git rm` the deleted sentinel files (`sentinel_client.py`, `sentinel_proto/`).
- Assess `frontend-premium/` directory for removal (no source, just `node_modules`).

### 1.4 Training Pipeline

No code changes needed. The deployment gates correctly prevented bad models from shipping. Today's run (93.1s MAE) is 3s above the 90s gate. Expected to clear within 1-3 days as the training window fills with post-recovery data. Monitor.

## Phase 2: Mobile Rider Experience

### 2.1 Architecture

Same React app, same Vercel deploy, same URL. Viewport detection in `App.tsx`:
- `<= 768px`: render `<MobileApp />` (completely separate component tree)
- `> 768px`: render existing desktop dashboard (unchanged)

Uses a `useIsMobile()` hook with `matchMedia` listener for responsive detection.

### 2.2 Core Rider Flow

```
Open app
  -> Full-screen map (dark, same MapLibre/DeckGL stack)
  -> GPS "locate me" auto-fires on load
  -> Bottom sheet shows nearest stops sorted by distance

Tap a stop
  -> Bottom sheet expands: all upcoming arrivals at that stop
  -> Each arrival: route color badge, destination, ETA (big), confidence band

Tap "Track" on an arrival
  -> Map follows the bus, bottom sheet collapses to compact tracking bar
  -> 5s position polling (existing tracking logic)
```

### 2.3 New Mobile Components

```
src/mobile/
  MobileApp.tsx         # Map + BottomSheet orchestrator, state management
  BottomSheet.tsx        # Draggable sheet (collapsed / half / full states)
  NearbyStops.tsx        # Geolocated nearest stops with distance + top arrivals
  StopArrivals.tsx       # Full arrival list for a selected stop
  TrackingBar.tsx        # Compact tracking state when following a bus
  ArrivalCard.tsx        # Single arrival: route badge, destination, ETA, confidence bar
```

### 2.4 Design Language

Same design system as desktop:
- Colors: `--bg: #080810`, `--surface: #0f0f1a`, `--signal: #00d4ff`, etc.
- Fonts: JetBrains Mono for ETAs/numbers, Inter for labels
- Adapted for mobile: 44px minimum touch targets, bottom sheet instead of side panel
- No analytics or system tabs on mobile -- riders want arrivals, not diagnostics

### 2.5 API Endpoints Used by Mobile

All existing -- no new backend endpoints needed:
- `GET /vehicles?rt={route}` -- bus positions for tracked route
- `POST /api/predict-arrival-v2` -- ML predictions with confidence bands
- `GET /stops?rt={route}` -- stop list for a route
- `GET /api/bunching/active` -- bunching overlay
- Geolocation: browser `navigator.geolocation` API (no backend needed)
- Nearest stop calculation: client-side haversine from the stops list

## Phase 3: Scale for Campus Load (Future)

Deferred. Current caching (8-15s TTL) handles moderate concurrent users. If API rate limiting becomes a problem:
- Increase GTFS-RT collection frequency (free, no limit) to serve as primary position source
- Share position cache across gunicorn workers (Postgres or Redis)
- Reserve REST API calls for predictions only

## Non-Goals

- Native iOS/Android app (PWA + responsive web is sufficient)
- Real-time WebSocket push (polling is fine for bus ETAs)
- User accounts / authentication
- Offline support (transit data is inherently live)
