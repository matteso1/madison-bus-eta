#!/usr/bin/env python3
"""
Setup ML models and data for Madison Metro ML
This script trains models and creates necessary files for the ML system
"""

import os
import sys
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

# Add the current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from ml.train_models import ModelTrainer
from ml.data_processor import MadisonMetroDataProcessor

def create_sample_data():
    """Create sample data for ML training"""
    print("Creating sample data for ML training...")
    
    # Create data directory
    os.makedirs('collected_data', exist_ok=True)
    
    # Generate sample prediction data
    np.random.seed(42)
    n_samples = 5000
    
    # Create realistic bus prediction data
    data = []
    routes = ['A', 'B', 'C', 'D', 'E', 'F', '80', '81', '82', '84']
    directions = ['Northbound', 'Southbound', 'Eastbound', 'Westbound']
    
    start_date = datetime.now() - timedelta(days=30)
    
    for i in range(n_samples):
        # Generate timestamp
        timestamp = start_date + timedelta(minutes=i * 5)
        
        # Generate route and direction
        route = np.random.choice(routes)
        direction = np.random.choice(directions)
        
        # Generate realistic delay based on time patterns
        hour = timestamp.hour
        day_of_week = timestamp.weekday()
        
        # Base delay patterns
        if 7 <= hour <= 9 or 17 <= hour <= 19:  # Rush hours
            base_delay = np.random.normal(3.5, 1.5)
        elif 22 <= hour or hour <= 5:  # Night
            base_delay = np.random.normal(1.0, 0.5)
        else:  # Regular hours
            base_delay = np.random.normal(2.0, 1.0)
        
        # Weekend effect
        if day_of_week >= 5:  # Weekend
            base_delay *= 0.8
        
        # Route effect
        if route in ['A', 'B', 'C', 'D', 'E', 'F']:  # Rapid routes
            base_delay *= 0.9
        elif route in ['80', '81', '82', '84']:  # UW routes
            base_delay *= 1.1
        
        # Add some noise
        delay = max(0, base_delay + np.random.normal(0, 0.5))
        
        data.append({
            'collection_timestamp': timestamp.isoformat(),
            'rt': route,
            'rtdir': direction,
            'stpid': np.random.randint(1000, 9999),
            'prdctdn': round(delay, 1),
            'vid': f"bus_{np.random.randint(1000, 9999)}",
            'des': f"{direction} Destination",
            'dly': 'true' if delay > 3 else 'false'
        })
    
    # Create DataFrame and save
    df = pd.DataFrame(data)
    df.to_csv('collected_data/sample_predictions.csv', index=False)
    print(f"Created sample data with {len(df)} records")
    
    return df

def train_models():
    """Train ML models"""
    print("Training ML models...")
    
    trainer = ModelTrainer()
    
    # Create sample data if no real data exists
    data_files = []
    if os.path.exists('collected_data'):
        for file in os.listdir('collected_data'):
            if file.endswith('.csv') and 'predictions' in file:
                data_files.append(os.path.join('collected_data', file))
    
    if not data_files:
        print("No real data found yet. Need to collect real data first.")
        print("Start the data collector and wait for real data to accumulate.")
        return
    
    # Load and prepare data
    X, y = trainer.load_and_prepare_data(data_files)
    
    if X is not None and y is not None:
        # Train models
        best_model = trainer.train_models(X, y)
        
        # Save models and encoders
        trainer.save_models('ml/models')
        trainer.processor.save_encoders('ml/encoders.pkl')
        
        print(f"Best model: {best_model}")
        print("Models and encoders saved successfully!")
        
        # Generate insights
        insights = trainer.generate_insights()
        print("\nGenerated Insights:")
        for insight in insights:
            print(f"- {insight['title']}: {insight['description']}")
    else:
        print("Failed to load data for training")

def main():
    """Main setup function"""
    print("Setting up Madison Metro ML system...")
    
    # Create necessary directories
    os.makedirs('ml/models', exist_ok=True)
    os.makedirs('collected_data', exist_ok=True)
    
    # Train models
    train_models()
    
    print("\nML setup complete!")
    print("You can now start the backend server and the ML endpoints will be available.")

if __name__ == "__main__":
    main()
