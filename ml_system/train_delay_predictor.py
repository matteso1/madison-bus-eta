#!/usr/bin/env python3
"""
Main Training Script for Madison Metro Delay Prediction
Trains multiple model architectures and selects the best performing one
"""

import os
import sys
import yaml
import argparse
import logging
from pathlib import Path
import pandas as pd
import torch
import numpy as np

# Add project root to path
project_root = Path(__file__).parent
sys.path.append(str(project_root))

from data.processors.metro_processor import MetroDataProcessor, MetroDataset
from training.trainers.delay_trainer import DelayTrainer
from models.delay_prediction.transformer_model import create_model

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def check_data_sufficiency(config: dict) -> bool:
    """Check if we have sufficient data for training"""
    
    source_dir = config['data']['source_dir']
    
    # Check for data files
    import glob
    vehicle_files = glob.glob(f"{source_dir}/vehicles_*.csv")
    prediction_files = glob.glob(f"{source_dir}/predictions_*.csv")
    
    if not vehicle_files and not prediction_files:
        logger.error("No data files found!")
        return False
    
    # Count total records
    total_vehicle_records = 0
    total_prediction_records = 0
    
    for file in vehicle_files:
        try:
            df = pd.read_csv(file)
            total_vehicle_records += len(df)
        except:
            continue
    
    for file in prediction_files:
        try:
            df = pd.read_csv(file)
            total_prediction_records += len(df)
        except:
            continue
    
    logger.info(f"Found {total_vehicle_records:,} vehicle records and {total_prediction_records:,} prediction records")
    
    # Check minimum requirements
    min_vehicle = config['data']['min_vehicle_records']
    min_prediction = config['data']['min_prediction_records']
    
    if total_vehicle_records < min_vehicle:
        logger.warning(f"Insufficient vehicle data: {total_vehicle_records:,} < {min_vehicle:,}")
        return False
    
    if total_prediction_records < min_prediction:
        logger.warning(f"Insufficient prediction data: {total_prediction_records:,} < {min_prediction:,}")
        return False
    
    logger.info("✅ Data sufficiency check passed!")
    return True

def process_data(config: dict) -> pd.DataFrame:
    """Process raw data into ML-ready format"""
    
    logger.info("Processing raw data...")
    
    # Initialize processor
    processor = MetroDataProcessor(config)
    
    # Process data
    processed_df = processor.process_data(config['data']['source_dir'])
    
    if processed_df.empty:
        logger.error("No data processed!")
        return pd.DataFrame()
    
    # Save processed data
    os.makedirs(config['data']['processed_dir'], exist_ok=True)
    processor.save_processed_data(processed_df, config['data']['processed_dir'])
    
    logger.info(f"✅ Processed {len(processed_df):,} records")
    return processed_df

