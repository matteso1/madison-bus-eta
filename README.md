# Madison Metro ETA

A real-time bus tracking, ML prediction, and transit analytics system for Madison, WI. Built because the official Metro app is genuinely bad and in 2025 there's no excuse for it.

**Live:** [madison-bus-eta.vercel.app](https://madison-bus-eta.vercel.app)
**GitHub:** [github.com/matteso1/madison-bus-eta](https://github.com/matteso1/madison-bus-eta)

> **Heads up:** The Madison Metro API has a cap of ~10,000 requests/day. If this gets a lot of traffic simultaneously, live bus data may degrade. Working on it.

---

## What's Actually Built Right Now

```mermaid
graph LR
    subgraph "Live Today"
        A[Real-time map<br/>all 29 routes] --> B[Stop predictions<br/>with ML correction]
        B --> C[Confidence intervals<br/>conformal prediction]
        A --> D[Bus bunching<br/>detection + map overlay]
        D --> E[Analytics panel<br/>bunching / reliability / errors]
    end

    subgraph "Pipeline"
        F[Collector<br/>60s polls, 24/7] --> G[(PostgreSQL<br/>Railway)]
        G --> H[Nightly retraining<br/>GitHub Actions]
        H --> B
    end
```

### The Map
Dark-mode, DeckGL-accelerated map (MapLibre + deck.gl). Click any stop to see arrival predictions. Select a route to see its path and live vehicle positions. The map renders ~60 simultaneous bus markers without breaking a sweat. Compare this to the official Metro app.

### ML Predictions
The API tells you a bus arrives in 8 minutes. This system learns when that estimate is off — by how much, in which direction, for which routes at which times. An XGBoost regression model trained on `error_seconds` (actual minus predicted) corrects the API estimate. Uncertainty bounds come from Mondrian conformal prediction, stratified by route × day-type × horizon bucket — meaning the 90% confidence interval is statistically guaranteed to contain the actual arrival 90% of the time. No other transit app does this.

> **Current status:** The ML model is only as good as the ground truth data accumulated so far. The pipeline is running and collecting — the model improves every night. The interesting part right now is the architecture, not the numbers.

### Bus Bunching Detection
Two buses on the same route within 500m for 2+ consecutive 60s polls = confirmed bunching event. The map highlights the road segment between them in amber, snapped to the actual route polyline (not a GPS diagonal). Looks like Google Maps traffic. The Analytics > Bunching tab shows frequency by route over 7 days. This is a feature no transit app currently surfaces to riders.

### Analytics Panel
- **Performance** — MAE trend, model coverage, training history
- **Errors** — prediction error by horizon, hour-of-day bias
- **Routes** — reliability scores per route
- **Bunching** — bunching events by route, recent feed

---

## Architecture

```mermaid
graph TB
    subgraph "Data Collection - Railway, 24/7"
        COL[collector.py<br/>60s vehicle polls] --> API[Madison Metro REST API]
        COL --> BUNCH[bunch_detector.py<br/>in-memory state machine]
        COL --> ARR[arrival_detector.py<br/>haversine stop matching]
        ARR --> DB
        BUNCH --> DB
    end

    subgraph "Storage"
        DB[(PostgreSQL<br/>Railway<br/>30-day rolling retention)]
    end

    subgraph "ML Pipeline - GitHub Actions 3AM CST"
        DB --> TRAIN[train_regression.py<br/>XGBoost, 44 features]
        TRAIN --> GATE{MAE improved<br/>by ≥2s?}
        GATE -->|yes| DEPLOY[commit model<br/>to repo]
        GATE -->|no| SKIP[keep current]
        DEPLOY --> CONF[conformal_calibration.py<br/>Mondrian CP]
    end

    subgraph "Backend - Railway"
        FLASK[Flask app.py<br/>~4100 lines]
        FLASK --> DB
        FLASK --> DEPLOY
    end

    subgraph "Frontend - Vercel"
        REACT[React 19 + Vite 7<br/>DeckGL 9.2 + MapLibre 5.13]
        REACT --> FLASK
    end
```

---

## Ground Truth Pipeline

This is the core of the ML system. The API gives predictions — we measure how wrong they are.

```mermaid
sequenceDiagram
    participant C as Collector
    participant API as Metro API
    participant AD as Arrival Detector
    participant DB as PostgreSQL

    loop Every 60s
        C->>API: GET /getvehicles
        API-->>C: lat, lon, vid, rt for all buses
        C->>AD: check each vehicle against 1000+ stop locations
        AD-->>DB: INSERT stop_arrivals (haversine < 30m)
        AD->>DB: match arrival → prediction → INSERT prediction_outcomes (error_seconds)
    end

    Note over DB: prediction_outcomes is the training table<br/>error_seconds = actual_arrival - predicted_arrival
```

---

## ML Feature Vector

44 features. Order matters for the model.

```mermaid
mindmap
  root((44 Features))
    Temporal
      horizon_min / squared / log / bucket
      hour_sin/cos, day_sin/cos, month_sin/cos
      is_weekend, is_rush_hour, is_holiday
    Route
      route_avg_error, route_error_std
      hr_route_error, route_horizon_error
      route_frequency, route_encoded
    Stop
      stop_avg_error, stop_error_std
      shrinkage for under 50 samples
    Weather
      temp, precipitation, snow, wind
      visibility, is_severe_weather
    Vehicle
      avg_speed, speed_stddev
      is_stopped, is_slow, is_moving_fast
```

---

## Deployment Gates

The nightly pipeline won't deploy a model that isn't better:

```mermaid
flowchart LR
    NEW[New model trained] --> S1{MIN_IMPROVEMENT<br/>≥ 2s MAE?}
    S1 -->|no| REJECT
    S1 -->|yes| S2{MAX_MAE<br/>≤ 90s?}
    S2 -->|no| REJECT
    S2 -->|yes| S3{MIN_TEST_SAMPLES<br/>≥ 1000?}
    S3 -->|no| REJECT
    S3 -->|yes| S4{No regression<br/>vs previous?}
    S4 -->|no| REJECT
    S4 -->|yes| DEPLOY[Deploy + commit]
    REJECT[Keep current model]
```

---

## What's Next

This is a research project and the roadmap is ambitious.

```mermaid
gantt
    title Roadmap
    dateFormat  YYYY-MM
    section Done
    Live map + route paths         :done, 2025-10, 2025-11
    ML regression pipeline         :done, 2025-11, 2025-12
    Conformal prediction           :done, 2025-12, 2026-01
    Bus bunching detection + map   :done, 2026-01, 2026-02
    section In Progress
    Ground truth accumulation      :active, 2026-02, 2026-04
    section Planned
    Segment-level LSTM             :2026-04, 2026-06
    Bunching alerts to riders      :2026-04, 2026-05
    GTFS-RT deeper integration     :2026-03, 2026-05
```

**Segment-level travel time decomposition** — decompose each route into stop-to-stop segments, learn a travel time distribution per segment conditioned on time/weather/headway. Sum segments for the full prediction. Inspired by recent work on Montreal's STM network (LSTM outperforming transformers by 18-52% at 275x fewer parameters). This is the approach most likely to actually beat the API.

**Bunching alerts** — "Route B is bunching near East Campus right now, next bus may be delayed." No transit app does this. The detection is already running — surfacing it as a user-facing alert is the next step.

**Calibrated confidence as the differentiator** — the conformal prediction layer already gives statistically guaranteed intervals. Once enough ground truth accumulates to properly validate coverage, this becomes a publishable result.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Vite 7, Tailwind 4, DeckGL 9.2, MapLibre 5.13, Recharts |
| Backend | Flask, SQLAlchemy, Python 3.11 |
| ML | XGBoost, scikit-learn, Mondrian conformal prediction |
| Database | PostgreSQL (Railway, 30-day retention) |
| Infra | Railway (backend + collector + DB), Vercel (frontend), GitHub Actions (nightly training) |

---

## Local Dev

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

The frontend works read-only without an API key. Live vehicles and ML predictions require `MADISON_METRO_API_KEY`.

---

## Contributing / Feedback

This is an active research project. If you're a Madison student or dev and want to poke at it, break it, or contribute — open an issue or email [nilsmatteson@icloud.com](mailto:nilsmatteson@icloud.com).

If you hit the API rate limit or see something wrong, please report it. Real usage data is genuinely useful for the research.

---

MIT License
