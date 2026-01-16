"""
Model Registry for Madison Bus ETA ML Pipeline.

Handles model versioning, saving, and loading.
"""

import os
import json
import pickle
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any

# Model storage directory
MODELS_DIR = Path(__file__).parent / 'saved'
MODELS_DIR.mkdir(exist_ok=True)

# Registry file (tracks all models)
REGISTRY_FILE = MODELS_DIR / 'registry.json'


def _load_registry() -> Dict[str, Any]:
    """Load the model registry from disk."""
    if REGISTRY_FILE.exists():
        with open(REGISTRY_FILE, 'r') as f:
            return json.load(f)
    return {'models': [], 'latest': None}


def _save_registry(registry: Dict[str, Any]) -> None:
    """Save the model registry to disk."""
    with open(REGISTRY_FILE, 'w') as f:
        json.dump(registry, f, indent=2, default=str)


def save_model(model, metrics: Dict[str, Any], notes: str = "") -> str:
    """
    Save a trained model with versioning.
    
    Args:
        model: Trained model object (e.g., XGBClassifier)
        metrics: Dictionary of performance metrics
        notes: Optional notes about this model version
    
    Returns:
        Path to saved model file.
    """
    timestamp = datetime.now(timezone.utc)
    version = timestamp.strftime('%Y%m%d_%H%M%S')
    
    # Save model file
    model_filename = f'model_{version}.pkl'
    model_path = MODELS_DIR / model_filename
    
    with open(model_path, 'wb') as f:
        pickle.dump(model, f)
    
    # Update registry
    registry = _load_registry()
    
    model_entry = {
        'version': version,
        'filename': model_filename,
        'created_at': timestamp.isoformat(),
        'metrics': {
            'accuracy': metrics.get('accuracy'),
            'precision': metrics.get('precision'),
            'recall': metrics.get('recall'),
            'f1': metrics.get('f1'),
            'train_samples': metrics.get('train_samples'),
            'test_samples': metrics.get('test_samples'),
        },
        'feature_importance': metrics.get('feature_importance', {}),
        'notes': notes
    }
    
    registry['models'].append(model_entry)
    registry['latest'] = version
    
    _save_registry(registry)
    
    return str(model_path)


def load_model(version: Optional[str] = None):
    """
    Load a model from the registry.
    
    Args:
        version: Specific version to load. If None, loads latest.
    
    Returns:
        Loaded model object or None if not found.
    """
    registry = _load_registry()
    
    if version is None:
        version = registry.get('latest')
    
    if version is None:
        return None
    
    # Find model entry
    model_entry = None
    for entry in registry['models']:
        if entry['version'] == version:
            model_entry = entry
            break
    
    if model_entry is None:
        return None
    
    model_path = MODELS_DIR / model_entry['filename']
    if not model_path.exists():
        return None
    
    with open(model_path, 'rb') as f:
        return pickle.load(f)


def load_latest_model():
    """Load the latest model from registry."""
    return load_model(version=None)


def get_model_info(version: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Get metadata about a model version."""
    registry = _load_registry()
    
    if version is None:
        version = registry.get('latest')
    
    if version is None:
        return None
    
    for entry in registry['models']:
        if entry['version'] == version:
            return entry
    
    return None


def list_models() -> list:
    """List all available model versions with their metrics."""
    registry = _load_registry()
    return registry.get('models', [])


def get_latest_version() -> Optional[str]:
    """Get the version string of the latest model."""
    registry = _load_registry()
    return registry.get('latest')
