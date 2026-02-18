# Madison Metro Platform Redesign
**Date:** 2026-02-17
**Status:** Approved

---

## Problem

The current app has two disconnected pages (map + analytics) that feel like separate tools. The ML system is genuinely strong but the presentation makes it look like a debug panel. The backend has critical correctness issues (hardcoded inference features, fake drift detection, model reloaded per-request) that undermine the accuracy the ML pipeline works hard to achieve.

Goal: A unified transit data platform usable by both Madison commuters and transit analysts. Grafana-meets-Google Maps aesthetic. Every number on screen is live and accurate.

---

## Architecture

### Frontend

Single-page application. No route change on navigation. Map always rendered (never unmounted).

```
┌─────────────────────────────────────────────────────────────────┐
│  ● MADISON METRO  [LIVE]    Route ▾                   52s MAE ↑ │  48px
├──────────────────────────────────────────────────┬──────────────┤
│                                                  │              │
│              LIVE MAP  (65%)                     │  CONTEXT     │
│              DeckGL + MapLibre                   │  PANEL 380px │
│              Always visible                      │              │
│                                                  │  Reacts to   │
│                                                  │  map focus   │
│                                                  │              │
├──────────────────────────────────────────────────┤              │
│  [MAP]  [ANALYTICS]  [SYSTEM]   49 buses  3 late │              │
└──────────────────────────────────────────────────┴──────────────┘
```

**Layout rules:**
- Map: `calc(100vw - 380px)` wide, full viewport height
- Panel: 380px fixed right, full height, independent scroll
- Top bar: 48px, always visible
- Bottom tab bar: 48px, overlaid on map bottom-left

**Bottom tabs drive panel content:**
- MAP tab → city overview / route drill-down / stop predictions (context-driven)
- ANALYTICS tab → Performance / Errors / Routes sub-pills
- SYSTEM tab → model health, pipeline status, drift

**No `/analytics` route.** App.tsx becomes a single route.

### Design Language

- Background: `#080810` (near-black with blue undertone)
- Surface: `#0f0f1a`
- Border: `#1e1e2e`
- Signal (ML/live): `#00d4ff` (cold electric teal)
- Warning/API: `#f59e0b` (amber)
- Danger: `#ef4444`
- Success: `#10b981`
- Text primary: `#e2e8f0`
- Text secondary: `#64748b`
- Numbers/data: `'JetBrains Mono'` or `'IBM Plex Mono'` (monospaced)
- Labels/UI: `'Inter'` (clean geometric sans)

Color used only for signal. Data numbers always monospaced. No gradients on data elements.

### Component Structure

```
src/
  App.tsx                    # Single route, layout shell
  components/
    layout/
      TopBar.tsx             # App name, route filter, MAE badge, live dot
      BottomTabs.tsx         # MAP / ANALYTICS / SYSTEM tabs
    map/
      MapView.tsx            # Refactored: DeckGL+MapLibre, emits events
      BusLayer.tsx           # ScatterplotLayer for buses
      RouteLayer.tsx         # PathLayer for routes (reliability-colored)
      StopLayer.tsx          # ScatterplotLayer for stops (reliability rings)
    panel/
      ContextPanel.tsx       # Panel shell, routes content based on mode
      map/
        CityOverview.tsx     # Default: system stats, top routes
        RouteDrilldown.tsx   # When route selected
        StopPredictions.tsx  # When stop clicked
      analytics/
        AnalyticsPanel.tsx   # Sub-pill shell
        PerformanceTab.tsx   # MAE trend, coverage, training history
        ErrorsTab.tsx        # Horizon chart, hourly bias, worst predictions
        RoutesTab.tsx        # Route table, route×hour heatmap
      system/
        SystemPanel.tsx      # Model health, pipeline, drift
    shared/
      MetricCard.tsx         # Reusable stat card
      MiniChart.tsx          # Tiny sparkline/area chart
      ReliabilityBar.tsx     # 5-point reliability indicator
      ConfidenceBand.tsx     # Horizontal range bar for ML predictions
      StatusBadge.tsx        # OK/WARNING/CRITICAL/EXCELLENT etc
```

---

## Context Panel States

### MAP tab — default (no selection)

- Live metrics: buses active, delayed count, predictions this hour
- Top 5 routes by reliability (ReliabilityBar component, live)
- System MAE badge with trend arrow
- Model age indicator

### MAP tab — route selected

- Route name + ReliabilityBar
- This route's MAE vs city average (delta display)
- 24h reliability sparkline
- Upcoming arrivals on this route (live ML predictions)
- "Typically Xs late at this hour" from `hr_route_error` aggregate

### MAP tab — stop clicked

- Stop name, stop ID
- Up to 5 upcoming buses, each showing:
  - Route, destination, delayed badge
  - ConfidenceBand: `8 ──●──── 11 min` (10th/50th/90th percentile)
  - API delta: "API says 10m" in muted text
- Stop's historical MAE at this hour

### ANALYTICS tab — Performance sub-pill

