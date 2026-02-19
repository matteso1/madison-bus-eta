"""
Static GTFS Schedule Loader

Downloads and parses the static GTFS feed from Madison Metro:
  http://transitdata.cityofmadison.com/GTFS/mmt_gtfs.zip

Loads stops.txt, trips.txt, and stop_times.txt into PostgreSQL.
Should be run once at startup, then refreshed weekly.
"""

import csv
import io
import logging
import os
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

GTFS_URL = os.getenv(
    "GTFS_STATIC_URL",
    "http://transitdata.cityofmadison.com/GTFS/mmt_gtfs.zip",
)

FETCH_TIMEOUT = 60


def download_gtfs_zip(url: str = GTFS_URL) -> bytes | None:
    """Download the GTFS zip archive. Returns raw bytes or None on failure."""
    try:
        logger.info(f"Downloading static GTFS from {url}")
        resp = requests.get(url, timeout=FETCH_TIMEOUT)
        resp.raise_for_status()
        logger.info(f"Downloaded {len(resp.content) / 1024:.0f} KB")
        return resp.content
    except Exception as e:
        logger.error(f"Failed to download GTFS: {e}")
        return None


def _read_csv_from_zip(zf: zipfile.ZipFile, filename: str) -> list[dict]:
    """Read a CSV file inside a zip archive, return list of dicts."""
    try:
        with zf.open(filename) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
            return list(reader)
    except KeyError:
        logger.warning(f"{filename} not found in GTFS zip")
        return []


def parse_stops(zf: zipfile.ZipFile) -> list[dict]:
    """Parse stops.txt -> list of {stop_id, stop_name, stop_lat, stop_lon, stop_code}."""
    rows = _read_csv_from_zip(zf, "stops.txt")
    stops = []
    for r in rows:
        try:
            stops.append({
                "stop_id": r["stop_id"].strip(),
                "stop_name": r.get("stop_name", "").strip(),
                "stop_lat": float(r["stop_lat"]),
                "stop_lon": float(r["stop_lon"]),
                "stop_code": r.get("stop_code", "").strip() or None,
            })
        except (KeyError, ValueError) as e:
            logger.debug(f"Skipping bad stop row: {e}")
    logger.info(f"Parsed {len(stops)} stops from stops.txt")
    return stops


def parse_trips(zf: zipfile.ZipFile) -> list[dict]:
    """Parse trips.txt -> list of {trip_id, route_id, service_id, direction_id, shape_id, trip_headsign}."""
    rows = _read_csv_from_zip(zf, "trips.txt")
    trips = []
    for r in rows:
        try:
            direction_id = r.get("direction_id")
            trips.append({
                "trip_id": r["trip_id"].strip(),
                "route_id": r["route_id"].strip(),
                "service_id": r.get("service_id", "").strip(),
                "direction_id": int(direction_id) if direction_id not in (None, "") else None,
                "shape_id": r.get("shape_id", "").strip() or None,
                "trip_headsign": r.get("trip_headsign", "").strip() or None,
            })
        except (KeyError, ValueError) as e:
            logger.debug(f"Skipping bad trip row: {e}")
    logger.info(f"Parsed {len(trips)} trips from trips.txt")
    return trips


def parse_stop_times(zf: zipfile.ZipFile) -> list[dict]:
    """Parse stop_times.txt -> list of {trip_id, stop_id, stop_sequence, arrival_time, departure_time}."""
    rows = _read_csv_from_zip(zf, "stop_times.txt")
    stop_times = []
    for r in rows:
        try:
            stop_times.append({
                "trip_id": r["trip_id"].strip(),
                "stop_id": r["stop_id"].strip(),
                "stop_sequence": int(r["stop_sequence"]),
                "arrival_time": r.get("arrival_time", "").strip(),
                "departure_time": r.get("departure_time", "").strip(),
            })
        except (KeyError, ValueError) as e:
            logger.debug(f"Skipping bad stop_time row: {e}")
    logger.info(f"Parsed {len(stop_times)} stop_times from stop_times.txt")
    return stop_times


def load_static_gtfs(
    save_stops_fn,
    save_trips_fn,
    save_stop_times_fn,
    save_feed_info_fn,
    url: str = GTFS_URL,
) -> dict:
    """
    Full pipeline: download -> parse -> save to DB.

    Args:
        save_stops_fn:      callable(records) -> int
        save_trips_fn:      callable(records) -> int
        save_stop_times_fn: callable(records) -> int
        save_feed_info_fn:  callable(url, stops, trips, stop_times) -> None
        url:                GTFS zip URL

    Returns dict with counts.
    """
    raw = download_gtfs_zip(url)
    if raw is None:
        return {"error": "download failed"}

    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        stops = parse_stops(zf)
        trips = parse_trips(zf)
        stop_times = parse_stop_times(zf)

    stops_saved = save_stops_fn(stops)
    trips_saved = save_trips_fn(trips)
    stop_times_saved = save_stop_times_fn(stop_times)

    save_feed_info_fn(url, stops_saved, trips_saved, stop_times_saved)

    result = {
        "stops": stops_saved,
        "trips": trips_saved,
        "stop_times": stop_times_saved,
    }
    logger.info(f"Static GTFS loaded: {result}")
    return result
