"""
Madison Metro Bus ETA Prediction - ML Training Pipeline
Optimized for RTX 4090 with comprehensive data processing
"""

import pandas as pd
import numpy as np
import os
import glob
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

# ML Libraries
from sklearn.model_selection import train_test_split, TimeSeriesSplit
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression, Ridge, Lasso
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import StandardScaler, LabelEncoder
import xgboost as xgb
import lightgbm as lgb

# Deep Learning
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout, BatchNormalization
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau

# Visualization
import matplotlib.pyplot as plt
import seaborn as sns

class MadisonMetroMLPipeline:
    def __init__(self, data_dir="../collected_data"):
        self.data_dir = data_dir
        self.vehicle_data = None
        self.prediction_data = None
        self.processed_data = None
        self.models = {}
        self.scalers = {}
        self.encoders = {}
        
        # Configure TensorFlow for GPU
        self.configure_gpu()
        
    def configure_gpu(self):
        """Configure TensorFlow to use GPU efficiently"""
        gpus = tf.config.experimental.list_physical_devices('GPU')
        if gpus:
            try:
                for gpu in gpus:
                    tf.config.experimental.set_memory_growth(gpu, True)
                print(f"✅ GPU configured: {len(gpus)} GPU(s) available")
            except RuntimeError as e:
                print(f"GPU configuration error: {e}")
        else:
            print("⚠️ No GPU found, using CPU")
    
    def load_all_data(self):
        """Load and combine all CSV files"""
        print("🔄 Loading all data files...")
        
        # Load vehicle data
        vehicle_files = glob.glob(os.path.join(self.data_dir, "vehicles_*.csv"))
        vehicle_dfs = []
        
        for file in vehicle_files:
            try:
                df = pd.read_csv(file)
                vehicle_dfs.append(df)
            except Exception as e:
                print(f"⚠️ Error loading {file}: {e}")
        
        if vehicle_dfs:
            self.vehicle_data = pd.concat(vehicle_dfs, ignore_index=True)
            print(f"✅ Loaded {len(vehicle_dfs)} vehicle files: {len(self.vehicle_data)} records")
        else:
            print("❌ No vehicle data found")
            return False
        
        # Load prediction data
        prediction_files = glob.glob(os.path.join(self.data_dir, "predictions_*.csv"))
        prediction_dfs = []
        
        for file in prediction_files:
            try:
                df = pd.read_csv(file)
                prediction_dfs.append(df)
            except Exception as e:
                print(f"⚠️ Error loading {file}: {e}")
        
        if prediction_dfs:
            self.prediction_data = pd.concat(prediction_dfs, ignore_index=True)
            print(f"✅ Loaded {len(prediction_files)} prediction files: {len(self.prediction_data)} records")
        else:
            print("❌ No prediction data found")
            return False
        
        return True
    
    def clean_and_preprocess(self):
        """Clean and preprocess the data for ML training"""
        print("🔄 Cleaning and preprocessing data...")
        
        # Clean vehicle data
        if self.vehicle_data is not None:
            # Convert timestamps
            self.vehicle_data['collection_timestamp'] = pd.to_datetime(self.vehicle_data['collection_timestamp'])
            self.vehicle_data['tmstmp'] = pd.to_datetime(self.vehicle_data['tmstmp'])
            
            # Handle missing values
            self.vehicle_data = self.vehicle_data.dropna(subset=['lat', 'lon', 'rt'])
            
            # Convert delay to binary
            self.vehicle_data['dly'] = self.vehicle_data['dly'].astype(int)
            
            # Convert passenger load to numeric
            psgld_mapping = {'EMPTY': 0, 'LIGHT': 1, 'HALF_EMPTY': 2, 'FULL': 3}
            self.vehicle_data['psgld_numeric'] = self.vehicle_data['psgld'].map(psgld_mapping).fillna(0)
            
            print(f"✅ Vehicle data cleaned: {len(self.vehicle_data)} records")
        
        # Clean prediction data
        if self.prediction_data is not None:
            # Convert timestamps
            self.prediction_data['collection_timestamp'] = pd.to_datetime(self.prediction_data['collection_timestamp'])
            self.prediction_data['prdtm'] = pd.to_datetime(self.prediction_data['prdtm'])
            
            # Handle missing values
            self.prediction_data = self.prediction_data.dropna(subset=['stpid', 'rt', 'prdctdn'])
            
            # Convert prediction countdown to numeric
            self.prediction_data['prdctdn_numeric'] = pd.to_numeric(
                self.prediction_data['prdctdn'].replace('DUE', 0).replace('DLY', -1), 
                errors='coerce'
            ).fillna(0)
            
            # Calculate actual delay (if available)
            self.prediction_data['actual_delay'] = (
                self.prediction_data['prdtm'] - self.prediction_data['collection_timestamp']
            ).dt.total_seconds() / 60  # Convert to minutes
            
            print(f"✅ Prediction data cleaned: {len(self.prediction_data)} records")
        
        return True
    
    def create_features(self):
        """Create features for ML training"""
        print("🔄 Creating features...")
        
        # Combine vehicle and prediction data for comprehensive features
        combined_data = []
        
        if self.vehicle_data is not None and self.prediction_data is not None:
            # Merge on route and timestamp proximity
            for _, pred in self.prediction_data.iterrows():
                # Find vehicles on same route within 5 minutes
                time_window = timedelta(minutes=5)
                vehicles = self.vehicle_data[
                    (self.vehicle_data['rt'] == pred['rt']) &
                    (abs(self.vehicle_data['collection_timestamp'] - pred['collection_timestamp']) <= time_window)
                ]
                
                if not vehicles.empty:
                    # Use the closest vehicle
                    closest_vehicle = vehicles.iloc[0]
                    
                    # Create feature row
                    feature_row = {
                        'route': pred['rt'],
                        'stop_id': pred['stpid'],
                        'vehicle_lat': closest_vehicle['lat'],
                        'vehicle_lon': closest_vehicle['lon'],
                        'vehicle_speed': closest_vehicle['spd'],
                        'vehicle_delay': closest_vehicle['dly'],
                        'passenger_load': closest_vehicle['psgld_numeric'],
                        'distance_to_stop': pred.get('dstp', 0),
                        'predicted_countdown': pred['prdctdn_numeric'],
                        'actual_delay': pred['actual_delay'],
                        'hour': pred['collection_timestamp'].hour,
                        'day_of_week': pred['collection_timestamp'].dayofweek,
                        'is_weekend': pred['collection_timestamp'].dayofweek >= 5,
                        'collection_time': pred['collection_timestamp']
                    }
                    combined_data.append(feature_row)
        
        self.processed_data = pd.DataFrame(combined_data)
        
        if not self.processed_data.empty:
            print(f"✅ Features created: {len(self.processed_data)} samples")
            
            # Add more engineered features
            self.processed_data['speed_squared'] = self.processed_data['vehicle_speed'] ** 2
            self.processed_data['distance_speed_ratio'] = (
                self.processed_data['distance_to_stop'] / (self.processed_data['vehicle_speed'] + 1)
            )
            self.processed_data['is_rush_hour'] = (
                (self.processed_data['hour'] >= 7) & (self.processed_data['hour'] <= 9) |
                (self.processed_data['hour'] >= 16) & (self.processed_data['hour'] <= 18)
            )
            
            return True
        else:
            print("❌ No combined data created")
            return False
    
    def prepare_training_data(self):
        """Prepare data for model training"""
        print("🔄 Preparing training data...")
        
        if self.processed_data is None or self.processed_data.empty:
            print("❌ No processed data available")
            return False
        
        # Select features
        feature_columns = [
            'vehicle_lat', 'vehicle_lon', 'vehicle_speed', 'vehicle_delay',
            'passenger_load', 'distance_to_stop', 'hour', 'day_of_week',
            'is_weekend', 'speed_squared', 'distance_speed_ratio', 'is_rush_hour'
        ]
        
        # Encode categorical variables
        le_route = LabelEncoder()
        le_stop = LabelEncoder()
        
        # Convert to string to handle mixed types
        self.processed_data['route_encoded'] = le_route.fit_transform(self.processed_data['route'].astype(str))
        self.processed_data['stop_encoded'] = le_stop.fit_transform(self.processed_data['stop_id'].astype(str))
        
        self.encoders['route'] = le_route
        self.encoders['stop'] = le_stop
        
        feature_columns.extend(['route_encoded', 'stop_encoded'])
        
        X = self.processed_data[feature_columns]
        y = self.processed_data['actual_delay']
        
        # Remove infinite values
        X = X.replace([np.inf, -np.inf], np.nan)
        X = X.fillna(X.median())
        
        # Split data (time series split for temporal data)
        split_point = int(len(X) * 0.8)
        X_train, X_test = X[:split_point], X[split_point:]
        y_train, y_test = y[:split_point], y[split_point:]
        
        # Scale features
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        self.scalers['main'] = scaler
        
        self.X_train, self.X_test = X_train_scaled, X_test_scaled
        self.y_train, self.y_test = y_train, y_test
        
        print(f"✅ Training data prepared: {len(X_train)} train, {len(X_test)} test samples")
        return True
    
    def train_models(self):
        """Train multiple ML models"""
        print("🔄 Training models...")
        
        if not hasattr(self, 'X_train'):
            print("❌ No training data available")
            return False
        
        # 1. Linear Regression
        print("Training Linear Regression...")
        lr = LinearRegression()
        lr.fit(self.X_train, self.y_train)
        self.models['linear_regression'] = lr
        
        # 2. Random Forest
        print("Training Random Forest...")
        rf = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
        rf.fit(self.X_train, self.y_train)
        self.models['random_forest'] = rf
        
        # 3. XGBoost
        print("Training XGBoost...")
        xgb_model = xgb.XGBRegressor(
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
            random_state=42,
            n_jobs=-1
        )
        xgb_model.fit(self.X_train, self.y_train)
        self.models['xgboost'] = xgb_model
        
        # 4. LightGBM
        print("Training LightGBM...")
        lgb_model = lgb.LGBMRegressor(
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
            random_state=42,
            n_jobs=-1
        )
        lgb_model.fit(self.X_train, self.y_train)
        self.models['lightgbm'] = lgb_model
        
        # 5. Neural Network
        print("Training Neural Network...")
        self.train_neural_network()
        
        print("✅ All models trained successfully!")
        return True
    
    def train_neural_network(self):
        """Train a neural network model"""
        model = Sequential([
            Dense(128, activation='relu', input_shape=(self.X_train.shape[1],)),
            BatchNormalization(),
            Dropout(0.3),
            Dense(64, activation='relu'),
            BatchNormalization(),
            Dropout(0.3),
            Dense(32, activation='relu'),
            Dropout(0.2),
            Dense(1, activation='linear')
        ])
        
        model.compile(
            optimizer=Adam(learning_rate=0.001),
            loss='mse',
            metrics=['mae']
        )
        
        callbacks = [
            EarlyStopping(patience=10, restore_best_weights=True),
            ReduceLROnPlateau(factor=0.5, patience=5)
        ]
        
        history = model.fit(
            self.X_train, self.y_train,
            validation_data=(self.X_test, self.y_test),
            epochs=100,
            batch_size=32,
            callbacks=callbacks,
            verbose=0
        )
        
        self.models['neural_network'] = model
        self.nn_history = history
    
    def evaluate_models(self):
        """Evaluate all trained models"""
        print("🔄 Evaluating models...")
        
        results = {}
        
        for name, model in self.models.items():
            if name == 'neural_network':
                y_pred = model.predict(self.X_test).flatten()
            else:
                y_pred = model.predict(self.X_test)
            
            mae = mean_absolute_error(self.y_test, y_pred)
            mse = mean_squared_error(self.y_test, y_pred)
            rmse = np.sqrt(mse)
            r2 = r2_score(self.y_test, y_pred)
            
            results[name] = {
                'MAE': mae,
                'MSE': mse,
                'RMSE': rmse,
                'R2': r2
            }
            
            print(f"{name:20} - MAE: {mae:.2f}, RMSE: {rmse:.2f}, R²: {r2:.3f}")
        
        self.evaluation_results = results
        return results
    
    def save_models(self, save_dir="ml/models"):
        """Save trained models and scalers"""
        os.makedirs(save_dir, exist_ok=True)
        
        # Save scikit-learn models
        import joblib
        for name, model in self.models.items():
            if name != 'neural_network':
                joblib.dump(model, os.path.join(save_dir, f"{name}.pkl"))
        
        # Save neural network
        if 'neural_network' in self.models:
            self.models['neural_network'].save(os.path.join(save_dir, "neural_network.h5"))
        
        # Save scalers and encoders
        joblib.dump(self.scalers, os.path.join(save_dir, "scalers.pkl"))
        joblib.dump(self.encoders, os.path.join(save_dir, "encoders.pkl"))
        
        print(f"✅ Models saved to {save_dir}")
    
    def run_full_pipeline(self):
        """Run the complete ML pipeline"""
        print("🚀 Starting Madison Metro ML Pipeline")
        print("=" * 50)
        
        # Load data
        if not self.load_all_data():
            return False
        
        # Clean and preprocess
        if not self.clean_and_preprocess():
            return False
        
        # Create features
        if not self.create_features():
            return False
        
        # Prepare training data
        if not self.prepare_training_data():
            return False
        
        # Train models
        if not self.train_models():
            return False
        
        # Evaluate models
        self.evaluate_models()
        
        # Save models
        self.save_models()
        
        print("=" * 50)
        print("🎉 ML Pipeline completed successfully!")
        return True

def main():
    """Main function to run the ML pipeline"""
    pipeline = MadisonMetroMLPipeline()
    success = pipeline.run_full_pipeline()
    
    if success:
        print("\n📊 Model Performance Summary:")
        print("-" * 30)
        for model_name, metrics in pipeline.evaluation_results.items():
            print(f"{model_name}:")
            for metric, value in metrics.items():
                print(f"  {metric}: {value:.3f}")
            print()
        
        print("🎯 Next Steps:")
        print("1. Review model performance")
        print("2. Fine-tune hyperparameters")
        print("3. Collect more data for better accuracy")
        print("4. Deploy best model to production")
    else:
        print("❌ Pipeline failed. Check the logs above.")

if __name__ == "__main__":
    main()
