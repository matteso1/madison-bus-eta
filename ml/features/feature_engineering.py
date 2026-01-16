"""
Feature Engineering Module for Madison Bus ETA ML Pipeline.

Transforms raw vehicle observations into features for delay prediction.

NOTE: Historical features (route_avg_delay_rate, hr_route_delay_rate) must be
computed ONLY from training data to avoid data leakage. Use prepare_training_data()
which handles this correctly via train/test split before computing aggregates.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timezone
from typing import Optional, Dict, Tuple
from sklearn.model_selection import train_test_split


def engineer_base_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Transform raw vehicle observations into base ML features.
    
    NOTE: This does NOT include historical/aggregate features that depend on
    the target variable. Those are added separately to avoid data leakage.
    
    Input columns expected:
        - vid: Vehicle ID
        - rt: Route
        - lat, lon: Position
        - hdg: Heading
        - dly: Delay flag (boolean)
        - tmstmp: API timestamp string
        - collected_at: Collection timestamp
    
    Output: DataFrame with base engineered features + target column.
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
    df['route_cat'] = df['rt'].astype('category')
    
    # Route frequency (observation count - this is safe, doesn't use target)
    route_counts = df['rt'].value_counts().to_dict()
    df['route_frequency'] = df['rt'].map(route_counts)
    
    # ====== SPATIAL FEATURES ======
    MADISON_CENTER_LAT = 43.0731
    MADISON_CENTER_LON = -89.4012
    
    df['lat_offset'] = df['lat'] - MADISON_CENTER_LAT
    df['lon_offset'] = df['lon'] - MADISON_CENTER_LON
    df['distance_from_center'] = np.sqrt(df['lat_offset']**2 + df['lon_offset']**2)
    
    # Heading as sin/cos for circular nature
    df['hdg_sin'] = np.sin(np.radians(df['hdg']))
    df['hdg_cos'] = np.cos(np.radians(df['hdg']))
    
    # ====== TARGET ======
    df['is_delayed'] = df['dly'].astype(int)
    
    return df


def compute_historical_aggregates(train_df: pd.DataFrame) -> Dict[str, dict]:
    """
    Compute historical aggregate features from TRAINING DATA ONLY.
    
    This prevents data leakage by ensuring we don't use test set information
    when computing features like route-level delay rates.
    
    Args:
        train_df: Training DataFrame with 'rt', 'hour', and 'dly' columns
        
    Returns:
        Dictionary containing lookup tables for historical features
    """
    aggregates = {}
    
    # Route-level average delay rate (from training data only)
    aggregates['route_delay_rate'] = train_df.groupby('rt')['dly'].mean().to_dict()
    
    # Hour-route delay pattern (from training data only)
    aggregates['hour_route_delay'] = train_df.groupby(['rt', 'hour'])['dly'].mean().to_dict()
    
    # Global fallback for unseen routes/combinations
    aggregates['global_delay_rate'] = train_df['dly'].mean()
    
    return aggregates


def apply_historical_features(df: pd.DataFrame, aggregates: Dict[str, dict]) -> pd.DataFrame:
    """
    Apply pre-computed historical aggregates to a DataFrame.
    
    Args:
        df: DataFrame with 'rt' and 'hour' columns
        aggregates: Dictionary from compute_historical_aggregates()
        
    Returns:
        DataFrame with historical features added
    """
    df = df.copy()
    
    # Route average delay rate (with fallback)
    global_rate = aggregates.get('global_delay_rate', 0)
    route_delay = aggregates.get('route_delay_rate', {})
    df['route_avg_delay_rate'] = df['rt'].map(route_delay).fillna(global_rate)
    
    # Hour-route delay rate (with fallback)
    hour_route_delay = aggregates.get('hour_route_delay', {})
    df['hr_route_delay_rate'] = df.apply(
        lambda x: hour_route_delay.get((x['rt'], x['hour']), 
                  route_delay.get(x['rt'], global_rate)), axis=1
    )
    
    return df


# Keep legacy function name for backwards compatibility
def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    DEPRECATED: Use prepare_training_data() for proper train/test handling.
    
    This function has data leakage - historical features are computed from ALL data.
    Only use for inference on single samples where you provide external aggregates.
    """
    df = engineer_base_features(df)
    
    # WARNING: This causes data leakage in train/test scenarios!
    # Only use for backwards compatibility or single-sample inference
    route_delay_rate = df.groupby('rt')['dly'].mean().to_dict()
    df['route_avg_delay_rate'] = df['rt'].map(route_delay_rate)
    
    hour_route_delay = df.groupby(['rt', 'hour'])['dly'].mean().to_dict()
    df['hr_route_delay_rate'] = df.apply(
        lambda x: hour_route_delay.get((x['rt'], x['hour']), 0), axis=1
    )
    
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
        # Historical (computed from training data only)
        'route_avg_delay_rate', 'hr_route_delay_rate',
    ]


def get_target_column() -> str:
    """Return target column name."""
    return 'is_delayed'


def prepare_training_data(df: pd.DataFrame, test_size: float = 0.2, 
                          random_state: int = 42) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list]:
    """
    Prepare train/test splits for model training WITHOUT data leakage.
    
    This function properly handles the train/test split BEFORE computing
    historical aggregate features, ensuring no target leakage.
    
    Args:
        df: Raw DataFrame with vehicle observations
        test_size: Fraction of data to use for testing (default 0.2)
        random_state: Random seed for reproducibility
    
    Returns:
        (X_train, X_test, y_train, y_test, feature_cols) tuple
    """
    # Step 1: Apply base features (no target leakage)
    df_base = engineer_base_features(df)
    
    feature_cols = get_feature_columns()
    target_col = get_target_column()
    
    # Step 2: Split BEFORE computing historical features
    train_idx, test_idx = train_test_split(
        df_base.index, 
        test_size=test_size, 
        random_state=random_state,
        stratify=df_base['is_delayed']
    )
    
    train_df = df_base.loc[train_idx].copy()
    test_df = df_base.loc[test_idx].copy()
    
    # Step 3: Compute historical aggregates from TRAINING DATA ONLY
    aggregates = compute_historical_aggregates(train_df)
    
    # Step 4: Apply aggregates to both train and test
    train_df = apply_historical_features(train_df, aggregates)
    test_df = apply_historical_features(test_df, aggregates)
    
    # Step 5: Extract features and target
    train_clean = train_df[feature_cols + [target_col]].dropna()
    test_clean = test_df[feature_cols + [target_col]].dropna()
    
    X_train = train_clean[feature_cols].values
    y_train = train_clean[target_col].values
    X_test = test_clean[feature_cols].values
    y_test = test_clean[target_col].values
    
    return X_train, X_test, y_train, y_test, feature_cols
