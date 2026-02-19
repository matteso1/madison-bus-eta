"""
Database models and utilities for Madison Metro data persistence.
Requires DATABASE_URL environment variable (from Railway PostgreSQL).
"""

from sqlalchemy import (
    create_engine, Column, Integer, BigInteger, String, Float, Boolean,
    DateTime, Text, UniqueConstraint, Index
)
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, timezone, timedelta
import os
import logging

logger = logging.getLogger(__name__)

Base = declarative_base()


class VehicleObservation(Base):
    """A single observation of a vehicle at a point in time."""
    __tablename__ = 'vehicle_observations'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    # Vehicle identifiers
    vid = Column(String(20), index=True)       # Vehicle ID
    rt = Column(String(10), index=True)        # Route designator
    # Position
    lat = Column(Float)
    lon = Column(Float)
    hdg = Column(Integer)                      # Heading in degrees
    # Status
    dly = Column(Boolean, default=False)       # Delayed flag
    spd = Column(Integer, nullable=True)       # Speed (if available)
    # Pattern/destination
    pid = Column(String(20), nullable=True)    # Pattern ID
    des = Column(String(100), nullable=True)   # Destination
    # Timestamps
    tmstmp = Column(String(20))                # API timestamp (YYYYMMDD HH:MM)
    collected_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Prediction(Base):
    """A bus arrival prediction for a stop."""
    __tablename__ = 'predictions'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    # Stop info
    stpid = Column(String(20), index=True)     # Stop ID
    stpnm = Column(String(100))                # Stop name
    # Vehicle/route info
    vid = Column(String(20), index=True)       # Vehicle ID
    rt = Column(String(10), index=True)        # Route
    des = Column(String(100), nullable=True)   # Destination
    # Prediction
    prdtm = Column(String(20))                 # Predicted arrival (YYYYMMDD HH:MM)
    prdctdn = Column(Integer)                  # Countdown in minutes
    # Metadata
    collected_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class MLTrainingRun(Base):
    """Tracks ML model training runs for autonomous retraining."""
    __tablename__ = 'ml_training_runs'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    version = Column(String(50), unique=True, index=True)  # Model version (timestamp)
    trained_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Training data info
    samples_used = Column(Integer)
    days_of_data = Column(Integer, default=7)
    
    # Model metrics
    accuracy = Column(Float)
    precision = Column(Float)
    recall = Column(Float)
    f1_score = Column(Float)
    
    # Comparison with previous
    previous_f1 = Column(Float, nullable=True)
    improvement_pct = Column(Float, nullable=True)
    
    # Deployment status
    deployed = Column(Boolean, default=False)
    deployment_reason = Column(String(200), nullable=True)  # "improved" / "first_model" / "not_deployed"


class StopArrival(Base):
    """
    Records when a vehicle arrives at a stop.
    
    This is detected by matching vehicle positions to stop locations.
    Used to generate ground truth for ETA prediction models.
    """
    __tablename__ = 'stop_arrivals'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    vid = Column(String(20), index=True)   # Vehicle ID
    rt = Column(String(10), index=True)    # Route
    stpid = Column(String(20), index=True) # Stop ID
    stpnm = Column(String(100))            # Stop name
    arrived_at = Column(DateTime(timezone=True), index=True)


class PredictionOutcome(Base):
    """
    Links predictions to actual arrivals - the ground truth for ML.
    
    error_seconds = actual_arrival - predicted_arrival
    Positive = bus arrived later than predicted (late)
    Negative = bus arrived earlier than predicted (early)
    """
    __tablename__ = 'prediction_outcomes'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    prediction_id = Column(Integer, nullable=True)  # FK to predictions.id
    vid = Column(String(20), index=True)
    rt = Column(String(10), index=True)
    stpid = Column(String(20), index=True)
    predicted_arrival = Column(DateTime(timezone=True))
    actual_arrival = Column(DateTime(timezone=True))
    error_seconds = Column(Integer)  # Target variable for regression!
    is_significantly_late = Column(Boolean, default=False)  # error > 5 min
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class GTFSRTStopTime(Base):
    """
    Stop-level schedule adherence from GTFS-RT TripUpdate feed.
    Each row = one stop prediction for one trip at one collection time.
    """
    __tablename__ = 'gtfsrt_stop_times'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    trip_id = Column(String(100), index=True)
    route_id = Column(String(20), index=True)
    direction_id = Column(Integer, nullable=True)
    vehicle_id = Column(String(20), nullable=True)
    stop_id = Column(String(20), index=True)
    stop_sequence = Column(Integer, nullable=True)
    arrival_delay = Column(Integer, nullable=True)       # seconds early(-)/late(+)
    arrival_time = Column(DateTime(timezone=True), nullable=True)
    departure_delay = Column(Integer, nullable=True)
    departure_time = Column(DateTime(timezone=True), nullable=True)
    collected_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    __table_args__ = (
        UniqueConstraint('trip_id', 'stop_id', 'collected_at', name='uq_gtfsrt_trip_stop_collected'),
        Index('ix_gtfsrt_stop_times_trip_stop_collected', 'trip_id', 'stop_id', 'collected_at'),
    )


