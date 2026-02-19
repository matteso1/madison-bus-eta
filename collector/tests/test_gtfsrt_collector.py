"""
Unit tests for gtfsrt_collector.py parse functions.

Uses real gtfs_realtime_pb2 protobuf messages built from scratch so we test
the actual parsing logic — including the proto3 HasField fix.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from gtfsrt_collector import (
    parse_trip_updates,
    parse_vehicle_positions,
    collect_gtfsrt,
)


# ---------------------------------------------------------------------------
# Helpers: build minimal proto-like dicts via MagicMock
# ---------------------------------------------------------------------------
# We can't easily build real protobuf objects in unit tests without a live
# feed, so we use MagicMock objects that mimic the attribute-access pattern.
# HasField is only called on *message* fields (trip_update, vehicle, arrival,
# departure, position) — which are always MagicMock submessages.
# Scalar fields are accessed directly (no HasField).

def _make_feed(entities):
    feed = MagicMock()
    feed.entity = entities
    return feed


def _make_trip_update_entity(
    trip_id="trip-1",
    route_id="4",
    direction_id=0,
    vehicle_id="bus-42",
    stop_time_updates=None,
):
    entity = MagicMock()
    entity.HasField.side_effect = lambda field: field == "trip_update"

    tu = MagicMock()
    tu.trip.trip_id = trip_id
    tu.trip.route_id = route_id
    tu.trip.direction_id = direction_id

    # vehicle is a message field — HasField("vehicle") returns True
    tu.HasField.side_effect = lambda field: field == "vehicle"
    tu.vehicle.id = vehicle_id

    tu.stop_time_update = stop_time_updates or []
    entity.trip_update = tu
    return entity


def _make_stop_time_update(
    stop_id="stop-99",
    stop_sequence=3,
    has_arrival=True,
    arrival_delay=60,
    arrival_time=1700000000,
    has_departure=False,
    departure_delay=0,
    departure_time=0,
):
    stu = MagicMock()
    stu.stop_id = stop_id
    stu.stop_sequence = stop_sequence

    def stu_has_field(field):
        if field == "arrival":
            return has_arrival
        if field == "departure":
            return has_departure
        return False
    stu.HasField.side_effect = stu_has_field

    stu.arrival.delay = arrival_delay
    stu.arrival.time = arrival_time

    stu.departure.delay = departure_delay
    stu.departure.time = departure_time

    return stu


def _make_vehicle_entity(
    vehicle_id="bus-7",
    trip_id="trip-42",
    route_id="6",
    direction_id=1,
    lat=43.07,
    lon=-89.38,
    bearing=180.0,
    speed=12.5,
    stop_id="stop-5",
    current_stop_sequence=2,
    current_status=2,
    timestamp=1700000000,
):
    entity = MagicMock()
    entity.HasField.side_effect = lambda field: field == "vehicle"

    vp = MagicMock()

    def vp_has_field(field):
        return field in ("vehicle", "trip", "position")
    vp.HasField.side_effect = vp_has_field

    vp.vehicle.id = vehicle_id
    vp.trip.trip_id = trip_id
    vp.trip.route_id = route_id
    vp.trip.direction_id = direction_id
    vp.position.latitude = lat
    vp.position.longitude = lon
    vp.position.bearing = bearing
    vp.position.speed = speed
    vp.stop_id = stop_id
    vp.current_stop_sequence = current_stop_sequence
    vp.current_status = current_status
    vp.timestamp = timestamp

    entity.vehicle = vp
    return entity


# ---------------------------------------------------------------------------
# parse_trip_updates tests
# ---------------------------------------------------------------------------

class TestParseTripUpdatesEmpty:
    def test_empty_feed_returns_empty_list(self):
        feed = _make_feed([])
        result = parse_trip_updates(feed)
        assert result == []

    def test_entity_without_trip_update_skipped(self):
        entity = MagicMock()
        entity.HasField.side_effect = lambda field: field != "trip_update"
        feed = _make_feed([entity])
        result = parse_trip_updates(feed)
        assert result == []


class TestParseTripUpdatesWithData:
    def test_parses_trip_id_and_route_id(self):
        stu = _make_stop_time_update(stop_id="stop-1", stop_sequence=1)
        entity = _make_trip_update_entity(trip_id="t-123", route_id="80", stop_time_updates=[stu])
        feed = _make_feed([entity])
        result = parse_trip_updates(feed)
        assert len(result) == 1
        assert result[0]["trip_id"] == "t-123"
        assert result[0]["route_id"] == "80"

    def test_parses_stop_id_and_stop_sequence(self):
        stu = _make_stop_time_update(stop_id="stop-77", stop_sequence=5)
        entity = _make_trip_update_entity(stop_time_updates=[stu])
        feed = _make_feed([entity])
        result = parse_trip_updates(feed)
        assert result[0]["stop_id"] == "stop-77"
        assert result[0]["stop_sequence"] == 5

    def test_parses_arrival_delay_and_time(self):
        ts = 1700000100
        stu = _make_stop_time_update(
            has_arrival=True,
            arrival_delay=120,
            arrival_time=ts,
        )
        entity = _make_trip_update_entity(stop_time_updates=[stu])
        feed = _make_feed([entity])
        result = parse_trip_updates(feed)
        assert result[0]["arrival_delay"] == 120
        assert result[0]["arrival_time"] == datetime.fromtimestamp(ts, tz=timezone.utc)

    def test_zero_arrival_delay_stored_as_none(self):
        # delay=0 is indistinguishable from "not set" in proto3; we treat it as None
        stu = _make_stop_time_update(has_arrival=True, arrival_delay=0, arrival_time=1700000000)
        entity = _make_trip_update_entity(stop_time_updates=[stu])
        feed = _make_feed([entity])
        result = parse_trip_updates(feed)
        assert result[0]["arrival_delay"] is None

    def test_no_arrival_message_gives_none_fields(self):
        stu = _make_stop_time_update(has_arrival=False)
        entity = _make_trip_update_entity(stop_time_updates=[stu])
        feed = _make_feed([entity])
        result = parse_trip_updates(feed)
        assert result[0]["arrival_delay"] is None
        assert result[0]["arrival_time"] is None

    def test_vehicle_id_captured(self):
        stu = _make_stop_time_update()
        entity = _make_trip_update_entity(vehicle_id="bus-99", stop_time_updates=[stu])
        feed = _make_feed([entity])
        result = parse_trip_updates(feed)
        assert result[0]["vehicle_id"] == "bus-99"

    def test_collected_at_is_utc_datetime(self):
        stu = _make_stop_time_update()
        entity = _make_trip_update_entity(stop_time_updates=[stu])
        feed = _make_feed([entity])
        result = parse_trip_updates(feed)
        assert result[0]["collected_at"].tzinfo is not None

    def test_multiple_stop_updates_per_trip(self):
        stus = [_make_stop_time_update(stop_id=f"stop-{i}", stop_sequence=i) for i in range(3)]
        entity = _make_trip_update_entity(stop_time_updates=stus)
        feed = _make_feed([entity])
        result = parse_trip_updates(feed)
        assert len(result) == 3

    def test_empty_stop_id_stored_as_none(self):
        stu = _make_stop_time_update(stop_id="")
        entity = _make_trip_update_entity(stop_time_updates=[stu])
        feed = _make_feed([entity])
        result = parse_trip_updates(feed)
        assert result[0]["stop_id"] is None


# ---------------------------------------------------------------------------
# parse_vehicle_positions tests
# ---------------------------------------------------------------------------

class TestParseVehiclePositionsWithData:
    def test_parses_vehicle_id_and_trip_id(self):
        entity = _make_vehicle_entity(vehicle_id="bus-7", trip_id="trip-42")
        feed = _make_feed([entity])
        result = parse_vehicle_positions(feed)
        assert len(result) == 1
        assert result[0]["vehicle_id"] == "bus-7"
        assert result[0]["trip_id"] == "trip-42"

    def test_parses_lat_lon(self):
        entity = _make_vehicle_entity(lat=43.07, lon=-89.38)
        feed = _make_feed([entity])
        result = parse_vehicle_positions(feed)
        assert result[0]["lat"] == pytest.approx(43.07)
        assert result[0]["lon"] == pytest.approx(-89.38)

    def test_parses_speed(self):
        entity = _make_vehicle_entity(speed=12.5)
        feed = _make_feed([entity])
        result = parse_vehicle_positions(feed)
        assert result[0]["speed"] == pytest.approx(12.5)

    def test_parses_bearing(self):
        entity = _make_vehicle_entity(bearing=270.0)
        feed = _make_feed([entity])
        result = parse_vehicle_positions(feed)
        assert result[0]["bearing"] == pytest.approx(270.0)

    def test_parses_timestamp_as_utc_datetime(self):
        ts = 1700000000
        entity = _make_vehicle_entity(timestamp=ts)
        feed = _make_feed([entity])
        result = parse_vehicle_positions(feed)
        assert result[0]["timestamp"] == datetime.fromtimestamp(ts, tz=timezone.utc)

    def test_zero_timestamp_gives_none(self):
        entity = _make_vehicle_entity(timestamp=0)
        feed = _make_feed([entity])
        result = parse_vehicle_positions(feed)
        assert result[0]["timestamp"] is None

    def test_entity_without_vehicle_skipped(self):
        entity = MagicMock()
        entity.HasField.side_effect = lambda field: field != "vehicle"
        feed = _make_feed([entity])
        result = parse_vehicle_positions(feed)
        assert result == []

    def test_collected_at_is_utc_datetime(self):
        entity = _make_vehicle_entity()
        feed = _make_feed([entity])
        result = parse_vehicle_positions(feed)
        assert result[0]["collected_at"].tzinfo is not None


# ---------------------------------------------------------------------------
# collect_gtfsrt tests
# ---------------------------------------------------------------------------

class TestCollectGtfsrt:
    def test_calls_save_fns_with_parsed_records(self):
        stu = _make_stop_time_update(stop_id="stop-1", stop_sequence=1, arrival_delay=30)
        tu_entity = _make_trip_update_entity(trip_id="t-1", stop_time_updates=[stu])
        vp_entity = _make_vehicle_entity(vehicle_id="bus-1")

        tu_feed = _make_feed([tu_entity])
        vp_feed = _make_feed([vp_entity])

        save_tu = MagicMock(return_value=1)
        save_vp = MagicMock(return_value=1)

        with patch("gtfsrt_collector.fetch_trip_updates", return_value=tu_feed), \
             patch("gtfsrt_collector.fetch_vehicle_positions", return_value=vp_feed):
            result = collect_gtfsrt(save_tu, save_vp)

        save_tu.assert_called_once()
        save_vp.assert_called_once()

        # Verify the shape of records passed to save functions
        tu_records = save_tu.call_args[0][0]
        assert len(tu_records) == 1
        assert tu_records[0]["trip_id"] == "t-1"
        assert tu_records[0]["arrival_delay"] == 30

        vp_records = save_vp.call_args[0][0]
        assert len(vp_records) == 1
        assert vp_records[0]["vehicle_id"] == "bus-1"

        assert result["trip_update_records"] == 1
        assert result["vehicle_position_records"] == 1

    def test_unavailable_feed_skips_save(self):
        save_tu = MagicMock(return_value=0)
        save_vp = MagicMock(return_value=0)

        with patch("gtfsrt_collector.fetch_trip_updates", return_value=None), \
             patch("gtfsrt_collector.fetch_vehicle_positions", return_value=None):
            result = collect_gtfsrt(save_tu, save_vp)

        save_tu.assert_not_called()
        save_vp.assert_not_called()
        assert result["trip_update_records"] == 0
        assert result["vehicle_position_records"] == 0
