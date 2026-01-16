"""
ML Pipeline Performance Analysis
Analyzes Railway Postgres to determine if the ML pipeline is working effectively.
"""

import os
from sqlalchemy import create_engine, text
from datetime import datetime
import json

# Railway Public URL
DATABASE_URL = "postgresql://postgres:sDsIVEajwHNPJWnguwDrJaaPKiPmoupq@caboose.proxy.rlwy.net:46555/railway"

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

def run_query(sql):
    with engine.connect() as conn:
        result = conn.execute(text(sql))
        return result.fetchall()

def fmt(n):
    return f"{n:,}" if isinstance(n, int) else str(n)

print("=" * 70)
print("MADISON METRO ML PIPELINE - PERFORMANCE ANALYSIS")
print("=" * 70)
print(f"Analysis Time: {datetime.now()}")
print()

# 1. Database Tables Overview
print("📊 DATABASE TABLES")
print("-" * 50)
tables = run_query("""
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name
""")
for t in tables:
    count = run_query(f"SELECT COUNT(*) FROM {t[0]}")[0][0]
    print(f"  {t[0]:<30} {fmt(count):>15} rows")
print()

# 2. ML Training Runs Analysis
print("🤖 ML TRAINING RUNS ANALYSIS")
print("-" * 50)
try:
    runs = run_query("""
        SELECT version, mae, rmse, mae_minutes, 
               improvement_vs_baseline_pct, samples_used, deployed, deployment_reason
        FROM ml_regression_runs
        ORDER BY version DESC
    """)
    print(f"  Total training runs: {len(runs)}")
    
    if runs:
        maes = [r[1] for r in runs if r[1]]
        print(f"  MAE Range: {min(maes):.1f}s - {max(maes):.1f}s")
        print(f"  Average MAE: {sum(maes)/len(maes):.1f}s ({sum(maes)/len(maes)/60:.2f} min)")
        
        deployed_count = sum(1 for r in runs if r[6])
        print(f"  Models deployed: {deployed_count}/{len(runs)} ({deployed_count/len(runs)*100:.0f}%)")
        
        print("\n  Latest 5 Training Runs:")
        print(f"  {'Version':<18} {'MAE':<10} {'RMSE':<10} {'vs Baseline':<12} {'Samples':<10} {'Status'}")
        print("  " + "-" * 70)
        for r in runs[:5]:
            baseline = f"{r[4]:+.1f}%" if r[4] else "N/A"
            status = "✅ Deployed" if r[6] else "❌ Skipped"
            print(f"  {r[0]:<18} {r[1]:.0f}s{'':<5} {r[2]:.0f}s{'':<5} {baseline:<12} {fmt(r[5]):<10} {status}")
except Exception as e:
    print(f"  Error: {e}")
print()

