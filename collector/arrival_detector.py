"""
Arrival Detector for Madison Metro Bus ETA.

Detects when vehicles arrive at stops by matching vehicle positions
to stop locations. This generates ground truth for ETA prediction models.

Ground truth = difference between API's predicted arrival and actual arrival.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
import math

logger = logging.getLogger(__name__)

# Arrival detection threshold in meters
# Bus is considered "at stop" if within this distance
ARRIVAL_THRESHOLD_METERS = 30

# Minimum time between arrivals at same stop (prevent duplicate detections)
MIN_ARRIVAL_GAP_SECONDS = 120

# How far back to look for predictions to match
PREDICTION_MATCH_WINDOW_MINUTES = 30

# Error threshold for "significantly late" classification (optional)
SIGNIFICANTLY_LATE_SECONDS = 5 * 60  # 5 minutes


@dataclass
class StopLocation:
    """A bus stop with its geographic location."""
    stpid: str
    stpnm: str
    lat: float
    lon: float


@dataclass
class DetectedArrival:
    """A detected arrival event."""
    vid: str
    rt: str
    stpid: str
    stpnm: str
    arrived_at: datetime


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the distance between two points on Earth in meters.
    
    Uses the Haversine formula for accuracy with geographic coordinates.
    """
    R = 6371000  # Earth's radius in meters
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi / 2) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c


class ArrivalDetector:
    """
    Detects bus arrivals at stops and matches them to predictions.
    
    This class:
    1. Maintains a cache of stop locations
    2. Tracks recent arrivals to prevent duplicates
    3. Matches arrivals to pending predictions
    4. Calculates prediction error (ground truth)
    """
    
    def __init__(self, stops: List[StopLocation]):
        """
        Initialize detector with stop locations.
        
        Args:
            stops: List of StopLocation objects for all stops
        """
        self.stops = {s.stpid: s for s in stops}
        self.stops_list = stops
        
        # Build spatial index for efficient lookup
        # Group stops by grid cell (0.01 degree ~ 1km)
        self.stop_grid: Dict[Tuple[int, int], List[StopLocation]] = {}
        for stop in stops:
            cell = self._get_grid_cell(stop.lat, stop.lon)
            if cell not in self.stop_grid:
                self.stop_grid[cell] = []
            self.stop_grid[cell].append(stop)
        
        # Track recent arrivals to prevent duplicates
        # Key: (vid, stpid) -> last arrival time
        self.recent_arrivals: Dict[Tuple[str, str], datetime] = {}
        
        logger.info(f"ArrivalDetector initialized with {len(stops)} stops")
    
    def _get_grid_cell(self, lat: float, lon: float) -> Tuple[int, int]:
        """Get grid cell index for a location."""
        return (int(lat * 100), int(lon * 100))
    
    def _get_nearby_stops(self, lat: float, lon: float) -> List[StopLocation]:
        """Get stops in nearby grid cells for efficient matching."""
        cell = self._get_grid_cell(lat, lon)
        nearby = []
        
        # Check 3x3 grid of cells around the vehicle
        for dlat in [-1, 0, 1]:
            for dlon in [-1, 0, 1]:
                neighbor = (cell[0] + dlat, cell[1] + dlon)
                if neighbor in self.stop_grid:
                    nearby.extend(self.stop_grid[neighbor])
        
        return nearby
    
    def _is_duplicate_arrival(self, vid: str, stpid: str, now: datetime) -> bool:
        """Check if this arrival was already detected recently."""
        key = (vid, stpid)
        if key in self.recent_arrivals:
            last_arrival = self.recent_arrivals[key]
            gap = (now - last_arrival).total_seconds()
            if gap < MIN_ARRIVAL_GAP_SECONDS:
                return True
        return False
    
    def _record_arrival(self, vid: str, stpid: str, now: datetime) -> None:
        """Record an arrival to prevent duplicate detection."""
        self.recent_arrivals[(vid, stpid)] = now
        
        # Clean up old entries (older than 10 minutes)
        cutoff = now - timedelta(minutes=10)
        self.recent_arrivals = {
            k: v for k, v in self.recent_arrivals.items() 
            if v > cutoff
        }
    
    def detect_arrivals(self, vehicles: List[dict]) -> List[DetectedArrival]:
        """
        Detect which vehicles have arrived at stops.
        
        Args:
            vehicles: List of vehicle dictionaries from the API
                      Each has: vid, rt, lat, lon, etc.
        
        Returns:
            List of DetectedArrival objects for vehicles at stops
        """
        now = datetime.now(timezone.utc)
        arrivals = []
        
        for vehicle in vehicles:
            vid = str(vehicle.get('vid', ''))
            rt = str(vehicle.get('rt', ''))
            
            # Ensure lat/lon are floats (API may return strings)
            try:
                lat = float(vehicle.get('lat', 0))
                lon = float(vehicle.get('lon', 0))
            except (TypeError, ValueError):
                continue
            
            if not vid or lat == 0 or lon == 0:
                continue
            
            # Find nearby stops
            nearby_stops = self._get_nearby_stops(lat, lon)
            
            # Check distance to each nearby stop
            for stop in nearby_stops:
                distance = haversine_distance(lat, lon, stop.lat, stop.lon)
                
                if distance <= ARRIVAL_THRESHOLD_METERS:
                    # Vehicle is at this stop!
                    if not self._is_duplicate_arrival(vid, stop.stpid, now):
                        self._record_arrival(vid, stop.stpid, now)
                        
                        arrival = DetectedArrival(
                            vid=vid,
                            rt=rt,
                            stpid=stop.stpid,
                            stpnm=stop.stpnm,
                            arrived_at=now
                        )
                        arrivals.append(arrival)
                        
                        logger.debug(f"Detected arrival: {vid} at {stop.stpnm} ({distance:.1f}m)")
        
        if arrivals:
            logger.info(f"Detected {len(arrivals)} arrivals")
        
        return arrivals


