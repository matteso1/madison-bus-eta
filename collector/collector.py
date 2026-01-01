"""
Madison Metro Data Collector

Runs 24/7 on Railway, collecting bus data within API rate limits.
Stores data for ML training and can optionally stream to Sentinel.

Rate Limits (Madison Metro API):
- 10,000 requests/day = ~7 req/min = 1 req every 8.5 seconds
- We'll use 30s intervals to be safe (2880 req/day)
"""

import os
import json
import time
import logging
from datetime import datetime, timezone
from pathlib import Path
import requests
from dotenv import load_dotenv

load_dotenv()

# Configuration
API_KEY = os.getenv('MADISON_METRO_API_KEY')
API_BASE = os.getenv('MADISON_METRO_API_BASE', 'https://metromap.cityofmadison.com/bustime/api/v3')
COLLECTION_INTERVAL_SECONDS = 30  # Safe rate: 2880 req/day
DATA_DIR = Path(__file__).parent / 'data'

# Optional Sentinel config (for streaming to message queue)
SENTINEL_ENABLED = os.getenv('SENTINEL_ENABLED', 'false').lower() == 'true'
SENTINEL_HOST = os.getenv('SENTINEL_HOST', 'localhost')
SENTINEL_PORT = int(os.getenv('SENTINEL_PORT', '9092'))

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


def api_get(endpoint: str, **params) -> dict:
    """Make API request with rate limiting."""
    params['key'] = API_KEY
    params['format'] = 'json'
    url = f"{API_BASE}/{endpoint}"
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        logger.error(f"API error: {e}")
        return {}


def fetch_vehicles() -> list:
    """Fetch all vehicle positions."""
    data = api_get('getvehicles', tmres='s')
    vehicles = data.get('bustime-response', {}).get('vehicle', [])
    if not isinstance(vehicles, list):
        vehicles = [vehicles] if vehicles else []
    return vehicles


def fetch_predictions_for_routes(routes: list) -> list:
    """Fetch predictions for multiple routes (batch to limit requests)."""
    # API allows up to 10 routes per request
    all_predictions = []
    for i in range(0, len(routes), 10):
        batch = routes[i:i+10]
        rt_param = ','.join(batch)
        data = api_get('getpredictions', rt=rt_param, top=50)
        preds = data.get('bustime-response', {}).get('prd', [])
        if not isinstance(preds, list):
            preds = [preds] if preds else []
        all_predictions.extend(preds)
        time.sleep(0.5)  # Small delay between batches
    return all_predictions


def save_to_file(data: dict, prefix: str):
    """Save data to JSON file with timestamp."""
    DATA_DIR.mkdir(exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    filename = DATA_DIR / f"{prefix}_{timestamp}.json"
    
    with open(filename, 'w') as f:
        json.dump(data, f)
    
    return filename


def send_to_sentinel(topic: str, messages: list):
    """Send messages to Sentinel (if enabled)."""
    if not SENTINEL_ENABLED:
        return
    
    # TODO: Implement proper gRPC client
    # For now, log that we would send
    logger.info(f"Would send {len(messages)} messages to Sentinel topic: {topic}")


def collect_once() -> dict:
    """Single collection cycle."""
    timestamp = datetime.now(timezone.utc).isoformat()
    
    # Fetch vehicles
    vehicles = fetch_vehicles()
    logger.info(f"Fetched {len(vehicles)} vehicles")
    
    # Extract active routes
    active_routes = list(set(v.get('rt', '') for v in vehicles if v.get('rt')))
    
    # Package data
    data = {
        'timestamp': timestamp,
        'vehicle_count': len(vehicles),
        'vehicles': vehicles,
        'active_routes': active_routes
    }
    
    # Save locally
    filename = save_to_file(data, 'vehicles')
    logger.info(f"Saved to {filename}")
    
    # Stream to Sentinel if enabled
    if SENTINEL_ENABLED:
        messages = [{
            'vid': v.get('vid'),
            'rt': v.get('rt'),
            'lat': v.get('lat'),
            'lon': v.get('lon'),
            'hdg': v.get('hdg'),
            'dly': v.get('dly', False),
            'timestamp': timestamp
        } for v in vehicles]
        send_to_sentinel('bus-positions', messages)
    
    return data


def run_collector():
    """Main collection loop."""
    logger.info("=" * 50)
    logger.info("Madison Metro Data Collector")
    logger.info("=" * 50)
    logger.info(f"API Base: {API_BASE}")
    logger.info(f"Collection Interval: {COLLECTION_INTERVAL_SECONDS}s")
    logger.info(f"Data Directory: {DATA_DIR}")
    logger.info(f"Sentinel Enabled: {SENTINEL_ENABLED}")
    
    if not API_KEY:
        logger.error("MADISON_METRO_API_KEY not set!")
        return
    
    logger.info("Starting collection loop...")
    
    collection_count = 0
    while True:
        try:
            data = collect_once()
            collection_count += 1
            
            # Log stats every 10 collections
            if collection_count % 10 == 0:
                logger.info(f"Total collections: {collection_count}")
            
        except Exception as e:
            logger.error(f"Collection error: {e}")
        
        time.sleep(COLLECTION_INTERVAL_SECONDS)


if __name__ == '__main__':
    run_collector()
