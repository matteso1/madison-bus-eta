# AI Agent Onboarding: Madison Bus ETA Project

## Mission & Objective

**Goal:** Build a production-grade transit ETA prediction system for Madison Metro that significantly outperforms the official API.

**Core Metric:** Mean Absolute Error (MAE) in seconds.

**Current Status:**
- **Baseline (Official API):** ~135s MAE
- **Our Model (XGBoost):** ~57s MAE (~58% improvement)
- **Phase:** Phase 3 (Production-Grade ML & Engineering)

---

## System Architecture

The system is a full-stack ML pipeline:

### 1. Data Collection (`collector/`)
- `gtfs_collector.py`: Polls Madison Metro GTFS-RT API every 30s. Stores vehicle positions (`vehicle_observations`) and raw predictions (`predictions`).
- `weather_collector.py`: Polls OpenWeatherMap every 30m. Stores `weather_observations`.
- **Outcome matching**: `prediction_outcomes` table links a predicted arrival to the *actual* arrival time once it happens. This is our Ground Truth.

### 2. Database (PostgreSQL)
- `vehicle_observations`: GPS pings, velocity, bearing.
- `predictions`: Raw API predictions (baseline).
- `prediction_outcomes`: The joined training set (Prediction vs Actual).
- `weather_observations`: Temperature, precip, wind.
- `ml_regression_runs`: Training history and model registry.

### 3. Machine Learning (`ml/`)
- **Model**: XGBoost Regressor (Gradient Boosting)
- **Feature Engineering** (see `ml/features/regression_features.py`):
  - **Horizon (`prdctdn`)**: *Critical feature*. Time until arrival. This is #1.
  - **Stop Reliability**: Historical error rates per stop (NEW).
  - **Route Reliability**: Historical error rates per route.
  - **Temporal**: Hour, day, rush hour flags.
  - **Weather**: Rain/snow/visibility impacts.
- **Training**: `train_regression.py` (nightly via GitHub Actions)
- **Evaluation**: `temporal_cv.py` (Strict time-series cross-validation)

### 4. Backend (`backend/`)
Flask API with endpoints:
- `/api/predict-arrival-v2`: ML prediction + Confidence Intervals
- `/api/model-performance`: Training history and metrics
- `/api/model-status`: Model age, data freshness
- `/api/diagnostics/error-by-horizon`: Error breakdown by prediction horizon (KEY)
- `/api/diagnostics/predicted-vs-actual`: Scatter plot data
- `/api/diagnostics/worst-predictions`: Debugging worst cases
- `/api/diagnostics/hourly-bias`: Time-of-day analysis
- `/api/diagnostics/feature-importance`: Feature importance from model

### 5. Frontend (`frontend/`)
React + Vite + Tailwind + Recharts.
- **Key Page**: `Analytics.tsx` - Production ML diagnostics dashboard
- **4 Tabs**: Health, Errors, Features, Segments
- **Philosophy**: Data density and analysis over aesthetics

---

## Crucial Context & Gotchas

### 1. The "Horizon" Feature is King

The raw API prediction (`prdctdn` in GTFS-RT) is the single most important feature. Our model learns a *correction function* on top of the API's guess.

- Don't try to predict ETAs from scratch using raw GPS distance alone.
- The model predicts: "Given the API says 5 min, how wrong will it be?"

### 2. Time Leakage is the Enemy

- **Never** use random `train_test_split`.
- **Always** use `temporal_cv.py` or simple time-based cutoffs.
- Future traffic conditions must not leak into past training data.
- Historical features (route_avg_error, stop_avg_error) are computed from TRAINING data only.

### 3. Data Schema

- **`predictions` table**: The "inputs" (API predictions).
- **`prediction_outcomes`**: The "labels" (what actually happened).
- `error_seconds` = actual_arrival - predicted_arrival
- Positive error = bus was LATE, Negative = EARLY

### 4. Code Style & Philosophy

- **Analysis > Aesthetics**: Dense, accurate data tables over fancy UIs.
- **SQL-heavy**: Postgres for aggregations, not 1GB CSVs in memory.
- **Production-Ready**: `.env` for keys, GitHub Actions for CI/CD.

### 5. Weather Table

- The `weather_observations` table may not exist in production yet.
- The ML pipeline handles this gracefully - training works with or without weather data.
- To enable weather: set `OPENWEATHERMAP_API_KEY` in Railway environment.

---

## Key Files Map

| Category | Path | Purpose |
|----------|------|---------|
| **Data Collection** | `collector/gtfs_collector.py` | Main ingestion loop |
| | `collector/weather_collector.py` | Weather ingestion |
| **ML Core** | `ml/features/regression_features.py` | Feature store (ALL feature logic) |
| | `ml/training/train_regression.py` | Training pipeline |
| | `ml/training/temporal_cv.py` | Time-series cross-validation |
| **Backend** | `backend/app.py` | API + Analytics endpoints |
| **Frontend** | `frontend/src/pages/Analytics.tsx` | ML diagnostics dashboard |

---

## How to Run

1. **Database**: Connection string in `.env` as `DATABASE_URL`
2. **Backend**: `python backend/app.py` (Port 5000)
3. **Frontend**: `cd frontend && npm run dev`
4. **Training**: `python -m ml.training.train_regression`
5. **Nightly Training**: GitHub Actions runs at 3 AM CST

---

## ML Feature List (Current)

| Feature | Description | Importance |
|---------|-------------|------------|
| `horizon_min` | API's predicted minutes until arrival | HIGHEST |
| `horizon_squared` | Quadratic term for non-linearity | High |
| `stop_avg_error` | Historical error at this stop | High |
| `route_avg_error` | Historical error for this route | Medium |
| `hr_route_error` | Route + hour combination error | Medium |
| `is_rush_hour` | Peak hours (7-9 AM, 4-6 PM) | Medium |
| `is_weekend` | Weekend flag | Low |
| Weather features | Rain, snow, temperature, etc. | Variable |

---

## Analytics Dashboard Tabs

### 1. Health (Model Health)
- MAE trend over 14 days
- Coverage thresholds (% within 30s, 1min, 2min, 5min)
- Training history
- Error distribution histogram

### 2. Errors (Error Analysis)
- **Error by Horizon**: THE key chart. Shows how error increases with prediction horizon.
- Predicted vs Actual scatter plot with R^2
- Hourly bias analysis (rush hour penalty)
- Worst predictions table for debugging

### 3. Features
- Feature importance bar chart
- Current model info (version, MAE, training samples)
- Recent training runs

### 4. Segments
- Route performance table (sortable)
- Route x Hour heatmap

---

## Current Status (Jan 2026)

**Recently Completed:**
- Production ML diagnostics dashboard with 4 tabs
- Error-by-horizon analysis (key insight visualization)
- Stop-level reliability features
- Fixed training pipeline to handle missing weather table
- Removed fake/mocked data from backend

**Next Up:**
- A/B Testing framework
- Long-term drift monitoring and alerting
- Velocity-based features from GPS data
