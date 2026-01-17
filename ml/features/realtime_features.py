"""
Real-time Velocity Features for Madison Bus ETA

Calculates bus velocity and acceleration from consecutive GPS pings
in the vehicle_observations table. These features help predict if
a bus is running ahead or behind schedule.

Key insight: A bus moving at 5 mph in heavy traffic is likely to be late.
A bus moving at 30 mph is likely on schedule.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, Tuple
import math

import pandas as pd
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate distance in meters between two GPS points.
    
    Returns distance in meters.
    """
    R = 6371000  # Earth radius in meters
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = (math.sin(delta_phi/2)**2 + 
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c


def calculate_velocity_from_pings(
    vid: str, 
    at_time: datetime, 
    engine,
    lookback_seconds: int = 120
) -> Dict[str, float]:
    """
    Calculate velocity and acceleration for a vehicle at a specific time.
    
    Args:
        vid: Vehicle ID
        at_time: Timestamp to calculate velocity at
        engine: SQLAlchemy engine
        lookback_seconds: How far back to look for GPS pings
    
    Returns:
        Dict with velocity_mps, velocity_mph, acceleration, is_stopped
    """
    from sqlalchemy import text
    
    # Get recent GPS pings for this vehicle
    query = text("""
        SELECT lat, lon, collected_at
        FROM vehicle_observations
        WHERE vid = :vid
        AND collected_at BETWEEN :start_time AND :end_time
        ORDER BY collected_at
    """)
    
    start_time = at_time - timedelta(seconds=lookback_seconds)
    
    with engine.connect() as conn:
        rows = conn.execute(query, {
            "vid": vid,
            "start_time": start_time,
            "end_time": at_time
        }).fetchall()
    
    if len(rows) < 2:
        # Not enough data points
        return {
            "velocity_mps": 0.0,
            "velocity_mph": 0.0,
            "velocity_kmh": 0.0,
            "acceleration_mps2": 0.0,
            "is_stopped": 1,
            "data_available": 0
        }
    
    # Calculate velocities between consecutive points
    velocities = []
    times = []
    
    for i in range(1, len(rows)):
        lat1, lon1, t1 = rows[i-1]
        lat2, lon2, t2 = rows[i]
        
        distance = haversine_distance(lat1, lon1, lat2, lon2)
        time_delta = (t2 - t1).total_seconds()
        
        if time_delta > 0:
            velocity = distance / time_delta  # m/s
            velocities.append(velocity)
            times.append(t2)
    
    if not velocities:
        return {
            "velocity_mps": 0.0,
            "velocity_mph": 0.0,
            "velocity_kmh": 0.0,
            "acceleration_mps2": 0.0,
            "is_stopped": 1,
            "data_available": 0
        }
    
    # Average velocity (more stable than last point)
    avg_velocity = np.mean(velocities)
    
    # Acceleration (change in velocity over time)
    acceleration = 0.0
    if len(velocities) >= 2:
        velocity_change = velocities[-1] - velocities[0]
        total_time = (times[-1] - times[0]).total_seconds() if len(times) >= 2 else 1
        acceleration = velocity_change / max(total_time, 1)
    
    # Convert to different units
    velocity_mph = avg_velocity * 2.237  # m/s to mph
    velocity_kmh = avg_velocity * 3.6    # m/s to km/h
    
    # Is stopped? (< 1 m/s is essentially stopped)
    is_stopped = 1 if avg_velocity < 1.0 else 0
    
    return {
        "velocity_mps": round(avg_velocity, 2),
        "velocity_mph": round(velocity_mph, 2),
        "velocity_kmh": round(velocity_kmh, 2),
        "acceleration_mps2": round(acceleration, 4),
        "is_stopped": is_stopped,
        "data_available": 1
    }


def add_velocity_features_to_df(df: pd.DataFrame, engine) -> pd.DataFrame:
    """
    Add velocity features to a DataFrame of predictions.
    
    This is designed to be called during training data preparation.
    For efficiency, we batch the queries by time windows.
    
    Args:
        df: DataFrame with vid and created_at columns
        engine: SQLAlchemy engine
    
    Returns:
        DataFrame with velocity features added
    """
    from sqlalchemy import text
    
    logger.info(f"Adding velocity features to {len(df)} records...")
    
    # For efficiency, pre-fetch all vehicle observations in the time range
    min_time = df['created_at'].min() - timedelta(minutes=5)
    max_time = df['created_at'].max()
    
    query = text("""
        SELECT vid, lat, lon, collected_at
        FROM vehicle_observations
        WHERE collected_at BETWEEN :min_time AND :max_time
        ORDER BY vid, collected_at
    """)
    
    with engine.connect() as conn:
        obs_df = pd.read_sql(query, conn, params={
            "min_time": min_time,
            "max_time": max_time
        })
    
    if obs_df.empty:
        logger.warning("No vehicle observations found for velocity calculation")
        df['velocity_mph'] = 0.0
        df['acceleration_mps2'] = 0.0
        df['is_stopped'] = 0
        return df
    
    # Build a lookup dictionary for fast velocity calculation
    # Group by vid
    obs_df['collected_at'] = pd.to_datetime(obs_df['collected_at'], utc=True)
    vehicle_groups = obs_df.groupby('vid')
    
    # Calculate velocity for each prediction
    velocities = []
    accelerations = []
    is_stopped_list = []
    
    for _, row in df.iterrows():
        vid = row['vid']
        at_time = row['created_at']
        
        if vid not in vehicle_groups.groups:
            velocities.append(0.0)
            accelerations.append(0.0)
            is_stopped_list.append(0)
            continue
        
        # Get pings for this vehicle within lookback window
        vehicle_obs = vehicle_groups.get_group(vid)
        lookback_start = at_time - timedelta(seconds=120)
        relevant_obs = vehicle_obs[
            (vehicle_obs['collected_at'] >= lookback_start) & 
            (vehicle_obs['collected_at'] <= at_time)
        ].sort_values('collected_at')
        
        if len(relevant_obs) < 2:
            velocities.append(0.0)
            accelerations.append(0.0)
            is_stopped_list.append(0)
            continue
        
        # Calculate velocity between consecutive pings
        obs_list = relevant_obs.values.tolist()
        speeds = []
        for i in range(1, len(obs_list)):
            lat1, lon1, t1 = obs_list[i-1][1], obs_list[i-1][2], obs_list[i-1][3]
            lat2, lon2, t2 = obs_list[i][1], obs_list[i][2], obs_list[i][3]
            
            dist = haversine_distance(lat1, lon1, lat2, lon2)
            dt = (t2 - t1).total_seconds()
            
            if dt > 0:
                speeds.append(dist / dt)
        
        if speeds:
            avg_speed = np.mean(speeds) * 2.237  # Convert to mph
            velocities.append(round(avg_speed, 2))
            
            # Acceleration
            if len(speeds) >= 2:
                accel = (speeds[-1] - speeds[0]) / max(len(speeds) * 60, 1)
                accelerations.append(round(accel, 4))
            else:
                accelerations.append(0.0)
            
            is_stopped_list.append(1 if avg_speed < 2 else 0)
        else:
            velocities.append(0.0)
            accelerations.append(0.0)
            is_stopped_list.append(0)
    
    df['velocity_mph'] = velocities
    df['acceleration_mps2'] = accelerations
    df['is_stopped'] = is_stopped_list
    
    # Add derived features
    df['is_slow'] = (df['velocity_mph'] < 10).astype(int)  # < 10 mph is slow
    df['is_fast'] = (df['velocity_mph'] > 30).astype(int)  # > 30 mph is fast
    
    logger.info(f"Velocity features added. Avg velocity: {df['velocity_mph'].mean():.1f} mph")
    
    return df


if __name__ == "__main__":
    # Test velocity calculation
    import os
    from sqlalchemy import create_engine
    
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        engine = create_engine(database_url, pool_pre_ping=True)
        
        # Test with a specific vehicle
        result = calculate_velocity_from_pings(
            vid="5101",  # Example vehicle
            at_time=datetime.now(timezone.utc),
            engine=engine
        )
        print(f"Velocity test result: {result}")
    else:
        print("DATABASE_URL not set")
