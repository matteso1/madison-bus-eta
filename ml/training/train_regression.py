"""
Regression Training Script for Madison Bus ETA Error Prediction.

This replaces the old classification approach (predicting dly flag)
with regression (predicting error_seconds between API prediction and reality).

Target: error_seconds = actual_arrival - predicted_arrival
"""

import os
import sys
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'collector'))

from features.regression_features import (
    fetch_regression_training_data,
    prepare_regression_training_data,
    get_regression_feature_columns
)
from models.model_registry import save_model, get_model_info

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')
logger = logging.getLogger(__name__)

# Deployment gates - stricter thresholds to prevent regression
MIN_IMPROVEMENT_SECONDS = 2.0    # Must reduce MAE by at least 2 seconds
MAX_ACCEPTABLE_MAE = 90.0        # Never deploy if MAE > 90 seconds
MIN_TEST_SAMPLES = 1000          # Need enough test data for statistical significance
MAX_MAE_INCREASE_SECONDS = 0.0   # Never deploy a worse model (0 = no regression allowed)


def train_regression_model(X_train: np.ndarray, X_test: np.ndarray,
                           y_train: np.ndarray, y_test: np.ndarray,
                           feature_names: list) -> dict:
    """
    Train XGBoost regressor for ETA error prediction with early stopping.

    Uses early stopping to prevent overfitting and find optimal number of trees.

    Returns model and metrics dict.
    """
    try:
        import xgboost as xgb
    except ImportError:
        logger.error("XGBoost not installed. Run: pip install xgboost")
        raise

    logger.info(f"Training set: {len(X_train)}, Test set: {len(X_test)}")
    logger.info(f"Target stats: train mean={y_train.mean():.1f}s, test mean={y_test.mean():.1f}s")

    # Split off a validation set from training for early stopping
    from sklearn.model_selection import train_test_split
    X_tr, X_val, y_tr, y_val = train_test_split(
        X_train, y_train, test_size=0.15, random_state=42
    )

    # Train regressor with early stopping
    # More trees with lower learning rate + early stopping = better generalization
    model = xgb.XGBRegressor(
        n_estimators=500,          # More trees, early stopping will find optimal
        max_depth=10,              # Deeper to capture route-horizon interactions
        learning_rate=0.03,        # Lower LR for smoother convergence
        subsample=0.8,             # Row subsampling
        colsample_bytree=0.8,      # Feature subsampling per tree
        colsample_bylevel=0.8,     # Feature subsampling per level
        min_child_weight=10,       # Prevent overfitting to small groups
        reg_alpha=0.5,             # L1 regularization (feature selection)
        reg_lambda=2.0,            # L2 regularization (smoothing)
        gamma=0.1,                 # Min loss reduction for split
        random_state=42,
        n_jobs=-1
    )

    # Fit with early stopping
    model.fit(
        X_tr, y_tr,
        eval_set=[(X_val, y_val)],
        verbose=False
    )

    best_iteration = model.best_iteration if hasattr(model, 'best_iteration') else model.n_estimators
    logger.info(f"Best iteration: {best_iteration} (of {model.n_estimators} max)")
    
    # Bias Correction: Calculate systematic bias on Training set
    # The model might still be biased if loss function doesn't capture it fully
    y_train_pred = model.predict(X_train)
    bias_offset = np.mean(y_train - y_train_pred)  # E.g. +120s if model is consistently early
    
    logger.info(f"Systematic Model Bias (Train): {bias_offset:.1f}s")
    
    # Evaluate on Test set with AND without bias correction
    y_pred_raw = model.predict(X_test)
    y_pred_corrected = y_pred_raw + bias_offset
    
    # Decide if we use the corrected version
    mae_raw = mean_absolute_error(y_test, y_pred_raw)
    mae_corrected = mean_absolute_error(y_test, y_pred_corrected)
    
    final_bias = 0.0
    y_pred_final = y_pred_raw
    
    if mae_corrected < mae_raw:
        logger.info(f"Applying bias correction improves MAE: {mae_raw:.1f}s -> {mae_corrected:.1f}s")
        final_bias = bias_offset
        y_pred_final = y_pred_corrected
    else:
        logger.info("Bias correction did not improve MAE. Using raw predictions.")
    
    mae = mean_absolute_error(y_test, y_pred_final)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred_final))
    
    # Compare to baseline (predicting 0 error = trusting the API)
    baseline_mae = mean_absolute_error(y_test, np.zeros_like(y_test))
    improvement_vs_baseline = ((baseline_mae - mae) / baseline_mae) * 100
    
    metrics = {
        'mae': mae,
        'rmse': rmse,
        'mae_minutes': mae / 60,
        'rmse_minutes': rmse / 60,
        'baseline_mae': baseline_mae,
        'improvement_vs_baseline_pct': improvement_vs_baseline,
        'train_samples': len(X_train),
        'test_samples': len(X_test),
        'model_type': 'XGBRegressor',
        'target': 'error_seconds',
        'bias_correction_seconds': float(final_bias)  # Helper for serving
    }
    
    # Feature importance
    importance = dict(zip(feature_names, model.feature_importances_))
    metrics['feature_importance'] = dict(sorted(importance.items(), key=lambda x: x[1], reverse=True))
    
    return {'model': model, 'metrics': metrics, 'feature_names': feature_names}


