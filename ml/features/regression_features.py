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
    - temporal features: hour, day_of_week, etc.
    - route features: rt
    """
    import os
    from sqlalchemy import create_engine, text
    from datetime import timedelta
    
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        raise ValueError("DATABASE_URL not set")
    
    engine = create_engine(database_url, pool_pre_ping=True)
    
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    
    query = """
        SELECT 
            po.vid,
            po.rt,
            po.stpid,
            po.predicted_arrival,
            po.actual_arrival,
            po.error_seconds,
            po.is_significantly_late,
            po.created_at
        FROM prediction_outcomes po
        WHERE po.created_at > :cutoff
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
    
    # ====== TEMPORAL FEATURES (based on predicted arrival time) ======
    df['hour'] = df['predicted_arrival'].dt.hour
    df['day_of_week'] = df['predicted_arrival'].dt.dayofweek  # 0=Mon, 6=Sun
    df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)
    
    # Rush hour indicators
    df['is_morning_rush'] = df['hour'].between(7, 9).astype(int)
    df['is_evening_rush'] = df['hour'].between(16, 18).astype(int)
    df['is_rush_hour'] = (df['is_morning_rush'] | df['is_evening_rush']).astype(int)
    
    # ====== ROUTE FEATURES ======
    # Route frequency (number of observations - does not leak target)
    route_counts = df['rt'].value_counts().to_dict()
    df['route_frequency'] = df['rt'].map(route_counts)
    
    # Route as categorical encoding (for XGBoost)
    df['route_encoded'] = df['rt'].astype('category').cat.codes
    
    return df


def compute_historical_eta_aggregates(train_df: pd.DataFrame) -> Dict[str, dict]:
    """
    Compute historical ETA error aggregates from TRAINING DATA ONLY.
    
    These replace the old delay_rate features with meaningful ETA error patterns.
    """
    aggregates = {}
    
    # Route-level average ETA error (in seconds)
    aggregates['route_avg_error'] = train_df.groupby('rt')['error_seconds'].mean().to_dict()
    
    # Hour-route average error
    aggregates['hour_route_error'] = train_df.groupby(['rt', 'hour'])['error_seconds'].mean().to_dict()
    
    # Global fallback
    aggregates['global_avg_error'] = train_df['error_seconds'].mean()
    
    return aggregates


def apply_historical_eta_features(df: pd.DataFrame, aggregates: Dict[str, dict]) -> pd.DataFrame:
    """Apply pre-computed historical ETA aggregates to a DataFrame."""
    df = df.copy()
    
    global_error = aggregates.get('global_avg_error', 0)
    route_error = aggregates.get('route_avg_error', {})
    hour_route_error = aggregates.get('hour_route_error', {})
    
    # Route average ETA error (with fallback)
    df['route_avg_error'] = df['rt'].map(route_error).fillna(global_error)
    
    # Hour-route ETA error (with fallback)
    df['hr_route_error'] = df.apply(
        lambda x: hour_route_error.get((x['rt'], x['hour']), 
                  route_error.get(x['rt'], global_error)), axis=1
    )
    
    return df


def get_regression_feature_columns() -> list:
    """Return list of feature columns for regression model."""
    return [
        # Temporal
        'hour', 'day_of_week', 'is_weekend', 'is_rush_hour',
        'is_morning_rush', 'is_evening_rush',
        # Route
        'route_frequency', 'route_encoded',
        # Historical ETA patterns (from training data only, no leakage)
        'route_avg_error', 'hr_route_error',
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
