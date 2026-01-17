"""
Deep Analysis of ML Model Performance Issues

This script investigates why the model has:
- R² = 0.079 (extremely low)
- MAPE = 22.5% (high)
- MAE = 152.5s (2.5 minutes average error)

We'll examine:
1. Data quality and distribution
2. Feature-target relationships
3. Whether the prediction problem is fundamentally solvable
"""

import os
from pathlib import Path

# Load .env from project root
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from datetime import datetime, timezone, timedelta

def analyze_data_quality():
    """Comprehensive data quality analysis."""
    
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        print("ERROR: DATABASE_URL not set")
        return
    
    engine = create_engine(database_url, pool_pre_ping=True)
    
    print("=" * 70)
    print("ML MODEL PERFORMANCE INVESTIGATION")
    print("=" * 70)
    
    with engine.connect() as conn:
        # 1. Basic stats on prediction_outcomes
        print("\n### 1. PREDICTION OUTCOMES DATA OVERVIEW ###")
        
        stats = conn.execute(text("""
            SELECT 
                COUNT(*) as total_records,
                COUNT(DISTINCT rt) as unique_routes,
                COUNT(DISTINCT vid) as unique_vehicles,
                COUNT(DISTINCT stpid) as unique_stops,
                MIN(created_at) as first_record,
                MAX(created_at) as last_record,
                AVG(error_seconds) as avg_error,
                STDDEV(error_seconds) as stddev_error,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY error_seconds) as median_error,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ABS(error_seconds)) as p95_abs_error
            FROM prediction_outcomes
        """)).fetchone()
        
        print(f"Total records: {stats[0]:,}")
        print(f"Unique routes: {stats[1]}")
        print(f"Unique vehicles: {stats[2]}")
        print(f"Unique stops: {stats[3]}")
        print(f"Date range: {stats[4]} to {stats[5]}")
        print(f"Avg error: {stats[6]:.1f}s ({stats[6]/60:.2f} min)")
        print(f"Std deviation: {stats[7]:.1f}s")
        print(f"Median error: {stats[8]:.1f}s")
        print(f"95th percentile (abs): {stats[9]:.1f}s")
        
        # 2. Error distribution analysis
        print("\n### 2. ERROR DISTRIBUTION ANALYSIS ###")
        
        error_dist = conn.execute(text("""
            SELECT 
                CASE 
                    WHEN error_seconds < -300 THEN 'Very Early (>5min early)'
                    WHEN error_seconds < -60 THEN 'Early (1-5min early)'
                    WHEN error_seconds < 60 THEN 'On Time (within 1min)'
                    WHEN error_seconds < 300 THEN 'Late (1-5min late)'
                    ELSE 'Very Late (>5min late)'
                END as category,
                COUNT(*) as count,
                ROUND(COUNT(*)::numeric * 100 / SUM(COUNT(*)) OVER (), 1) as pct
            FROM prediction_outcomes
            GROUP BY 1
            ORDER BY 
                MIN(CASE 
                    WHEN error_seconds < -300 THEN 1
                    WHEN error_seconds < -60 THEN 2
                    WHEN error_seconds < 60 THEN 3
                    WHEN error_seconds < 300 THEN 4
                    ELSE 5
                END)
        """)).fetchall()
        
        for row in error_dist:
            print(f"  {row[0]}: {row[1]:,} ({row[2]}%)")
        
        # 3. Check for data quality issues
        print("\n### 3. DATA QUALITY CHECKS ###")
        
        quality = conn.execute(text("""
            SELECT 
                COUNT(*) FILTER (WHERE error_seconds IS NULL) as null_errors,
                COUNT(*) FILTER (WHERE ABS(error_seconds) > 3600) as extreme_errors,
                COUNT(*) FILTER (WHERE predicted_arrival IS NULL) as null_predicted,
                COUNT(*) FILTER (WHERE actual_arrival IS NULL) as null_actual
            FROM prediction_outcomes
        """)).fetchone()
        
        print(f"Null error_seconds: {quality[0]}")
        print(f"Extreme errors (>1hr): {quality[1]}")
        print(f"Null predicted_arrival: {quality[2]}")
        print(f"Null actual_arrival: {quality[3]}")
        
        # 4. Temporal pattern analysis
        print("\n### 4. TEMPORAL PATTERNS ###")
        
        hourly = conn.execute(text("""
            SELECT 
                EXTRACT(hour FROM predicted_arrival) as hour,
                COUNT(*) as samples,
                AVG(ABS(error_seconds)) as avg_abs_error,
                STDDEV(error_seconds) as stddev
            FROM prediction_outcomes
            GROUP BY 1
            ORDER BY 1
        """)).fetchall()
        
        print("Hour | Samples | Avg Abs Error | Std Dev")
        print("-" * 45)
        for row in hourly:
            if row[0] is not None:
                print(f"  {int(row[0]):02d}  | {row[1]:>6} | {row[2]:>7.1f}s   | {row[3]:.1f}s" if row[3] else f"  {int(row[0]):02d}  | {row[1]:>6} | {row[2]:>7.1f}s   | N/A")
        
        # 5. Route-level variability
        print("\n### 5. ROUTE-LEVEL ERROR VARIABILITY ###")
        
        routes = conn.execute(text("""
            SELECT 
                rt,
                COUNT(*) as samples,
                AVG(error_seconds) as avg_error,
                STDDEV(error_seconds) as stddev,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY error_seconds) as median
            FROM prediction_outcomes
            WHERE rt IS NOT NULL
            GROUP BY rt
            HAVING COUNT(*) > 100
            ORDER BY STDDEV(error_seconds) DESC NULLS LAST
            LIMIT 10
        """)).fetchall()
        
        print("Most Variable Routes (High Std Dev = Hard to Predict):")
        print("Route | Samples | Avg Error | Std Dev | Median")
        print("-" * 55)
        for row in routes:
            if row[3]:
                print(f"  {row[0]:>5} | {row[1]:>6} | {row[2]:>7.1f}s | {row[3]:>7.1f}s | {row[4]:.1f}s")
        
        # 6. Check prediction horizon (how far ahead are we predicting?)
        print("\n### 6. PREDICTION HORIZON ANALYSIS ###")
        
        # Check if we have predictions table to join
        has_predictions = conn.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'predictions'
            )
        """)).scalar()
        
        if has_predictions:
            horizon = conn.execute(text("""
                SELECT 
                    CASE 
                        WHEN p.prdctdn <= 2 THEN '0-2 min'
                        WHEN p.prdctdn <= 5 THEN '2-5 min'
                        WHEN p.prdctdn <= 10 THEN '5-10 min'
                        WHEN p.prdctdn <= 20 THEN '10-20 min'
                        ELSE '20+ min'
                    END as horizon,
                    COUNT(*) as samples,
                    AVG(ABS(po.error_seconds)) as avg_abs_error
                FROM prediction_outcomes po
                JOIN predictions p ON po.prediction_id = p.id
                WHERE po.created_at > NOW() - INTERVAL '7 days'
                GROUP BY 1
                ORDER BY 
                    CASE horizon
                        WHEN '0-2 min' THEN 1
                        WHEN '2-5 min' THEN 2
                        WHEN '5-10 min' THEN 3
                        WHEN '10-20 min' THEN 4
                        ELSE 5
                    END
            """)).fetchall()
            
            print("Prediction Horizon | Samples | Avg Abs Error")
            print("-" * 45)
            for row in horizon:
                print(f"  {row[0]:>12} | {row[1]:>7} | {row[2]:.1f}s")
        else:
            print("Predictions table not found - cannot analyze horizon")
        
        # 7. CRITICAL: Variance explained analysis
        print("\n### 7. FUNDAMENTAL PREDICTABILITY ANALYSIS ###")
        
        # Calculate total variance vs within-group variance
        variance = conn.execute(text("""
            WITH route_stats AS (
                SELECT 
                    rt,
                    AVG(error_seconds) as route_mean,
                    COUNT(*) as n
                FROM prediction_outcomes
                WHERE rt IS NOT NULL
                GROUP BY rt
            ),
            global_stats AS (
                SELECT 
                    AVG(error_seconds) as global_mean,
                    VARIANCE(error_seconds) as total_variance
                FROM prediction_outcomes
            ),
            between_variance AS (
                SELECT 
                    SUM(n * POWER(route_mean - (SELECT global_mean FROM global_stats), 2)) / 
                    SUM(n) as between_group_var
                FROM route_stats
            )
            SELECT 
                (SELECT total_variance FROM global_stats) as total_var,
                (SELECT between_group_var FROM between_variance) as between_var
        """)).fetchone()
        
        if variance[0] and variance[1]:
            total_var = float(variance[0])
            between_var = float(variance[1])
            within_var = total_var - between_var
            
            print(f"Total error variance: {total_var:.0f}")
            print(f"Between-route variance: {between_var:.0f} ({between_var/total_var*100:.1f}%)")
            print(f"Within-route variance: {within_var:.0f} ({within_var/total_var*100:.1f}%)")
            print("\n⚠️ If within-route variance is high, routes alone cannot predict errors well.")
        
        print("\n" + "=" * 70)
        print("DIAGNOSIS SUMMARY")
        print("=" * 70)

if __name__ == "__main__":
    analyze_data_quality()
