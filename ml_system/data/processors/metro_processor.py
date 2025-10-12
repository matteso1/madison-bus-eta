#!/usr/bin/env python3
"""
Madison Metro Data Processor
Processes raw CSV data into ML-ready features
"""

import pandas as pd
import numpy as np
import os
import glob
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
import logging
from pathlib import Path

import torch
from torch.utils.data import Dataset, DataLoader
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MetroDataProcessor:
    """Processes Madison Metro data for ML training"""
    
    def __init__(self, config: Dict):
        self.config = config
        self.scalers = {}
        self.encoders = {}
        self.feature_columns = []
        self.target_columns = []
        
    def load_raw_data(self, source_dir: str) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """Load vehicle and prediction data from CSV files"""
        logger.info(f"Loading data from {source_dir}")
        
        # Load vehicle data
        vehicle_files = glob.glob(f"{source_dir}/vehicles_*.csv")
        vehicle_data = []
        
        for file in vehicle_files:
            try:
                df = pd.read_csv(file)
                vehicle_data.append(df)
            except Exception as e:
                logger.warning(f"Failed to load {file}: {e}")
        
        vehicles_df = pd.concat(vehicle_data, ignore_index=True) if vehicle_data else pd.DataFrame()
        
        # Load prediction data
        prediction_files = glob.glob(f"{source_dir}/predictions_*.csv")
        prediction_data = []
        
        for file in prediction_files:
            try:
                df = pd.read_csv(file)
                prediction_data.append(df)
            except Exception as e:
                logger.warning(f"Failed to load {file}: {e}")
        
        predictions_df = pd.concat(prediction_data, ignore_index=True) if prediction_data else pd.DataFrame()
        
        logger.info(f"Loaded {len(vehicles_df)} vehicle records and {len(predictions_df)} prediction records")
        return vehicles_df, predictions_df
    
    def create_temporal_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create time-based features"""
        df = df.copy()
        
        # Convert timestamps
        df['timestamp'] = pd.to_datetime(df['collection_timestamp'])
        
        # Basic time features
        df['hour'] = df['timestamp'].dt.hour
        df['day_of_week'] = df['timestamp'].dt.dayofweek
        df['month'] = df['timestamp'].dt.month
        df['day_of_year'] = df['timestamp'].dt.dayofyear
        
        # Cyclical encoding for time features
        df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
        df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
        df['day_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7)
        df['day_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7)
        
        # Time period indicators
        df['is_rush_hour'] = ((df['hour'] >= 7) & (df['hour'] <= 9)) | ((df['hour'] >= 17) & (df['hour'] <= 19))
        df['is_weekend'] = df['day_of_week'].isin([5, 6])
        df['is_peak_morning'] = (df['hour'] >= 7) & (df['hour'] <= 9)
        df['is_peak_evening'] = (df['hour'] >= 17) & (df['hour'] <= 19)
        df['is_night'] = (df['hour'] >= 22) | (df['hour'] <= 5)
        
        return df
    
    def create_route_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create route-based features"""
        df = df.copy()
        
        # Route type classification
        rapid_routes = ['A', 'B', 'C', 'D', 'E', 'F']
        uw_routes = ['80', '81', '82', '84']
        major_local = ['28', '38']
        
        df['is_rapid_route'] = df['rt'].isin(rapid_routes)
        df['is_uw_route'] = df['rt'].isin(uw_routes)
        df['is_major_local'] = df['rt'].isin(major_local)
        
        # Route encoding
        if 'rt' not in self.encoders:
            self.encoders['rt'] = LabelEncoder()
            df['rt_encoded'] = self.encoders['rt'].fit_transform(df['rt'].astype(str))
        else:
            df['rt_encoded'] = self.encoders['rt'].transform(df['rt'].astype(str))
        
        return df
    
    def create_vehicle_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create vehicle-specific features"""
        df = df.copy()
        
        # Speed features
        df['speed_kmh'] = df['spd'] * 1.60934  # Convert mph to km/h
        df['is_moving'] = df['spd'] > 0
        df['speed_category'] = pd.cut(df['spd'], bins=[0, 5, 15, 25, 50], labels=['stopped', 'slow', 'normal', 'fast'])
        
        # Passenger load features
        df['is_empty'] = df['psgld'] == 'EMPTY'
        df['is_half_empty'] = df['psgld'] == 'HALF_EMPTY'
        df['is_full'] = df['psgld'] == 'FULL'
        
        # Delay features
        df['is_delayed'] = df['dly'] == True
        
        return df
    
    def create_spatial_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create location-based features"""
        df = df.copy()
        
        # Madison center coordinates
        madison_center_lat = 43.0731
        madison_center_lon = -89.4012
        
        # Distance from center
        df['distance_from_center'] = np.sqrt(
            (df['lat'] - madison_center_lat)**2 + (df['lon'] - madison_center_lon)**2
        )
        
        # Geographic regions (simplified)
        df['is_downtown'] = (df['lat'] >= 43.07) & (df['lat'] <= 43.08) & (df['lon'] >= -89.41) & (df['lon'] <= -89.39)
        df['is_uw_campus'] = (df['lat'] >= 43.07) & (df['lat'] <= 43.08) & (df['lon'] >= -89.42) & (df['lon'] <= -89.40)
        df['is_east_side'] = df['lon'] > -89.40
        df['is_west_side'] = df['lon'] < -89.42
        
        return df
    
    def create_historical_features(self, df: pd.DataFrame, lookback_hours: int = 24) -> pd.DataFrame:
        """Create historical pattern features"""
        df = df.copy()
        df = df.sort_values('timestamp')
        
        # Group by route and direction for historical calculations
        historical_features = []
        
        for (route, direction), group in df.groupby(['rt', 'rtdir']):
            group = group.sort_values('timestamp')
            
            # Rolling averages
            group['avg_speed_1h'] = group['spd'].rolling(window=6, min_periods=1).mean()  # 6 * 10min = 1h
            group['avg_delay_1h'] = group['dly'].rolling(window=6, min_periods=1).mean()
            group['avg_passengers_1h'] = group['is_full'].rolling(window=6, min_periods=1).mean()
            
            # Historical patterns for same time of day
            group['hour'] = group['timestamp'].dt.hour
            group['day_of_week'] = group['timestamp'].dt.dayofweek
            
            # Average delay for same hour/day combination
            delay_by_time = group.groupby(['hour', 'day_of_week'])['dly'].mean()
            group['historical_delay_rate'] = group.apply(
                lambda x: delay_by_time.get((x['hour'], x['day_of_week']), 0.1), axis=1
            )
            
            historical_features.append(group)
        
        if historical_features:
            df = pd.concat(historical_features, ignore_index=True)
        
        return df
    
    def process_data(self, source_dir: str) -> pd.DataFrame:
        """Main data processing pipeline"""
        logger.info("Starting data processing pipeline")
        
        # Load raw data
        vehicles_df, predictions_df = self.load_raw_data(source_dir)
        
        if vehicles_df.empty and predictions_df.empty:
            logger.error("No data found to process")
            return pd.DataFrame()
        
        # Process vehicle data
        if not vehicles_df.empty:
            logger.info("Processing vehicle data")
            vehicles_df = self.create_temporal_features(vehicles_df)
            vehicles_df = self.create_route_features(vehicles_df)
            vehicles_df = self.create_vehicle_features(vehicles_df)
            vehicles_df = self.create_spatial_features(vehicles_df)
            vehicles_df = self.create_historical_features(vehicles_df)
        
        # Process prediction data
        if not predictions_df.empty:
            logger.info("Processing prediction data")
            predictions_df = self.create_temporal_features(predictions_df)
            predictions_df = self.create_route_features(predictions_df)
            predictions_df = self.create_spatial_features(predictions_df)
            
            # Convert prediction time to delay in minutes
            predictions_df['predicted_delay'] = predictions_df['prdctdn'].apply(
                lambda x: 0 if x == 'DUE' else int(x) if str(x).isdigit() else 0
            )
        
        # Combine datasets
        if not vehicles_df.empty and not predictions_df.empty:
            # Merge on route, timestamp, and vehicle ID
            combined_df = pd.merge(
                vehicles_df, 
                predictions_df[['rt', 'vid', 'timestamp', 'predicted_delay', 'stpid']], 
                on=['rt', 'vid', 'timestamp'], 
                how='left'
            )
        elif not vehicles_df.empty:
            combined_df = vehicles_df
        else:
            combined_df = predictions_df
        
        # Final feature selection
        feature_columns = [
            'hour_sin', 'hour_cos', 'day_sin', 'day_cos',
            'is_rush_hour', 'is_weekend', 'is_peak_morning', 'is_peak_evening', 'is_night',
            'is_rapid_route', 'is_uw_route', 'is_major_local', 'rt_encoded',
            'speed_kmh', 'is_moving', 'is_empty', 'is_half_empty', 'is_full',
            'distance_from_center', 'is_downtown', 'is_uw_campus', 'is_east_side', 'is_west_side',
            'avg_speed_1h', 'avg_delay_1h', 'avg_passengers_1h', 'historical_delay_rate'
        ]
        
        # Only include columns that exist
        available_features = [col for col in feature_columns if col in combined_df.columns]
        self.feature_columns = available_features
        
        # Target columns
        target_columns = ['is_delayed', 'predicted_delay']
        self.target_columns = [col for col in target_columns if col in combined_df.columns]
        
        logger.info(f"Created {len(available_features)} features and {len(self.target_columns)} targets")
        logger.info(f"Final dataset shape: {combined_df.shape}")
        
        return combined_df
    
    def save_processed_data(self, df: pd.DataFrame, output_dir: str):
        """Save processed data and encoders"""
        os.makedirs(output_dir, exist_ok=True)
        
        # Save processed data
        output_file = f"{output_dir}/processed_data.parquet"
        df.to_parquet(output_file, index=False)
        logger.info(f"Saved processed data to {output_file}")
        
        # Save encoders and scalers
        import joblib
        encoders_file = f"{output_dir}/encoders.pkl"
        joblib.dump(self.encoders, encoders_file)
        
        scalers_file = f"{output_dir}/scalers.pkl"
        joblib.dump(self.scalers, scalers_file)
        
        # Save feature metadata
        metadata = {
            'feature_columns': self.feature_columns,
            'target_columns': self.target_columns,
            'num_samples': len(df),
            'processed_at': datetime.now().isoformat()
        }
        
        import json
        metadata_file = f"{output_dir}/metadata.json"
        with open(metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        logger.info(f"Saved metadata to {metadata_file}")

class MetroDataset(Dataset):
    """PyTorch Dataset for Madison Metro data"""
    
    def __init__(self, df: pd.DataFrame, feature_columns: List[str], target_columns: List[str], 
                 sequence_length: int = 24):
        self.df = df.sort_values('timestamp').reset_index(drop=True)
        self.feature_columns = feature_columns
        self.target_columns = target_columns
        self.sequence_length = sequence_length
        
        # Prepare features and targets
        self.features = torch.FloatTensor(df[feature_columns].values)
        self.targets = torch.FloatTensor(df[target_columns].values) if target_columns else None
        
    def __len__(self):
        return len(self.df) - self.sequence_length + 1
    
    def __getitem__(self, idx):
        # Get sequence of features
        feature_sequence = self.features[idx:idx + self.sequence_length]
        
        if self.targets is not None:
            # Target is the last value in the sequence
            target = self.targets[idx + self.sequence_length - 1]
            return feature_sequence, target
        else:
            return feature_sequence

def main():
    """Main processing function"""
    import yaml
    
    # Load configuration
    with open('../configs/config.yaml', 'r') as f:
        config = yaml.safe_load(f)
    
    # Initialize processor
    processor = MetroDataProcessor(config)
    
    # Process data
    processed_df = processor.process_data(config['data']['source_dir'])
    
    if not processed_df.empty:
        # Save processed data
        processor.save_processed_data(processed_df, config['data']['processed_dir'])
        print(f"✅ Data processing complete! Processed {len(processed_df)} records")
    else:
        print("❌ No data to process")

if __name__ == "__main__":
    main()