- MAE over time: 14-day area chart (small, fits 380px)
- Coverage: 4 threshold bars (30s/1m/2m/5m) with 80% reference line
- Training runs: last 5 compact list with deployed badge

### ANALYTICS tab — Errors sub-pill

- Error by horizon: step bar chart (the key diagnostic)
- Hourly bias: 24-cell strip heatmap (single row, color-coded)
- Worst predictions: compact table top 10

### ANALYTICS tab — Routes sub-pill

- Route table: 20 routes sortable by MAE, mini reliability bar per row
- Route×hour heatmap: full panel width, top 12 routes × 18 hours

### SYSTEM tab

- Model health card: version, age, MAE, improvement vs baseline
- Data pipeline: collection rate, last update, prediction_outcomes count
- Drift status card: real drift (ab_test_predictions based), OK/WARNING/CRITICAL
- Recent training runs: last 5 with reason and MAE delta

---

## Map Enhancements

1. **Route paths colored by current reliability** — path color interpolates between teal (reliable) and amber (unreliable) based on `reliability_score`. Still filterable by route.

2. **Stop markers with reliability rings** — when route selected, stop circles have a colored outer ring. Ring color = stop's historical MAE at current hour. Red = historically hard to predict here.

3. **Tooltip redesign** — React overlay component (not inline HTML string). Positioned relative to cursor. Shows route, destination, ML confidence band.

---

## Backend Fixes

### Fix 1: Model singleton (Critical)

**File:** `backend/app.py`

Replace per-request `pickle.load()` with a global singleton:

```python
_model_cache = {'model': None, 'mtime': 0}

def get_model():
    path = ML_PATH / 'quantile_latest.pkl'
    mtime = path.stat().st_mtime if path.exists() else 0
    if _model_cache['model'] is None or mtime != _model_cache['mtime']:
        with open(path, 'rb') as f:
            _model_cache['model'] = pickle.load(f)
        _model_cache['mtime'] = mtime
    return _model_cache['model']
```

### Fix 2: Real route stats at inference (Critical)

**File:** `backend/app.py`

Replace hardcoded `route_frequency=1000`, `route_avg_error=60`, `hr_route_error=90/45` with DB-backed cache:

```python
_route_stats_cache = {'data': {}, 'loaded_at': 0}
ROUTE_STATS_TTL = 300  # 5 minutes

def get_route_stats():
    if time.time() - _route_stats_cache['loaded_at'] > ROUTE_STATS_TTL:
        # Query prediction_outcomes for route_avg_error, hr_route_error, route_frequency
        _route_stats_cache['data'] = load_route_stats_from_db()
        _route_stats_cache['loaded_at'] = time.time()
    return _route_stats_cache['data']
```

### Fix 3: Real drift detection (High)

**File:** `backend/app.py` — `/api/drift/check`

Replace age-based logic with performance-based:

```python
# Compare recent ML MAE (from ab_test_predictions last 48h)
# against trained baseline MAE (from registry)
# Drift = (recent_mae - baseline_mae) / baseline_mae * 100
# OK: drift < 10%
# WARNING: drift 10-25%
# CRITICAL: drift > 25% OR model age > 14 days
```

### Fix 4: DB index on prediction_outcomes.created_at (High)

**File:** `.github/workflows/nightly-training.yml`

Add to existing "Ensure DB indexes exist" step:

```sql
CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_created_at
ON prediction_outcomes(created_at DESC);
```

### Fix 5: Wire A/B matching to arrival detector (Medium)

**File:** `collector/arrival_detector.py`

After writing `prediction_outcomes`, update `ab_test_predictions`:

```sql
UPDATE ab_test_predictions
SET matched = true,
    ml_error_sec = :ml_error,
    matched_at = NOW()
WHERE vehicle_id = :vid AND stop_id = :stpid
AND matched = false
AND created_at > NOW() - INTERVAL '30 minutes'
```

---

## What We Are Not Building

- Favorites / push notifications (PWA scope — separate project)
- Trip planner (requires GTFS static — separate project)
- GPU training (XGBoost on 38k rows takes 5s — hardware is not the constraint)
- Keeping the `/viz/` endpoints in new UI (they use a stale CSV, not live DB)

---

## Implementation Phases

### Phase 1: Backend Fixes (no visible UI change)
1. Model singleton + file-watcher
2. Route stats DB cache for inference
3. Real drift detection
4. DB index on prediction_outcomes.created_at
5. A/B matching in arrival detector

### Phase 2: Frontend Shell
1. New layout: TopBar + map + panel + BottomTabs
2. Map refactored into sub-components (BusLayer, RouteLayer, StopLayer)
3. ContextPanel shell with routing logic
4. Shared components: MetricCard, ReliabilityBar, ConfidenceBand, StatusBadge
5. Remove Analytics page, remove separate route

### Phase 3: Panel Content
1. MAP tab panels: CityOverview, RouteDrilldown, StopPredictions
2. ANALYTICS tab panels: Performance, Errors, Routes
3. SYSTEM tab panel
4. Map reliability coloring + stop rings
5. Tooltip redesign
