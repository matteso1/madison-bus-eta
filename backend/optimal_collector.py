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
from typing import Dict, List, Optional
from dotenv import load_dotenv

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

class OptimalBusDataCollector:
    def __init__(self):
        self.api_key = os.getenv('MADISON_METRO_API_KEY')
        if not self.api_key:
            raise ValueError("MADISON_METRO_API_KEY environment variable is required")
        self.local_api = "http://localhost:5000"
        
        # Create data directory
        self.data_dir = "collected_data"
        os.makedirs(self.data_dir, exist_ok=True)
        
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
            'collection_cycles': 0
        }
        
        # Cache for major stops
        self.major_stops = None
        self.last_stop_refresh = 0
        
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
                return config
        
        # Default to night schedule if not found
        return self.collection_schedule['night']
    
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
        elif route_type == 'all':
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
                        all_vehicles.append(vehicle)
            except Exception as e:
                logger.error(f"Error collecting vehicles for route {route}: {e}")
                self.stats['errors'] += 1
        
        self.stats['vehicle_records_collected'] += len(all_vehicles)
        self.stats['last_vehicle_count'] = len(all_vehicles)
        return all_vehicles
    
    def collect_prediction_data(self, routes: List[str]) -> List[Dict]:
        """Collect prediction data for major stops"""
        if not self.major_stops:
            self.major_stops = self.get_major_stops()
        
        all_predictions = []
        
        # Sample stops based on current schedule
        current_schedule = self.get_current_schedule()
        if current_schedule['routes'] == 'rapid':
            stop_sample = self.major_stops[:15]  # Fewer stops for rapid routes
        else:
            stop_sample = self.major_stops[:25]  # More stops for major routes
        
        # Batch stops for API efficiency
        batch_size = 10
        for i in range(0, len(stop_sample), batch_size):
            if not self.can_make_api_call():
                break
                
            batch = stop_sample[i:i+batch_size]
            stop_ids = ','.join([str(stop) for stop in batch])
            
            try:
                data = self.api_get('predictions', stpid=stop_ids)
                if data and 'bustime-response' in data:
                    predictions = data['bustime-response'].get('prd', [])
                    for pred in predictions:
                        pred['collection_timestamp'] = datetime.now().isoformat()
                        all_predictions.append(pred)
            except Exception as e:
                logger.error(f"Error collecting predictions for stops {stop_ids}: {e}")
                self.stats['errors'] += 1
        
        self.stats['prediction_records_collected'] += len(all_predictions)
        self.stats['last_prediction_count'] = len(all_predictions)
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
        
        # Collect prediction data (less frequently)
        predictions = []
        if current_schedule['routes'] in ['rapid', 'rapid_plus_uw', 'uw_campus', 'uw_plus_major', 'critical', 'major']:
            predictions = self.collect_prediction_data(routes)
        
        # Save data
        self.save_data(vehicles, predictions)
        
        # Update stats
        self.stats['collection_cycles'] += 1
        
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