def train_models(config: dict, processed_df: pd.DataFrame) -> dict:
    """Train multiple model architectures"""
    
    logger.info("Starting model training...")
    
    # Create dataset
    feature_columns = [
        'hour_sin', 'hour_cos', 'day_sin', 'day_cos',
        'is_rush_hour', 'is_weekend', 'is_peak_morning', 'is_peak_evening', 'is_night',
        'is_rapid_route', 'is_uw_route', 'is_major_local', 'rt_encoded',
        'speed_kmh', 'is_moving', 'is_empty', 'is_half_empty', 'is_full',
        'distance_from_center', 'is_downtown', 'is_uw_campus', 'is_east_side', 'is_west_side',
        'avg_speed_1h', 'avg_delay_1h', 'avg_passengers_1h', 'historical_delay_rate'
    ]
    
    # Only use available features
    available_features = [col for col in feature_columns if col in processed_df.columns]
    target_columns = ['is_delayed'] if 'is_delayed' in processed_df.columns else []
    
    if not target_columns:
        logger.error("No target columns found!")
        return {}
    
    logger.info(f"Using {len(available_features)} features: {available_features}")
    
    # Create dataset
    dataset = MetroDataset(processed_df, available_features, target_columns)
    
    # Initialize trainer
    trainer = DelayTrainer(config)
    
    # Create data loaders
    train_loader, val_loader, test_loader = trainer.create_data_loaders(dataset)
    
    # Train different model architectures
    model_results = {}
    model_types = ['transformer', 'lstm', 'cnn']
    
    for model_type in model_types:
        logger.info(f"Training {model_type} model...")
        
        try:
            # Create model
            model = trainer.setup_model(model_type, len(available_features))
            
            # Train model
            trained_model = trainer.train(model, train_loader, val_loader, f"{model_type}_delay_predictor")
            
            # Evaluate model
            test_metrics = trainer.evaluate(trained_model, test_loader)
            
            model_results[model_type] = {
                'model': trained_model,
                'test_metrics': test_metrics,
                'best_val_loss': trainer.best_val_loss
            }
            
            logger.info(f"✅ {model_type} training complete. Test F1: {test_metrics.get('f1', 0):.4f}")
            
        except Exception as e:
            logger.error(f"❌ Failed to train {model_type}: {e}")
            continue
    
    return model_results

def select_best_model(model_results: dict) -> tuple:
    """Select the best performing model"""
    
    if not model_results:
        logger.error("No models trained successfully!")
        return None, None
    
    # Select based on F1 score
    best_model_type = None
    best_f1 = 0
    
    for model_type, results in model_results.items():
        f1_score = results['test_metrics'].get('f1', 0)
        if f1_score > best_f1:
            best_f1 = f1_score
            best_model_type = model_type
    
    if best_model_type:
        logger.info(f"🏆 Best model: {best_model_type} (F1: {best_f1:.4f})")
        return best_model_type, model_results[best_model_type]
    else:
        logger.error("No valid models found!")
        return None, None

def main():
    """Main training pipeline"""
    
    parser = argparse.ArgumentParser(description='Train Madison Metro Delay Prediction Models')
    parser.add_argument('--config', type=str, default='configs/config.yaml', help='Config file path')
    parser.add_argument('--model', type=str, choices=['transformer', 'lstm', 'cnn', 'all'], 
                       default='all', help='Model type to train')
    parser.add_argument('--force', action='store_true', help='Force training even with insufficient data')
    
    args = parser.parse_args()
    
    # Load configuration
    with open(args.config, 'r') as f:
        config = yaml.safe_load(f)
    
    logger.info("🚀 Starting Madison Metro ML Training Pipeline")
    
    # Check data sufficiency
    if not check_data_sufficiency(config) and not args.force:
        logger.error("❌ Insufficient data for training. Use --force to override.")
        return
    
    # Process data
    processed_df = process_data(config)
    if processed_df.empty:
        logger.error("❌ Data processing failed!")
        return
    
    # Train models
    if args.model == 'all':
        model_results = train_models(config, processed_df)
    else:
        # Train specific model
        logger.info(f"Training {args.model} model only...")
        # Implementation for single model training would go here
        model_results = train_models(config, processed_df)
    
    # Select best model
    best_model_type, best_model = select_best_model(model_results)
    
    if best_model:
        logger.info("🎉 Training pipeline completed successfully!")
        logger.info(f"Best model: {best_model_type}")
        logger.info(f"Test metrics: {best_model['test_metrics']}")
        
        # Save final model
        final_model_path = f"models/saved/final_delay_predictor_{best_model_type}.pth"
        torch.save({
            'model_state_dict': best_model['model'].state_dict(),
            'model_type': best_model_type,
            'test_metrics': best_model['test_metrics'],
            'config': config
        }, final_model_path)
        
        logger.info(f"💾 Final model saved to {final_model_path}")
    else:
        logger.error("❌ Training pipeline failed!")

if __name__ == "__main__":
    main()
