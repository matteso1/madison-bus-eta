"""Quick test of weather API and database storage"""
import os
from dotenv import load_dotenv
load_dotenv()

import requests
from sqlalchemy import create_engine, text

api_key = os.getenv('OPENWEATHERMAP_API_KEY')
database_url = os.getenv('DATABASE_URL')

print(f'API key set: {bool(api_key)}')
print(f'Database URL set: {bool(database_url)}')

# Test weather fetch
url = 'https://api.openweathermap.org/data/2.5/weather'
params = {'lat': 43.0731, 'lon': -89.4012, 'appid': api_key, 'units': 'metric'}
resp = requests.get(url, params=params)
print(f'Weather API Status: {resp.status_code}')

if resp.status_code == 200:
    data = resp.json()
    weather = data['weather'][0]['description']
    temp = data['main']['temp']
    wind = data['wind']['speed']
    print(f'Current weather in Madison:')
    print(f'  - Conditions: {weather}')
    print(f'  - Temperature: {temp}°C')
    print(f'  - Wind: {wind} m/s')
    
    # Store in database
    engine = create_engine(database_url, pool_pre_ping=True)
    with engine.connect() as conn:
        # Create table
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
        
        # Insert observation
        rain = data.get('rain', {}).get('1h', 0) or 0
        snow = data.get('snow', {}).get('1h', 0) or 0
        conn.execute(text("""
            INSERT INTO weather_observations (
                temp_celsius, feels_like_celsius, humidity_percent,
                wind_speed_mps, visibility_meters, precipitation_1h_mm, snow_1h_mm,
                clouds_percent, weather_main, weather_description
            ) VALUES (
                :temp, :feels_like, :humidity, :wind, :visibility,
                :rain, :snow, :clouds, :main, :desc
            )
        """), {
            'temp': data['main']['temp'],
            'feels_like': data['main']['feels_like'],
            'humidity': data['main']['humidity'],
            'wind': data['wind']['speed'],
            'visibility': data.get('visibility', 10000),
            'rain': rain,
            'snow': snow,
            'clouds': data['clouds']['all'],
            'main': data['weather'][0]['main'],
            'desc': data['weather'][0]['description']
        })
        conn.commit()
        
        # Verify
        count = conn.execute(text("SELECT COUNT(*) FROM weather_observations")).scalar()
        print(f'\n✅ Weather observation stored! Total records: {count}')
else:
    print(f'Error: {resp.text}')
