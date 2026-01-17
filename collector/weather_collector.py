"""
Weather Data Collector for Madison Bus ETA

Fetches current weather from OpenWeatherMap and stores it in the database.
Weather conditions like rain, snow, and extreme temperatures affect bus delays.

Runs alongside the main data collector, fetching weather every 30 minutes.
"""

import os
import time
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any

import requests
from sqlalchemy import create_engine, text

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s'
)
logger = logging.getLogger(__name__)

# Madison, WI coordinates
MADISON_LAT = 43.0731
MADISON_LON = -89.4012

# Weather fetch interval (30 minutes)
WEATHER_INTERVAL_SECONDS = 30 * 60


def create_weather_table(engine) -> bool:
    """Create weather_observations table if it doesn't exist."""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS weather_observations (
                    id SERIAL PRIMARY KEY,
                    observed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    temp_celsius FLOAT,
                    feels_like_celsius FLOAT,
                    humidity_percent INT,
                    wind_speed_mps FLOAT,
                    wind_gust_mps FLOAT,
                    visibility_meters INT,
                    precipitation_1h_mm FLOAT DEFAULT 0,
                    snow_1h_mm FLOAT DEFAULT 0,
                    clouds_percent INT,
                    weather_main VARCHAR(50),
                    weather_description VARCHAR(100),
                    is_severe BOOLEAN DEFAULT FALSE
                )
            """))
            conn.commit()
            
            # Create index on observed_at for efficient time-range queries
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_weather_observed_at 
                ON weather_observations(observed_at DESC)
            """))
            conn.commit()
            
        logger.info("Weather table created/verified")
        return True
    except Exception as e:
        logger.error(f"Failed to create weather table: {e}")
        return False


def fetch_weather(api_key: str) -> Optional[Dict[str, Any]]:
    """
    Fetch current weather from OpenWeatherMap API.
    
    Returns parsed weather data or None on failure.
    """
    url = f"https://api.openweathermap.org/data/2.5/weather"
    params = {
        "lat": MADISON_LAT,
        "lon": MADISON_LON,
        "appid": api_key,
        "units": "metric"  # Celsius, m/s
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Parse the response
        main = data.get("main", {})
        wind = data.get("wind", {})
        clouds = data.get("clouds", {})
        weather = data.get("weather", [{}])[0]
        rain = data.get("rain", {})
        snow = data.get("snow", {})
        
        # Determine if conditions are severe
        is_severe = False
        severe_conditions = ["Thunderstorm", "Heavy rain", "Heavy snow", "Blizzard", "Ice"]
        if any(cond.lower() in weather.get("description", "").lower() for cond in severe_conditions):
            is_severe = True
        if main.get("temp", 0) < -15 or main.get("temp", 0) > 35:
            is_severe = True
        if wind.get("speed", 0) > 15:  # >15 m/s is strong wind
            is_severe = True
        
        return {
            "temp_celsius": main.get("temp"),
            "feels_like_celsius": main.get("feels_like"),
            "humidity_percent": main.get("humidity"),
            "wind_speed_mps": wind.get("speed"),
            "wind_gust_mps": wind.get("gust"),
            "visibility_meters": data.get("visibility"),
            "precipitation_1h_mm": rain.get("1h", 0),
            "snow_1h_mm": snow.get("1h", 0),
            "clouds_percent": clouds.get("all"),
            "weather_main": weather.get("main"),
            "weather_description": weather.get("description"),
            "is_severe": is_severe
        }
        
    except requests.RequestException as e:
        logger.error(f"Weather API request failed: {e}")
        return None
    except Exception as e:
        logger.error(f"Error parsing weather data: {e}")
        return None


def store_weather(engine, weather: Dict[str, Any]) -> bool:
    """Store weather observation in database."""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO weather_observations (
                    observed_at, temp_celsius, feels_like_celsius, humidity_percent,
                    wind_speed_mps, wind_gust_mps, visibility_meters,
                    precipitation_1h_mm, snow_1h_mm, clouds_percent,
                    weather_main, weather_description, is_severe
                ) VALUES (
                    :observed_at, :temp_celsius, :feels_like_celsius, :humidity_percent,
                    :wind_speed_mps, :wind_gust_mps, :visibility_meters,
                    :precipitation_1h_mm, :snow_1h_mm, :clouds_percent,
                    :weather_main, :weather_description, :is_severe
                )
            """), {
                "observed_at": datetime.now(timezone.utc),
                "temp_celsius": weather.get("temp_celsius"),
                "feels_like_celsius": weather.get("feels_like_celsius"),
                "humidity_percent": weather.get("humidity_percent"),
                "wind_speed_mps": weather.get("wind_speed_mps"),
                "wind_gust_mps": weather.get("wind_gust_mps"),
                "visibility_meters": weather.get("visibility_meters"),
                "precipitation_1h_mm": weather.get("precipitation_1h_mm", 0),
                "snow_1h_mm": weather.get("snow_1h_mm", 0),
                "clouds_percent": weather.get("clouds_percent"),
                "weather_main": weather.get("weather_main"),
                "weather_description": weather.get("weather_description"),
                "is_severe": weather.get("is_severe", False)
            })
            conn.commit()
        
        logger.info(
            f"Stored weather: {weather.get('temp_celsius'):.1f}°C, "
            f"{weather.get('weather_description')}, "
            f"precip: {weather.get('precipitation_1h_mm', 0):.1f}mm"
        )
        return True
        
    except Exception as e:
        logger.error(f"Failed to store weather: {e}")
        return False


def run_weather_collector():
    """Main loop for weather collection."""
    database_url = os.getenv("DATABASE_URL")
    weather_api_key = os.getenv("OPENWEATHERMAP_API_KEY")
    
    if not database_url:
        logger.error("DATABASE_URL not set")
        return
    
    if not weather_api_key:
        logger.warning("OPENWEATHERMAP_API_KEY not set - weather collection disabled")
        logger.info("Get a free API key at https://openweathermap.org/api")
        return
    
    engine = create_engine(database_url, pool_pre_ping=True)
    
    # Ensure table exists
    if not create_weather_table(engine):
        logger.error("Failed to initialize weather table")
        return
    
    logger.info("Weather collector started")
    logger.info(f"Fetching weather every {WEATHER_INTERVAL_SECONDS // 60} minutes")
    
    while True:
        try:
            # Fetch and store weather
            weather = fetch_weather(weather_api_key)
            if weather:
                store_weather(engine, weather)
            else:
                logger.warning("No weather data received")
            
            # Wait for next interval
            time.sleep(WEATHER_INTERVAL_SECONDS)
            
        except KeyboardInterrupt:
            logger.info("Weather collector stopped")
            break
        except Exception as e:
            logger.error(f"Weather collection error: {e}")
            time.sleep(60)  # Wait a minute before retrying on error


if __name__ == "__main__":
    run_weather_collector()