def match_predictions_to_arrivals(
    arrivals: List[DetectedArrival],
    pending_predictions: List[dict]
) -> List[dict]:
    """
    Match detected arrivals to their original predictions.

    This creates the ground truth: actual_arrival vs predicted_arrival.

    Args:
        arrivals: List of DetectedArrival objects
        pending_predictions: List of prediction records from database
            Each has: id, vid, stpid, prdtm (predicted arrival time)

    Returns:
        List of prediction outcomes with error_seconds calculated
    """
    outcomes = []

    for arrival in arrivals:
        # Find matching predictions for this vehicle + stop
        matches = [
            p for p in pending_predictions
            if p['vid'] == arrival.vid and p['stpid'] == arrival.stpid
        ]
        
        if not matches:
            # No prediction found for this arrival
            continue
        
        # Take the most recent prediction (closest to arrival)
        best_match = max(matches, key=lambda p: p.get('collected_at', datetime.min))
        
        # Parse predicted arrival time (format: "YYYYMMDD HH:MM")
        # IMPORTANT: The API returns times in LOCAL time (America/Chicago = CST/CDT)
        try:
            prdtm_str = best_match.get('prdtm', '')
            if prdtm_str:
                # Parse the local time
                predicted_arrival = datetime.strptime(prdtm_str, "%Y%m%d %H:%M")
                
                # Try to use pytz for proper timezone handling
                try:
                    import pytz
                    chicago_tz = pytz.timezone('America/Chicago')
                    predicted_arrival = chicago_tz.localize(predicted_arrival)
                    predicted_arrival = predicted_arrival.astimezone(timezone.utc)
                except ImportError:
                    # Fallback: CST is UTC-6 (doesn't handle DST but close enough)
                    from datetime import timedelta as td
                    predicted_arrival = predicted_arrival.replace(tzinfo=timezone.utc)
                    predicted_arrival = predicted_arrival + td(hours=6)  # CST -> UTC
            else:
                continue
        except ValueError:
            logger.warning(f"Could not parse prdtm: {prdtm_str}")
            continue
        
        # Calculate error: positive = late, negative = early
        error_seconds = int((arrival.arrived_at - predicted_arrival).total_seconds())
        
        outcome = {
            'prediction_id': best_match.get('id'),
            'vid': arrival.vid,
            'stpid': arrival.stpid,
            'rt': arrival.rt,
            'predicted_arrival': predicted_arrival,
            'actual_arrival': arrival.arrived_at,
            'error_seconds': error_seconds,
            'is_significantly_late': error_seconds > SIGNIFICANTLY_LATE_SECONDS
        }
        outcomes.append(outcome)
        
        logger.debug(
            f"Matched prediction: vid={arrival.vid}, "
            f"error={error_seconds}s ({error_seconds/60:.1f}min)"
        )
    
    if outcomes:
        avg_error = sum(o['error_seconds'] for o in outcomes) / len(outcomes)
        logger.info(
            f"Matched {len(outcomes)} predictions, "
            f"avg error: {avg_error:.0f}s ({avg_error/60:.1f}min)"
        )
    
    return outcomes