class GTFSRTVehiclePosition(Base):
    """
    Vehicle positions from GTFS-RT VehiclePositions feed.
    Richer than REST API: includes trip_id, stop status, speed.
    """
    __tablename__ = 'gtfsrt_vehicle_positions'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    vehicle_id = Column(String(20), index=True)
    trip_id = Column(String(100), nullable=True)
    route_id = Column(String(20), nullable=True)
    direction_id = Column(Integer, nullable=True)
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)
    bearing = Column(Float, nullable=True)
    speed = Column(Float, nullable=True)
    stop_id = Column(String(20), nullable=True)
    current_stop_sequence = Column(Integer, nullable=True)
    current_status = Column(Integer, nullable=True)       # 0=INCOMING, 1=STOPPED, 2=IN_TRANSIT
    timestamp = Column(DateTime(timezone=True), nullable=True)
    collected_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class GTFSStop(Base):
    """Stop from static GTFS stops.txt."""
    __tablename__ = 'gtfs_stops'

    stop_id = Column(String(20), primary_key=True)
    stop_name = Column(String(200))
    stop_lat = Column(Float)
    stop_lon = Column(Float)
    stop_code = Column(String(20), nullable=True)
    loaded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class GTFSTrip(Base):
    """Trip from static GTFS trips.txt."""
    __tablename__ = 'gtfs_trips'

    trip_id = Column(String(100), primary_key=True)
    route_id = Column(String(20), index=True)
    service_id = Column(String(50), index=True)
    direction_id = Column(Integer, nullable=True)
    shape_id = Column(String(100), nullable=True)
    trip_headsign = Column(String(200), nullable=True)
    loaded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class GTFSStopTime(Base):
    """Scheduled stop time from static GTFS stop_times.txt."""
    __tablename__ = 'gtfs_stop_times'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    trip_id = Column(String(100), index=True)
    stop_id = Column(String(20), index=True)
    stop_sequence = Column(Integer)
    arrival_time = Column(String(10))       # HH:MM:SS (can exceed 24:00 for overnight)
    departure_time = Column(String(10))
    loaded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint('trip_id', 'stop_sequence', name='uq_gtfs_stop_times_trip_seq'),
        Index('ix_gtfs_stop_times_trip_stop', 'trip_id', 'stop_id'),
    )


class GTFSFeedInfo(Base):
    """Tracks when static GTFS was last loaded."""
    __tablename__ = 'gtfs_feed_info'

    id = Column(Integer, primary_key=True, autoincrement=True)
    feed_url = Column(String(500))
    downloaded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    stops_count = Column(Integer, default=0)
    trips_count = Column(Integer, default=0)
    stop_times_count = Column(Integer, default=0)


class SegmentTravelTime(Base):
    """
    Stop-to-stop actual travel times computed from GTFS-RT data.
    This is the core training table for segment-level ML models.
    """
    __tablename__ = 'segment_travel_times'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    trip_id = Column(String(100), index=True)
    route_id = Column(String(20), index=True)
    direction_id = Column(Integer, nullable=True)
    vehicle_id = Column(String(20), nullable=True)
    from_stop_id = Column(String(20))
    to_stop_id = Column(String(20))
    stop_sequence = Column(Integer)
    scheduled_travel_time_sec = Column(Integer, nullable=True)
    actual_travel_time_sec = Column(Integer)
    delay_at_origin_sec = Column(Integer, nullable=True)
    departure_time = Column(DateTime(timezone=True))
    hour_of_day = Column(Integer)
    day_of_week = Column(Integer)        # 0=Monday
    is_weekend = Column(Boolean, default=False)
    observed_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint('trip_id', 'from_stop_id', 'to_stop_id', 'departure_time',
                         name='uq_segment_trip_from_to_dep'),
        Index('ix_segment_route_from_dep', 'route_id', 'from_stop_id', 'departure_time'),
        Index('ix_segment_trip_seq', 'trip_id', 'stop_sequence'),
    )


