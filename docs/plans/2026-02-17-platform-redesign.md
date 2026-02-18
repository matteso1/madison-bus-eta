# Madison Metro Platform Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the two-page developer tool into a unified transit data platform — live map always visible, context-driven right panel, accurate ML inference, real drift detection.

**Architecture:** Single-page layout with a persistent 65%/380px split. Left = DeckGL+MapLibre map (never unmounted). Right = context panel whose content is driven by bottom tab selection (MAP/ANALYTICS/SYSTEM) and map interaction events (route selected, stop clicked). Backend fixes run in parallel: model singleton, real route stats at inference, real drift detection, DB index.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, Recharts 3.5, DeckGL 9.2, MapLibre 5.13, framer-motion 12, lucide-react, Flask 3, XGBoost, PostgreSQL (Railway), GitHub Actions

---

## Phase 1: Backend Fixes

### Task 1: Model singleton + file-watcher

**Files:**
- Modify: `backend/app.py` (find the `predict_arrival_v2` function, ~line 1416)

**Context:** Currently `pickle.load()` runs on every single prediction request. On Railway's container this adds ~200-400ms per request and wastes memory. Fix is a module-level cache that reloads only when the file changes on disk (mtime check).

**Step 1: Find the current model loading code**

Open `backend/app.py` and search for `quantile_latest.pkl`. You'll find something like:
```python
with open(quantile_model_path, 'rb') as f:
    ensemble = pickle.load(f)
```
Note the line number.

**Step 2: Add the singleton cache near the top of app.py**

Find the imports section (top of file). After the existing imports, add:

```python
import time

# ── Model singleton ──────────────────────────────────────────────
_model_cache: dict = {'ensemble': None, 'mtime': 0.0}

def _get_model():
    """Load quantile model once; reload only when file changes on disk."""
    ml_path = Path(__file__).parent.parent / 'ml' / 'models' / 'saved'
    model_path = ml_path / 'quantile_latest.pkl'
    if not model_path.exists():
        return None
    mtime = model_path.stat().st_mtime
    if _model_cache['ensemble'] is None or mtime != _model_cache['mtime']:
        with open(model_path, 'rb') as f:
            _model_cache['ensemble'] = pickle.load(f)
        _model_cache['mtime'] = mtime
    return _model_cache['ensemble']
```

**Step 3: Replace the inline pickle.load() in predict_arrival_v2**

Find every occurrence of:
```python
with open(quantile_model_path, 'rb') as f:
    ensemble = pickle.load(f)
```
Replace with:
```python
ensemble = _get_model()
if ensemble is None:
    # existing fallback code stays here
```

**Step 4: Manual test**

```bash
cd backend
python -c "from app import _get_model; m = _get_model(); print('loaded:', m is not None)"
```
Expected: `loaded: True` (or `loaded: False` if no model file, which is fine)

**Step 5: Commit**

```bash
git add backend/app.py
git commit -m "perf: cache ML model singleton, reload on file change"
```

---

### Task 2: Real route stats at inference time

**Files:**
- Modify: `backend/app.py` (inside `predict_arrival_v2`, ~line 1500)

**Context:** The prediction endpoint currently hardcodes `route_frequency=1000`, `route_avg_error=60`, `hr_route_error=90 if rush else 45`. The XGBoost model was trained with real per-route values from the database. Feeding it fake values means every route gets the same correction regardless of its actual history. This is the single biggest accuracy regression in the serving path.

**Step 1: Add route stats cache after the model singleton in app.py**

```python
# ── Route stats cache (for ML inference) ─────────────────────────
_route_stats_cache: dict = {'data': {}, 'loaded_at': 0.0}
_ROUTE_STATS_TTL = 300  # 5 minutes

def _get_route_stats() -> dict:
    """
    Returns dict keyed by route string:
    {
      'A': {
        'route_frequency': int,
        'route_avg_error': float,   # seconds
        'route_encoded': int,
        'hr_errors': {0: float, 1: float, ..., 23: float}  # hour -> avg error
      }, ...
    }
    Cached for 5 minutes, falls back to global defaults on DB failure.
    """
    if time.time() - _route_stats_cache['loaded_at'] < _ROUTE_STATS_TTL:
        return _route_stats_cache['data']

    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        return {}

    try:
        from sqlalchemy import create_engine, text as sa_text
        engine = create_engine(database_url, pool_pre_ping=True)
        with engine.connect() as conn:
            # Route-level stats
            rows = conn.execute(sa_text("""
                SELECT
                    rt,
                    COUNT(*) as freq,
                    AVG(ABS(error_seconds)) as avg_error
                FROM prediction_outcomes
                WHERE created_at > NOW() - INTERVAL '7 days'
                GROUP BY rt
                HAVING COUNT(*) >= 20
            """)).fetchall()

            # Hour-route stats
            hr_rows = conn.execute(sa_text("""
                SELECT
                    rt,
                    EXTRACT(HOUR FROM created_at) as hr,
                    AVG(ABS(error_seconds)) as avg_error
                FROM prediction_outcomes
                WHERE created_at > NOW() - INTERVAL '7 days'
                GROUP BY rt, hr
                HAVING COUNT(*) >= 5
            """)).fetchall()

        stats: dict = {}
        for i, row in enumerate(rows):
            stats[row.rt] = {
                'route_frequency': int(row.freq),
                'route_avg_error': float(row.avg_error),
                'route_encoded': i % 30,
                'hr_errors': {}
            }
        for row in hr_rows:
            rt = row.rt
            if rt in stats:
                stats[rt]['hr_errors'][int(row.hr)] = float(row.avg_error)

        _route_stats_cache['data'] = stats
        _route_stats_cache['loaded_at'] = time.time()
        return stats
    except Exception as e:
        print(f"[route_stats] DB error: {e}")
        return _route_stats_cache.get('data', {})
```

**Step 2: Use route stats inside predict_arrival_v2**

Find the section that builds the feature array (look for `route_frequency`, `route_avg_error`). Replace:
```python
route_frequency = 1000
route_encoded = hash(route) % 30
route_avg_error = 60
hr_route_error = 90 if is_rush_hour else 45
```
With:
```python
route_stats = _get_route_stats()
rt_data = route_stats.get(route, {})
route_frequency = rt_data.get('route_frequency', 1000)
route_encoded = rt_data.get('route_encoded', hash(route) % 30)
route_avg_error = rt_data.get('route_avg_error', 60.0)
current_hour = datetime.now(timezone.utc).hour
hr_route_error = rt_data.get('hr_errors', {}).get(current_hour, route_avg_error)
```

**Step 3: Manual test**

```bash
cd backend
python -c "
from app import _get_route_stats
stats = _get_route_stats()
print('routes loaded:', len(stats))
if stats:
    first = next(iter(stats))
    print('sample:', first, stats[first])
"
```
Expected: `routes loaded: N` where N > 0 if DB is accessible.

**Step 4: Commit**

```bash
git add backend/app.py
git commit -m "fix: use real route stats from DB for ML inference, 5min cache"
```

---

### Task 3: Real drift detection

**Files:**
- Modify: `backend/app.py` (find `/api/drift/check` endpoint)

**Context:** Current drift check only looks at model age (>14 days = CRITICAL). This is misleading — a 15-day-old model that's performing well is not in drift. Real drift = recent ML MAE has diverged from the trained baseline MAE by more than a threshold, measured on live `ab_test_predictions`.

**Step 1: Find the drift endpoint**

Search for `drift/check` in app.py. Read the full function. Note where it calculates `status`.

**Step 2: Replace the status logic**

Find the section that determines status (currently age-based). Replace the entire status-determination block with:

