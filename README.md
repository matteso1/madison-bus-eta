# Madison Metro ML

A machine learning-enhanced bus tracking system for Madison, WI. Predicts ETA errors by collecting ground truth arrival data and training regression models autonomously.

**Live:** [madison-bus-eta.vercel.app](https://madison-bus-eta-production.up.railway.app)

## Performance

| Metric | Our Model | API Baseline | Improvement |
|--------|-----------|--------------|-------------|
| **MAE** | 48.4s | ~80s | **39.5%** |
| **Coverage** | 87% within 2min | ~70% | **+17pp** |
| **Predictions** | 41K/week | n/a | Continuous |

---

## Key Features

- **Autonomous Retraining** - GitHub Actions trains nightly, auto-deploys improved models
- **A/B Testing** - Side-by-side ML vs API comparison with win-rate tracking
- **Drift Monitoring** - Real-time model health with OK/WARNING/CRITICAL status
- **Route Reliability** - Per-route reliability scores and hourly breakdowns
- **5-Tab Analytics Dashboard** - Health, Errors, Features, Segments, A/B Test

---

## Quick Start

```bash
# Backend
cd backend && python -m flask run --port=5000

# Frontend  
cd frontend && npm run dev
```

Open <http://localhost:5173> for the live map.

---

## System Architecture

```mermaid
graph TB
    subgraph "User-Facing"
        FE[React Frontend<br/>localhost:5173]
        FE --> BE
    end
    
    subgraph "API Layer"
        BE[Flask Backend<br/>localhost:5000]
        BE --> METRO[Madison Metro API]
        BE --> ML[ML Model Registry]
    end
    
    subgraph "Data Pipeline - Railway 24/7"
        COLLECTOR[Data Collector<br/>60s vehicle / 2min predictions]
        COLLECTOR --> METRO
        COLLECTOR --> SENTINEL[Sentinel<br/>Message Queue]
        COLLECTOR --> ARRIVALS[Arrival Detector<br/>Haversine Distance]
    end
    
    subgraph "Storage Layer"
        SENTINEL --> CONSUMER[Consumer Service]
        CONSUMER --> DB[(PostgreSQL<br/>Railway)]
        ARRIVALS --> DB
    end
    
    subgraph "ML Pipeline - GitHub Actions Nightly"
        DB --> TRAINER[train_regression.py]
        TRAINER --> EVAL{MAE Improved?}
        EVAL -->|Yes| DEPLOY[Deploy New Model]
        EVAL -->|No| SKIP[Keep Previous]
        DEPLOY --> ML
    end
```

---

## Data Flow

```mermaid
sequenceDiagram
    participant C as Collector
    participant API as Madison Metro API
    participant S as Sentinel
    participant W as Consumer Worker
    participant DB as PostgreSQL
    participant AD as Arrival Detector

    loop Every 60 seconds
        C->>API: GET /getvehicles
        API-->>C: Live Bus Positions (lat, lon, vid, rt)
        C->>S: Produce to 'madison-metro-vehicles'
        C->>AD: Check if any bus is at a stop
        AD-->>DB: INSERT into stop_arrivals
    end

    loop Every 2 minutes
        C->>API: GET /getpredictions (vid=...)
        API-->>C: Predicted arrival times (prdtm)
        C->>S: Produce to 'madison-metro-predictions'
        C->>DB: INSERT into predictions
    end

    loop Continuous
        S->>W: Push vehicle messages
        W->>DB: Bulk insert to vehicle_observations
    end
```

---

## Ground Truth Pipeline

The key innovation of this project is collecting **actual arrival data** to validate API predictions.

```mermaid
flowchart LR
    subgraph "Step 1: Detection"
        VEH[Vehicle Position<br/>lat: 43.0731, lon: -89.4012]
        STOP[Stop Location<br/>lat: 43.0732, lon: -89.4010]
        VEH --> HAV{Haversine<br/>Distance}
        STOP --> HAV
        HAV -->|< 30 meters| ARR[Arrival Detected]
    end
    
    subgraph "Step 2: Matching"
        ARR --> MATCH{Find Prediction<br/>Same vid + stpid}
        PRED[(predictions table<br/>prdtm: 20260104 19:05)]
        PRED --> MATCH
        MATCH --> OUTCOME[Prediction Outcome]
    end
    
    subgraph "Step 3: Ground Truth"
        OUTCOME --> CALC[error_seconds =<br/>actual_arrival - predicted_arrival]
        CALC --> TARGET[(prediction_outcomes<br/>Training Data)]
    end
```

---

## ML Pipeline

```mermaid
flowchart TB
    subgraph "Data Extraction"
        DB[(PostgreSQL)] --> FETCH[Fetch last 7 days<br/>from prediction_outcomes]
        FETCH --> RAW[Raw DataFrame<br/>error_seconds as target]
    end
    
    subgraph "Feature Engineering"
        RAW --> SPLIT[Train/Test Split<br/>80/20]
        SPLIT --> TRAIN_FE[Training Features]
        SPLIT --> TEST_FE[Test Features]
        
        TRAIN_FE --> TEMP[Temporal Features<br/>hour, day_of_week, is_rush_hour]
        TRAIN_FE --> ROUTE[Route Features<br/>route_frequency, route_encoded]
        TRAIN_FE --> HIST[Historical Aggregates<br/>route_avg_error, hr_route_error]
    end
    
    subgraph "Training"
        TEMP --> XGB[XGBoost Regressor<br/>n_estimators=100, max_depth=5]
        ROUTE --> XGB
        HIST --> XGB
        XGB --> PRED[Predictions]
    end
    
    subgraph "Evaluation"
        PRED --> MAE[Mean Absolute Error]
        PRED --> RMSE[Root Mean Square Error]
        TEST_FE --> MAE
        TEST_FE --> RMSE
        MAE --> COMPARE{New MAE < Old MAE?}
        COMPARE -->|Yes| DEPLOY[Save and Deploy Model]
        COMPARE -->|No| REJECT[Reject, Keep Old Model]
    end
```

---

## Autonomous Retraining

The pipeline runs nightly at 3 AM CST via GitHub Actions:

```mermaid
flowchart LR
    CRON[GitHub Actions<br/>cron: 0 9 * * *] --> CHECKOUT[Checkout Repo]
    CHECKOUT --> SETUP[Setup Python 3.11]
    SETUP --> INSTALL[pip install dependencies]
    INSTALL --> TRAIN[python train_regression.py]
    TRAIN --> CHECK{Model Improved?}
    CHECK -->|Yes| COMMIT[Commit new model<br/>to repo]
    CHECK -->|No| SKIP[No commit]
    COMMIT --> PUSH[Push to main]
```

```yaml
# .github/workflows/nightly-training.yml
on:
  schedule:
    - cron: '0 9 * * *'  # 3 AM CST (9 AM UTC)
```

---

## Database Schema

```mermaid
erDiagram
    vehicle_observations {
        int id PK
        string vid
        string rt
        float lat
        float lon
        int hdg
        boolean dly
        datetime tmstmp
        datetime collected_at
    }
    
    predictions {
        int id PK
        string stpid
        string stpnm
        string vid
        string rt
        string prdtm
        int prdctdn
        datetime collected_at
    }
    
    stop_arrivals {
        int id PK
        string vid
        string rt
        string stpid
        string stpnm
        datetime arrived_at
    }
    
    prediction_outcomes {
        int id PK
        int prediction_id FK
        string vid
        string rt
        string stpid
        datetime predicted_arrival
        datetime actual_arrival
        int error_seconds
        boolean is_significantly_late
        datetime created_at
    }
    
    ml_training_runs {
        int id PK
        string version
        datetime trained_at
        int samples_used
        float mae
        float rmse
        boolean deployed
        string deployment_reason
    }
    
    predictions ||--o| prediction_outcomes : "matched to"
    stop_arrivals ||--o| prediction_outcomes : "generates"
```

---

## Why Not Classification?

Previous approach tried to predict the API's `dly` (delayed) flag. This was fundamentally flawed:

```mermaid
flowchart LR
    subgraph "Old Approach - Classification"
        API1[API says dly=true] --> MODEL1[Model predicts dly=true]
        MODEL1 --> CIRCULAR[Circular: predicting what API already said]
    end
    
    subgraph "New Approach - Regression"
        API2[API says: arrives 19:05] --> ACTUAL[Bus actually arrives: 19:08]
        ACTUAL --> ERROR[error_seconds = +180]
        ERROR --> MODEL2[Model learns: Route B at 7pm<br/>is usually 3 min late]
    end
```

| Issue | Classification | Regression |
|-------|---------------|------------|
| Target | API's dly flag (circular) | Actual error in seconds |
| Ground Truth | None | Measured arrival times |
| Usefulness | Predicting known info | Correcting predictions |
| Metrics | 92% acc, 0.37 F1 (useless) | MAE in seconds (actionable) |

---

## API Rate Optimization

10,000 API calls per day, optimized for maximum data collection:

```mermaid
pie title Daily API Call Budget (10,000)
    "getvehicles (60s)" : 4320
    "getpredictions (2min)" : 2880
    "Unused Headroom" : 2800
```

| Endpoint | Interval | Calls/Day | Purpose |
|----------|----------|-----------|---------|
| getvehicles | 60s | ~4,320 | Live bus positions |
| getpredictions | 120s | ~2,880 | API arrival predictions |
| **Total** | | ~7,200 | 72% utilization |

---

## Project Structure

```
madison-bus-eta/
├── backend/                 # Flask API + ML inference
│   ├── app.py              # Main API routes
│   └── utils/api.py        # Madison Metro API wrapper
│
├── frontend/               # React + Vite + TypeScript
│   ├── src/components/     # MapView, RouteList, etc.
│   └── src/hooks/          # useVehicles, useRoutes
│
├── collector/              # 24/7 Data Collection (Railway)
│   ├── collector.py        # Main collection loop
│   ├── arrival_detector.py # Stop detection via Haversine
│   ├── db.py               # SQLAlchemy models
│   └── sentinel_client.py  # Message queue producer
│
├── ml/                     # Machine Learning Pipeline
│   ├── features/
│   │   ├── feature_engineering.py   # Legacy classification
│   │   └── regression_features.py   # ETA error features
│   ├── training/
│   │   ├── train.py                 # Legacy classification
│   │   └── train_regression.py      # ETA error regression
│   └── models/
│       └── model_registry.py        # Versioning + persistence
│
└── .github/workflows/
    └── nightly-training.yml         # Autonomous retraining
```

---

## Deployment

| Component | Platform | Status |
|-----------|----------|--------|
| Frontend | Vercel | Active |
| Backend API | Railway | Active |
| Data Collector | Railway Worker | Active |
| Sentinel | Railway Docker | Active |
| Consumer | Railway Worker | Active |
| PostgreSQL | Railway | Active |

---

## API Reference

### Core Endpoints

```
GET /health              System status and uptime
GET /routes              All 29 Madison Metro routes
GET /vehicles            Live bus positions (60+ buses)
GET /vehicles?rt=80      Filter by route
GET /patterns?rt=A       Route geometry (polylines)
GET /predictions?stpid=  Arrival predictions for stop
```

### ML Endpoints

```
GET  /api/ml/status              Current model version and metrics
POST /api/predict-arrival        Get corrected ETA prediction
POST /api/predict-arrival-v2     Enhanced prediction with confidence intervals
GET  /api/model-performance      Training history
```

### A/B Testing & Monitoring

```
POST /api/ab-test/log            Log prediction for A/B comparison
GET  /api/ab-test/results        Get ML vs API comparison metrics
GET  /api/drift/check            Check model drift status (OK/WARNING/CRITICAL)
GET  /api/route-reliability      Per-route reliability scores
GET  /api/route-reliability/<id> Detailed hourly breakdown for route
```

### Diagnostics

```
GET /api/diagnostics/error-by-horizon    Error breakdown by prediction horizon
GET /api/diagnostics/predicted-vs-actual Scatter plot data with R²
GET /api/diagnostics/worst-predictions   Debugging worst cases
GET /api/diagnostics/hourly-bias         Time-of-day analysis
GET /api/diagnostics/feature-importance  XGBoost feature importance
```

---

## Technologies

| Layer | Stack |
|-------|-------|
| Frontend | React 18, TypeScript, Vite, Leaflet |
| Backend | Flask, Python 3.11 |
| Machine Learning | XGBoost, scikit-learn, pandas, NumPy |
| Database | PostgreSQL |
| Streaming | Sentinel (custom Kafka-like message queue) |
| Infrastructure | Railway, GitHub Actions, Vercel |

---

## Related Projects

**Sentinel** - A Kafka-like message queue I built for this project:

- <https://github.com/matteso1/sentinel>
- Streams bus data from collector to ML pipeline
- Handles 1.7M writes/sec (massively overbuilt, but demonstrates systems design)

---

## License

MIT License