# Database connection
_engine = None
_SessionLocal = None


def get_db_engine():
    """Get or create database engine."""
    global _engine
    if _engine is None:
        database_url = os.getenv('DATABASE_URL')
        if not database_url:
            return None
        
        # Railway provides DATABASE_URL like: postgresql://user:pass@host:port/db
        _engine = create_engine(database_url, pool_pre_ping=True)
        
        # Create tables if they don't exist
        Base.metadata.create_all(_engine)
        logger.info("Database connected and tables created")
    
    return _engine


def get_session():
    """Get a database session."""
    global _SessionLocal
    engine = get_db_engine()
    if engine is None:
        return None
    
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=engine)
    
    return _SessionLocal()


def save_vehicles_to_db(vehicles: list) -> int:
    """Save vehicle observations to database. Returns count saved."""
    session = get_session()
    if session is None:
        return 0
    
    try:
        observations = []
        for v in vehicles:
            obs = VehicleObservation(
                vid=str(v.get('vid', '')),
                rt=str(v.get('rt', '')),
                lat=float(v.get('lat', 0)),
                lon=float(v.get('lon', 0)),
                hdg=int(v.get('hdg', 0)),
                dly=v.get('dly', False),
                spd=v.get('spd'),
                pid=str(v.get('pid', '')) if v.get('pid') else None,
                des=v.get('des'),
                tmstmp=v.get('tmstmp', '')
            )
            observations.append(obs)
        
        session.bulk_save_objects(observations)
        session.commit()
        return len(observations)
    except Exception as e:
        logger.error(f"Error saving vehicles to DB: {e}")
        session.rollback()
        return 0
    finally:
        session.close()


def save_predictions_to_db(predictions: list) -> int:
    """Save predictions to database. Returns count saved."""
    session = get_session()
    if session is None:
        return 0
    
    try:
        pred_objects = []
        for p in predictions:
            # Handle prdctdn - API returns 'DUE' when bus is arriving
            prdctdn_raw = p.get('prdctdn', 0)
            try:
                prdctdn = int(prdctdn_raw)
            except (ValueError, TypeError):
                prdctdn = 0  # 'DUE' or other non-numeric = arriving now
            
            pred = Prediction(
                stpid=str(p.get('stpid', '')),
                stpnm=p.get('stpnm', ''),
                vid=str(p.get('vid', '')),
                rt=str(p.get('rt', '')),
                des=p.get('des'),
                prdtm=p.get('prdtm', ''),
                prdctdn=prdctdn
            )
            pred_objects.append(pred)
        
        session.bulk_save_objects(pred_objects)
        session.commit()
        return len(pred_objects)
    except Exception as e:
        logger.error(f"Error saving predictions to DB: {e}")
        session.rollback()
        return 0
    finally:
        session.close()


def save_arrivals_to_db(arrivals: list) -> int:
    """Save detected stop arrivals to database. Returns count saved."""
    session = get_session()
    if session is None:
        return 0
    
    try:
        arrival_objects = []
        for a in arrivals:
            arr = StopArrival(
                vid=a.vid,
                rt=a.rt,
                stpid=a.stpid,
                stpnm=a.stpnm,
                arrived_at=a.arrived_at
            )
            arrival_objects.append(arr)
        
        session.bulk_save_objects(arrival_objects)
        session.commit()
        return len(arrival_objects)
    except Exception as e:
        logger.error(f"Error saving arrivals to DB: {e}")
        session.rollback()
        return 0
    finally:
        session.close()