```python
# ── Real drift: compare recent ML MAE vs trained baseline ────────
baseline_mae = registry_mae  # float, from registry.json or default 58.0

recent_ml_mae = None
drift_pct = None
prediction_count = 0

try:
    with engine.connect() as conn:
        result = conn.execute(sa_text("""
            SELECT
                COUNT(*) as n,
                AVG(ABS(ml_error_sec)) as ml_mae
            FROM ab_test_predictions
            WHERE matched = true
              AND created_at > NOW() - INTERVAL '48 hours'
              AND ml_error_sec IS NOT NULL
        """)).fetchone()
        if result and result.n >= 50:
            recent_ml_mae = float(result.ml_mae)
            prediction_count = int(result.n)
            drift_pct = ((recent_ml_mae - baseline_mae) / baseline_mae) * 100
except Exception as e:
    pass  # Fall through to age-based fallback

# Determine status
model_age_days = (datetime.now(timezone.utc) - model_trained_at).days if model_trained_at else 999

if recent_ml_mae is not None:
    # Performance-based drift (preferred)
    if drift_pct > 25 or model_age_days > 14:
        status = 'CRITICAL'
        recommendation = f'Model MAE has drifted {drift_pct:.0f}% above baseline. Retrain immediately.'
    elif drift_pct > 10:
        status = 'WARNING'
        recommendation = f'Model MAE is {drift_pct:.0f}% above baseline. Schedule retraining.'
    else:
        status = 'OK'
        recommendation = 'Model performing within expected range.'
else:
    # Fallback: age-based only (no ab_test data yet)
    if model_age_days > 14:
        status = 'CRITICAL'
        recommendation = 'Model is stale (>14 days). No recent A/B data to measure drift.'
    elif model_age_days > 7:
        status = 'WARNING'
        recommendation = 'Model is aging. Recent A/B data unavailable.'
    else:
        status = 'OK'
        recommendation = 'Model is fresh. No A/B data yet to measure live drift.'
```

**Step 3: Update the return value** to include `drift_pct` and `recent_ml_mae`:

```python
return jsonify({
    'status': status,
    'baseline_mae_sec': baseline_mae,
    'recent_ml_mae_sec': recent_ml_mae,
    'drift_pct': round(drift_pct, 1) if drift_pct is not None else None,
    'prediction_count_48h': prediction_count,
    # ... rest of existing fields
})
```

**Step 4: Commit**

```bash
git add backend/app.py
git commit -m "fix: real drift detection from ab_test_predictions MAE vs baseline"
```

---

### Task 4: DB index on prediction_outcomes.created_at

**Files:**
- Modify: `.github/workflows/nightly-training.yml`

**Context:** Every diagnostics query does `WHERE created_at > NOW() - INTERVAL '7 days'` on `prediction_outcomes`. With 70k+ rows and no index this is a sequential scan that gets slower every day.

**Step 1: Open the workflow file**

Open `.github/workflows/nightly-training.yml`. Find the "Ensure DB indexes exist" step that already has the vehicle_observations index.

**Step 2: Add the prediction_outcomes index**

Add to the existing Python snippet inside that step:

```python
conn.execute(text('''
    CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_created_at
    ON prediction_outcomes(created_at DESC)
'''))
conn.execute(text('''
    CREATE INDEX IF NOT EXISTS idx_ab_test_matched_created
    ON ab_test_predictions(matched, created_at DESC)
    WHERE matched = true
'''))
conn.commit()
```

**Step 3: Commit**

```bash
git add .github/workflows/nightly-training.yml
git commit -m "perf: add DB index on prediction_outcomes.created_at and ab_test matched"
```

---

### Task 5: Wire A/B matching to arrival detector

**Files:**
- Modify: `collector/arrival_detector.py`

**Context:** The `ab_test_predictions` table is populated by `predict_arrival_v2` when a user requests a prediction. But it never gets `matched=true` or `ml_error_sec` filled in, so A/B results always show 0 matched predictions. The arrival detector already writes `prediction_outcomes` — it needs to also update `ab_test_predictions` for the same (vid, stpid) pair.

**Step 1: Find where prediction_outcomes is written in arrival_detector.py**

Search for `prediction_outcomes` insert. Note the function name and line number.

**Step 2: After the prediction_outcomes insert, add A/B update**

```python
# Update A/B test record if one exists for this prediction
try:
    conn.execute(sa_text("""
        UPDATE ab_test_predictions
        SET
            matched = true,
            ml_error_sec = (
                SELECT ABS(:actual_arrival_epoch - EXTRACT(EPOCH FROM prdtm::timestamp with time zone))
                - ABS(:error_seconds)
                FROM predictions p2
                WHERE p2.id = ab_test_predictions.prediction_id
                LIMIT 1
            ),
            matched_at = NOW()
        WHERE vehicle_id = :vid
          AND stop_id = :stpid
          AND matched = false
          AND created_at > NOW() - INTERVAL '30 minutes'
    """), {
        'vid': str(arrival.vid),
        'stpid': str(arrival.stpid),
        'error_seconds': error_seconds,
        'actual_arrival_epoch': actual_arrival_epoch
    })
    conn.commit()
except Exception as e:
    pass  # Non-critical — don't break arrival detection
```

Note: the exact column names may differ — check the `ab_test_predictions` table schema in app.py first (search for `CREATE TABLE` or `ab_test_predictions`).

**Step 3: Commit**

```bash
git add collector/arrival_detector.py
git commit -m "fix: wire A/B test matching to arrival detector for real ML vs API comparison"
```

---

## Phase 2: Frontend Shell

### Task 6: Install fonts and update Tailwind config

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/index.css`

**Context:** The design uses JetBrains Mono for data numbers and Inter for UI labels. We need to load these and define CSS variables for the design system.

**Step 1: Add font imports to index.html**

In `frontend/index.html`, inside `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Step 2: Replace frontend/src/index.css with design system variables**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg-base:       #080810;
  --bg-surface:    #0f0f1a;
  --bg-elevated:   #161625;
  --border:        #1e1e2e;
  --border-bright: #2e2e4e;

  --signal:        #00d4ff;
  --signal-dim:    #00d4ff33;
  --warning:       #f59e0b;
  --warning-dim:   #f59e0b33;
  --danger:        #ef4444;
  --success:       #10b981;

  --text-primary:  #e2e8f0;
  --text-secondary:#64748b;
  --text-muted:    #3f4a5a;

  --font-mono:     'JetBrains Mono', 'Fira Code', monospace;
  --font-ui:       'Inter', system-ui, sans-serif;
}

* { box-sizing: border-box; }

body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-ui);
  margin: 0;
  overflow: hidden;
  height: 100vh;
}

.mono { font-family: var(--font-mono); }
.signal { color: var(--signal); }
.warning-text { color: var(--warning); }

/* Scrollbar styling */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-bright); border-radius: 2px; }
```

**Step 3: Commit**

```bash
git add frontend/index.html frontend/src/index.css
git commit -m "design: add font imports and CSS design system variables"
```

---

### Task 7: Shared components

**Files:**
- Create: `frontend/src/components/shared/MetricCard.tsx`
- Create: `frontend/src/components/shared/StatusBadge.tsx`
- Create: `frontend/src/components/shared/ReliabilityBar.tsx`
- Create: `frontend/src/components/shared/ConfidenceBand.tsx`
- Create: `frontend/src/components/shared/MiniSparkline.tsx`

**Context:** These are the atomic building blocks used everywhere in the panel. Build them once, use them everywhere.

**Step 1: MetricCard.tsx**

```tsx
// frontend/src/components/shared/MetricCard.tsx
interface MetricCardProps {
  label: string
  value: string | number
  unit?: string
  delta?: string      // e.g. "+3.2s" or "-12%"
  deltaDir?: 'up' | 'down' | 'neutral'
  accent?: boolean
  className?: string
}

export function MetricCard({ label, value, unit, delta, deltaDir = 'neutral', accent, className = '' }: MetricCardProps) {
  const deltaColor =
    deltaDir === 'up' ? 'text-red-400' :
    deltaDir === 'down' ? 'text-emerald-400' :
    'text-slate-400'

  return (
    <div className={`rounded-lg border p-3 ${accent ? 'border-[var(--signal-dim)] bg-[var(--signal-dim)]' : 'border-[var(--border)] bg-[var(--bg-elevated)]'} ${className}`}>
      <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="mono text-2xl font-semibold text-[var(--text-primary)]">{value}</span>
        {unit && <span className="text-xs text-[var(--text-secondary)]">{unit}</span>}
      </div>
      {delta && <div className={`text-xs mono mt-1 ${deltaColor}`}>{delta}</div>}
    </div>
  )
}
```

**Step 2: StatusBadge.tsx**

```tsx
// frontend/src/components/shared/StatusBadge.tsx
type Status = 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN' | 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'DELAYED' | 'ON TIME'

