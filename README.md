# Madison Metro ETA

A real-time bus tracking and ML prediction system for Madison, WI transit. Built to outperform the official API's arrival estimates by learning from ground truth.

**Live:** [madison-bus-eta.vercel.app](https://madison-bus-eta.vercel.app)

---

## What It Does

The Madison Metro API tells you a bus arrives in 8 minutes. This system asks: *how wrong is that, historically, for this route, at this hour, in these conditions?* It then corrects the prediction.

Beyond predictions, it monitors the transit network in real-time — detecting bus bunching (two buses running too close together), scoring route reliability, and surfacing analytics that the official app doesn't expose.

---

## Performance

| Metric | This Model | API Baseline | Improvement |
|--------|-----------|--------------|-------------|
| MAE | 48s | ~80s | **40% better** |
| Within 2 min | 87% | ~70% | **+17pp** |
| Predictions | 41K/week | — | Continuous |

---

## Features

**Live Map**
- Real-time bus positions across all 29 Madison Metro routes
- Click any stop for ML-corrected arrival predictions with confidence intervals
- Bus tracking mode — follow a specific vehicle to your stop
- Trip planner with walking directions via OSRM
- Bus bunching overlay — orange road segments where buses are running bunched (like Google Maps traffic)

**Analytics Panel**
- Performance tab — MAE trend, model coverage, training history
- Errors tab — prediction error by horizon and hour-of-day bias
- Routes tab — per-route reliability scores and breakdown
- Bunching tab — bunching events by route over 7 days

**System Panel**
- Collector status, model version, drift check (OK / WARNING / CRITICAL)

---

## Architecture

```
Madison Metro API ──► Collector (Railway, 24/7)
                           │
                           ▼
                      PostgreSQL ──► ML Training (GitHub Actions, nightly)
                           │                │
                           │                ▼
                           └──────► Flask Backend (Railway)
                                          │
                                          ▼
                                   React Frontend (Vercel)
```

**Collector** polls the Madison Metro REST API every 60s for vehicle positions, detects when buses arrive at stops using haversine distance, and matches those arrivals to earlier predictions to compute `error_seconds` — the ground truth the ML model trains on. It also runs real-time bus bunching detection.

**ML Pipeline** runs nightly via GitHub Actions. XGBoost regressor trained on 44 features including temporal patterns, route history, stop-level aggregates, weather, and vehicle speed. Only deploys if new model beats current by ≥2s MAE with no regression on any route.

**Conformal Prediction** wraps the point estimate in calibrated uncertainty bounds (Mondrian conformal, stratified by route × day-type × horizon bucket) — so the confidence interval is actually meaningful.

---

## ML Feature Vector (44 features)

```
Temporal:   horizon_min, horizon_squared, horizon_log, horizon_bucket,
            hour_sin/cos, day_sin/cos, month_sin/cos,
            is_weekend, is_rush_hour, is_morning_rush, is_evening_rush, is_holiday

Route:      route_frequency, route_encoded, predicted_minutes,
            route_avg_error, route_error_std, hr_route_error,
            route_horizon_error, route_horizon_std, dow_avg_error

Stop:       stop_avg_error, stop_error_std (shrinkage for <50 samples)

Weather:    temp_celsius, is_cold, is_hot, precipitation_mm, snow_mm,
            is_raining, is_snowing, wind_speed, is_windy,
            visibility_km, low_visibility, is_severe_weather

Vehicle:    avg_speed, speed_stddev, speed_variability,
            is_stopped, is_slow, is_moving_fast, has_velocity_data
```

---

## Bus Bunching Detection

The collector tracks vehicle pairs per route in memory. A pair is confirmed bunched when they stay within 500m for 2+ consecutive 60s polls (filters GPS jitter). Events are persisted to `analytics_bunching` with a 10-minute cooldown per pair.

The map overlay snaps each bus position to the nearest index on the loaded route polyline, extracts the path slice between them, and renders it as an amber `PathLayer` — following roads, not GPS diagonals.

---

## Deployment

| Component | Platform | Notes |
|-----------|----------|-------|
| Frontend | Vercel | Auto-deploy on push to main |
| Backend API | Railway | Flask, ~4100 lines |
| Data Collector | Railway Worker | Runs 24/7 |
| PostgreSQL | Railway | 30-day rolling retention |

---

## Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 19, TypeScript, Vite 7, Tailwind 4, DeckGL 9.2, MapLibre 5.13, Recharts |
| Backend | Flask, SQLAlchemy, Python 3.11 |
| ML | XGBoost, scikit-learn, pandas, NumPy |
| Infra | Railway, Vercel, GitHub Actions |

---

## Local Development

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env   # add MADISON_METRO_API_KEY
flask run --port=5000

# Frontend
cd frontend
npm install
npm run dev            # http://localhost:5173
```

The frontend works without an API key for the map and static data. ML predictions and live vehicles require the Madison Metro API key.

---

## Project Structure

```
├── backend/
│   ├── app.py                   # Flask API (~4100 lines)
│   └── conformal_serving.py     # Quantile prediction serving
│
├── collector/
│   ├── collector.py             # Main 60s collection loop
│   ├── arrival_detector.py      # Haversine stop detection
│   ├── bunch_detector.py        # Bus bunching detection
│   └── db.py                    # SQLAlchemy models
│
├── frontend/
│   └── src/
│       ├── App.tsx
│       └── components/
│           ├── MapView.tsx      # DeckGL + MapLibre map
│           ├── layout/          # TopBar, BottomTabs
│           ├── panel/           # ContextPanel, analytics, map, system
│           └── shared/          # MetricCard, StatusBadge, etc.
│
├── ml/
│   ├── training/
│   │   └── train_regression.py  # XGBoost training + deployment gates
│   ├── features/
│   │   └── regression_features.py
│   └── models/saved/            # Versioned model registry
│
└── .github/workflows/
    └── nightly-training.yml     # 3 AM CST nightly retraining
```

---

## Found a bug?

Open an issue on GitHub or email [nils.mikkola@wisc.edu](mailto:nils.mikkola@wisc.edu). This is a research project — feedback is genuinely useful.

---

## License

MIT