def save_prediction_outcomes_to_db(outcomes: list) -> int:
    """Save prediction outcomes (ground truth) to database. Returns count saved."""
    session = get_session()
    if session is None:
        return 0
    
    try:
        outcome_objects = []
        for o in outcomes:
            outcome = PredictionOutcome(
                prediction_id=o.get('prediction_id'),
                vid=o.get('vid'),
                rt=o.get('rt'),
                stpid=o.get('stpid'),
                predicted_arrival=o.get('predicted_arrival'),
                actual_arrival=o.get('actual_arrival'),
                error_seconds=o.get('error_seconds'),
                is_significantly_late=o.get('is_significantly_late', False)
            )
            outcome_objects.append(outcome)
        
        session.bulk_save_objects(outcome_objects)
        session.commit()
        return len(outcome_objects)
    except Exception as e:
        logger.error(f"Error saving prediction outcomes to DB: {e}")
        session.rollback()
        return 0
    finally:
        session.close()


def get_pending_predictions(vehicle_ids: list, minutes_back: int = 30) -> list:
    """
    Get recent predictions for given vehicles that might be arriving at stops.
    
    Args:
        vehicle_ids: List of vehicle IDs to look up
        minutes_back: How far back to search for predictions
    
    Returns:
        List of prediction dicts with id, vid, stpid, prdtm, collected_at
    """
    from sqlalchemy import text
    
    session = get_session()
    if session is None:
        return []
    
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes_back)
        
        # Query predictions for these vehicles
        result = session.execute(text("""
            SELECT id, vid, stpid, prdtm, collected_at
            FROM predictions
            WHERE vid = ANY(:vids)
              AND collected_at > :cutoff
            ORDER BY collected_at DESC
        """), {"vids": vehicle_ids, "cutoff": cutoff})
        
        predictions = []
        for row in result:
            predictions.append({
                'id': row[0],
                'vid': row[1],
                'stpid': row[2],
                'prdtm': row[3],
                'collected_at': row[4]
            })
        
        return predictions
    except Exception as e:
        logger.error(f"Error fetching pending predictions: {e}")
        return []
    finally:
        session.close()


# ---------------------------------------------------------------------------
# GTFS-RT save functions
# ---------------------------------------------------------------------------

def save_gtfsrt_stop_times(records: list) -> int:
    """Save GTFS-RT trip update stop-time records. Returns count saved."""
    from sqlalchemy import text
    session = get_session()
    if session is None:
        return 0

    try:
        count = 0
        for r in records:
            session.execute(text("""
                INSERT INTO gtfsrt_stop_times
                    (trip_id, route_id, direction_id, vehicle_id, stop_id, stop_sequence,
                     arrival_delay, arrival_time, departure_delay, departure_time, collected_at)
                VALUES
                    (:trip_id, :route_id, :direction_id, :vehicle_id, :stop_id, :stop_sequence,
                     :arrival_delay, :arrival_time, :departure_delay, :departure_time, :collected_at)
                ON CONFLICT ON CONSTRAINT uq_gtfsrt_trip_stop_collected DO NOTHING
            """), {
                "trip_id": r.get("trip_id"),
                "route_id": r.get("route_id"),
                "direction_id": r.get("direction_id"),
                "vehicle_id": r.get("vehicle_id"),
                "stop_id": r.get("stop_id"),
                "stop_sequence": r.get("stop_sequence"),
                "arrival_delay": r.get("arrival_delay"),
                "arrival_time": r.get("arrival_time"),
                "departure_delay": r.get("departure_delay"),
                "departure_time": r.get("departure_time"),
                "collected_at": r.get("collected_at"),
            })
            count += 1
        session.commit()
        return count
    except Exception as e:
        logger.error(f"Error saving GTFS-RT stop times: {e}")
        session.rollback()
        return 0
    finally:
        session.close()


def save_gtfsrt_vehicle_positions(records: list) -> int:
    """Save GTFS-RT vehicle position records. Returns count saved."""
    session = get_session()
    if session is None:
        return 0

    try:
        objs = []
        for r in records:
            objs.append(GTFSRTVehiclePosition(
                vehicle_id=r.get("vehicle_id"),
                trip_id=r.get("trip_id"),
                route_id=r.get("route_id"),
                direction_id=r.get("direction_id"),
                lat=r.get("lat"),
                lon=r.get("lon"),
                bearing=r.get("bearing"),
                speed=r.get("speed"),
                stop_id=r.get("stop_id"),
                current_stop_sequence=r.get("current_stop_sequence"),
                current_status=r.get("current_status"),
                timestamp=r.get("timestamp"),
                collected_at=r.get("collected_at"),
            ))
        session.bulk_save_objects(objs)
        session.commit()
        return len(objs)
    except Exception as e:
        logger.error(f"Error saving GTFS-RT vehicle positions: {e}")
        session.rollback()
        return 0
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Static GTFS save functions
# ---------------------------------------------------------------------------

