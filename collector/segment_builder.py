"""
Segment Travel Time Builder

Computes stop-to-stop actual travel times from GTFS-RT TripUpdate data.
Runs periodically (every 5 minutes) to process recent data.

For each trip, consecutive stop time updates are paired to compute:
  actual_travel_time = arrival_time[stop N+1] - departure_time[stop N]
                       (or arrival_time[stop N] if no departure)

These records form the core training data for segment-level ML models.
"""

import logging
from collections import defaultdict
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def build_segments(
    get_recent_stop_times_fn,
    get_scheduled_fn,
    save_segments_fn,
    since_minutes: int = 10,
) -> int:
    """
    Process recent GTFS-RT stop times into segment travel time records.

    Args:
        get_recent_stop_times_fn:  callable(since_minutes) -> list[dict]
        get_scheduled_fn:          callable(trip_id, from_seq, to_seq) -> int|None
        save_segments_fn:          callable(records) -> int
        since_minutes:             how far back to look for data

    Returns count of segments saved.
    """
    rows = get_recent_stop_times_fn(since_minutes)
    if not rows:
        logger.debug("Segment builder: no recent stop time data")
        return 0

    by_trip: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["trip_id"]:
            by_trip[r["trip_id"]].append(r)

    segments = []
    for trip_id, stops in by_trip.items():
        stops.sort(key=lambda s: (s["stop_sequence"] or 0))

        for i in range(len(stops) - 1):
            s_from = stops[i]
            s_to = stops[i + 1]

            dep_time = s_from.get("departure_time") or s_from.get("arrival_time")
            arr_time = s_to.get("arrival_time")

            if dep_time is None or arr_time is None:
                continue

            actual_sec = int((arr_time - dep_time).total_seconds())
            if actual_sec < 0 or actual_sec > 7200:
                continue

            scheduled_sec = get_scheduled_fn(
                trip_id,
                s_from["stop_sequence"],
                s_to["stop_sequence"],
            )

            dt = dep_time if isinstance(dep_time, datetime) else datetime.now(timezone.utc)

            segments.append({
                "trip_id": trip_id,
                "route_id": s_from.get("route_id"),
                "direction_id": s_from.get("direction_id"),
                "vehicle_id": s_from.get("vehicle_id"),
                "from_stop_id": s_from["stop_id"],
                "to_stop_id": s_to["stop_id"],
                "stop_sequence": s_from["stop_sequence"],
                "scheduled_travel_time_sec": scheduled_sec,
                "actual_travel_time_sec": actual_sec,
                "delay_at_origin_sec": s_from.get("departure_delay") or s_from.get("arrival_delay"),
                "departure_time": dt,
                "hour_of_day": dt.hour,
                "day_of_week": dt.weekday(),
                "is_weekend": dt.weekday() >= 5,
            })

    if not segments:
        logger.debug("Segment builder: no valid segments computed")
        return 0

    saved = save_segments_fn(segments)
    logger.info(f"Segment builder: {len(segments)} segments computed from {len(by_trip)} trips, {saved} saved")
    return saved
