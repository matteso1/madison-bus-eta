from sqlalchemy import create_engine, text
import os
import datetime

# Public Railway URL
db_url = 'postgresql://postgres:sDsIVEajwHNPJWnguwDrJaaPKiPmoupq@caboose.proxy.rlwy.net:46555/railway'
engine = create_engine(db_url)

print(f"Checking data at {datetime.datetime.utcnow()} UTC...")
try:
    with engine.connect() as conn:
        print('Querying last 10 minutes...')
        result = conn.execute(text("""
            SELECT 
                DATE_TRUNC('minute', collected_at) as minute,
                COUNT(*) as records
            FROM vehicle_observations
            WHERE collected_at > NOW() - INTERVAL '10 minutes'
            GROUP BY minute
            ORDER BY minute DESC
        """)).fetchall()
        
        if not result:
            print("No records found in the last 10 minutes.")
        else:
            print("\nRecords per minute:")
            for row in result:
                print(f"  {row[0]}: {row[1]} records")
                
            latest_count = result[0][1]
            if latest_count < 100:
                 print(f"\n✅ SUCCESS: Rate is {latest_count}/min (Normal is ~30/min)")
            else:
                 print(f"\n⚠️ WARNING: Rate is still high ({latest_count}/min)")

except Exception as e:
    print(f"Error: {e}")
