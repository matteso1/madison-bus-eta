# ML Fix + Mobile Rider PWA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix broken ML inference, optimize DB indexes, clean up dead code, then build a mobile-first rider experience with location-based nearby stops and bus tracking.

**Architecture:** Phase 1 fixes the XGBoost serialization mismatch that silently breaks ML predictions on every request. Phase 2 adds a viewport-switched mobile UI that renders a bottom-sheet-based rider experience on phones while keeping the desktop dashboard unchanged.

**Tech Stack:** XGBoost native format (.ubj), PostgreSQL indexes, React 19, MapLibre GL, Framer Motion (bottom sheet), existing design system.

---

## Phase 1: Fix ML + Infra Stabilization

### Task 1: Fix XGBoost Model Serialization (model_registry.py)

The regression model (`model_{version}.pkl`) was pickled with an older XGBoost that had a `gpu_id` attribute. The current runtime's XGBoost dropped it, causing `'XGBModel' object has no attribute 'gpu_id'` on every prediction.

**Files:**
- Modify: `ml/models/model_registry.py` (lines 36-93, 96-129)

**Step 1: Update `save_model` to use native XGBoost format**

In `ml/models/model_registry.py`, change `save_model` to save `.ubj` (XGBoost native Universal Binary JSON) instead of pickle:

```python
import xgboost as xgb

def save_model(model, metrics: Dict[str, Any], notes: str = "") -> str:
    timestamp = datetime.now(timezone.utc)
    version = timestamp.strftime('%Y%m%d_%H%M%S')

    # Save in XGBoost native format (version-portable, no pickle issues)
    model_filename = f'model_{version}.ubj'
    model_path = MODELS_DIR / model_filename

    if hasattr(model, 'save_model'):
        model.save_model(str(model_path))
    else:
        # Fallback for non-XGBoost models
        with open(model_path.with_suffix('.pkl'), 'wb') as f:
            pickle.dump(model, f)
        model_filename = f'model_{version}.pkl'

    # Registry update stays the same, just uses new filename
    registry = _load_registry()
    model_entry = {
        'version': version,
        'filename': model_filename,
        # ... rest unchanged ...
    }
    registry['models'].append(model_entry)
    registry['latest'] = version
    _save_registry(registry)
    return str(model_path)
```

**Step 2: Update `load_model` to handle both formats**

```python
def load_model(version: Optional[str] = None):
    registry = _load_registry()
    if version is None:
        version = registry.get('latest')
    if version is None:
        return None

    model_entry = None
    for entry in registry['models']:
        if entry['version'] == version:
            model_entry = entry
            break
    if model_entry is None:
        return None

    model_path = MODELS_DIR / model_entry['filename']
    if not model_path.exists():
        return None

    if model_path.suffix == '.ubj':
        import xgboost as xgb
        model = xgb.XGBRegressor()
        model.load_model(str(model_path))
        return model
    else:
        # Legacy pickle format
        with open(model_path, 'rb') as f:
            return pickle.load(f)
```

**Step 3: Verify the changes compile**

Run: `cd ml && python -c "from models.model_registry import save_model, load_model; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add ml/models/model_registry.py
git commit -m "fix: switch model registry to XGBoost native .ubj format

Pickle serialization breaks across XGBoost versions (gpu_id attribute
removed). Native .ubj format is version-portable."
```

---

### Task 2: Fix Backend Model Loader (app.py)

**Files:**
- Modify: `backend/app.py` (lines 115-145)

**Step 1: Update `_get_regression_model` to handle .ubj files**

The current loader at line 130 hardcodes `.pkl`:
```python
model_path = ml_path / f'model_{latest}.pkl'
```

Change to check `.ubj` first, fall back to `.pkl`:

```python
def _get_regression_model():
    """Load XGBoost regression model from registry.json; reload on registry change."""
    ml_path = Path(__file__).parent.parent / 'ml' / 'models' / 'saved'
    registry_path = ml_path / 'registry.json'
    if not registry_path.exists():
        return None, 0.0
    mtime = registry_path.stat().st_mtime
    if _regression_cache['model'] is not None and mtime == _regression_cache['mtime']:
        return _regression_cache['model'], _regression_cache['bias']
    try:
        with open(registry_path) as f:
            reg = json.load(f)
        latest = reg.get('latest')
        if not latest:
            return None, 0.0

        # Try native .ubj first, fall back to .pkl
        model_path_ubj = ml_path / f'model_{latest}.ubj'
        model_path_pkl = ml_path / f'model_{latest}.pkl'

        if model_path_ubj.exists():
            import xgboost as xgb
            model = xgb.XGBRegressor()
            model.load_model(str(model_path_ubj))
            _regression_cache['model'] = model
        elif model_path_pkl.exists():
            with open(model_path_pkl, 'rb') as f:
                _regression_cache['model'] = _pickle.load(f)
        else:
            return None, 0.0

        # Also check registry filename field
        bias = 0.0
        for entry in reg.get('models', []):
            if entry['version'] == latest:
                bias = entry.get('metrics', {}).get('bias_correction_seconds', 0.0) or 0.0
                break
        _regression_cache['bias'] = bias
        _regression_cache['mtime'] = mtime
        return _regression_cache['model'], _regression_cache['bias']
    except Exception as e:
        logging.warning(f"Failed to load regression model: {e}")
        return None, 0.0
```

**Step 2: Commit**

```bash
git add backend/app.py
git commit -m "fix: backend model loader supports native .ubj XGBoost format"
```

---

### Task 3: Re-export Current Model to Native Format

