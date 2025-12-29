from fastapi import APIRouter
from ..db import get_db_connection
import logging
import requests
import os
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv('MADISON_METRO_API_KEY')
API_BASE = os.getenv('MADISON_METRO_API_BASE', 'https://metromap.cityofmadison.com/bustime/api/v3')

import time
import hashlib

router = APIRouter(prefix="/geo", tags=["geo"])
logger = logging.getLogger(__name__)

# Simple in-memory cache
# { "key": { "data": ..., "expires": timestamp } }
_CACHE = {}

def get_route_color(route_id: str):
    """Generate a deterministic color for a route ID."""
    # Use MD5 to get a consistent hash
    hash_object = hashlib.md5(route_id.encode())
    hex_hash = hash_object.hexdigest()
    
    # Take first 6 chars for RGB
    r = int(hex_hash[0:2], 16)
    g = int(hex_hash[2:4], 16)
    b = int(hex_hash[4:6], 16)
    
    # Boost brightness to ensure visibility on dark map
    # Ensure at least one channel is bright
    if max(r, g, b) < 150:
        r = min(255, r + 100)
        g = min(255, g + 100)
        b = min(255, b + 100)
        
    return [r, g, b]

def get_cached(key):
    entry = _CACHE.get(key)
    if entry and entry["expires"] > time.time():
        return entry["data"]
    return None

def set_cached(key, data, ttl_seconds):
    _CACHE[key] = {
        "data": data,
        "expires": time.time() + ttl_seconds
    }

@router.get("/heatmap")
async def get_heatmap_data():
    """
    Get vehicle positions for heatmap visualization.
    Returns list of [lon, lat] or [lon, lat, weight].
    """
    conn = get_db_connection()
    try:
        # Get all vehicle positions
        # We could limit to a specific date or time range, but for now let's return a sample
        # or all if it's performant. 100k points is fine for Deck.gl.
        result = conn.execute("""
            SELECT 
                lon,
                lat
            FROM vehicles
            WHERE lat IS NOT NULL AND lon IS NOT NULL
            -- LIMIT 50000 -- Optional limit if too heavy
        """).fetchall()
        
        return [
            [row[0], row[1]]
            for row in result
        ]
    finally:
        conn.close()

@router.get("/trips")
async def get_trips():
    """
    Get vehicle trajectories for animation (TripsLayer).
    Returns list of { vendor: int, path: [[lon, lat], ...], timestamps: [t1, t2, ...] }
    """
    conn = get_db_connection()
    try:
        # Fetch all data, grouping by vehicle and date to create separate paths for each day
        # This creates a "trend" visualization where multiple days are overlaid
        query = """
            WITH daily_data AS (
                SELECT 
                    vid,
                    rt,
                    lon,
                    lat,
                    strptime(tmstmp, '%Y%m%d %H:%M') as ts,
                    date_part('hour', strptime(tmstmp, '%Y%m%d %H:%M')) * 3600 + 
                    date_part('minute', strptime(tmstmp, '%Y%m%d %H:%M')) * 60 as seconds_of_day,
                    strftime(strptime(tmstmp, '%Y%m%d %H:%M'), '%Y-%m-%d') as date_str
                FROM vehicles
                WHERE lat IS NOT NULL AND lon IS NOT NULL
                ORDER BY ts
            )
            SELECT 
                vid,
                rt,
                date_str,
                LIST([lon, lat]) as path,
                LIST(seconds_of_day) as timestamps
            FROM daily_data
            GROUP BY vid, rt, date_str

            HAVING len(path) > 1
        """
        result = conn.execute(query).fetchall()
        
        # Post-process to split trips with large time gaps (e.g., > 15 minutes)
        # This prevents "straight lines" across the map when a bus goes out of service or has a gap.
        processed_trips = []
        GAP_THRESHOLD = 900 # 15 minutes in seconds
        
        for row in result:
            route = row[1]
            raw_path = row[3]
            raw_timestamps = row[4]
            
            if not raw_path or not raw_timestamps:
                continue
                
            current_path = [raw_path[0]]
            current_timestamps = [raw_timestamps[0]]
            
            # Get color for this route
            route_color = get_route_color(route)
            
            for i in range(1, len(raw_path)):
                t_diff = raw_timestamps[i] - raw_timestamps[i-1]
                
                if t_diff > GAP_THRESHOLD:
                    # Gap detected, save current segment and start new one
                    if len(current_path) > 1:
                        processed_trips.append({
                            "vendor": 0,
                            "route": route,
                            "path": current_path,
                            "timestamps": current_timestamps,
                            "color": route_color
                        })
                    current_path = [raw_path[i]]
                    current_timestamps = [raw_timestamps[i]]
                else:
                    current_path.append(raw_path[i])
                    current_timestamps.append(raw_timestamps[i])
            
            # Append the final segment
            if len(current_path) > 1:
                processed_trips.append({
                    "vendor": 0,
                    "route": route,
                    "path": current_path,
                    "timestamps": current_timestamps,
                    "color": route_color
                })
                
        return processed_trips
    finally:
        conn.close()

