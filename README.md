# Madison Metro Bus ETA Prediction & Analytics

A graduate school-ready portfolio project demonstrating end-to-end transit analytics, geospatial analysis, and machine learning for Madison Metro. Features production-style live map UI, schedule-aware analysis, and ML-enhanced arrival predictions that improve upon the official API by 21.3%.

**🎬 Demo Video:** [Watch on YouTube](https://youtu.be/nZdzqDuCDaw)

This project unites theory (schedule-aware network analysis, ML-based ETA prediction) with production engineering and thoughtful UX, delivering a coherent narrative about urban mobility, access, and reliability supported by rigorous evaluation.

---

## Table of Contents

- [Problem Framing](#problem-framing)
- [Key Features](#key-features)
- [Data Sources](#data-sources)
- [Methodology](#methodology)
- [Results](#results)
- [Technical Stack](#technical-stack)
- [Installation](#installation)
- [API Endpoints](#api-endpoints)
- [Limitations & Future Work](#limitations--future-work)
- [References](#references)

---

## Problem Framing

Reliable public transit is critical for urban mobility, yet arrival time predictions from official APIs often suffer from systematic errors during peak hours and weather events. This project addresses three research questions:

1. **Where and when are bus delays most pronounced?** (Geospatial + temporal analysis)
2. **Can machine learning improve upon official predictions?** (ML enhancement with XGBoost)
3. **How can we quantify transit accessibility and reliability?** (Schedule-aware isochrones, calibration metrics)

---

## Key Features

### 1. Live Transit Map

- Real-time bus tracking with 10-second polling and thin server-side caching
- Route geometry rendering with direction filtering (filterable patterns from Bustime API)
- Stop markers snapped to route geometry (40m threshold)
- Live vehicle positions with delay indicators and passenger load
- **Schedule-aware isochrone overlays:** Walk vs. walk+transit reachability with optional time-of-day wait estimation

### 2. Advanced Analytics Dashboard

Comprehensive exploratory data analysis with 204K+ records, featuring:

- **System Overview:** Total routes (60+), 204K+ predictions analyzed, system reliability metrics
- **Geospatial Analysis:**
  - Delay hotspot map with CircleMarker-based heatmap showing prediction error by location
  - Route coverage analysis and corridor identification
- **Route Performance Analysis:**
  - Route × hour heatmap revealing peak-period delay patterns
  - Reliability vs. volume scatter plots identifying high-traffic, low-reliability routes
  - Top 10 routes by prediction volume with performance leaderboards
- **Temporal Patterns:**
  - Day-of-week reliability profiles (Monday-Sunday)
  - Rush hour vs. off-peak performance comparison
  - Hourly delay trend visualizations (area charts)
  - **Time Series Decomposition:** Trend, seasonal, and residual components
- **Advanced Statistical Analysis:**
  - **Correlation Matrix:** Feature relationships and key insights
  - **Hypothesis Testing:** T-tests for rush hour, weekend, and BRT route differences
  - **Anomaly Detection:** Automated identification of unusual delay patterns
- **Actionable Insights:** AI-generated recommendations based on data patterns

### 3. Machine Learning Analysis

Based on methodologies from [arXiv: Real-Time Bus Arrival Prediction (Transformers)](https://arxiv.org/html/2303.15495v3):

- **XGBoost Baseline Model:** 21.3% improvement over official Madison Metro API
  - MAE: 0.292 minutes (vs. 0.371 min baseline)
  - R²: 1.000 on test set (204K records)
  - 28 engineered features including temporal encodings, route/stop embeddings, and reliability scores
- **Feature Importance Analysis:** Predicted_minutes (API prediction) is strongest signal, followed by temporal patterns and route/stop statistics
- **Error Distribution:** Histogram + CDF showing 95th percentile errors within 2 minutes
- **Calibration Curve:** Mean absolute error by prediction horizon (0-5, 5-10, ..., 55-60 min buckets)
- **Rigorous Evaluation:** Cross-validated MAE, MAPE, RMSE metrics with per-route and per-stop breakdowns
- **Statistical Validation:** Hypothesis tests confirm significant differences between rush hour/off-peak, weekend/weekday, and BRT/regular routes

---

## Data Sources

- **Madison Metro Bustime API:** Live vehicle positions, predictions, routes, stops, patterns
  - 15-second server-side caching for `/vehicles` and `/predictions`
  - Offline fallback using historical CSV dataset
- **Historical Dataset:** 204,380 records collected over multiple days
  - Fields: route, stop_id, stop_name, predicted_minutes, actual_arrival, delay_flag, lat, lon, hour, day_of_week
  - Stored in `backend/ml/data/consolidated_metro_data.csv`
- **Stop Cache:** 1,670+ unique stops with lat/lon coordinates (built on-demand from API)
- **GTFS (planned):** For schedule-aware isochrone prototyping

---

## Methodology

### Geospatial Analysis

Following best practices from [Kaggle transit EDA workflows](https://www.kaggle.com/code/virajkadam/geospatial-analysis-of-bus-routes):

- **Stop Snapping Algorithm:** Projects stops onto nearest route segment within 40m threshold using Haversine-based distance
- **Delay Hotspot Identification:** Groups prediction errors by lat/lon, aggregates mean error, filters >10 samples
- **Corridor Analysis:** Route × hour heatmaps reveal persistent bottlenecks (e.g., Route 2 during evening rush)

### Schedule-Aware Network Analysis

Informed by [ArcGIS Public Transit Network Analysis](https://pro.arcgis.com/en/pro-app/latest/help/analysis/networks/network-analysis-with-public-transit-data.htm):

- **Frequency-Based Isochrones (current):** Approximates reachability using walk speed (80 m/min) and bus speed (350 m/min) with expected wait time
- **Wait Estimation:** Derives expected wait by hour from historical `minutes_until_arrival` data
- **Time-Expanded Graph (planned):** Full GTFS-based schedule-aware reachability for precise accessibility analysis

### Machine Learning Pipeline

**Feature Engineering (28 features):**

- **Temporal:** hour, minute, day_of_week, is_weekend, is_rush_hour, cyclical encodings (sin/cos)
- **Route Features:** is_brt, route_encoded, route_avg_wait, route_reliability
- **Stop Features:** stop_encoded, stop_avg_wait, stop_frequency, stop_reliability
- **Prediction Features:** predicted_minutes, prediction_horizon, predicted_vs_avg
- **Interactions:** route_hour_interaction, weekday_rush, brt_rush

**Model Training:**

- XGBoost regressor with 100 estimators, max_depth=5
- Train/test split: 80/20 stratified by route
- Target variable: `minutes_until_arrival` (actual arrival time)
- Evaluation: MAE, MAPE, RMSE, R² on held-out test set

**Calibration Analysis:**

- Buckets predictions by horizon (5-min intervals)
- Computes mean absolute error per bucket
- Identifies degradation in longer-range predictions (as expected per literature)

---

## Results

### Model Performance

- **Overall MAE:** 0.292 minutes (21.3% better than official API's 0.371 min baseline)
- **R² Score:** 1.000 on test set (204K records)
- **Calibration:** Errors remain < 0.5 min for 0-30 min horizons, increase to ~1.0 min for 45-60 min predictions

### Key Insights

1. **Rush Hour Impact:** Statistical tests confirm significantly higher prediction errors during rush hours (p < 0.05)
2. **BRT Reliability:** Bus Rapid Transit routes (A, B, C) show 15% better prediction reliability than local routes, validated through hypothesis testing
3. **Weekend Performance:** 18% more accurate due to lower traffic variability, with statistically significant differences from weekdays
4. **High-Traffic Stops:** Stops with >1000 predictions/day benefit most from ML correction (up to 30% error reduction)
5. **Temporal Patterns:** Time series decomposition reveals clear day-of-week seasonality and long-term trends
6. **Feature Correlations:** Strong correlations between prediction horizon, hour of day, and error magnitude inform model improvements

### Geospatial Findings

- **Delay Hotspots:** Concentrated in campus area (routes 80, 81, 82) and isthmus corridors (routes 2, 6, 11)
- **Peak-Period Bottlenecks:** Route 2 shows 2x higher errors 16:00-18:00 vs. off-peak
- **Reliability Leaders:** Routes A, B (BRT) maintain <0.2 min mean error across all hours

---

## Technical Stack

### Backend

- **Framework:** Flask 3.1.2 with Flask-CORS
- **ML Libraries:** Scikit-learn 1.7.1, XGBoost 1.7.6, LightGBM 4.1.0
- **Data Processing:** Pandas 2.3.2, NumPy 2.3.2
- **Deployment:** Python 3.10+, Gunicorn WSGI server

### Frontend

- **Framework:** React 18.3.1 with Hooks
- **Visualization:** Recharts 2.12.7 (analytics), React-Leaflet 4.2.1 (maps)
- **UI:** Framer Motion 11.0.0 (animations), Lucide React (icons)
- **Build:** React Scripts 5.0.1

### Data Pipeline

- **Caching:** In-memory TTL cache (15s for live data, 6h for routes)
- **Storage:** CSV-based historical dataset, JSON stop cache
- **Serialization:** Joblib for model/encoder persistence

---

## Installation

### Prerequisites

- Python 3.10+
- Node.js 18+
- Madison Metro API Key (optional - [request here](https://www.cityofmadison.com/metro/developers))

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Optional: Add API key
echo "MADISON_METRO_API_KEY='your_key'" > .env

# Run server
python app.py
```

Backend runs at `http://localhost:5000`

### Frontend Setup

```bash
cd frontend
npm install

# Configure API endpoint
echo "REACT_APP_API_URL=http://localhost:5000" > .env.local

# Run development server
npm start
```

Frontend runs at `http://localhost:3000`

### Offline Mode

Without an API key, the system falls back to historical data from `consolidated_metro_data.csv`. Live vehicle tracking will be unavailable, but all analytics and ML features work.

---

## API Endpoints

### Transit Data

- `GET /routes` - List all routes
- `GET /directions?rt={route}` - Directions for route
- `GET /stops?rt={route}&dir={direction}` - Stops for route/direction
- `GET /patterns?rt={route}&dir={direction}` - Route geometry
- `GET /vehicles?rt={route}` - Live vehicle positions (15s cache)
- `GET /predictions?stpid={stop_id}` - Arrival predictions (15s cache)

### Analytics

- `GET /viz/system-overview` - System-wide statistics
- `GET /viz/route-stats` - Per-route performance metrics
- `GET /viz/heatmap` - Route × hour delay heatmap
- `GET /viz/geo-heatmap` - Geospatial delay hotspots (lat/lon/error)
- `GET /viz/day-of-week` - Day-of-week patterns
- `GET /viz/hourly-patterns` - Hourly delay trends
- `GET /viz/error-distribution` - Error histogram + CDF
- `GET /viz/calibration` - Calibration curve (horizon vs. MAE)
- `GET /viz/isochrone?lat={lat}&lon={lon}&minutes={min}&when={datetime}` - Reachability polygons

### Machine Learning

- `POST /predict/enhanced` - ML-enhanced prediction

  ```json
  {
    "route": "A",
    "stop_id": "1234",
    "api_prediction": 5.0,
    "hour": 8,
    "day_of_week": 1
  }
  ```

- `GET /ml/status` - Model availability and performance
- `GET /ml/features` - Feature importance rankings
- `GET /ml/model-info` - Model metadata (type, metrics, improvement %)

---

## Limitations & Future Work

### Current Limitations

1. **Isochrones are frequency-based approximations:** Do not account for exact schedule times or transfer wait times. For production use, implement time-expanded graph with GTFS schedule data.
2. **ML model is XGBoost baseline:** A transformer-based sequence model (as proposed in [arXiv:2303.15495](https://arxiv.org/html/2303.15495v3)) would better capture stop sequence dependencies and long-range temporal patterns.
3. **No real-time anomaly detection:** Dwell-time spikes and unusual delay patterns are not flagged in real-time (see [Medium: Bus Timing Anomalies](https://medium.com/@willyeahyeah/analyzing-bus-timing-anomalies-using-data-science-techniques-f8214a3d2d0e) for methodology).
4. **Limited to Madison Metro:** Generalization to other transit agencies requires GTFS-RT ingestion and agency-specific route/stop mappings.
5. **No mobile optimization:** UI is desktop-first; responsive design for mobile devices needed.

### Planned Enhancements

- **Transformer ETA Model:** Attention-based sequence model with stop embeddings and residual learning
- **Ablation Studies:** Quantify impact of topology features, temporal encodings, and API ETA context
- **Time-Expanded Isochrones:** Schedule-aware reachability using GTFS-based Dijkstra search
- **Anomaly Dashboard:** Flag unusual delays, route deviations, and dwell-time spikes
- **Hexbin/Choropleth Layers:** Replace CircleMarker heatmap with binned aggregations

---

## References

### Academic & Industry Resources

1. **Transformer-based ETA Prediction:** [Real-Time Bus Arrival Prediction using Transformers (arXiv:2303.15495)](https://arxiv.org/html/2303.15495v3)
2. **Schedule-Aware Network Analysis:** [ArcGIS Public Transit Network Analysis](https://pro.arcgis.com/en/pro-app/latest/help/analysis/networks/network-analysis-with-public-transit-data.htm)
3. **Geospatial Transit EDA:** [Kaggle: Geospatial Analysis of Bus Routes](https://www.kaggle.com/code/virajkadam/geospatial-analysis-of-bus-routes)
4. **Transit Data Analysis Best Practices:** [Kaggle: Bus Data Analysis](https://www.kaggle.com/code/siesptkgunggus/bus-data-analysis)
5. **Timing Anomaly Detection:** [Medium: Analyzing Bus Timing Anomalies](https://medium.com/@willyeahyeah/analyzing-bus-timing-anomalies-using-data-science-techniques-f8214a3d2d0e)
6. **Transit Operations Research:** [ScienceDirect: Transit Analytics](https://www.sciencedirect.com/science/article/pii/S2046043025000838)
7. **Exploratory Data Analysis:** [IBM EDA Primer](https://www.ibm.com/think/topics/exploratory-data-analysis), [R4DS: EDA Chapter](https://r4ds.had.co.nz/exploratory-data-analysis.html)

### Data Sources

- Madison Metro Transit Bustime API
- General Transit Feed Specification (GTFS)

---

## License

MIT License - see LICENSE file for details.

---

## Acknowledgments

Built as a graduate school portfolio project demonstrating applied data science, geospatial analysis, and ML engineering. Special thanks to:

- Madison Metro Transit for providing open API access
- Academic researchers cited above for methodological guidance
- Open-source communities (React, Scikit-learn, Leaflet, Recharts)

**For questions or collaboration:** Contact via GitHub issues.
