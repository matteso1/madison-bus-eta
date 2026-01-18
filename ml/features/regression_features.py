"""
Feature Engineering for ETA Error Regression.

This module prepares training data from prediction_outcomes to predict
how wrong the API's ETA predictions will be.

Target variable: error_seconds (actual_arrival - predicted_arrival)
"""

import pandas as pd
import numpy as np
from datetime import datetime, timezone
from typing import Tuple, Dict
from sklearn.model_selection import train_test_split


def fetch_regression_training_data(days: int = 7) -> pd.DataFrame:
    """
    Fetch prediction outcomes from database for regression training.

    Returns DataFrame with:
    - error_seconds: target variable
    - prediction_horizon_min: the API's predicted minutes until arrival (CRITICAL FEATURE)
    - temporal features: hour, day_of_week, etc.
    - route features: rt
    - weather features (if available)
    """
    import os
    from sqlalchemy import create_engine, text
    from datetime import timedelta

    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        raise ValueError("DATABASE_URL not set")

    engine = create_engine(database_url, pool_pre_ping=True)

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Check if weather_observations table exists
    with engine.connect() as conn:
        weather_table_exists = conn.execute(
            text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'weather_observations')")
        ).scalar()

    if weather_table_exists:
        # Full query with weather data AND velocity data
        query = """
            SELECT
                po.vid,
                po.rt,
                po.stpid,
                po.predicted_arrival,
                po.actual_arrival,
                po.error_seconds,
                po.is_significantly_late,
                po.created_at,
                COALESCE(p.prdctdn, 10) as prediction_horizon_min,
                -- Weather features (join to nearest weather observation)
                w.temp_celsius,
                w.precipitation_1h_mm,
                w.snow_1h_mm,
                w.wind_speed_mps,
                w.visibility_meters,
                w.is_severe as is_severe_weather,
                -- Velocity features (disabled temporarily - expensive query)
                -- TODO: Add index on vehicle_observations(vid, collected_at) then re-enable
                NULL::float as avg_speed,
                NULL::float as speed_stddev,
                0 as velocity_samples
            FROM prediction_outcomes po
            LEFT JOIN predictions p ON po.prediction_id = p.id
            LEFT JOIN LATERAL (
                SELECT temp_celsius, precipitation_1h_mm, snow_1h_mm,
                       wind_speed_mps, visibility_meters, is_severe
                FROM weather_observations
                WHERE observed_at <= po.created_at
                ORDER BY observed_at DESC
                LIMIT 1
            ) w ON true
            WHERE po.created_at > :cutoff
            AND ABS(po.error_seconds) < 1200  -- Filter extreme outliers (>20 min)
            ORDER BY po.created_at
        """
    else:
        # Query without weather data (table doesn't exist yet)
        query = """
            SELECT
                po.vid,
                po.rt,
                po.stpid,
                po.predicted_arrival,
                po.actual_arrival,
                po.error_seconds,
                po.is_significantly_late,
                po.created_at,
                COALESCE(p.prdctdn, 10) as prediction_horizon_min,
                -- Weather columns as NULL (table not available)
                NULL::float as temp_celsius,
                NULL::float as precipitation_1h_mm,
                NULL::float as snow_1h_mm,
                NULL::float as wind_speed_mps,
                NULL::float as visibility_meters,
                NULL::boolean as is_severe_weather,
                -- Velocity features (disabled temporarily - need index first)
                NULL::float as avg_speed,
                NULL::float as speed_stddev,
                0 as velocity_samples
            FROM prediction_outcomes po
            LEFT JOIN predictions p ON po.prediction_id = p.id
            WHERE po.created_at > :cutoff
            AND ABS(po.error_seconds) < 1200  -- Filter extreme outliers (>20 min)
            ORDER BY po.created_at
        """

    with engine.connect() as conn:
        df = pd.read_sql(text(query), conn, params={"cutoff": cutoff})

    return df