@router.get("/routes")
async def get_routes():
    """
    Proxy to get routes from Madison Metro API.
    Cached for 1 hour.
    """
    cached = get_cached("routes")
    if cached:
        return cached

    if not API_KEY:
        return {"error": "API key not configured"}
    
    try:
        params = {
            "key": API_KEY,
            "format": "json"
        }
        resp = requests.get(f"{API_BASE}/getroutes", params=params)
        data = resp.json()
        
        # Cache if successful
        if "bustime-response" in data:
            set_cached("routes", data, 3600) # 1 hour cache
            
        return data
    except Exception as e:
        logger.error(f"Error fetching routes: {e}")
        return {"error": str(e)}

@router.get("/patterns")
async def get_patterns(rt: str = None):
    """
    Get route patterns (shapes) from Madison Metro API.
    If rt is provided, returns patterns for that route.
    If rt is 'ALL' or None, fetches patterns for ALL routes (heavy operation, cached).
    Cached for 24 hours (static data).
    """
    if not rt:
        rt = 'ALL'

    cache_key = f"patterns:{rt}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    if not API_KEY:
        return {"error": "API key not configured"}

    try:
        routes_to_fetch = []
        if rt == 'ALL':
            # Fetch all routes first
            r_params = {"key": API_KEY, "format": "json"}
            r_resp = requests.get(f"{API_BASE}/getroutes", params=r_params)
            r_data = r_resp.json()
            if "bustime-response" in r_data and "routes" in r_data["bustime-response"]:
                # Limit to first 20 routes to avoid timeout/rate limits if needed
                # But user wants "ALL". Let's try all but be careful.
                # Madison has ~25 routes. It should be fine.
                routes_to_fetch = [r["rt"] for r in r_data["bustime-response"]["routes"]]
        else:
            routes_to_fetch = [rt]

        all_patterns = []
        
        for route_id in routes_to_fetch:
            params = {
                "key": API_KEY,
                "format": "json",
                "rt": route_id
            }
            resp = requests.get(f"{API_BASE}/getpatterns", params=params)
            data = resp.json()
            
            if "bustime-response" in data and "ptr" in data["bustime-response"]:
                ptrs = data["bustime-response"]["ptr"]
                if not isinstance(ptrs, list):
                    ptrs = [ptrs]
                    
                for p in ptrs:
                    if "pt" in p:
                        points = p["pt"]
                        path = [[float(pt["lon"]), float(pt["lat"])] for pt in points]
                        # Determine route ID for this pattern (it might be in the pattern or passed in)
                        # The pattern object 'p' usually doesn't have 'rt'. We rely on the loop variable 'route_id'.
                        
                        color = get_route_color(route_id)
                        
                        all_patterns.append({
                            "id": p.get("pid"),
                            "route": route_id, # Add route ID for legend
                            "len": p.get("rtdir"),
                            "path": path,
                            "color": color
                        })
            
            # Small sleep to be nice to API if fetching many
            if len(routes_to_fetch) > 1:
                time.sleep(0.1)
        
        result = {"patterns": all_patterns}
        set_cached(cache_key, result, 86400) # 24 hour cache
        return result

    except Exception as e:
        logger.error(f"Error fetching patterns for {rt}: {e}")
        return {"error": str(e)}

