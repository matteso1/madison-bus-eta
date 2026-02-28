"""
Madison Metro Data Collector

Runs 24/7 on Railway, collecting bus data from multiple sources:

1. REST API  — Vehicle positions + arrival predictions (rate-limited)
2. GTFS-RT   — Trip updates + vehicle positions (free, protobuf feeds)
3. Static GTFS — Schedule data, loaded once then refreshed weekly

RATE LIMIT STRATEGY (REST API only):
- Madison Metro: ~10,000 requests/day = 417 req/hour
- Vehicles every 60s + predictions every 120s ≈ 5,200 req/day
- GTFS-RT feeds are FREE and don't count against the API key limit
"""

import os
import json
import time
import logging
import threading
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Optional
import requests
from dotenv import load_dotenv

# Import db module (only used if DATABASE_URL is set)
try:
    from db import (
        save_vehicles_to_db, save_predictions_to_db, get_db_engine,
        save_arrivals_to_db, save_prediction_outcomes_to_db, get_pending_predictions,
        save_gtfsrt_stop_times, save_gtfsrt_vehicle_positions,
        save_gtfs_stops, save_gtfs_trips, save_gtfs_stop_times,
        save_gtfs_feed_info, save_segment_travel_times,
        get_unprocessed_gtfsrt_stop_times, get_scheduled_travel_time,
        save_bunching_events,
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

# Import GTFS-RT collector
try:
    from gtfsrt_collector import collect_gtfsrt
    GTFSRT_AVAILABLE = True
except ImportError as e:
    logging.warning(f"GTFS-RT collector import error: {e}")
    GTFSRT_AVAILABLE = False

# Import static GTFS loader
try:
    from gtfs_static_loader import load_static_gtfs
    GTFS_STATIC_AVAILABLE = True
except ImportError as e:
    logging.warning(f"Static GTFS loader import error: {e}")
    GTFS_STATIC_AVAILABLE = False

# Import segment builder
try:
    from segment_builder import build_segments
    SEGMENT_BUILDER_AVAILABLE = True
except ImportError as e:
    logging.warning(f"Segment builder import error: {e}")
    SEGMENT_BUILDER_AVAILABLE = False

# Import DB maintenance
try:
    from db_maintenance import run_full_maintenance
    DB_MAINTENANCE_AVAILABLE = True
except ImportError as e:
    logging.warning(f"DB maintenance import error: {e}")
    DB_MAINTENANCE_AVAILABLE = False

# Import bunch detector
try:
    from bunch_detector import BunchDetector
    BUNCH_DETECTOR_AVAILABLE = True
except ImportError as e:
    logging.warning(f"Bunch detector import error: {e}")
    BUNCH_DETECTOR_AVAILABLE = False

load_dotenv()

# Configuration
API_KEY = os.getenv('MADISON_METRO_API_KEY')
API_BASE = os.getenv('MADISON_METRO_API_BASE', 'https://metromap.cityofmadison.com/bustime/api/v3')

# Collection intervals (in seconds) — configurable via env vars
VEHICLE_INTERVAL = int(os.getenv('VEHICLE_INTERVAL', '60'))
PREDICTION_INTERVAL = int(os.getenv('PREDICTION_INTERVAL', '120'))
GTFSRT_INTERVAL = int(os.getenv('GTFSRT_INTERVAL', '120'))
SEGMENT_BUILD_INTERVAL = int(os.getenv('SEGMENT_BUILD_INTERVAL', '300'))

DATA_DIR = Path(__file__).parent / 'data'
DATA_DIR.mkdir(exist_ok=True)

# Database config (optional - for persistent storage)
DATABASE_URL = os.getenv('DATABASE_URL')

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

logger = logging.getLogger(__name__)

stats = {
    'vehicles_collected': 0,
    'predictions_collected': 0,
    'arrivals_detected': 0,
    'predictions_matched': 0,
    'requests_today': 0,
    'gtfsrt_trip_updates': 0,
    'gtfsrt_vehicle_positions': 0,
    'segments_built': 0,
    'bunching_events': 0,
    'started_at': None,
    'last_vehicle_fetch': None,
    'last_prediction_fetch': None,
    'last_gtfsrt_fetch': None,
    'last_segment_build': None,
}

# Global arrival detector instance
arrival_detector: Optional[ArrivalDetector] = None

# Global bunch detector instance
_bunch_detector: Optional[object] = None


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


def fetch_predictions_batch(vehicle_ids: list) -> list:
    """Fetch predictions for a batch of vehicles (up to 10).
    
    The getpredictions API requires 'stpid' or 'vid', NOT 'rt'.
    We use vehicle IDs to get predictions for where each bus is headed.
    """
    if not vehicle_ids:
        return []
    vid_param = ','.join(vehicle_ids[:10])
    data = api_get('getpredictions', vid=vid_param, top=10)
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


def _update_ab_test_matches(outcomes: list) -> None:
    """
    Update ab_test_predictions table when arrivals are detected.
    
    Matches on vehicle_id only (not stop_id) because A/B predictions logged
    from the frontend use stop_id='live_tracking' rather than real stop IDs.
    Uses a tight time window and LIMIT 1 to avoid false matches.
    """
    if not DB_AVAILABLE or not DATABASE_URL:
        return

    try:
        from sqlalchemy import create_engine, text as sa_text
        engine = create_engine(DATABASE_URL, pool_pre_ping=True)
        matched_count = 0
        with engine.connect() as conn:
            for outcome in outcomes:
                try:
                    actual = outcome.get('actual_arrival')
                    vid = str(outcome.get('vid', ''))
                    if not vid or not actual:
                        continue
                    result = conn.execute(sa_text("""
                        UPDATE ab_test_predictions
                        SET matched = true,
                            matched_at = NOW(),
                            stop_id = :stpid,
                            actual_arrival_sec = EXTRACT(EPOCH FROM :actual_arrival::timestamptz),
                            api_error_sec = ABS(
                                EXTRACT(EPOCH FROM :actual_arrival::timestamptz)
                                - (EXTRACT(EPOCH FROM created_at) + api_prediction_sec)
                            ),
                            ml_error_sec = CASE
                                WHEN ml_prediction_sec IS NOT NULL
                                THEN ABS(
                                    EXTRACT(EPOCH FROM :actual_arrival::timestamptz)
                                    - (EXTRACT(EPOCH FROM created_at) + ml_prediction_sec)
                                )
                                ELSE NULL END,
                            ml_won = CASE
                                WHEN ml_prediction_sec IS NOT NULL
                                THEN ABS(
                                    EXTRACT(EPOCH FROM :actual_arrival::timestamptz)
                                    - (EXTRACT(EPOCH FROM created_at) + ml_prediction_sec)
                                ) < ABS(
                                    EXTRACT(EPOCH FROM :actual_arrival::timestamptz)
                                    - (EXTRACT(EPOCH FROM created_at) + api_prediction_sec)
                                )
                                ELSE false END
                        WHERE id = (
                            SELECT id FROM ab_test_predictions
                            WHERE vehicle_id = :vid
                              AND matched = false
                              AND created_at > NOW() - INTERVAL '45 minutes'
                            ORDER BY created_at DESC
                            LIMIT 1
                        )
                    """), {
                        'vid': vid,
                        'stpid': str(outcome.get('stpid', '')),
                        'actual_arrival': actual,
                    })
                    if result.rowcount > 0:
                        matched_count += 1
                except Exception as e:
                    logger.debug(f"A/B match error for vid={outcome.get('vid')}: {e}")
            conn.commit()
        if matched_count:
            logger.info(f"A/B test: matched {matched_count} predictions to arrivals")
    except Exception as e:
        logger.warning(f"A/B test match update failed (non-critical): {e}")


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
        # Log diagnostic: arrivals detected but no predictions found in DB
        sample = arrivals[:3]
        logger.warning(
            f"Ground truth gap: {len(arrivals)} arrivals but 0 pending predictions. "
            f"Sample arrival stpids: {[a.stpid for a in sample]}, "
            f"vids: {[a.vid for a in sample]}"
        )
        return

    # Log stpid formats for diagnostic (detect GTFS vs API ID mismatch)
    arrival_stpids = set(a.stpid for a in arrivals)
    pred_stpids = set(p['stpid'] for p in pending)
    overlap = arrival_stpids & pred_stpids
    if not overlap and arrival_stpids and pred_stpids:
        logger.warning(
            f"Ground truth ID MISMATCH: arrival stpids (GTFS) {list(arrival_stpids)[:5]} "
            f"vs prediction stpids (API) {list(pred_stpids)[:5]} — zero overlap!"
        )

    # Match arrivals to predictions
    outcomes = match_predictions_to_arrivals(arrivals, pending)

    if outcomes:
        outcomes_saved = save_prediction_outcomes_to_db(outcomes)
        stats['predictions_matched'] += outcomes_saved

        # Update A/B test records for matched arrivals
        _update_ab_test_matches(outcomes)

        # Log summary
        avg_error = sum(o['error_seconds'] for o in outcomes) / len(outcomes)
        logger.info(
            f"Ground truth: {arrivals_saved} arrivals, "
            f"{outcomes_saved} predictions matched, "
            f"avg error: {avg_error/60:.1f}min"
        )
    else:
        logger.warning(
            f"Ground truth: {arrivals_saved} arrivals, {len(pending)} pending predictions, "
            f"but 0 matched. Arrival stpids: {list(arrival_stpids)[:5]}, "
            f"Pred stpids: {list(pred_stpids)[:5]}"
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
    
    # Save to database
    # Deduplication handled by DB constraints (ON CONFLICT DO NOTHING)
    db_count = 0
    if DB_AVAILABLE and DATABASE_URL:
        db_count = save_vehicles_to_db(vehicles)
    
    db_msg = f", {db_count} to DB" if db_count else ""
    
    # Detect arrivals and generate ground truth for ML
    if vehicles:
        process_arrivals(vehicles)

    # Detect bus bunching
    if vehicles and _bunch_detector is not None and DB_AVAILABLE and DATABASE_URL:
        bunch_events = _bunch_detector.detect_bunching(vehicles)
        if bunch_events:
            saved = save_bunching_events(bunch_events)
            stats['bunching_events'] += saved
            logger.info(f"Bunching: {saved} events ({', '.join(sorted(set(e.rt for e in bunch_events)))})")

    logger.info(f"Vehicles: {len(vehicles)} total, {delayed_count} delayed, {len(active_routes)} routes → {filename.name}{db_msg}")
    
    return data


def collect_predictions(vehicle_ids: list) -> dict:
    """Collect predictions for all vehicles in batches."""
    timestamp = datetime.now(timezone.utc).isoformat()
    all_predictions = []
    
    # Batch vehicle IDs (API allows 10 per request)
    for i in range(0, len(vehicle_ids), 10):
        batch = vehicle_ids[i:i+10]
        preds = fetch_predictions_batch(batch)
        all_predictions.extend(preds)
        time.sleep(0.5)  # Small delay between batches
    
    data = {
        'timestamp': timestamp,
        'prediction_count': len(all_predictions),
        'vehicle_ids_queried': len(vehicle_ids),
        'predictions': all_predictions
    }
    
    filename = save_data(data, 'predictions')
    stats['predictions_collected'] += len(all_predictions)
    stats['last_prediction_fetch'] = timestamp
    
    # Save to database
    db_count = 0
    if DB_AVAILABLE and DATABASE_URL:
        db_count = save_predictions_to_db(all_predictions)
    
    db_msg = f", {db_count} to DB" if db_count else ""

    logger.info(f"Predictions: {len(all_predictions)} for {len(vehicle_ids)} vehicles → {filename.name}{db_msg}")
    
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
    logger.info(f"  GTFS-RT trip updates: {stats['gtfsrt_trip_updates']}")
    logger.info(f"  GTFS-RT vehicle positions: {stats['gtfsrt_vehicle_positions']}")
    logger.info(f"  Segments built: {stats['segments_built']}")
    logger.info(f"  Bunching events: {stats['bunching_events']}")
    logger.info(f"  API requests today: {stats['requests_today']}")
    logger.info(f"  Rate: {stats['requests_today']/max(hours,0.1):.1f} req/hour")
    logger.info("=" * 50)


class _HealthHandler(BaseHTTPRequestHandler):
    """Simple HTTP handler for health checks (used by Railway)."""

    def do_GET(self):
        if self.path == "/health" or self.path == "/":
            body = json.dumps({
                "status": "ok",
                "uptime_hours": round(
                    (time.time() - _health_start_time) / 3600, 2
                ) if _health_start_time else 0,
                "stats": {k: v for k, v in stats.items() if k != "started_at"},
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress default access logs

_health_start_time: float = 0


def _start_health_server():
    """Launch a lightweight HTTP health-check server in a daemon thread."""
    global _health_start_time
    _health_start_time = time.time()

    port = int(os.getenv("HEALTH_PORT", os.getenv("PORT", "8080")))
    try:
        server = HTTPServer(("0.0.0.0", port), _HealthHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        logger.info(f"Health check: ✓ listening on :{port}")
    except Exception as e:
        logger.warning(f"Health check server failed to start: {e}")


def _init_static_gtfs():
    """Load static GTFS schedule data on startup (if available and DB connected)."""
    if not GTFS_STATIC_AVAILABLE or not DB_AVAILABLE or not DATABASE_URL:
        logger.info("Static GTFS: Skipped (missing deps or no DB)")
        return

    try:
        result = load_static_gtfs(
            save_stops_fn=save_gtfs_stops,
            save_trips_fn=save_gtfs_trips,
            save_stop_times_fn=save_gtfs_stop_times,
            save_feed_info_fn=save_gtfs_feed_info,
        )
        if "error" in result:
            logger.warning(f"Static GTFS: {result['error']}")
        else:
            logger.info(
                f"Static GTFS: ✓ Loaded {result['stops']} stops, "
                f"{result['trips']} trips, {result['stop_times']} stop_times"
            )
    except Exception as e:
        logger.warning(f"Static GTFS: Failed to load: {e}")


def _collect_gtfsrt():
    """Single GTFS-RT collection cycle."""
    if not GTFSRT_AVAILABLE or not DB_AVAILABLE or not DATABASE_URL:
        return

    try:
        result = collect_gtfsrt(
            save_fn_trip_updates=save_gtfsrt_stop_times,
            save_fn_vehicle_positions=save_gtfsrt_vehicle_positions,
        )
        stats['gtfsrt_trip_updates'] += result.get('trip_update_records', 0)
        stats['gtfsrt_vehicle_positions'] += result.get('vehicle_position_records', 0)
        stats['last_gtfsrt_fetch'] = datetime.now(timezone.utc).isoformat()
    except Exception as e:
        logger.error(f"GTFS-RT collection error: {e}")


def _build_segments():
    """Run the segment travel time computation."""
    if not SEGMENT_BUILDER_AVAILABLE or not DB_AVAILABLE or not DATABASE_URL:
        return

    try:
        saved = build_segments(
            get_recent_stop_times_fn=get_unprocessed_gtfsrt_stop_times,
            get_scheduled_fn=get_scheduled_travel_time,
            save_segments_fn=save_segment_travel_times,
            since_minutes=10,
        )
        stats['segments_built'] += saved
        stats['last_segment_build'] = datetime.now(timezone.utc).isoformat()
    except Exception as e:
        logger.error(f"Segment build error: {e}")


def run_collector():
    """Main collection loop with optimized intervals."""
    _start_health_server()

    logger.info("=" * 60)
    logger.info("MADISON METRO DATA COLLECTOR")
    logger.info("=" * 60)
    logger.info(f"API Base: {API_BASE}")
    logger.info(f"Vehicle Interval: {VEHICLE_INTERVAL}s")
    logger.info(f"Prediction Interval: {PREDICTION_INTERVAL}s")
    logger.info(f"GTFS-RT Interval: {GTFSRT_INTERVAL}s")
    logger.info(f"Segment Build Interval: {SEGMENT_BUILD_INTERVAL}s")
    logger.info(f"GTFS-RT Available: {GTFSRT_AVAILABLE}")
    logger.info(f"Static GTFS Available: {GTFS_STATIC_AVAILABLE}")
    logger.info(f"Segment Builder Available: {SEGMENT_BUILDER_AVAILABLE}")
    
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
    
    # Run DB maintenance on startup (truncate unused tables, enforce retention, ensure indexes)
    if DB_MAINTENANCE_AVAILABLE and DATABASE_URL:
        try:
            from db_maintenance import emergency_truncate_gtfsrt
            emergency_truncate_gtfsrt()
        except Exception as e:
            logger.warning(f"Emergency truncation failed (non-critical): {e}")
        try:
            run_full_maintenance()
        except Exception as e:
            logger.warning(f"DB maintenance failed (non-critical): {e}")

    if not API_KEY:
        logger.error("MADISON_METRO_API_KEY not set! Exiting.")
        return

    # Load static GTFS schedule data (one-time at startup)
    _init_static_gtfs()
    
    # Initialize Arrival Detector using stops from static GTFS DB table
    # (avoids burning REST API quota on startup — gtfs_stops loaded above)
    global arrival_detector
    if ARRIVAL_DETECTOR_AVAILABLE and DB_AVAILABLE and DATABASE_URL:
        try:
            from sqlalchemy import create_engine, text as sa_text
            engine = create_engine(DATABASE_URL, pool_pre_ping=True)
            with engine.connect() as conn:
                rows = conn.execute(sa_text(
                    "SELECT stop_id, stop_name, stop_lat, stop_lon FROM gtfs_stops"
                )).fetchall()
            stops = [
                StopLocation(stpid=r[0], stpnm=r[1], lat=r[2], lon=r[3])
                for r in rows if r[2] and r[3]
            ]
            if stops:
                arrival_detector = ArrivalDetector(stops)
                logger.info(f"Arrival Detector: ✓ Initialized with {len(stops)} stops from gtfs_stops")
            else:
                logger.warning("Arrival Detector: gtfs_stops table empty, detector disabled")
        except Exception as e:
            logger.warning(f"Arrival Detector: Failed to initialize from DB: {e}")
    else:
        logger.info("Arrival Detector: Disabled (missing dependencies)")

    # Initialize Bunch Detector
    global _bunch_detector
    if BUNCH_DETECTOR_AVAILABLE:
        _bunch_detector = BunchDetector()
        logger.info("Bunch Detector: initialized")

    logger.info("Starting collection loop...")
    stats['started_at'] = datetime.now(timezone.utc).isoformat()
    
    last_vehicle_time = 0
    last_prediction_time = 0
    last_gtfsrt_time = 0
    last_segment_time = 0
    last_stats_time = 0
    last_gtfs_refresh_time = time.time()
    active_routes = []
    vehicle_data = {}

    # Track consecutive errors for exponential backoff
    consecutive_errors = 0
    
    while True:
        try:
            current_time = time.time()

            # Collect GTFS-RT feeds (every 120s — upsert-only, no row accumulation)
            if current_time - last_gtfsrt_time >= GTFSRT_INTERVAL:
                _collect_gtfsrt()
                last_gtfsrt_time = current_time

            # Collect REST API vehicles on interval
            if current_time - last_vehicle_time >= VEHICLE_INTERVAL:
                vehicle_data = collect_vehicles()
                active_routes = vehicle_data.get('active_routes', active_routes)
                last_vehicle_time = current_time
            
            # Collect REST API predictions on interval
            if current_time - last_prediction_time >= PREDICTION_INTERVAL:
                active_vehicles = [str(v.get('vid', '')) for v in vehicle_data.get('vehicles', []) if v.get('vid')]
                if active_vehicles:
                    collect_predictions(active_vehicles)
                last_prediction_time = current_time
            
            # Build segment travel times (every 5 min)
            if current_time - last_segment_time >= SEGMENT_BUILD_INTERVAL:
                _build_segments()
                last_segment_time = current_time

            # Daily tasks: refresh static GTFS + run DB maintenance (86400s = 1 day)
            if current_time - last_gtfs_refresh_time >= 86400:
                _init_static_gtfs()
                if DB_MAINTENANCE_AVAILABLE and DATABASE_URL:
                    try:
                        run_full_maintenance()
                    except Exception as e:
                        logger.warning(f"Weekly maintenance failed: {e}")
                last_gtfs_refresh_time = current_time
            
            # Log stats every hour
            if current_time - last_stats_time >= 3600:
                log_stats()
                last_stats_time = current_time
            
            # Reset error counter on successful loop iteration
            consecutive_errors = 0
            time.sleep(1)
            
        except KeyboardInterrupt:
            logger.info("Shutting down...")
            log_stats()
            break
        except Exception as e:
            consecutive_errors += 1
            backoff = min(30 * (2 ** (consecutive_errors - 1)), 300)
            logger.error(f"Collection error (attempt {consecutive_errors}, backoff {backoff}s): {e}")
            time.sleep(backoff)


if __name__ == '__main__':
    run_collector()
