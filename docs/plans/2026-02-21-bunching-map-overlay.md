# Bunching Map Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Draw an orange line between actively-bunched bus pairs on the map, updating every 30s.

**Architecture:** New `/api/bunching/active` endpoint queries `analytics_bunching` for events in the last 2 minutes and returns lat/lon pairs. `MapView.tsx` polls this endpoint and renders a `LineLayer` on top of existing DeckGL layers.

**Tech Stack:** Flask + SQLAlchemy (backend), DeckGL `LineLayer` (frontend), axios polling.

---

### Task 1: Backend — `/api/bunching/active` endpoint

**Files:**
- Modify: `backend/app.py` (add after the existing `/api/bunching/recent` endpoint)

**Step 1: Add the endpoint**

Find the block ending with:
```python
    CACHE[cache_key] = {'ts': time.time(), 'data': data}
    return jsonify(data)


@app.route("/api/route-reliability", methods=["GET"])
```

Insert this new endpoint between `/api/bunching/recent` and `/api/route-reliability`:

```python
@app.route("/api/bunching/active", methods=["GET"])
def bunching_active():
    cache_key = 'bunching_active'
    cached = CACHE.get(cache_key)
    if cached and time.time() - cached['ts'] < 30:
        return jsonify(cached['data'])

    try:
        from sqlalchemy import create_engine, text as sa_text
        engine = create_engine(os.getenv('DATABASE_URL'), pool_pre_ping=True)
        with engine.connect() as conn:
            rows = conn.execute(sa_text("""
                SELECT rt, lat_a, lon_a, lat_b, lon_b, dist_km
                FROM analytics_bunching
                WHERE detected_at >= NOW() - INTERVAL '2 minutes'
                ORDER BY detected_at DESC
            """)).fetchall()
        data = {'pairs': [
            {'rt': r[0], 'lat_a': r[1], 'lon_a': r[2], 'lat_b': r[3], 'lon_b': r[4], 'dist_km': r[5]}
            for r in rows
        ]}
    except Exception as e:
        logging.warning(f"bunching_active error: {e}")
        data = {'pairs': []}

    CACHE[cache_key] = {'ts': time.time(), 'data': data}
    return jsonify(data)
```

**Step 2: Smoke test**

```bash
curl http://localhost:5000/api/bunching/active
# Expected: {"pairs": [...]} — empty list is fine if no buses are running
```

**Step 3: Commit**

```bash
git add backend/app.py
git commit -m "feat: add /api/bunching/active endpoint for map overlay"
```

---

### Task 2: Frontend — LineLayer in MapView.tsx

**Files:**
- Modify: `frontend/src/components/MapView.tsx`

**Step 1: Add LineLayer import**

Current import at line 3:
```typescript
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
```

Change to:
```typescript
import { PathLayer, ScatterplotLayer, LineLayer } from '@deck.gl/layers';
```

**Step 2: Add bunching state + polling**

After this existing line (~line 166):
```typescript
    const routeDirectionsRef = useRef<any[]>([]);
```

Add:
```typescript
    const [bunchingPairs, setBunchingPairs] = useState<any[]>([]);
```

After the existing live vehicle polling `useEffect` block (around line 343), add a new `useEffect`:

```typescript
    // Poll active bunching pairs every 30s for map overlay
    useEffect(() => {
        const fetchBunching = () => {
            axios.get(`${API_BASE}/api/bunching/active`).then(res => {
                setBunchingPairs(res.data.pairs || []);
            }).catch(() => {});
        };
        fetchBunching();
        const timer = setInterval(fetchBunching, 30000);
        return () => clearInterval(timer);
    }, [API_BASE]);
```

**Step 3: Add LineLayer to the layers array**

In the `layers` useMemo, after the existing layer 1 (route-paths) block and before the trip layers, add:

```typescript
        // 2) Bunching overlay — orange lines between actively-bunched bus pairs
        if (bunchingPairs.length > 0) {
            // Glow outline
            L.push(new LineLayer({
                id: 'bunching-glow',
                data: bunchingPairs,
                getSourcePosition: (d: any) => [d.lon_a, d.lat_a],
                getTargetPosition: (d: any) => [d.lon_b, d.lat_b],
                getColor: [245, 158, 11, 60],
                getWidth: 14,
                widthMinPixels: 10,
            }));
            // Core line
            L.push(new LineLayer({
                id: 'bunching-lines',
                data: bunchingPairs,
                getSourcePosition: (d: any) => [d.lon_a, d.lat_a],
                getTargetPosition: (d: any) => [d.lon_b, d.lat_b],
                getColor: [245, 158, 11, 220],
                getWidth: 6,
                widthMinPixels: 4,
            }));
        }
```

**Step 4: Add `bunchingPairs` to the `useMemo` dependency array**

Current deps at the end of the layers useMemo (~line 699):
```typescript
    }, [filteredPatterns, stopsData, onStopClick,
        trackedBus, activeTripPlan, tripData, tripWalkPaths, highlightedStops, selectedRoute]);
```

Change to:
```typescript
    }, [filteredPatterns, stopsData, onStopClick,
        trackedBus, activeTripPlan, tripData, tripWalkPaths, highlightedStops, selectedRoute,
        bunchingPairs]);
```

**Step 5: Verify build**

```bash
cd frontend && npm run build
# Expected: no TypeScript errors, build succeeds
```

**Step 6: Commit**

```bash
git add frontend/src/components/MapView.tsx
git commit -m "feat: bunching map overlay — orange LineLayer between active bunched pairs"
```

---

### Task 3: Push and verify

**Step 1: Push**

```bash
git push origin main
```

**Step 2: Verify after Railway deploy**

- Open the live site during active bus service hours
- Switch to any high-frequency route (4, 6, 80)
- If bunching is active, an orange line should appear between the two buses
- Open the Analytics > Bunching tab to confirm recent events exist (confirms the table has data)
- Hit `/api/bunching/active` directly to check the JSON response

**Expected behavior when no buses are bunched:** overlay is simply absent — no errors, no visual noise.
