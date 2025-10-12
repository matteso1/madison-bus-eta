"""
Train Arrival Time Prediction Models

Trains multiple ML models to predict bus arrival times and compares against API baseline.
"""

import pandas as pd
import numpy as np
from pathlib import Path
import joblib
import json
from datetime import datetime
import sys
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
import xgboost as xgb
import lightgbm as lgb
import warnings
warnings.filterwarnings('ignore')

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')


class ArrivalTimeModelTrainer:
    def __init__(self, data_path: str = "ml/data/featured_metro_data.csv"):
        self.data_path = data_path
        self.models = {}
        self.results = {}
        self.feature_columns = None
        self.X_train = None
        self.X_test = None
        self.y_train = None
        self.y_test = None
        self.api_predictions_test = None
        
    def load_data(self):
        """Load and prepare data for training"""
        print("📂 Loading featured data...")
        df = pd.read_csv(self.data_path)
        print(f"Loaded {len(df):,} records")
        
        # Feature columns
        self.feature_columns = [
            'hour', 'minute', 'day_of_week', 'is_weekend',
            'is_morning_rush', 'is_evening_rush', 'is_rush_hour', 'time_period',
            'hour_sin', 'hour_cos', 'day_sin', 'day_cos',
            'is_brt', 'route_encoded', 'route_avg_wait', 
            'route_wait_std', 'route_reliability',
            'stop_encoded', 'stop_avg_wait', 'stop_frequency', 'stop_reliability',
            'route_hour_interaction', 'route_day_interaction',
            'weekday_rush', 'brt_rush',
            'prediction_horizon', 'predicted_vs_avg', 'predicted_minutes'
        ]
        
        # Target variable
        target = 'minutes_until_arrival'
        
        # Remove any NaN values
        df = df.dropna(subset=self.feature_columns + [target])
        
        X = df[self.feature_columns]
        y = df[target]
        
        # Store API predictions for comparison
        api_predictions = df['predicted_minutes']
        
        # Train-test split (80-20)
        self.X_train, self.X_test, self.y_train, self.y_test, api_train, self.api_predictions_test = train_test_split(
            X, y, api_predictions, test_size=0.2, random_state=42
        )
        
        print(f"\n✅ Data prepared:")
        print(f"   Train: {len(self.X_train):,} samples")
        print(f"   Test: {len(self.X_test):,} samples")
        print(f"   Features: {len(self.feature_columns)}")
        
        return self.X_train, self.X_test, self.y_train, self.y_test
        
    def evaluate_model(self, name: str, predictions: np.ndarray) -> dict:
        """Evaluate model performance"""
        mae = mean_absolute_error(self.y_test, predictions)
        mse = mean_squared_error(self.y_test, predictions)
        rmse = np.sqrt(mse)
        r2 = r2_score(self.y_test, predictions)
        
        # Calculate percentage of predictions within X minutes
        errors = np.abs(self.y_test - predictions)
        within_1min = (errors <= 1).mean() * 100
        within_2min = (errors <= 2).mean() * 100
        within_5min = (errors <= 5).mean() * 100
        
        results = {
            'name': name,
            'mae': float(mae),
            'rmse': float(rmse),
            'r2': float(r2),
            'within_1min': float(within_1min),
            'within_2min': float(within_2min),
            'within_5min': float(within_5min)
        }
        
        return results
        
    def train_random_forest(self):
        """Train Random Forest Regressor"""
        print("\n🌲 Training Random Forest...")
        
        model = RandomForestRegressor(
            n_estimators=100,
            max_depth=20,
            min_samples_split=10,
            min_samples_leaf=4,
            random_state=42,
            n_jobs=-1,
            verbose=0
        )
        
        model.fit(self.X_train, self.y_train)
        predictions = model.predict(self.X_test)
        
        results = self.evaluate_model("Random Forest", predictions)
        
        self.models['random_forest'] = model
        self.results['random_forest'] = results
        
        print(f"   MAE: {results['mae']:.3f} minutes")
        print(f"   RMSE: {results['rmse']:.3f} minutes")
        print(f"   R²: {results['r2']:.3f}")
        
        return model, results
        
    def train_xgboost(self):
        """Train XGBoost Regressor"""
        print("\n🚀 Training XGBoost...")
        
        model = xgb.XGBRegressor(
            n_estimators=100,
            max_depth=8,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            n_jobs=-1,
            verbosity=0
        )
        
        model.fit(self.X_train, self.y_train)
        predictions = model.predict(self.X_test)
        
        results = self.evaluate_model("XGBoost", predictions)
        
        self.models['xgboost'] = model
        self.results['xgboost'] = results
        
        print(f"   MAE: {results['mae']:.3f} minutes")
        print(f"   RMSE: {results['rmse']:.3f} minutes")
        print(f"   R²: {results['r2']:.3f}")
        
        return model, results
        
    def train_lightgbm(self):
        """Train LightGBM Regressor"""
        print("\n⚡ Training LightGBM...")
        
        model = lgb.LGBMRegressor(
            n_estimators=100,
            max_depth=8,
            learning_rate=0.1,
            num_leaves=31,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            n_jobs=-1,
            verbose=-1
        )
        
        model.fit(self.X_train, self.y_train)
        predictions = model.predict(self.X_test)
        
        results = self.evaluate_model("LightGBM", predictions)
        
        self.models['lightgbm'] = model
        self.results['lightgbm'] = results
        
        print(f"   MAE: {results['mae']:.3f} minutes")
        print(f"   RMSE: {results['rmse']:.3f} minutes")
        print(f"   R²: {results['r2']:.3f}")
        
        return model, results
        
    def train_gradient_boosting(self):
        """Train Gradient Boosting Regressor"""
        print("\n📈 Training Gradient Boosting...")
        
        model = GradientBoostingRegressor(
            n_estimators=100,
            max_depth=5,
            learning_rate=0.1,
            subsample=0.8,
            random_state=42,
            verbose=0
        )
        
        model.fit(self.X_train, self.y_train)
        predictions = model.predict(self.X_test)
        
        results = self.evaluate_model("Gradient Boosting", predictions)
        
        self.models['gradient_boosting'] = model
        self.results['gradient_boosting'] = results
        
        print(f"   MAE: {results['mae']:.3f} minutes")
        print(f"   RMSE: {results['rmse']:.3f} minutes")
        print(f"   R²: {results['r2']:.3f}")
        
        return model, results
        
    def evaluate_api_baseline(self):
        """Evaluate Madison Metro API's predictions as baseline"""
        print("\n🏁 Evaluating API Baseline...")
        
        results = self.evaluate_model("Madison Metro API", self.api_predictions_test)
        self.results['api_baseline'] = results
        
        print(f"   MAE: {results['mae']:.3f} minutes")
        print(f"   RMSE: {results['rmse']:.3f} minutes")
        print(f"   R²: {results['r2']:.3f}")
        
        return results
        
    def compare_models(self):
        """Compare all models including API baseline"""
        print("\n" + "=" * 80)
        print("📊 MODEL COMPARISON")
        print("=" * 80)
        
        # Create comparison dataframe
        comparison = pd.DataFrame(self.results).T
        comparison = comparison.sort_values('mae')
        
        print("\n{:<25} {:<12} {:<12} {:<12} {:<12}".format(
            "Model", "MAE (min)", "RMSE (min)", "R²", "Within 2min"
        ))
        print("-" * 80)
        
        best_model_name = None
        best_mae = float('inf')
        
        for model_name, row in comparison.iterrows():
            mae = row['mae']
            rmse = row['rmse']
            r2 = row['r2']
            within_2min = row['within_2min']
            
            # Highlight if beats API
            marker = ""
            if model_name != 'api_baseline':
                api_mae = self.results['api_baseline']['mae']
                improvement = ((api_mae - mae) / api_mae) * 100
                if mae < api_mae:
                    marker = f" ⭐ ({improvement:+.1f}% better)"
                    
            if mae < best_mae and model_name != 'api_baseline':
                best_mae = mae
                best_model_name = model_name
                
            print("{:<25} {:<12.3f} {:<12.3f} {:<12.3f} {:<12.1f}%{}".format(
                row['name'], mae, rmse, r2, within_2min, marker
            ))
            
        print("\n" + "=" * 80)
        
        if best_model_name:
            print(f"\n🏆 BEST MODEL: {self.results[best_model_name]['name']}")
            print(f"   MAE: {self.results[best_model_name]['mae']:.3f} minutes")
            
            api_mae = self.results['api_baseline']['mae']
            improvement = ((api_mae - self.results[best_model_name]['mae']) / api_mae) * 100
            print(f"   Improvement over API: {improvement:.1f}%")
            
        return best_model_name, comparison
        
    def get_feature_importance(self, model_name: str, top_n: int = 15):
        """Get feature importance from tree-based model"""
        if model_name not in self.models:
            return None
            
        model = self.models[model_name]
        
        # Get importance
        if hasattr(model, 'feature_importances_'):
            importance = model.feature_importances_
        else:
            return None
            
        # Create dataframe
        feature_importance = pd.DataFrame({
            'feature': self.feature_columns,
            'importance': importance
        }).sort_values('importance', ascending=False).head(top_n)
        
        return feature_importance
        
    def save_models(self, output_dir: str = "ml/models"):
        """Save all trained models"""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        print(f"\n💾 Saving models to {output_dir}/")
        
        for name, model in self.models.items():
            model_file = output_path / f"{name}_arrival_model.pkl"
            joblib.dump(model, model_file)
            size_mb = model_file.stat().st_size / 1024 / 1024
            print(f"   ✓ {name}: {size_mb:.2f} MB")
            
    def save_results(self, output_file: str = "ml/results/model_results.json"):
        """Save comparison results"""
        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        results_data = {
            'timestamp': datetime.now().isoformat(),
            'test_size': len(self.X_test),
            'train_size': len(self.X_train),
            'num_features': len(self.feature_columns),
            'models': self.results
        }
        
        with open(output_path, 'w') as f:
            json.dump(results_data, f, indent=2)
            
        print(f"\n💾 Saved results to {output_file}")
        
    def generate_report(self):
        """Generate comprehensive training report"""
        print("\n" + "=" * 80)
        print("📈 TRAINING REPORT SUMMARY")
        print("=" * 80)
        
        print(f"\nDataset:")
        print(f"  Training samples: {len(self.X_train):,}")
        print(f"  Test samples: {len(self.X_test):,}")
        print(f"  Features: {len(self.feature_columns)}")
        
        print(f"\nTarget variable: minutes_until_arrival")
        print(f"  Mean: {self.y_test.mean():.2f} minutes")
        print(f"  Std: {self.y_test.std():.2f} minutes")
        print(f"  Range: {self.y_test.min():.2f} - {self.y_test.max():.2f} minutes")
        
        print(f"\nModels trained: {len(self.models)}")
        print(f"Baseline evaluated: Madison Metro API")
        
        # Best performers
        sorted_models = sorted(
            [(name, res['mae']) for name, res in self.results.items() if name != 'api_baseline'],
            key=lambda x: x[1]
        )
        
        print(f"\nTop 3 Models by MAE:")
        for i, (name, mae) in enumerate(sorted_models[:3], 1):
            api_mae = self.results['api_baseline']['mae']
            improvement = ((api_mae - mae) / api_mae) * 100
            print(f"  {i}. {self.results[name]['name']}: {mae:.3f} min ({improvement:+.1f}% vs API)")


def main():
    """Run complete training pipeline"""
    print("🚀 Madison Metro Arrival Time Prediction - Model Training")
    print("=" * 80)
    
    # Initialize trainer
    trainer = ArrivalTimeModelTrainer()
    
    # Load data
    trainer.load_data()
    
    # Evaluate API baseline first
    trainer.evaluate_api_baseline()
    
    # Train all models
    trainer.train_random_forest()
    trainer.train_xgboost()
    trainer.train_lightgbm()
    trainer.train_gradient_boosting()
    
    # Compare models
    best_model, comparison = trainer.compare_models()
    
    # Show feature importance for best model
    if best_model:
        print(f"\n📊 Top 15 Features for {trainer.results[best_model]['name']}:")
        print("-" * 60)
        importance = trainer.get_feature_importance(best_model, top_n=15)
        if importance is not None:
            for idx, row in importance.iterrows():
                print(f"  {row['feature']:<30} {row['importance']:.4f}")
    
    # Save everything
    trainer.save_models()
    trainer.save_results()
    
    # Generate report
    trainer.generate_report()
    
    print("\n" + "=" * 80)
    print("✅ Training complete!")
    print("=" * 80)
    
    return trainer


if __name__ == "__main__":
    trainer = main()