# 3. Check prediction_outcomes table
print("🎯 PREDICTION OUTCOMES ANALYSIS")
print("-" * 50)
try:
    outcomes_count = run_query("SELECT COUNT(*) FROM prediction_outcomes")[0][0]
    print(f"  Total prediction outcomes: {fmt(outcomes_count)}")
    
    if outcomes_count > 0:
        # Get sample data to understand structure
        sample = run_query("SELECT * FROM prediction_outcomes LIMIT 1")
        cols = run_query("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'prediction_outcomes'
        """)
        print("  Columns:", [c[0] for c in cols])
        
        # Actual accuracy analysis
        accuracy = run_query("""
            SELECT 
                COUNT(*) as total,
                AVG(ABS(ml_prediction - actual_seconds)) as avg_ml_error,
                AVG(ABS(api_prediction - actual_seconds)) as avg_api_error,
                AVG(CASE WHEN ABS(ml_prediction - actual_seconds) < ABS(api_prediction - actual_seconds) THEN 1 ELSE 0 END) * 100 as ml_win_rate
            FROM prediction_outcomes
            WHERE actual_seconds IS NOT NULL
        """)
        if accuracy[0][0]:
            print(f"\n  📈 ACTUAL PREDICTION ACCURACY:")
            print(f"     Predictions evaluated: {fmt(accuracy[0][0])}")
            print(f"     Avg ML Error:          {accuracy[0][1]:.1f}s ({accuracy[0][1]/60:.2f} min)")
            print(f"     Avg API Error:         {accuracy[0][2]:.1f}s ({accuracy[0][2]/60:.2f} min)")
            print(f"     ML Win Rate:           {accuracy[0][3]:.1f}%")
            
            if accuracy[0][1] < accuracy[0][2]:
                improvement = (1 - accuracy[0][1]/accuracy[0][2]) * 100
                print(f"     🎉 ML is {improvement:.1f}% better than API!")
            else:
                degradation = (accuracy[0][1]/accuracy[0][2] - 1) * 100
                print(f"     ⚠️ ML is {degradation:.1f}% worse than API")
except Exception as e:
    print(f"  Error querying prediction_outcomes: {e}")
print()

# 4. Vehicle Observations Analysis
print("🚌 DATA COLLECTION ANALYSIS")
print("-" * 50)
try:
    obs = run_query("""
        SELECT 
            COUNT(*) as total,
            COUNT(DISTINCT rt) as routes,
            COUNT(DISTINCT vid) as vehicles,
            MIN(collected_at) as first,
            MAX(collected_at) as last
        FROM vehicle_observations
    """)[0]
    print(f"  Total observations: {fmt(obs[0])}")
    print(f"  Unique routes: {obs[1]}")
    print(f"  Unique vehicles: {obs[2]}")
    print(f"  First collection: {obs[3]}")
    print(f"  Last collection: {obs[4]}")
    
    # Collection rate
    hours = run_query("""
        SELECT EXTRACT(EPOCH FROM (MAX(collected_at) - MIN(collected_at)))/3600 
        FROM vehicle_observations
    """)[0][0]
    if hours and hours > 0:
        print(f"  Collection period: {hours:.1f} hours")
        print(f"  Avg rate: {obs[0]/hours:,.0f} records/hour")
except Exception as e:
    print(f"  Error: {e}")
print()

# 5. Route Performance (if prediction_outcomes available)
print("📊 ROUTE-LEVEL PERFORMANCE")
print("-" * 50)
try:
    route_perf = run_query("""
        SELECT rt, 
               COUNT(*) as cnt,
               AVG(ABS(ml_prediction - actual_seconds)) as avg_ml_error,
               AVG(ABS(api_prediction - actual_seconds)) as avg_api_error
        FROM prediction_outcomes
        WHERE actual_seconds IS NOT NULL AND rt IS NOT NULL
        GROUP BY rt
        ORDER BY cnt DESC
        LIMIT 10
    """)
    if route_perf:
        print(f"  {'Route':<8} {'Count':<10} {'ML Error':<12} {'API Error':<12} {'Winner'}")
        print("  " + "-" * 55)
        for r in route_perf:
            ml_err = r[2] if r[2] else 0
            api_err = r[3] if r[3] else 0
            winner = "ML ✅" if ml_err < api_err else "API ⚠️"
            print(f"  {r[0]:<8} {fmt(r[1]):<10} {ml_err:.0f}s{'':<7} {api_err:.0f}s{'':<7} {winner}")
    else:
        print("  No route-level data available")
except Exception as e:
    print(f"  Error: {e}")
print()

# 6. Hourly Performance
print("⏰ HOURLY PERFORMANCE")
print("-" * 50)
try:
    hourly = run_query("""
        SELECT EXTRACT(HOUR FROM collected_at) as hour,
               COUNT(*) as cnt,
               AVG(ABS(ml_prediction - actual_seconds)) as avg_ml_error
        FROM prediction_outcomes
        WHERE actual_seconds IS NOT NULL
        GROUP BY EXTRACT(HOUR FROM collected_at)
        ORDER BY hour
    """)
    if hourly:
        print(f"  {'Hour':<6} {'Count':<10} {'ML Error':<12} {'Visual'}")
        print("  " + "-" * 50)
        for h in hourly:
            bar = "█" * int((h[2] or 0) / 10)
            print(f"  {int(h[0]):02d}:00  {fmt(h[1]):<10} {h[2]:.0f}s{'':<7} {bar}")
    else:
        print("  No hourly data available")
except Exception as e:
    print(f"  Error: {e}")
print()

# Summary
print("=" * 70)
print("SUMMARY & RECOMMENDATIONS")
print("=" * 70)
print("""
Based on the analysis above, here are key insights:

1. DATA COLLECTION: Check if data is flowing continuously
2. MODEL TRAINING: Are models improving over time?
3. PREDICTION ACCURACY: Is ML actually better than API baseline?
4. ROUTE COVERAGE: Are all routes being served well?
""")
