#!/usr/bin/env python3
"""
Delay Prediction Model Trainer
Handles training, validation, and evaluation of delay prediction models
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, random_split
import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional
import logging
import os
from pathlib import Path
import json
from datetime import datetime
import wandb
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DelayTrainer:
    """Trainer for delay prediction models"""
    
    def __init__(self, config: Dict, device: str = None):
        self.config = config
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        logger.info(f"Using device: {self.device}")
        
        # Initialize tracking
        self.best_val_loss = float('inf')
        self.best_model_state = None
        self.training_history = {
            'train_loss': [],
            'val_loss': [],
            'train_metrics': [],
            'val_metrics': []
        }
        
        # Setup experiment tracking
        wandb_disabled = os.getenv('WANDB_DISABLED', '').lower() in ('true', '1', 'yes')
        wandb_entity = config.get('monitoring', {}).get('wandb', {}).get('entity', '')
        wandb_project = config.get('monitoring', {}).get('wandb', {}).get('project', '')
        
        # Skip wandb if disabled OR if entity is a placeholder
        if not wandb_disabled and wandb_project and wandb_entity not in ('your-username', '', None):
            try:
                wandb.init(
                    project=wandb_project,
                    entity=wandb_entity,
                    config=config
                )
                logger.info("W&B tracking enabled")
            except Exception as e:
                logger.warning(f"W&B init failed, continuing without tracking: {e}")
        else:
            logger.info("W&B tracking disabled")
    
    def create_data_loaders(self, dataset, batch_size: int = 64, 
                          train_split: float = 0.7, val_split: float = 0.2) -> Tuple[DataLoader, DataLoader, DataLoader]:
        """Create train, validation, and test data loaders"""
        
        # Calculate split sizes
        total_size = len(dataset)
        train_size = int(train_split * total_size)
        val_size = int(val_split * total_size)
        test_size = total_size - train_size - val_size
        
        # Split dataset
        train_dataset, val_dataset, test_dataset = random_split(
            dataset, [train_size, val_size, test_size],
            generator=torch.Generator().manual_seed(42)
        )
        
        # Create data loaders
        train_loader = DataLoader(
            train_dataset,
            batch_size=batch_size,
            shuffle=True,
            num_workers=self.config['training'].get('num_workers', 4),
            pin_memory=self.config['training'].get('pin_memory', True)
        )
        
        val_loader = DataLoader(
            val_dataset,
            batch_size=batch_size,
            shuffle=False,
            num_workers=self.config['training'].get('num_workers', 4),
            pin_memory=self.config['training'].get('pin_memory', True)
        )
        
        test_loader = DataLoader(
            test_dataset,
            batch_size=batch_size,
            shuffle=False,
            num_workers=self.config['training'].get('num_workers', 4),
            pin_memory=self.config['training'].get('pin_memory', True)
        )
        
        logger.info(f"Created data loaders - Train: {len(train_dataset)}, Val: {len(val_dataset)}, Test: {len(test_dataset)}")
        
        return train_loader, val_loader, test_loader
    
    def setup_model(self, model_type: str, input_dim: int, num_classes: int = 1) -> nn.Module:
        """Setup model based on configuration"""
        
        # Import model factory
        import sys
        sys.path.append(str(Path(__file__).parent.parent.parent))
        from models.delay_prediction.transformer_model import create_model
        
        # Get model config
        base_config = self.config['models']['delay_prediction'].copy()
        
        # Remove training-specific keys
        for key in ['architecture', 'learning_rate', 'batch_size', 'epochs', 'early_stopping_patience']:
            base_config.pop(key, None)
        
        # Build model-specific params
        model_config = {}
        
        if model_type.lower() == 'transformer':
            model_config = {
                'd_model': base_config.get('hidden_size', 256),
                'nhead': base_config.get('num_heads', 8),
                'num_layers': base_config.get('num_layers', 6),
                'dropout': base_config.get('dropout', 0.1)
            }
        elif model_type.lower() == 'lstm':
            model_config = {
                'hidden_size': base_config.get('hidden_size', 128),
                'num_layers': base_config.get('num_layers', 3),
                'dropout': base_config.get('dropout', 0.2)
            }
        elif model_type.lower() == 'cnn':
            model_config = {
                'num_filters': base_config.get('hidden_size', 64),
                'dropout': base_config.get('dropout', 0.2)
            }
        
        # Create model
        model = create_model(
            model_type=model_type,
            input_dim=input_dim,
            num_classes=num_classes,
            **model_config
        )
        
        # Move to device
        model = model.to(self.device)
        
        # Log model info
        total_params = sum(p.numel() for p in model.parameters())
        trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
        
        logger.info(f"Created {model_type} model with {total_params:,} total parameters ({trainable_params:,} trainable)")
        
        return model
    
    def setup_optimizer_and_scheduler(self, model: nn.Module) -> Tuple[optim.Optimizer, Optional[optim.lr_scheduler._LRScheduler]]:
        """Setup optimizer and learning rate scheduler"""
        
        training_config = self.config['training']
        model_config = self.config['models']['delay_prediction']
        
        # Get learning rate from model config or training config
        learning_rate = model_config.get('learning_rate', training_config.get('learning_rate', 0.001))
        
        # Setup optimizer
        if training_config['optimizer'].lower() == 'adam':
            optimizer = optim.Adam(
                model.parameters(),
                lr=learning_rate,
                weight_decay=training_config.get('weight_decay', 0.01)
            )
        elif training_config['optimizer'].lower() == 'adamw':
            optimizer = optim.AdamW(
                model.parameters(),
                lr=learning_rate,
                weight_decay=training_config.get('weight_decay', 0.01)
            )
        else:
            optimizer = optim.SGD(
                model.parameters(),
                lr=learning_rate,
                weight_decay=training_config.get('weight_decay', 0.01),
                momentum=0.9
            )
        
        # Setup scheduler
        scheduler = None
        epochs_count = self.config['models']['delay_prediction'].get('epochs', self.config['training'].get('epochs', 100))
        if training_config.get('scheduler') == 'cosine':
            scheduler = optim.lr_scheduler.CosineAnnealingLR(
                optimizer, T_max=epochs_count
            )
        elif training_config.get('scheduler') == 'step':
            scheduler = optim.lr_scheduler.StepLR(
                optimizer, step_size=max(1, epochs_count // 3), gamma=0.1
            )
        elif training_config.get('scheduler') == 'plateau':
            scheduler = optim.lr_scheduler.ReduceLROnPlateau(
                optimizer, mode='min', patience=5, factor=0.5
            )
        
        return optimizer, scheduler
    
    def compute_metrics(self, y_true: torch.Tensor, y_pred: torch.Tensor, 
                       task_type: str = 'classification') -> Dict[str, float]:
        """Compute evaluation metrics"""
        
        # Convert to numpy
        y_true_np = y_true.cpu().numpy()
        y_pred_np = y_pred.cpu().numpy()
        
        metrics = {}
        
        if task_type == 'classification':
            # For binary classification
            y_pred_binary = (y_pred_np > 0.5).astype(int)
            
            metrics.update({
                'accuracy': accuracy_score(y_true_np, y_pred_binary),
                'precision': precision_score(y_true_np, y_pred_binary, zero_division=0),
                'recall': recall_score(y_true_np, y_pred_binary, zero_division=0),
                'f1': f1_score(y_true_np, y_pred_binary, zero_division=0),
                'auc': roc_auc_score(y_true_np, y_pred_np) if len(np.unique(y_true_np)) > 1 else 0.0
            })
        
        elif task_type == 'regression':
            # For regression
            metrics.update({
                'mae': mean_absolute_error(y_true_np, y_pred_np),
                'mse': mean_squared_error(y_true_np, y_pred_np),
                'rmse': np.sqrt(mean_squared_error(y_true_np, y_pred_np)),
                'r2': r2_score(y_true_np, y_pred_np)
            })
        
        return metrics
    
    def train_epoch(self, model: nn.Module, train_loader: DataLoader, 
                   optimizer: optim.Optimizer, criterion: nn.Module,
                   scaler: Optional[torch.cuda.amp.GradScaler] = None) -> Tuple[float, Dict[str, float]]:
        """Train for one epoch"""
        
        model.train()
        total_loss = 0.0
        all_predictions = []
        all_targets = []
        
        for batch_idx, (data, target) in enumerate(train_loader):
            data, target = data.to(self.device), target.to(self.device)
            
            optimizer.zero_grad()
            
            # Forward pass with mixed precision if enabled
            if scaler and self.config['training'].get('mixed_precision', False):
                with torch.cuda.amp.autocast():
                    output = model(data)
                    loss = criterion(output.squeeze(), target.squeeze())
                
                scaler.scale(loss).backward()
                
                # Gradient clipping
                if self.config['training'].get('gradient_clipping'):
                    scaler.unscale_(optimizer)
                    torch.nn.utils.clip_grad_norm_(
                        model.parameters(), 
                        self.config['training']['gradient_clipping']
                    )
                
                scaler.step(optimizer)
                scaler.update()
            else:
                output = model(data)
                loss = criterion(output.squeeze(), target.squeeze())
                
                loss.backward()
                
                # Gradient clipping
                if self.config['training'].get('gradient_clipping'):
                    torch.nn.utils.clip_grad_norm_(
                        model.parameters(), 
                        self.config['training']['gradient_clipping']
                    )
                
                optimizer.step()
            
            total_loss += loss.item()
            all_predictions.append(output.detach())
            all_targets.append(target.detach())
        
        # Compute metrics
        all_predictions = torch.cat(all_predictions, dim=0)
        all_targets = torch.cat(all_targets, dim=0)
        
        avg_loss = total_loss / len(train_loader)
        metrics = self.compute_metrics(all_targets, all_predictions, 'classification')
        
        return avg_loss, metrics
    
    def validate_epoch(self, model: nn.Module, val_loader: DataLoader, 
                      criterion: nn.Module) -> Tuple[float, Dict[str, float]]:
        """Validate for one epoch"""
        
        model.eval()
        total_loss = 0.0
        all_predictions = []
        all_targets = []
        
        with torch.no_grad():
            for data, target in val_loader:
                data, target = data.to(self.device), target.to(self.device)
                
                output = model(data)
                loss = criterion(output.squeeze(), target.squeeze())
                
                total_loss += loss.item()
                all_predictions.append(output)
                all_targets.append(target)
        
        # Compute metrics
        all_predictions = torch.cat(all_predictions, dim=0)
        all_targets = torch.cat(all_targets, dim=0)
        
        avg_loss = total_loss / len(val_loader)
        metrics = self.compute_metrics(all_targets, all_predictions, 'classification')
        
        return avg_loss, metrics
    
    def train(self, model: nn.Module, train_loader: DataLoader, val_loader: DataLoader,
              model_name: str = "delay_predictor") -> nn.Module:
        """Main training loop"""
        
        logger.info(f"Starting training for {model_name}")
        
        # Setup training components
        optimizer, scheduler = self.setup_optimizer_and_scheduler(model)
        criterion = nn.BCEWithLogitsLoss()  # For binary classification
        
        # Mixed precision scaler
        scaler = torch.cuda.amp.GradScaler() if self.config['training'].get('mixed_precision', False) else None
        
        # Training loop - get epochs from model config or training config
        model_config = self.config['models']['delay_prediction']
        epochs = model_config.get('epochs', self.config['training'].get('epochs', 100))
        patience = model_config.get('early_stopping_patience', self.config['training'].get('early_stopping_patience', 10))
        patience_counter = 0
        
        for epoch in range(epochs):
            # Train
            train_loss, train_metrics = self.train_epoch(model, train_loader, optimizer, criterion, scaler)
            
            # Validate
            val_loss, val_metrics = self.validate_epoch(model, val_loader, criterion)
            
            # Update scheduler
            if scheduler:
                if isinstance(scheduler, optim.lr_scheduler.ReduceLROnPlateau):
                    scheduler.step(val_loss)
                else:
                    scheduler.step()
            
            # Log metrics
            logger.info(f"Epoch {epoch+1}/{epochs} - Train Loss: {train_loss:.4f}, Val Loss: {val_loss:.4f}")
            logger.info(f"Train Metrics: {train_metrics}")
            logger.info(f"Val Metrics: {val_metrics}")
            
            # Track history
            self.training_history['train_loss'].append(train_loss)
            self.training_history['val_loss'].append(val_loss)
            self.training_history['train_metrics'].append(train_metrics)
            self.training_history['val_metrics'].append(val_metrics)
            
            # Wandb logging
            if wandb.run:
                wandb.log({
                    'epoch': epoch,
                    'train_loss': train_loss,
                    'val_loss': val_loss,
                    'learning_rate': optimizer.param_groups[0]['lr'],
                    **{f'train_{k}': v for k, v in train_metrics.items()},
                    **{f'val_{k}': v for k, v in val_metrics.items()}
                })
            
            # Early stopping and model saving
            if val_loss < self.best_val_loss:
                self.best_val_loss = val_loss
                self.best_model_state = model.state_dict().copy()
                patience_counter = 0
                
                # Save best model
                self.save_model(model, model_name, epoch, val_loss, val_metrics)
            else:
                patience_counter += 1
                if patience_counter >= patience:
                    logger.info(f"Early stopping at epoch {epoch+1}")
                    break
        
        # Load best model
        if self.best_model_state:
            model.load_state_dict(self.best_model_state)
            logger.info("Loaded best model state")
        
        return model
    
    def evaluate(self, model: nn.Module, test_loader: DataLoader) -> Dict[str, float]:
        """Evaluate model on test set"""
        
        logger.info("Evaluating model on test set")
        
        model.eval()
        all_predictions = []
        all_targets = []
        
        with torch.no_grad():
            for data, target in test_loader:
                data, target = data.to(self.device), target.to(self.device)
                output = model(data)
                
                all_predictions.append(output)
                all_targets.append(target)
        
        # Compute final metrics
        all_predictions = torch.cat(all_predictions, dim=0)
        all_targets = torch.cat(all_targets, dim=0)
        
        test_metrics = self.compute_metrics(all_targets, all_predictions, 'classification')
        
        logger.info(f"Test Metrics: {test_metrics}")
        
        return test_metrics
    
    def save_model(self, model: nn.Module, model_name: str, epoch: int, 
                  val_loss: float, val_metrics: Dict[str, float]):
        """Save model and training artifacts"""
        
        save_dir = Path("models/saved")
        save_dir.mkdir(parents=True, exist_ok=True)
        
        # Save model state
        model_path = save_dir / f"{model_name}_epoch_{epoch}.pth"
        torch.save({
            'model_state_dict': model.state_dict(),
            'epoch': epoch,
            'val_loss': val_loss,
            'val_metrics': val_metrics,
            'config': self.config,
            'training_history': self.training_history
        }, model_path)
        
        # Save best model
        best_model_path = save_dir / f"{model_name}_best.pth"
        torch.save({
            'model_state_dict': self.best_model_state,
            'epoch': epoch,
            'val_loss': self.best_val_loss,
            'val_metrics': val_metrics,
            'config': self.config,
            'training_history': self.training_history
        }, best_model_path)
        
        logger.info(f"Saved model to {model_path}")
    
    def load_model(self, model: nn.Module, model_path: str) -> nn.Module:
        """Load trained model"""
        
        checkpoint = torch.load(model_path, map_location=self.device)
        model.load_state_dict(checkpoint['model_state_dict'])
        
        logger.info(f"Loaded model from {model_path}")
        return model

def main():
    """Example training script"""
    import yaml
    from data.processors.metro_processor import MetroDataset
    
    # Load configuration
    with open('../../configs/config.yaml', 'r') as f:
        config = yaml.safe_load(f)
    
    # Create trainer
    trainer = DelayTrainer(config)
    
    # Load processed data
    import pandas as pd
    df = pd.read_parquet('../../data/processed/processed_data.parquet')
    
    # Create dataset
    feature_columns = ['hour_sin', 'hour_cos', 'day_sin', 'day_cos', 'is_rush_hour', 'is_weekend']
    target_columns = ['is_delayed']
    
    dataset = MetroDataset(df, feature_columns, target_columns)
    
    # Create data loaders
    train_loader, val_loader, test_loader = trainer.create_data_loaders(dataset)
    
    # Create model
    model = trainer.setup_model('transformer', len(feature_columns))
    
    # Train model
    trained_model = trainer.train(model, train_loader, val_loader)
    
    # Evaluate model
    test_metrics = trainer.evaluate(trained_model, test_loader)
    
    print(f"Training complete! Test metrics: {test_metrics}")

if __name__ == "__main__":
    main()
