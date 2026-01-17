"""
Temporal Cross-Validation for Time Series ML Models

Standard cross-validation randomly shuffles data, which leaks future information
into training when dealing with time series. This module implements proper
time-aware cross-validation with expanding window approach.

Usage:
    from ml.training.temporal_cv import temporal_cross_validate
    
    scores = temporal_cross_validate(
        model=XGBRegressor(),
        X=features,
        y=target,
        timestamps=df['created_at'],
        n_splits=5
    )
"""

import logging
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Any, Optional
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, clone
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TimeSeriesCV:
    """
    Time Series Cross-Validator with expanding window.
    
    Unlike sklearn's TimeSeriesSplit which uses equal-sized folds,
    this uses a minimum training size and expands the training window
    with each fold while keeping a consistent test window size.
    
    Example with 100 days of data, n_splits=5, min_train_days=30, test_days=7:
        Fold 1: Train [0:30], Test [30:37]
        Fold 2: Train [0:44], Test [44:51]
        Fold 3: Train [0:58], Test [58:65]
        Fold 4: Train [0:72], Test [72:79]
        Fold 5: Train [0:86], Test [86:93]
    """
    
    def __init__(
        self,
        n_splits: int = 5,
        min_train_days: int = 7,
        test_days: int = 1,
        gap_hours: int = 0
    ):
        """
        Args:
            n_splits: Number of train/test splits
            min_train_days: Minimum days of training data
            test_days: Size of each test window in days
            gap_hours: Gap between train and test to simulate deployment delay
        """
        self.n_splits = n_splits
        self.min_train_days = min_train_days
        self.test_days = test_days
        self.gap_hours = gap_hours
    
    def split(self, timestamps: pd.Series):
        """
        Generate train/test indices for each fold.
        
        Args:
            timestamps: Series of timestamps for each sample
            
        Yields:
            (train_indices, test_indices) for each fold
        """
        timestamps = pd.to_datetime(timestamps).sort_values()
        min_time = timestamps.min()
        max_time = timestamps.max()
        total_days = (max_time - min_time).days
        
        if total_days < self.min_train_days + self.test_days:
            raise ValueError(
                f"Not enough data. Need {self.min_train_days + self.test_days} days, "
                f"have {total_days} days."
            )
        
        # Calculate fold boundaries
        available_for_folds = total_days - self.min_train_days - self.test_days
        step = max(1, available_for_folds // (self.n_splits - 1)) if self.n_splits > 1 else 0
        
        for fold in range(self.n_splits):
            # Training window expands
            train_end_day = self.min_train_days + (fold * step)
            train_end = min_time + timedelta(days=train_end_day)
            
            # Gap between train and test
            test_start = train_end + timedelta(hours=self.gap_hours)
            test_end = test_start + timedelta(days=self.test_days)
            
            # Convert to indices
            train_mask = timestamps < train_end
            test_mask = (timestamps >= test_start) & (timestamps < test_end)
            
            train_idx = np.where(train_mask)[0]
            test_idx = np.where(test_mask)[0]
            
            if len(train_idx) > 0 and len(test_idx) > 0:
                yield train_idx, test_idx


def temporal_cross_validate(
    model: BaseEstimator,
    X: np.ndarray,
    y: np.ndarray,
    timestamps: pd.Series,
    n_splits: int = 5,
    min_train_days: int = 7,
    test_days: int = 1,
    gap_hours: int = 0,
    verbose: bool = True
) -> Dict[str, Any]:
    """
    Perform temporal cross-validation with proper time-based splits.
    
    Args:
        model: sklearn-compatible estimator
        X: Feature matrix
        y: Target vector
        timestamps: Timestamp for each sample
        n_splits: Number of folds
        min_train_days: Minimum training window size
        test_days: Test window size
        gap_hours: Gap between train and test
        verbose: Print fold results
        
    Returns:
        Dict with:
            - 'mae_scores': List of MAE for each fold
            - 'rmse_scores': List of RMSE for each fold
            - 'r2_scores': List of R² for each fold
            - 'mean_mae': Mean MAE across folds
            - 'std_mae': Std of MAE across folds
            - 'fold_details': List of dicts with per-fold metrics
    """
    cv = TimeSeriesCV(
        n_splits=n_splits,
        min_train_days=min_train_days,
        test_days=test_days,
        gap_hours=gap_hours
    )
    
    mae_scores = []
    rmse_scores = []
    r2_scores = []
    fold_details = []
    
    for fold_idx, (train_idx, test_idx) in enumerate(cv.split(timestamps)):
        # Clone model for fresh training
        fold_model = clone(model)
        
        # Split data
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]
        
        # Train
        fold_model.fit(X_train, y_train)
        
        # Predict
        y_pred = fold_model.predict(X_test)
        
        # Evaluate
        mae = mean_absolute_error(y_test, y_pred)
        rmse = np.sqrt(mean_squared_error(y_test, y_pred))
        r2 = r2_score(y_test, y_pred)
        
        mae_scores.append(mae)
        rmse_scores.append(rmse)
        r2_scores.append(r2)
        
        fold_detail = {
            'fold': fold_idx + 1,
            'train_size': len(train_idx),
            'test_size': len(test_idx),
            'mae': mae,
            'rmse': rmse,
            'r2': r2,
            'train_start': timestamps.iloc[train_idx[0]].isoformat() if len(train_idx) > 0 else None,
            'train_end': timestamps.iloc[train_idx[-1]].isoformat() if len(train_idx) > 0 else None,
            'test_start': timestamps.iloc[test_idx[0]].isoformat() if len(test_idx) > 0 else None,
            'test_end': timestamps.iloc[test_idx[-1]].isoformat() if len(test_idx) > 0 else None
        }
        fold_details.append(fold_detail)
        
        if verbose:
            logger.info(
                f"Fold {fold_idx + 1}/{n_splits}: "
                f"Train={len(train_idx):,}, Test={len(test_idx):,}, "
                f"MAE={mae:.1f}s, RMSE={rmse:.1f}s, R²={r2:.3f}"
            )
    
    results = {
        'mae_scores': mae_scores,
        'rmse_scores': rmse_scores,
        'r2_scores': r2_scores,
        'mean_mae': np.mean(mae_scores),
        'std_mae': np.std(mae_scores),
        'mean_rmse': np.mean(rmse_scores),
        'std_rmse': np.std(rmse_scores),
        'mean_r2': np.mean(r2_scores),
        'std_r2': np.std(r2_scores),
        'fold_details': fold_details,
        'n_splits': n_splits
    }
    
    if verbose:
        logger.info("=" * 60)
        logger.info(
            f"CV Results: MAE={results['mean_mae']:.1f}s ± {results['std_mae']:.1f}s, "
            f"RMSE={results['mean_rmse']:.1f}s, R²={results['mean_r2']:.3f}"
        )
    
    return results


