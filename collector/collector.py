"""
Madison Metro Data Collector - OPTIMIZED

Runs 24/7 on Railway, collecting maximum bus data within API rate limits.

RATE LIMIT STRATEGY:
- Madison Metro: ~10,000 requests/day = 417 req/hour = 6.9 req/min
- We collect: vehicles (1 req) + predictions per route batch (varies)

COLLECTION STRATEGY:
- Vehicles: Every 20 seconds (4320 req/day base)
- Predictions: Batch routes, cycle through all stops
- This leaves room for ~5680 prediction requests/day

With 29 routes and batching 10 at a time = 3 batches
Every 5 minutes = 288 prediction batches/day = ~864 requests
Total: 4320 + 864 = ~5200 req/day (well under 10k, room to grow)
"""

import os
import json
import time
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import requests
from dotenv import load_dotenv

# Import db module (only used if DATABASE_URL is set)
try:
    from db import (
        save_vehicles_to_db, save_predictions_to_db, get_db_engine,
        save_arrivals_to_db, save_prediction_outcomes_to_db, get_pending_predictions
    )
    DB_AVAILABLE = True
except ImportError:
    DB_AVAILABLE = False

# Import arrival detector
try:
    from arrival_detector import (
        ArrivalDetector, StopLocation, match_predictions_to_arrivals
    )
    ARRIVAL_DETECTOR_AVAILABLE = True
except ImportError as e:
    logging.warning(f"Arrival detector import error: {e}")
    ARRIVAL_DETECTOR_AVAILABLE = False

try:
    from sentinel_client import SentinelClient
    SENTINEL_CLIENT_AVAILABLE = True
except ImportError as e:
    logging.warning(f"Sentinel Import Error: {e}")
    SENTINEL_CLIENT_AVAILABLE = False

load_dotenv()

# Configuration
API_KEY = os.getenv('MADISON_METRO_API_KEY')
API_BASE = os.getenv('MADISON_METRO_API_BASE', 'https://metromap.cityofmadison.com/bustime/api/v3')

# Collection intervals (in seconds)
VEHICLE_INTERVAL = 60      # Get all vehicles every 60s = 1440 req/day
PREDICTION_INTERVAL = 300  # Get predictions every 5 min = ~864 req/day

DATA_DIR = Path(__file__).parent / 'data'
DATA_DIR.mkdir(exist_ok=True)

# Optional Sentinel config
SENTINEL_ENABLED = os.getenv('SENTINEL_ENABLED', 'false').lower() == 'true'
SENTINEL_HOST = os.getenv('SENTINEL_HOST', 'localhost')
SENTINEL_PORT = int(os.getenv('SENTINEL_PORT', '9092'))

# Database config (optional - for persistent storage)
DATABASE_URL = os.getenv('DATABASE_URL')

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

logger = logging.getLogger(__name__)

# Sentinel Client Instance
sentinel_client: Optional['SentinelClient'] = None

stats = {
    'vehicles_collected': 0,
    'predictions_collected': 0,
    'arrivals_detected': 0,
    'predictions_matched': 0,
    'requests_today': 0,
    'started_at': None,
    'last_vehicle_fetch': None,
    'last_prediction_fetch': None
}

# Global arrival detector instance
arrival_detector: Optional[ArrivalDetector] = None


def api_get(endpoint: str, **params) -> dict:
    """Make API request with error handling."""
    params['key'] = API_KEY
    params['format'] = 'json'
    url = f"{API_BASE}/{endpoint}"
    
    try:
        response = requests.get(url, params=params, timeout=15)
        response.raise_for_status()
        stats['requests_today'] += 1
        return response.json()
    except requests.RequestException as e:
        logger.error(f"API error on {endpoint}: {e}")
        return {}


def fetch_routes() -> list:
    """Fetch all active routes."""
    data = api_get('getroutes')
    routes = data.get('bustime-response', {}).get('routes', [])
    if not isinstance(routes, list):
        routes = [routes] if routes else []
    return [r.get('rt') for r in routes if r.get('rt')]


