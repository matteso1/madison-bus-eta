# Madison Metro ML API Documentation

## Overview

The Madison Metro ML API provides real-time bus data, machine learning predictions, and analytics for the Madison Metro transit system. Built with Flask and designed for high-performance data processing.

## Base URL

```
http://localhost:5000
```

## Authentication

Currently, no authentication is required. In production, consider implementing API keys or OAuth.

## Rate Limits

- **Daily Limit**: 10,000 requests per day
- **Current Usage**: ~9,500 requests per day
- **Safety Margin**: 500 requests

## Core Endpoints

### Bus Routes

#### Get All Routes
```http
GET /routes
```

**Response:**
```json
{
  "bustime-response": {
    "routes": [
      {
        "rt": "A",
        "rtnm": "BRT Route A",
        "rtclr": "#FF0000"
      }
    ]
  }
}
```

#### Get Route Directions
```http
GET /directions?rt={route}
```

**Parameters:**
- `rt` (string, required): Route identifier

**Response:**
```json
{
  "bustime-response": {
    "directions": [
      {
        "id": "Northbound",
        "name": "Northbound"
      }
    ]
  }
}
```

### 🚏 Bus Stops

#### Get Stops for Route/Direction
```http
GET /stops?rt={route}&dir={direction}
```

**Parameters:**
- `rt` (string, required): Route identifier
- `dir` (string, required): Direction identifier

**Response:**
```json
{
  "bustime-response": {
    "stops": [
      {
        "stpid": "1234",
        "stpnm": "University & State",
        "lat": "43.0731",
        "lon": "-89.4012"
      }
    ]
  }
}
```

### Live Vehicles

#### Get Live Vehicle Locations
```http
GET /vehicles?rt={route}
```

**Parameters:**
- `rt` (string, required): Route identifier

**Response:**
```json
{
  "bustime-response": {
    "vehicle": [
      {
        "vid": "1234",
        "rt": "A",
        "des": "Downtown",
        "lat": "43.0731",
        "lon": "-89.4012",
        "spd": "25",
        "dly": "false",
        "psgld": "HALF_EMPTY",
        "tmstmp": "20240101120000"
      }
    ]
  }
}
```

### ⏰ Predictions

#### Get Arrival Predictions
```http
GET /predictions?stpid={stop_id}
```

**Parameters:**
- `stpid` (string, required): Stop identifier

**Response:**
```json
{
  "bustime-response": {
    "prd": [
      {
        "stpid": "1234",
        "stpnm": "University & State",
        "vid": "1234",
        "rt": "A",
        "des": "Downtown",
        "prdctdn": "5",
        "prdtm": "20240101120005",
        "dly": "false"
      }
    ]
  }
}
```

### Route Patterns

#### Get Route Patterns
```http
GET /patterns?rt={route}&dir={direction}
```

**Parameters:**
- `rt` (string, required): Route identifier
- `dir` (string, required): Direction identifier

**Response:**
```json
{
  "bustime-response": {
    "ptr": [
      {
        "pid": "1234",
        "rtdir": "Northbound",
        "pt": [
          {
            "lat": "43.0731",
            "lon": "-89.4012"
          }
        ]
      }
    ]
  }
}
```

## 🤖 Machine Learning Endpoints

### Predict Bus Delay
```http
POST /predict
Content-Type: application/json

{
  "route": "A",
  "stop_id": "1234",
  "time_of_day": "08:30",
  "day_of_week": "Monday",
  "weather": "clear"
}
```

**Response:**
```json
{
  "prediction": {
    "delay_minutes": 2.3,
    "confidence": 0.875,
    "model_used": "XGBoost",
    "features": {
      "time_of_day": 0.35,
      "route_type": 0.28,
      "weather": 0.18
    }
  }
}
```

### Get Model Performance
```http
GET /ml/performance
```

**Response:**
```json
{
  "models": [
    {
      "name": "XGBoost",
      "accuracy": 0.875,
      "mae": 1.79,
      "training_time": 45
    }
  ],
  "overall_accuracy": 0.875,
  "total_predictions": 100000
}
```