The current deployed model `model_20260210_094651.pkl` needs to be re-exported so ML inference works immediately (don't wait for nightly training).

**Files:**
- Create: `ml/scripts/migrate_model_to_ubj.py` (one-time migration script)
- Modify: `ml/models/saved/registry.json` (update filename for latest entry)

**Step 1: Write migration script**

```python
"""One-time migration: re-export latest .pkl model to .ubj format."""
import pickle
import json
from pathlib import Path

models_dir = Path(__file__).parent.parent / 'models' / 'saved'
registry_path = models_dir / 'registry.json'

with open(registry_path) as f:
    registry = json.load(f)

latest = registry['latest']
pkl_path = models_dir / f'model_{latest}.pkl'
ubj_path = models_dir / f'model_{latest}.ubj'

print(f"Loading {pkl_path}...")
with open(pkl_path, 'rb') as f:
    model = pickle.load(f)

print(f"Saving native format to {ubj_path}...")
model.save_model(str(ubj_path))

# Update registry entry filename
for entry in registry['models']:
    if entry['version'] == latest:
        entry['filename'] = f'model_{latest}.ubj'
        break

with open(registry_path, 'w') as f:
    json.dump(registry, f, indent=2, default=str)

print(f"Done. Model {latest} migrated to .ubj format.")
print(f"Old .pkl can be deleted after verifying.")
```

**Step 2: Run the migration locally**

Run: `cd ml/scripts && python migrate_model_to_ubj.py`
Expected: Success message, new `model_20260210_094651.ubj` in `ml/models/saved/`

NOTE: This requires the **same XGBoost version** that created the pickle to be installed locally. If the local version is too new and also fails on `gpu_id`, you'll need to temporarily `pip install xgboost==1.7.5` (the version before the attribute was removed), run the script, then upgrade back. Check your local XGBoost version first with `python -c "import xgboost; print(xgboost.__version__)"`.

If local migration fails due to version mismatch, alternative approach: trigger a manual GitHub Actions run (workflow_dispatch on nightly-training.yml). The next training run that passes the deployment gate will produce a .ubj file directly (since Task 1 updated the save code). Today's run was at 93.1s MAE (gate is 90s), so it should pass within 1-3 days.

**Step 3: Verify the .ubj model loads**

Run: `python -c "import xgboost as xgb; m = xgb.XGBRegressor(); m.load_model('ml/models/saved/model_20260210_094651.ubj'); print('Features:', m.n_features_in_); print('OK')"`
Expected: `Features: 44` (or 47), `OK`

**Step 4: Commit the migrated model**

```bash
git add ml/models/saved/model_20260210_094651.ubj ml/models/saved/registry.json ml/scripts/migrate_model_to_ubj.py
git commit -m "fix: migrate deployed model to native XGBoost .ubj format

Resolves 'XGBModel has no attribute gpu_id' error that silently
disabled ML inference on every prediction request."
```

---

### Task 4: Update Nightly Training Pipeline

The nightly CI also needs to produce `.ubj` files. Since `train_regression.py` calls `save_model()` from `model_registry.py` (already updated in Task 1), we just need to make sure the CI installs a compatible XGBoost version.

**Files:**
- Modify: `.github/workflows/nightly-training.yml` (line 29)

**Step 1: Pin XGBoost version in CI**

Current line 29: `pip install xgboost scikit-learn pandas numpy sqlalchemy psycopg2-binary python-dotenv holidays`

Change to: `pip install xgboost==1.7.6 scikit-learn pandas numpy sqlalchemy psycopg2-binary python-dotenv holidays`

This matches `backend/requirements.txt` which has `xgboost==1.7.6`.

**Step 2: Update git add pattern to include .ubj files**

Line 83: `git add ml/models/saved/` already covers all files in the directory, so `.ubj` files will be included automatically. No change needed.

**Step 3: Commit**

```bash
git add .github/workflows/nightly-training.yml
git commit -m "chore: pin XGBoost version in nightly training CI"
```

---

### Task 5: Add Missing Database Indexes

**Files:**
- Modify: `.github/workflows/nightly-training.yml` (add indexes in the "Ensure DB indexes" step)

**Step 1: Add indexes to the nightly CI DB setup step**

Add these two CREATE INDEX statements to the existing "Ensure DB indexes exist" step (after line 58):

```python
# Index for fast weather lookups (latest observation)
conn.execute(text('''
    CREATE INDEX IF NOT EXISTS idx_weather_obs_observed_at
    ON weather_observations(observed_at DESC)
'''))
# Index for fast prediction lookups by vehicle
conn.execute(text('''
    CREATE INDEX IF NOT EXISTS idx_predictions_vid_created
    ON predictions(vid, created_at DESC)
'''))
```

**Step 2: Run the indexes manually now (don't wait for nightly)**

Connect to the DB and run both CREATE INDEX statements. Use the mcp__postgres__query tool or run via the backend's DB connection.

**Step 3: Commit**

```bash
git add .github/workflows/nightly-training.yml
git commit -m "perf: add missing DB indexes for weather and predictions tables"
```

---

### Task 6: Dead Code Cleanup

**Files:**
- Modify: `Procfile` (root) -- remove consumer line
- Delete: `collector/consumer.py`, `collector/sentinel_client.py`, `collector/sentinel_proto/` (already deleted in working tree, just need `git rm`)
- Delete: `frontend-premium/` directory (abandoned, no source, just node_modules)
- Modify: `collector/README.md` (already modified in working tree)

**Step 1: Stage deletions**

```bash
git rm collector/consumer.py collector/sentinel_client.py collector/sentinel_proto/sentinel_pb2.py collector/sentinel_proto/sentinel_pb2_grpc.py
```

**Step 2: Remove frontend-premium**

```bash
rm -rf frontend-premium/
echo "frontend-premium/" >> .gitignore  # Prevent re-creation
```

**Step 3: Fix Procfile**

Remove the `consumer:` line from the root `Procfile`. Keep `web:` and `collector:`.

**Step 4: Commit**

```bash
git add Procfile collector/ .gitignore
git commit -m "chore: remove dead code (consumer, sentinel, frontend-premium)"
```

---

## Phase 2: Mobile Rider Experience

### Task 7: Create useIsMobile Hook

**Files:**
- Create: `frontend/src/hooks/useIsMobile.ts`

**Step 1: Write the hook**

```typescript
import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => window.innerWidth <= MOBILE_BREAKPOINT
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/useIsMobile.ts
git commit -m "feat: add useIsMobile viewport detection hook"
```

---

### Task 8: Create Mobile App Shell with Viewport Switch

**Files:**
- Create: `frontend/src/mobile/MobileApp.tsx`
- Modify: `frontend/src/App.tsx` (add viewport switch)

**Step 1: Create MobileApp placeholder**

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { TrackedBus, VehicleData, StopClickEvent } from '../components/MapView';

interface NearbyStop {
  stpid: string;
  stpnm: string;
  lat: number;
  lon: number;
  distance: number;  // meters
  arrivals: Array<{
    route: string;
    destination: string;
    minutes: number;
    vid: string;
    delayed: boolean;
  }>;
}

type MobileView = 'nearby' | 'stop' | 'tracking';

export default function MobileApp() {
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [nearbyStops, setNearbyStops] = useState<NearbyStop[]>([]);
  const [selectedStop, setSelectedStop] = useState<NearbyStop | null>(null);
  const [trackedBus, setTrackedBus] = useState<TrackedBus | null>(null);
  const [view, setView] = useState<MobileView>('nearby');
  const [loading, setLoading] = useState(true);

  // Geolocation on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation([pos.coords.longitude, pos.coords.latitude]);
        setLoading(false);
      },
      () => setLoading(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, []);

  return (
    <div style={{
      height: '100vh',
      width: '100vw',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Map fills entire screen */}
      <div style={{ flex: 1, position: 'relative' }}>
        {/* MapView will go here in Task 10 */}
        <div style={{
          width: '100%',
          height: '100%',
          background: 'var(--bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-ui)',
        }}>
          Map loading...
        </div>
      </div>

      {/* Bottom sheet will go here in Task 9 */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        borderRadius: '16px 16px 0 0',
        padding: '12px 16px',
        minHeight: 120,
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-ui)',
      }}>
        <div style={{
          width: 36,
          height: 4,
          background: 'var(--border-bright)',
          borderRadius: 2,
          margin: '0 auto 12px',
        }} />
        {loading ? 'Locating you...' :
         userLocation ? `Located: ${userLocation[1].toFixed(4)}, ${userLocation[0].toFixed(4)}` :
         'Enable location to see nearby stops'}
      </div>
    </div>
  );
}
```

**Step 2: Wire viewport switch in App.tsx**

At the top of `App.tsx`, add:

```typescript
import { useIsMobile } from './hooks/useIsMobile';
import MobileApp from './mobile/MobileApp';
```

Then wrap the existing return with:

```typescript
export default function App() {
  const isMobile = useIsMobile();

  // ... existing state and effects ...

  if (isMobile) {
    return <MobileApp />;
  }

  return (
    // ... existing desktop layout unchanged ...
  );
}
```

IMPORTANT: The `useIsMobile()` call must be at the top of the component, before any conditional returns, to follow React's rules of hooks. All existing `useState`/`useEffect` calls stay where they are (they will still run on mobile but their state won't be rendered -- this is fine for now; optimization can come later).

**Step 3: Test locally**

Run: `cd frontend && npm run dev`
Open in browser, use DevTools to toggle mobile viewport (375px width).
Expected: See the MobileApp placeholder with "Map loading..." and "Located: lat, lon" after geolocation.
Switch back to desktop width: see the normal dashboard.

**Step 4: Commit**

```bash
git add frontend/src/mobile/MobileApp.tsx frontend/src/App.tsx
git commit -m "feat: viewport-switched mobile app shell

