"""
Smart Prediction API - Enhanced Arrival Time Predictions

Uses trained ML models to provide improved bus arrival predictions.
"""

import pandas as pd
import numpy as np
import joblib
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional
import sys

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')


class SmartPredictionAPI:
    def __init__(self, 
                 model_path: str = 'ml/models/xgboost_arrival_model.pkl',
                 encoder_path: str = 'ml/encoders/feature_encoders.pkl'):
        """Initialize with trained model"""
        self.model = None
        self.encoders = None
        self.route_stats = None
        self.stop_stats = None
        self.model_name = "XGBoost"
        
        self.load_model(model_path)
        self.load_encoders(encoder_path)
        
    def load_model(self, path: str):
        """Load trained model"""
        model_file = Path(path)
        if not model_file.exists():
            print(f"⚠️  Model not found at {path}")
            return False
            
        self.model = joblib.load(model_file)
        print(f"✅ Loaded model from {path}")
        return True
        
    def load_encoders(self, path: str):
        """Load feature encoders and statistics"""
        encoder_file = Path(path)
        if not encoder_file.exists():
            print(f"⚠️  Encoders not found at {path}")
            return False
            
        data = joblib.load(encoder_file)
        self.encoders = data['encoders']
        self.route_stats = data['route_stats']
        self.stop_stats = data['stop_stats']
        print(f"✅ Loaded encoders from {path}")
        return True
        
    def predict_arrival(self, 
                       route: str,
                       stop_id: str,
                       api_prediction: float,
                       timestamp: Optional[datetime] = None) -> Dict:
        """
        Predict enhanced arrival time
        
        Args:
            route: Route identifier (e.g., 'A', '28')
            stop_id: Stop ID
            api_prediction: The API's prediction in minutes
            timestamp: Collection timestamp (defaults to now)
            
        Returns:
            Dictionary with prediction results
        """
        if self.model is None:
            return {
                'error': 'Model not loaded',
                'api_prediction': api_prediction
            }
            
        if timestamp is None:
            timestamp = datetime.now()
            
        try:
            # Create features
            features = self._create_features(route, stop_id, api_prediction, timestamp)
            
            # Make prediction
            prediction = self.model.predict(features)[0]
            
            # Calculate improvement
            improvement = api_prediction - prediction
            improvement_pct = (improvement / api_prediction * 100) if api_prediction > 0 else 0
            
            # Confidence based on route/stop reliability
            confidence = self._calculate_confidence(route, stop_id)
            
            result = {
                'enhanced_prediction': float(prediction),
                'api_prediction': float(api_prediction),
                'improvement_minutes': float(improvement),
                'improvement_percent': float(improvement_pct),
                'confidence': float(confidence),
                'model': self.model_name,
                'timestamp': timestamp.isoformat()
            }
            
            return result
            
        except Exception as e:
            return {
                'error': str(e),
                'api_prediction': api_prediction
            }
            
    def _create_features(self, route: str, stop_id: str, api_prediction: float, 
                        timestamp: datetime) -> pd.DataFrame:
        """Create feature vector for prediction"""
        
        # Temporal features
        hour = timestamp.hour
        minute = timestamp.minute
        day_of_week = timestamp.weekday()
        is_weekend = 1 if day_of_week >= 5 else 0
        
        is_morning_rush = 1 if 7 <= hour <= 9 else 0
        is_evening_rush = 1 if 16 <= hour <= 18 else 0
        is_rush_hour = is_morning_rush or is_evening_rush
        
        time_period = 0 if hour < 6 else (1 if hour < 12 else (2 if hour < 18 else 3))
        
        # Cyclical encodings
        hour_sin = np.sin(2 * np.pi * hour / 24)
        hour_cos = np.cos(2 * np.pi * hour / 24)
        day_sin = np.sin(2 * np.pi * day_of_week / 7)
        day_cos = np.cos(2 * np.pi * day_of_week / 7)
        
        # Route features
        is_brt = 1 if route.isalpha() else 0
        
        # Encode route
        try:
            route_encoded = self.encoders['rt'].transform([str(route)])[0]
        except:
            route_encoded = 0  # Unknown route
            
        # Route statistics
        route_avg_wait = self.route_stats.get(('minutes_until_arrival', 'mean'), {}).get(route, 43.94)
        route_wait_std = self.route_stats.get(('minutes_until_arrival', 'std'), {}).get(route, 25.69)
        route_reliability = 1 / (1 + self.route_stats.get(('api_prediction_error', 'mean'), {}).get(route, 0.37))
        
        # Stop features
        try:
            stop_encoded = self.encoders['stpid'].transform([str(stop_id)])[0]
        except:
            stop_encoded = 0  # Unknown stop
            
        stop_avg_wait = self.stop_stats.get(('minutes_until_arrival', 'mean'), {}).get(stop_id, 43.94)
        stop_frequency = self.stop_stats.get(('minutes_until_arrival', 'count'), {}).get(stop_id, 100)
        stop_reliability = 1 / (1 + self.stop_stats.get(('api_prediction_error', 'mean'), {}).get(stop_id, 0.37))
        
        # Interaction features
        route_hour_interaction = route_encoded * hour
        route_day_interaction = route_encoded * day_of_week
        weekday_rush = is_rush_hour * (1 - is_weekend)
        brt_rush = is_brt * is_rush_hour
        
        # Prediction features
        prediction_horizon = api_prediction
        predicted_vs_avg = api_prediction - route_avg_wait
        predicted_minutes = api_prediction
        
        # Create feature vector in correct order
        features = pd.DataFrame([{
            'hour': hour,
            'minute': minute,
            'day_of_week': day_of_week,
            'is_weekend': is_weekend,
            'is_morning_rush': is_morning_rush,
            'is_evening_rush': is_evening_rush,
            'is_rush_hour': is_rush_hour,
            'time_period': time_period,
            'hour_sin': hour_sin,
            'hour_cos': hour_cos,
            'day_sin': day_sin,
            'day_cos': day_cos,
            'is_brt': is_brt,
            'route_encoded': route_encoded,
            'route_avg_wait': route_avg_wait,
            'route_wait_std': route_wait_std,
            'route_reliability': route_reliability,
            'stop_encoded': stop_encoded,
            'stop_avg_wait': stop_avg_wait,
            'stop_frequency': stop_frequency,
            'stop_reliability': stop_reliability,
            'route_hour_interaction': route_hour_interaction,
            'route_day_interaction': route_day_interaction,
            'weekday_rush': weekday_rush,
            'brt_rush': brt_rush,
            'prediction_horizon': prediction_horizon,
            'predicted_vs_avg': predicted_vs_avg,
            'predicted_minutes': predicted_minutes
        }])
        
        return features
        
    def _calculate_confidence(self, route: str, stop_id: str) -> float:
        """Calculate confidence score (0-1) based on historical reliability"""
        route_rel = self.route_stats.get(('api_prediction_error', 'mean'), {}).get(route, 0.37)
        stop_rel = self.stop_stats.get(('api_prediction_error', 'mean'), {}).get(stop_id, 0.37)
        
        # Lower error = higher confidence
        route_conf = max(0, 1 - (route_rel / 2))  # Normalize
        stop_conf = max(0, 1 - (stop_rel / 2))
        
        # Average confidence
        confidence = (route_conf + stop_conf) / 2
        
        return min(1.0, max(0.0, confidence))
        
    def get_model_info(self) -> Dict:
        """Get information about the loaded model"""
        return {
            'model_name': self.model_name,
            'model_type': type(self.model).__name__,
            'num_features': 28,
            'improvement_over_api': 21.3,  # From training results
            'mean_absolute_error': 0.292,   # From training results
            'r2_score': 1.000
        }
        
    def predict_batch(self, predictions_list: list) -> list:
        """
        Predict for multiple predictions at once
        
        Args:
            predictions_list: List of dicts with keys: route, stop_id, api_prediction, timestamp
            
        Returns:
            List of prediction results
        """
        results = []
        for pred in predictions_list:
            result = self.predict_arrival(
                route=pred['route'],
                stop_id=pred['stop_id'],
                api_prediction=pred['api_prediction'],
                timestamp=pred.get('timestamp')
            )
            results.append(result)
            
        return results


# Initialize global API instance
smart_api = SmartPredictionAPI()


def predict_enhanced_arrival(route: str, stop_id: str, api_prediction: float, 
                            timestamp: Optional[datetime] = None) -> Dict:
    """Convenience function for predictions"""
    return smart_api.predict_arrival(route, stop_id, api_prediction, timestamp)


if __name__ == "__main__":
    # Demo
    print("🤖 Smart Prediction API Demo")
    print("=" * 60)
    
    # Example prediction
    result = smart_api.predict_arrival(
        route='A',
        stop_id='1234',
        api_prediction=5.0,
        timestamp=datetime.now()
    )
    
    print("\n📊 Example Prediction:")
    print(f"   Route: A")
    print(f"   Stop: 1234")
    print(f"   API Prediction: {result.get('api_prediction', 'N/A')} minutes")
    print(f"   Enhanced Prediction: {result.get('enhanced_prediction', 'N/A')} minutes")
    print(f"   Improvement: {result.get('improvement_minutes', 'N/A')} minutes")
    print(f"   Confidence: {result.get('confidence', 'N/A'):.1%}")
    
    print("\n📈 Model Info:")
    info = smart_api.get_model_info()
    for key, value in info.items():
        print(f"   {key}: {value}")

