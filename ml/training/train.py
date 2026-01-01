"""
ML Training Script for Madison Bus ETA.

Trains an XGBoost classifier to predict bus delays using historical data.
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
    accuracy_score, precision_score, recall_score, f1_score,
    classification_report, confusion_matrix
)

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from features.feature_engineering import prepare_training_data, get_feature_columns
from models.model_registry import save_model, load_latest_model

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')
logger = logging.getLogger(__name__)


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


def train_model(X: np.ndarray, y: np.ndarray, feature_names: list) -> dict:
    """Train XGBoost classifier and return model + metrics."""
    try:
        import xgboost as xgb
    except ImportError:
        logger.error("XGBoost not installed. Run: pip install xgboost")
        raise
    
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    logger.info(f"Training set: {len(X_train)} samples")
    logger.info(f"Test set: {len(X_test)} samples")
    logger.info(f"Delay rate in train: {y_train.mean():.2%}")
    logger.info(f"Delay rate in test: {y_test.mean():.2%}")
    
    # Handle class imbalance with scale_pos_weight
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
    y_prob = model.predict_proba(X_test)[:, 1]
    
    metrics = {
        'accuracy': accuracy_score(y_test, y_pred),
        'precision': precision_score(y_test, y_pred, zero_division=0),
        'recall': recall_score(y_test, y_pred, zero_division=0),
        'f1': f1_score(y_test, y_pred, zero_division=0),
        'train_samples': len(X_train),
        'test_samples': len(X_test),
        'delay_rate_train': float(y_train.mean()),
        'delay_rate_test': float(y_test.mean()),
    }
    
    # Feature importance
    importance = dict(zip(feature_names, model.feature_importances_))
    metrics['feature_importance'] = dict(sorted(importance.items(), key=lambda x: x[1], reverse=True))
    
    logger.info("=" * 50)
    logger.info("MODEL EVALUATION")
    logger.info("=" * 50)
    logger.info(f"Accuracy:  {metrics['accuracy']:.4f}")
    logger.info(f"Precision: {metrics['precision']:.4f}")
    logger.info(f"Recall:    {metrics['recall']:.4f}")
    logger.info(f"F1 Score:  {metrics['f1']:.4f}")
    logger.info("=" * 50)
    logger.info("Top 5 Features:")
    for i, (feat, imp) in enumerate(list(metrics['feature_importance'].items())[:5]):
        logger.info(f"  {i+1}. {feat}: {imp:.4f}")
    
    return {'model': model, 'metrics': metrics, 'feature_names': feature_names}


def main():
    """Main training pipeline."""
    logger.info("=" * 60)
    logger.info("MADISON BUS ETA - ML TRAINING PIPELINE")
    logger.info("=" * 60)
    
    # Step 1: Fetch data
    logger.info("Step 1: Fetching training data...")
    try:
        df = fetch_training_data(days=7)
    except Exception as e:
        logger.error(f"Failed to fetch data: {e}")
        return
    
    if len(df) < 100:
        logger.warning("Not enough data for training (need at least 100 records)")
        return
    
    # Step 2: Feature engineering
    logger.info("Step 2: Engineering features...")
    try:
        X, y, feature_names = prepare_training_data(df)
    except Exception as e:
        logger.error(f"Feature engineering failed: {e}")
        return
    
    logger.info(f"Feature matrix shape: {X.shape}")
    logger.info(f"Target shape: {y.shape}")
    logger.info(f"Delay rate: {y.mean():.2%}")
    
    # Step 3: Train model
    logger.info("Step 3: Training XGBoost model...")
    try:
        result = train_model(X, y, feature_names)
    except Exception as e:
        logger.error(f"Training failed: {e}")
        return
    
    # Step 4: Save model
    logger.info("Step 4: Saving model to registry...")
    try:
        model_path = save_model(result['model'], result['metrics'])
        logger.info(f"Model saved to: {model_path}")
    except Exception as e:
        logger.error(f"Failed to save model: {e}")
        return
    
    logger.info("=" * 60)
    logger.info("TRAINING COMPLETE")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
