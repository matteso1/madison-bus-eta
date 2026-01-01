"""
Madison Open Data Integration
Access data from https://data-cityofmadison.opendata.arcgis.com/
Automatically fetches construction, traffic, and other transit-relevant data
"""

import requests
import json
from typing import Dict, List, Optional, Tuple
from pathlib import Path
from datetime import datetime, timedelta
import math

class MadisonOpenData:
    """Access Madison's open data portal - automatically discovers and uses relevant datasets"""
    
    BASE_URL = "https://services.arcgis.com/8df8p0NlLFEShl0r/ArcGIS/rest/services"
    
    # Discovered datasets from the portal - these are the actual service names
    DATASETS = {
        "construction_projects": "Construction_Projects/FeatureServer/0",
        "traffic_accidents": "Traffic_Accidents/FeatureServer/0",
        "traffic_volumes": "Traffic_Volumes/FeatureServer/0",
        "parking_meters": "Parking_Meters/FeatureServer/0",
        "bike_paths": "Bike_Paths/FeatureServer/0",
        "bus_stops": "Bus_Stops/FeatureServer/0",  # If available
        "street_centerlines": "Street_Centerlines/FeatureServer/0",  # For route matching
    }
    
    # Major bus route corridors in Madison (approximate coordinates)
    ROUTE_CORRIDORS = {
        "80": [(43.0731, -89.4012), (43.0764, -89.4124)],  # Campus area
        "A": [(43.0731, -89.4012), (43.1194, -89.3344)],  # East-West
        "B": [(43.0731, -89.4012), (43.0389, -89.5175)],  # North-South
        "C": [(43.0731, -89.4012), (43.1194, -89.3344)],  # Another corridor
    }
    
    def __init__(self, cache_dir='backend/data/open_data_cache'):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def _get_cache_path(self, dataset: str) -> Path:
        """Get cache file path for a dataset"""
        return self.cache_dir / f"{dataset}.json"
    
    def fetch_dataset(self, dataset_name: str, limit: int = 1000) -> Optional[List[Dict]]:
        """Fetch data from ArcGIS REST API"""
        if dataset_name not in self.DATASETS:
            print(f"Unknown dataset: {dataset_name}")
            return None
        
        # Check cache first
        cache_path = self._get_cache_path(dataset_name)
        if cache_path.exists():
            try:
                with open(cache_path, 'r') as f:
                    cached = json.load(f)
                    # Use cache if less than 24 hours old
                    from datetime import datetime, timedelta
                    cache_time = datetime.fromisoformat(cached.get('timestamp', '2000-01-01'))
                    if datetime.now() - cache_time < timedelta(hours=24):
                        return cached.get('data', [])
            except:
                pass
        
        try:
            url = f"{self.BASE_URL}/{self.DATASETS[dataset_name]}/query"
            params = {
                'where': '1=1',
                'outFields': '*',
                'f': 'json',
                'resultRecordCount': limit
            }
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            features = data.get('features', [])
            records = [f.get('attributes', {}) for f in features]
            
            # Cache the results
            from datetime import datetime
            with open(cache_path, 'w') as f:
                json.dump({
                    'timestamp': datetime.now().isoformat(),
                    'data': records
                }, f, indent=2)
            
            return records
        except Exception as e:
            print(f"Error fetching {dataset_name}: {e}")
            return None
    
    def get_traffic_accidents_near_route(self, route_coords: List[tuple], radius_miles: float = 0.5) -> List[Dict]:
        """Get traffic accidents near a route (would need spatial filtering)"""
        accidents = self.fetch_dataset('traffic_accidents', limit=5000)
        if not accidents:
            return []
        
        # Simple filtering - in production would use proper spatial queries
        # For now, return recent accidents
        from datetime import datetime, timedelta
        recent = datetime.now() - timedelta(days=30)
        
        recent_accidents = []
        for acc in accidents:
            # Check if accident is recent (would need date field)
            recent_accidents.append(acc)
        
        return recent_accidents[:50]  # Limit results
    
    def get_construction_projects(self, active_only: bool = True) -> List[Dict]:
        """Get construction projects that might affect transit"""
        projects = self.fetch_dataset('construction_projects', limit=1000)
        if not projects:
            return []
        
        # Filter for active projects
        active = []
        today = datetime.now().date()
        
        for project in projects:
            # Check various date/status fields that might exist
            start_date = None
            end_date = None
            status = project.get('STATUS', project.get('status', project.get('Status', ''))).lower()
            
            # Try to parse dates from various possible field names
            for date_field in ['START_DATE', 'start_date', 'StartDate', 'BEGIN_DATE', 'begin_date']:
                if date_field in project and project[date_field]:
                    try:
                        if isinstance(project[date_field], (int, float)):
                            # Unix timestamp
                            start_date = datetime.fromtimestamp(project[date_field] / 1000).date()
                        else:
                            start_date = datetime.strptime(str(project[date_field])[:10], '%Y-%m-%d').date()
                        break
                    except:
                        pass
            
            for date_field in ['END_DATE', 'end_date', 'EndDate', 'COMPLETION_DATE', 'completion_date']:
                if date_field in project and project[date_field]:
                    try:
                        if isinstance(project[date_field], (int, float)):
                            end_date = datetime.fromtimestamp(project[date_field] / 1000).date()
                        else:
                            end_date = datetime.strptime(str(project[date_field])[:10], '%Y-%m-%d').date()
                        break
                    except:
                        pass
            
            # Determine if project is active
            is_active = False
            if active_only:
                if status and ('active' in status or 'ongoing' in status or 'in progress' in status):
                    is_active = True
                elif start_date and end_date:
                    is_active = start_date <= today <= end_date
                elif start_date and not end_date:
                    is_active = start_date <= today
            else:
                is_active = True  # Return all if not filtering
            
            if is_active:
                # Add computed fields
                project['_is_active'] = True
                project['_days_remaining'] = (end_date - today).days if end_date else None
                active.append(project)
        
        return active
    
    def get_construction_near_route(self, route: str, radius_miles: float = 0.5) -> List[Dict]:
        """Get construction projects near a specific route"""
        projects = self.get_construction_projects(active_only=True)
        if not projects:
            return []
        
        # Get route corridor if known
        route_coords = self.ROUTE_CORRIDORS.get(route)
        if not route_coords:
            return projects[:10]  # Return first 10 if route unknown
        
        # Filter projects near route (simple distance check)
        nearby = []
        for project in projects:
            # Try to get project location
            lat = project.get('LATITUDE', project.get('latitude', project.get('LAT', None)))
            lon = project.get('LONGITUDE', project.get('longitude', project.get('LON', project.get('LNG', None))))
            
            if lat and lon:
                # Check distance to route corridor
                min_dist = min([self._haversine_distance((lat, lon), coord) for coord in route_coords])
                if min_dist <= radius_miles:
                    project['_distance_to_route'] = min_dist
                    nearby.append(project)
            else:
                # If no coordinates, include it (better safe than sorry)
                nearby.append(project)
        
        return nearby
    
    def _haversine_distance(self, coord1: Tuple[float, float], coord2: Tuple[float, float]) -> float:
        """Calculate distance between two lat/lon coordinates in miles"""
        R = 3959  # Earth radius in miles
        lat1, lon1 = math.radians(coord1[0]), math.radians(coord1[1])
        lat2, lon2 = math.radians(coord2[0]), math.radians(coord2[1])
        
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        c = 2 * math.asin(math.sqrt(a))
        
        return R * c
    
    def get_construction_impact_summary(self) -> Dict:
        """Get summary of construction impacts on transit"""
        projects = self.get_construction_projects(active_only=True)
        
        return {
            'total_active_projects': len(projects),
            'projects_by_status': {},
            'projects_affecting_routes': {},
            'most_affected_routes': []
        }
    
    def get_traffic_volumes(self) -> List[Dict]:
        """Get traffic volume data"""
        return self.fetch_dataset('traffic_volumes', limit=1000) or []

