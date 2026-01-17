"""
Simplified ML Analysis - Focus on Root Cause
"""

import os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text

database_url = os.getenv('DATABASE_URL')
if not database_url:
    print("ERROR: DATABASE_URL not set")
    exit(1)

engine = create_engine(database_url, pool_pre_ping=True)

print("=" * 70)
print("ML MODEL ROOT CAUSE ANALYSIS")
print("=" * 70)

with engine.connect() as conn:
    
    # Get raw data for analysis
    print("\n### PULLING RAW DATA ###")
    df = pd.read_sql(text("""
        SELECT 
            po.error_seconds,
            po.rt as route,
            EXTRACT(hour FROM po.predicted_arrival) as hour,
            EXTRACT(dow FROM po.predicted_arrival) as dow,
            po.created_at
        FROM prediction_outcomes po
        WHERE po.created_at > NOW() - INTERVAL '14 days'
    """), conn)
    
    print(f"Records: {len(df):,}")
    
    # Basic stats
    print("\n### ERROR STATISTICS ###")
    print(f"Mean error: {df['error_seconds'].mean():.1f}s ({df['error_seconds'].mean()/60:.2f} min)")
    print(f"Median error: {df['error_seconds'].median():.1f}s ({df['error_seconds'].median()/60:.2f} min)")
    print(f"Std deviation: {df['error_seconds'].std():.1f}s")
    print(f"Min: {df['error_seconds'].min():.0f}s, Max: {df['error_seconds'].max():.0f}s")
    
    # Percentiles
    print("\n### PERCENTILES (Absolute Error) ###")
    abs_error = df['error_seconds'].abs()
    for p in [50, 75, 90, 95, 99]:
        print(f"  {p}th percentile: {abs_error.quantile(p/100):.0f}s ({abs_error.quantile(p/100)/60:.1f} min)")
    
    # Distribution
    print("\n### ERROR BUCKETS ###")
    bins = [-np.inf, -300, -60, 60, 300, np.inf]
    labels = ['Very Early (>5m)', 'Early (1-5m)', 'On Time (±1m)', 'Late (1-5m)', 'Very Late (>5m)']
    df['bucket'] = pd.cut(df['error_seconds'], bins=bins, labels=labels)
    dist = df['bucket'].value_counts()
    for label in labels:
        count = dist.get(label, 0)
        pct = count / len(df) * 100
        print(f"  {label}: {count:,} ({pct:.1f}%)")
    
    # Check for systematic bias by route
    print("\n### ROUTE-LEVEL BIAS (Top 10 by sample size) ###")
    route_stats = df.groupby('route').agg({
        'error_seconds': ['count', 'mean', 'std', 'median']
    }).droplevel(0, axis=1)
    route_stats.columns = ['count', 'mean', 'std', 'median']
    route_stats = route_stats.sort_values('count', ascending=False).head(10)
    print(route_stats.to_string())
    
    # Check for hour-of-day patterns
    print("\n### HOUR-OF-DAY PATTERNS ###")
    hour_stats = df.groupby('hour').agg({
        'error_seconds': ['count', 'mean', 'std']
    }).droplevel(0, axis=1)
    hour_stats.columns = ['samples', 'mean_error', 'std']
    # Find problematic hours (high mean or std)
    worst_hours = hour_stats.sort_values('mean_error', ascending=False).head(5)
    print("Worst hours (highest mean error):")
    print(worst_hours.to_string())
    
    # KEY INSIGHT: What's the baseline?
    print("\n" + "=" * 70)
    print("KEY INSIGHTS")
    print("=" * 70)
    
    # If we just predict 0 (trust the API), what's our MAE?
    baseline_mae = abs_error.mean()
    print(f"\n1. BASELINE MAE (trusting API = predicting 0 error): {baseline_mae:.1f}s ({baseline_mae/60:.2f} min)")
    
    # If we predict the global mean error for everything
    mean_error = df['error_seconds'].mean()
    mae_global_mean = (df['error_seconds'] - mean_error).abs().mean()
    print(f"2. MAE if predicting global mean ({mean_error:.0f}s): {mae_global_mean:.1f}s")
    
    # If we predict route-specific mean
    route_means = df.groupby('route')['error_seconds'].mean()
    df['route_mean'] = df['route'].map(route_means)
    mae_route_mean = (df['error_seconds'] - df['route_mean']).abs().mean()
    print(f"3. MAE if predicting route-specific mean: {mae_route_mean:.1f}s")
    
    improvement = (baseline_mae - mae_route_mean) / baseline_mae * 100
    print(f"\n   Improvement from route-specific mean: {improvement:.1f}%")
    
    # THEORETICAL R² if we just use route means
    ss_tot = ((df['error_seconds'] - df['error_seconds'].mean())**2).sum()
    ss_res = ((df['error_seconds'] - df['route_mean'])**2).sum()
    r2_route = 1 - (ss_res / ss_tot)
    print(f"\n4. R² achievable with just route means: {r2_route:.4f}")
    print(f"   (Current model R² = 0.079, so route alone explains {r2_route*100:.1f}% of variance)")
    
    # VARIANCE DECOMPOSITION
    print("\n5. VARIANCE DECOMPOSITION:")
    total_var = df['error_seconds'].var()
    between_route_var = df.groupby('route')['error_seconds'].mean().var()
    within_route_var = df.groupby('route')['error_seconds'].var().mean()
    
    print(f"   Total variance: {total_var:.0f}")
    print(f"   Between-route variance: {between_route_var:.0f} ({between_route_var/total_var*100:.1f}%)")
    print(f"   Within-route variance (avg): {within_route_var:.0f} ({within_route_var/total_var*100:.1f}%)")
    
    if within_route_var / total_var > 0.8:
        print("\n   ⚠️ PROBLEM: >80% of variance is WITHIN routes, not between them.")
        print("   This means knowing the route doesn't help much - errors are random/noisy.")
    
    # Check sign of errors (systematic early/late?)
    print("\n6. SYSTEMATIC BIAS CHECK:")
    early_pct = (df['error_seconds'] < 0).mean() * 100
    late_pct = (df['error_seconds'] > 0).mean() * 100
    print(f"   Buses arriving EARLY: {early_pct:.1f}%")
    print(f"   Buses arriving LATE: {late_pct:.1f}%")
    print(f"   Mean signed error: {df['error_seconds'].mean():.1f}s (positive = late on average)")
    
    print("\n" + "=" * 70)
    print("DIAGNOSIS")
    print("=" * 70)
