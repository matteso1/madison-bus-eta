"""
Weather Data Tracker for Madison
Integrates with WeatherAPI.com to track weather conditions
"""

import requests
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional
import os
from dotenv import load_dotenv

load_dotenv()

class WeatherTracker:
    """Track weather data for Madison, WI using WeatherAPI.com"""
    
    def __init__(self, api_key: Optional[str] = None, cache_file='backend/data/weather_cache.json'):
        self.api_key = api_key or os.getenv('WEATHERAPI_KEY', '1f2c85990da1445d9ae211611250611')
        self.cache_file = Path(cache_file)
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        self.cache = self._load_cache()
        self.base_url = "http://api.weatherapi.com/v1"
        self.madison_query = "Madison, WI"  # WeatherAPI accepts city names
        
    def _load_cache(self) -> Dict:
        """Load weather cache from file"""
        if self.cache_file.exists():
            try:
                with open(self.cache_file, 'r') as f:
                    return json.load(f)
            except:
                pass
        return {}
    
    def _save_cache(self):
        """Save weather cache to file"""
        with open(self.cache_file, 'w') as f:
            json.dump(self.cache, f, indent=2)
    
    def _get_cache_key(self, date: datetime) -> str:
        """Generate cache key for a date"""
        return date.strftime('%Y-%m-%d')
    
    def get_current_weather(self) -> Optional[Dict]:
        """Get current weather conditions from WeatherAPI.com"""
        if not self.api_key:
            return None
        
        try:
            url = f"{self.base_url}/current.json"
            params = {
                'key': self.api_key,
                'q': self.madison_query,
                'aqi': 'no'  # Air quality (optional)
            }
            
            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()
            
            current = data.get('current', {})
            condition = current.get('condition', {})
            
            return {
                'temperature': current.get('temp_f', 50.0),  # Fahrenheit
                'feels_like': current.get('feelslike_f', 50.0),
                'humidity': current.get('humidity', 0),
                'pressure': current.get('pressure_in', 0),  # Inches
                'wind_speed': current.get('wind_mph', 0),  # MPH
                'wind_direction': current.get('wind_degree', 0),
                'wind_dir': current.get('wind_dir', ''),
                'weather_condition': condition.get('text', ''),
                'weather_code': condition.get('code', 0),
                'clouds': current.get('cloud', 0),
                'visibility': current.get('vis_miles', 0),  # Miles
                'precipitation': current.get('precip_in', 0.0),  # Inches
                'uv_index': current.get('uv', 0),
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            print(f"WeatherAPI error: {e}")
            return None
    
    def get_weather_for_date(self, date: datetime) -> Optional[Dict]:
        """Get weather for a specific date (from cache or API)"""
        cache_key = self._get_cache_key(date)
        
        # Check cache first
        if cache_key in self.cache:
            return self.cache[cache_key]
        
        # If it's today, get current weather
        if date.date() == datetime.now().date():
            weather = self.get_current_weather()
            if weather:
                self.cache[cache_key] = weather
                self._save_cache()
            return weather
        
        # For historical dates, use WeatherAPI history endpoint (free tier supports)
        try:
            url = f"{self.base_url}/history.json"
            params = {
                'key': self.api_key,
                'q': self.madison_query,
                'dt': date.strftime('%Y-%m-%d')
            }
            
            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()
            
            forecastday = data.get('forecast', {}).get('forecastday', [])
            if forecastday:
                day_data = forecastday[0].get('day', {})
                condition = day_data.get('condition', {})
                
                weather = {
                    'temperature': day_data.get('avgtemp_f', 50.0),
                    'feels_like': day_data.get('avgtemp_f', 50.0),
                    'humidity': day_data.get('avghumidity', 0),
                    'pressure': 29.92,  # Average
                    'wind_speed': day_data.get('maxwind_mph', 0),
                    'wind_direction': 0,
                    'weather_condition': condition.get('text', ''),
                    'weather_code': condition.get('code', 0),
                    'clouds': 0,
                    'visibility': 10.0,
                    'precipitation': day_data.get('totalprecip_in', 0.0),
                    'timestamp': date.isoformat()
                }
                
                self.cache[cache_key] = weather
                self._save_cache()
                return weather
        except Exception as e:
            print(f"WeatherAPI history error: {e}")
        
        return None
    
    def get_weather_features(self, date: datetime) -> Dict:
        """Get weather features for ML model"""
        weather = self.get_weather_for_date(date)
        
        if not weather:
            # Return default values if no weather data
            return {
                'temperature': 50.0,  # Average Madison temp
                'precipitation': 0.0,
                'wind_speed': 0.0,
                'is_rainy': 0,
                'is_snowy': 0,
                'is_extreme_weather': 0
            }
        
        # Extract features
        condition = weather.get('weather_condition', '').lower()
        is_rainy = 1 if any(word in condition for word in ['rain', 'drizzle', 'shower', 'storm']) else 0
        is_snowy = 1 if 'snow' in condition else 0
        is_extreme = 1 if weather.get('wind_speed', 0) > 20 or weather.get('temperature', 50) < 0 else 0
        
        # WeatherAPI provides actual precipitation
        precipitation = weather.get('precipitation', 0.0)
        
        return {
            'temperature': weather.get('temperature', 50.0),
            'precipitation': precipitation,
            'wind_speed': weather.get('wind_speed', 0.0),
            'humidity': weather.get('humidity', 0),
            'is_rainy': is_rainy,
            'is_snowy': is_snowy,
            'is_extreme_weather': is_extreme,
            'weather_condition': condition
        }
    
    def is_bad_weather(self, date: datetime) -> bool:
        """Check if weather conditions are likely to cause delays"""
        features = self.get_weather_features(date)
        return features['is_rainy'] == 1 or features['is_snowy'] == 1 or features['is_extreme_weather'] == 1

