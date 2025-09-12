#!/usr/bin/env python3
"""
Madison Metro Data Processor
Processes collected CSV data for ML training
"""

import pandas as pd
import numpy as np
import glob
import os
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

class MadisonMetroDataProcessor:
    def __init__(self, data_dir="collected_data"):
        self.data_dir = data_dir
        self.vehicle_data = None
        self.prediction_data = None
        self.processed_data = None
        
    def load_all_data(self):
        """Load and combine all CSV files"""
        print("🔄 Loading Madison Metro data...")
        
        # Load vehicle data
        vehicle_files = glob.glob(f"{self.data_dir}/vehicles_*.csv")
        print(f"📁 Found {len(vehicle_files)} vehicle files")
        
        vehicle_dfs = []
        for file in vehicle_files:
            try:
                df = pd.read_csv(file)
                vehicle_dfs.append(df)
            except Exception as e:
                print(f"⚠️ Error loading {file}: {e}")
        
        if vehicle_dfs:
            self.vehicle_data = pd.concat(vehicle_dfs, ignore_index=True)
            print(f"🚗 Loaded {len(self.vehicle_data):,} vehicle records")
        
        # Load prediction data
        prediction_files = glob.glob(f"{self.data_dir}/predictions_*.csv")
        print(f"📁 Found {len(prediction_files)} prediction files")
        
        prediction_dfs = []
        for file in prediction_files:
            try:
                df = pd.read_csv(file)
                prediction_dfs.append(df)
            except Exception as e:
                print(f"⚠️ Error loading {file}: {e}")
        
        if prediction_dfs:
            self.prediction_data = pd.concat(prediction_dfs, ignore_index=True)
            print(f"🔮 Loaded {len(self.prediction_data):,} prediction records")
        
        print("✅ Data loading complete!")
        return self.vehicle_data, self.prediction_data
    
    def clean_vehicle_data(self):
        """Clean and prepare vehicle data for ML"""
        if self.vehicle_data is None:
            raise ValueError("No vehicle data loaded. Call load_all_data() first.")
        
        print("🧹 Cleaning vehicle data...")
        df = self.vehicle_data.copy()
        
        # Convert timestamps
        df['collection_timestamp'] = pd.to_datetime(df['collection_timestamp'])
        df['tmstmp'] = pd.to_datetime(df['tmstmp'], format='%Y%m%d %H:%M')
        
        # Extract time features
        df['hour'] = df['tmstmp'].dt.hour
        df['day_of_week'] = df['tmstmp'].dt.dayofweek
        df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)
        df['is_rush_hour'] = df['hour'].isin([7, 8, 17, 18]).astype(int)
        
        # Convert delay to binary
        df['is_delayed'] = (df['dly'] == True).astype(int)
        
        # Convert passenger load to numeric
        psgld_mapping = {'EMPTY': 0, 'HALF_EMPTY': 1, 'FULL': 2, 'N/A': 1}
        df['passenger_load_numeric'] = df['psgld'].map(psgld_mapping).fillna(1)
        
        # Speed features
        df['speed_bucket'] = pd.cut(df['spd'], bins=[0, 5, 15, 25, 50], labels=['stopped', 'slow', 'normal', 'fast'])
        df['is_moving'] = (df['spd'] > 0).astype(int)
        
        # Route features
        df['route_type'] = df['rt'].apply(lambda x: 'rapid' if x in ['A', 'B', 'C', 'D', 'E', 'F'] else 'regular')
        
        # Distance features
        df['distance_ratio'] = df['pdist'] / (df.groupby('pid')['pdist'].transform('max') + 1)
        
        # Remove rows with missing critical data
        df = df.dropna(subset=['lat', 'lon', 'spd', 'dly'])
        
        print(f"✅ Cleaned vehicle data: {len(df):,} records")
        return df
    
    def clean_prediction_data(self):
        """Clean and prepare prediction data for ML"""
        if self.prediction_data is None:
            raise ValueError("No prediction data loaded. Call load_all_data() first.")
        
        print("🧹 Cleaning prediction data...")
        df = self.prediction_data.copy()
        
        # Convert timestamps
        df['collection_timestamp'] = pd.to_datetime(df['collection_timestamp'])
        df['tmstmp'] = pd.to_datetime(df['tmstmp'], format='%Y%m%d %H:%M')
        df['prdtm'] = pd.to_datetime(df['prdtm'], format='%Y%m%d %H:%M')
        
        # Extract time features
        df['hour'] = df['tmstmp'].dt.hour
        df['day_of_week'] = df['tmstmp'].dt.dayofweek
        df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)
        df['is_rush_hour'] = df['hour'].isin([7, 8, 17, 18]).astype(int)
        
        # Convert delay to binary
        df['is_delayed'] = (df['dly'] == True).astype(int)
        
        # Convert countdown to numeric
        df['countdown_minutes'] = df['prdctdn'].replace(['DUE', 'DLY'], 0).astype(float)
        
        # Route features
        df['route_type'] = df['rt'].apply(lambda x: 'rapid' if x in ['A', 'B', 'C', 'D', 'E', 'F'] else 'regular')
        
        # Remove rows with missing critical data
        df = df.dropna(subset=['prdctdn', 'dly'])
        
        print(f"✅ Cleaned prediction data: {len(df):,} records")
        return df
    
    def create_ml_features(self, vehicle_df, prediction_df):
        """Create comprehensive ML features"""
        print("🔧 Creating ML features...")
        
        # Vehicle-based features
        vehicle_features = vehicle_df[[
            'vid', 'rt', 'lat', 'lon', 'spd', 'psgld', 'pdist', 'pid',
            'hour', 'day_of_week', 'is_weekend', 'is_rush_hour',
            'is_delayed', 'passenger_load_numeric', 'is_moving',
            'route_type', 'distance_ratio', 'hdg'
        ]].copy()
        
        # Add route performance features
        route_stats = vehicle_df.groupby('rt').agg({
            'is_delayed': ['mean', 'std', 'count'],
            'spd': ['mean', 'std'],
            'passenger_load_numeric': 'mean'
        }).round(3)
        
        route_stats.columns = ['route_delay_rate', 'route_delay_std', 'route_trips', 
                              'route_avg_speed', 'route_speed_std', 'route_avg_load']
        route_stats = route_stats.reset_index()
        
        vehicle_features = vehicle_features.merge(route_stats, on='rt', how='left')
        
        # Prediction-based features
        prediction_features = prediction_df[[
            'stpid', 'rt', 'prdctdn', 'dly', 'dstp', 'hour', 'day_of_week',
            'is_weekend', 'is_rush_hour', 'is_delayed', 'route_type', 'countdown_minutes'
        ]].copy()
        
        # Add stop performance features
        stop_stats = prediction_df.groupby('stpid').agg({
            'is_delayed': ['mean', 'count'],
            'countdown_minutes': 'mean'
        }).round(3)
        
        stop_stats.columns = ['stop_delay_rate', 'stop_predictions', 'stop_avg_countdown']
        stop_stats = stop_stats.reset_index()
        
        prediction_features = prediction_features.merge(stop_stats, on='stpid', how='left')
        
        print(f"✅ Created ML features:")
        print(f"   🚗 Vehicle features: {len(vehicle_features):,} records")
        print(f"   🔮 Prediction features: {len(prediction_features):,} records")
        
        return vehicle_features, prediction_features
    
    def get_data_summary(self):
        """Get comprehensive data summary"""
        if self.vehicle_data is None or self.prediction_data is None:
            return "No data loaded"
        
        summary = {
            'total_records': len(self.vehicle_data) + len(self.prediction_data),
            'vehicle_records': len(self.vehicle_data),
            'prediction_records': len(self.prediction_data),
            'time_span': {
                'start': self.vehicle_data['collection_timestamp'].min(),
                'end': self.vehicle_data['collection_timestamp'].max()
            },
            'routes': self.vehicle_data['rt'].nunique(),
            'vehicles': self.vehicle_data['vid'].nunique(),
            'stops': self.prediction_data['stpid'].nunique(),
            'delay_rate': self.vehicle_data['dly'].mean(),
            'avg_speed': self.vehicle_data['spd'].mean()
        }
        
        return summary

def main():
    """Test the data processor"""
    processor = MadisonMetroDataProcessor()
    
    # Load data
    vehicle_data, prediction_data = processor.load_all_data()
    
    # Clean data
    clean_vehicles = processor.clean_vehicle_data()
    clean_predictions = processor.clean_prediction_data()
    
    # Create ML features
    vehicle_features, prediction_features = processor.create_ml_features(clean_vehicles, clean_predictions)
    
    # Show summary
    summary = processor.get_data_summary()
    print("\n📊 DATA SUMMARY:")
    print(f"Total records: {summary['total_records']:,}")
    print(f"Time span: {summary['time_span']['start']} to {summary['time_span']['end']}")
    print(f"Routes: {summary['routes']}")
    print(f"Vehicles: {summary['vehicles']}")
    print(f"Stops: {summary['stops']}")
    print(f"Delay rate: {summary['delay_rate']:.1%}")
    print(f"Avg speed: {summary['avg_speed']:.1f} mph")
    
    return processor, vehicle_features, prediction_features

if __name__ == "__main__":
    processor, vehicle_features, prediction_features = main()
