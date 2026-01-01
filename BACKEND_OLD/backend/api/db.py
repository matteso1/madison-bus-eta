import duckdb
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Calculate project root path
# This file is in backend/api/db.py
# .parent = backend/api
# .parent.parent = backend
# .parent.parent.parent = madison-bus-eta (root)
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DB_PATH = str(BASE_DIR / "madison_metro.duckdb")

def get_db_connection():
    """
    Returns a DuckDB connection.
    """
    try:
        # Connect to database (allow writes for data collection)
        conn = duckdb.connect(DB_PATH, read_only=False)
        return conn
    except Exception as e:
        logger.error(f"Failed to connect to database at {DB_PATH}: {e}")
        raise e