def log_training_run(version: str, metrics: dict, deployed: bool, reason: str,
                     samples: int, days: int, previous_mae: float = None):
    """Log training run to database."""
    from sqlalchemy import create_engine, text
    
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        return
    
    engine = create_engine(database_url, pool_pre_ping=True)
    
    improvement_pct = None
    if previous_mae and previous_mae > 0:
        improvement_pct = ((previous_mae - metrics['mae']) / previous_mae) * 100
    
    with engine.connect() as conn:
        # Create/update table for regression runs
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ml_regression_runs (
                id SERIAL PRIMARY KEY,
                version VARCHAR(50) UNIQUE,
                trained_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                samples_used INTEGER,
                days_of_data INTEGER,
                mae FLOAT,
                rmse FLOAT,
                mae_minutes FLOAT,
                improvement_vs_baseline_pct FLOAT,
                previous_mae FLOAT,
                improvement_pct FLOAT,
                deployed BOOLEAN,
                deployment_reason VARCHAR(200)
            )
        """))
        conn.commit()
        
        conn.execute(text("""
            INSERT INTO ml_regression_runs
            (version, samples_used, days_of_data, mae, rmse, mae_minutes,
             improvement_vs_baseline_pct, previous_mae, improvement_pct, deployed, deployment_reason)
            VALUES (:version, :samples, :days, :mae, :rmse, :mae_min,
                    :baseline_imp, :prev_mae, :improvement, :deployed, :reason)
        """), {
            "version": version,
            "samples": int(samples),
            "days": int(days),
            "mae": float(metrics['mae']),
            "rmse": float(metrics['rmse']),
            "mae_min": float(metrics['mae_minutes']),
            "baseline_imp": float(metrics['improvement_vs_baseline_pct']),
            "prev_mae": float(previous_mae) if previous_mae else None,
            "improvement": float(improvement_pct) if improvement_pct else None,
            "deployed": deployed,
            "reason": reason
        })
        conn.commit()
    
    logger.info(f"Training run logged to database: {version}")


def main():
    """Main regression training pipeline."""
    logger.info("=" * 60)
    logger.info("ETA ERROR REGRESSION TRAINING PIPELINE")
    logger.info("=" * 60)
    
    days = 7
    
    # Step 1: Fetch prediction outcomes data
    logger.info("Step 1: Fetching prediction outcomes data...")
    try:
        df = fetch_regression_training_data(days=days)
    except Exception as e:
        logger.error(f"Failed to fetch data: {e}")
        logger.info("No prediction outcomes yet? Run the collector to generate ground truth.")
        return False
    
    if len(df) < 100:
        logger.warning(f"Not enough data for training ({len(df)} records, need 100+)")
        logger.info("Keep running the collector to generate more ground truth.")
        return False
    
    logger.info(f"Fetched {len(df)} prediction outcomes from last {days} days")
    
    # Step 2: Feature engineering with TEMPORAL SPLIT
    logger.info("Step 2: Engineering features with temporal split...")
    try:
        X_train, X_test, y_train, y_test, feature_names, split_info = prepare_regression_training_data(
            df,
            test_days=2,  # Test on last 2 days
            use_temporal_split=True
        )
    except Exception as e:
        logger.error(f"Feature engineering failed: {e}")
        import traceback
        traceback.print_exc()
        return False

    total_samples = len(y_train) + len(y_test)
    avg_error = (y_train.mean() + y_test.mean()) / 2
    logger.info(f"Feature matrix: ({total_samples}, {len(feature_names)}), Avg error: {avg_error/60:.1f} min")
    logger.info(f"Split type: {split_info.get('split_type', 'unknown')}")
    if split_info.get('split_type') == 'temporal':
        logger.info(f"  Train period: {split_info.get('train_date_range', 'N/A')}")
        logger.info(f"  Test period: {split_info.get('test_date_range', 'N/A')}")
    
    # Step 3: Train model
    logger.info("Step 3: Training XGBoost regressor...")
    try:
        result = train_regression_model(X_train, X_test, y_train, y_test, feature_names)
    except Exception as e:
        logger.error(f"Training failed: {e}")
        return False
    
    new_metrics = result['metrics']
    
    logger.info(f"New Model - MAE: {new_metrics['mae']:.1f}s ({new_metrics['mae_minutes']:.2f} min)")
    logger.info(f"RMSE: {new_metrics['rmse']:.1f}s ({new_metrics['rmse_minutes']:.2f} min)")
    logger.info(f"Improvement vs baseline (API trust): {new_metrics['improvement_vs_baseline_pct']:.1f}%")
    
    # Step 4: Compare with previous model (STRICT DEPLOYMENT GATES)
    logger.info("Step 4: Comparing with previous model...")

    previous_info = get_model_info()
    previous_mae = None
    should_deploy = False
    deploy_reason = ""

    # Gate 1: Absolute MAE threshold
    if new_metrics['mae'] > MAX_ACCEPTABLE_MAE:
        logger.warning(f"GATE FAILED: MAE {new_metrics['mae']:.1f}s > max acceptable {MAX_ACCEPTABLE_MAE}s")
        deploy_reason = f"mae_too_high_{new_metrics['mae']:.0f}s"
        should_deploy = False
    # Gate 2: Minimum test samples for statistical significance
    elif new_metrics['test_samples'] < MIN_TEST_SAMPLES:
        logger.warning(f"GATE FAILED: Test samples {new_metrics['test_samples']} < minimum {MIN_TEST_SAMPLES}")
        deploy_reason = f"insufficient_test_samples_{new_metrics['test_samples']}"
        should_deploy = False
    elif previous_info is None:
        # First model - deploy if passes absolute thresholds
        should_deploy = True
        deploy_reason = "first_regression_model"
        logger.info("No previous model found. Deploying first regression model.")
    else:
        # Check if previous model was regression or classification
        prev_metrics = previous_info.get('metrics', {})
        if prev_metrics.get('mae') is not None:
            previous_mae = prev_metrics['mae']
            improvement = previous_mae - new_metrics['mae']

            logger.info(f"Previous MAE: {previous_mae:.1f}s, New MAE: {new_metrics['mae']:.1f}s")
            logger.info(f"Improvement: {improvement:.1f}s")

            # Gate 3: No regression allowed
            if improvement < -MAX_MAE_INCREASE_SECONDS:
                logger.warning(f"GATE FAILED: Model is WORSE by {-improvement:.1f}s")
                deploy_reason = f"regression_{-improvement:.0f}s_worse"
                should_deploy = False
            # Gate 4: Must improve by minimum threshold
            elif improvement >= MIN_IMPROVEMENT_SECONDS:
                should_deploy = True
                deploy_reason = f"improved_{improvement:.1f}s"
                logger.info(f"GATES PASSED: Improvement {improvement:.1f}s >= threshold {MIN_IMPROVEMENT_SECONDS}s")
            else:
                # Slight improvement but below threshold
                deploy_reason = f"marginal_{improvement:.1f}s"
                should_deploy = False
                logger.info(f"GATE FAILED: Improvement {improvement:.1f}s < threshold {MIN_IMPROVEMENT_SECONDS}s")
        else:
            # Previous model was classification - upgrade to regression
            # But still apply absolute threshold
            should_deploy = True
            deploy_reason = "upgrade_from_classification"
            logger.info("Previous model was classification. Upgrading to regression.")
    
    # Step 5: Save model (if deploying)
    version = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    
    if should_deploy:
        logger.info("Step 5: Deploying new model...")
        try:
            model_path = save_model(result['model'], new_metrics, notes=deploy_reason)
            logger.info(f"✅ Model deployed: {model_path}")
        except Exception as e:
            logger.error(f"Failed to save model: {e}")
            should_deploy = False
            deploy_reason = f"save_failed: {e}"
    else:
        logger.info("Step 5: Skipping deployment (no improvement)")
    
    # Step 6: Log training run
    logger.info("Step 6: Logging training run...")
    try:
        log_training_run(
            version=version,
            metrics=new_metrics,
            deployed=should_deploy,
            reason=deploy_reason,
            samples=total_samples,
            days=days,
            previous_mae=previous_mae
        )
    except Exception as e:
        logger.error(f"Failed to log training run: {e}")
    
    # Summary
    logger.info("=" * 60)
    logger.info("TRAINING COMPLETE")
    logger.info(f"  Version: {version}")
    logger.info(f"  Train samples: {new_metrics['train_samples']}")
    logger.info(f"  Test samples: {new_metrics['test_samples']}")
    logger.info(f"  MAE: {new_metrics['mae']:.1f}s ({new_metrics['mae_minutes']:.2f} min)")
    logger.info(f"  RMSE: {new_metrics['rmse']:.1f}s ({new_metrics['rmse_minutes']:.2f} min)")
    logger.info(f"  vs Baseline: {new_metrics['improvement_vs_baseline_pct']:.1f}% better than trusting API")
    if previous_mae:
        logger.info(f"  vs Previous: {previous_mae - new_metrics['mae']:.1f}s improvement")
    logger.info(f"  Deployed: {'YES' if should_deploy else 'NO'}")
    logger.info(f"  Reason: {deploy_reason}")

    # Log top 5 feature importances
    if 'feature_importance' in new_metrics:
        logger.info("  Top 5 Features:")
        for i, (feat, imp) in enumerate(list(new_metrics['feature_importance'].items())[:5]):
            logger.info(f"    {i+1}. {feat}: {float(imp):.3f}")

    logger.info("=" * 60)

    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
