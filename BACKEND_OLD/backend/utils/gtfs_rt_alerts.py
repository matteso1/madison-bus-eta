"""
GTFS-RT Alerts Integration
Fetches official service alerts from Madison Metro GTFS-RT feed
This replaces manual event/construction tracking with official data!
"""

import requests
from typing import Dict, List, Optional
from datetime import datetime
from pathlib import Path
import json

try:
    from google.transit import gtfs_realtime_pb2
    GTFS_RT_AVAILABLE = True
except ImportError:
    GTFS_RT_AVAILABLE = False
    import logging
    logger = logging.getLogger(__name__)
    logger.warning("⚠️  gtfs-realtime-bindings not installed. Install with: pip install gtfs-realtime-bindings")

class GTFSRTAlerts:
    """Fetch and parse GTFS-RT Alerts from Madison Metro"""
    
    ALERTS_URL = "https://metromap.cityofmadison.com/gtfsrt/alerts"
    
    def __init__(self, cache_file='backend/data/gtfs_alerts_cache.json'):
        self.cache_file = Path(cache_file)
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        self.last_fetch = None
        self.cached_alerts = []
    
    def fetch_alerts(self) -> List[Dict]:
        """Fetch current alerts from GTFS-RT feed"""
        if not GTFS_RT_AVAILABLE:
            return self._fetch_alerts_simple()
        
        try:
            response = requests.get(self.ALERTS_URL, timeout=10)
            response.raise_for_status()
            
            # Parse protobuf
            feed = gtfs_realtime_pb2.FeedMessage()
            feed.ParseFromString(response.content)
            
            alerts = []
            for entity in feed.entity:
                if entity.HasField('alert'):
                    alert = entity.alert
                    alert_data = {
                        'id': entity.id,
                        'header_text': self._get_text(alert.header_text),
                        'description_text': self._get_text(alert.description_text),
                        'url': self._get_text(alert.url) if alert.HasField('url') else None,
                        'effect': alert.effect if alert.HasField('effect') else None,
                        'cause': alert.cause if alert.HasField('cause') else None,
                        'severity_level': alert.severity_level if alert.HasField('severity_level') else None,
                        'active_periods': [
                            {
                                'start': period.start if period.HasField('start') else None,
                                'end': period.end if period.HasField('end') else None
                            }
                            for period in alert.active_period
                        ],
                        'affected_routes': [route.route_id for route in alert.informed_entity if route.HasField('route_id')],
                        'affected_stops': [stop.stop_id for stop in alert.informed_entity if stop.HasField('stop_id')],
                        'timestamp': datetime.now().isoformat()
                    }
                    alerts.append(alert_data)
            
            self.cached_alerts = alerts
            self.last_fetch = datetime.now()
            return alerts
            
        except Exception as e:
            print(f"Error fetching GTFS-RT alerts: {e}")
            return self._get_cached_alerts()
    
    def _fetch_alerts_simple(self) -> List[Dict]:
        """Simple fallback if protobuf library not available"""
        try:
            response = requests.get(self.ALERTS_URL, timeout=10)
            response.raise_for_status()
            
            # Try to parse as JSON (some feeds support this)
            try:
                data = response.json()
                return data.get('entity', [])
            except:
                pass
            
            # If protobuf, return empty (need library)
            return []
        except Exception as e:
            print(f"Error fetching alerts (simple): {e}")
            return []
    
    def _get_text(self, text_translation) -> str:
        """Extract text from TranslatedString"""
        if text_translation.translation:
            return text_translation.translation[0].text
        return ""
    
    def _get_cached_alerts(self) -> List[Dict]:
        """Get cached alerts if fetch fails"""
        if self.cache_file.exists():
            try:
                with open(self.cache_file, 'r') as f:
                    cached = json.load(f)
                    return cached.get('alerts', [])
            except:
                pass
        return []
    
    def get_alerts_for_route(self, route_id: str) -> List[Dict]:
        """Get alerts affecting a specific route"""
        alerts = self.fetch_alerts()
        return [
            alert for alert in alerts
            if route_id in alert.get('affected_routes', []) or 
               len(alert.get('affected_routes', [])) == 0  # System-wide alerts
        ]
    
    def get_active_alerts(self) -> List[Dict]:
        """Get currently active alerts"""
        alerts = self.fetch_alerts()
        now = datetime.now().timestamp()
        
        active = []
        for alert in alerts:
            active_periods = alert.get('active_periods', [])
            if not active_periods:
                # No time restriction, assume active
                active.append(alert)
                continue
            
            for period in active_periods:
                start = period.get('start', 0)
                end = period.get('end', 0)
                
                # Check if current time is within any active period
                if start == 0 and end == 0:
                    # No time restriction
                    active.append(alert)
                    break
                elif start == 0 and end > 0:
                    # Active until end
                    if now < end:
                        active.append(alert)
                        break
                elif start > 0 and end == 0:
                    # Active from start
                    if now >= start:
                        active.append(alert)
                        break
                elif start > 0 and end > 0:
                    # Active between start and end
                    if start <= now < end:
                        active.append(alert)
                        break
        
        return active
    
    def get_alert_summary(self) -> Dict:
        """Get summary of current alerts"""
        alerts = self.get_active_alerts()
        
        # Categorize alerts
        detours = [a for a in alerts if 'detour' in a.get('header_text', '').lower() or 
                   a.get('effect') == 2]  # Effect 2 = DETOUR
        events = [a for a in alerts if any(word in a.get('header_text', '').lower() 
                   for word in ['event', 'festival', 'game', 'football'])]
        weather = [a for a in alerts if 'weather' in a.get('header_text', '').lower() or
                   a.get('cause') == 2]  # Cause 2 = WEATHER
        construction = [a for a in alerts if any(word in a.get('header_text', '').lower()
                       for word in ['construction', 'road work', 'maintenance'])]
        
        return {
            'total_active': len(alerts),
            'detours': len(detours),
            'events': len(events),
            'weather': len(weather),
            'construction': len(construction),
            'system_wide': len([a for a in alerts if len(a.get('affected_routes', [])) == 0]),
            'route_specific': len([a for a in alerts if len(a.get('affected_routes', [])) > 0])
        }
    
    def is_route_affected(self, route_id: str) -> bool:
        """Check if a route has any active alerts"""
        alerts = self.get_alerts_for_route(route_id)
        return len(alerts) > 0
    
    def get_route_alert_types(self, route_id: str) -> Dict:
        """Get types of alerts affecting a route"""
        alerts = self.get_alerts_for_route(route_id)
        
        return {
            'has_detour': any('detour' in a.get('header_text', '').lower() for a in alerts),
            'has_event': any('event' in a.get('header_text', '').lower() for a in alerts),
            'has_weather': any('weather' in a.get('header_text', '').lower() for a in alerts),
            'has_construction': any('construction' in a.get('header_text', '').lower() for a in alerts),
            'alert_count': len(alerts),
            'alerts': alerts
        }