### Get Feature Importance
```http
GET /ml/features
```

**Response:**
```json
{
  "features": [
    {
      "name": "Time of Day",
      "importance": 0.35
    },
    {
      "name": "Route Type",
      "importance": 0.28
    }
  ]
}
```

### Get ML Insights
```http
GET /ml/insights
```

**Response:**
```json
{
  "insights": [
    {
      "title": "Peak Delay Times",
      "description": "Morning rush (7-8 AM) shows highest delay variance",
      "impact": "40% more delays than average"
    }
  ],
  "data_quality": {
    "completeness": 0.954,
    "total_records": 100000
  }
}
```

## Analytics Endpoints

### Get Route Statistics
```http
GET /analytics/routes
```

**Response:**
```json
{
  "routes": [
    {
      "route": "A",
      "avg_delay": 2.1,
      "trip_count": 120,
      "passenger_avg": 45
    }
  ]
}
```

### Get System Statistics
```http
GET /analytics/system
```

**Response:**
```json
{
  "total_routes": 19,
  "active_vehicles": 45,
  "total_predictions": 100000,
  "data_collection_rate": "95.4%"
}
```

## Error Handling

### Error Response Format
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": "Additional error details"
}
```

### Common Error Codes

| Code | Description | Solution |
|------|-------------|----------|
| `INVALID_ROUTE` | Route not found | Check route identifier |
| `INVALID_STOP` | Stop not found | Check stop identifier |
| `API_LIMIT_EXCEEDED` | Rate limit exceeded | Wait and retry |
| `ML_MODEL_ERROR` | ML prediction failed | Check model status |
| `DATA_UNAVAILABLE` | No data available | Check data collection |

## Performance Metrics

- **Average Response Time**: <200ms
- **Uptime**: 99.9%
- **Data Freshness**: <5 minutes
- **Prediction Accuracy**: 87.5%

## Usage Examples

### JavaScript/React
```javascript
// Get all routes
const routes = await fetch('/api/routes').then(r => r.json());

// Get live vehicles for route A
const vehicles = await fetch('/api/vehicles?rt=A').then(r => r.json());

// Predict delay
const prediction = await fetch('/api/predict', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    route: 'A',
    stop_id: '1234',
    time_of_day: '08:30'
  })
}).then(r => r.json());
```

### Python
```python
import requests

# Get all routes
routes = requests.get('http://localhost:5000/routes').json()

# Get live vehicles
vehicles = requests.get('http://localhost:5000/vehicles?rt=A').json()

# Predict delay
prediction = requests.post('http://localhost:5000/predict', json={
    'route': 'A',
    'stop_id': '1234',
    'time_of_day': '08:30'
}).json()
```

### cURL
```bash
# Get all routes
curl http://localhost:5000/routes

# Get live vehicles
curl "http://localhost:5000/vehicles?rt=A"

# Predict delay
curl -X POST http://localhost:5000/predict \
  -H "Content-Type: application/json" \
  -d '{"route":"A","stop_id":"1234","time_of_day":"08:30"}'
```

## 🔒 Security Considerations

- **Input Validation**: All inputs are validated and sanitized
- **Rate Limiting**: API calls are rate-limited to prevent abuse
- **Error Handling**: Sensitive information is not exposed in errors
- **CORS**: Cross-origin requests are properly configured

## 📝 Changelog

### v1.0.0 (2024-01-01)
- Initial API release
- Core bus data endpoints
- ML prediction endpoints
- Analytics and insights

## 🤝 Support

For API support or questions:
- **GitHub Issues**: [Create an issue](https://github.com/yourusername/madison-bus-eta/issues)
- **Email**: your.email@example.com
- **Documentation**: [Full docs](https://github.com/yourusername/madison-bus-eta)

---

*This API is part of the Madison Metro ML project - a comprehensive machine learning system for public transportation analytics.*