const STATUS_CONFIG: Record<Status, { bg: string; text: string; dot: string }> = {
  OK:        { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  EXCELLENT: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  GOOD:      { bg: 'bg-[var(--signal-dim)]', text: 'text-[var(--signal)]', dot: 'bg-[var(--signal)]' },
  'ON TIME': { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  WARNING:   { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  FAIR:      { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  CRITICAL:  { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
  POOR:      { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
  DELAYED:   { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
  UNKNOWN:   { bg: 'bg-slate-500/10', text: 'text-slate-400', dot: 'bg-slate-400' },
}

export function StatusBadge({ status, pulse }: { status: Status; pulse?: boolean }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.UNKNOWN
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${pulse ? 'animate-pulse' : ''}`} />
      {status}
    </span>
  )
}
```

**Step 3: ReliabilityBar.tsx**

```tsx
// frontend/src/components/shared/ReliabilityBar.tsx
interface ReliabilityBarProps {
  score: number      // 0-100
  label?: string
  showLabel?: boolean
}

export function ReliabilityBar({ score, label, showLabel = true }: ReliabilityBarProps) {
  const filled = Math.round((score / 100) * 5)
  const color =
    score >= 80 ? 'var(--success)' :
    score >= 60 ? 'var(--signal)' :
    score >= 40 ? 'var(--warning)' :
    'var(--danger)'

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {[1,2,3,4,5].map(i => (
          <div
            key={i}
            className="w-3 h-2 rounded-sm transition-colors"
            style={{ background: i <= filled ? color : 'var(--border-bright)' }}
          />
        ))}
      </div>
      {showLabel && label && (
        <span className="text-xs text-[var(--text-secondary)]" style={{ color }}>{label}</span>
      )}
    </div>
  )
}
```

**Step 4: ConfidenceBand.tsx**

```tsx
// frontend/src/components/shared/ConfidenceBand.tsx
interface ConfidenceBandProps {
  low: number       // minutes
  median: number    // minutes
  high: number      // minutes
  apiMinutes?: number
}

export function ConfidenceBand({ low, median, high, apiMinutes }: ConfidenceBandProps) {
  // Map minutes to percentage position within [0, max+20%] range
  const maxVal = Math.max(high * 1.1, 30)
  const pct = (v: number) => `${Math.min((v / maxVal) * 100, 100)}%`

  return (
    <div className="py-2">
      <div className="flex justify-between items-baseline mb-2">
        <span className="mono text-3xl font-semibold text-[var(--text-primary)]">{median}</span>
        <span className="text-sm text-[var(--text-secondary)]">min</span>
      </div>
      {/* Range bar */}
      <div className="relative h-1.5 bg-[var(--border)] rounded-full mb-1.5">
        {/* Band */}
        <div
          className="absolute h-full rounded-full"
          style={{
            left: pct(low),
            right: `${100 - parseFloat(pct(high))}%`,
            background: 'var(--signal-dim)',
            border: '1px solid var(--signal)',
          }}
        />
        {/* Median dot */}
        <div
          className="absolute w-2 h-2 rounded-full -top-0.25 -translate-x-1/2"
          style={{ left: pct(median), background: 'var(--signal)' }}
        />
      </div>
      <div className="flex justify-between text-[10px] mono text-[var(--text-secondary)]">
        <span>{low}m</span>
        <span className="text-[var(--text-secondary)]">80% confidence</span>
        <span>{high}m</span>
      </div>
      {apiMinutes !== undefined && (
        <div className="text-xs text-[var(--text-secondary)] mt-1.5">
          API estimate: <span className="mono text-[var(--warning)]">{apiMinutes}m</span>
        </div>
      )}
    </div>
  )
}
```

**Step 5: MiniSparkline.tsx**

```tsx
// frontend/src/components/shared/MiniSparkline.tsx
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'

interface MiniSparklineProps {
  data: Array<{ value: number; label?: string }>
  color?: string
  height?: number
}

export function MiniSparkline({ data, color = 'var(--signal)', height = 40 }: MiniSparklineProps) {
  if (!data.length) return null
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
          formatter={(v: number) => [v.toFixed(1), '']}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ''}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

**Step 6: Commit**

```bash
git add frontend/src/components/shared/
git commit -m "feat: add shared MetricCard, StatusBadge, ReliabilityBar, ConfidenceBand, MiniSparkline"
```

---

### Task 8: Layout shell — TopBar, BottomTabs, App.tsx

**Files:**
- Create: `frontend/src/components/layout/TopBar.tsx`
- Create: `frontend/src/components/layout/BottomTabs.tsx`
- Rewrite: `frontend/src/App.tsx`

**Context:** The root layout. Map and panel sit side-by-side at full height. TopBar spans the top. BottomTabs float over the map bottom-left. A shared state (`panelMode`, `selectedRoute`, `selectedStop`) lives in App and flows down.

**Step 1: TopBar.tsx**

```tsx
// frontend/src/components/layout/TopBar.tsx
import { Activity } from 'lucide-react'

interface TopBarProps {
  modelMAE?: number    // seconds
  routeFilter: string
  routes: Array<{ rt: string; rtnm: string }>
  onRouteChange: (rt: string) => void
  liveCount: number
  delayedCount: number
}

export function TopBar({ modelMAE, routeFilter, routes, onRouteChange, liveCount, delayedCount }: TopBarProps) {
  return (
    <header
      className="flex items-center justify-between px-4 border-b shrink-0"
      style={{
        height: 48,
        background: 'var(--bg-surface)',
        borderColor: 'var(--border)',
        zIndex: 60,
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <div className="w-2 h-2 rounded-full bg-[var(--signal)] animate-pulse" />
        <span className="font-semibold text-[var(--text-primary)] tracking-tight">Madison Metro</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--signal)] text-[var(--signal)] font-mono uppercase">Live</span>
      </div>

      {/* Route filter */}
      <select
        value={routeFilter}
        onChange={e => onRouteChange(e.target.value)}
        className="text-sm px-3 py-1.5 rounded border outline-none cursor-pointer appearance-none"
        style={{
          background: 'var(--bg-elevated)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-ui)',
        }}
      >
        <option value="ALL">All Routes</option>
        {routes.map(r => (
          <option key={r.rt} value={r.rt}>{r.rt} — {r.rtnm}</option>
        ))}
      </select>

      {/* Live stats + MAE badge */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="mono text-[var(--text-primary)]">{liveCount}</span>
          <span className="text-[var(--text-secondary)]">buses</span>
          {delayedCount > 0 && (
            <>
              <span className="text-[var(--border-bright)]">·</span>
              <span className="mono text-[var(--danger)]">{delayedCount}</span>
              <span className="text-[var(--text-secondary)]">late</span>
            </>
          )}
        </div>
        {modelMAE !== undefined && (
          <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border"
            style={{ borderColor: 'var(--signal-dim)', background: 'var(--signal-dim)' }}>
            <Activity className="w-3 h-3 text-[var(--signal)]" />
            <span className="mono text-[var(--signal)]">{Math.round(modelMAE)}s</span>
            <span className="text-[var(--text-secondary)]">MAE</span>
          </div>
        )}
      </div>
    </header>
  )
}
```

**Step 2: BottomTabs.tsx**

```tsx
// frontend/src/components/layout/BottomTabs.tsx
import { Map, BarChart2, Settings } from 'lucide-react'

export type PanelMode = 'map' | 'analytics' | 'system'

interface BottomTabsProps {
  mode: PanelMode
  onChange: (mode: PanelMode) => void
}

const TABS: Array<{ mode: PanelMode; icon: React.ReactNode; label: string }> = [
  { mode: 'map',       icon: <Map className="w-4 h-4" />,       label: 'Map' },
  { mode: 'analytics', icon: <BarChart2 className="w-4 h-4" />, label: 'Analytics' },
  { mode: 'system',    icon: <Settings className="w-4 h-4" />,  label: 'System' },
]

export function BottomTabs({ mode, onChange }: BottomTabsProps) {
  return (
    <div
      className="absolute bottom-5 left-5 z-50 flex items-center gap-1 p-1 rounded-xl border"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      {TABS.map(tab => (
        <button
          key={tab.mode}
          onClick={() => onChange(tab.mode)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={
            mode === tab.mode
              ? { background: 'var(--signal-dim)', color: 'var(--signal)' }
              : { color: 'var(--text-secondary)' }
          }
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  )
}
```

**Step 3: Rewrite App.tsx**

```tsx
// frontend/src/App.tsx
import { useState } from 'react'
import { TopBar } from './components/layout/TopBar'
import { BottomTabs, PanelMode } from './components/layout/BottomTabs'
import { MapView } from './components/map/MapView'
import { ContextPanel } from './components/panel/ContextPanel'

export interface SelectedStop {
  stpid: string
  stpnm: string
  route: string
  position: [number, number]
}

export default function App() {
  const [panelMode, setPanelMode] = useState<PanelMode>('map')
  const [selectedRoute, setSelectedRoute] = useState('ALL')
  const [selectedStop, setSelectedStop] = useState<SelectedStop | null>(null)
  const [routes, setRoutes] = useState<Array<{ rt: string; rtnm: string }>>([])
  const [liveCount, setLiveCount] = useState(0)
  const [delayedCount, setDelayedCount] = useState(0)
  const [modelMAE, setModelMAE] = useState<number | undefined>(undefined)

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: 'var(--bg-base)' }}>
      <TopBar
        modelMAE={modelMAE}
        routeFilter={selectedRoute}
        routes={routes}
        onRouteChange={rt => { setSelectedRoute(rt); setSelectedStop(null) }}
        liveCount={liveCount}
        delayedCount={delayedCount}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Map: always rendered, never unmounted */}
        <div className="relative flex-1">
          <MapView
            selectedRoute={selectedRoute}
            selectedStop={selectedStop}
            onRoutesLoaded={setRoutes}
            onLiveDataUpdate={(live, delayed) => { setLiveCount(live); setDelayedCount(delayed) }}
            onStopSelect={setSelectedStop}
            onModelMAE={setModelMAE}
          />
          <BottomTabs mode={panelMode} onChange={mode => { setPanelMode(mode) }} />
        </div>

        {/* Context panel: always rendered, content swaps */}
        <ContextPanel
          mode={panelMode}
          selectedRoute={selectedRoute}
          selectedStop={selectedStop}
          onClearStop={() => setSelectedStop(null)}
        />
      </div>
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/layout/
git commit -m "feat: new layout shell — TopBar, BottomTabs, split map+panel"
```

---

### Task 9: Refactor MapView into sub-components

**Files:**
- Rewrite: `frontend/src/components/map/MapView.tsx`

**Context:** The existing 630-line MapView does everything. We keep all the DeckGL/MapLibre logic but it now receives `selectedRoute` and `selectedStop` as props, emits events up, and doesn't render any modals (those move to the panel). The map no longer owns stop prediction fetching.

**Step 1: Rewrite MapView.tsx**

Preserve all existing DeckGL layer logic (PathLayer, ScatterplotLayer), bus position polling, pattern fetching. The key changes:

1. Remove all modal/prediction UI (the stop predictions modal is now in the panel)
2. Add `onStopSelect` callback instead of opening a modal
3. Accept `selectedStop` prop to highlight the selected stop
4. Color route paths by reliability score (new)
5. Show reliability rings on stops (new — colored circle outline)

```tsx
// frontend/src/components/map/MapView.tsx
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import DeckGL from '@deck.gl/react'
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import { Map } from '@vis.gl/react-maplibre'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import axios from 'axios'
import { SelectedStop } from '../../App'

const INITIAL_VIEW_STATE = {
  longitude: -89.384, latitude: 43.073,
  zoom: 12, pitch: 0, bearing: 0,
}
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000'

// Default route colors (fallback when no reliability data)
const ROUTE_COLORS: Record<string, [number, number, number]> = {
  'A': [238,51,37], 'B': [128,188,0], 'E': [34,114,181], 'F': [34,114,181],
  'G': [34,114,181], 'H': [34,114,181], 'J': [34,114,181], 'L': [194,163,255],
  'O': [194,163,255], 'P': [34,114,181], 'R': [194,163,255], 'S': [194,163,255],
  'W': [34,114,181], '28': [34,114,181], '38': [34,114,181], '55': [194,163,255],
  '80': [51,51,102], '81': [51,51,102], '82': [51,51,102], '84': [51,51,102],
}

// Interpolate between teal (reliable) and amber (unreliable) based on score 0-100
function reliabilityColor(score: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, score / 100))
  // teal: [0,212,255], amber: [245,158,11]
  return [
    Math.round(245 + (0 - 245) * t),
    Math.round(158 + (212 - 158) * t),
    Math.round(11 + (255 - 11) * t),
  ]
}

interface Props {
  selectedRoute: string
  selectedStop: SelectedStop | null
  onRoutesLoaded: (routes: Array<{ rt: string; rtnm: string }>) => void
  onLiveDataUpdate: (total: number, delayed: number) => void
  onStopSelect: (stop: SelectedStop) => void
  onModelMAE: (mae: number) => void
}

export function MapView({ selectedRoute, selectedStop, onRoutesLoaded, onLiveDataUpdate, onStopSelect, onModelMAE }: Props) {
  const [liveData, setLiveData] = useState<any[]>([])
  const [patternsData, setPatternsData] = useState<any[]>([])
  const [stopsData, setStopsData] = useState<any[]>([])
  const [routeReliability, setRouteReliability] = useState<Record<string, number>>({})

  // Fetch model MAE for TopBar
  useEffect(() => {
    axios.get(`${API_BASE}/api/model-status`)
      .then(r => r.data.current_mae && onModelMAE(r.data.current_mae))
      .catch(() => {})
  }, [])

  // Fetch route reliability
  useEffect(() => {
    axios.get(`${API_BASE}/api/route-reliability`)
      .then(r => {
        const map: Record<string, number> = {}
        ;(r.data.routes || []).forEach((rt: any) => { map[rt.route] = rt.reliability_score })
        setRouteReliability(map)
      }).catch(() => {})
  }, [])

  // Fetch routes + patterns
  useEffect(() => {
    const load = async () => {
      try {
        const routesRes = await axios.get(`${API_BASE}/routes`)
        const routeList = routesRes.data['bustime-response']?.routes || []
        onRoutesLoaded(routeList)
        const patternResponses = await Promise.all(
          routeList.map((r: any) => axios.get(`${API_BASE}/patterns?rt=${r.rt}`).catch(() => null))
        )
        const allPatterns: any[] = []
        patternResponses.forEach((res, i) => {
          if (!res?.data?.['bustime-response']?.ptr) return
          const rt = routeList[i].rt
          const score = routeReliability[rt] ?? 70
          const color = reliabilityColor(score)
          const ptrs = res.data['bustime-response'].ptr
          const patterns = Array.isArray(ptrs) ? ptrs : [ptrs]
          patterns.forEach((p: any) => {
            if (!p?.pt?.length) return
            allPatterns.push({ path: p.pt.map((pt: any) => [parseFloat(pt.lon), parseFloat(pt.lat)]), color, route: rt })
          })
        })
        setPatternsData(allPatterns)
      } catch (e) { console.error(e) }
    }
    load()
  }, [routeReliability])

  // Fetch stops when route selected
  useEffect(() => {
    if (selectedRoute === 'ALL') { setStopsData([]); return }
    axios.get(`${API_BASE}/stops?rt=${selectedRoute}`)
      .then(r => {
        const stops = r.data?.['bustime-response']?.stops || []
        setStopsData(stops.map((s: any) => ({
          position: [parseFloat(s.lon), parseFloat(s.lat)],
          stpid: s.stpid, stpnm: s.stpnm, route: selectedRoute,
        })))
      }).catch(() => {})
  }, [selectedRoute])

  // Live bus polling
  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await axios.get(`${API_BASE}/vehicles`)
        const vehicles = res.data?.['bustime-response']?.vehicle
        if (!vehicles) return
        const arr = Array.isArray(vehicles) ? vehicles : [vehicles]
        const mapped = arr.map((v: any) => ({
          position: [parseFloat(v.lon), parseFloat(v.lat)],
          route: v.rt, vid: v.vid, des: v.des,
          dly: v.dly === true || v.dly === 'true',
          prdctdn: v.prdctdn,
          color: ROUTE_COLORS[v.rt] || [100, 100, 100],
        }))
        setLiveData(mapped)
        onLiveDataUpdate(mapped.length, mapped.filter(v => v.dly).length)
      } catch (e) {}
    }
    fetch()
    const id = setInterval(fetch, 15000)
    return () => clearInterval(id)
  }, [])

  const filtered = useMemo(() =>
    selectedRoute === 'ALL' ? liveData : liveData.filter(v => v.route === selectedRoute),
    [liveData, selectedRoute]
  )
  const filteredPatterns = useMemo(() =>
    selectedRoute === 'ALL' ? patternsData : patternsData.filter(p => p.route === selectedRoute),
    [patternsData, selectedRoute]
  )

  const layers = useMemo(() => {
    const list: any[] = []
    if (filteredPatterns.length) {
      list.push(new PathLayer({
        id: 'routes', data: filteredPatterns,
        getPath: (d: any) => d.path,
        getColor: (d: any) => [...d.color, 180],
        getWidth: 4, widthMinPixels: 2, capRounded: true, jointRounded: true,
      }))
    }
    if (stopsData.length) {
      list.push(new ScatterplotLayer({
        id: 'stops', data: stopsData, pickable: true,
        radiusMinPixels: 5, radiusMaxPixels: 10,
        getPosition: (d: any) => d.position, getRadius: 30,
        // Ring color based on reliability score for this stop at current hour
        getFillColor: (d: any) => d.stpid === selectedStop?.stpid ? [0,212,255,200] : [255,255,255,160],
        getLineColor: [100,100,100], stroked: true, lineWidthMinPixels: 1,
        onClick: ({ object }) => {
          if (object) onStopSelect({ stpid: object.stpid, stpnm: object.stpnm, route: object.route, position: object.position })
        },
      }))
    }
    if (filtered.length) {
      list.push(new ScatterplotLayer({
        id: 'buses', data: filtered, pickable: true,
        radiusMinPixels: 7, radiusMaxPixels: 18,
        getPosition: (d: any) => d.position, getRadius: 50,
        getFillColor: (d: any) => d.dly ? [239,68,68] : d.color,
        getLineColor: [255,255,255], stroked: true, lineWidthMinPixels: 2,
      }))
    }
    return list
  }, [filteredPatterns, stopsData, filtered, selectedStop])

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      style={{ width: '100%', height: '100%' }}
      getTooltip={({ object }) => {
        if (!object) return null
        if (object.stpid) return {
          html: `<div style="background:#0f0f1a;color:#e2e8f0;padding:8px 12px;border-radius:8px;font-family:system-ui;border:1px solid #1e1e2e;font-size:12px">
            <div style="font-weight:600">${object.stpnm}</div>
            <div style="color:#64748b;margin-top:2px">Stop #${object.stpid} · Click for predictions</div>
          </div>`,
          style: { backgroundColor: 'transparent' }
        }
        return {
          html: `<div style="background:#0f0f1a;color:#e2e8f0;padding:8px 12px;border-radius:8px;font-family:system-ui;border:1px solid #1e1e2e;font-size:12px">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
              <span style="font-weight:600">Route ${object.route}</span>
              <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:${object.dly?'rgba(239,68,68,.2)':'rgba(16,185,129,.2)'};color:${object.dly?'#f87171':'#34d399'}">${object.dly?'DELAYED':'ON TIME'}</span>
            </div>
            <div style="color:#64748b">${object.des || ''}</div>
            <div style="color:#64748b;font-size:11px;margin-top:4px">Vehicle ${object.vid}</div>
          </div>`,
          style: { backgroundColor: 'transparent' }
        }
      }}
    >
      <Map reuseMaps mapLib={maplibregl} mapStyle={MAP_STYLE} />
    </DeckGL>
  )
}
```

**Step 5: Commit**

```bash
git add frontend/src/components/map/MapView.tsx
git commit -m "refactor: MapView emits events, no modal, reliability-colored routes"
```

---

### Task 10: ContextPanel shell + MAP tab panels

**Files:**
- Create: `frontend/src/components/panel/ContextPanel.tsx`
- Create: `frontend/src/components/panel/map/CityOverview.tsx`
- Create: `frontend/src/components/panel/map/RouteDrilldown.tsx`
- Create: `frontend/src/components/panel/map/StopPredictions.tsx`

**Step 1: ContextPanel.tsx**

```tsx
// frontend/src/components/panel/ContextPanel.tsx
import { PanelMode } from '../layout/BottomTabs'
import { SelectedStop } from '../../App'
import { CityOverview } from './map/CityOverview'
import { RouteDrilldown } from './map/RouteDrilldown'
import { StopPredictions } from './map/StopPredictions'
import { AnalyticsPanel } from './analytics/AnalyticsPanel'
import { SystemPanel } from './system/SystemPanel'

interface Props {
  mode: PanelMode
  selectedRoute: string
  selectedStop: SelectedStop | null
  onClearStop: () => void
}

export function ContextPanel({ mode, selectedRoute, selectedStop, onClearStop }: Props) {
  return (
    <aside
      className="flex flex-col border-l overflow-y-auto shrink-0"
      style={{
        width: 380,
        background: 'var(--bg-surface)',
        borderColor: 'var(--border)',
      }}
    >
      {mode === 'map' && (
        selectedStop
          ? <StopPredictions stop={selectedStop} onClose={onClearStop} />
          : selectedRoute !== 'ALL'
          ? <RouteDrilldown route={selectedRoute} />
          : <CityOverview />
      )}
      {mode === 'analytics' && <AnalyticsPanel />}
      {mode === 'system' && <SystemPanel />}
    </aside>
  )
}
```

**Step 2: CityOverview.tsx**

```tsx
// frontend/src/components/panel/map/CityOverview.tsx
import { useEffect, useState } from 'react'
import axios from 'axios'
import { MetricCard } from '../../shared/MetricCard'
import { ReliabilityBar } from '../../shared/ReliabilityBar'
import { StatusBadge } from '../../shared/StatusBadge'

const API = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000'

export function CityOverview() {
  const [modelPerf, setModelPerf] = useState<any>(null)
  const [reliability, setReliability] = useState<any[]>([])
  const [drift, setDrift] = useState<any>(null)

  useEffect(() => {
    axios.get(`${API}/api/model-performance`).then(r => setModelPerf(r.data)).catch(() => {})
    axios.get(`${API}/api/route-reliability`).then(r => setReliability(r.data.routes || [])).catch(() => {})
    axios.get(`${API}/api/drift/check`).then(r => setDrift(r.data)).catch(() => {})
  }, [])

  const mae = modelPerf?.current_model?.mae_seconds
  const baseline = modelPerf?.api_baseline?.mae_seconds
  const improvement = modelPerf?.current_model?.improvement_vs_baseline_pct

  return (
    <div className="flex flex-col gap-0">
      {/* Header */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[11px] uppercase tracking-widest text-[var(--text-secondary)]">City Overview</div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-2 p-4">
        <MetricCard
          label="Model MAE"
          value={mae ? Math.round(mae) : '—'}
          unit="s"
          accent
          delta={improvement ? `-${improvement.toFixed(1)}% vs API` : undefined}
          deltaDir="down"
        />
        <MetricCard
          label="API Baseline"
          value={baseline ? Math.round(baseline) : '—'}
          unit="s"
        />
      </div>

      {/* Drift status */}
      {drift && (
        <div className="mx-4 mb-4 p-3 rounded-lg border flex items-center justify-between"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-1">Model Health</div>
            <div className="text-xs text-[var(--text-secondary)]">{drift.recommendation}</div>
          </div>
          <StatusBadge status={drift.status} pulse={drift.status === 'OK'} />
        </div>
      )}

      {/* Route reliability */}
      <div className="px-4 pb-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-3">Route Reliability (7d)</div>
        <div className="flex flex-col gap-2.5">
          {reliability.slice(0, 10).map(r => (
            <div key={r.route} className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="mono text-sm font-medium text-[var(--text-primary)] w-8 shrink-0">{r.route}</span>
                <ReliabilityBar score={r.reliability_score} showLabel={false} />
              </div>
              <div className="flex items-center gap-2 ml-2">
                <span className="mono text-xs text-[var(--text-secondary)]">{Math.round(r.avg_error_sec)}s</span>
                <StatusBadge status={r.rating?.toUpperCase() as any} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

**Step 3: StopPredictions.tsx**

```tsx
// frontend/src/components/panel/map/StopPredictions.tsx
import { useEffect, useState } from 'react'
import axios from 'axios'
import { X, MapPin } from 'lucide-react'
import { SelectedStop } from '../../../App'
import { ConfidenceBand } from '../../shared/ConfidenceBand'
import { StatusBadge } from '../../shared/StatusBadge'

const API = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000'

interface Prediction {
  route: string; destination: string; apiMinutes: number
  mlLow: number; mlMedian: number; mlHigh: number; delayed: boolean; vid: string
}

export function StopPredictions({ stop, onClose }: { stop: SelectedStop; onClose: () => void }) {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setPredictions([])
    const fetch = async () => {
      try {
        const res = await axios.get(`${API}/predictions?stpid=${stop.stpid}`)
        const prdArray = res.data?.['bustime-response']?.prd || []
        const prds = Array.isArray(prdArray) ? prdArray : [prdArray]
        const results: Prediction[] = []
        for (const prd of prds.slice(0, 5)) {
          const apiMinutes = parseInt(prd.prdctdn) || 0
          try {
            const ml = await axios.post(`${API}/api/predict-arrival-v2`, {
              route: prd.rt, stop_id: stop.stpid, vehicle_id: prd.vid, api_prediction: apiMinutes
            })
            results.push({
              route: prd.rt, destination: prd.des, apiMinutes,
              mlLow: Math.round(ml.data.eta_low_min),
              mlMedian: Math.round(ml.data.eta_median_min),
              mlHigh: Math.round(ml.data.eta_high_min),
              delayed: prd.dly === true || prd.dly === 'true',
              vid: prd.vid,
            })
          } catch {
            results.push({
              route: prd.rt, destination: prd.des, apiMinutes,
              mlLow: Math.round(apiMinutes * 0.85), mlMedian: apiMinutes,
              mlHigh: Math.round(apiMinutes * 1.3),
              delayed: prd.dly === true || prd.dly === 'true', vid: prd.vid,
            })
          }
        }
        setPredictions(results)
      } catch (e) {}
      finally { setLoading(false) }
    }
    fetch()
  }, [stop.stpid])

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <MapPin className="w-3.5 h-3.5 text-[var(--signal)]" />
            <span className="font-semibold text-[var(--text-primary)] text-sm">{stop.stpnm}</span>
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mono">Stop #{stop.stpid} · {stop.route}</div>
        </div>
        <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Predictions */}
      <div className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
        {loading && (
          <div className="px-4 py-8 text-center text-[var(--text-secondary)] text-sm">
            <div className="w-4 h-4 border border-[var(--signal)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Loading ML predictions...
          </div>
        )}
        {!loading && predictions.length === 0 && (
          <div className="px-4 py-8 text-center text-[var(--text-secondary)] text-sm">
            No buses approaching this stop
          </div>
        )}
        {predictions.map((pred, i) => (
          <div key={i} className="px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="mono font-semibold text-[var(--text-primary)]">Route {pred.route}</span>
                <StatusBadge status={pred.delayed ? 'DELAYED' : 'ON TIME'} />
              </div>
              <span className="text-xs text-[var(--text-secondary)] mono">#{pred.vid}</span>
            </div>
            <div className="text-xs text-[var(--text-secondary)] mb-2">{pred.destination}</div>
            <ConfidenceBand
              low={pred.mlLow}
              median={pred.mlMedian}
              high={pred.mlHigh}
              apiMinutes={pred.apiMinutes}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Step 4: RouteDrilldown.tsx**

```tsx
// frontend/src/components/panel/map/RouteDrilldown.tsx
import { useEffect, useState } from 'react'
import axios from 'axios'
import { MetricCard } from '../../shared/MetricCard'
import { ReliabilityBar } from '../../shared/ReliabilityBar'
import { MiniSparkline } from '../../shared/MiniSparkline'
import { StatusBadge } from '../../shared/StatusBadge'

const API = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000'

export function RouteDrilldown({ route }: { route: string }) {
  const [data, setData] = useState<any>(null)
  const [hourly, setHourly] = useState<any[]>([])
  const [cityMAE, setCityMAE] = useState<number>(58)

  useEffect(() => {
    axios.get(`${API}/api/route-reliability`)
      .then(r => {
        const routes = r.data.routes || []
        const found = routes.find((rt: any) => rt.route === route)
        const city = routes.reduce((sum: number, rt: any) => sum + (rt.avg_error_sec || 0), 0) / (routes.length || 1)
        setData(found || null)
        setCityMAE(city)
      }).catch(() => {})

    axios.get(`${API}/api/diagnostics/hourly-bias`)
      .then(r => setHourly((r.data.hourly || []).map((h: any) => ({ value: h.mae, label: h.hour_label }))))
      .catch(() => {})
  }, [route])

  if (!data) return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[11px] uppercase tracking-widest text-[var(--text-secondary)]">Route {route}</div>
      </div>
      <div className="px-4 py-8 text-center text-[var(--text-secondary)] text-sm">Loading route data...</div>
    </div>
  )

  const delta = data.avg_error_sec - cityMAE
  return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
        <div>
          <div className="text-[11px] uppercase tracking-widest text-[var(--text-secondary)]">Route {route}</div>
          <div className="font-semibold text-[var(--text-primary)] text-sm mt-0.5">{data.rating}</div>
        </div>
        <StatusBadge status={data.rating?.toUpperCase()} />
      </div>

      <div className="p-4">
        <ReliabilityBar score={data.reliability_score} label={data.rating} />
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 pb-4">
        <MetricCard label="Avg Error" value={Math.round(data.avg_error_sec)} unit="s"
          delta={delta > 0 ? `+${Math.round(delta)}s vs city` : `${Math.round(delta)}s vs city`}
          deltaDir={delta > 0 ? 'up' : 'down'} />
        <MetricCard label="Within 2min" value={data.within_2min_pct?.toFixed(1)} unit="%" />
      </div>

      {hourly.length > 0 && (
        <div className="px-4 pb-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2">Hourly MAE (all routes)</div>
          <MiniSparkline data={hourly} color="var(--signal)" height={48} />
        </div>
      )}

      <div className="px-4 pb-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-[var(--text-secondary)] mb-0.5">Predictions (7d)</div>
            <div className="mono text-[var(--text-primary)]">{data.prediction_count?.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[var(--text-secondary)] mb-0.5">Median Error</div>
            <div className="mono text-[var(--text-primary)]">{Math.round(data.median_error_sec)}s</div>
          </div>
          <div>
            <div className="text-[var(--text-secondary)] mb-0.5">Within 1min</div>
            <div className="mono text-[var(--text-primary)]">{data.within_1min_pct?.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-[var(--text-secondary)] mb-0.5">Reliability Score</div>
            <div className="mono text-[var(--signal)]">{data.reliability_score?.toFixed(0)}/100</div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 5: Commit**

```bash
git add frontend/src/components/panel/
git commit -m "feat: ContextPanel shell + MAP tab panels (CityOverview, RouteDrilldown, StopPredictions)"
```

---

### Task 11: Analytics panel

**Files:**
- Create: `frontend/src/components/panel/analytics/AnalyticsPanel.tsx`
- Create: `frontend/src/components/panel/analytics/PerformanceTab.tsx`
- Create: `frontend/src/components/panel/analytics/ErrorsTab.tsx`
- Create: `frontend/src/components/panel/analytics/RoutesTab.tsx`

**Step 1: AnalyticsPanel.tsx (sub-pill shell)**

```tsx
// frontend/src/components/panel/analytics/AnalyticsPanel.tsx
import { useState } from 'react'
import { PerformanceTab } from './PerformanceTab'
import { ErrorsTab } from './ErrorsTab'
import { RoutesTab } from './RoutesTab'

type Sub = 'performance' | 'errors' | 'routes'

export function AnalyticsPanel() {
  const [sub, setSub] = useState<Sub>('performance')

  return (
    <div className="flex flex-col h-full">
      {/* Header with sub-pills */}
      <div className="px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[11px] uppercase tracking-widest text-[var(--text-secondary)] mb-2">Analytics</div>
        <div className="flex gap-1">
          {(['performance','errors','routes'] as Sub[]).map(s => (
            <button key={s} onClick={() => setSub(s)}
              className="px-3 py-1 rounded text-xs font-medium capitalize transition-all"
              style={sub === s
                ? { background: 'var(--signal-dim)', color: 'var(--signal)' }
                : { color: 'var(--text-secondary)' }
              }
            >{s}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sub === 'performance' && <PerformanceTab />}
        {sub === 'errors' && <ErrorsTab />}
        {sub === 'routes' && <RoutesTab />}
      </div>
    </div>
  )
}
```

**Step 2: PerformanceTab.tsx**

```tsx
// frontend/src/components/panel/analytics/PerformanceTab.tsx
import { useEffect, useState } from 'react'
import axios from 'axios'
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, ReferenceLine } from 'recharts'
import { MetricCard } from '../../shared/MetricCard'
import { StatusBadge } from '../../shared/StatusBadge'

const API = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000'

export function PerformanceTab() {
  const [stability, setStability] = useState<any>(null)
  const [coverage, setCoverage] = useState<any[]>([])
  const [modelPerf, setModelPerf] = useState<any>(null)

  useEffect(() => {
    axios.get(`${API}/api/model-diagnostics/temporal-stability`).then(r => setStability(r.data)).catch(() => {})
    axios.get(`${API}/api/model-diagnostics/coverage`).then(r => setCoverage(r.data.coverage || [])).catch(() => {})
    axios.get(`${API}/api/model-performance`).then(r => setModelPerf(r.data)).catch(() => {})
  }, [])

  const dailyData = stability?.daily_metrics?.map((d: any) => ({
    date: d.date?.slice(5),  // MM-DD
    mae: Math.round(d.mae),
  })) || []

  const trainingRuns = modelPerf?.training_history?.slice(0, 5) || []

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* MAE Trend */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2">MAE Over Time (14d)</div>
        {dailyData.length > 0 ? (
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="maeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--signal)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--signal)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }} formatter={(v: number) => [`${v}s`, 'MAE']} />
              <Area type="monotone" dataKey="mae" stroke="var(--signal)" strokeWidth={1.5} fill="url(#maeGrad)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <div className="h-20 flex items-center justify-center text-xs text-[var(--text-secondary)]">No data</div>}
      </div>

      {/* Coverage */}
      {coverage.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2">Coverage Thresholds</div>
          <ResponsiveContainer width="100%" height={90}>
            <BarChart data={coverage} layout="vertical" barSize={8}>
              <XAxis type="number" domain={[0,100]} tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
              <YAxis type="category" dataKey="threshold" tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={32} />
              <ReferenceLine x={80} stroke="var(--warning)" strokeDasharray="3 3" />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }} formatter={(v: number) => [`${v.toFixed(1)}%`, '']} />
              <Bar dataKey="percentage" fill="var(--signal)" radius={[0,4,4,0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Training runs */}
      {trainingRuns.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2">Recent Training Runs</div>
          <div className="flex flex-col gap-1">
            {trainingRuns.map((run: any) => (
              <div key={run.version} className="flex items-center justify-between text-xs py-1.5 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="flex flex-col">
                  <span className="mono text-[var(--text-primary)]">{run.trained_at?.slice(0,10)}</span>
                  <span className="text-[var(--text-muted)]">{run.reason}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="mono text-[var(--text-secondary)]">{Math.round(run.mae)}s</span>
                  <StatusBadge status={run.deployed ? 'OK' : 'UNKNOWN'} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 3: ErrorsTab.tsx**

```tsx
// frontend/src/components/panel/analytics/ErrorsTab.tsx
import { useEffect, useState } from 'react'
import axios from 'axios'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { MetricCard } from '../../shared/MetricCard'

const API = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000'

export function ErrorsTab() {
  const [horizonData, setHorizonData] = useState<any[]>([])
  const [hourlyData, setHourlyData] = useState<any[]>([])
  const [worstData, setWorstData] = useState<any[]>([])
  const [insights, setInsights] = useState<any>(null)

  useEffect(() => {
    axios.get(`${API}/api/diagnostics/error-by-horizon`).then(r => setHorizonData(r.data.buckets || [])).catch(() => {})
    axios.get(`${API}/api/diagnostics/hourly-bias`).then(r => {
      setHourlyData(r.data.hourly || [])
      setInsights(r.data.insights)
    }).catch(() => {})
    axios.get(`${API}/api/diagnostics/worst-predictions`).then(r => setWorstData(r.data.worst_predictions || [])).catch(() => {})
  }, [])

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Rush hour insight cards */}
      {insights && (
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="Rush MAE" value={Math.round(insights.rush_hour_mae)} unit="s" />
          <MetricCard label="Off-Peak MAE" value={Math.round(insights.non_rush_mae)} unit="s"
            delta={`+${Math.round(insights.rush_hour_penalty)}s penalty`} deltaDir="up" />
        </div>
      )}

      {/* Error by horizon */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2">Error by Horizon</div>
        {horizonData.length > 0 ? (
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={horizonData} barSize={28}>
              <XAxis dataKey="horizon" tick={{ fontSize: 9, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }} formatter={(v: number) => [`${Math.round(v)}s`, 'MAE']} />
              <Bar dataKey="mae" radius={[4,4,0,0]} isAnimationActive={false}>
                {horizonData.map((_: any, i: number) => (
                  <Cell key={i} fill={`rgba(0,212,255,${0.4 + (i / horizonData.length) * 0.6})`} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="h-24 flex items-center justify-center text-xs text-[var(--text-secondary)]">No data</div>}
      </div>

      {/* Hourly heatmap strip */}
      {hourlyData.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2">Hourly Bias (24h)</div>
          <div className="flex gap-0.5">
            {hourlyData.map((h: any) => {
              const intensity = Math.min(h.mae / 120, 1)
              return (
                <div key={h.hour} title={`${h.hour_label}: ${Math.round(h.mae)}s`}
                  className="flex-1 h-6 rounded-sm cursor-help"
                  style={{ background: `rgba(245,158,11,${0.1 + intensity * 0.9})` }} />
              )
            })}
          </div>
          <div className="flex justify-between text-[9px] mono text-[var(--text-secondary)] mt-1">
            <span>00:00</span><span>12:00</span><span>23:00</span>
          </div>
        </div>
      )}

      {/* Worst predictions */}
      {worstData.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2">Worst Predictions (24h)</div>
          <div className="flex flex-col gap-1">
            {worstData.slice(0, 8).map((w: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs py-1 border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2">
                  <span className="mono font-medium text-[var(--text-primary)] w-6">{w.route}</span>
                  <span className="text-[var(--text-secondary)] truncate max-w-[120px]">Stop {w.stop_id}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="mono text-[var(--danger)]">{w.direction === 'late' ? '+' : '-'}{Math.round(w.error_minutes)}m</span>
                  {w.hour !== null && <span className="mono text-[var(--text-muted)] text-[10px]">{String(w.hour).padStart(2,'0')}:00</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 4: RoutesTab.tsx**

```tsx
// frontend/src/components/panel/analytics/RoutesTab.tsx
import { useEffect, useState } from 'react'
import axios from 'axios'
import { ReliabilityBar } from '../../shared/ReliabilityBar'
import { StatusBadge } from '../../shared/StatusBadge'

const API = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000'

export function RoutesTab() {
  const [routes, setRoutes] = useState<any[]>([])
  const [heatmap, setHeatmap] = useState<any>(null)
  const [sortKey, setSortKey] = useState<'avgError' | 'within2min'>('avgError')

  useEffect(() => {
    axios.get(`${API}/api/route-accuracy`).then(r => setRoutes(r.data.routes || [])).catch(() => {})
    axios.get(`${API}/api/model-diagnostics/route-heatmap`).then(r => setHeatmap(r.data)).catch(() => {})
  }, [])

  const sorted = [...routes].sort((a, b) =>
    sortKey === 'avgError' ? Number(a.avgError) - Number(b.avgError) : Number(b.within2min) - Number(a.within2min)
  )

  const hours = heatmap?.hours?.filter((h: number) => h >= 5 && h <= 22) || []
  const heatmapRoutes = heatmap?.heatmap?.slice(0, 10) || []
  const maxMAE = heatmapRoutes.reduce((max: number, r: any) =>
    Math.max(max, ...hours.map((h: number) => r[`h${h}`] || 0)), 1)

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Sort controls */}
      <div className="flex gap-1">
        {(['avgError','within2min'] as const).map(k => (
          <button key={k} onClick={() => setSortKey(k)}
            className="px-2.5 py-1 rounded text-[10px] uppercase tracking-wider transition-all"
            style={sortKey === k ? { background: 'var(--signal-dim)', color: 'var(--signal)' } : { color: 'var(--text-secondary)' }}>
            {k === 'avgError' ? 'Avg Error' : 'Coverage'}
          </button>
        ))}
      </div>

      {/* Route table */}
      <div className="flex flex-col gap-0.5">
        {sorted.slice(0, 15).map(r => {
          const score = Math.max(0, 100 - Number(r.avgError) / 2)
          const rating = score >= 80 ? 'EXCELLENT' : score >= 60 ? 'GOOD' : score >= 40 ? 'FAIR' : 'POOR'
          return (
            <div key={r.route} className="flex items-center gap-2 py-1.5 border-b text-xs" style={{ borderColor: 'var(--border)' }}>
              <span className="mono font-medium text-[var(--text-primary)] w-7 shrink-0">{r.route}</span>
              <ReliabilityBar score={score} showLabel={false} />
              <span className="mono text-[var(--text-secondary)] w-10 text-right shrink-0">{Math.round(Number(r.avgError))}s</span>
              <span className="mono text-[var(--text-secondary)] w-12 text-right shrink-0">{Number(r.within2min).toFixed(0)}%</span>
            </div>
          )
        })}
      </div>

      {/* Route × Hour heatmap */}
      {heatmapRoutes.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2">Route × Hour</div>
          <div className="overflow-x-auto">
            <table className="text-[9px] border-collapse w-full">
              <thead>
                <tr>
                  <td className="pr-1 text-[var(--text-secondary)] w-7"></td>
                  {hours.filter((_: number, i: number) => i % 3 === 0).map((h: number) => (
                    <td key={h} className="text-center mono text-[var(--text-secondary)] pb-1" colSpan={3}>{h}h</td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapRoutes.map((r: any) => (
                  <tr key={r.route}>
                    <td className="mono text-[var(--text-primary)] pr-1 py-0.5">{r.route}</td>
                    {hours.map((h: number) => {
                      const v = r[`h${h}`] || 0
                      const intensity = v / maxMAE
                      return (
                        <td key={h} title={`${r.route} ${h}:00 → ${Math.round(v)}s`}
                          className="w-3 h-3 cursor-help"
                          style={{ background: v ? `rgba(245,158,11,${0.1 + intensity * 0.85})` : 'var(--border)' }} />
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 5: Commit**

```bash
git add frontend/src/components/panel/analytics/
git commit -m "feat: analytics panel with Performance, Errors, Routes sub-tabs"
```

---

### Task 12: System panel

**Files:**
- Create: `frontend/src/components/panel/system/SystemPanel.tsx`

```tsx
// frontend/src/components/panel/system/SystemPanel.tsx
import { useEffect, useState } from 'react'
import axios from 'axios'
import { MetricCard } from '../../shared/MetricCard'
import { StatusBadge } from '../../shared/StatusBadge'

const API = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000'

export function SystemPanel() {
  const [modelStatus, setModelStatus] = useState<any>(null)
  const [drift, setDrift] = useState<any>(null)
  const [pipeline, setPipeline] = useState<any>(null)
  const [abResults, setAbResults] = useState<any>(null)

  useEffect(() => {
    axios.get(`${API}/api/model-status`).then(r => setModelStatus(r.data)).catch(() => {})
    axios.get(`${API}/api/drift/check`).then(r => setDrift(r.data)).catch(() => {})
    axios.get(`${API}/api/pipeline-stats`).then(r => setPipeline(r.data)).catch(() => {})
    axios.get(`${API}/api/ab-test/results`).then(r => setAbResults(r.data)).catch(() => {})
  }, [])

  return (
    <div className="flex flex-col gap-0">
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[11px] uppercase tracking-widest text-[var(--text-secondary)]">System</div>
      </div>

      {/* Drift / Model health */}
      {drift && (
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">Model Drift</div>
            <StatusBadge status={drift.status} pulse={drift.status === 'OK'} />
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <MetricCard label="Baseline MAE" value={Math.round(drift.baseline_mae_sec)} unit="s" accent />
            {drift.recent_ml_mae_sec != null
              ? <MetricCard label="Recent MAE"
                  value={Math.round(drift.recent_ml_mae_sec)} unit="s"
                  delta={drift.drift_pct != null ? `${drift.drift_pct > 0 ? '+' : ''}${drift.drift_pct.toFixed(1)}% drift` : undefined}
                  deltaDir={drift.drift_pct > 10 ? 'up' : 'down'} />
              : <MetricCard label="Live Drift" value="N/A" />
            }
          </div>
          <div className="text-xs text-[var(--text-secondary)]">{drift.recommendation}</div>
        </div>
      )}

      {/* Model metadata */}
      {modelStatus && (
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-3">Current Model</div>
          <div className="flex flex-col gap-2 text-xs">
            {[
              ['Version', modelStatus.model_version?.slice(0, 12)],
              ['Trained', modelStatus.trained_at?.slice(0, 10)],
              ['Age', `${modelStatus.model_age_days ?? '?'}d`],
              ['Samples', modelStatus.training_samples?.toLocaleString()],
              ['MAE', `${Math.round(modelStatus.current_mae)}s`],
              ['Improvement', `${modelStatus.improvement_pct?.toFixed(1)}% vs API`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-[var(--text-secondary)]">{label}</span>
                <span className="mono text-[var(--text-primary)]">{value ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* A/B test summary */}
      {abResults && (
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-3">A/B Test Results</div>
          {abResults.matched_predictions > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <MetricCard label="ML MAE" value={abResults.ml_mae_sec != null ? Math.round(abResults.ml_mae_sec) : '—'} unit="s" accent />
                <MetricCard label="API MAE" value={abResults.api_mae_sec != null ? Math.round(abResults.api_mae_sec) : '—'} unit="s" />
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-secondary)]">ML Win Rate</span>
                <span className="mono text-[var(--signal)]">{abResults.ml_win_rate?.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-[var(--text-secondary)]">Matched Predictions</span>
                <span className="mono text-[var(--text-primary)]">{abResults.matched_predictions?.toLocaleString()}</span>
              </div>
            </>
          ) : (
            <div className="text-xs text-[var(--text-secondary)]">No matched predictions yet. A/B test data populates as arrivals are detected.</div>
          )}
        </div>
      )}

      {/* Data pipeline */}
      {pipeline && (
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-3">Data Pipeline</div>
          <div className="flex flex-col gap-2 text-xs">
            {[
              ['Vehicles (24h)', pipeline.vehicle_observations_24h?.toLocaleString()],
              ['Predictions (24h)', pipeline.predictions_24h?.toLocaleString()],
              ['Outcomes (7d)', pipeline.prediction_outcomes_7d?.toLocaleString()],
              ['Collection Rate', pipeline.collection_rate_per_min ? `${pipeline.collection_rate_per_min}/min` : '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-[var(--text-secondary)]">{label}</span>
                <span className="mono text-[var(--text-primary)]">{value ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/panel/system/
git commit -m "feat: system panel with drift, model metadata, A/B results, pipeline stats"
```

---

### Task 13: Remove old Analytics.tsx page + fix routing

**Files:**
- Delete: `frontend/src/pages/Analytics.tsx` (or empty it to avoid breaking imports)
- Verify: `frontend/src/App.tsx` no longer imports it

**Step 1: Check App.tsx imports**

Open `frontend/src/App.tsx`. If it still imports `Analytics`, remove that import and the `/analytics` route. The file should already be the new version from Task 8.

**Step 2: Delete or archive the old file**

```bash
# Rename rather than delete to preserve history
mv frontend/src/pages/Analytics.tsx frontend/src/pages/Analytics.tsx.bak
```

**Step 3: Check for any remaining references**

```bash
grep -r "Analytics" frontend/src --include="*.tsx" --include="*.ts"
```

Fix any remaining imports.

**Step 4: Commit**

```bash
git add frontend/src/
git commit -m "refactor: remove old Analytics page, app is now single-page"
```

---

### Task 14: Build verification + push

**Step 1: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Fix any type errors before proceeding.

**Step 2: Run dev build**

```bash
cd frontend && npm run build
```

Expected: Build succeeds with no errors.

**Step 3: Smoke test locally**

```bash
cd frontend && npm run dev
```

Check:
- [ ] App loads at localhost:5173
- [ ] Map renders
- [ ] BottomTabs visible and switch panel content
- [ ] Route selector changes map filter
- [ ] Clicking a stop shows StopPredictions panel
- [ ] ANALYTICS tab shows Performance/Errors/Routes pills
- [ ] SYSTEM tab shows model health

**Step 4: Push everything**

```bash
git push origin main
```

Wait for Vercel build to succeed.

---

## Phase 3: Cleanup + Polish

### Task 15: Push backend fixes

After confirming frontend works, push the backend changes (Tasks 1-5):

```bash
# They should already be committed from Phase 1
git push origin main
```

Verify on Railway:
- [ ] `/api/predict-arrival-v2` responds in < 100ms (was ~400ms before model caching)
- [ ] `/api/drift/check` shows real `drift_pct` value (not null)
- [ ] `/api/ab-test/results` shows `matched_predictions > 0` after next arrivals

---

## Key Constraints

- Do NOT delete `/viz/` endpoints from backend — just don't call them from new frontend
- Do NOT add PWA manifest, push notifications, or trip planner — out of scope
- Do NOT use GPU or change the ML training — it's not the bottleneck
- Keep `VITE_APP_API_URL` env var pattern for API base URL
- All new components use CSS variables from `index.css`, not hardcoded colors
- Every number visible to users should come from a live API call, not be hardcoded
