# Madison Bus ETA - ML Pipeline

This directory contains the machine learning pipeline for bus delay prediction.

## Directory Structure

```
ml/
├── features/
│   └── feature_engineering.py   # Feature extraction from raw data
├── training/
│   └── train.py                 # Training script
├── models/
│   ├── model_registry.py        # Model versioning and persistence
│   └── saved/                   # Saved model files
└── README.md
```

## Quick Start

1. **Install dependencies:**

   ```bash
   pip install xgboost scikit-learn pandas numpy sqlalchemy psycopg2-binary
   ```

2. **Set environment variable:**

   ```bash
   export DATABASE_URL="postgresql://..."
   ```

3. **Run training:**

   ```bash
   python ml/training/train.py
   ```

## Features Used

| Category | Features |
|----------|----------|
| Temporal | hour, day_of_week, is_weekend, is_rush_hour |
| Spatial | lat_offset, lon_offset, distance_from_center, hdg_sin, hdg_cos |
| Route | route_frequency |
| Historical | route_avg_delay_rate, hr_route_delay_rate |

## Model

- **Algorithm:** XGBoost Classifier
- **Target:** `is_delayed` (binary: 0/1)
- **Metrics:** Accuracy, Precision, Recall, F1 Score
