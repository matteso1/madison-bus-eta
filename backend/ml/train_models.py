import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import xgboost as xgb
import lightgbm as lgb
import joblib
import os
from .data_processor import MadisonMetroDataProcessor

class ModelTrainer:
    def __init__(self):
        self.processor = MadisonMetroDataProcessor()
        self.models = {}
        self.model_scores = {}
        
    def load_and_prepare_data(self, data_files):
        """Load and prepare data from multiple files"""
        all_data = []
        
        for file_path in data_files:
            df = self.processor.load_data(file_path)
            if df is not None:
                df = self.processor.create_features(df)
                if df is not None and len(df) > 0:
                    all_data.append(df)
        
        if not all_data:
            print("No data loaded")
            return None, None
            
        combined_df = pd.concat(all_data, ignore_index=True)
        print(f"Combined dataset: {len(combined_df)} records")
        
        X, y = self.processor.prepare_features(combined_df)
        return X, y
    
    def train_models(self, X, y):
        """Train multiple ML models"""
        if X is None or y is None:
            print("No data available for training")
            return
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
        
        print(f"Training set: {len(X_train)} samples")
        print(f"Test set: {len(X_test)} samples")
        
        # Define models
        models = {
            'linear_regression': LinearRegression(),
            'random_forest': RandomForestRegressor(n_estimators=100, random_state=42),
            'xgboost': xgb.XGBRegressor(n_estimators=100, random_state=42),
            'lightgbm': lgb.LGBMRegressor(n_estimators=100, random_state=42, verbose=-1)
        }
        
        # Train and evaluate models
        for name, model in models.items():
            print(f"\nTraining {name}...")
            
            # Train model
            model.fit(X_train, y_train)
            
            # Make predictions
            y_pred = model.predict(X_test)
            
            # Calculate metrics
            mae = mean_absolute_error(y_test, y_pred)
            mse = mean_squared_error(y_test, y_pred)
            r2 = r2_score(y_test, y_pred)
            
            # Cross-validation score
            cv_scores = cross_val_score(model, X_train, y_train, cv=5, scoring='neg_mean_absolute_error')
            cv_mae = -cv_scores.mean()
            
            # Store model and scores
            self.models[name] = model
            self.model_scores[name] = {
                'mae': mae,
                'mse': mse,
                'r2': r2,
                'cv_mae': cv_mae,
                'rmse': np.sqrt(mse)
            }
            
            print(f"{name} - MAE: {mae:.3f}, R²: {r2:.3f}, CV MAE: {cv_mae:.3f}")
        
        # Find best model
        best_model_name = min(self.model_scores.keys(), 
                             key=lambda x: self.model_scores[x]['mae'])
        print(f"\nBest model: {best_model_name}")
        print(f"Best MAE: {self.model_scores[best_model_name]['mae']:.3f}")
        
        return best_model_name
    
    def save_models(self, output_dir='models'):
        """Save trained models"""
        os.makedirs(output_dir, exist_ok=True)
        
        for name, model in self.models.items():
            filepath = os.path.join(output_dir, f'{name}.pkl')
            joblib.dump(model, filepath)
            print(f"Saved {name} to {filepath}")
        
        # Save best model separately
        if self.models:
            best_model_name = min(self.model_scores.keys(), 
                                 key=lambda x: self.model_scores[x]['mae'])
            best_model_path = os.path.join(output_dir, 'best_model.pkl')
            joblib.dump(self.models[best_model_name], best_model_path)
            print(f"Saved best model ({best_model_name}) to {best_model_path}")
    
    def get_feature_importance(self, model_name='random_forest'):
        """Get feature importance from model"""
        if model_name not in self.models:
            return None
            
        model = self.models[model_name]
        
        if hasattr(model, 'feature_importances_'):
            importance = model.feature_importances_
            features = self.processor.feature_columns
            
            feature_importance = list(zip(features, importance))
            feature_importance.sort(key=lambda x: x[1], reverse=True)
            
            return feature_importance
        else:
            return None
    
    def generate_insights(self):
        """Generate insights from trained models"""
        insights = []
        
        if not self.model_scores:
            return insights
        
        # Best model performance
        best_model = min(self.model_scores.keys(), 
                        key=lambda x: self.model_scores[x]['mae'])
        best_score = self.model_scores[best_model]
        
        insights.append({
            'title': 'Model Performance',
            'description': f'Best performing model: {best_model} with MAE of {best_score["mae"]:.2f} minutes',
            'type': 'performance'
        })
        
        # Feature importance
        feature_importance = self.get_feature_importance()
        if feature_importance:
            top_features = feature_importance[:3]
            insights.append({
                'title': 'Key Predictors',
                'description': f'Most important features: {", ".join([f[0] for f in top_features])}',
                'type': 'features'
            })
        
        # Model comparison
        if len(self.model_scores) > 1:
            model_comparison = []
            for name, scores in self.model_scores.items():
                model_comparison.append(f"{name}: {scores['mae']:.2f} min MAE")
            
            insights.append({
                'title': 'Model Comparison',
                'description': f'Model accuracy comparison - {"; ".join(model_comparison)}',
                'type': 'comparison'
            })
        
        return insights

def main():
    """Main training function"""
    trainer = ModelTrainer()
    
    # Look for data files
    data_dir = '../collected_data'
    data_files = []
    
    if os.path.exists(data_dir):
        for file in os.listdir(data_dir):
            if file.endswith('.csv') and 'predictions' in file:
                data_files.append(os.path.join(data_dir, file))
    
    if not data_files:
        print("No prediction data files found. Creating sample data...")
        # Create sample data for demonstration
        sample_data = create_sample_data()
        sample_file = os.path.join(data_dir, 'sample_predictions.csv')
        os.makedirs(data_dir, exist_ok=True)
        sample_data.to_csv(sample_file, index=False)
        data_files = [sample_file]
    
    print(f"Found {len(data_files)} data files")
    
    # Load and prepare data
    X, y = trainer.load_and_prepare_data(data_files)
    
    if X is not None and y is not None:
        # Train models
        best_model = trainer.train_models(X, y)
        
        # Save models and encoders
        trainer.save_models()
        trainer.processor.save_encoders('encoders.pkl')
        
        # Generate insights
        insights = trainer.generate_insights()
        print("\nGenerated Insights:")
        for insight in insights:
            print(f"- {insight['title']}: {insight['description']}")
    else:
        print("Failed to load data for training")

def create_sample_data():
    """Create sample data for demonstration"""
    np.random.seed(42)
    n_samples = 1000
    
    data = {
        'collection_timestamp': pd.date_range('2024-01-01', periods=n_samples, freq='5min'),
        'rt': np.random.choice(['A', 'B', 'C', 'D', 'E', '80', '81', '82'], n_samples),
        'rtdir': np.random.choice(['Northbound', 'Southbound', 'Eastbound', 'Westbound'], n_samples),
        'stpid': np.random.randint(1000, 9999, n_samples),
        'prdctdn': np.random.normal(5, 3, n_samples).clip(0, 20)
    }
    
    return pd.DataFrame(data)

if __name__ == "__main__":
    main()
