import os
import json
import logging
import threading
import time
from dotenv import load_dotenv
from sentinel_client import SentinelClient
from db import save_vehicles_to_db, save_predictions_to_db, get_db_engine

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

def consume_vehicles(client: SentinelClient):
    logger.info("Started consuming topic: madison-metro-vehicles")
    
    # Simple offset tracking (in-memory for demo)
    current_offset = 0 
    
    stream = client.consume('madison-metro-vehicles', partition=0, offset=current_offset)
    if not stream:
        logger.error("Failed to get vehicle stream")
        return

    for record in stream:
        try:
            # Parse message
            payload = json.loads(record.value.decode('utf-8'))
            vehicles = payload.get('vehicles', [])
            
            if vehicles:
                count = save_vehicles_to_db(vehicles)
                logger.info(f"[Vehicles] Offset {record.offset}: Saved {count} observations")
            
            current_offset = record.offset + 1
            
        except Exception as e:
            logger.error(f"[Vehicles] Error processing record {record.offset}: {e}")

def consume_predictions(client: SentinelClient):
    logger.info("Started consuming topic: madison-metro-predictions")
    
    current_offset = 0
    stream = client.consume('madison-metro-predictions', partition=0, offset=current_offset)
    if not stream:
        logger.error("Failed to get prediction stream")
        return

    for record in stream:
        try:
            payload = json.loads(record.value.decode('utf-8'))
            predictions = payload.get('predictions', [])
            
            if predictions:
                count = save_predictions_to_db(predictions)
                logger.info(f"[Predictions] Offset {record.offset}: Saved {count} predictions")
                
            current_offset = record.offset + 1
            
        except Exception as e:
            logger.error(f"[Predictions] Error processing record {record.offset}: {e}")

def main():
    logger.info("="*50)
    logger.info("MADISON METRO SENTINEL CONSUMER")
    logger.info("="*50)
    
    # Verify DB connection
    if not get_db_engine():
        logger.error("Database connection failed. Check DATABASE_URL.")
        return

    # Create clients (one per thread is safer for gRPC usually, or one shared channel)
    # Using separate clients for simplicity
    client_v = SentinelClient(host=SENTINEL_HOST, port=SENTINEL_PORT)
    client_p = SentinelClient(host=SENTINEL_HOST, port=SENTINEL_PORT)

    # Start threads
    t1 = threading.Thread(target=consume_vehicles, args=(client_v,), daemon=True)
    t2 = threading.Thread(target=consume_predictions, args=(client_p,), daemon=True)

    t1.start()
    t2.start()

    try:
        while True:
            time.sleep(1)
            # Basic vitality check
            if not t1.is_alive():
                logger.warning("Vehicle consumer thread died! Restarting...")
                client_v = SentinelClient(host=SENTINEL_HOST, port=SENTINEL_PORT)
                t1 = threading.Thread(target=consume_vehicles, args=(client_v,), daemon=True)
                t1.start()
            if not t2.is_alive():
                logger.warning("Prediction consumer thread died! Restarting...")
                client_p = SentinelClient(host=SENTINEL_HOST, port=SENTINEL_PORT)
                t2 = threading.Thread(target=consume_predictions, args=(client_p,), daemon=True)
                t2.start()
                
    except KeyboardInterrupt:
        logger.info("Shutting down...")

if __name__ == "__main__":
    main()