def fetch_all_vehicles() -> list:
    """Fetch all vehicle positions across all routes.
    
    The Madison Metro API requires the rt (route) parameter to return vehicles.
    We first fetch all routes, then batch requests (max 10 routes per call).
    """
    # First, get all active routes
    routes = fetch_routes()
    if not routes:
        logger.warning("No routes found - buses may not be running")
        return []
    
    logger.info(f"Found {len(routes)} routes: {routes}")
    
    all_vehicles = []
    # Batch routes (API allows up to 10 per request)
    for i in range(0, len(routes), 10):
        batch = routes[i:i+10]
        rt_param = ','.join(batch)
        data = api_get('getvehicles', rt=rt_param, tmres='s')
        
        vehicles = data.get('bustime-response', {}).get('vehicle', [])
        if vehicles:
            if not isinstance(vehicles, list):
                vehicles = [vehicles]
            all_vehicles.extend(vehicles)
        
        # Small delay between batches to be nice to API
        if i + 10 < len(routes):
            time.sleep(0.2)
    
    return all_vehicles


def fetch_predictions_batch(routes: list) -> list:
    """Fetch predictions for a batch of routes (up to 10)."""
    if not routes:
        return []
    rt_param = ','.join(routes[:10])
    data = api_get('getpredictions', rt=rt_param, top=100)
    preds = data.get('bustime-response', {}).get('prd', [])
    if not isinstance(preds, list):
        preds = [preds] if preds else []
    return preds


def fetch_all_stops(routes: list) -> list:
    """
    Fetch all stop locations for the given routes.
    
    Returns list of StopLocation objects for arrival detection.
    """
    if not ARRIVAL_DETECTOR_AVAILABLE:
        return []
    
    all_stops = []
    seen_stpids = set()
    
    # The API requires direction (dir) parameter
    # We need to fetch directions first, then stops for each direction
    for rt in routes:
        # Get directions for this route
        dir_data = api_get('getdirections', rt=rt)
        directions = dir_data.get('bustime-response', {}).get('directions', [])
        if not isinstance(directions, list):
            directions = [directions] if directions else []
        
        for dir_info in directions:
            dir_val = dir_info.get('id', dir_info.get('dir', ''))
            if not dir_val:
                continue
            
            # Get stops for this route + direction
            stop_data = api_get('getstops', rt=rt, dir=dir_val)
            stops = stop_data.get('bustime-response', {}).get('stops', [])
            if not isinstance(stops, list):
                stops = [stops] if stops else []
            
            for s in stops:
                stpid = str(s.get('stpid', ''))
                if stpid and stpid not in seen_stpids:
                    seen_stpids.add(stpid)
                    all_stops.append(StopLocation(
                        stpid=stpid,
                        stpnm=s.get('stpnm', ''),
                        lat=float(s.get('lat', 0)),
                        lon=float(s.get('lon', 0))
                    ))
        
        # Small delay between routes
        time.sleep(0.1)
    
    logger.info(f"Fetched {len(all_stops)} unique stops for {len(routes)} routes")
    return all_stops


def process_arrivals(vehicles: list) -> None:
    """
    Detect vehicle arrivals at stops and match to predictions.
    
    This generates ground truth for ML training:
    - Saves arrivals to stop_arrivals table
    - Matches arrivals to predictions
    - Saves prediction outcomes with error_seconds
    """
    global arrival_detector
    
    if not ARRIVAL_DETECTOR_AVAILABLE or arrival_detector is None:
        return
    
    if not DB_AVAILABLE or not DATABASE_URL:
        return
    
    # Detect arrivals
    arrivals = arrival_detector.detect_arrivals(vehicles)
    
    if not arrivals:
        return
    
    # Save arrivals to database
    arrivals_saved = save_arrivals_to_db(arrivals)
    stats['arrivals_detected'] += arrivals_saved
    
    # Get pending predictions for vehicles that just arrived
    vehicle_ids = [a.vid for a in arrivals]
    pending = get_pending_predictions(vehicle_ids, minutes_back=30)
    
    if not pending:
        return
    
    # Match arrivals to predictions
    outcomes = match_predictions_to_arrivals(arrivals, pending)
    
    if outcomes:
        outcomes_saved = save_prediction_outcomes_to_db(outcomes)
        stats['predictions_matched'] += outcomes_saved
        
        # Log summary
        avg_error = sum(o['error_seconds'] for o in outcomes) / len(outcomes)
        logger.info(
            f"Ground truth: {arrivals_saved} arrivals, "
            f"{outcomes_saved} predictions matched, "
            f"avg error: {avg_error/60:.1f}min"
        )