Desktop (>768px) renders existing dashboard.
Mobile (<=768px) renders new MobileApp with geolocation."
```

---

### Task 9: Build Bottom Sheet Component

A draggable bottom sheet with three states: collapsed (peek), half, and full.

**Files:**
- Create: `frontend/src/mobile/BottomSheet.tsx`

**Step 1: Write the BottomSheet component**

Uses framer-motion for drag physics. Three snap points: peek (120px from bottom), half (50vh), full (90vh, leaving space for status bar).

```typescript
import { useRef, type ReactNode } from 'react';
import { motion, useMotionValue, useTransform, animate, type PanInfo } from 'framer-motion';

type SheetState = 'peek' | 'half' | 'full';

interface BottomSheetProps {
  children: ReactNode;
  state: SheetState;
  onStateChange: (state: SheetState) => void;
  peekHeight?: number;
}

const SNAP_POINTS: Record<SheetState, number> = {
  peek: 140,
  half: window.innerHeight * 0.5,
  full: window.innerHeight * 0.88,
};

export default function BottomSheet({ children, state, onStateChange, peekHeight = 140 }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const height = useMotionValue(SNAP_POINTS[state]);

  const borderRadius = useTransform(height, [SNAP_POINTS.peek, SNAP_POINTS.full], [16, 8]);

  function handleDragEnd(_: any, info: PanInfo) {
    const currentHeight = height.get();
    const velocity = info.velocity.y;

    // Determine target based on velocity and position
    let target: SheetState;
    if (velocity < -500) {
      // Fast swipe up
      target = currentHeight > SNAP_POINTS.half ? 'full' : 'half';
    } else if (velocity > 500) {
      // Fast swipe down
      target = currentHeight < SNAP_POINTS.half ? 'peek' : 'half';
    } else {
      // Snap to nearest
      const distances = Object.entries(SNAP_POINTS).map(([key, val]) => ({
        state: key as SheetState,
        dist: Math.abs(currentHeight - val),
      }));
      target = distances.sort((a, b) => a.dist - b.dist)[0].state;
    }

    animate(height, SNAP_POINTS[target], {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    });
    onStateChange(target);
  }

  return (
    <motion.div
      ref={sheetRef}
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height,
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        borderRadius: borderRadius.get() + 'px ' + borderRadius.get() + 'px 0 0',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
        touchAction: 'none',
      }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.1}
      onDrag={(_, info) => {
        const newHeight = SNAP_POINTS[state] - info.offset.y;
        height.set(Math.max(SNAP_POINTS.peek, Math.min(SNAP_POINTS.full, newHeight)));
      }}
      onDragEnd={handleDragEnd}
    >
      {/* Drag handle */}
      <div style={{
        padding: '10px 0 6px',
        display: 'flex',
        justifyContent: 'center',
        cursor: 'grab',
        flexShrink: 0,
      }}>
        <div style={{
          width: 36,
          height: 4,
          background: 'var(--border-bright)',
          borderRadius: 2,
        }} />
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflowY: state === 'peek' ? 'hidden' : 'auto',
        padding: '0 16px 16px',
        WebkitOverflowScrolling: 'touch',
      }}>
        {children}
      </div>
    </motion.div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/mobile/BottomSheet.tsx