def save_gtfs_stops(records: list) -> int:
    """Upsert static GTFS stops. Returns count saved."""
    from sqlalchemy import text
    session = get_session()
    if session is None:
        return 0

    try:
        count = 0
        for r in records:
            session.execute(text("""
                INSERT INTO gtfs_stops (stop_id, stop_name, stop_lat, stop_lon, stop_code, loaded_at)
                VALUES (:stop_id, :stop_name, :stop_lat, :stop_lon, :stop_code, NOW())
                ON CONFLICT (stop_id) DO UPDATE SET
                    stop_name = EXCLUDED.stop_name,
                    stop_lat  = EXCLUDED.stop_lat,
                    stop_lon  = EXCLUDED.stop_lon,
                    stop_code = EXCLUDED.stop_code,
                    loaded_at = NOW()
            """), {
                "stop_id": r["stop_id"],
                "stop_name": r["stop_name"],
                "stop_lat": r["stop_lat"],
                "stop_lon": r["stop_lon"],
                "stop_code": r.get("stop_code"),
            })
            count += 1
        session.commit()
        return count
    except Exception as e:
        logger.error(f"Error saving GTFS stops: {e}")
        session.rollback()
        return 0
    finally:
        session.close()


def save_gtfs_trips(records: list) -> int:
    """Upsert static GTFS trips. Returns count saved."""
    from sqlalchemy import text
    session = get_session()
    if session is None:
        return 0

    try:
        count = 0
        for r in records:
            session.execute(text("""
                INSERT INTO gtfs_trips (trip_id, route_id, service_id, direction_id, shape_id, trip_headsign, loaded_at)
                VALUES (:trip_id, :route_id, :service_id, :direction_id, :shape_id, :trip_headsign, NOW())
                ON CONFLICT (trip_id) DO UPDATE SET
                    route_id      = EXCLUDED.route_id,
                    service_id    = EXCLUDED.service_id,
                    direction_id  = EXCLUDED.direction_id,
                    shape_id      = EXCLUDED.shape_id,
                    trip_headsign = EXCLUDED.trip_headsign,
                    loaded_at     = NOW()
            """), {
                "trip_id": r["trip_id"],
                "route_id": r["route_id"],
                "service_id": r["service_id"],
                "direction_id": r.get("direction_id"),
                "shape_id": r.get("shape_id"),
                "trip_headsign": r.get("trip_headsign"),
            })
            count += 1
        session.commit()
        return count
    except Exception as e:
        logger.error(f"Error saving GTFS trips: {e}")
        session.rollback()
        return 0
    finally:
        session.close()


def save_gtfs_stop_times(records: list) -> int:
    """Bulk insert static GTFS stop times (after clearing old data). Returns count."""
    from sqlalchemy import text
    session = get_session()
    if session is None:
        return 0

    try:
        session.execute(text("DELETE FROM gtfs_stop_times"))
        objs = []
        for r in records:
            objs.append(GTFSStopTime(
                trip_id=r["trip_id"],
                stop_id=r["stop_id"],
                stop_sequence=r["stop_sequence"],
                arrival_time=r["arrival_time"],
                departure_time=r["departure_time"],
            ))
        session.bulk_save_objects(objs)
        session.commit()
        return len(objs)
    except Exception as e:
        logger.error(f"Error saving GTFS stop times: {e}")
        session.rollback()
        return 0
    finally:
        session.close()


def save_gtfs_feed_info(feed_url: str, stops: int, trips: int, stop_times: int) -> None:
    """Record metadata about a static GTFS load."""
    session = get_session()
    if session is None:
        return

    try:
        session.add(GTFSFeedInfo(
            feed_url=feed_url,
            stops_count=stops,
            trips_count=trips,
            stop_times_count=stop_times,
        ))
        session.commit()
    except Exception as e:
        logger.error(f"Error saving GTFS feed info: {e}")
        session.rollback()
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Segment travel time save functions
# ---------------------------------------------------------------------------

