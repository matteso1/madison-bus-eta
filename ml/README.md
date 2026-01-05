# Madison Bus ETA - ML Pipeline

This directory contains the machine learning pipeline for **ETA error prediction**.

## What We Predict

The Madison Metro API provides arrival predictions (`prdctdn`). Our model predicts **how wrong those predictions will be**:

```
error_seconds = actual_arrival_time - api_predicted_arrival_time
```

- Positive error = bus arrived late
- Negative error = bus arrived early

## Directory Structure

```
ml/
├── features/
│   ├── feature_engineering.py   # Legacy classification features
│   └── regression_features.py   # ETA error regression features
├── training/
│   ├── train.py                 # Legacy classification training
│   └── train_regression.py      # ETA error regression training
├── models/
│   ├── model_registry.py        # Model versioning and persistence
│   └── saved/                   # Saved model files
└── README.md
```

## Quick Start

1. **Ensure ground truth is being collected:**
   The collector must be running with arrival detection enabled.

2. **Run regression training:**

   ```bash
   export DATABASE_URL="postgresql://..."
   python ml/training/train_regression.py
   ```

## Features Used

| Category | Features |
|----------|----------|
| Temporal | hour, day_of_week, is_weekend, is_rush_hour |
| Route | route_frequency, route_encoded |
| Historical | route_avg_error, hr_route_error |

## Model

- **Algorithm:** XGBoost Regressor
- **Target:** `error_seconds` (continuous)
- **Metrics:** MAE (seconds), RMSE, Improvement vs baseline