git commit -m "feat: draggable bottom sheet component with snap points"
```

---

### Task 10: Build ArrivalCard Component

**Files:**
- Create: `frontend/src/mobile/ArrivalCard.tsx`

**Step 1: Write ArrivalCard**

Compact card showing route badge, destination, ETA, and confidence band. Designed for thumb-friendly touch targets.

```typescript
interface ArrivalCardProps {
  route: string;
  destination: string;
  minutes: number;
  delayed: boolean;
  confidence?: {
    low: number;
    median: number;
    high: number;
  };
  onTrack?: () => void;
}

export default function ArrivalCard({ route, destination, minutes, delayed, confidence, onTrack }: ArrivalCardProps) {
  const isDue = minutes <= 1;
  const etaColor = isDue ? 'var(--signal)' : 'var(--text-primary)';

  return (
    <div style={{
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '12px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minHeight: 56,
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
        minWidth: 36,
        textAlign: 'center',
        flexShrink: 0,
      }}>
        {route}
      </div>

      {/* Destination + confidence */}
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

        {confidence && (
          <div style={{ marginTop: 4 }}>
            <ConfidenceBar low={confidence.low} median={confidence.median} high={confidence.high} />
          </div>
        )}
      </div>

      {/* ETA */}
      <div style={{
        textAlign: 'right',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
      }}>
        <span style={{
          fontFamily: 'var(--font-data)',
          fontSize: isDue ? 18 : 22,
          fontWeight: 700,
          color: etaColor,
          lineHeight: 1,
        }}>
          {isDue ? 'DUE' : minutes}
        </span>
        {!isDue && (
          <span style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 10,
            color: 'var(--text-secondary)',
            marginTop: 2,
          }}>
            min
          </span>
        )}
        {delayed && (
          <span style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 9,
            color: 'var(--warning)',
            fontWeight: 600,
            marginTop: 2,
          }}>
            DELAYED
          </span>
        )}
      </div>

      {/* Track button */}
      {onTrack && minutes <= 15 && (
        <button
          onClick={(e) => { e.stopPropagation(); onTrack(); }}
          style={{
            background: 'var(--signal-dim)',
            color: 'var(--signal)',
            border: 'none',
            borderRadius: 8,
            padding: '8px 12px',
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
            minHeight: 44,
            minWidth: 44,
          }}
        >
          Track
        </button>
      )}
    </div>
  );
}

function ConfidenceBar({ low, median, high }: { low: number; median: number; high: number }) {
  const range = high - low;
  if (range <= 0) return null;
  const medianPct = ((median - low) / range) * 100;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 14 }}>
      <span className="data-num" style={{ fontSize: 9, color: 'var(--text-dim)' }}>
        {low.toFixed(0)}
      </span>
      <div style={{
        flex: 1,
        height: 3,
        background: 'var(--border)',
        borderRadius: 2,
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          left: `${medianPct}%`,
          top: -2,
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'var(--signal)',
          transform: 'translateX(-50%)',
        }} />
      </div>
      <span className="data-num" style={{ fontSize: 9, color: 'var(--text-dim)' }}>
        {high.toFixed(0)}
      </span>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/mobile/ArrivalCard.tsx
