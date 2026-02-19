"""
GTFS-RT Trip Updates & Vehicle Positions Collector

Fetches protobuf feeds from Madison Metro's GTFS-RT endpoints:
- Trip Updates:    https://metromap.cityofmadison.com/gtfsrt/trips
- Vehicle Positions: https://metromap.cityofmadison.com/gtfsrt/vehicles

These feeds are FREE (no API key), separate from the Bus Tracker REST API,
and contain richer data (trip IDs, schedule adherence, stop-level delays).
"""

import logging
import time
from datetime import datetime, timezone
from typing import Optional

import requests
from google.transit import gtfs_realtime_pb2

logger = logging.getLogger(__name__)

TRIP_UPDATES_URL = "https://metromap.cityofmadison.com/gtfsrt/trips"
VEHICLE_POSITIONS_URL = "https://metromap.cityofmadison.com/gtfsrt/vehicles"

FETCH_TIMEOUT = 15


def fetch_trip_updates() -> Optional[gtfs_realtime_pb2.FeedMessage]:
    """Fetch and parse the GTFS-RT TripUpdate feed."""
    try:
        resp = requests.get(TRIP_UPDATES_URL, timeout=FETCH_TIMEOUT)
        resp.raise_for_status()
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(resp.content)
        return feed
    except Exception as e:
        logger.error(f"GTFS-RT trip updates fetch failed: {e}")
        return None


def fetch_vehicle_positions() -> Optional[gtfs_realtime_pb2.FeedMessage]:
    """Fetch and parse the GTFS-RT VehiclePositions feed."""
    try:
        resp = requests.get(VEHICLE_POSITIONS_URL, timeout=FETCH_TIMEOUT)
        resp.raise_for_status()
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(resp.content)
        return feed
    except Exception as e:
        logger.error(f"GTFS-RT vehicle positions fetch failed: {e}")
        return None


def parse_trip_updates(feed: gtfs_realtime_pb2.FeedMessage) -> list[dict]:
    """
    Extract stop-time-update records from a TripUpdate feed.

    Each record represents a predicted arrival/departure at one stop
    for one trip, including delay information.
    """
    records = []
    collected_at = datetime.now(timezone.utc)

    for entity in feed.entity:
        if not entity.HasField("trip_update"):
            continue
        tu = entity.trip_update

        trip_id = tu.trip.trip_id or None
        route_id = tu.trip.route_id or None
        # direction_id 0 is valid (outbound), so preserve it directly
        direction_id = tu.trip.direction_id if tu.trip.direction_id is not None else None
        vehicle_id = (tu.vehicle.id or None) if tu.HasField("vehicle") else None

        for stu in tu.stop_time_update:
            stop_id = stu.stop_id or None
            stop_sequence = stu.stop_sequence if stu.stop_sequence else None

            arrival_delay = None
            arrival_time = None
            if stu.HasField("arrival"):
                arrival_delay = stu.arrival.delay if stu.arrival.delay != 0 else None
                arrival_time = datetime.fromtimestamp(stu.arrival.time, tz=timezone.utc) if stu.arrival.time else None

            departure_delay = None
            departure_time = None
            if stu.HasField("departure"):
                departure_delay = stu.departure.delay if stu.departure.delay != 0 else None
                departure_time = datetime.fromtimestamp(stu.departure.time, tz=timezone.utc) if stu.departure.time else None

            records.append({
                "trip_id": trip_id,
                "route_id": route_id,
                "direction_id": direction_id,
                "vehicle_id": vehicle_id,
                "stop_id": stop_id,
                "stop_sequence": stop_sequence,
                "arrival_delay": arrival_delay,
                "arrival_time": arrival_time,
                "departure_delay": departure_delay,
                "departure_time": departure_time,
                "collected_at": collected_at,
            })

    return records


def parse_vehicle_positions(feed: gtfs_realtime_pb2.FeedMessage) -> list[dict]:
    """
    Extract vehicle position records from a VehiclePositions feed.

    Richer than the REST API: includes trip_id, schedule_relationship,
    current stop sequence, and current stop status.
    """
    records = []
    collected_at = datetime.now(timezone.utc)

    for entity in feed.entity:
        if not entity.HasField("vehicle"):
            continue
        vp = entity.vehicle

        vehicle_id = (vp.vehicle.id or None) if vp.HasField("vehicle") else None
        trip_id = (vp.trip.trip_id or None) if vp.HasField("trip") else None
        route_id = (vp.trip.route_id or None) if vp.HasField("trip") else None
        direction_id = vp.trip.direction_id if vp.HasField("trip") else None

        lat = vp.position.latitude if vp.HasField("position") else None
        lon = vp.position.longitude if vp.HasField("position") else None
        bearing = vp.position.bearing if (vp.HasField("position") and vp.position.bearing) else None
        speed = vp.position.speed if (vp.HasField("position") and vp.position.speed) else None

        stop_id = vp.stop_id or None
        current_stop_sequence = vp.current_stop_sequence or None
        current_status = vp.current_status if vp.current_status != 0 else None
        timestamp = datetime.fromtimestamp(vp.timestamp, tz=timezone.utc) if vp.timestamp else None

        records.append({
            "vehicle_id": vehicle_id,
            "trip_id": trip_id,
            "route_id": route_id,
            "direction_id": direction_id,
            "lat": lat,
            "lon": lon,
            "bearing": bearing,
            "speed": speed,
            "stop_id": stop_id,
            "current_stop_sequence": current_stop_sequence,
            "current_status": current_status,
            "timestamp": timestamp,
            "collected_at": collected_at,
        })

    return records


def collect_gtfsrt(save_fn_trip_updates, save_fn_vehicle_positions) -> dict:
    """
    Single collection cycle: fetch both feeds, parse, and save via callbacks.

    Args:
        save_fn_trip_updates: callable(records: list[dict]) -> int  (returns count saved)
        save_fn_vehicle_positions: callable(records: list[dict]) -> int

    Returns dict with counts for logging.
    """
    result = {"trip_update_records": 0, "vehicle_position_records": 0}

    tu_feed = fetch_trip_updates()
    if tu_feed:
        records = parse_trip_updates(tu_feed)
        saved = save_fn_trip_updates(records)
        result["trip_update_records"] = saved
        logger.info(f"GTFS-RT trip updates: {len(records)} parsed, {saved} saved")
    else:
        logger.warning("GTFS-RT trip updates: feed unavailable")

    vp_feed = fetch_vehicle_positions()
    if vp_feed:
        records = parse_vehicle_positions(vp_feed)
        saved = save_fn_vehicle_positions(records)
        result["vehicle_position_records"] = saved
        logger.info(f"GTFS-RT vehicle positions: {len(records)} parsed, {saved} saved")
    else:
        logger.warning("GTFS-RT vehicle positions: feed unavailable")

    return result