@router.get("/live-vehicles")
async def get_live_vehicles():
    """
    Proxy to get live vehicles from Madison Metro API.
    Cached for 5 seconds.
    """
    cached = get_cached("live_vehicles")
    if cached:
        return cached

    if not API_KEY:
        return {"error": "API key not configured"}
    
    try:
        # 1. Fetch all routes first
        routes_resp = requests.get(f"{API_BASE}/getroutes", params={"key": API_KEY, "format": "json"})
        routes_data = routes_resp.json()
        
        if "error" in routes_data:
             # Fallback: try fetching without rt (some APIs allow it)
             logger.warning("Could not fetch routes, trying getvehicles without rt")
             resp = requests.get(f"{API_BASE}/getvehicles", params={"key": API_KEY, "format": "json"})
             return resp.json()

        routes = routes_data.get("bustime-response", {}).get("routes", [])
        if not routes:
            logger.error(f"No routes found in response: {routes_data}")
            return {"error": "No routes found"}
            
        # Extract route IDs
        rt_ids = [str(r["rt"]) for r in routes]
        # Chunk routes to avoid API limits (e.g., max 10 routes per call)
        chunk_size = 10
        all_vehicles = []
        
        for i in range(0, len(rt_ids), chunk_size):
            chunk = rt_ids[i:i + chunk_size]
            rt_str = ",".join(chunk)
            
            params = {
                "key": API_KEY,
                "format": "json",
                "rt": rt_str
            }
            try:
                resp = requests.get(f"{API_BASE}/getvehicles", params=params)
                data = resp.json()
                
                if "bustime-response" in data and "vehicle" in data["bustime-response"]:
                    vehicles = data["bustime-response"]["vehicle"]
                    if isinstance(vehicles, list):
                        all_vehicles.extend(vehicles)
                    else:
                        all_vehicles.append(vehicles)
            except Exception as e:
                logger.error(f"Error fetching chunk {chunk}: {e}")
        
        # Save to database (Data Collection)
        if all_vehicles:
            try:
                conn = get_db_connection()
                # Prepare data for insertion
                # Table schema assumed: tmstmp, lat, lon, vid, rt, des, dly, ...
                # We'll just insert the key fields we have.
                # Check table schema first or use a safe insert.
                # For now, let's assume the 'vehicles' table exists and matches.
                # We'll insert: vid, rt, tmstmp, lat, lon, hdg, pdist, dly
                
                # Create a list of tuples
                values = []
                for v in all_vehicles:
                    values.append((
                        v.get('vid'),
                        v.get('rt'),
                        v.get('tmstmp'),
                        float(v.get('lat')),
                        float(v.get('lon')),
                        int(v.get('hdg', 0)),
                        v.get('pid'),
                        v.get('des'),
                        str(v.get('dly')), # Store boolean as string or int depending on DB
                        v.get('spd')
                    ))
                
                # Bulk insert
                # Note: DuckDB's executemany might be slow, but for <100 rows it's fine.
                # We need to handle potential schema mismatches.
                # Let's try a safe insert if the table exists.
                conn.executemany("""
                    INSERT INTO vehicles (vid, rt, tmstmp, lat, lon, hdg, pid, des, dly, spd)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, values)
                conn.commit() # If needed, though DuckDB usually auto-commits in this context
                conn.close()
                logger.info(f"Saved {len(all_vehicles)} vehicles to history")
            except Exception as e:
                logger.error(f"Error saving to DB: {e}")

            except Exception as e:
                logger.error(f"Error saving to DB: {e}")

        response_data = {"bustime-response": {"vehicle": all_vehicles}}
        set_cached("live_vehicles", response_data, 2) # 2 seconds cache
        return response_data
    except Exception as e:
        logger.error(f"Error fetching live vehicles: {e}")
        return {"error": str(e)}


