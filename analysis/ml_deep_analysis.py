"""
ML Pipeline Deep Analysis - Madison Metro
Analyzes actual prediction accuracy using the prediction_outcomes table.
"""
from sqlalchemy import create_engine, text
from datetime import datetime

DATABASE_URL = 'postgresql://postgres:sDsIVEajwHNPJWnguwDrJaaPKiPmoupq@caboose.proxy.rlwy.net:46555/railway'
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

def run(sql):
    with engine.connect() as conn:
        return conn.execute(text(sql)).fetchall()

def fmt(n):
    return f"{n:,}" if isinstance(n, (int, float)) else str(n)

print("=" * 70)
print("MADISON METRO ML PIPELINE - DEEP ANALYSIS")
print("=" * 70)
print(f"Generated: {datetime.now()}\n")

# 1. Overall Prediction Accuracy
print("🎯 OVERALL PREDICTION ACCURACY")
print("-" * 50)
stats = run("""
    SELECT 
        COUNT(*) as total,
        AVG(ABS(error_seconds)) as avg_error,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(error_seconds)) as median_error,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ABS(error_seconds)) as p90_error,
        STDDEV(error_seconds) as stddev,
        AVG(CASE WHEN ABS(error_seconds) <= 60 THEN 1 ELSE 0 END) * 100 as within_1min,
        AVG(CASE WHEN ABS(error_seconds) <= 120 THEN 1 ELSE 0 END) * 100 as within_2min,
        AVG(CASE WHEN ABS(error_seconds) <= 300 THEN 1 ELSE 0 END) * 100 as within_5min,
        AVG(CASE WHEN is_significantly_late THEN 1 ELSE 0 END) * 100 as late_pct
    FROM prediction_outcomes
""")[0]

print(f"  Total predictions evaluated: {fmt(int(stats[0]))}")
print(f"  Average Error:        {stats[1]:.1f} seconds ({stats[1]/60:.2f} min)")
print(f"  Median Error:         {stats[2]:.1f} seconds")
print(f"  90th Percentile:      {stats[3]:.1f} seconds")
print(f"  Standard Deviation:   {stats[4]:.1f} seconds")
print()
print(f"  ✅ Within 1 minute:   {stats[5]:.1f}%")
print(f"  ✅ Within 2 minutes:  {stats[6]:.1f}%")
print(f"  ✅ Within 5 minutes:  {stats[7]:.1f}%")
print(f"  ⚠️ Significantly Late: {stats[8]:.1f}%")
print()

# 2. Error Distribution
print("📊 ERROR DISTRIBUTION")
print("-" * 50)
dist = run("""
    SELECT 
        CASE 
            WHEN ABS(error_seconds) <= 30 THEN '0-30s'
            WHEN ABS(error_seconds) <= 60 THEN '30s-1m'
            WHEN ABS(error_seconds) <= 120 THEN '1-2m'
            WHEN ABS(error_seconds) <= 300 THEN '2-5m'
            WHEN ABS(error_seconds) <= 600 THEN '5-10m'
            ELSE '10m+'
        END as bucket,
        COUNT(*) as cnt
    FROM prediction_outcomes
    GROUP BY 1
    ORDER BY MIN(ABS(error_seconds))
""")
total = sum(d[1] for d in dist)
for d in dist:
    pct = d[1] / total * 100
    bar = "█" * int(pct / 2)
    print(f"  {d[0]:<10} {pct:5.1f}%  {bar}")
print()

# 3. Route Performance
print("🚌 ROUTE PERFORMANCE")
print("-" * 50)
routes = run("""
    SELECT 
        rt,
        COUNT(*) as cnt,
        AVG(ABS(error_seconds)) as avg_error,
        AVG(CASE WHEN ABS(error_seconds) <= 60 THEN 1 ELSE 0 END) * 100 as within_1min
    FROM prediction_outcomes
    GROUP BY rt
    ORDER BY cnt DESC
    LIMIT 15
""")
print(f"  {'Route':<8} {'Count':<10} {'Avg Error':<12} {'Within 1 min'}")
print("  " + "-" * 45)
for r in routes:
    print(f"  {r[0]:<8} {fmt(r[1]):<10} {r[2]:.0f}s{'':<7} {r[3]:.1f}%")
print()

# 4. Hourly Performance
print("⏰ PERFORMANCE BY HOUR")
print("-" * 50)
hourly = run("""
    SELECT 
        EXTRACT(HOUR FROM actual_arrival) as hour,
        COUNT(*) as cnt,
        AVG(ABS(error_seconds)) as avg_error
    FROM prediction_outcomes
    GROUP BY 1
    ORDER BY 1
""")
print(f"  {'Hour':<6} {'Count':<10} {'Avg Error':<12} {'Visual (lower = better)'}")
print("  " + "-" * 55)
for h in hourly:
    bar = "█" * int(h[2] / 15) if h[2] else ""
    print(f"  {int(h[0]):02d}:00  {fmt(h[1]):<10} {h[2]:.0f}s{'':<7} {bar}")
print()

# 5. Daily Trend
print("📅 DAILY TREND (Last 14 days)")
print("-" * 50)
daily = run("""
    SELECT 
        DATE(actual_arrival) as day,
        COUNT(*) as cnt,
        AVG(ABS(error_seconds)) as avg_error
    FROM prediction_outcomes
    WHERE actual_arrival > NOW() - INTERVAL '14 days'
    GROUP BY 1
    ORDER BY 1
""")
print(f"  {'Date':<12} {'Count':<10} {'Avg Error':<12}")
print("  " + "-" * 35)
for d in daily:
    print(f"  {str(d[0]):<12} {fmt(d[1]):<10} {d[2]:.0f}s")
print()

# 6. Model Performance Trend
print("🤖 ML MODEL PERFORMANCE TREND")
print("-" * 50)
models = run("""
    SELECT version, mae, rmse, improvement_vs_baseline_pct, samples_used
    FROM ml_regression_runs
    ORDER BY version ASC
""")
print(f"  {'Version':<18} {'MAE':<10} {'RMSE':<10} {'vs Baseline'}")
print("  " + "-" * 50)
for m in models:
    baseline = f"{m[3]:+.1f}%" if m[3] else "N/A"
    print(f"  {m[0]:<18} {m[1]:.0f}s{'':<5} {m[2]:.0f}s{'':<5} {baseline}")
print()

# Summary
print("=" * 70)
print("KEY FINDINGS")
print("=" * 70)
avg_err_min = stats[1] / 60
within_1 = stats[5]
within_2 = stats[6]

if avg_err_min < 2 and within_1 > 60:
    verdict = "✅ EXCELLENT"
    msg = "Model is performing very well! Average error under 2 minutes."
elif avg_err_min < 3 and within_2 > 70:
    verdict = "✅ GOOD"
    msg = "Model is working well. Most predictions within 2 minutes."
elif avg_err_min < 5 and within_2 > 50:
    verdict = "⚠️ MODERATE"
    msg = "Model is acceptable but could be improved."
else:
    verdict = "❌ NEEDS WORK"
    msg = "Model accuracy is lower than expected. Review training data."

print(f"\n  OVERALL VERDICT: {verdict}")
print(f"  {msg}")
print(f"\n  Average Error: {avg_err_min:.2f} minutes")
print(f"  Predictions within 1 minute: {within_1:.1f}%")
print(f"  Predictions within 2 minutes: {within_2:.1f}%")
print()
