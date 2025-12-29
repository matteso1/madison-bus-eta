# Enriched Data Collection Guide

## 🎯 What's New

Your data collector now automatically enriches every record with:
1. **Weather Data** - Temperature, precipitation, wind, conditions
2. **Event Data** - Major Madison events (UW football, festivals, etc.)
3. **Madison Open Data** - Traffic, construction, accidents (optional)

## 🌤️ Weather Integration

### Setup

1. **Get OpenWeatherMap API Key** (Free tier: 1,000 calls/day)
   - Sign up at: https://openweathermap.org/api
   - Free tier is perfect for your use case
   - Add to `.env`: `OPENWEATHER_API_KEY=your_key_here`

2. **Automatic Collection**
   - Weather is fetched automatically with each data collection cycle
   - Cached to avoid API limits
   - Historical weather stored for analysis

### Weather Features Collected

- `weather_temp` - Temperature (Fahrenheit)
- `weather_precipitation` - Estimated precipitation (inches)
- `weather_wind_speed` - Wind speed (mph)
- `weather_is_rainy` - Binary (1 if rain/drizzle)
- `weather_is_snowy` - Binary (1 if snow)
- `weather_is_extreme` - Binary (1 if extreme conditions)
- `weather_condition` - Main condition (rain, snow, clear, etc.)

### Usage in Analysis

Now you can answer questions like:
- "Do delays increase 40% during rain?"
- "Which routes are most affected by snow?"
- "Does wind speed correlate with prediction errors?"

## 🎉 Event Tracking

### Automatic Events

The system tracks these major annual events:

1. **UW Football Home Games** - High impact on campus routes (80, 81, 82, 84)
2. **Art Fair on the Square** - 200K+ attendees, affects downtown routes
3. **Dane County Farmers' Market** - Every Saturday, April-November
4. **Mifflin Street Block Party** - Last Saturday of April
5. **La Fête de Marquette** - July festival, 40K+ attendees
6. **Wisconsin Film Festival** - 8-day April event
7. **Great Midwest Marijuana Harvest Festival** - October

### Event Features Collected

- `event_name` - Name of event (if any)
- `event_type` - Type (sports, festival, market, etc.)
- `event_impact` - Impact level (high, medium, low)
- `is_event_day` - Binary (1 if event day)
- `route_affected_by_event` - Binary (1 if route is affected)

### Adding Custom Events

```python
from utils.event_tracker import MadisonEventTracker

tracker = MadisonEventTracker()
tracker.add_special_event(
    name="Custom Concert",
    date="2025-10-15",
    impact="high",
    affected_routes=["A", "B", "C"],
    description="Major concert at Kohl Center"
)
```

### Usage in Analysis

Now you can answer:
- "Route 80 delays increase 3x during UW football games"
- "Which events cause the most transit disruption?"
- "Should we add extra buses during Art Fair?"

## 📊 Madison Open Data Integration

### Available Datasets

From [Madison Open Data Portal](https://data-cityofmadison.opendata.arcgis.com/):

1. **Traffic Accidents** - Real-time accident data
2. **Traffic Volumes** - Road traffic patterns
3. **Construction Projects** - Active construction
4. **Parking Meters** - Parking availability
5. **Bike Paths** - Alternative transportation routes

### Usage

```python
from utils.madison_open_data import MadisonOpenData

data = MadisonOpenData()

# Get construction projects affecting routes
construction = data.get_construction_projects()

# Get traffic accidents
accidents = data.get_traffic_accidents_near_route(route_coords)
```

## 🔄 How It Works

### Data Collection Flow

1. **Collect Transit Data** (vehicles, predictions)
2. **Enrich with Weather** - Fetch current weather conditions
3. **Enrich with Events** - Check if today is an event day
4. **Save Enriched Data** - All features in one CSV

### Example Enriched Record

```json
{
  "rt": "80",
  "stpid": "10086",
  "prdctdn": "5",
  "tmstmp": "2025-10-15T08:30:00",
  "collection_timestamp": "2025-10-15T08:30:15",
  "weather_temp": 45.2,
  "weather_precipitation": 0.1,
  "weather_is_rainy": 1,
  "weather_wind_speed": 12.5,
  "event_name": "UW Football Home Game",
  "event_impact": "high",
  "is_event_day": 1,
  "route_affected_by_event": 1
}
```

## 📈 New Analysis Capabilities

### Weather Impact Analysis

```python
# In data_aggregator.py or analysis
rainy_delays = df[df['weather_is_rainy'] == 1]['api_prediction_error'].mean()
clear_delays = df[df['weather_is_rainy'] == 0]['api_prediction_error'].mean()
print(f"Rain increases delays by {((rainy_delays/clear_delays - 1) * 100):.0f}%")
```

### Event Impact Analysis

```python
# Compare event days vs normal days
event_delays = df[df['is_event_day'] == 1]['api_prediction_error'].mean()
normal_delays = df[df['is_event_day'] == 0]['api_prediction_error'].mean()
print(f"Events increase delays by {((event_delays/normal_delays - 1) * 100):.0f}%")
```

### Combined Analysis

```python
# Worst case: Event + Rain
worst_case = df[(df['is_event_day'] == 1) & (df['weather_is_rainy'] == 1)]
print(f"Event + Rain delays: {worst_case['api_prediction_error'].mean():.2f} min")
```

## 🚀 Getting Started

### 1. Set Up Weather API

```bash
# Add to .env file
OPENWEATHER_API_KEY=your_key_here
```

### 2. Run Enhanced Collector

```bash
cd backend
python optimal_collector.py
```

The collector will automatically:
- Fetch weather for each collection cycle
- Check for events on each day
- Enrich all records with this data

### 3. Analyze Enriched Data

Your existing analysis code will automatically have access to:
- Weather features in `consolidated_metro_data.csv`
- Event flags in the data
- All new insights enabled by this context

## 💡 Insights You Can Now Generate

1. **"Rain increases Route 2 delays by 45%"**
2. **"UW football games cause 3x delays on campus routes"**
3. **"Art Fair on the Square adds 8 minutes to downtown routes"**
4. **"Snow affects BRT routes less than local routes"**
5. **"Event + Rain = worst delays (add 10 min buffer)"**

## 📝 Next Steps

1. **Collect for 1 week** with enriched data
2. **Re-run analysis** - you'll see weather/event correlations
3. **Add to ML model** - weather/events as features improve predictions
4. **Create event-aware predictions** - "During UW games, add 5 min"

## 🎯 Impact

This transforms your project from:
- ❌ "Rush hour has delays" (generic)

To:
- ✅ "UW football games increase Route 80 delays by 180% during rain" (specific, actionable)

**This is the kind of insight that gets you hired!**

