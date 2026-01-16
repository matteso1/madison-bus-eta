"""
CRITICAL ML PIPELINE ANALYSIS - Madison Metro
Acting as an ML engineer: Is this model actually useful? What's broken?
"""
from sqlalchemy import create_engine, text
from datetime import datetime

DATABASE_URL = 'postgresql://postgres:sDsIVEajwHNPJWnguwDrJaaPKiPmoupq@caboose.proxy.rlwy.net:46555/railway'
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

def run(sql):
    with engine.connect() as conn:
        return conn.execute(text(sql)).fetchall()

print("=" * 80)
print("CRITICAL ML PIPELINE ANALYSIS")
print("=" * 80)
print(f"Timestamp: {datetime.now()}\n")

# 1. CORE QUESTION: Is 2.2 min avg error good enough for a bus ETA system?
print("=" * 80)
print("1. IS 2.2 MIN AVG ERROR ACCEPTABLE FOR BUS ETA?")
print("=" * 80)
stats = run("""
    SELECT 
        COUNT(*) as total,
        AVG(error_seconds) as avg_error_signed,
        AVG(ABS(error_seconds)) as avg_error_abs,
        STDDEV(error_seconds) as stddev,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY error_seconds) as median_signed,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY error_seconds) as p25,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY error_seconds) as p75,
        MIN(error_seconds) as min_error,
        MAX(error_seconds) as max_error
    FROM prediction_outcomes
""")[0]

print(f"""
Total predictions: {stats[0]:,}
Signed avg error: {stats[1]:.1f}s  <-- IMPORTANT: Is model biased early/late?
Absolute avg error: {stats[2]:.1f}s ({stats[2]/60:.2f} min)
Std deviation: {stats[3]:.1f}s  <-- HIGH variance is a problem
Median signed: {stats[4]:.1f}s
IQR: {stats[5]:.1f}s to {stats[6]:.1f}s
Range: {stats[7]}s to {stats[8]}s
""")

if abs(stats[1]) > 30:
    print("[WARNING] SYSTEMATIC BIAS DETECTED: Model is consistently predicting", "EARLY" if stats[1] > 0 else "LATE")
else:
    print("[OK] No major systematic bias in predictions")

if stats[3] > 200:
    print("[WARNING] HIGH VARIANCE: Predictions are inconsistent (std > 200s)")

# 2. WHAT'S HAPPENING WITH THE BAD ROUTES?
print("\n" + "=" * 80)
print("2. BAD ROUTE ANALYSIS - Why are routes 80, O, P terrible?")
print("=" * 80)
bad_routes = run("""
    SELECT 
        rt,
        COUNT(*) as cnt,
        AVG(error_seconds) as avg_signed,
        AVG(ABS(error_seconds)) as avg_abs,
        STDDEV(error_seconds) as stddev,
        MIN(error_seconds) as min_err,
        MAX(error_seconds) as max_err
    FROM prediction_outcomes
    WHERE rt IN ('80', 'O', 'P')
    GROUP BY rt
    ORDER BY AVG(ABS(error_seconds)) DESC
""")

print("\nRoute-by-route breakdown for worst performers:")
for r in bad_routes:
    print(f"""
Route {r[0]}:
  Count: {r[1]:,}
  Signed avg: {r[2]:.1f}s  ({"EARLY" if r[2] > 0 else "LATE"} bias)
  Absolute avg: {r[3]:.1f}s ({r[3]/60:.1f} min)
  Std dev: {r[4]:.1f}s
  Range: {r[5]}s to {r[6]}s""")

# 3. Check if bad routes have enough training data
print("\n\nTraining data volume for bad routes:")
train_data = run("""
    SELECT rt, COUNT(*) as obs_count
    FROM vehicle_observations
    WHERE rt IN ('80', 'O', 'P')
    GROUP BY rt
""")
for t in train_data:
    print(f"  Route {t[0]}: {t[1]:,} observations")

# Compare to good routes
print("\nTraining data for good routes (A, D, B):")
good_data = run("""
    SELECT rt, COUNT(*) as obs_count
    FROM vehicle_observations
    WHERE rt IN ('A', 'D', 'B')
    GROUP BY rt
""")
for t in good_data:
    print(f"  Route {t[0]}: {t[1]:,} observations")

# 4. ERROR PATTERN ANALYSIS
print("\n" + "=" * 80)
print("3. ERROR PATTERNS - When does the model fail?")
print("=" * 80)

# By time of day
print("\nError by hour (looking for patterns):")
hourly = run("""
    SELECT 
        EXTRACT(HOUR FROM actual_arrival) as hour,
        COUNT(*) as cnt,
        AVG(ABS(error_seconds)) as avg_error,
        AVG(error_seconds) as signed_error
    FROM prediction_outcomes
    GROUP BY 1
    ORDER BY 1
""")

