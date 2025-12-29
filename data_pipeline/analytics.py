import duckdb
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def create_analytics_tables():
    """
    Creates derived analytical tables in DuckDB.
    """
    db_path = "madison_metro.duckdb"
    conn = duckdb.connect(db_path)
    
    try:
        # 1. On-Time Performance (OTP)
        # We'll assume 'dly' field in predictions indicates a delay (True/False)
        # If 'dly' is not present or always false, we might need another proxy, but let's try this.
        logger.info("Calculating On-Time Performance...")
        conn.execute("DROP TABLE IF EXISTS analytics_otp_daily")
        conn.execute("""
            CREATE TABLE analytics_otp_daily AS
            SELECT 
                strftime(strptime(tmstmp, '%Y%m%d %H:%M'), '%Y-%m-%d') as date,
                rt as route,
                COUNT(*) as total_predictions,
                SUM(CASE WHEN dly = 'true' OR dly = 1 THEN 1 ELSE 0 END) as delayed_count,
                1.0 - (SUM(CASE WHEN dly = 'true' OR dly = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*)) as otp_score
            FROM raw_predictions
            GROUP BY 1, 2
        """)
        
        # 2. Bus Bunching Events
        # Identify when 2+ buses of same route/dir are observed at same timestamp
        # This is a simplified heuristic: if we see >1 distinct vehicle IDs for same route/dir at same minute
        logger.info("Identifying Bunching Events...")
        conn.execute("DROP TABLE IF EXISTS analytics_bunching")
        
        # First, normalize timestamps to minute precision
        conn.execute("""
            CREATE TEMP TABLE vehicle_minutes AS
            SELECT 
                strftime(strptime(tmstmp, '%Y%m%d %H:%M'), '%Y-%m-%d %H:%M:00') as minute_ts,
                rt,
                des as rtdir,
                vid,
                lat,
                lon
            FROM vehicles
            WHERE des IS NOT NULL
        """)
        
        # Find minutes where multiple vehicles exist for same route/dir
        conn.execute("""
            CREATE TABLE analytics_bunching AS
            SELECT 
                minute_ts,
                rt,
                rtdir,
                COUNT(DISTINCT vid) as bus_count,
                LIST(vid) as vehicle_ids,
                -- Calculate max distance between them would be better, but count > 1 is a good start for "potential bunching"
                -- For a portfolio, we can refine this to "headway < 3 min" if we had stop arrival times.
                -- For now, "concurrent active buses" is a proxy for high frequency/potential bunching.
                'Potential Bunching' as event_type
            FROM vehicle_minutes
            GROUP BY 1, 2, 3
            HAVING COUNT(DISTINCT vid) > 1
        """)
        
        # 3. Route Speed / Travel Time (Proxy)
        # Calculate average speed per route based on consecutive points
        logger.info("Calculating Route Speeds...")
        conn.execute("DROP TABLE IF EXISTS analytics_route_speeds")
        
        # Use lag to find distance/time between updates for same vehicle
        conn.execute("""
            CREATE TABLE analytics_route_speeds AS
            WITH lags AS (
                SELECT 
                    vid,
                    rt,
                    tmstmp,
                    lat,
                    lon,
                    LAG(lat) OVER (PARTITION BY vid ORDER BY tmstmp) as prev_lat,
                    LAG(lon) OVER (PARTITION BY vid ORDER BY tmstmp) as prev_lon,
                    LAG(strptime(tmstmp, '%Y%m%d %H:%M')) OVER (PARTITION BY vid ORDER BY tmstmp) as prev_ts,
                    strptime(tmstmp, '%Y%m%d %H:%M') as curr_ts
                FROM vehicles
            )
            SELECT 
                rt,
                strftime(curr_ts, '%H') as hour_of_day,
                AVG(
                    -- Haversine-ish approximation or just Euclidean for speed proxy
                    -- 1 deg lat ~ 111km. 
                    SQRT(POW(lat - prev_lat, 2) + POW(lon - prev_lon, 2)) * 111000 / 
                    NULLIF(date_diff('second', prev_ts, curr_ts), 0)
                ) * 3.6 as avg_speed_kmh -- m/s to km/h
            FROM lags
            WHERE prev_lat IS NOT NULL 
              AND date_diff('second', prev_ts, curr_ts) BETWEEN 30 AND 300 -- Filter reasonable gaps
            GROUP BY 1, 2
        """)

        # Verify
        otp_count = conn.execute("SELECT COUNT(*) FROM analytics_otp_daily").fetchone()[0]
        bunching_count = conn.execute("SELECT COUNT(*) FROM analytics_bunching").fetchone()[0]
        speed_count = conn.execute("SELECT COUNT(*) FROM analytics_route_speeds").fetchone()[0]
        
        logger.info(f"Created analytics tables: OTP ({otp_count} rows), Bunching ({bunching_count} rows), Speeds ({speed_count} rows)")

    except Exception as e:
        logger.error(f"Error creating analytics: {e}")
    
    conn.close()

if __name__ == "__main__":
    create_analytics_tables()
