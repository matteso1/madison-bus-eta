"""
Madison Metro Bus ETA Prediction Demo
Shows how to use the trained models for real-time predictions
"""

import pandas as pd
import numpy as np
import joblib
import os
from datetime import datetime, timedelta

class BusETADemo:
    def __init__(self, model_dir="ml/models"):
        self.model_dir = model_dir
        self.model = None
        self.scaler = None
        self.encoders = None
        self.load_models()
    
    def load_models(self):
        """Load the trained models"""
        try:
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
        """Make a prediction"""
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
        except ValueError:
            # Handle unknown routes/stops
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
    
    def demo_scenarios(self):
        """Run demo scenarios"""
        print("🚌 Madison Metro Bus ETA Prediction Demo")
        print("=" * 50)
        
        # Demo scenarios based on real Madison Metro data
        scenarios = [
            {
                'name': 'Rush Hour - Route A (Highway)',
                'route': 'A',
                'stop_id': '10086',
                'vehicle_lat': 43.0731,
                'vehicle_lon': -89.4012,
                'vehicle_speed': 25,
                'vehicle_delay': False,
                'passenger_load': 2,  # Half full
                'distance_to_stop': 1000,
                'time': datetime.now().replace(hour=8, minute=30)  # Rush hour
            },
            {
                'name': 'Evening - Route 80 (UW Campus)',
                'route': '80',
                'stop_id': '2125',
                'vehicle_lat': 43.0765,
                'vehicle_lon': -89.4244,
                'vehicle_speed': 15,
                'vehicle_delay': True,
                'passenger_load': 3,  # Full
                'distance_to_stop': 2000,
                'time': datetime.now().replace(hour=18, minute=45)  # Evening
            },
            {
                'name': 'Weekend - Route B (Local)',
                'route': 'B',
                'stop_id': '10086',
                'vehicle_lat': 43.0823,
                'vehicle_lon': -89.3732,
                'vehicle_speed': 12,
                'vehicle_delay': False,
                'passenger_load': 1,  # Light
                'distance_to_stop': 500,
                'time': datetime.now().replace(hour=14, minute=0)  # Weekend afternoon
            },
            {
                'name': 'Late Night - Route C (Downtown)',
                'route': 'C',
                'stop_id': '1391',
                'vehicle_lat': 43.0725,
                'vehicle_lon': -89.3998,
                'vehicle_speed': 8,
                'vehicle_delay': False,
                'passenger_load': 0,  # Empty
                'distance_to_stop': 3000,
                'time': datetime.now().replace(hour=22, minute=30)  # Late night
            }
        ]
        
        for i, scenario in enumerate(scenarios, 1):
            print(f"\n📋 Scenario {i}: {scenario['name']}")
            print("-" * 40)
            
            # Make prediction
            result = self.predict_eta(
                route=scenario['route'],
                stop_id=scenario['stop_id'],
                vehicle_lat=scenario['vehicle_lat'],
                vehicle_lon=scenario['vehicle_lon'],
                vehicle_speed=scenario['vehicle_speed'],
                vehicle_delay=scenario['vehicle_delay'],
                passenger_load=scenario['passenger_load'],
                distance_to_stop=scenario['distance_to_stop'],
                current_time=scenario['time']
            )
            
            # Display results
            print(f"🚌 Route: {result['route']}")
            print(f"📍 Stop: {result['stop_id']}")
            print(f"⏰ Current Time: {result['current_time']}")
            print(f"🚀 Vehicle Speed: {scenario['vehicle_speed']} mph")
            print(f"👥 Passenger Load: {['Empty', 'Light', 'Half Full', 'Full'][scenario['passenger_load']]}")
            print(f"📏 Distance to Stop: {scenario['distance_to_stop']} feet")
            print(f"⏳ Predicted Delay: {result['predicted_delay_minutes']} minutes")
            print(f"🎯 Predicted Arrival: {result['predicted_arrival_time']}")
            print(f"🎲 Confidence: {result['confidence']}")
        
        print("\n" + "=" * 50)
        print("🎉 Demo completed!")
        print("\n💡 Key Insights:")
        print("• Rush hour scenarios show higher delays")
        print("• Vehicle speed and passenger load affect predictions")
        print("• Distance to stop is a major factor")
        print("• Time of day influences arrival predictions")

def main():
    """Run the demo"""
    try:
        demo = BusETADemo()
        demo.demo_scenarios()
    except Exception as e:
        print(f"❌ Demo failed: {e}")
        print("Make sure you've trained the models first by running: python ml/train_models.py")

if __name__ == "__main__":
    main()
