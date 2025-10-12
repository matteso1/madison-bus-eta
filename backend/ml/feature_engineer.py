"""
Feature Engineering for Madison Metro ML Models

Creates rich features from raw transit data for arrival time prediction and delay classification.
"""

import pandas as pd
import numpy as np
from datetime import datetime
from pathlib import Path
import joblib
from sklearn.preprocessing import LabelEncoder
import warnings
import sys
warnings.filterwarnings('ignore')

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')


class MetroFeatureEngineer:
    def __init__(self):
        self.encoders = {}
        self.route_stats = {}
        self.stop_stats = {}
        
    def create_temporal_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Extract time-based features"""
        print("Creating temporal features...")
        
        # Ensure datetime
        if not pd.api.types.is_datetime64_any_dtype(df['collection_timestamp']):
            df['collection_timestamp'] = pd.to_datetime(df['collection_timestamp'])
            
        # Hour of day (0-23)
        df['hour'] = df['collection_timestamp'].dt.hour
        
        # Minute of hour (0-59)
        df['minute'] = df['collection_timestamp'].dt.minute
        
        # Day of week (0=Monday, 6=Sunday)
        df['day_of_week'] = df['collection_timestamp'].dt.dayofweek
        
        # Is weekend (0 or 1)
        df['is_weekend'] = (df['day_of_week'] >= 5).astype(int)
        
        # Time period features
        df['is_morning_rush'] = ((df['hour'] >= 7) & (df['hour'] <= 9)).astype(int)
        df['is_evening_rush'] = ((df['hour'] >= 16) & (df['hour'] <= 18)).astype(int)
        df['is_rush_hour'] = (df['is_morning_rush'] | df['is_evening_rush']).astype(int)
        
        # Time of day category (0-3: night, morning, afternoon, evening)
        df['time_period'] = pd.cut(
            df['hour'], 
            bins=[0, 6, 12, 18, 24], 
            labels=[0, 1, 2, 3],
            include_lowest=True
        ).astype(int)
        
        # Cyclical encoding for hour (captures 11pm is close to 1am)
        df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
        df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
        
        # Cyclical encoding for day of week
        df['day_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7)
        df['day_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7)
        
        print(f"  Added {13} temporal features")
        return df
        
    def create_route_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create route-specific features"""
        print("Creating route features...")
        
        # Route category (BRT vs regular)
        df['is_brt'] = df['rt'].str.isalpha().astype(int)  # A-Z routes are BRT
        
        # Encode route as categorical
        if 'rt' not in self.encoders:
            self.encoders['rt'] = LabelEncoder()
            df['route_encoded'] = self.encoders['rt'].fit_transform(df['rt'].astype(str))
        else:
            df['route_encoded'] = self.encoders['rt'].transform(df['rt'].astype(str))
            
        # Historical route statistics
        if not self.route_stats:
            self.route_stats = df.groupby('rt').agg({
                'minutes_until_arrival': ['mean', 'std', 'median'],
                'predicted_minutes': ['mean', 'std'],
                'api_prediction_error': ['mean', 'median']
            }).to_dict()
            
        # Add route statistics as features
        df['route_avg_wait'] = df['rt'].map(
            lambda x: self.route_stats.get(('minutes_until_arrival', 'mean'), {}).get(x, df['minutes_until_arrival'].mean())
        )
        df['route_wait_std'] = df['rt'].map(
            lambda x: self.route_stats.get(('minutes_until_arrival', 'std'), {}).get(x, df['minutes_until_arrival'].std())
        )
        df['route_reliability'] = df['rt'].map(
            lambda x: 1 / (1 + self.route_stats.get(('api_prediction_error', 'mean'), {}).get(x, 1))
        )
        
        print(f"  Added {6} route features")
        return df
        
    def create_stop_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create stop-specific features"""
        print("Creating stop features...")
        
        # Encode stop as categorical
        if 'stpid' not in self.encoders:
            self.encoders['stpid'] = LabelEncoder()
            df['stop_encoded'] = self.encoders['stpid'].fit_transform(df['stpid'].astype(str))
        else:
            df['stop_encoded'] = self.encoders['stpid'].transform(df['stpid'].astype(str))
            
        # Historical stop statistics
        if not self.stop_stats:
            self.stop_stats = df.groupby('stpid').agg({
                'minutes_until_arrival': ['mean', 'std', 'count'],
                'api_prediction_error': ['mean']
            }).to_dict()
            
        # Add stop statistics
        df['stop_avg_wait'] = df['stpid'].map(
            lambda x: self.stop_stats.get(('minutes_until_arrival', 'mean'), {}).get(x, df['minutes_until_arrival'].mean())
        )
        df['stop_frequency'] = df['stpid'].map(
            lambda x: self.stop_stats.get(('minutes_until_arrival', 'count'), {}).get(x, 1)
        )
        df['stop_reliability'] = df['stpid'].map(
            lambda x: 1 / (1 + self.stop_stats.get(('api_prediction_error', 'mean'), {}).get(x, 1))
        )
        
        print(f"  Added {5} stop features")
        return df
        
    def create_interaction_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create interaction features between different variables"""
        print("Creating interaction features...")
        
        # Route-time interactions
        df['route_hour_interaction'] = df['route_encoded'] * df['hour']
        df['route_day_interaction'] = df['route_encoded'] * df['day_of_week']
        
        # Rush hour on weekday
        df['weekday_rush'] = df['is_rush_hour'] * (1 - df['is_weekend'])
        
        # BRT during rush hour (should be more reliable)
        df['brt_rush'] = df['is_brt'] * df['is_rush_hour']
        
        print(f"  Added {4} interaction features")
        return df
        
    def create_prediction_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Features from the API's prediction"""
        print("Creating prediction-based features...")
        
        # API confidence (how far into future they predict)
        df['prediction_horizon'] = df['predicted_minutes']
        
        # Relative to average
        df['predicted_vs_avg'] = df['predicted_minutes'] - df['route_avg_wait']
        
        print(f"  Added {2} prediction features")
        return df
        
    def create_all_features(self, df: pd.DataFrame, fit: bool = True) -> pd.DataFrame:
        """Create all features in proper order"""
        print("\n🔧 Feature Engineering Pipeline")
        print("=" * 60)
        
        df = df.copy()
        
        # Temporal features (no fitting needed)
        df = self.create_temporal_features(df)
        
        # Route features (needs fitting for encoders and stats)
        if fit:
            df = self.create_route_features(df)
        else:
            # Use pre-fitted encoders/stats
            df = self.create_route_features(df)
            
        # Stop features
        if fit:
            df = self.create_stop_features(df)
        else:
            df = self.create_stop_features(df)
            
        # Interaction features
        df = self.create_interaction_features(df)
        
        # Prediction features
        df = self.create_prediction_features(df)
        
        total_features = 13 + 6 + 5 + 4 + 2
        print(f"\n✅ Created {total_features} features")
        print(f"Total columns: {len(df.columns)}")
        
        return df
        
    def get_feature_columns(self) -> list:
        """Get list of all feature columns"""
        temporal_features = [
            'hour', 'minute', 'day_of_week', 'is_weekend',
            'is_morning_rush', 'is_evening_rush', 'is_rush_hour', 'time_period',
            'hour_sin', 'hour_cos', 'day_sin', 'day_cos'
        ]
        
        route_features = [
            'is_brt', 'route_encoded', 'route_avg_wait', 
            'route_wait_std', 'route_reliability'
        ]
        
        stop_features = [
            'stop_encoded', 'stop_avg_wait', 'stop_frequency', 'stop_reliability'
        ]
        
        interaction_features = [
            'route_hour_interaction', 'route_day_interaction',
            'weekday_rush', 'brt_rush'
        ]
        
        prediction_features = [
            'prediction_horizon', 'predicted_vs_avg'
        ]
        
        # Also include the API's prediction as a feature
        api_features = ['predicted_minutes']
        
        return (temporal_features + route_features + stop_features + 
                interaction_features + prediction_features + api_features)
                
    def save_encoders(self, path: str = "ml/encoders/feature_encoders.pkl"):
        """Save encoders and stats"""
        output_file = Path(path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        save_data = {
            'encoders': self.encoders,
            'route_stats': self.route_stats,
            'stop_stats': self.stop_stats
        }
        
        joblib.dump(save_data, output_file)
        print(f"\n💾 Saved encoders to {path}")
        
    def load_encoders(self, path: str = "ml/encoders/feature_encoders.pkl"):
        """Load encoders and stats"""
        load_data = joblib.load(path)
        self.encoders = load_data['encoders']
        self.route_stats = load_data['route_stats']
        self.stop_stats = load_data['stop_stats']
        print(f"📂 Loaded encoders from {path}")


def main():
    """Demo feature engineering pipeline"""
    print("🚀 Madison Metro Feature Engineering Demo")
    print("=" * 60)
    
    # Load consolidated data
    data_file = "ml/data/consolidated_metro_data.csv"
    print(f"\n📂 Loading data from {data_file}")
    df = pd.read_csv(data_file)
    print(f"Loaded {len(df):,} records")
    
    # Create feature engineer
    engineer = MetroFeatureEngineer()
    
    # Engineer features
    df_features = engineer.create_all_features(df, fit=True)
    
    # Show sample
    feature_cols = engineer.get_feature_columns()
    print(f"\n📊 Feature columns ({len(feature_cols)}):")
    for col in feature_cols:
        print(f"  - {col}")
        
    print(f"\n🎯 Target variable: minutes_until_arrival")
    print(f"   Range: {df_features['minutes_until_arrival'].min():.1f} to {df_features['minutes_until_arrival'].max():.1f} minutes")
    
    # Save encoders
    engineer.save_encoders()
    
    # Save feature-engineered data
    output_file = "ml/data/featured_metro_data.csv"
    df_features.to_csv(output_file, index=False)
    file_size = Path(output_file).stat().st_size / 1024 / 1024
    print(f"\n💾 Saved featured data to {output_file} ({file_size:.2f} MB)")
    
    print("\n" + "=" * 60)
    print("✅ Feature engineering complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()