def save_segment_travel_times(records: list) -> int:
    """Save computed segment travel times. Returns count saved."""
    from sqlalchemy import text
    session = get_session()
    if session is None:
        return 0

    try:
        count = 0
        for r in records:
            session.execute(text("""
                INSERT INTO segment_travel_times
                    (trip_id, route_id, direction_id, vehicle_id,
                     from_stop_id, to_stop_id, stop_sequence,
                     scheduled_travel_time_sec, actual_travel_time_sec, delay_at_origin_sec,
                     departure_time, hour_of_day, day_of_week, is_weekend)
                VALUES
                    (:trip_id, :route_id, :direction_id, :vehicle_id,
                     :from_stop_id, :to_stop_id, :stop_sequence,
                     :scheduled_travel_time_sec, :actual_travel_time_sec, :delay_at_origin_sec,
                     :departure_time, :hour_of_day, :day_of_week, :is_weekend)
                ON CONFLICT ON CONSTRAINT uq_segment_trip_from_to_dep DO NOTHING
            """), {
                "trip_id": r["trip_id"],
                "route_id": r.get("route_id"),
                "direction_id": r.get("direction_id"),
                "vehicle_id": r.get("vehicle_id"),
                "from_stop_id": r["from_stop_id"],
                "to_stop_id": r["to_stop_id"],
                "stop_sequence": r["stop_sequence"],
                "scheduled_travel_time_sec": r.get("scheduled_travel_time_sec"),
                "actual_travel_time_sec": r["actual_travel_time_sec"],
                "delay_at_origin_sec": r.get("delay_at_origin_sec"),
                "departure_time": r["departure_time"],
                "hour_of_day": r["hour_of_day"],
                "day_of_week": r["day_of_week"],
                "is_weekend": r.get("is_weekend", False),
            })
            count += 1
        session.commit()
        return count
    except Exception as e:
        logger.error(f"Error saving segment travel times: {e}")
        session.rollback()
        return 0
    finally:
        session.close()


def get_unprocessed_gtfsrt_stop_times(since_minutes: int = 10) -> list:
    """
    Get recent GTFS-RT stop time records for segment computation.
    Returns rows grouped by trip_id ordered by stop_sequence.
    """
    from sqlalchemy import text

    session = get_session()
    if session is None:
        return []

    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)
        result = session.execute(text("""
            SELECT DISTINCT ON (trip_id, stop_id)
                trip_id, route_id, direction_id, vehicle_id,
                stop_id, stop_sequence,
                arrival_delay, arrival_time,
                departure_delay, departure_time,
                collected_at
            FROM gtfsrt_stop_times
            WHERE collected_at > :cutoff
              AND arrival_time IS NOT NULL
              AND stop_sequence IS NOT NULL
            ORDER BY trip_id, stop_id, collected_at DESC
        """), {"cutoff": cutoff})

        rows = []
        for r in result:
            rows.append({
                "trip_id": r[0],
                "route_id": r[1],
                "direction_id": r[2],
                "vehicle_id": r[3],
                "stop_id": r[4],
                "stop_sequence": r[5],
                "arrival_delay": r[6],
                "arrival_time": r[7],
                "departure_delay": r[8],
                "departure_time": r[9],
                "collected_at": r[10],
            })
        return rows
    except Exception as e:
        logger.error(f"Error fetching unprocessed GTFS-RT stop times: {e}")
        return []
    finally:
        session.close()


def get_scheduled_travel_time(trip_id: str, from_seq: int, to_seq: int) -> int | None:
    """
    Look up the scheduled travel time between two consecutive stops
    from static GTFS stop_times. Returns seconds or None.
    """
    from sqlalchemy import text

    session = get_session()
    if session is None:
        return None

    try:
        result = session.execute(text("""
            SELECT arrival_time, stop_sequence
            FROM gtfs_stop_times
            WHERE trip_id = :trip_id
              AND stop_sequence IN (:s1, :s2)
            ORDER BY stop_sequence
        """), {"trip_id": trip_id, "s1": from_seq, "s2": to_seq})

        rows = list(result)
        if len(rows) != 2:
            return None

        def parse_gtfs_time(t: str) -> int:
            parts = t.split(":")
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])

        t1 = parse_gtfs_time(rows[0][0])
        t2 = parse_gtfs_time(rows[1][0])
        return t2 - t1 if t2 > t1 else None
    except Exception as e:
        logger.error(f"Error looking up scheduled travel time: {e}")
        return None
    finally:
        session.close()