def save_data(data: dict, prefix: str) -> Path:
    """Save data to JSON file."""
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    date_dir = DATA_DIR / datetime.now(timezone.utc).strftime('%Y%m%d')
    date_dir.mkdir(exist_ok=True)
    
    filename = date_dir / f"{prefix}_{timestamp}.json"
    with open(filename, 'w') as f:
        json.dump(data, f, indent=2)
    return filename


def collect_vehicles() -> dict:
    """Collect all vehicle positions."""
    timestamp = datetime.now(timezone.utc).isoformat()
    vehicles = fetch_all_vehicles()
    
    # Extract unique routes for later prediction fetches
    active_routes = sorted(set(v.get('rt', '') for v in vehicles if v.get('rt')))
    
    # Calculate stats
    delayed_count = sum(1 for v in vehicles if v.get('dly'))
    
    data = {
        'timestamp': timestamp,
        'vehicle_count': len(vehicles),
        'delayed_count': delayed_count,
        'active_routes': active_routes,
        'vehicles': vehicles
    }
    
    filename = save_data(data, 'vehicles')
    stats['vehicles_collected'] += len(vehicles)
    stats['last_vehicle_fetch'] = timestamp
    
    # Save to database (Dual-write for reliability)
    # Deduplication handled by DB constraints (ON CONFLICT DO NOTHING)
    db_count = 0
    if DB_AVAILABLE and DATABASE_URL:
        db_count = save_vehicles_to_db(vehicles)
    
    db_msg = f", {db_count} to DB" if db_count else ""
    
    # Detect arrivals and generate ground truth for ML
    if vehicles:
        process_arrivals(vehicles)
    
    # Send to Sentinel
    sentinel_msg = ""
    if sentinel_client:
        success = sentinel_client.produce('madison-metro-vehicles', data)
        sentinel_msg = ", ✓ Streamed" if success else ", ✗ Stream Fail"
        
    logger.info(f"Vehicles: {len(vehicles)} total, {delayed_count} delayed, {len(active_routes)} routes → {filename.name}{db_msg}{sentinel_msg}")
    
    return data


def collect_predictions(routes: list) -> dict:
    """Collect predictions for all routes in batches."""
    timestamp = datetime.now(timezone.utc).isoformat()
    all_predictions = []
    
    # Batch routes (API allows 10 per request)
    for i in range(0, len(routes), 10):
        batch = routes[i:i+10]
        preds = fetch_predictions_batch(batch)
        all_predictions.extend(preds)
        time.sleep(0.5)  # Small delay between batches
    
    data = {
        'timestamp': timestamp,
        'prediction_count': len(all_predictions),
        'routes_queried': routes,
        'predictions': all_predictions
    }
    
    filename = save_data(data, 'predictions')
    stats['predictions_collected'] += len(all_predictions)
    stats['last_prediction_fetch'] = timestamp
    
    # Save to database (Dual-write for reliability)
    db_count = 0
    if DB_AVAILABLE and DATABASE_URL:
        db_count = save_predictions_to_db(all_predictions)
    
    db_msg = f", {db_count} to DB" if db_count else ""

    # Send to Sentinel
    sentinel_msg = ""
    if sentinel_client:
        success = sentinel_client.produce('madison-metro-predictions', data)
        sentinel_msg = ", ✓ Streamed" if success else ", ✗ Stream Fail"

    logger.info(f"Predictions: {len(all_predictions)} for {len(routes)} routes → {filename.name}{db_msg}{sentinel_msg}")
    
    return data


def log_stats():
    """Log collection statistics."""
    runtime = datetime.now(timezone.utc) - datetime.fromisoformat(stats['started_at'])
    hours = runtime.total_seconds() / 3600
    
    logger.info("=" * 50)
    logger.info("COLLECTION STATS")
    logger.info(f"  Runtime: {hours:.1f} hours")
    logger.info(f"  Vehicles collected: {stats['vehicles_collected']}")
    logger.info(f"  Predictions collected: {stats['predictions_collected']}")
    logger.info(f"  Arrivals detected: {stats['arrivals_detected']}")
    logger.info(f"  Predictions matched: {stats['predictions_matched']}")
    logger.info(f"  API requests today: {stats['requests_today']}")
    logger.info(f"  Rate: {stats['requests_today']/max(hours,0.1):.1f} req/hour")
    logger.info("=" * 50)