def engineer_regression_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Engineer features for ETA error regression.
    
    These features do NOT include any target-leaked features like delay rates.
    """
    df = df.copy()
    
    # Parse timestamps
    df['predicted_arrival'] = pd.to_datetime(df['predicted_arrival'], utc=True)
    df['actual_arrival'] = pd.to_datetime(df['actual_arrival'], utc=True)
    
    # ====== TEMPORAL FEATURES (Cyclical) ======
    df['hour'] = df['predicted_arrival'].dt.hour
    df['day_of_week'] = df['predicted_arrival'].dt.dayofweek
    df['month'] = df['predicted_arrival'].dt.month
    
    # Cyclical encoding for hour (0-23)
    df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
    df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
    
    # Cyclical encoding for day (0-6)
    df['day_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7)
    df['day_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7)

    # Cyclical encoding for month (1-12)
    df['month_sin'] = np.sin(2 * np.pi * (df['month'] - 1) / 12)
    df['month_cos'] = np.cos(2 * np.pi * (df['month'] - 1) / 12)
    
    df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)
    
    # Rush hour indicators
    df['is_morning_rush'] = df['hour'].between(7, 9).astype(int)
    df['is_evening_rush'] = df['hour'].between(16, 18).astype(int)
    df['is_rush_hour'] = (df['is_morning_rush'] | df['is_evening_rush']).astype(int)

    # ====== SPECIAL EVENTS (Holidays) ======
    import holidays
    us_holidays = holidays.US(years=df['predicted_arrival'].dt.year.unique())
    df['is_holiday'] = df['predicted_arrival'].dt.date.apply(lambda x: 1 if x in us_holidays else 0)
    
    # ====== CONSTRAINT FEATURES ======
    # The API's own prediction is a strong constraint baseline
    # We first ensure predicted_arrival is valid
    current_time = pd.Timestamp.now(tz=timezone.utc)
    # Calculate minutes until predicted arrival (from record creation)
    # Note: 'created_at' in prediction_outcomes is when the prediction was MADE
    if 'created_at' in df.columns:
        df['created_at'] = pd.to_datetime(df['created_at'], utc=True)
        # Predicted duration in minutes (the API's estimate)
        df['predicted_minutes'] = (df['predicted_arrival'] - df['created_at']).dt.total_seconds() / 60
        # Clip to reasonable range (0 to 60 mins) to avoid outliers
        df['predicted_minutes'] = df['predicted_minutes'].clip(0, 90)
    else:
        df['predicted_minutes'] = 0.0
    
    # ====== ROUTE FEATURES ======
    # Route frequency (number of observations - does not leak target)
    route_counts = df['rt'].value_counts().to_dict()
    df['route_frequency'] = df['rt'].map(route_counts)
    
    # Route as categorical encoding (for XGBoost)
    df['route_encoded'] = df['rt'].astype('category').cat.codes
    
    # ====== PREDICTION HORIZON FEATURES (THE MOST IMPORTANT) ======
    # Longer predictions naturally have more error - this is the key insight
    if 'prediction_horizon_min' in df.columns:
        df['horizon_min'] = df['prediction_horizon_min'].fillna(10).clip(0, 60)
        
        # Squared term captures non-linear relationship (error grows faster at longer horizons)
        df['horizon_squared'] = df['horizon_min'] ** 2
        
        # Bucket for categorical effects
        df['horizon_bucket'] = pd.cut(
            df['horizon_min'], 
            bins=[0, 2, 5, 10, 20, np.inf],
            labels=[0, 1, 2, 3, 4]  # 0-2, 2-5, 5-10, 10-20, 20+
        ).astype(float).fillna(2)  # Default to middle bucket
    else:
        # Fallback if horizon not available (shouldn't happen with new data)
        df['horizon_min'] = 10.0
        df['horizon_squared'] = 100.0
        df['horizon_bucket'] = 2.0
    
    # ====== WEATHER FEATURES ======
    # Weather has significant impact on bus delays (rain, snow, visibility)
    if 'temp_celsius' in df.columns:
        # Temperature (normalized around comfortable temp)
        df['temp_celsius'] = df['temp_celsius'].fillna(10.0)  # Default to mild temp
        df['is_cold'] = (df['temp_celsius'] < -5).astype(int)  # Very cold
        df['is_hot'] = (df['temp_celsius'] > 30).astype(int)   # Very hot
        
        # Precipitation (rain/snow causes delays)
        df['precipitation_mm'] = df['precipitation_1h_mm'].fillna(0)
        df['snow_mm'] = df['snow_1h_mm'].fillna(0)
        df['is_raining'] = (df['precipitation_mm'] > 0.1).astype(int)
        df['is_snowing'] = (df['snow_mm'] > 0.1).astype(int)
        df['is_precipitating'] = ((df['precipitation_mm'] > 0.1) | (df['snow_mm'] > 0.1)).astype(int)
        
        # Wind (strong wind can delay buses)
        df['wind_speed'] = df['wind_speed_mps'].fillna(0)
        df['is_windy'] = (df['wind_speed'] > 10).astype(int)  # >10 m/s is strong wind
        
        # Visibility
        df['visibility_km'] = df['visibility_meters'].fillna(10000) / 1000
        df['low_visibility'] = (df['visibility_km'] < 1).astype(int)  # <1km is low
        
        # Severe weather flag
        df['is_severe_weather'] = df['is_severe_weather'].fillna(False).astype(int)
    else:
        # Fallback if weather data not available yet
        df['temp_celsius'] = 10.0
        df['is_cold'] = 0
        df['is_hot'] = 0
        df['precipitation_mm'] = 0.0
        df['snow_mm'] = 0.0
        df['is_raining'] = 0
        df['is_snowing'] = 0
        df['is_precipitating'] = 0
        df['wind_speed'] = 0.0
        df['is_windy'] = 0
        df['visibility_km'] = 10.0
        df['low_visibility'] = 0
        df['is_severe_weather'] = 0
    
    # ====== VELOCITY FEATURES (from GPS speed data) ======
    # Bus speed at prediction time is a strong indicator of traffic conditions
    if 'avg_speed' in df.columns:
        # Average speed in mph (API reports speed)
        df['avg_speed'] = df['avg_speed'].fillna(15)  # Default to ~15 mph if no data
        
        # Speed variability (high = stop-and-go traffic)
        df['speed_stddev'] = df['speed_stddev'].fillna(0)
        df['speed_variability'] = df['speed_stddev'] / (df['avg_speed'] + 0.1)  # Coefficient of variation
        
        # Binary indicators
        df['is_stopped'] = (df['avg_speed'] < 2).astype(int)  # Bus is stopped or crawling
        df['is_slow'] = (df['avg_speed'] < 10).astype(int)    # Slow traffic
        df['is_moving_fast'] = (df['avg_speed'] > 25).astype(int)  # Moving quickly
        
        # Velocity samples (more samples = more confidence)
        df['velocity_samples'] = df['velocity_samples'].fillna(0) if 'velocity_samples' in df.columns else 0
        df['has_velocity_data'] = (df['velocity_samples'] > 0).astype(int)
    else:
        # Fallback if velocity data not available
        df['avg_speed'] = 15.0
        df['speed_stddev'] = 5.0
        df['speed_variability'] = 0.33
        df['is_stopped'] = 0
        df['is_slow'] = 0
        df['is_moving_fast'] = 0
        df['velocity_samples'] = 0
        df['has_velocity_data'] = 0
    
    return df


def compute_historical_eta_aggregates(train_df: pd.DataFrame) -> Dict[str, dict]:
    """
    Compute historical ETA error aggregates from TRAINING DATA ONLY.

    These features capture patterns without leaking future information.
    """
    aggregates = {}

    # Route-level average ETA error (in seconds)
    aggregates['route_avg_error'] = train_df.groupby('rt')['error_seconds'].mean().to_dict()

    # Route-level error standard deviation (volatility)
    aggregates['route_error_std'] = train_df.groupby('rt')['error_seconds'].std().to_dict()

    # Hour-route average error
    aggregates['hour_route_error'] = train_df.groupby(['rt', 'hour'])['error_seconds'].mean().to_dict()

    # Stop-level reliability (average error by stop)
    if 'stpid' in train_df.columns:
        aggregates['stop_avg_error'] = train_df.groupby('stpid')['error_seconds'].mean().to_dict()
        aggregates['stop_error_std'] = train_df.groupby('stpid')['error_seconds'].std().to_dict()

    # Horizon bucket reliability (how reliable are predictions at each horizon?)
    if 'horizon_min' in train_df.columns:
        # Create temp buckets for aggregation
        train_df_temp = train_df.copy()
        train_df_temp['_horizon_bucket'] = pd.cut(
            train_df_temp['horizon_min'].fillna(10),
            bins=[0, 2, 5, 10, 20, 60],
            labels=['0-2', '2-5', '5-10', '10-20', '20+']
        )
        aggregates['horizon_bucket_error'] = train_df_temp.groupby('_horizon_bucket')['error_seconds'].mean().to_dict()

    # Global fallback
    aggregates['global_avg_error'] = train_df['error_seconds'].mean()
    aggregates['global_error_std'] = train_df['error_seconds'].std()

    return aggregates


def apply_historical_eta_features(df: pd.DataFrame, aggregates: Dict[str, dict]) -> pd.DataFrame:
    """Apply pre-computed historical ETA aggregates to a DataFrame."""
    df = df.copy()

    global_error = aggregates.get('global_avg_error', 0)
    global_std = aggregates.get('global_error_std', 60)
    route_error = aggregates.get('route_avg_error', {})
    route_std = aggregates.get('route_error_std', {})
    hour_route_error = aggregates.get('hour_route_error', {})
    stop_error = aggregates.get('stop_avg_error', {})
    stop_std = aggregates.get('stop_error_std', {})

    # Route average ETA error (with fallback)
    df['route_avg_error'] = df['rt'].map(route_error).fillna(global_error)

    # Route error volatility (high = unpredictable route)
    df['route_error_std'] = df['rt'].map(route_std).fillna(global_std)

    # Hour-route ETA error (with fallback)
    df['hr_route_error'] = df.apply(
        lambda x: hour_route_error.get((x['rt'], x['hour']),
                  route_error.get(x['rt'], global_error)), axis=1
    )

    # Stop-level reliability (some stops are harder to predict)
    if 'stpid' in df.columns and stop_error:
        df['stop_avg_error'] = df['stpid'].map(stop_error).fillna(global_error)
        df['stop_error_std'] = df['stpid'].map(stop_std).fillna(global_std)
    else:
        df['stop_avg_error'] = global_error
        df['stop_error_std'] = global_std

    return df


def get_regression_feature_columns() -> list:
    """Return list of feature columns for regression model."""
    return [
        # ====== PREDICTION HORIZON (MOST IMPORTANT) ======
        'horizon_min',           # Raw horizon in minutes
        'horizon_squared',       # Quadratic term for non-linearity
        'horizon_bucket',        # Categorical bucket

        # Temporal Cyclical
        'hour_sin', 'hour_cos',
        'day_sin', 'day_cos',
        'month_sin', 'month_cos',

        # Temporal Flags
        'is_weekend', 'is_rush_hour', 'is_holiday',
        'is_morning_rush', 'is_evening_rush',

        # Route
        'route_frequency', 'route_encoded',

        # Constraint (The API's own estimate)
        'predicted_minutes',

        # Historical ETA patterns (from training data only, no leakage)
        'route_avg_error',       # Route average error
        'route_error_std',       # Route error volatility
        'hr_route_error',        # Hour + route error

        # Stop-level reliability (NEW - high impact expected)
        'stop_avg_error',        # Stop average error
        'stop_error_std',        # Stop error volatility

        # ====== WEATHER FEATURES ======
        'temp_celsius',          # Temperature in Celsius
        'is_cold',               # Binary: < -5C
        'is_hot',                # Binary: > 30C
        'precipitation_mm',      # Rain in mm/hour
        'snow_mm',               # Snow in mm/hour
        'is_raining',            # Binary: rain > 0.1mm
        'is_snowing',            # Binary: snow > 0.1mm
        'is_precipitating',      # Binary: any precipitation
        'wind_speed',            # Wind speed m/s
        'is_windy',              # Binary: > 10 m/s
        'visibility_km',         # Visibility in km
        'low_visibility',        # Binary: < 1km
        'is_severe_weather',     # Binary: severe weather alert

        # ====== VELOCITY FEATURES (NEW - from GPS speed data) ======
        'avg_speed',             # Average speed in mph
        'speed_stddev',          # Speed standard deviation
        'speed_variability',     # Coefficient of variation (high = stop-and-go)
        'is_stopped',            # Binary: speed < 2 mph
        'is_slow',               # Binary: speed < 10 mph
        'is_moving_fast',        # Binary: speed > 25 mph
        'has_velocity_data',     # Binary: has GPS speed data
    ]


def get_regression_target_column() -> str:
    """Return target column for regression."""
    return 'error_seconds'


def prepare_regression_training_data(
    df: pd.DataFrame, 
    test_size: float = 0.2, 
    random_state: int = 42
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list]:
    """
    Prepare train/test splits for regression model training.
    
    Args:
        df: DataFrame from fetch_regression_training_data()
        test_size: Fraction for test set
        random_state: Random seed
    
    Returns:
        (X_train, X_test, y_train, y_test, feature_cols)
    """
    # Step 1: Apply base features
    df_base = engineer_regression_features(df)
    
    feature_cols = get_regression_feature_columns()
    target_col = get_regression_target_column()
    
    # Step 2: Split before computing historical features
    train_idx, test_idx = train_test_split(
        df_base.index,
        test_size=test_size,
        random_state=random_state
    )
    
    train_df = df_base.loc[train_idx].copy()
    test_df = df_base.loc[test_idx].copy()
    
    # Step 3: Compute historical aggregates from TRAINING DATA ONLY
    aggregates = compute_historical_eta_aggregates(train_df)
    
    # Step 4: Apply aggregates to both sets
    train_df = apply_historical_eta_features(train_df, aggregates)
    test_df = apply_historical_eta_features(test_df, aggregates)
    
    # Step 5: Extract features and target
    train_clean = train_df[feature_cols + [target_col]].dropna()
    test_clean = test_df[feature_cols + [target_col]].dropna()
    
    X_train = train_clean[feature_cols].values
    y_train = train_clean[target_col].values
    X_test = test_clean[feature_cols].values
    y_test = test_clean[target_col].values
    
    return X_train, X_test, y_train, y_test, feature_cols
