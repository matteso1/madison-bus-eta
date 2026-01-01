import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
import joblib
import os
from datetime import datetime, timedelta

class MadisonMetroDataProcessor:
    def __init__(self):
        self.scalers = {}
        self.encoders = {}
        self.feature_columns = []
        self.target_column = 'delay_minutes'
        
    def load_data(self, file_path):
        """Load and preprocess Madison Metro data"""
        try:
            df = pd.read_csv(file_path)
            print(f"Loaded {len(df)} records from {file_path}")
            return df
        except Exception as e:
            print(f"Error loading data: {e}")
            return None
    
    def create_features(self, df):
        """Create features for ML model"""
        if df is None or len(df) == 0:
            return None
            
        # Convert timestamp to datetime
        df['timestamp'] = pd.to_datetime(df['collection_timestamp'])
        
        # Extract time features
        df['hour'] = df['timestamp'].dt.hour
        df['day_of_week'] = df['timestamp'].dt.dayofweek
        df['month'] = df['timestamp'].dt.month
        
        # Create time-based features
        df['is_rush_hour'] = ((df['hour'] >= 7) & (df['hour'] <= 9)) | ((df['hour'] >= 17) & (df['hour'] <= 19))
        df['is_weekend'] = df['day_of_week'].isin([5, 6])
        df['is_peak_morning'] = (df['hour'] >= 7) & (df['hour'] <= 9)
        df['is_peak_evening'] = (df['hour'] >= 17) & (df['hour'] <= 19)
        
        # Route type features
        df['is_rapid_route'] = df['rt'].isin(['A', 'B', 'C', 'D', 'E', 'F'])
        df['is_uw_route'] = df['rt'].isin(['80', '81', '82', '84'])
        
        # Calculate delay if not present
        if 'delay_minutes' not in df.columns:
            if 'prdctdn' in df.columns:
                # Handle non-numeric values like 'DUE'
                df['delay_minutes'] = pd.to_numeric(df['prdctdn'], errors='coerce').fillna(0)
            else:
                df['delay_minutes'] = 0
        
        # Remove outliers
        df = df[(df['delay_minutes'] >= 0) & (df['delay_minutes'] <= 30)]
        
        return df
    
    def prepare_features(self, df):
        """Prepare features for training"""
        if df is None or len(df) == 0:
            return None, None
            
        # Select features
        feature_columns = [
            'hour', 'day_of_week', 'month', 'is_rush_hour', 'is_weekend',
            'is_peak_morning', 'is_peak_evening', 'is_rapid_route', 'is_uw_route'
        ]
        
        # Add route and direction if available
        if 'rt' in df.columns:
            feature_columns.append('rt')
        if 'rtdir' in df.columns:
            feature_columns.append('rtdir')
            
        # Filter available columns
        available_features = [col for col in feature_columns if col in df.columns]
        
        X = df[available_features].copy()
        y = df['delay_minutes'] if 'delay_minutes' in df.columns else None
        
        # Encode categorical variables
        for col in X.select_dtypes(include=['object']).columns:
            if col not in self.encoders:
                self.encoders[col] = LabelEncoder()
                X[col] = self.encoders[col].fit_transform(X[col].astype(str))
            else:
                X[col] = self.encoders[col].transform(X[col].astype(str))
        
        # Scale numerical features
        numerical_cols = X.select_dtypes(include=[np.number]).columns
        for col in numerical_cols:
            if col not in self.scalers:
                self.scalers[col] = StandardScaler()
                X[col] = self.scalers[col].fit_transform(X[[col]])
            else:
                X[col] = self.scalers[col].transform(X[[col]])
        
        self.feature_columns = available_features
        return X, y
    
    def save_encoders(self, filepath):
        """Save encoders and scalers"""
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        joblib.dump({
            'scalers': self.scalers,
            'encoders': self.encoders,
            'feature_columns': self.feature_columns
        }, filepath)
        print(f"Encoders saved to {filepath}")
    
    def load_encoders(self, filepath):
        """Load encoders and scalers"""
        try:
            data = joblib.load(filepath)
            self.scalers = data['scalers']
            self.encoders = data['encoders']
            self.feature_columns = data['feature_columns']
            print(f"Encoders loaded from {filepath}")
            return True
        except Exception as e:
            print(f"Error loading encoders: {e}")
            return False
