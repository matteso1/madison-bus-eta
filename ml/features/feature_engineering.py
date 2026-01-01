"""
Feature Engineering Module for Madison Bus ETA ML Pipeline.

Transforms raw vehicle observations into features for delay prediction.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timezone
from typing import Optional


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Transform raw vehicle observations into ML-ready features.
    
    Input columns expected:
        - vid: Vehicle ID
        - rt: Route
        - lat, lon: Position
        - hdg: Heading
        - dly: Delay flag (boolean)
        - tmstmp: API timestamp string
        - collected_at: Collection timestamp
    
    Output: DataFrame with engineered features + target column.
    """
    df = df.copy()
    
    # Parse timestamps
    df['collected_at'] = pd.to_datetime(df['collected_at'], utc=True)
    
    # ====== TEMPORAL FEATURES ======
    df['hour'] = df['collected_at'].dt.hour
    df['day_of_week'] = df['collected_at'].dt.dayofweek  # 0=Mon, 6=Sun
    df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)
    
    # Rush hour indicators
    df['is_morning_rush'] = df['hour'].between(7, 9).astype(int)
    df['is_evening_rush'] = df['hour'].between(16, 18).astype(int)
    df['is_rush_hour'] = (df['is_morning_rush'] | df['is_evening_rush']).astype(int)
    
    # Time of day buckets
    df['time_bucket'] = pd.cut(
        df['hour'],
        bins=[0, 6, 10, 14, 18, 22, 24],
        labels=['overnight', 'morning', 'midday', 'afternoon', 'evening', 'night'],
        include_lowest=True
    )
    
    # ====== ROUTE FEATURES ======
    # One-hot encode routes (will be done in training, store route as category)
    df['route_cat'] = df['rt'].astype('category')
    
    # Route frequency (how many observations per route in dataset)
    route_counts = df['rt'].value_counts().to_dict()
    df['route_frequency'] = df['rt'].map(route_counts)
    
    # ====== SPATIAL FEATURES ======
    # Normalize position (center around Madison downtown)
    MADISON_CENTER_LAT = 43.0731
    MADISON_CENTER_LON = -89.4012
    
    df['lat_offset'] = df['lat'] - MADISON_CENTER_LAT
    df['lon_offset'] = df['lon'] - MADISON_CENTER_LON
    df['distance_from_center'] = np.sqrt(df['lat_offset']**2 + df['lon_offset']**2)
    
    # Heading as sin/cos for circular nature
    df['hdg_sin'] = np.sin(np.radians(df['hdg']))
    df['hdg_cos'] = np.cos(np.radians(df['hdg']))
    
    # ====== HISTORICAL FEATURES ======
    # These would require aggregation from past data
    # For now, we compute route-level delay rate from training data
    route_delay_rate = df.groupby('rt')['dly'].mean().to_dict()
    df['route_avg_delay_rate'] = df['rt'].map(route_delay_rate)
    
    # Hour-route delay pattern
    hour_route_delay = df.groupby(['rt', 'hour'])['dly'].mean().to_dict()
    df['hr_route_delay_rate'] = df.apply(
        lambda x: hour_route_delay.get((x['rt'], x['hour']), 0), axis=1
    )
    
    # ====== TARGET ======
    df['is_delayed'] = df['dly'].astype(int)
    
    return df


def get_feature_columns() -> list:
    """Return list of feature column names for model training."""
    return [
        # Temporal
        'hour', 'day_of_week', 'is_weekend', 'is_rush_hour',
        'is_morning_rush', 'is_evening_rush',
        # Spatial
        'lat_offset', 'lon_offset', 'distance_from_center',
        'hdg_sin', 'hdg_cos',
        # Route
        'route_frequency',
        # Historical
        'route_avg_delay_rate', 'hr_route_delay_rate',
    ]


def get_target_column() -> str:
    """Return target column name."""
    return 'is_delayed'


def prepare_training_data(df: pd.DataFrame) -> tuple:
    """
    Prepare X (features) and y (target) for model training.
    
    Returns: (X, y) tuple of numpy arrays.
    """
    df_features = engineer_features(df)
    
    feature_cols = get_feature_columns()
    target_col = get_target_column()
    
    # Drop rows with missing features
    df_clean = df_features[feature_cols + [target_col]].dropna()
    
    X = df_clean[feature_cols].values
    y = df_clean[target_col].values
    
    return X, y, feature_cols
