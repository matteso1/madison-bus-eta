# Madison Bus ETA - ML Pipeline

This directory contains the machine learning pipeline for **ETA error prediction**.

## Current Performance (January 2026)

| Metric | Value |
|--------|-------|
| **Model MAE** | **57s** (0.95 min) |
| **API Baseline MAE** | 153s (2.55 min) |
| **Improvement** | **27.6%** over API |
| **Training Data** | ~40K predictions |

## What We Predict

The Madison Metro API provides arrival predictions (`prdctdn`). Our model predicts **how wrong those predictions will be**:

```
error_seconds = actual_arrival_time - api_predicted_arrival_time
```

- Positive error = bus arrived late
- Negative error = bus arrived early

## Features

### Key Insight: Prediction Horizon Matters Most

The single most important feature is **how far away the prediction is**. A "5 min away" prediction naturally has less error than "20 min away".

| Category | Features |
|----------|----------|
| **Horizon** | horizon_min, horizon_squared, horizon_bucket |
| Temporal | hour_sin/cos, day_sin/cos, is_rush_hour |
| Route | route_frequency, route_encoded |
| Historical | route_avg_error, hr_route_error |

## Directory Structure

```
ml/
├── features/
│   └── regression_features.py   # Feature engineering
├── training/
│   ├── train_regression.py      # Point estimate training
│   └── train_quantile_regression.py  # Confidence intervals
├── models/
│   └── saved/
│       ├── registry.json        # Model version registry
│       ├── model_YYYYMMDD.pkl   # Point estimate model
│       └── quantile_latest.pkl  # Quantile ensemble (80% CI)
└── README.md
```

## Quantile Regression (Confidence Intervals)

Instead of just predicting a single number, we train 3 models:

- **10th percentile** (best case)
- **50th percentile** (median prediction)
- **90th percentile** (worst case)

This gives riders: *"Bus will arrive in 8-12 minutes (80% confidence)"*

## Quick Start

```bash
export DATABASE_URL="postgresql://..."

# Train point estimate model
python ml/training/train_regression.py

# Train quantile models for confidence intervals
python ml/training/train_quantile_regression.py
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/predict-arrival` | Original point estimate |
| `POST /api/predict-arrival-v2` | **New!** Confidence intervals |
| `GET /api/model-performance` | Training history + metrics |

## Autonomous Retraining

GitHub Actions runs nightly at 3 AM CST:

```yaml
# .github/workflows/nightly-training.yml
on:
  schedule:
    - cron: '0 9 * * *'  # 9 AM UTC = 3 AM CST
```

## Model

- **Algorithm:** XGBoost Regressor / GradientBoostingRegressor
- **Target:** `error_seconds` (continuous)
- **Metrics:** MAE, RMSE, Improvement vs baseline
