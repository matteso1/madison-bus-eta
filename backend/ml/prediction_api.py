
"""
Madison Metro Bus ETA Prediction API
Uses the trained Random Forest model to make real-time predictions
"""

import pandas as pd
import numpy as np
import joblib
import os
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
import json

class BusETAPredictor:
    def __init__(self, model_dir="ml/models"):
        self.model_dir = model_dir
        self.model = None
        self.scaler = None
        self.encoders = None
        self.load_models()
    
    def load_models(self):
        """Load the trained models and preprocessors"""
        try:
            # Load the best model (Random Forest)
            self.model = joblib.load(os.path.join(self.model_dir, "random_forest.pkl"))
            self.scaler = joblib.load(os.path.join(self.model_dir, "scalers.pkl"))['main']
            self.encoders = joblib.load(os.path.join(self.model_dir, "encoders.pkl"))
            print("✅ Models loaded successfully!")
        except Exception as e:
            print(f"❌ Error loading models: {e}")
            raise e
    
    def predict_eta(self, route, stop_id, vehicle_lat, vehicle_lon, 
                   vehicle_speed=0, vehicle_delay=False, passenger_load=0, 
                   distance_to_stop=0, current_time=None):
        """
        Predict bus arrival time
        
        Args:
            route: Route ID (e.g., 'A', 'B', '80')
            stop_id: Stop ID (e.g., '10086')
            vehicle_lat: Vehicle latitude
            vehicle_lon: Vehicle longitude
            vehicle_speed: Vehicle speed (mph)
            vehicle_delay: Whether vehicle is delayed
            passenger_load: Passenger load (0=Empty, 1=Light, 2=Half, 3=Full)
            distance_to_stop: Distance to stop (feet)
            current_time: Current time (defaults to now)
        
        Returns:
            dict: Prediction results
        """
        if current_time is None:
            current_time = datetime.now()
        
        # Create feature vector
        features = {
            'vehicle_lat': vehicle_lat,
            'vehicle_lon': vehicle_lon,
            'vehicle_speed': vehicle_speed,
            'vehicle_delay': int(vehicle_delay),
            'passenger_load': passenger_load,
            'distance_to_stop': distance_to_stop,
            'hour': current_time.hour,
            'day_of_week': current_time.weekday(),
            'is_weekend': current_time.weekday() >= 5,
            'speed_squared': vehicle_speed ** 2,
            'distance_speed_ratio': distance_to_stop / (vehicle_speed + 1),
            'is_rush_hour': (
                (current_time.hour >= 7 and current_time.hour <= 9) or
                (current_time.hour >= 16 and current_time.hour <= 18)
            )
        }
        
        # Encode categorical variables
        try:
            features['route_encoded'] = self.encoders['route'].transform([str(route)])[0]
            features['stop_encoded'] = self.encoders['stop'].transform([str(stop_id)])[0]
        except ValueError as e:
            # Handle unknown routes/stops
            print(f"⚠️ Unknown route/stop: {e}")
            features['route_encoded'] = 0
            features['stop_encoded'] = 0
        
        # Convert to DataFrame and scale
        feature_df = pd.DataFrame([features])
        feature_array = self.scaler.transform(feature_df)
        
        # Make prediction
        predicted_delay = self.model.predict(feature_array)[0]
        
        # Calculate predicted arrival time
        predicted_arrival = current_time + timedelta(minutes=predicted_delay)
        
        return {
            'route': route,
            'stop_id': stop_id,
            'current_time': current_time.isoformat(),
            'predicted_delay_minutes': round(predicted_delay, 2),
            'predicted_arrival_time': predicted_arrival.isoformat(),
            'confidence': 'high' if abs(predicted_delay) < 5 else 'medium' if abs(predicted_delay) < 10 else 'low'
        }

# Flask API
app = Flask(__name__)
predictor = BusETAPredictor()

@app.route('/predict', methods=['POST'])
def predict():
    """API endpoint for bus ETA prediction"""
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['route', 'stop_id', 'vehicle_lat', 'vehicle_lon']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Extract parameters
        route = data['route']
        stop_id = data['stop_id']
        vehicle_lat = float(data['vehicle_lat'])
        vehicle_lon = float(data['vehicle_lon'])
        vehicle_speed = float(data.get('vehicle_speed', 0))
        vehicle_delay = bool(data.get('vehicle_delay', False))
        passenger_load = int(data.get('passenger_load', 0))
        distance_to_stop = float(data.get('distance_to_stop', 0))
        
        # Make prediction
        result = predictor.predict_eta(
            route=route,
            stop_id=stop_id,
            vehicle_lat=vehicle_lat,
            vehicle_lon=vehicle_lon,
            vehicle_speed=vehicle_speed,
            vehicle_delay=vehicle_delay,
            passenger_load=passenger_load,
            distance_to_stop=distance_to_stop
        )
        
        return jsonify(result)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/predict/batch', methods=['POST'])
def predict_batch():
    """API endpoint for batch predictions"""
    try:
        data = request.get_json()
        predictions = []
        
        for item in data:
            result = predictor.predict_eta(
                route=item['route'],
                stop_id=item['stop_id'],
                vehicle_lat=item['vehicle_lat'],
                vehicle_lon=item['vehicle_lon'],
                vehicle_speed=item.get('vehicle_speed', 0),
                vehicle_delay=item.get('vehicle_delay', False),
                passenger_load=item.get('passenger_load', 0),
                distance_to_stop=item.get('distance_to_stop', 0)
            )
            predictions.append(result)
        
        return jsonify(predictions)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'model_loaded': predictor.model is not None,
        'timestamp': datetime.now().isoformat()
    })

if __name__ == '__main__':
    print("🚌 Starting Madison Metro Bus ETA Prediction API")
    print("📍 Available endpoints:")
    print("  POST /predict - Single prediction")
    print("  POST /predict/batch - Batch predictions")
    print("  GET /health - Health check")
    print("=" * 50)
    
    app.run(host='0.0.0.0', port=5001, debug=True)