def run_collector():
    """Main collection loop with optimized intervals."""
    logger.info("=" * 60)
    logger.info("MADISON METRO DATA COLLECTOR - OPTIMIZED")
    logger.info("=" * 60)
    logger.info(f"API Base: {API_BASE}")
    logger.info(f"Vehicle Interval: {VEHICLE_INTERVAL}s")
    logger.info(f"Prediction Interval: {PREDICTION_INTERVAL}s")
    logger.info(f"Vehicle Interval: {VEHICLE_INTERVAL}s")
    logger.info(f"Prediction Interval: {PREDICTION_INTERVAL}s")
    logger.info(f"Sentinel Enabled: {SENTINEL_ENABLED}")
    
    # Initialize Sentinel Client
    global sentinel_client
    if SENTINEL_ENABLED:
        if SENTINEL_CLIENT_AVAILABLE:
            sentinel_client = SentinelClient(host=SENTINEL_HOST, port=SENTINEL_PORT)
            logger.info(f"Sentinel: Initialized client for {SENTINEL_HOST}:{SENTINEL_PORT}")
        else:
            logger.error("Sentinel: Enabled but client library setup failed")
        
    # Database status
    if DATABASE_URL and DB_AVAILABLE:
        try:
            engine = get_db_engine()
            if engine:
                logger.info("Database: ✓ PostgreSQL connected")
            else:
                logger.info("Database: ✗ Connection failed")
        except Exception as e:
            logger.warning(f"Database: ✗ Error: {e}")
    else:
        logger.info("Database: not configured (set DATABASE_URL)")
    
    if not API_KEY:
        logger.error("MADISON_METRO_API_KEY not set! Exiting.")
        return
    
    # Initialize Arrival Detector for ground truth collection
    global arrival_detector
    if ARRIVAL_DETECTOR_AVAILABLE and DB_AVAILABLE:
        logger.info("Arrival Detector: Fetching stop locations...")
        try:
            # Get initial routes to fetch stops for
            routes = fetch_routes()
            if routes:
                stops = fetch_all_stops(routes)
                if stops:
                    arrival_detector = ArrivalDetector(stops)
                    logger.info(f"Arrival Detector: ✓ Initialized with {len(stops)} stops")
                else:
                    logger.warning("Arrival Detector: No stops found")
            else:
                logger.warning("Arrival Detector: No routes found, will retry later")
        except Exception as e:
            logger.warning(f"Arrival Detector: Failed to initialize: {e}")
    else:
        logger.info("Arrival Detector: Disabled (missing dependencies)")
    
    logger.info("Starting optimized collection loop...")
    stats['started_at'] = datetime.now(timezone.utc).isoformat()
    
    last_vehicle_time = 0
    last_prediction_time = 0
    last_stats_time = 0
    active_routes = []
    
    while True:
        try:
            current_time = time.time()
            
            # Collect vehicles on interval
            if current_time - last_vehicle_time >= VEHICLE_INTERVAL:
                vehicle_data = collect_vehicles()
                active_routes = vehicle_data.get('active_routes', active_routes)
                last_vehicle_time = current_time
            
            # Collect predictions on interval (less frequently)
            if current_time - last_prediction_time >= PREDICTION_INTERVAL:
                if active_routes:
                    collect_predictions(active_routes)
                last_prediction_time = current_time
            
            # Log stats every hour
            if current_time - last_stats_time >= 3600:
                log_stats()
                last_stats_time = current_time
            
            # Short sleep to prevent CPU spin
            time.sleep(1)
            
        except KeyboardInterrupt:
            logger.info("Shutting down...")
            log_stats()
            break
        except Exception as e:
            logger.error(f"Collection error: {e}")
            time.sleep(30)  # Back off on error


if __name__ == '__main__':
    run_collector()
