#!/usr/bin/env python3
"""
Optimal Madison Metro Data Collector
Smart, simple collection focused on data quality and API efficiency
"""

import requests
import json
import csv
import time
import os
from datetime import datetime, timedelta
import logging
import random
from collections import defaultdict
from typing import Dict, List, Optional, Set
from dotenv import load_dotenv
import sys
from pathlib import Path

# Add utils to path
sys.path.append(str(Path(__file__).parent))
try:
    from utils.weather_tracker import WeatherTracker
    WEATHER_AVAILABLE = True
except ImportError as e:
    print(f"Weather tracking not available: {e}")
    WEATHER_AVAILABLE = False

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('optimal_collection.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Now we can use logger in imports
try:
    from utils.gtfs_rt_alerts import GTFSRTAlerts
    GTFS_ALERTS_AVAILABLE = True
    logger.info("GTFS-RT Alerts module loaded")
except ImportError as e:
    logger.warning(f"GTFS-RT Alerts not available: {e}")
    GTFS_ALERTS_AVAILABLE = False

class OptimalBusDataCollector:
    def __init__(self):
        self.api_key = os.getenv('MADISON_METRO_API_KEY')
        if not self.api_key:
            raise ValueError("MADISON_METRO_API_KEY environment variable is required")
        self.local_api = "http://localhost:5000"
        
        # Create data directory
        self.data_dir = "collected_data"
        os.makedirs(self.data_dir, exist_ok=True)
        self.stop_cache_path = Path(__file__).parent / 'ml' / 'data' / 'stop_cache.json'
        self.status_file = Path(__file__).parent / 'collector_status.json'
        
        # Stop collection configuration
        self.prediction_batch_size = 10
        self.stop_collection_call_budget = {
            'morning_rush': 6,
            'business_hours': 4,
            'evening_rush': 6,
            'evening': 3,
            'night': 2
        }
        self.min_stops_per_route = 3
        self.stop_cache_ttl = 6 * 3600  # Refresh every 6 hours
        self.stop_cache: Dict[str, Dict] = {}
        self.route_to_stops: Dict[str, List[str]] = {}
        self.route_stop_cursor: Dict[str, int] = {}
        self.rotation_list: List[str] = []
        self.rotation_cursor = 0
        self.stop_cache_loaded_at = 0
        self.sampled_stop_ids: Set[str] = set()
        
        # API call tracking
        self.daily_api_calls = 0
        self.max_daily_calls = 9500  # Leave 500 buffer
        self.reset_time = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Route priorities based on actual Madison Metro hierarchy
        self.rapid_routes = ['A', 'B', 'C', 'D', 'E', 'F']  # Bus Rapid Transit (every 15-30 min)
        self.uw_campus_routes = ['80', '81', '82', '84']  # UW campus routes (most important for students!)
        self.major_local_routes = ['28', '38']  # High-frequency local routes
        self.other_local_routes = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'L', 'O', 'P', 'R', 'S', 'W']  # Other local routes
        self.peak_only_routes = ['55', '65', '75']  # Peak-only routes (weekdays only)
        self.supplemental_routes = ['601', '602', '603', '604', '605', '611', '612', '613', '614', '615', '616', '617', '618', '621', '622', '623', '624', '625', '626', '627', '628', '629', '631', '632', '633', '635', '636', '637', '638', '641', '642']  # School day routes
        self.route_priority_map = self._build_route_priority_map()
        
        # Smart collection schedule based on actual route importance
        self.collection_schedule = {
            'morning_rush': {
                'hours': [7, 8],
                'interval': 1,  # Every 1 minute
                'routes': 'rapid_plus_uw_peak',  # Rapid + UW + peak routes
                'description': 'Morning rush - rapid + UW + peak routes every 1 minute'
            },
            'business_hours': {
                'hours': list(range(9, 17)),  # 9am-4pm
                'interval': 2,  # Every 2 minutes
                'routes': 'all_active',  # All active routes (weekends need more coverage)
                'description': 'Business hours - all active routes every 2 minutes'
            },
            'evening_rush': {
                'hours': [17, 18, 19],
                'interval': 1,  # Every 1 minute
                'routes': 'rapid_plus_uw_peak',  # Rapid + UW + peak routes
                'description': 'Evening rush - rapid + UW + peak routes every 1 minute'
            },
            'evening': {
                'hours': [20, 21, 22],
                'interval': 3,  # Every 3 minutes
                'routes': 'uw_campus',  # Just UW campus routes
                'description': 'Evening - UW campus routes every 3 minutes'
            },
            'night': {
                'hours': [23, 0, 1, 2, 3, 4, 5, 6],
                'interval': 10,  # Every 10 minutes
                'routes': 'uw_campus',  # Just UW campus routes (most important!)
                'description': 'Night - UW campus routes every 10 minutes'
            }
        }
        
        # Stats tracking
        self.stats = {
            'start_time': time.time(),
            'api_calls_made': 0,
            'vehicle_records_collected': 0,
            'prediction_records_collected': 0,
            'files_created': 0,
            'errors': 0,
            'last_vehicle_count': 0,
            'last_prediction_count': 0,
            'collection_cycles': 0,
            'unique_stops_sampled': 0
        }
        
        # Cache for major stops
        self.major_stops = None
        self.last_stop_refresh = 0
        
        # Initialize weather tracker
        self.weather_tracker = WeatherTracker() if WEATHER_AVAILABLE else None
        
        # Initialize GTFS-RT Alerts (official source for detours, events, construction!)
        if GTFS_ALERTS_AVAILABLE:
            try:
                self.gtfs_alerts = GTFSRTAlerts()
                self.alerts_cache = {}
                self._refresh_alerts_cache()
                logger.info("GTFS-RT Alerts loaded - using official service alerts feed")
            except Exception as e:
                logger.warning(f"Failed to initialize GTFS-RT Alerts: {e}")
                self.gtfs_alerts = None
                self.alerts_cache = {}
        else:
            self.gtfs_alerts = None
            self.alerts_cache = {}
        
    def reset_daily_counters(self):
        """Reset daily API call counters at midnight"""
        now = datetime.now()
        if now >= self.reset_time + timedelta(days=1):
            self.daily_api_calls = 0
            self.reset_time = now.replace(hour=0, minute=0, second=0, microsecond=0)
            logger.info("Daily API call counter reset")
    
    def can_make_api_call(self) -> bool:
        """Check if we can make an API call without exceeding daily limit"""
        self.reset_daily_counters()
        return self.daily_api_calls < self.max_daily_calls
    
    def api_get(self, endpoint: str, **params) -> Optional[Dict]:
        """Make API request with daily limit checking"""
        if not self.can_make_api_call():
            logger.warning(f"Daily API limit reached ({self.daily_api_calls}/{self.max_daily_calls})")
            return None
            
        try:
            url = f"{self.local_api}/{endpoint}"
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            self.daily_api_calls += 1
            self.stats['api_calls_made'] += 1
            
            return response.json()
        except Exception as e:
            logger.error(f"API request failed for {endpoint}: {e}")
            self.stats['errors'] += 1
            return None
    
    def get_current_schedule(self) -> Dict:
        """Get the current collection schedule based on time"""
        current_hour = datetime.now().hour
        
        for schedule_name, config in self.collection_schedule.items():
            if current_hour in config['hours']:
                schedule_config = dict(config)
                schedule_config['name'] = schedule_name
                return schedule_config
        
        # Default to night schedule if not found
        default_schedule = dict(self.collection_schedule['night'])
        default_schedule['name'] = 'night'
        return default_schedule
    
    def get_active_routes(self, route_list: List[str]) -> List[str]:
        """Get only the routes that are currently active (have vehicles)"""
        active_routes = []
        for route in route_list:
            try:
                data = self.api_get('vehicles', rt=route)
                if data and 'bustime-response' in data:
                    vehicles = data['bustime-response'].get('vehicle', [])
                    if len(vehicles) > 0:
                        active_routes.append(route)
            except:
                continue
        return active_routes
    
    def get_routes_to_collect(self, route_type: str) -> List[str]:
        """Get routes to collect based on schedule"""
        if route_type == 'rapid':
            return self.get_active_routes(self.rapid_routes)
        elif route_type == 'rapid_plus_uw':
            active_rapid = self.get_active_routes(self.rapid_routes)
            active_uw = self.get_active_routes(self.uw_campus_routes)
            return list(set(active_rapid + active_uw))  # Remove duplicates
        elif route_type == 'rapid_plus_uw_peak':
            active_rapid = self.get_active_routes(self.rapid_routes)
            active_uw = self.get_active_routes(self.uw_campus_routes)
            active_peak = self.get_active_routes(self.peak_only_routes)
            return list(set(active_rapid + active_uw + active_peak))  # Remove duplicates
        elif route_type == 'uw_campus':
            return self.get_active_routes(self.uw_campus_routes)
        elif route_type == 'uw_plus_major':
            active_uw = self.get_active_routes(self.uw_campus_routes)
            active_major = self.get_active_routes(self.major_local_routes)
            return list(set(active_uw + active_major))  # Remove duplicates
        elif route_type == 'critical':  # Legacy support
            active_uw = self.get_active_routes(self.uw_campus_routes)
            active_major = self.get_active_routes(self.major_local_routes)
            return list(set(active_uw + active_major))  # Remove duplicates
        elif route_type == 'major':  # Legacy support
            return self.get_active_routes(self.major_local_routes)
        elif route_type == 'all' or route_type == 'all_active':
            active_rapid = self.get_active_routes(self.rapid_routes)
            active_uw = self.get_active_routes(self.uw_campus_routes)
            active_major = self.get_active_routes(self.major_local_routes)
            active_other = self.get_active_routes(self.other_local_routes)
            active_peak = self.get_active_routes(self.peak_only_routes)
            active_supplemental = self.get_active_routes(self.supplemental_routes)
            return list(set(active_rapid + active_uw + active_major + active_other + active_peak + active_supplemental))  # Remove duplicates
        else:
            return self.get_active_routes(self.rapid_routes)
    
    def collect_vehicle_data(self, routes: List[str]) -> List[Dict]:
        """Collect vehicle data for specified routes"""
        all_vehicles = []
        
        for route in routes:
            if not self.can_make_api_call():
                break
                
            try:
                data = self.api_get('vehicles', rt=route)
                if data and 'bustime-response' in data:
                    vehicles = data['bustime-response'].get('vehicle', [])
                    for vehicle in vehicles:
                        vehicle['collection_timestamp'] = datetime.now().isoformat()
                        # Enrich with weather and event data
                        self._enrich_record(vehicle, vehicle.get('rt', ''))
                        all_vehicles.append(vehicle)
            except Exception as e:
                logger.error(f"Error collecting vehicles for route {route}: {e}")
                self.stats['errors'] += 1
        
        self.stats['vehicle_records_collected'] += len(all_vehicles)
        self.stats['last_vehicle_count'] = len(all_vehicles)
        return all_vehicles
    
    def collect_prediction_data(self, routes: List[str], schedule: Optional[Dict] = None) -> List[Dict]:
        """Collect prediction data with full-stop rotation coverage."""
        if schedule is None:
            schedule = self.get_current_schedule()
        
        self._ensure_stop_cache()
        
        stop_plan: List[str] = []
        if self.route_to_stops:
            stop_plan = self._plan_stop_collection(routes, schedule)
        
        if not stop_plan:
            if not self.major_stops:
                self.major_stops = self.get_major_stops()
            stop_plan = self.major_stops[:25]
        
        return self._collect_predictions_from_stop_ids(stop_plan)

    def _collect_predictions_from_stop_ids(self, stop_ids: List[str]) -> List[Dict]:
        """Batch prediction API calls for the provided stop IDs."""
        if not stop_ids:
            return []
        
        sanitized: List[str] = []
        seen: Set[str] = set()
        for stop in stop_ids:
            sid = str(stop).strip()
            if not sid or sid in seen:
                continue
            sanitized.append(sid)
            seen.add(sid)
        
        all_predictions: List[Dict] = []
        for i in range(0, len(sanitized), self.prediction_batch_size):
            if not self.can_make_api_call():
                logger.warning("API limit reached while collecting prediction data.")
                break
            
            batch = sanitized[i:i + self.prediction_batch_size]
            stop_param = ','.join(batch)
            
            try:
                data = self.api_get('predictions', stpid=stop_param)
                if data and 'bustime-response' in data:
                    predictions = data['bustime-response'].get('prd', [])
                    if isinstance(predictions, dict):
                        predictions = [predictions]
                    for pred in predictions:
                        pred['collection_timestamp'] = datetime.now().isoformat()
                        self._enrich_record(pred, pred.get('rt', ''))
                        all_predictions.append(pred)
            except Exception as e:
                logger.error(f"Error collecting predictions for stops {stop_param}: {e}")
                self.stats['errors'] += 1
        
        self.stats['prediction_records_collected'] += len(all_predictions)
        self.stats['last_prediction_count'] = len(all_predictions)
        self.sampled_stop_ids.update(sanitized)
        self.stats['unique_stops_sampled'] = len(self.sampled_stop_ids)
        return all_predictions
    
    def get_major_stops(self) -> List[str]:
        """Get list of major stops (cached)"""
        if self.major_stops is None or time.time() - self.last_stop_refresh > 3600:
            # Refresh every hour
            try:
                # Use known major stops for efficiency
                self.major_stops = [
                    '10086', '1290', '0300', '9870', '2620', '9285', '1787', '10122', '2775', '1391',
                    '4539', '7328', '6642', '4377', '7296', '6318', '2125', '9591', '4139', '9235',
                    '9873', '2951', '9214', '4967', '1380', '6706', '9582', '1216', '6894', '7838',
                    '4147', '1905', '4783', '9356', '2725', '6306', '0286', '6650', '9579', '10094'
                ]
                self.last_stop_refresh = time.time()
            except Exception as e:
                logger.error(f"Error getting major stops: {e}")
                # Fallback to known major stops
                self.major_stops = ['10086', '1290', '0300', '9870', '2620', '9285', '1787', '10122', '2775', '1391']
        
        return self.major_stops

    def _build_route_priority_map(self) -> Dict[str, int]:
        """Assign priority buckets to routes for sampling fairness."""
        priority_map: Dict[str, int] = {}
        def assign(routes: List[str], priority: int):
            for route in routes:
                priority_map.setdefault(route, priority)
        assign(self.uw_campus_routes, 0)
        assign(self.rapid_routes, 1)
        assign(self.major_local_routes, 2)
        assign(self.other_local_routes, 3)
        assign(self.peak_only_routes, 3)
        assign(self.supplemental_routes, 4)
        return priority_map

    def _ensure_stop_cache(self, force: bool = False):
        """Load stop cache from disk or rebuild from API if needed."""
        cache_age = time.time() - self.stop_cache_loaded_at
        if self.route_to_stops and not force and cache_age < self.stop_cache_ttl:
            return
        
        cache_data = self._load_stop_cache_from_disk()
        if not cache_data or force:
            cache_data = self._build_stop_cache_from_api()
        
        if cache_data:
            self._initialize_stop_structures(cache_data)
        else:
            logger.warning("Unable to load full stop cache; falling back to limited major stop sample.")

    def _load_stop_cache_from_disk(self) -> Optional[Dict]:
        """Load previously built stop cache from disk."""
        try:
            if self.stop_cache_path.exists():
                with open(self.stop_cache_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if data.get('stops'):
                        return data
        except Exception as e:
            logger.warning(f"Failed to load stop cache from disk: {e}")
        return None

    def _build_stop_cache_from_api(self) -> Optional[Dict]:
        """Build stop cache by sweeping all routes, directions, and stops."""
        try:
            logger.info("Building stop cache from Madison Metro API (full system sweep)...")
            routes_resp = self.api_get('routes')
            routes = routes_resp.get('bustime-response', {}).get('routes', []) if routes_resp else []
            if not isinstance(routes, list):
                routes = [routes] if routes else []
            
            stops_cache: Dict[str, Dict] = {}
            for route in routes:
                rt = str(route.get('rt', '')).strip()
                if not rt:
                    continue
                
                directions_resp = self.api_get('directions', rt=rt)
                directions = directions_resp.get('bustime-response', {}).get('directions', []) if directions_resp else []
                if not isinstance(directions, list):
                    directions = [directions] if directions else []
                
                for direction in directions:
                    dir_val = direction.get('dir') or direction.get('name') or direction.get('id')
                    if not dir_val:
                        continue
                    
                    stops_resp = self.api_get('stops', rt=rt, dir=dir_val)
                    stops = stops_resp.get('bustime-response', {}).get('stops', []) if stops_resp else []
                    if not isinstance(stops, list):
                        stops = [stops] if stops else []
                    
                    for stop in stops:
                        stpid = str(stop.get('stpid') or '').strip()
                        lat = stop.get('lat')
                        lon = stop.get('lon')
                        if not stpid or lat is None or lon is None:
                            continue
                        
                        entry = stops_cache.get(stpid) or {
                            'stpnm': stop.get('stpnm', ''),
                            'lat': float(lat),
                            'lon': float(lon),
                            'routes': []
                        }
                        if rt not in entry['routes']:
                            entry['routes'].append(rt)
                        stops_cache[stpid] = entry
            
            if not stops_cache:
                logger.warning("Stop cache build returned no stops.")
                return None
            
            self.stop_cache_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.stop_cache_path, 'w', encoding='utf-8') as f:
                json.dump({'stops': stops_cache, 'count': len(stops_cache)}, f)
            
            logger.info(f"Stop cache built with {len(stops_cache)} stops.")
            return {'stops': stops_cache, 'count': len(stops_cache)}
        except Exception as e:
            logger.error(f"Failed to build stop cache from API: {e}")
            return None

    def _initialize_stop_structures(self, cache_data: Dict):
        """Convert raw cache dict into in-memory structures for sampling."""
        stops_dict = cache_data.get('stops') or {}
        if not stops_dict:
            return
        
        self.stop_cache = stops_dict
        self.stop_cache_loaded_at = time.time()
        
        route_map: Dict[str, Set[str]] = defaultdict(set)
        for stpid, stop_info in stops_dict.items():
            for route in stop_info.get('routes', []):
                route_map[route].add(stpid)
        
        self.route_to_stops = {}
        self.route_stop_cursor = {}
        for route, stop_ids in route_map.items():
            ordered = list(stop_ids)
            random.shuffle(ordered)
            self.route_to_stops[route] = ordered
            self.route_stop_cursor[route] = 0
        
        self.rotation_list = list(stops_dict.keys())
        random.shuffle(self.rotation_list)
        self.rotation_cursor = 0
        
        logger.info(f"Loaded stop cache with {len(self.rotation_list)} stops across {len(self.route_to_stops)} routes.")

    def _route_priority(self, route: str) -> int:
        return self.route_priority_map.get(route, 5)

    def _route_priority_sort_key(self, route: str):
        return (self._route_priority(route), route)

    def _get_stop_collection_limit(self, schedule: Optional[Dict]) -> int:
        if not schedule:
            schedule = {'name': 'business_hours'}
        remaining_calls = max(0, self.max_daily_calls - self.daily_api_calls)
        if remaining_calls <= 0:
            return 0
        budget_calls = self.stop_collection_call_budget.get(
            schedule.get('name', 'business_hours'),
            self.stop_collection_call_budget.get('business_hours', 4)
        )
        budget_calls = max(1, min(budget_calls, remaining_calls))
        return budget_calls * self.prediction_batch_size

    def _plan_stop_collection(self, routes: List[str], schedule: Optional[Dict]) -> List[str]:
        limit = self._get_stop_collection_limit(schedule)
        if limit <= 0:
            return []
        
        unique_routes: List[str] = []
        for route in routes:
            if route and route not in unique_routes and route in self.route_to_stops:
                unique_routes.append(route)
        
        stop_plan: List[str] = []
        seen: Set[str] = set()
        
        if unique_routes:
            unique_routes.sort(key=self._route_priority_sort_key)
            per_route = max(self.min_stops_per_route, limit // max(1, len(unique_routes)))
            for route in unique_routes:
                stops = self.route_to_stops.get(route, [])
                if not stops:
                    continue
                cursor = self.route_stop_cursor.get(route, 0)
                assigned = 0
                attempts = 0
                max_attempts = len(stops) * 2 if stops else 0
                while assigned < per_route and len(stop_plan) < limit and attempts < max_attempts:
                    stop_id = stops[cursor % len(stops)]
                    cursor = (cursor + 1) % len(stops)
                    attempts += 1
                    if stop_id in seen:
                        continue
                    stop_plan.append(stop_id)
                    seen.add(stop_id)
                    assigned += 1
                self.route_stop_cursor[route] = cursor
                if len(stop_plan) >= limit:
                    break
        
        if len(stop_plan) < limit:
            self._fill_stop_rotation(stop_plan, limit, seen)
        
        return stop_plan

    def _fill_stop_rotation(self, stop_plan: List[str], limit: int, seen: Set[str]):
        if not self.rotation_list:
            return
        attempts = 0
        max_attempts = len(self.rotation_list) * 2
        while len(stop_plan) < limit and attempts < max_attempts:
            next_stop = self._get_next_rotation_stop()
            attempts += 1
            if not next_stop or next_stop in seen:
                continue
            stop_plan.append(next_stop)
            seen.add(next_stop)

    def _get_next_rotation_stop(self) -> Optional[str]:
        if not self.rotation_list:
            return None
        stop_id = self.rotation_list[self.rotation_cursor]
        self.rotation_cursor += 1
        if self.rotation_cursor >= len(self.rotation_list):
            self.rotation_cursor = 0
            random.shuffle(self.rotation_list)
        return stop_id
    
    def _refresh_alerts_cache(self):
        """Refresh GTFS-RT alerts cache (called periodically)"""
        if not self.gtfs_alerts:
            return
        
        try:
            # Fetch all active alerts
            alerts = self.gtfs_alerts.get_active_alerts()
            
            # Cache alerts by route
            for route in ['80', '81', '82', '84', 'A', 'B', 'C', 'D', 'E', 'F', '2', '6', '11', '28', '38']:
                route_alerts = self.gtfs_alerts.get_alerts_for_route(route)
                alert_types = self.gtfs_alerts.get_route_alert_types(route)
                
                self.alerts_cache[route] = {
                    'has_alert': 1 if len(route_alerts) > 0 else 0,
                    'alert_count': len(route_alerts),
                    'has_detour': 1 if alert_types.get('has_detour') else 0,
                    'has_event': 1 if alert_types.get('has_event') else 0,
                    'has_weather': 1 if alert_types.get('has_weather') else 0,
                    'has_construction': 1 if alert_types.get('has_construction') else 0,
                    'alerts': route_alerts[:3]  # Store top 3
                }
        except Exception as e:
            logger.debug(f"Error refreshing alerts cache: {e}")
    
    def _enrich_record(self, record: Dict, route: str):
        """Enrich a data record with weather, event, and construction information"""
        try:
            # Get timestamp
            timestamp_str = record.get('tmstmp') or record.get('collection_timestamp')
            if timestamp_str:
                try:
                    timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                except:
                    timestamp = datetime.now()
            else:
                timestamp = datetime.now()
            
            # Add weather data
            if self.weather_tracker:
                weather_features = self.weather_tracker.get_weather_features(timestamp)
                record['weather_temp'] = weather_features.get('temperature')
                record['weather_precipitation'] = weather_features.get('precipitation')
                record['weather_wind_speed'] = weather_features.get('wind_speed')
                record['weather_is_rainy'] = weather_features.get('is_rainy')
                record['weather_is_snowy'] = weather_features.get('is_snowy')
                record['weather_is_extreme'] = weather_features.get('is_extreme_weather')
                record['weather_condition'] = weather_features.get('weather_condition', 'unknown')
            
            # Add GTFS-RT Alerts data (official source for detours, events, construction!)
            if self.gtfs_alerts and route:
                # Refresh cache every 5 minutes (alerts change frequently)
                if not hasattr(self, '_last_alerts_refresh') or \
                   (datetime.now() - self._last_alerts_refresh).seconds > 300:
                    self._refresh_alerts_cache()
                    self._last_alerts_refresh = datetime.now()
                
                route_alerts = self.alerts_cache.get(route, {})
                record['has_alert'] = route_alerts.get('has_alert', 0)
                record['alert_count'] = route_alerts.get('alert_count', 0)
                record['has_detour'] = route_alerts.get('has_detour', 0)
                record['has_event'] = route_alerts.get('has_event', 0)
                record['has_weather_alert'] = route_alerts.get('has_weather', 0)
                record['has_construction_alert'] = route_alerts.get('has_construction', 0)
                
                # Legacy fields for compatibility
                record['is_event_day'] = route_alerts.get('has_event', 0)
                record['has_construction'] = route_alerts.get('has_construction', 0)
            else:
                record['has_alert'] = 0
                record['alert_count'] = 0
                record['has_detour'] = 0
                record['has_event'] = 0
                record['has_weather_alert'] = 0
                record['has_construction_alert'] = 0
                record['is_event_day'] = 0
                record['has_construction'] = 0
        except Exception as e:
            logger.debug(f"Error enriching record: {e}")
            # Don't fail collection if enrichment fails

    def _write_status_file(self, schedule: Dict, routes: List[str]):
        """Persist collector status for frontend dashboards."""
        try:
            uptime_seconds = max(0, time.time() - self.stats['start_time'])
            api_usage_pct = (self.daily_api_calls / self.max_daily_calls * 100) if self.max_daily_calls else 0
            status_payload = {
                "collector_running": True,
                "last_updated": datetime.now().isoformat(),
                "current_schedule": {
                    "name": schedule.get('name'),
                    "description": schedule.get('description'),
                    "interval_minutes": schedule.get('interval'),
                    "routes_strategy": schedule.get('routes')
                },
                "recent_cycle": {
                    "active_routes_sampled": routes,
                    "last_vehicle_count": self.stats.get('last_vehicle_count', 0),
                    "last_prediction_count": self.stats.get('last_prediction_count', 0)
                },
                "stats": {
                    "unique_stops_sampled": self.stats.get('unique_stops_sampled', 0),
                    "vehicle_records_collected": self.stats.get('vehicle_records_collected', 0),
                    "prediction_records_collected": self.stats.get('prediction_records_collected', 0),
                    "collection_cycles": self.stats.get('collection_cycles', 0),
                    "uptime_seconds": int(uptime_seconds),
                    "stop_cache_size": len(self.rotation_list),
                    "active_routes_tracked": len(self.route_to_stops)
                },
                "api_usage": {
                    "daily_calls": self.daily_api_calls,
                    "max_daily_calls": self.max_daily_calls,
                    "usage_percent": round(api_usage_pct, 2)
                },
                "enrichment": {
                    "weather_available": bool(self.weather_tracker),
                    "gtfs_alerts_enabled": bool(self.gtfs_alerts)
                }
            }
            temp_path = self.status_file.with_suffix('.tmp')
            with open(temp_path, 'w', encoding='utf-8') as f:
                json.dump(status_payload, f, indent=2)
            temp_path.replace(self.status_file)
        except Exception as exc:
            logger.debug(f"Failed to write collector status file: {exc}")
    
    def save_data(self, vehicles: List[Dict], predictions: List[Dict]):
        """Save collected data to CSV files"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save vehicle data
        if vehicles:
            vehicle_file = f"{self.data_dir}/vehicles_{timestamp}.csv"
            with open(vehicle_file, 'w', newline='', encoding='utf-8') as f:
                if vehicles:
                    writer = csv.DictWriter(f, fieldnames=vehicles[0].keys())
                    writer.writeheader()
                    writer.writerows(vehicles)
            logger.info(f"Saved {len(vehicles)} vehicle records to {vehicle_file}")
            self.stats['files_created'] += 1
        
        # Save prediction data
        if predictions:
            prediction_file = f"{self.data_dir}/predictions_{timestamp}.csv"
            with open(prediction_file, 'w', newline='', encoding='utf-8') as f:
                if predictions:
                    writer = csv.DictWriter(f, fieldnames=predictions[0].keys())
                    writer.writeheader()
                    writer.writerows(predictions)
            logger.info(f"Saved {len(predictions)} prediction records to {prediction_file}")
            self.stats['files_created'] += 1
    
    def print_daily_summary(self):
        """Print daily collection summary"""
        current_time = time.time()
        runtime = current_time - self.stats['start_time']
        runtime_hours = runtime / 3600
        
        api_calls_per_hour = (self.stats['api_calls_made'] / runtime_hours) if runtime_hours > 0 else 0
        remaining_calls = self.max_daily_calls - self.daily_api_calls
        
        current_schedule = self.get_current_schedule()
        
        print(f"\nOPTIMAL COLLECTION SUMMARY")
        print(f"{'='*50}")
        print(f"Runtime: {runtime_hours:.1f} hours")
        print(f"Current Schedule: {current_schedule['description']}")
        print(f"API Calls: {self.daily_api_calls:,}/{self.max_daily_calls:,} ({self.daily_api_calls/self.max_daily_calls*100:.1f}%)")
        print(f"Rate: {api_calls_per_hour:.1f} calls/hour")
        print(f"Remaining: {remaining_calls:,} calls")
        print(f"Vehicle Records: {self.stats['vehicle_records_collected']:,}")
        print(f"Prediction Records: {self.stats['prediction_records_collected']:,}")
        print(f"Unique Stops Sampled: {self.stats.get('unique_stops_sampled', 0):,}")
        print(f"Files Created: {self.stats['files_created']}")
        print(f"Collection Cycles: {self.stats['collection_cycles']}")
        print(f"Errors: {self.stats['errors']}")
        print(f"{'='*50}")
    
    def collection_cycle(self):
        """Run one collection cycle"""
        if not self.can_make_api_call():
            logger.warning("Skipping collection cycle - daily API limit reached")
            return
        
        # Get current schedule
        current_schedule = self.get_current_schedule()
        routes = self.get_routes_to_collect(current_schedule['routes'])
        
        logger.info(f"Running collection cycle: {current_schedule['description']}")
        
        # Collect vehicle data
        vehicles = self.collect_vehicle_data(routes)
        
        # Collect prediction data (always collect for ML training)
        predictions = self.collect_prediction_data(routes, current_schedule)
        
        # Save data
        self.save_data(vehicles, predictions)
        
        # Update stats
        self.stats['collection_cycles'] += 1
        self._write_status_file(current_schedule, routes)
        
        # Print summary every 20 cycles
        if self.stats['collection_cycles'] % 20 == 0:
            self.print_daily_summary()
    
    def run(self):
        """Run the optimal collector"""
        logger.info("Starting Optimal Madison Metro Data Collector")
        logger.info(f"Daily API limit: {self.max_daily_calls:,} calls")
        
        # Print schedule
        print(f"\nCOLLECTION SCHEDULE")
        print(f"{'='*50}")
        for schedule_name, config in self.collection_schedule.items():
            hours_str = ', '.join([str(h) for h in config['hours']])
            print(f"{schedule_name.replace('_', ' ').title()}: {hours_str} - {config['description']}")
        print(f"{'='*50}")
        
        try:
            while True:
                # Run collection cycle
                self.collection_cycle()
                
                # Wait based on current schedule
                current_schedule = self.get_current_schedule()
                wait_time = current_schedule['interval'] * 60  # Convert minutes to seconds
                
                logger.info(f"Waiting {current_schedule['interval']} minutes until next collection...")
                time.sleep(wait_time)
                
        except KeyboardInterrupt:
            logger.info("Data collection stopped by user")
            self.print_daily_summary()
        except Exception as e:
            logger.error(f"Data collection failed: {e}")
            self.print_daily_summary()

def main():
    """Run the optimal collector"""
    collector = OptimalBusDataCollector()
    collector.run()

if __name__ == "__main__":
    main()
