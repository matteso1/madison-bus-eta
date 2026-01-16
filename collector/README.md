# Madison Metro Data Collector

24/7 data collection service for Railway.

## Local Testing

```bash
cd collector
pip install -r requirements.txt
export MADISON_METRO_API_KEY=your_key
python collector.py
```

## Deploy to Railway

1. Create new service in Railway project
2. Point to this `collector/` directory
3. Set environment variables:
   - `MADISON_METRO_API_KEY` - Your API key
   - `SENTINEL_ENABLED` - "true" to stream to Sentinel
   - `SENTINEL_HOST` - Sentinel server hostname
   - `SENTINEL_PORT` - Sentinel server port

## Rate Limits

- Madison Metro allows ~10,000 requests/day
- Collector uses 30s intervals = 2,880 requests/day
- Safe margin for API endpoint + predictions if needed

## Data Storage

- Saves JSON files to `data/` directory
- Format: `vehicles_YYYYMMDD_HHMMSS.json`
- Contains: vehicle positions, routes, delays
