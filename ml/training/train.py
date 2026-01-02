"""
Autonomous ML Training Script for Madison Bus ETA.

Features:
- Fetches last N days of data from PostgreSQL
- Engineers features for delay prediction
- Trains XGBoost classifier
- Compares against previous model
- Only deploys if performance improved
- Logs training run to database
"""

import os
import sys
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score
)

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'collector'))

from features.feature_engineering import prepare_training_data, get_feature_columns
from models.model_registry import save_model, load_latest_model, get_model_info

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')
logger = logging.getLogger(__name__)

# Minimum improvement threshold (percentage points)
MIN_IMPROVEMENT_THRESHOLD = 0.01  # 1% improvement required


def fetch_training_data(days: int = 7) -> pd.DataFrame:
    """Fetch vehicle observations from the last N days from database."""
    from sqlalchemy import create_engine, text
    
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        raise ValueError("DATABASE_URL not set")
    
    engine = create_engine(database_url, pool_pre_ping=True)
    
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    
    query = """
        SELECT vid, rt, lat, lon, hdg, dly, tmstmp, collected_at
        FROM vehicle_observations
        WHERE collected_at > :cutoff
        ORDER BY collected_at
    """
    
    with engine.connect() as conn:
        df = pd.read_sql(text(query), conn, params={"cutoff": cutoff})
    
    logger.info(f"Fetched {len(df)} records from last {days} days")
    return df


def train_model(X_train: np.ndarray, X_test: np.ndarray, 
                y_train: np.ndarray, y_test: np.ndarray, 
                feature_names: list) -> dict:
    """
    Train XGBoost classifier and return model + metrics.
    
    Args:
        X_train, X_test: Pre-split feature arrays
        y_train, y_test: Pre-split target arrays
        feature_names: List of feature column names
    """
    try:
        import xgboost as xgb
    except ImportError:
        logger.error("XGBoost not installed. Run: pip install xgboost")
        raise
    
    logger.info(f"Training set: {len(X_train)}, Test set: {len(X_test)}")
    logger.info(f"Delay rate: train={y_train.mean():.2%}, test={y_test.mean():.2%}")
    
    # Handle class imbalance
    neg_count = (y_train == 0).sum()
    pos_count = (y_train == 1).sum()
    scale_pos_weight = neg_count / pos_count if pos_count > 0 else 1
    
    # Train model
    model = xgb.XGBClassifier(
        n_estimators=100,
        max_depth=5,
        learning_rate=0.1,
        scale_pos_weight=scale_pos_weight,
        random_state=42,
        use_label_encoder=False,
        eval_metric='logloss'
    )
    
    model.fit(X_train, y_train)
    
    # Evaluate
    y_pred = model.predict(X_test)
    
    metrics = {
        'accuracy': accuracy_score(y_test, y_pred),
        'precision': precision_score(y_test, y_pred, zero_division=0),
        'recall': recall_score(y_test, y_pred, zero_division=0),
        'f1': f1_score(y_test, y_pred, zero_division=0),
        'train_samples': len(X_train),
        'test_samples': len(X_test),
    }
    
    # Feature importance
    importance = dict(zip(feature_names, model.feature_importances_))
    metrics['feature_importance'] = dict(sorted(importance.items(), key=lambda x: x[1], reverse=True))
    
    return {'model': model, 'metrics': metrics, 'feature_names': feature_names}


