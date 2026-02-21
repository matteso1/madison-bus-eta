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


def enforce_retention_policy(engine=None):
    """
    Enforce per-table retention policy.

    - vehicle_observations / predictions / stop_arrivals: 30 days
      (ML training uses 7 days, conformal calibration uses days 7-21)
    - prediction_outcomes: 90 days (ground truth, kept longer for training)
    - gtfsrt_stop_times / gtfsrt_vehicle_positions: TRUNCATED
      (GTFS-RT collection is disabled; these tables caused ~3M rows/day and
      filled the DB. Truncate any residual data.)
    - segment_travel_times: TRUNCATED (depends on GTFS-RT, not in use)
    """
    engine = engine or get_engine()
    if engine is None:
        return

    with engine.connect() as conn:
        # Truncate high-volume unused tables immediately
        for table in ("gtfsrt_stop_times", "gtfsrt_vehicle_positions", "segment_travel_times"):
            try:
                conn.execute(text(f"TRUNCATE TABLE {table}"))
                logger.info(f"Truncated unused table: {table}")
            except Exception as e:
                logger.debug(f"Truncate {table} skipped (may not exist): {e}")

        conn.commit()

        # Trim raw operational tables to 30 days
        cutoff_30 = datetime.now(timezone.utc) - timedelta(days=30)
        for table, col in [
            ("vehicle_observations", "collected_at"),
            ("predictions", "collected_at"),
            ("stop_arrivals", "arrived_at"),
        ]:
            try:
                result = conn.execute(
                    text(f"DELETE FROM {table} WHERE {col} < :cutoff"),
                    {"cutoff": cutoff_30},
                )
                if result.rowcount > 0:
                    logger.info(f"Retention: deleted {result.rowcount} rows from {table} (>30 days)")
            except Exception as e:
                logger.warning(f"Retention cleanup failed for {table}: {e}")

        # Trim prediction_outcomes to 90 days
        cutoff_90 = datetime.now(timezone.utc) - timedelta(days=90)
        try:
            result = conn.execute(
                text("DELETE FROM prediction_outcomes WHERE created_at < :cutoff"),
                {"cutoff": cutoff_90},
            )
            if result.rowcount > 0:
                logger.info(f"Retention: deleted {result.rowcount} rows from prediction_outcomes (>90 days)")
        except Exception as e:
            logger.warning(f"Retention cleanup failed for prediction_outcomes: {e}")

        conn.commit()


def migrate_gtfsrt_schema(engine=None):
    """
    One-time migration: replace the old per-poll unique constraint
    (trip_id, stop_id, collected_at) with the new upsert-safe one (trip_id, stop_id).
    Also adds uq_gtfsrt_vehicle on gtfsrt_vehicle_positions if missing.
    Safe to run repeatedly — all operations are conditional.
    """
    engine = engine or get_engine()
    if engine is None:
        return

    with engine.connect() as conn:
        # gtfsrt_stop_times: drop old constraint, add new one
        try:
            conn.execute(text(
                "ALTER TABLE gtfsrt_stop_times "
                "DROP CONSTRAINT IF EXISTS uq_gtfsrt_trip_stop_collected"
            ))
        except Exception as e:
            logger.debug(f"Drop old gtfsrt constraint: {e}")
        try:
            conn.execute(text(
                "ALTER TABLE gtfsrt_stop_times "
                "ADD CONSTRAINT uq_gtfsrt_trip_stop UNIQUE (trip_id, stop_id)"
            ))
        except Exception as e:
            logger.debug(f"Add uq_gtfsrt_trip_stop: {e}")
        # Add updated_at column if missing
        try:
            conn.execute(text(
                "ALTER TABLE gtfsrt_stop_times "
                "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ"
            ))
        except Exception as e:
            logger.debug(f"Add updated_at to gtfsrt_stop_times: {e}")

        # gtfsrt_vehicle_positions: add unique constraint and updated_at
        try:
            conn.execute(text(
                "ALTER TABLE gtfsrt_vehicle_positions "
                "ADD CONSTRAINT uq_gtfsrt_vehicle UNIQUE (vehicle_id)"
            ))
        except Exception as e:
            logger.debug(f"Add uq_gtfsrt_vehicle: {e}")
        try:
            conn.execute(text(
                "ALTER TABLE gtfsrt_vehicle_positions "
                "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ"
            ))
        except Exception as e:
            logger.debug(f"Add updated_at to gtfsrt_vehicle_positions: {e}")

        conn.commit()
    logger.info("GTFS-RT schema migration complete")


def ensure_indexes(engine=None):
    """Create optimized indexes for ML queries if they don't exist."""
    engine = engine or get_engine()
    if engine is None:
        return

    indexes = [
        "CREATE INDEX IF NOT EXISTS ix_gtfsrt_stop_times_trip_stop ON gtfsrt_stop_times (trip_id, stop_id)",
        "CREATE INDEX IF NOT EXISTS ix_gtfsrt_stop_times_collected ON gtfsrt_stop_times (collected_at)",
        "CREATE INDEX IF NOT EXISTS ix_gtfsrt_vp_vehicle ON gtfsrt_vehicle_positions (vehicle_id)",
        "CREATE INDEX IF NOT EXISTS ix_pred_outcomes_rt_stpid ON prediction_outcomes (rt, stpid)",
        "CREATE INDEX IF NOT EXISTS ix_pred_outcomes_created ON prediction_outcomes (created_at)",
        "CREATE INDEX IF NOT EXISTS ix_vehicle_obs_rt_collected ON vehicle_observations (rt, collected_at)",
        "CREATE INDEX IF NOT EXISTS ix_gtfs_stop_times_trip_stop ON gtfs_stop_times (trip_id, stop_id)",
        "CREATE INDEX IF NOT EXISTS ix_segment_route_from_dep ON segment_travel_times (route_id, from_stop_id, departure_time)",
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
    migrate_gtfsrt_schema(engine)
    enforce_retention_policy(engine)
    ensure_indexes(engine)
    logger.info("Database maintenance complete")


def emergency_truncate_gtfsrt(engine=None):
    """
    One-shot emergency cleanup: truncate GTFS-RT and segment tables that
    filled the database. Safe to run multiple times (idempotent).
    """
    engine = engine or get_engine()
    if engine is None:
        logger.error("DATABASE_URL not set")
        return
    with engine.connect() as conn:
        for table in ("gtfsrt_stop_times", "gtfsrt_vehicle_positions", "segment_travel_times"):
            try:
                conn.execute(text(f"TRUNCATE TABLE {table}"))
                logger.info(f"Emergency truncated: {table}")
            except Exception as e:
                logger.warning(f"Could not truncate {table}: {e}")
        conn.commit()
    logger.info("Emergency truncation complete")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    from dotenv import load_dotenv
    load_dotenv()
    run_full_maintenance()
