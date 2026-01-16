import os
from sqlalchemy import create_engine, text
import json

# Force load .env if needed (assuming env vars are set in terminal)
database_url = os.getenv('DATABASE_URL')
if not database_url:
    print("Error: DATABASE_URL not set")
    exit(1)

engine = create_engine(database_url)

query = text("""
    WITH metrics AS (
        SELECT 
            po.error_seconds,
            ABS(po.error_seconds) as abs_error,
            p.prdctdn * 60 as horizon_seconds,
            (p.prdctdn * 60) - po.error_seconds as actual_duration_approx 
        FROM prediction_outcomes po
        JOIN predictions p ON po.prediction_id = p.id
        WHERE po.created_at > NOW() - INTERVAL '24 hours'
        AND p.prdctdn > 2 -- Filter out nearly arrived buses (noise)
    ),
    stats AS (
        SELECT 
            AVG(abs_error) as mae,
            AVG(CASE WHEN horizon_seconds > 0 THEN abs_error / horizon_seconds ELSE 0 END) as mape,
            STDDEV(error_seconds) as std_dev,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY abs_error) as p95_error
        FROM metrics
    )
    SELECT 
        mae, 
        mape, 
        std_dev, 
        p95_error,
        (SELECT COUNT(*) FROM metrics) as sample_count
    FROM stats
""")

try:
    with engine.connect() as conn:
        print("Executing query...")
        row = conn.execute(query).fetchone()
        print("Success:", row)
except Exception as e:
    print("Query Failed!")
    print(e)
