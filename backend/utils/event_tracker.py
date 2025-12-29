"""
Madison Event Tracker
Tracks major events that impact transit (UW football, festivals, etc.)
"""

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

class MadisonEventTracker:
    """Track and identify major Madison events that affect transit"""
    
    def __init__(self, events_file='backend/data/madison_events.json'):
        self.events_file = Path(events_file)
        self.events_file.parent.mkdir(parents=True, exist_ok=True)
        self.events = self._load_events()
        
    def _load_events(self) -> Dict:
        """Load events from file or create default"""
        if self.events_file.exists():
            try:
                with open(self.events_file, 'r') as f:
                    return json.load(f)
            except:
                pass
        
        # Default annual events based on research
        default_events = {
            "annual_events": [
                {
                    "name": "UW Football Home Games",
                    "type": "sports",
                    "location": "Camp Randall Stadium",
                    "impact": "high",
                    "affected_routes": ["80", "81", "82", "84", "A", "B"],
                    "pattern": "saturday_fall",
                    "dates": [],  # Will be populated from schedule
                    "description": "UW Badgers home football games cause major delays on campus routes"
                },
                {
                    "name": "Art Fair on the Square",
                    "type": "festival",
                    "location": "Capitol Square",
                    "impact": "high",
                    "affected_routes": ["A", "B", "C", "D", "E", "F", "2", "6", "11"],
                    "pattern": "second_weekend_july",
                    "dates": [],
                    "description": "200,000+ attendees, major impact on downtown routes"
                },
                {
                    "name": "Dane County Farmers' Market",
                    "type": "market",
                    "location": "Capitol Square",
                    "impact": "medium",
                    "affected_routes": ["A", "B", "C", "D", "E", "F"],
                    "pattern": "saturday_april_november",
                    "dates": [],
                    "description": "Every Saturday morning, April-November"
                },
                {
                    "name": "Mifflin Street Block Party",
                    "type": "student_event",
                    "location": "Mifflin Street",
                    "impact": "high",
                    "affected_routes": ["80", "81", "82", "84"],
                    "pattern": "last_saturday_april",
                    "dates": [],
                    "description": "Large student gathering, major delays on campus routes"
                },
                {
                    "name": "La Fête de Marquette",
                    "type": "festival",
                    "location": "McPike Park",
                    "impact": "medium",
                    "affected_routes": ["A", "B", "C", "28", "38"],
                    "pattern": "july",
                    "dates": [],
                    "description": "French-themed festival, 40,000+ attendees"
                },
                {
                    "name": "Wisconsin Film Festival",
                    "type": "cultural",
                    "location": "Multiple venues",
                    "impact": "medium",
                    "affected_routes": ["A", "B", "C", "80", "81", "82"],
                    "pattern": "april",
                    "dates": [],
                    "description": "8-day film festival in April"
                },
                {
                    "name": "Great Midwest Marijuana Harvest Festival",
                    "type": "festival",
                    "location": "Library Mall",
                    "impact": "low",
                    "affected_routes": ["80", "81", "82"],
                    "pattern": "october",
                    "dates": [],
                    "description": "Annual festival since 1971"
                }
            ],
            "special_events": []  # One-time events added manually
        }
        
        self._save_events(default_events)
        return default_events
    
    def _save_events(self, events: Dict):
        """Save events to file"""
        with open(self.events_file, 'w') as f:
            json.dump(events, f, indent=2)
    
    def get_event_for_date(self, date: datetime) -> Optional[Dict]:
        """Check if there's an event on a given date"""
        date_str = date.strftime('%Y-%m-%d')
        
        # Check annual events
        for event in self.events.get('annual_events', []):
            if date_str in event.get('dates', []):
                return event
        
        # Check special events
        for event in self.events.get('special_events', []):
            if event.get('date') == date_str:
                return event
        
        return None
    
    def is_event_day(self, date: datetime) -> bool:
        """Quick check if date has an event"""
        return self.get_event_for_date(date) is not None
    
    def get_event_impact(self, date: datetime, route: str) -> Optional[str]:
        """Get event impact level for a specific route on a date"""
        event = self.get_event_for_date(date)
        if event and route in event.get('affected_routes', []):
            return event.get('impact', 'low')
        return None
    
    def add_special_event(self, name: str, date: str, impact: str = 'medium', 
                         affected_routes: List[str] = None, description: str = ''):
        """Add a one-time special event"""
        if 'special_events' not in self.events:
            self.events['special_events'] = []
        
        self.events['special_events'].append({
            "name": name,
            "date": date,
            "type": "special",
            "impact": impact,
            "affected_routes": affected_routes or [],
            "description": description
        })
        
        self._save_events(self.events)
    
    def fetch_uw_football_schedule(self) -> List[str]:
        """Fetch UW football home game dates (placeholder - would need to scrape or use API)"""
        # In production, you'd fetch from UW Athletics website or API
        # For now, return common fall Saturday dates
        current_year = datetime.now().year
        fall_saturdays = []
        
        # Typical UW home games: September-November Saturdays
        for month in [9, 10, 11]:
            for day in range(1, 31):
                try:
                    date = datetime(current_year, month, day)
                    if date.weekday() == 5:  # Saturday
                        fall_saturdays.append(date.strftime('%Y-%m-%d'))
                except ValueError:
                    continue
        
        return fall_saturdays[:6]  # Typically 6-7 home games
    
    def update_annual_event_dates(self):
        """Update dates for annual events based on patterns"""
        current_year = datetime.now().year
        
        for event in self.events.get('annual_events', []):
            pattern = event.get('pattern', '')
            dates = []
            
            if pattern == 'saturday_fall':
                # UW Football - would need actual schedule
                dates = self.fetch_uw_football_schedule()
            elif pattern == 'second_weekend_july':
                # Art Fair - second weekend of July
                july = datetime(current_year, 7, 1)
                # Find first Saturday
                first_saturday = 6 - july.weekday() if july.weekday() < 6 else 13 - july.weekday()
                dates = [
                    (july + timedelta(days=first_saturday + 7)).strftime('%Y-%m-%d'),  # Saturday
                    (july + timedelta(days=first_saturday + 8)).strftime('%Y-%m-%d')  # Sunday
                ]
            elif pattern == 'saturday_april_november':
                # Farmers Market - every Saturday April-November
                for month in range(4, 12):  # April-November
                    for day in range(1, 32):
                        try:
                            date = datetime(current_year, month, day)
                            if date.weekday() == 5:  # Saturday
                                dates.append(date.strftime('%Y-%m-%d'))
                        except ValueError:
                            continue
            elif pattern == 'last_saturday_april':
                # Mifflin Block Party
                april = datetime(current_year, 4, 1)
                # Find last Saturday
                last_day = 30
                for day in range(30, 24, -1):
                    try:
                        date = datetime(current_year, 4, day)
                        if date.weekday() == 5:  # Saturday
                            dates.append(date.strftime('%Y-%m-%d'))
                            break
                    except ValueError:
                        continue
            
            event['dates'] = dates
        
        self._save_events(self.events)

