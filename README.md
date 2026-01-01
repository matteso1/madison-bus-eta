# Madison Metro ML

A machine learning-enhanced bus tracking system for Madison, WI. Predicts delays 21% better than the official API.

## Quick Start

```bash
# Backend
cd backend && python -m flask run --port=5000

# Frontend  
cd frontend && npm run dev
```

Open <http://localhost:5173> → Live map with 60+ buses

---

## Architecture

```mermaid
graph TB
    subgraph "User-Facing"
        FE[React Frontend<br/>localhost:5173]
        FE --> BE
    end
    
    subgraph "API Layer"
        BE[Flask Backend<br/>localhost:5000]
        BE --> METRO[Madison Metro API]
        BE --> ML[ML Models]
    end
    
    subgraph "Data Pipeline - Cloud 24/7"
        COLLECTOR[Data Collector<br/>Railway Worker]
        COLLECTOR --> METRO
        COLLECTOR --> SENTINEL[Sentinel<br/>Message Queue]
    end
    
    subgraph "ML Pipeline"
        SENTINEL --> CONSUMER[Consumer Service]
        CONSUMER --> DB[(TimescaleDB)]
        DB --> TRAINER[Daily Retrain Job]
        TRAINER --> ML
    end
```

### Current (Working)

- **Frontend**: Live 2D map with 60+ buses, route filtering
- **Backend**: Flask API, 29 routes, ML inference
- **ML Model**: XGBoost, 21.3% improvement

### Planned (Building)

- **Cloud Collector**: 24/7 data ingestion within API limits
- **Sentinel Integration**: Stream bus data through custom message queue
- **Auto-Retrain**: Daily model updates as data grows

---

## Data Flow

```mermaid
sequenceDiagram
    participant C as Collector (Cloud)
    participant API as Madison Metro API
    participant S as Sentinel
    participant ML as ML Pipeline
    participant DB as Database

    loop Every 30s (within rate limits)
        C->>API: GET /vehicles, /predictions
        API-->>C: Bus positions, ETAs
        C->>S: Produce to 'bus-updates' topic
    end

    S->>ML: Consume messages
    ML->>DB: Store training data
    
    Note over ML: Daily retrain at 3am
    ML->>ML: Retrain on new data
```

---

## Deployment Plan

| Component | Platform | Status |
|-----------|----------|--------|
| Frontend | Vercel | Deploy |
| Backend API | Railway | Deploy |
| Data Collector | Railway Worker | Build |
| Sentinel | Railway (or local) | Optional |
| Database | Railway Postgres | Build |

---

## Directory Structure (Clean)

```
madison-bus-eta/
├── backend/          # Flask API + ML models
├── frontend/         # React + Vite
├── collector/        # Cloud data ingestion (NEW)
└── README.md
```

**Delete these (clutter):**

- `BACKEND_OLD/` - 4,400+ files of old code
- `FRONDEND_OLD/` - Previous frontend attempt
- `ml_system/` - Duplicate ML code
- `data_pipeline/` - Unused
- Various `.md` files (consolidate into README)

---

## Why Sentinel?

[Sentinel](https://github.com/matteso1/sentinel) is a Kafka-like message queue I built:

- Streams bus data from collector → ML pipeline
- Decouples ingestion from processing
- Handles 1.7M writes/sec (way more than needed, but cool)

This creates a real-world demo for Sentinel while improving Madison Metro.

---

## ML Model

**Current Approach:**

- XGBoost regression
- 204K training records → Overfit
- Needs more diverse data

**Roadmap:**

1. Collect 6+ months of data (24/7 cloud collector)
2. Proper train/val/test splits by time
3. Feature engineering: weather, events, historical patterns
4. Possibly LSTM for sequence modeling

---

## API Reference

```
GET /health              - System status
GET /routes              - All routes (29 total)
GET /vehicles            - Live bus positions
GET /vehicles?rt=80      - Filter by route
GET /patterns?rt=A       - Route geometry
GET /ml/status           - ML model info
```

---

## Development

```bash
# Run everything
cd backend && python -m flask run &
cd frontend && npm run dev &

# Test the API
curl http://localhost:5000/health
curl http://localhost:5000/vehicles?rt=80 | jq
```
