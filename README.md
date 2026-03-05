# Madison Bus ETA

Real-time bus tracking with ML-powered arrival predictions for Madison, WI. Built because the official Metro app doesn't cut it.

**Live:** [madisonbuseta.com](https://madisonbuseta.com)

---

## What It Does

- **Live map** of all 29 Madison Metro routes with real-time vehicle positions (DeckGL + MapLibre, 60fps with 200+ markers)
- **ML arrival predictions** -- XGBoost regression corrects the Metro API's estimates using 47 features (temporal, route history, stop history, weather, vehicle speed). Currently 35% more accurate than trusting the API raw
- **Confidence intervals** via Mondrian conformal prediction -- statistically guaranteed 90% coverage, stratified by route x day-type x horizon
- **Bus bunching detection** -- two buses within 500m for 2+ consecutive polls, highlighted on the map with amber route-snapped overlays
- **Mobile PWA** -- responsive bottom-sheet UI with geolocation-based nearby stops, installable as a home screen app
- **Analytics dashboard** -- MAE trends, hourly bias, route reliability scores, bunching frequency, feature importance

---

## Architecture

```
                                   +------------------+
                                   |  Madison Metro   |
                                   |   REST API       |
                                   +--------+---------+
                                            |
                 +--------------------------+---------------------------+
                 |                                                      |
    +------------v-----------+                            +-------------v----------+
    |  Collector (Railway)   |                            |  Flask Backend         |
    |  60s vehicle polls     |                            |  (Railway)             |
    |  arrival detector      +----------+                 |  /vehicles, /predict   |
    |  bunch detector        |          |                 |  /all-patterns, etc.   |
    +------------------------+          |                 +-------------+----------+
                                        |                               |
                              +---------v---------+                     |
                              |  PostgreSQL       |                     |
                              |  (Railway)        <---------------------+
                              |  30-day rolling   |
                              +---------+---------+
                                        |
                              +---------v---------+
                              |  Nightly Training |
                              |  (GitHub Actions) |
                              |  XGBoost + gates  |
                              |  Conformal cal.   |
                              +-------------------+
                                        |
                              +---------v---------+
                              |  React Frontend   |
                              |  (Vercel CDN)     |
                              |  Static routes    |
                              |  DeckGL map       |
                              +-------------------+
```

---

## ML Pipeline

### Ground Truth

The collector polls every 60 seconds, tracking all active buses. When a bus comes within 30m of a stop (haversine), it logs the actual arrival time. This gets matched against the API's prediction to compute `error_seconds` -- the training target.

### Feature Vector (47 features)

| Category | Features |
|----------|----------|
| **Horizon** | horizon_min, horizon_squared, horizon_log, horizon_bucket, is_long_horizon |
| **Temporal** | hour_sin/cos, day_sin/cos, month_sin/cos, is_weekend, is_rush_hour, is_holiday, is_morning_rush, is_evening_rush |
| **Route** | route_frequency, route_encoded, predicted_minutes, route_avg_error, route_error_std, hr_route_error, route_horizon_error, route_horizon_std, dow_avg_error |
| **Stop** | stop_avg_error, stop_error_std (shrinkage estimators for stops with <50 samples) |
| **Weather** | temp_celsius, is_cold, is_hot, precipitation_mm, snow_mm, is_raining, is_snowing, is_precipitating, wind_speed, is_windy, visibility_km, low_visibility, is_severe_weather |
| **Vehicle** | avg_speed, speed_stddev, speed_variability, is_stopped, is_slow, is_moving_fast, has_velocity_data |

### Deployment Gates

The nightly pipeline won't deploy a model that isn't better:

- Minimum 2s MAE improvement over current model
- MAE must be under 90s
- At least 1,000 test samples
- No regression allowed on any metric
- Temporal split: train on days 1-5, test on days 6-7

### Conformal Calibration

After training, a Mondrian conformal prediction layer calibrates uncertainty bounds per stratum (route x day-type x horizon bucket). Global coverage target: 90%. The calibration artifact is committed alongside the model.

---

## Frontend

Desktop and mobile are separate UIs sharing the same MapView component.

**Desktop:** Three-tab layout (Map / Analytics / System) with a context panel for route drilldowns, stop predictions, and trip planning.

**Mobile:** Full-screen map with a draggable bottom sheet. Geolocation-based nearby stops, tap-to-predict, bus tracking bar. Installable as a PWA.

Route shapes are served from a static JSON snapshot (~200KB gzipped) -- zero API calls to draw the map.

### Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Vite 7, Tailwind 4, DeckGL 9.2, MapLibre 5.13, Recharts, Framer Motion |
| Backend | Flask, SQLAlchemy, Python 3.11 |
| ML | XGBoost 1.7.6, scikit-learn, Mondrian conformal prediction |
| Database | PostgreSQL (Railway, 30-day retention) |
| Infra | Railway (backend + collector + DB), Vercel (frontend + CDN), GitHub Actions (nightly training) |
| Domain | madisonbuseta.com (Namecheap + Vercel) |

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

The frontend works read-only without an API key (route map renders from static data). Live vehicles and ML predictions require `MADISON_METRO_API_KEY` from Madison Metro's developer portal.

---

## API Rate Limit

Madison Metro's API has a daily request cap. If the app detects the API is out of requests (0 buses during service hours), it shows a banner explaining the situation and linking to an email template for requesting a higher quota from the city.

---

## Contributing

Open an issue or email [nilsmatteson@icloud.com](mailto:nilsmatteson@icloud.com). Real usage data and bug reports are genuinely useful.

---

MIT License
