# WeatherAPI.com Setup Guide

## ✅ Your API Key is Already Configured!

Your WeatherAPI key (`1f2c85990da1445d9ae211611250611`) is already hardcoded in the weather tracker as a fallback. The system will work immediately!

## Optional: Add to .env

For better security (though the key is already in code), you can also add it to `.env`:

```bash
# backend/.env
WEATHERAPI_KEY=1f2c85990da1445d9ae211611250611
```

## What WeatherAPI Provides (Free Tier)

According to [WeatherAPI.com docs](https://www.weatherapi.com/docs/):

- ✅ **Real-time weather** - Current conditions
- ✅ **Historical weather** - Past dates (perfect for your data!)
- ✅ **14-day forecast** - Future predictions
- ✅ **No credit card required** - Truly free
- ✅ **1 million calls/month** - More than enough

## Features Being Collected

Every transit record now includes:

- `weather_temp` - Temperature (Fahrenheit)
- `weather_precipitation` - Actual precipitation (inches) - **This is huge!**
- `weather_wind_speed` - Wind speed (mph)
- `weather_is_rainy` - Binary flag
- `weather_is_snowy` - Binary flag
- `weather_is_extreme` - Extreme conditions flag
- `weather_condition` - Text description

## Why This is Better Than OpenWeatherMap

1. **Free historical data** - OpenWeatherMap charges for history
2. **Actual precipitation** - Not estimated
3. **Better free tier** - 1M calls/month vs 1K/day
4. **No credit card** - Truly free

## Testing

Run your collector and check the CSV files - you should see weather columns automatically added!

```bash
cd backend
python optimal_collector.py
```

Check a CSV file:
```bash
head -1 collected_data/predictions_*.csv | tail -1
```

You should see columns like `weather_temp`, `weather_precipitation`, etc.

