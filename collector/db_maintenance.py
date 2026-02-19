"""
Database Maintenance Utilities

- Drop obsolete tables (consumer_offsets, api_cache)
- Enforce retention policy (90 days for raw observations)
- Ensure optimized indexes for ML queries
"""

import logging
import os
from datetime import datetime, timezone, timedelta

from sqlalchemy import create_engine, text

logger = logging.getLogger(__name__)


def get_engine():
    url = os.getenv("DATABASE_URL")
    if not url:
        return None
    return create_engine(url, pool_pre_ping=True)


def drop_obsolete_tables(engine=None):
    """Drop tables that are no longer used."""
    engine = engine or get_engine()
    if engine is None:
        return

    obsolete = ["consumer_offsets", "api_cache"]
    with engine.connect() as conn:
        for table in obsolete:
            try:
                conn.execute(text(f"DROP TABLE IF EXISTS {table} CASCADE"))
                logger.info(f"Dropped obsolete table: {table}")
            except Exception as e:
                logger.warning(f"Could not drop {table}: {e}")
        conn.commit()


def enforce_retention_policy(engine=None, days: int = 90):
    """
    Delete raw data older than `days` days.
    Keeps prediction_outcomes permanently (ML training data).
    """
    engine = engine or get_engine()
    if engine is None:
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    tables_to_trim = [
        ("vehicle_observations", "collected_at"),
        ("predictions", "collected_at"),
        ("stop_arrivals", "arrived_at"),
        ("gtfsrt_stop_times", "collected_at"),
        ("gtfsrt_vehicle_positions", "collected_at"),
    ]

    with engine.connect() as conn:
        for table, col in tables_to_trim:
            try:
                result = conn.execute(text(
                    f"DELETE FROM {table} WHERE {col} < :cutoff"
                ), {"cutoff": cutoff})
                if result.rowcount > 0:
                    logger.info(f"Retention: deleted {result.rowcount} rows from {table} older than {days}d")
            except Exception as e:
                logger.warning(f"Retention cleanup failed for {table}: {e}")
        conn.commit()


def ensure_indexes(engine=None):
    """Create optimized indexes for ML queries if they don't exist."""
    engine = engine or get_engine()
    if engine is None:
        return

    indexes = [
        "CREATE INDEX IF NOT EXISTS ix_segment_route_from_dep ON segment_travel_times (route_id, from_stop_id, departure_time)",
        "CREATE INDEX IF NOT EXISTS ix_segment_trip_seq ON segment_travel_times (trip_id, stop_sequence)",
        "CREATE INDEX IF NOT EXISTS ix_gtfsrt_stop_times_trip_stop_collected ON gtfsrt_stop_times (trip_id, stop_id, collected_at)",
        "CREATE INDEX IF NOT EXISTS ix_gtfsrt_vp_vehicle_collected ON gtfsrt_vehicle_positions (vehicle_id, collected_at)",
        "CREATE INDEX IF NOT EXISTS ix_pred_outcomes_rt_stpid ON prediction_outcomes (rt, stpid)",
        "CREATE INDEX IF NOT EXISTS ix_pred_outcomes_created ON prediction_outcomes (created_at)",
        "CREATE INDEX IF NOT EXISTS ix_vehicle_obs_rt_collected ON vehicle_observations (rt, collected_at)",
        "CREATE INDEX IF NOT EXISTS ix_gtfs_stop_times_trip_stop ON gtfs_stop_times (trip_id, stop_id)",
    ]

    with engine.connect() as conn:
        for idx_sql in indexes:
            try:
                conn.execute(text(idx_sql))
            except Exception as e:
                logger.debug(f"Index creation note: {e}")
        conn.commit()
    logger.info(f"Ensured {len(indexes)} ML-optimized indexes")


def run_full_maintenance():
    """Run all maintenance tasks."""
    engine = get_engine()
    if engine is None:
        logger.error("DATABASE_URL not set, skipping maintenance")
        return

    logger.info("Running database maintenance...")
    drop_obsolete_tables(engine)
    enforce_retention_policy(engine)
    ensure_indexes(engine)
    logger.info("Database maintenance complete")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    from dotenv import load_dotenv
    load_dotenv()
    run_full_maintenance()
