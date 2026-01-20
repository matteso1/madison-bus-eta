"""
Quantile Regression Training for Madison Bus ETA.

Instead of predicting a single number, this trains models to predict
the 10th, 50th (median), and 90th percentile of error.

Output: "The bus will arrive in 8-12 minutes (80% confidence)"
"""

import os
import sys
import logging
import pickle
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.metrics import mean_absolute_error

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'collector'))

from features.regression_features import (
    fetch_regression_training_data,
    prepare_regression_training_data,
    get_regression_feature_columns
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')
logger = logging.getLogger(__name__)


def train_quantile_models(X_train: np.ndarray, X_test: np.ndarray,
                          y_train: np.ndarray, y_test: np.ndarray,
                          feature_names: list,
                          quantiles: list = [0.1, 0.5, 0.9]) -> dict:
    """
    Train quantile regressors for each percentile.
    
    Uses sklearn GradientBoostingRegressor with quantile loss.
    
    quantiles: list of quantiles to predict (default: 10th, 50th, 90th percentile)
    
    Returns dict with models and metrics.
    """
    from sklearn.ensemble import GradientBoostingRegressor
    
    logger.info(f"Training {len(quantiles)} quantile models: {quantiles}")
    logger.info(f"Training set: {len(X_train)}, Test set: {len(X_test)}")
    
    models = {}
    predictions = {}
    
    for q in quantiles:
        logger.info(f"Training quantile {q:.0%}...")
        
        # Sklearn GradientBoostingRegressor with quantile loss
        model = GradientBoostingRegressor(
            n_estimators=150,
            max_depth=5,
            learning_rate=0.1,
            subsample=0.8,
            loss='quantile',
            alpha=q,  # The quantile to predict
            random_state=42,
            n_iter_no_change=10,
            validation_fraction=0.1
        )
        
        model.fit(X_train, y_train)
        models[q] = model
        predictions[q] = model.predict(X_test)
        
        # Log quantile-specific metrics
        coverage = np.mean(y_test <= predictions[q])
        logger.info(f"  Q{q:.0%} - Predicted coverage: {coverage:.1%} (target: {q:.0%})")
    
    # Compute interval metrics
    y_pred_low = predictions[quantiles[0]]  # 10th percentile
    y_pred_median = predictions[0.5] if 0.5 in predictions else predictions[quantiles[len(quantiles)//2]]
    y_pred_high = predictions[quantiles[-1]]  # 90th percentile
    
    # Interval width (how precise are our predictions?)
    interval_width = np.mean(y_pred_high - y_pred_low)
    
    # Coverage: what % of actual values fall within the interval?
    in_interval = (y_test >= y_pred_low) & (y_test <= y_pred_high)
    coverage = np.mean(in_interval)
    
    # MAE of median predictions
    mae_median = mean_absolute_error(y_test, y_pred_median)
    
    metrics = {
        'quantiles': quantiles,
        'coverage': coverage,  # Should be ~80% for [0.1, 0.9] interval
        'coverage_target': quantiles[-1] - quantiles[0],  # 0.8 for [0.1, 0.9]
        'interval_width_mean': interval_width,
        'interval_width_minutes': interval_width / 60,
        'mae_median': mae_median,
        'mae_median_minutes': mae_median / 60,
        'train_samples': len(X_train),
        'test_samples': len(X_test),
    }
    
    logger.info(f"\n=== QUANTILE REGRESSION RESULTS ===")
    logger.info(f"Coverage: {coverage:.1%} (target: {metrics['coverage_target']:.0%})")
    logger.info(f"Interval Width: {interval_width:.0f}s ({interval_width/60:.1f} min)")
    logger.info(f"MAE (median): {mae_median:.1f}s ({mae_median/60:.2f} min)")
    
    return {'models': models, 'metrics': metrics, 'feature_names': feature_names}


def save_quantile_models(result: dict, output_dir: Path = None) -> Path:
    """Save the quantile model ensemble."""
    if output_dir is None:
        output_dir = Path(__file__).parent.parent / 'models' / 'saved'
    output_dir.mkdir(parents=True, exist_ok=True)
    
    version = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    filename = f"quantile_model_{version}.pkl"
    filepath = output_dir / filename
    
    # Save all models in a single pickle
    ensemble = {
        'models': result['models'],  # Dict of {quantile: model}
        'metrics': result['metrics'],
        'feature_names': result['feature_names'],
        'version': version,
        'created_at': datetime.now(timezone.utc).isoformat()
    }
    
    with open(filepath, 'wb') as f:
        pickle.dump(ensemble, f)
    
    logger.info(f"Saved quantile ensemble to {filepath}")
    
    # Also update a symlink or registry entry
    latest_path = output_dir / 'quantile_latest.pkl'
    if latest_path.exists():
        latest_path.unlink()
    
    # On Windows, we can't use symlinks easily, so copy
    import shutil
    shutil.copy(filepath, latest_path)
    
    return filepath


def main():
    """Main quantile training pipeline."""
    logger.info("=" * 60)
    logger.info("QUANTILE REGRESSION TRAINING PIPELINE")
    logger.info("=" * 60)
    
    days = 14  # Use more data for quantile estimates
    
    # Step 1: Fetch data
    logger.info("Step 1: Fetching prediction outcomes data...")
    try:
        df = fetch_regression_training_data(days=days)
    except Exception as e:
        logger.error(f"Failed to fetch data: {e}")
        return False
    
    if len(df) < 500:
        logger.warning(f"Not enough data ({len(df)} records)")
        return False
    
    logger.info(f"Fetched {len(df)} records from last {days} days")
    
    # Step 2: Feature engineering with temporal split
    logger.info("Step 2: Engineering features with temporal split...")
    try:
        X_train, X_test, y_train, y_test, feature_names, split_info = prepare_regression_training_data(
            df,
            test_days=3,  # Use 3 days for quantile (more test data)
            use_temporal_split=True
        )
        logger.info(f"Split: {split_info.get('split_type', 'unknown')}")
    except Exception as e:
        logger.error(f"Feature engineering failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # Step 3: Train quantile models
    logger.info("Step 3: Training quantile models...")
    try:
        # Train 10th, 50th, 90th percentile for 80% prediction interval
        result = train_quantile_models(
            X_train, X_test, y_train, y_test, feature_names,
            quantiles=[0.1, 0.5, 0.9]
        )
    except Exception as e:
        logger.error(f"Training failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # Step 4: Save models
    logger.info("Step 4: Saving quantile ensemble...")
    try:
        filepath = save_quantile_models(result)
    except Exception as e:
        logger.error(f"Failed to save: {e}")
        return False
    
    # Summary
    logger.info("=" * 60)
    logger.info("QUANTILE TRAINING COMPLETE")
    logger.info(f"  80% Prediction Interval Coverage: {result['metrics']['coverage']:.1%}")
    logger.info(f"  Interval Width: {result['metrics']['interval_width_minutes']:.1f} min")
    logger.info(f"  MAE (median): {result['metrics']['mae_median_minutes']:.2f} min")
    logger.info(f"  Model saved: {filepath}")
    logger.info("=" * 60)
    
    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
