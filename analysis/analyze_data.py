"""
Data Analysis Script for Madison Metro Bus ETA

Analyzes the collected vehicle observations to understand:
- Data distribution by route
- Collection patterns
- Storage usage estimates
- Recommendations for optimization
"""

import os
import sys
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set. Add it to .env file.")
    print("Example: DATABASE_URL=postgresql://user:pass@host:5432/dbname")
    sys.exit(1)

from sqlalchemy import create_engine, text

engine = create_engine(DATABASE_URL.replace('postgres://', 'postgresql://'))

def run_query(sql):
    """Execute SQL and return results."""
    with engine.connect() as conn:
        result = conn.execute(text(sql))
        return result.fetchall()

def format_number(n):
    """Format large numbers with commas."""
    return f"{n:,}"

print("=" * 60)
print("MADISON METRO BUS ETA - DATA ANALYSIS")
print("=" * 60)
print()

# 1. Total Records
print("📊 TOTAL RECORDS")
print("-" * 40)
try:
    vehicles = run_query("SELECT COUNT(*) FROM vehicle_observations")[0][0]
    predictions = run_query("SELECT COUNT(*) FROM predictions")[0][0]
    print(f"  Vehicle Observations: {format_number(vehicles)}")
    print(f"  Predictions:          {format_number(predictions)}")
    print()
except Exception as e:
    print(f"  Error: {e}")

# 2. Database Size
print("💾 DATABASE SIZE ESTIMATE")
print("-" * 40)
try:
    # Estimate based on row count (roughly 200 bytes per row)
    est_size_mb = (vehicles * 200) / (1024 * 1024)
    print(f"  Estimated Size: {est_size_mb:.1f} MB")
    print(f"  Railway Free: 1 GB (you're at ~{est_size_mb/1024*100:.1f}% capacity)")
    print()
except Exception as e:
    print(f"  Error: {e}")

# 3. Time Range
print("🕐 COLLECTION TIMELINE")
print("-" * 40)
try:
    timeline = run_query("""
        SELECT 
            MIN(collected_at) as first,
            MAX(collected_at) as last,
            EXTRACT(EPOCH FROM (MAX(collected_at) - MIN(collected_at)))/3600 as hours
        FROM vehicle_observations
    """)[0]
    print(f"  First Record: {timeline[0]}")
    print(f"  Last Record:  {timeline[1]}")
    print(f"  Duration:     {timeline[2]:.1f} hours")
    if timeline[2] > 0:
        rate_per_hour = vehicles / timeline[2]
        rate_per_min = rate_per_hour / 60
        print(f"  Avg Rate:     {rate_per_hour:,.0f}/hour ({rate_per_min:,.0f}/min)")
    print()
except Exception as e:
    print(f"  Error: {e}")

# 4. Per-Route Breakdown
print("🚌 RECORDS BY ROUTE")
print("-" * 40)
try:
    routes = run_query("""
        SELECT rt, COUNT(*) as cnt 
        FROM vehicle_observations 
        GROUP BY rt 
        ORDER BY cnt DESC
    """)
    for route, count in routes[:15]:  # Top 15
        pct = count / vehicles * 100
        bar = "█" * int(pct / 2)
        print(f"  {route:>3}: {format_number(count):>10} ({pct:4.1f}%) {bar}")
    if len(routes) > 15:
        print(f"  ... and {len(routes) - 15} more routes")
    print()
except Exception as e:
    print(f"  Error: {e}")

# 5. Delay Statistics
print("⚠️ DELAY STATISTICS")
print("-" * 40)
try:
    delays = run_query("""
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN dly = true THEN 1 ELSE 0 END) as delayed
        FROM vehicle_observations
    """)[0]
    total, delayed = delays
    delay_pct = (delayed / total * 100) if total > 0 else 0
    print(f"  Total Observations: {format_number(total)}")
    print(f"  Delayed:           {format_number(delayed)} ({delay_pct:.2f}%)")
    print()
except Exception as e:
    print(f"  Error: {e}")

# 6. Collection Rate by Hour
print("📈 COLLECTION RATE BY HOUR (Last 24h)")
print("-" * 40)
try:
    hourly = run_query("""
        SELECT 
            DATE_TRUNC('hour', collected_at) as hour,
            COUNT(*) as cnt
        FROM vehicle_observations
        WHERE collected_at > NOW() - INTERVAL '24 hours'
        GROUP BY DATE_TRUNC('hour', collected_at)
        ORDER BY hour DESC
        LIMIT 12
    """)
    for hour, count in hourly:
        print(f"  {hour}: {format_number(count)}")
    print()
except Exception as e:
    print(f"  Error: {e}")

# 7. Unique Vehicles per Route
print("🚍 UNIQUE VEHICLES BY ROUTE")
print("-" * 40)
try:
    unique_vehicles = run_query("""
        SELECT rt, COUNT(DISTINCT vid) as unique_vehicles
        FROM vehicle_observations
        GROUP BY rt
        ORDER BY unique_vehicles DESC
    """)
    for route, count in unique_vehicles[:10]:
        print(f"  Route {route:>3}: {count} unique vehicles")
    print()
except Exception as e:
    print(f"  Error: {e}")

# 8. Recommendations
print("💡 RECOMMENDATIONS")
print("-" * 40)
if vehicles > 3_000_000:
    print("  ⚠️  High record count - consider:")
    print("     - Increasing collection interval to 60s or 120s")
    print("     - Adding data retention (delete records > 7 days old)")
    print("     - Only storing aggregated data instead of raw")
else:
    print("  ✅ Data volume looks reasonable")

print()
print("=" * 60)
print("Analysis complete!")