def train_with_temporal_cv(
    model: BaseEstimator,
    df: pd.DataFrame,
    feature_cols: List[str],
    target_col: str = 'error_seconds',
    timestamp_col: str = 'created_at',
    n_splits: int = 5,
    verbose: bool = True
) -> Tuple[BaseEstimator, Dict[str, Any]]:
    """
    Train a model using temporal cross-validation and return the final model
    trained on all data.
    
    Args:
        model: sklearn-compatible estimator
        df: DataFrame with features, target, and timestamps
        feature_cols: List of feature column names
        target_col: Target column name
        timestamp_col: Timestamp column name
        n_splits: Number of CV splits
        verbose: Print progress
        
    Returns:
        (trained_model, cv_results)
    """
    # Prepare data
    X = df[feature_cols].values
    y = df[target_col].values
    timestamps = df[timestamp_col]
    
    # Cross-validate
    cv_results = temporal_cross_validate(
        model=model,
        X=X,
        y=y,
        timestamps=timestamps,
        n_splits=n_splits,
        verbose=verbose
    )
    
    # Train final model on all data
    final_model = clone(model)
    final_model.fit(X, y)
    
    if verbose:
        logger.info(f"Final model trained on {len(X):,} samples")
    
    return final_model, cv_results


if __name__ == "__main__":
    # Example usage
    from xgboost import XGBRegressor
    import os
    from dotenv import load_dotenv
    load_dotenv()
    
    print("Testing temporal cross-validation...")
    
    # Create synthetic data
    np.random.seed(42)
    n_samples = 10000
    
    dates = pd.date_range('2026-01-01', periods=n_samples, freq='30min')
    X = np.random.randn(n_samples, 5)
    y = X[:, 0] * 30 + X[:, 1] * 20 + np.random.randn(n_samples) * 50
    
    # Test CV
    model = XGBRegressor(n_estimators=50, max_depth=4, random_state=42)
    
    results = temporal_cross_validate(
        model=model,
        X=X,
        y=y,
        timestamps=dates.to_series(),
        n_splits=5,
        min_train_days=3,
        test_days=1,
        verbose=True
    )
    
    print(f"\nFinal CV MAE: {results['mean_mae']:.1f} ± {results['std_mae']:.1f}")
