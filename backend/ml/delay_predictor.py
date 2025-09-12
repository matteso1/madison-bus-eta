#!/usr/bin/env python3
"""
Madison Metro Delay Prediction Model
Trains ML models to predict bus delays
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score
from sklearn.preprocessing import StandardScaler, LabelEncoder
import joblib
import matplotlib.pyplot as plt
import seaborn as sns
from data_processor import MadisonMetroDataProcessor

class DelayPredictor:
    def __init__(self):
        self.model = None
        self.scaler = StandardScaler()
        self.label_encoders = {}
        self.feature_importance = None
        self.metrics = {}
        
    def prepare_features(self, vehicle_df):
        """Prepare features for delay prediction"""
        print("🔧 Preparing features for delay prediction...")
        
        # Select features for delay prediction
        feature_columns = [
            'spd', 'passenger_load_numeric', 'pdist', 'hour', 'day_of_week',
            'is_weekend', 'is_rush_hour', 'is_moving', 'distance_ratio',
            'route_delay_rate', 'route_avg_speed', 'route_avg_load'
        ]
        
        # Create feature matrix
        X = vehicle_df[feature_columns].copy()
        
        # Handle categorical variables
        categorical_features = ['route_type']
        for feature in categorical_features:
            if feature in vehicle_df.columns:
                le = LabelEncoder()
                X[feature] = le.fit_transform(vehicle_df[feature].astype(str))
                self.label_encoders[feature] = le
        
        # Target variable
        y = vehicle_df['is_delayed']
        
        # Handle missing values
        X = X.fillna(X.median())
        
        print(f"✅ Features prepared: {X.shape[1]} features, {X.shape[0]} samples")
        print(f"🎯 Delay rate: {y.mean():.1%}")
        
        return X, y
    
    def train_models(self, X, y):
        """Train multiple ML models and select the best one"""
        print("🤖 Training delay prediction models...")
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        
        # Scale features
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)
        
        # Define models
        models = {
            'Random Forest': RandomForestClassifier(
                n_estimators=100, 
                random_state=42,
                class_weight='balanced'
            ),
            'Gradient Boosting': GradientBoostingClassifier(
                n_estimators=100,
                random_state=42
            ),
            'Logistic Regression': LogisticRegression(
                random_state=42,
                class_weight='balanced',
                max_iter=1000
            )
        }
        
        # Train and evaluate models
        best_model = None
        best_score = 0
        results = {}
        
        for name, model in models.items():
            print(f"  🔄 Training {name}...")
            
            # Train model
            if name == 'Logistic Regression':
                model.fit(X_train_scaled, y_train)
                y_pred = model.predict(X_test_scaled)
                y_pred_proba = model.predict_proba(X_test_scaled)[:, 1]
            else:
                model.fit(X_train, y_train)
                y_pred = model.predict(X_test)
                y_pred_proba = model.predict_proba(X_test)[:, 1]
            
            # Calculate metrics
            auc_score = roc_auc_score(y_test, y_pred_proba)
            accuracy = (y_pred == y_test).mean()
            
            results[name] = {
                'model': model,
                'auc': auc_score,
                'accuracy': accuracy,
                'predictions': y_pred,
                'probabilities': y_pred_proba
            }
            
            print(f"    📊 {name} - AUC: {auc_score:.3f}, Accuracy: {accuracy:.3f}")
            
            # Track best model
            if auc_score > best_score:
                best_score = auc_score
                best_model = name
        
        # Select best model
        self.model = results[best_model]['model']
        self.metrics = {
            'best_model': best_model,
            'auc_score': best_score,
            'accuracy': results[best_model]['accuracy'],
            'all_results': results
        }
        
        print(f"🏆 Best model: {best_model} (AUC: {best_score:.3f})")
        
        # Feature importance
        if hasattr(self.model, 'feature_importances_'):
            self.feature_importance = pd.DataFrame({
                'feature': X.columns,
                'importance': self.model.feature_importances_
            }).sort_values('importance', ascending=False)
        
        return X_test, y_test, results[best_model]['predictions'], results[best_model]['probabilities']
    
    def evaluate_model(self, X_test, y_test, y_pred, y_pred_proba):
        """Evaluate model performance"""
        print("📊 Evaluating model performance...")
        
        # Classification report
        print("\n📋 Classification Report:")
        print(classification_report(y_test, y_pred))
        
        # Confusion matrix
        cm = confusion_matrix(y_test, y_pred)
        print(f"\n🔢 Confusion Matrix:")
        print(f"True Negatives: {cm[0,0]}, False Positives: {cm[0,1]}")
        print(f"False Negatives: {cm[1,0]}, True Positives: {cm[1,1]}")
        
        # Additional metrics
        precision = cm[1,1] / (cm[1,1] + cm[0,1]) if (cm[1,1] + cm[0,1]) > 0 else 0
        recall = cm[1,1] / (cm[1,1] + cm[1,0]) if (cm[1,1] + cm[1,0]) > 0 else 0
        f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
        
        print(f"\n📈 Additional Metrics:")
        print(f"Precision: {precision:.3f}")
        print(f"Recall: {recall:.3f}")
        print(f"F1-Score: {f1:.3f}")
        
        return {
            'classification_report': classification_report(y_test, y_pred),
            'confusion_matrix': cm,
            'precision': precision,
            'recall': recall,
            'f1_score': f1
        }
    
    def predict_delay(self, features):
        """Predict delay for new data"""
        if self.model is None:
            raise ValueError("Model not trained. Call train_models() first.")
        
        # Preprocess features
        features_scaled = self.scaler.transform(features)
        
        # Make prediction
        prediction = self.model.predict(features_scaled)
        probability = self.model.predict_proba(features_scaled)[:, 1]
        
        return prediction, probability
    
    def save_model(self, filepath="delay_predictor_model.pkl"):
        """Save trained model"""
        if self.model is None:
            raise ValueError("No model to save. Train model first.")
        
        model_data = {
            'model': self.model,
            'scaler': self.scaler,
            'label_encoders': self.label_encoders,
            'feature_importance': self.feature_importance,
            'metrics': self.metrics
        }
        
        joblib.dump(model_data, filepath)
        print(f"💾 Model saved to {filepath}")
    
    def load_model(self, filepath="delay_predictor_model.pkl"):
        """Load trained model"""
        model_data = joblib.load(filepath)
        self.model = model_data['model']
        self.scaler = model_data['scaler']
        self.label_encoders = model_data['label_encoders']
        self.feature_importance = model_data['feature_importance']
        self.metrics = model_data['metrics']
        print(f"📂 Model loaded from {filepath}")

def main():
    """Train the delay prediction model"""
    print("🚌 MADISON METRO DELAY PREDICTION MODEL")
    print("=" * 50)
    
    # Load and process data
    processor = MadisonMetroDataProcessor()
    vehicle_data, prediction_data = processor.load_all_data()
    clean_vehicles = processor.clean_vehicle_data()
    clean_predictions = processor.clean_prediction_data()
    vehicle_features, prediction_features = processor.create_ml_features(clean_vehicles, clean_predictions)
    
    # Train delay predictor
    predictor = DelayPredictor()
    X, y = predictor.prepare_features(vehicle_features)
    X_test, y_test, y_pred, y_pred_proba = predictor.train_models(X, y)
    
    # Evaluate model
    evaluation = predictor.evaluate_model(X_test, y_test, y_pred, y_pred_proba)
    
    # Save model
    predictor.save_model("ml/delay_predictor_model.pkl")
    
    # Show feature importance
    if predictor.feature_importance is not None:
        print("\n🎯 Top 10 Most Important Features:")
        print(predictor.feature_importance.head(10))
    
    print("\n🎉 Delay prediction model training complete!")
    return predictor

if __name__ == "__main__":
    predictor = main()