print(f"{'Hour':<6} {'Count':<8} {'Avg Error':<12} {'Bias':<15} {'Issue?'}")
print("-" * 55)
for h in hourly:
    issue = ""
    if h[2] > 150:
        issue = "[!] HIGH ERROR"
    if abs(h[3]) > 50:
        issue += " BIASED " + ("EARLY" if h[3] > 0 else "LATE")
    print(f"{int(h[0]):02d}:00  {h[1]:<8} {h[2]:.0f}s{'':<7} {h[3]:+.0f}s{'':<9} {issue}")

# 5. Is the model LEARNING or just memorizing?
print("\n" + "=" * 80)
print("4. MODEL LEARNING CHECK - Is it improving over time?")
print("=" * 80)

model_trend = run("""
    SELECT version, mae, improvement_vs_baseline_pct
    FROM ml_regression_runs
    ORDER BY version ASC
""")

print(f"\n{'Version':<18} {'MAE (s)':<10} {'vs Baseline':<15}")
print("-" * 45)
first_mae = None
for m in model_trend:
    if first_mae is None:
        first_mae = m[1]
    baseline = f"{m[2]:+.1f}%" if m[2] else "N/A"
    print(f"{m[0]:<18} {m[1]:.0f}s{'':<5} {baseline}")

if len(model_trend) > 2:
    recent_mae = model_trend[-1][1]
    old_mae = model_trend[0][1]
    if recent_mae < old_mae:
        print(f"\n[OK] Model improving: {old_mae:.0f}s -> {recent_mae:.0f}s ({((1-recent_mae/old_mae)*100):.1f}% better)")
    else:
        print(f"\n[WARNING] Model NOT improving: {old_mae:.0f}s -> {recent_mae:.0f}s")

# 6. PREDICTION vs ACTUAL DISTRIBUTION
print("\n" + "=" * 80)
print("5. ERROR BUCKETS - Where are the failures?")
print("=" * 80)

buckets = run("""
    SELECT 
        CASE 
            WHEN error_seconds < -300 THEN 'Very Late (>5m)'
            WHEN error_seconds < -120 THEN 'Late (2-5m)'
            WHEN error_seconds < -60 THEN 'Slightly Late (1-2m)'
            WHEN error_seconds BETWEEN -60 AND 60 THEN 'Good (+/-1m)'
            WHEN error_seconds < 120 THEN 'Slightly Early (1-2m)'
            WHEN error_seconds < 300 THEN 'Early (2-5m)'
            ELSE 'Very Early (>5m)'
        END as bucket,
        COUNT(*) as cnt
    FROM prediction_outcomes
    GROUP BY 1
    ORDER BY MIN(error_seconds)
""")

total = sum(b[1] for b in buckets)
print(f"\n{'Bucket':<25} {'Count':<10} {'%':<8}")
print("-" * 45)
for b in buckets:
    pct = b[1] / total * 100
    bar = "#" * int(pct / 2)
    print(f"{b[0]:<25} {b[1]:<10} {pct:.1f}%  {bar}")

# 7. WHAT FEATURES ARE WE USING?
print("\n" + "=" * 80)
print("6. FEATURE ANALYSIS - What data do we have?")
print("=" * 80)

# Check vehicle_observations schema
vo_cols = run("""
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'vehicle_observations'
""")
print("\nvehicle_observations columns (training data):")
for c in vo_cols:
    print(f"  - {c[0]}")

# 8. ACTIONABLE RECOMMENDATIONS
print("\n" + "=" * 80)
print("7. CRITICAL FINDINGS & RECOMMENDATIONS")
print("=" * 80)

print("""
CRITICAL ISSUE #1: SYSTEMATIC EARLY BIAS (+122s)
  - The model consistently predicts buses will be EARLIER than they are
  - This is a training data or feature engineering problem
  - RECOMMENDATION: Check if training data has selection bias toward on-time buses

CRITICAL ISSUE #2: HIGH VARIANCE (std 312s)  
  - Some predictions are great, others are 5+ minutes off
  - This indicates model is not generalizing well
  - RECOMMENDATION: Add regularization or simplify model

CRITICAL ISSUE #3: ROUTES 80, O, P ARE BROKEN
  - These routes have 300-350s avg error (5-6 minutes!)
  - Likely: different bus type, longer routes, or less frequent service
  - RECOMMENDATION: Train route-specific models or add route as categorical feature

CRITICAL ISSUE #4: MODEL NOT IMPROVING
  - MAE has flatlined around 139-146s across all training runs
  - We're hitting a ceiling with current features
  - RECOMMENDATION: Add new features (weather, traffic, events) or try ensemble

THE REAL QUESTION:
  Is -6.8% vs baseline worth the complexity? 
  If the API is already giving 150s error, we're saving ~10 seconds on average.
  For a bus ETA, that's marginal value.
  
  TO BE TRULY USEFUL:
  - Target <60s avg error (1 minute)
  - Get 80%+ predictions within 1 minute
  - Eliminate route-specific failures
""")
