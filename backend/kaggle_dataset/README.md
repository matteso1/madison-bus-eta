# Madison Metro Bus Arrival Time Predictions

Real-world bus arrival predictions with API baseline for ML improvement

## Overview

This dataset contains real-world bus arrival time predictions from Madison Metro Transit (Madison, WI) 
collected over 20 days. It includes both the transit agency's API predictions and actual arrival times,
making it ideal for time series forecasting, regression, and transportation ML applications.

**Key Features:**
- 200,000+ real-world predictions
- 22 bus routes across Madison, Wisconsin  
- 20 days of continuous data collection
- API baseline predictions included (can you beat 0.371 min MAE?)
- Temporal features (rush hour, weekday/weekend)
- Route and stop characteristics

**Use Cases:**
- Arrival time prediction (regression)
- Delay classification (binary classification)
- Time series forecasting
- Transportation analytics
- ML model benchmarking against real API

**Challenge:** Can you build a model that beats the Madison Metro API's predictions?
(Our XGBoost model achieved 21.3% improvement!)

## Dataset Statistics

- **Total Records:** 204,380
- **Routes:** 21
- **Stops:** 24
- **Vehicles:** 176
- **Collection Period:** 20 days
- **API Baseline MAE:** 0.370 minutes

## Files

- `madison_metro_predictions.csv` - Complete dataset
- `train.csv` - Training split (80% of data)
- `test.csv` - Test split (20% of data)
- `dataset-metadata.json` - Detailed metadata
- `README.md` - This file

## Column Descriptions

| Column | Description |
|--------|-------------|
| `timestamp` | Collection timestamp (ISO 8601 format) |
| `route` | Bus route identifier (e.g., 'A', 'B', '28', '38') |
| `stop_id` | Unique stop identifier |
| `stop_name` | Human-readable stop name |
| `vehicle_id` | Unique vehicle identifier |
| `destination` | Final destination of the bus |
| `direction` | Direction of travel (e.g., 'NORTHBOUND', 'SOUTHBOUND') |
| `predicted_arrival_time` | Time when bus was predicted to arrive (ISO 8601) |
| `api_timestamp` | Timestamp of the API's prediction |
| `api_predicted_minutes` | API's prediction of minutes until arrival |
| `actual_minutes_until_arrival` | Actual minutes until arrival (ground truth) |
| `api_error_minutes` | Absolute error of API prediction (target to beat!) |
| `is_delayed` | Whether bus was marked as delayed by API |
| `passenger_load` | Passenger load level (EMPTY, HALF_EMPTY, FULL) |
| `hour_of_day` | Hour of day (0-23) |
| `day_of_week` | Day of week (0=Monday, 6=Sunday) |
| `is_weekend` | Boolean: is it a weekend? |
| `is_rush_hour` | Boolean: is it rush hour (7-9 AM or 4-6 PM)? |


## Target Variable

**`actual_minutes_until_arrival`** - This is the ground truth value you want to predict.

## Baseline Challenge

The Madison Metro API provides predictions in `api_predicted_minutes`. Can you build a model that beats the API?

- **API Baseline MAE:** 0.370 minutes
- **API Median Error:** 0.330 minutes

**Our best model (XGBoost) achieved 0.292 minutes MAE - a 21.3% improvement!**

## Suggested Tasks

1. **Regression:** Predict `actual_minutes_until_arrival`
2. **Improvement:** Beat the API baseline (`api_predicted_minutes`)
3. **Classification:** Predict delays or passenger load levels
4. **Time Series:** Forecast arrival times for specific routes/stops
5. **Analysis:** Identify patterns in delays by time, route, or location

## Usage Example

```python
import pandas as pd

# Load data
df = pd.read_csv('madison_metro_predictions.csv')

# Basic statistics
print(f"Records: {len(df):,}")
print(f"Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")

# Calculate API performance
api_mae = df['api_error_minutes'].mean()
print(f"API MAE: {api_mae:.3f} minutes")

# Feature engineering
df['timestamp'] = pd.to_datetime(df['timestamp'])
df['hour'] = df['timestamp'].dt.hour
df['day_of_week'] = df['timestamp'].dt.dayofweek

# Your ML model here!
```

## License

This dataset is released under **CC0: Public Domain**. You are free to use it for any purpose.

## Source

Data collected from Madison Metro Transit System's public API (City of Madison, Wisconsin).

## Citation

If you use this dataset, please cite:

```
Madison Metro Bus Arrival Time Predictions Dataset
Version 1.0
Created: 2025-10-11
Source: Madison Metro Transit System
```

## Contact

For questions or issues, please open an issue on GitHub or contact the dataset creators.

---

**Challenge yourself:** Can you beat our 21.3% improvement over the API? Share your results! 🚀