git commit -m "feat: mobile ArrivalCard with route badge, ETA, confidence bar"
```

---

### Task 11: Build NearbyStops Component

This component fetches all routes/stops, computes distances from user location using haversine, and shows the nearest stops with their upcoming arrivals.

**Files:**
- Create: `frontend/src/mobile/NearbyStops.tsx`

**Step 1: Write NearbyStops**

```typescript
import { useState, useEffect } from 'react';
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

interface NearbyStopData {
  stop: Stop;
  distance: number;
  predictions: Prediction[];
}

interface NearbyStopsProps {
  userLocation: [number, number] | null;  // [lon, lat]
  onStopSelect: (stop: Stop) => void;
  onTrackBus: (vid: string, route: string) => void;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function NearbyStops({ userLocation, onStopSelect, onTrackBus }: NearbyStopsProps) {
  const [nearbyStops, setNearbyStops] = useState<NearbyStopData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userLocation) {
      setLoading(false);
      return;
    }

    const [lon, lat] = userLocation;

    async function fetchNearby() {
      try {
        // Fetch all routes first, then stops for each route
        const routesRes = await axios.get(`${API_BASE}/routes`);
        const routes = routesRes.data?.['bustime-response']?.routes || [];
        const routeIds = routes.map((r: any) => r.rt);

        // Fetch stops for all routes in batches
        const allStops = new Map<string, Stop & { routes: string[] }>();
        const batchSize = 5;
        for (let i = 0; i < routeIds.length; i += batchSize) {
          const batch = routeIds.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map((rt: string) =>
              axios.get(`${API_BASE}/stops?rt=${rt}`).catch(() => null)
            )
          );
          results.forEach((res, idx) => {
            if (!res) return;
            const stops = res.data?.['bustime-response']?.stops || [];
            stops.forEach((s: any) => {
              const existing = allStops.get(s.stpid);
              if (existing) {
                if (!existing.routes.includes(batch[idx])) {
                  existing.routes.push(batch[idx]);
                }
              } else {
                allStops.set(s.stpid, {
                  stpid: s.stpid,
                  stpnm: s.stpnm,
                  lat: s.lat,
                  lon: s.lon,
                  routes: [batch[idx]],
                });
              }
            });
          });
        }

        // Sort by distance, take top 8
        const sorted = [...allStops.values()]
          .map(s => ({ stop: s, distance: haversineMeters(lat, lon, s.lat, s.lon), predictions: [] as Prediction[] }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 8);

        // Fetch predictions for nearest stops
        const withPredictions = await Promise.all(
          sorted.map(async (item) => {
            try {
              const res = await axios.get(`${API_BASE}/predictions?stpid=${item.stop.stpid}`);
              const preds = res.data?.['bustime-response']?.prd || [];
              const predArr = Array.isArray(preds) ? preds : [preds];
              item.predictions = predArr
                .filter((p: any) => p.prdctdn !== 'DLY' && parseInt(p.prdctdn) <= 30)
                .slice(0, 3)
                .map((p: any) => ({
                  route: p.rt,
                  destination: p.des,
                  minutes: p.prdctdn === 'DUE' ? 0 : parseInt(p.prdctdn),
                  vid: p.vid,
                  delayed: p.dly === true || p.dly === 'true',
                }));
            } catch {}
            return item;
          })
        );

        setNearbyStops(withPredictions.filter(s => s.predictions.length > 0));
      } catch (err) {
        console.error('Failed to fetch nearby stops:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchNearby();
    const timer = setInterval(fetchNearby, 30000);
    return () => clearInterval(timer);
  }, [userLocation]);

  if (!userLocation) {
    return (
      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
        Enable location to see nearby stops
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
        Finding nearby stops...
      </div>
    );
  }

  if (nearbyStops.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
        No buses arriving nearby in the next 30 minutes
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--text-primary)',
      }}>
        Nearby Stops
      </div>

      {nearbyStops.map((item) => (
        <div key={item.stop.stpid}>
          <button
            onClick={() => onStopSelect(item.stop)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer',
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}>
                {item.stop.stpnm}
              </span>
              <span className="data-num" style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
              }}>
                {item.distance < 1000
                  ? `${Math.round(item.distance)}m`
                  : `${(item.distance / 1000).toFixed(1)}km`}
              </span>
            </div>
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {item.predictions.map((pred) => (
              <ArrivalCard
                key={pred.vid}
                route={pred.route}
                destination={pred.destination}
                minutes={pred.minutes}
                delayed={pred.delayed}
                onTrack={() => onTrackBus(pred.vid, pred.route)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

NOTE: This approach fetches stops per-route which is API-heavy. A better approach for v2 would be a backend `/api/nearby-stops?lat=X&lon=Y` endpoint that does the distance filtering server-side. For now, this works because the stops data can be cached aggressively (stops don't change often) and we only need to fetch predictions for the nearest 8.

**Step 2: Commit**

```bash
git add frontend/src/mobile/NearbyStops.tsx
git commit -m "feat: NearbyStops component with haversine distance sorting"
```

---

### Task 12: Build TrackingBar Component

Compact bar shown when tracking a bus. Replaces the bottom sheet content.

**Files:**
- Create: `frontend/src/mobile/TrackingBar.tsx`

**Step 1: Write TrackingBar**

```typescript
interface TrackingBarProps {
  route: string;
  destination: string;
  minutes: number | null;
  onStopTracking: () => void;
}

export default function TrackingBar({ route, destination, minutes, onStopTracking }: TrackingBarProps) {
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

      {/* Destination */}
      <div style={{
        flex: 1,
        fontFamily: 'var(--font-ui)',
        fontSize: 13,
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {destination}
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

**Step 2: Commit**

```bash
git add frontend/src/mobile/TrackingBar.tsx
git commit -m "feat: compact TrackingBar for mobile bus tracking"
```

---

### Task 13: Integrate Mobile Components into MobileApp

Wire up the BottomSheet, NearbyStops, TrackingBar, and MapView into a complete mobile experience.

**Files:**
- Modify: `frontend/src/mobile/MobileApp.tsx` (complete rewrite from placeholder)

**Step 1: Full integration**

Replace the placeholder MobileApp with the complete version that:
1. Renders full-screen MapView (reusing the existing component)
2. Overlays the BottomSheet with NearbyStops content
3. Switches to TrackingBar in peek mode when tracking a bus
4. Includes a GPS locate button

The MapView component from `../components/MapView` should work as-is since it already handles vehicle rendering, stop clicks, and bus clicks via props. The mobile version just wires it differently (no ContextPanel, BottomTabs, or TopBar).

Key state flow:
- `view === 'nearby'`: BottomSheet shows NearbyStops, half height
- `view === 'stop'`: BottomSheet shows StopArrivals (full predictions for one stop), full height
- `view === 'tracking'`: BottomSheet shows TrackingBar, peek height

When the user taps "Track" on an ArrivalCard, set trackedBus and switch to tracking view. The existing MapView tracking logic (5s polling) handles the rest.

**Step 2: Test on mobile viewport**

Open DevTools, set to iPhone 14 Pro (393x852). Verify:
- Map fills the screen
- Bottom sheet shows nearby stops
- Dragging the sheet works (peek/half/full)
- Tapping Track collapses sheet to tracking bar

**Step 3: Commit**

```bash
git add frontend/src/mobile/MobileApp.tsx
git commit -m "feat: complete mobile rider experience with map + bottom sheet"
```

---

### Task 14: Mobile CSS Polish

**Files:**
- Modify: `frontend/src/index.css`

**Step 1: Add mobile-specific styles**

Add at the end of `index.css`:

```css
/* Mobile-specific styles */
@media (max-width: 768px) {
  /* Prevent iOS bounce scroll */
  html, body {
    overscroll-behavior: none;
    -webkit-overflow-scrolling: touch;
  }

  /* Larger touch targets */
  button {
    min-height: 44px;
  }

  /* Safe area for notched phones */
  .mobile-safe-bottom {
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/index.css
git commit -m "style: mobile CSS for touch targets, safe areas, bounce prevention"
```

---

### Task 15: Final Integration Test and Push

**Step 1: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 2: Run build**

Run: `cd frontend && npm run build`
Expected: Successful build with no errors

**Step 3: Test desktop still works**

Open at full desktop width. Verify the dashboard renders normally (TopBar, MapView, ContextPanel, BottomTabs).

**Step 4: Test mobile**

Open at 375px width. Verify:
- MobileApp renders
- Geolocation fires
- Bottom sheet shows nearby stops (if location available)
- Map is visible behind the sheet
- Arrivals show with route badges and ETAs

**Step 5: Final commit and push**

```bash
git push origin main
```

If push fails (non-fast-forward from auto-deploy commits):
```bash
git pull --rebase origin main && git push origin main
```
