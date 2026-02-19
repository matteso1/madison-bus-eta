"""
Unit tests for segment_builder.py build_segments function.

All dependencies (DB fetch, scheduled time lookup, save callback) are injected
as callables, so no database connection is needed.
"""

import pytest
from datetime import datetime, timezone, timedelta

from segment_builder import build_segments


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ts(offset_sec=0):
    """Return a fixed UTC datetime offset by offset_sec seconds."""
    base = datetime(2024, 3, 15, 9, 0, 0, tzinfo=timezone.utc)
    return base + timedelta(seconds=offset_sec)


def _make_stop(
    trip_id="trip-1",
    stop_id="stop-A",
    stop_sequence=1,
    arrival_time=None,
    departure_time=None,
    route_id="4",
    direction_id=0,
    vehicle_id="bus-1",
    arrival_delay=None,
    departure_delay=None,
):
    return {
        "trip_id": trip_id,
        "route_id": route_id,
        "direction_id": direction_id,
        "vehicle_id": vehicle_id,
        "stop_id": stop_id,
        "stop_sequence": stop_sequence,
        "arrival_time": arrival_time or _ts(stop_sequence * 60),
        "departure_time": departure_time,
        "arrival_delay": arrival_delay,
        "departure_delay": departure_delay,
        "collected_at": _ts(),
    }


def _no_scheduled(trip_id, from_seq, to_seq):
    return None


def _capturing_save(records):
    """A save callback that captures what was passed to it."""
    _capturing_save.last_records = records
    return len(records)

_capturing_save.last_records = []


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestNoData:
    def test_empty_input_returns_zero(self):
        result = build_segments(
            get_recent_stop_times_fn=lambda m: [],
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: 0,
        )
        assert result == 0


class TestSingleStop:
    def test_single_stop_per_trip_produces_no_segments(self):
        rows = [_make_stop(stop_id="stop-1", stop_sequence=1)]
        saved = []
        result = build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert result == 0
        assert saved == []


class TestBasicSegmentComputation:
    def test_two_stops_produce_one_segment(self):
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=_ts(0)),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=_ts(180)),
        ]
        saved = []
        result = build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert result == 1
        assert len(saved) == 1

    def test_actual_travel_time_computed_correctly(self):
        dep = _ts(0)
        arr = _ts(300)
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=dep, departure_time=dep),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=arr),
        ]
        saved = []
        build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert saved[0]["actual_travel_time_sec"] == 300

    def test_falls_back_to_arrival_when_no_departure(self):
        # If stop has no departure_time, arrival_time is used as the departure
        dep = _ts(0)
        arr = _ts(240)
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=dep, departure_time=None),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=arr),
        ]
        saved = []
        build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert saved[0]["actual_travel_time_sec"] == 240

    def test_from_and_to_stop_ids_correct(self):
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=_ts(0)),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=_ts(180)),
        ]
        saved = []
        build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert saved[0]["from_stop_id"] == "stop-A"
        assert saved[0]["to_stop_id"] == "stop-B"

    def test_three_stops_produce_two_segments(self):
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=_ts(0)),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=_ts(120)),
            _make_stop(stop_id="stop-C", stop_sequence=3, arrival_time=_ts(300)),
        ]
        saved = []
        result = build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert result == 2
        assert len(saved) == 2


class TestFiltering:
    def test_negative_travel_time_filtered(self):
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=_ts(300)),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=_ts(0)),  # arrived earlier
        ]
        saved = []
        result = build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert result == 0
        assert saved == []

    def test_over_7200s_travel_time_filtered(self):
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=_ts(0)),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=_ts(7201)),
        ]
        saved = []
        result = build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert result == 0

    def test_exactly_7200s_is_accepted(self):
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=_ts(0)),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=_ts(7200)),
        ]
        saved = []
        result = build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert result == 1

    def test_missing_arrival_time_at_destination_skipped(self):
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=_ts(0)),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=None),
        ]
        # Override: manually set arrival_time=None after construction
        rows[1]["arrival_time"] = None
        saved = []
        result = build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert result == 0


class TestScheduledTime:
    def test_scheduled_time_included_when_available(self):
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=_ts(0)),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=_ts(200)),
        ]
        saved = []

        def get_scheduled(trip_id, from_seq, to_seq):
            assert trip_id == "trip-1"
            assert from_seq == 1
            assert to_seq == 2
            return 180

        build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=get_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert saved[0]["scheduled_travel_time_sec"] == 180

    def test_scheduled_time_none_when_lookup_returns_none(self):
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=_ts(0)),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=_ts(200)),
        ]
        saved = []
        build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert saved[0]["scheduled_travel_time_sec"] is None


class TestMultipleTrips:
    def test_two_trips_processed_independently(self):
        rows = [
            _make_stop(trip_id="trip-1", stop_id="stop-A", stop_sequence=1, arrival_time=_ts(0)),
            _make_stop(trip_id="trip-1", stop_id="stop-B", stop_sequence=2, arrival_time=_ts(120)),
            _make_stop(trip_id="trip-2", stop_id="stop-X", stop_sequence=1, arrival_time=_ts(0)),
            _make_stop(trip_id="trip-2", stop_id="stop-Y", stop_sequence=2, arrival_time=_ts(90)),
        ]
        saved = []
        result = build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert result == 2
        trip_ids = {s["trip_id"] for s in saved}
        assert trip_ids == {"trip-1", "trip-2"}


class TestDelayPropagation:
    def test_departure_delay_used_as_delay_at_origin(self):
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=_ts(0), departure_delay=90),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=_ts(180)),
        ]
        saved = []
        build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert saved[0]["delay_at_origin_sec"] == 90

    def test_arrival_delay_used_when_no_departure_delay(self):
        rows = [
            _make_stop(stop_id="stop-A", stop_sequence=1, arrival_time=_ts(0), arrival_delay=45, departure_delay=None),
            _make_stop(stop_id="stop-B", stop_sequence=2, arrival_time=_ts(180)),
        ]
        saved = []
        build_segments(
            get_recent_stop_times_fn=lambda m: rows,
            get_scheduled_fn=_no_scheduled,
            save_segments_fn=lambda r: saved.extend(r) or len(r),
        )
        assert saved[0]["delay_at_origin_sec"] == 45