def log_training_run(version: str, metrics: dict, deployed: bool, reason: str, 
                     samples: int, days: int, previous_f1: float = None):
    """Log training run to database."""
    from sqlalchemy import create_engine, text
    
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        return
    
    engine = create_engine(database_url, pool_pre_ping=True)
    
    improvement_pct = None
    if previous_f1 and previous_f1 > 0:
        improvement_pct = ((metrics['f1'] - previous_f1) / previous_f1) * 100
    
    with engine.connect() as conn:
        # Create table if not exists
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ml_training_runs (
                id SERIAL PRIMARY KEY,
                version VARCHAR(50) UNIQUE,
                trained_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                samples_used INTEGER,
                days_of_data INTEGER,
                accuracy FLOAT,
                precision FLOAT,
                recall FLOAT,
                f1_score FLOAT,
                previous_f1 FLOAT,
                improvement_pct FLOAT,
                deployed BOOLEAN,
                deployment_reason VARCHAR(200)
            )
        """))
        conn.commit()
        
        conn.execute(text("""
            INSERT INTO ml_training_runs 
            (version, samples_used, days_of_data, accuracy, precision, recall, f1_score, 
             previous_f1, improvement_pct, deployed, deployment_reason)
            VALUES (:version, :samples, :days, :accuracy, :precision, :recall, :f1, 
                    :prev_f1, :improvement, :deployed, :reason)
        """), {
            "version": version,
            "samples": samples,
            "days": days,
            "accuracy": metrics['accuracy'],
            "precision": metrics['precision'],
            "recall": metrics['recall'],
            "f1": metrics['f1'],
            "prev_f1": previous_f1,
            "improvement": improvement_pct,
            "deployed": deployed,
            "reason": reason
        })
        conn.commit()
    
    logger.info(f"Training run logged to database: {version}")


def main():
    """Main autonomous training pipeline."""
    logger.info("=" * 60)
    logger.info("AUTONOMOUS ML TRAINING PIPELINE")
    logger.info("=" * 60)
    
    days = 7
    
    # Step 1: Fetch data
    logger.info("Step 1: Fetching training data...")
    try:
        df = fetch_training_data(days=days)
    except Exception as e:
        logger.error(f"Failed to fetch data: {e}")
        return False
    
    if len(df) < 100:
        logger.warning(f"Not enough data for training ({len(df)} records, need 100+)")
        return False
    
    # Step 2: Feature engineering (with proper train/test split to avoid leakage)
    logger.info("Step 2: Engineering features...")
    try:
        X_train, X_test, y_train, y_test, feature_names = prepare_training_data(df)
    except Exception as e:
        logger.error(f"Feature engineering failed: {e}")
        return False
    
    total_samples = len(y_train) + len(y_test)
    delay_rate = (y_train.sum() + y_test.sum()) / total_samples
    logger.info(f"Feature matrix: ({total_samples}, {len(feature_names)}), Delay rate: {delay_rate:.2%}")
    
    # Step 3: Train new model
    logger.info("Step 3: Training XGBoost model...")
    try:
        result = train_model(X_train, X_test, y_train, y_test, feature_names)
    except Exception as e:
        logger.error(f"Training failed: {e}")
        return False
    
    new_metrics = result['metrics']
    
    logger.info(f"New Model - Accuracy: {new_metrics['accuracy']:.4f}, F1: {new_metrics['f1']:.4f}")
    
    # Step 4: Compare with previous model
    logger.info("Step 4: Comparing with previous model...")
    
    previous_info = get_model_info()
    previous_f1 = None
    should_deploy = False
    deploy_reason = ""
    
    if previous_info is None:
        # First model - always deploy
        should_deploy = True
        deploy_reason = "first_model"
        logger.info("No previous model found. Deploying first model.")
    else:
        previous_f1 = previous_info.get('metrics', {}).get('f1', 0)
        improvement = new_metrics['f1'] - previous_f1
        improvement_pct = (improvement / previous_f1 * 100) if previous_f1 > 0 else 100
        
        logger.info(f"Previous F1: {previous_f1:.4f}, New F1: {new_metrics['f1']:.4f}")
        logger.info(f"Improvement: {improvement:.4f} ({improvement_pct:+.1f}%)")
        
        if improvement > MIN_IMPROVEMENT_THRESHOLD:
            should_deploy = True
            deploy_reason = f"improved_{improvement_pct:.1f}pct"
            logger.info(f"✅ Improvement exceeds threshold ({MIN_IMPROVEMENT_THRESHOLD}). Deploying.")
        else:
            deploy_reason = "not_improved"
            logger.info(f"⏸️ Improvement below threshold. Skipping deployment.")
    
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
    
    # Step 6: Log training run to database
    logger.info("Step 6: Logging training run...")
    try:
        log_training_run(
            version=version,
            metrics=new_metrics,
            deployed=should_deploy,
            reason=deploy_reason,
            samples=total_samples,
            days=days,
            previous_f1=previous_f1
        )
    except Exception as e:
        logger.error(f"Failed to log training run: {e}")
    
    # Summary
    logger.info("=" * 60)
    logger.info("TRAINING COMPLETE")
    logger.info(f"  Version: {version}")
    logger.info(f"  Samples: {len(X)}")
    logger.info(f"  F1 Score: {new_metrics['f1']:.4f}")
    logger.info(f"  Deployed: {'✅ Yes' if should_deploy else '⏸️ No'}")
    logger.info(f"  Reason: {deploy_reason}")
    logger.info("=" * 60)
    
    # Return True = pipeline completed successfully (even if we chose not to deploy)
    # Return False only on actual failures (data fetch, training errors, etc.)
    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
