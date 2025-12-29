import duckdb
import glob
import os
import logging
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def ingest_data():
    """
    Ingests vehicle and prediction CSVs into a DuckDB database.
    """
    db_path = "madison_metro.duckdb"
    conn = duckdb.connect(db_path)
    
    # Define paths
    base_dir = Path("backend/collected_data")
    vehicle_files = sorted(glob.glob(str(base_dir / "vehicles_*.csv")))
    prediction_files = sorted(glob.glob(str(base_dir / "predictions_*.csv")))
    
    logger.info(f"Found {len(vehicle_files)} vehicle files and {len(prediction_files)} prediction files.")
    
    if not vehicle_files and not prediction_files:
        logger.warning("No data files found to ingest.")
        return

    # Ingest Vehicles
    if vehicle_files:
        logger.info("Ingesting vehicle data...")
        # Create table if not exists, inferring schema from the first file
        # We use read_csv_auto to handle potential schema evolution or minor differences
        try:
            # Drop table if exists to start fresh (or we could append, but for this portfolio piece, fresh is cleaner)
            conn.execute("DROP TABLE IF EXISTS raw_vehicles")
            
            # DuckDB can read multiple files at once using a glob pattern
            vehicle_glob = str(base_dir / "vehicles_*.csv")
            conn.execute(f"""
                CREATE TABLE raw_vehicles AS 
                SELECT * FROM read_csv_auto('{vehicle_glob}', filename=True, union_by_name=True)
            """)
            
            row_count = conn.execute("SELECT COUNT(*) FROM raw_vehicles").fetchone()[0]
            logger.info(f"Successfully ingested {row_count} vehicle records.")
            
        except Exception as e:
            logger.error(f"Error ingesting vehicles: {e}")

    # Ingest Predictions
    if prediction_files:
        logger.info("Ingesting prediction data...")
        try:
            conn.execute("DROP TABLE IF EXISTS raw_predictions")
            
            prediction_glob = str(base_dir / "predictions_*.csv")
            conn.execute(f"""
                CREATE TABLE raw_predictions AS 
                SELECT * FROM read_csv_auto('{prediction_glob}', filename=True, union_by_name=True)
            """)
            
            row_count = conn.execute("SELECT COUNT(*) FROM raw_predictions").fetchone()[0]
            logger.info(f"Successfully ingested {row_count} prediction records.")
            
        except Exception as e:
            logger.error(f"Error ingesting predictions: {e}")

    # Basic Data Quality Checks & Cleanup
    logger.info("Performing basic cleanup...")
    
    # Deduplicate vehicles based on vehicle_id and timestamp
    # Assuming 'vid' is vehicle id and 'tmstmp' is timestamp
    try:
        conn.execute("DROP TABLE IF EXISTS vehicles")
        conn.execute("""
            CREATE TABLE vehicles AS
            SELECT DISTINCT * EXCLUDE (filename)
            FROM raw_vehicles
        """)
        final_vehicle_count = conn.execute("SELECT COUNT(*) FROM vehicles").fetchone()[0]
        logger.info(f"Cleaned vehicle records: {final_vehicle_count}")
        
        # Create index for faster querying
        conn.execute("CREATE INDEX idx_vehicles_tmstmp ON vehicles(tmstmp)")
        conn.execute("CREATE INDEX idx_vehicles_rt ON vehicles(rt)")
        
    except Exception as e:
        logger.error(f"Error cleaning vehicles: {e}")

    conn.close()
    logger.info("Ingestion complete.")

if __name__ == "__main__":
    ingest_data()
