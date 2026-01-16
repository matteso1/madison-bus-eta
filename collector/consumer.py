import os
import json
import logging
import threading
import time
from dotenv import load_dotenv
from sentinel_client import SentinelClient
from db import save_vehicles_to_db, save_predictions_to_db, get_db_engine
from sqlalchemy import text

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(name)s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("Consumer")

load_dotenv()

SENTINEL_HOST = os.getenv('SENTINEL_HOST', 'localhost')
SENTINEL_PORT = int(os.getenv('SENTINEL_PORT', '9092'))

# Global offset storage (persisted to DB)
_offsets = {}
_lock = threading.Lock()

def get_stored_offset(topic: str) -> int:
    """Get last processed offset from database."""
    engine = get_db_engine()
    if not engine:
        return 0
    
    try:
        with engine.connect() as conn:
            # Create table if not exists
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS consumer_offsets (
                    topic VARCHAR(255) PRIMARY KEY,
                    last_offset BIGINT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
            
            result = conn.execute(
                text("SELECT last_offset FROM consumer_offsets WHERE topic = :topic"),
                {"topic": topic}
            ).fetchone()
            
            if result:
                offset = result[0]
                logger.info(f"[{topic}] Resuming from stored offset: {offset}")
                return offset
            else:
                logger.info(f"[{topic}] No stored offset, starting from 0")
                return 0
    except Exception as e:
        logger.error(f"Error getting stored offset: {e}")
        return 0

def save_offset(topic: str, offset: int):
    """Save last processed offset to database."""
    engine = get_db_engine()
    if not engine:
        return
    
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO consumer_offsets (topic, last_offset, updated_at)
                VALUES (:topic, :offset, CURRENT_TIMESTAMP)
                ON CONFLICT (topic) 
                DO UPDATE SET last_offset = :offset, updated_at = CURRENT_TIMESTAMP
            """), {"topic": topic, "offset": offset})
            conn.commit()
    except Exception as e:
        logger.error(f"Error saving offset: {e}")

def consume_vehicles(client: SentinelClient):
    topic = 'madison-metro-vehicles'
    
    # Get stored offset (persist across restarts!)
    current_offset = get_stored_offset(topic)
    
    logger.info(f"Started consuming {topic} from offset {current_offset}")
    
    stream = client.consume(topic, partition=0, offset=current_offset)
    if not stream:
        logger.error("Failed to get vehicle stream")
        return

    batch_count = 0
    for record in stream:
        try:
            # Parse message
            payload = json.loads(record.value.decode('utf-8'))
            vehicles = payload.get('vehicles', [])
            
            if vehicles:
                count = save_vehicles_to_db(vehicles)
                logger.info(f"[Vehicles] Offset {record.offset}: Saved {count} observations")
            
            # Update offset after successful processing
            current_offset = record.offset + 1
            batch_count += 1
            
            # Save offset to DB every 10 records (not every record for performance)
            if batch_count % 10 == 0:
                save_offset(topic, current_offset)
            
        except Exception as e:
            logger.error(f"[Vehicles] Error processing record {record.offset}: {e}")
            # Still increment offset to avoid infinite loop on bad records
            current_offset = record.offset + 1
    
    # Save final offset when stream ends
    save_offset(topic, current_offset)

def consume_predictions(client: SentinelClient):
    topic = 'madison-metro-predictions'
    
    current_offset = get_stored_offset(topic)
    
    logger.info(f"Started consuming {topic} from offset {current_offset}")
    
    stream = client.consume(topic, partition=0, offset=current_offset)
    if not stream:
        logger.error("Failed to get prediction stream")
        return

    batch_count = 0
    for record in stream:
        try:
            payload = json.loads(record.value.decode('utf-8'))
            predictions = payload.get('predictions', [])
            
            if predictions:
                count = save_predictions_to_db(predictions)
                logger.info(f"[Predictions] Offset {record.offset}: Saved {count} predictions")
            
            current_offset = record.offset + 1
            batch_count += 1
            
            if batch_count % 10 == 0:
                save_offset(topic, current_offset)
                
        except Exception as e:
            logger.error(f"[Predictions] Error processing record {record.offset}: {e}")
            current_offset = record.offset + 1
    
    save_offset(topic, current_offset)

def main():
    logger.info("="*50)
    logger.info("MADISON METRO SENTINEL CONSUMER")
    logger.info("="*50)
    
    # Verify DB connection
    if not get_db_engine():
        logger.error("Database connection failed. Check DATABASE_URL.")
        return

    # Create clients
    client_v = SentinelClient(host=SENTINEL_HOST, port=SENTINEL_PORT)
    client_p = SentinelClient(host=SENTINEL_HOST, port=SENTINEL_PORT)

    # Start threads
    t1 = threading.Thread(target=consume_vehicles, args=(client_v,), daemon=True)
    t2 = threading.Thread(target=consume_predictions, args=(client_p,), daemon=True)

    t1.start()
    t2.start()

    try:
        while True:
            time.sleep(5)  # Reduced frequency of checking
            
            # Basic vitality check with longer delay to avoid rapid restarts
            if not t1.is_alive():
                logger.warning("Vehicle consumer thread died! Waiting 10s before restart...")
                time.sleep(10)
                client_v = SentinelClient(host=SENTINEL_HOST, port=SENTINEL_PORT)
                t1 = threading.Thread(target=consume_vehicles, args=(client_v,), daemon=True)
                t1.start()
                
            if not t2.is_alive():
                logger.warning("Prediction consumer thread died! Waiting 10s before restart...")
                time.sleep(10)
                client_p = SentinelClient(host=SENTINEL_HOST, port=SENTINEL_PORT)
                t2 = threading.Thread(target=consume_predictions, args=(client_p,), daemon=True)
                t2.start()
                
    except KeyboardInterrupt:
        logger.info("Shutting down...")

if __name__ == "__main__":
    main()
