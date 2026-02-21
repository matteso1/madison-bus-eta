"""
Mondrian Conformal Calibration for Madison Bus ETA.

Computes route-adaptive calibrated prediction intervals from historical residuals.
Guarantees >= 90% empirical coverage per stratum (route x daytype x horizon_bucket).

Run after train_regression.py in the nightly workflow.
Writes ml/models/saved/conformal_calibration.json.
"""

import os
import sys
import json
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

# Add parent directories to path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'collector'))

from features.regression_features import engineer_regression_features, apply_historical_eta_features, get_regression_feature_columns
from models.model_registry import load_model, get_model_info

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')
logger = logging.getLogger(__name__)

# Calibration parameters
COVERAGE_TARGET = 0.90
MIN_CELL_SAMPLES = 30          # Minimum samples for a stable quantile estimate
MIN_GLOBAL_COVERAGE = 0.85    # Deployment gate: abort if global coverage below this
CAL_WINDOW_DAYS = 14          # Calibration window length
CAL_LAG_DAYS = 7             # Gap between cal window end and today (= XGBoost training window)


def fetch_calibration_data(cal_start: datetime, cal_end: datetime, engine) -> pd.DataFrame:
    """
    Fetch prediction outcomes for the calibration window from the database.

    The calibration window is strictly BEFORE the XGBoost training window,
    so calibration rows are never seen by the XGBoost model.

    Filters |error_seconds| < 1200 (20 minutes) to remove extreme outliers.
    """
    from sqlalchemy import text

    # Check if weather_observations table exists
    with engine.connect() as conn:
        weather_table_exists = conn.execute(
            text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'weather_observations')")
        ).scalar()

    if weather_table_exists:
        query = """
            SELECT
                po.vid,
                po.rt,
                po.stpid,
                po.predicted_arrival,
                po.actual_arrival,
                po.error_seconds,
                po.created_at,
                COALESCE(p.prdctdn, 10) as prediction_horizon_min,
                w.temp_celsius,
                w.precipitation_1h_mm,
                w.snow_1h_mm,
                w.wind_speed_mps,
                w.visibility_meters,
                w.is_severe as is_severe_weather,
                v.avg_speed,
                v.speed_stddev,
                v.velocity_samples
            FROM prediction_outcomes po
            LEFT JOIN predictions p ON po.prediction_id = p.id
            LEFT JOIN LATERAL (
                SELECT temp_celsius, precipitation_1h_mm, snow_1h_mm,
                       wind_speed_mps, visibility_meters, is_severe
                FROM weather_observations
                WHERE observed_at <= po.created_at
                ORDER BY observed_at DESC
                LIMIT 1
            ) w ON true
            LEFT JOIN LATERAL (
                SELECT
                    AVG(spd)::float as avg_speed,
                    STDDEV(spd)::float as speed_stddev,
                    COUNT(*)::int as velocity_samples
                FROM vehicle_observations vo
                WHERE vo.vid = po.vid
                AND vo.collected_at BETWEEN po.created_at - INTERVAL '5 minutes' AND po.created_at + INTERVAL '1 minute'
                AND vo.spd IS NOT NULL
                AND vo.spd > 0
                AND vo.spd < 80
            ) v ON true
            WHERE po.created_at >= :cal_start
            AND po.created_at < :cal_end
            AND ABS(po.error_seconds) < 1200
            ORDER BY po.created_at
        """
    else:
        query = """
            SELECT
                po.vid,
                po.rt,
                po.stpid,
                po.predicted_arrival,
                po.actual_arrival,
                po.error_seconds,
                po.created_at,
                COALESCE(p.prdctdn, 10) as prediction_horizon_min,
                NULL::float as temp_celsius,
                NULL::float as precipitation_1h_mm,
                NULL::float as snow_1h_mm,
                NULL::float as wind_speed_mps,
                NULL::float as visibility_meters,
                NULL::boolean as is_severe_weather,
                v.avg_speed,
                v.speed_stddev,
                v.velocity_samples
            FROM prediction_outcomes po
            LEFT JOIN predictions p ON po.prediction_id = p.id
            LEFT JOIN LATERAL (
                SELECT
                    AVG(spd)::float as avg_speed,
                    STDDEV(spd)::float as speed_stddev,
                    COUNT(*)::int as velocity_samples
                FROM vehicle_observations vo
                WHERE vo.vid = po.vid
                AND vo.collected_at BETWEEN po.created_at - INTERVAL '5 minutes' AND po.created_at + INTERVAL '1 minute'
                AND vo.spd IS NOT NULL
                AND vo.spd > 0
                AND vo.spd < 80
            ) v ON true
            WHERE po.created_at >= :cal_start
            AND po.created_at < :cal_end
            AND ABS(po.error_seconds) < 1200
            ORDER BY po.created_at
        """

    with engine.connect() as conn:
        from sqlalchemy import text
        df = pd.read_sql(text(query), conn, params={"cal_start": cal_start, "cal_end": cal_end})

    logger.info(f"Fetched {len(df)} calibration rows from {cal_start.date()} to {cal_end.date()}")
    return df


def load_training_aggregates(models_dir: Path) -> dict:
    """
    Load training aggregates serialized by train_regression.py.

    Converts colon-separated string keys back to tuple keys for
    route_horizon_error and route_horizon_std dicts.

    Raises FileNotFoundError if training_aggregates.json is missing
    (training must run before calibration).
    """
    agg_path = models_dir / 'training_aggregates.json'
    if not agg_path.exists():
        raise FileNotFoundError(
            f"training_aggregates.json not found at {agg_path}. "
            "Run train_regression.py first."
        )

    with open(agg_path) as f:
        raw = json.load(f)

    # Convert string keys back to tuple keys for route_horizon dicts
    tuple_key_fields = {'route_horizon_error', 'route_horizon_std'}
    aggregates = {}
    for k, v in raw.items():
        if k in tuple_key_fields and isinstance(v, dict):
            converted = {}
            for str_key, val in v.items():
                if ':' in str_key:
                    parts = str_key.split(':', 1)
                    converted[(parts[0], parts[1])] = val
                else:
                    converted[str_key] = val
            aggregates[k] = converted
        elif k == 'hour_route_error' and isinstance(v, dict):
            # Keys are "route:hour" — convert to (route, int(hour)) tuples
            converted = {}
            for str_key, val in v.items():
                if ':' in str_key:
                    parts = str_key.split(':', 1)
                    try:
                        converted[(parts[0], int(parts[1]))] = val
                    except ValueError:
                        converted[str_key] = val
                else:
                    converted[str_key] = val
            aggregates[k] = converted
        else:
            aggregates[k] = v

    logger.info(f"Loaded training aggregates (version={raw.get('version', 'unknown')})")
    return aggregates


def get_stratum_keys(rt: str, dow: int, is_holiday: bool, horizon_min: float) -> tuple:
    """
    Compute stratum classification for a row.

    Returns (daytype, horizon_bucket, full_key) where:
    - daytype: 'weekday' or 'weekend_holiday'
    - horizon_bucket: 'short' (0-5 min), 'medium' (6-15 min), 'long' (16+ min)
    - full_key: 'route__daytype__horizon_bucket'
    """
    # DayType
    if is_holiday or dow >= 5:
        daytype = 'weekend_holiday'
    else:
        daytype = 'weekday'

    # HorizonBucket
    if horizon_min <= 5:
        horizon_bucket = 'short'
    elif horizon_min <= 15:
        horizon_bucket = 'medium'
    else:
        horizon_bucket = 'long'

    full_key = f"{rt}__{daytype}__{horizon_bucket}"
    return daytype, horizon_bucket, full_key


def _finite_sample_quantile(residuals: np.ndarray, alpha_low: float, alpha_high: float) -> tuple:
    """
    Compute finite-sample corrected quantiles for conformal prediction.

    Uses ceil((n+1)*alpha)/n correction per Vovk et al.
    Returns (q_low, q_high).
    """
    n = len(residuals)
    if n == 0:
        return 0.0, 0.0

    # Finite-sample correction: ceil((n+1)*alpha)/n
    idx_low = min(int(np.ceil((n + 1) * alpha_low)), n) - 1
    idx_high = min(int(np.ceil((n + 1) * alpha_high)), n) - 1

    sorted_r = np.sort(residuals)
    q_low = float(sorted_r[max(idx_low, 0)])
    q_high = float(sorted_r[min(idx_high, n - 1)])
    return q_low, q_high


def compute_conformal_quantiles(
    df_cal: pd.DataFrame,
    xgb_model,
    bias: float,
    aggregates: dict,
    feature_cols: list,
) -> dict:
    """
    Vectorized computation of conformal residuals and per-stratum quantiles.

    Steps:
    1. Engineer base features (temporal, route, horizon, weather, velocity)
    2. Apply historical aggregates (from training window, not cal window)
    3. Batch XGBoost predict
    4. Compute signed residuals: r_i = error_seconds_i - (xgb_pred_i + bias)
    5. Group by (route, daytype, horizon_bucket)
    6. Apply finite-sample quantile correction per stratum

    Returns nested dict with keys for each stratum level.
    """
    logger.info("Engineering features for calibration data...")
    df_feat = engineer_regression_features(df_cal)
    df_feat = apply_historical_eta_features(df_feat, aggregates)

    # Drop rows with missing feature values
    df_feat = df_feat[feature_cols + ['error_seconds', 'rt', 'day_of_week', 'is_holiday', 'horizon_min']].copy()
    df_feat = df_feat.dropna(subset=feature_cols + ['error_seconds'])
    logger.info(f"After feature engineering and dropna: {len(df_feat)} rows")

    # Batch XGBoost predict
    X = df_feat[feature_cols].values
    logger.info(f"Running XGBoost batch predict on {len(X)} rows...")
    xgb_preds = xgb_model.predict(X)

    # Signed residuals
    df_feat = df_feat.reset_index(drop=True)
    df_feat['xgb_pred'] = xgb_preds
    df_feat['residual'] = df_feat['error_seconds'] - (df_feat['xgb_pred'] + bias)

    # Compute stratum keys
    import holidays as _holidays
    us_holidays = _holidays.US()

    def _is_holiday(date_val):
        try:
            return date_val in us_holidays
        except Exception:
            return False

    df_feat['_daytype'] = df_feat.apply(
        lambda row: 'weekend_holiday' if (
            row['is_holiday'] == 1 or row['day_of_week'] >= 5
        ) else 'weekday',
        axis=1
    )
    df_feat['_horizon_bucket'] = pd.cut(
        df_feat['horizon_min'],
        bins=[-np.inf, 5, 15, np.inf],
        labels=['short', 'medium', 'long']
    ).astype(str)

    # Build strata dicts
    alpha_low = 0.05
    alpha_high = 0.95

    strata = {
        'by_route_daytype_horizon': {},
        'by_route_daytype': {},
        'by_route': {},
        'by_daytype_horizon': {},
        'global': None,
    }

    # Full key: route__daytype__horizon
    for (rt, dt, hb), grp in df_feat.groupby(['rt', '_daytype', '_horizon_bucket']):
        residuals = grp['residual'].values
        if len(residuals) < MIN_CELL_SAMPLES:
            continue
        q_low, q_high = _finite_sample_quantile(residuals, alpha_low, alpha_high)
        key = f"{rt}__{dt}__{hb}"
        strata['by_route_daytype_horizon'][key] = {
            'n': len(residuals),
            'q_low': round(q_low, 2),
            'q_high': round(q_high, 2),
        }

    # Route x daytype
    for (rt, dt), grp in df_feat.groupby(['rt', '_daytype']):
        residuals = grp['residual'].values
        if len(residuals) < MIN_CELL_SAMPLES:
            continue
        q_low, q_high = _finite_sample_quantile(residuals, alpha_low, alpha_high)
        key = f"{rt}__{dt}"
        strata['by_route_daytype'][key] = {
            'n': len(residuals),
            'q_low': round(q_low, 2),
            'q_high': round(q_high, 2),
        }

    # Route only
    for rt, grp in df_feat.groupby('rt'):
        residuals = grp['residual'].values
        if len(residuals) < MIN_CELL_SAMPLES:
            continue
        q_low, q_high = _finite_sample_quantile(residuals, alpha_low, alpha_high)
        strata['by_route'][str(rt)] = {
            'n': len(residuals),
            'q_low': round(q_low, 2),
            'q_high': round(q_high, 2),
        }

    # Daytype x horizon (fallback when route is sparse)
    for (dt, hb), grp in df_feat.groupby(['_daytype', '_horizon_bucket']):
        residuals = grp['residual'].values
        if len(residuals) < MIN_CELL_SAMPLES:
            continue
        q_low, q_high = _finite_sample_quantile(residuals, alpha_low, alpha_high)
        key = f"{dt}__{hb}"
        strata['by_daytype_horizon'][key] = {
            'n': len(residuals),
            'q_low': round(q_low, 2),
            'q_high': round(q_high, 2),
        }

    # Global
    global_residuals = df_feat['residual'].values
    q_low_g, q_high_g = _finite_sample_quantile(global_residuals, alpha_low, alpha_high)
    strata['global'] = {
        'n': len(global_residuals),
        'q_low': round(q_low_g, 2),
        'q_high': round(q_high_g, 2),
    }

    logger.info(f"Computed strata: {len(strata['by_route_daytype_horizon'])} full, "
                f"{len(strata['by_route_daytype'])} route-daytype, "
                f"{len(strata['by_route'])} route-only, "
                f"{len(strata['by_daytype_horizon'])} daytype-horizon")

    # Attach residuals df for coverage verification
    strata['_residuals_df'] = df_feat[['rt', '_daytype', '_horizon_bucket', 'residual']].copy()

    return strata


def verify_coverage(strata: dict) -> dict:
    """
    Verify empirical coverage for each stratum.

    For each stratum, count what fraction of calibration residuals fall
    within [q_low, q_high]. Should be ~0.90 by construction.

    Returns coverage_verification dict with global and per-stratum stats.
    """
    df_res = strata.get('_residuals_df')
    if df_res is None or len(df_res) == 0:
        return {
            'global_empirical_coverage': 0.0,
            'per_stratum_min_coverage': 0.0,
            'per_stratum_max_coverage': 0.0,
            'strata_below_target': [],
        }

    # Global coverage
    g = strata['global']
    global_covered = ((df_res['residual'] >= g['q_low']) & (df_res['residual'] <= g['q_high'])).mean()

    # Per-stratum coverage
    stratum_coverages = []
    strata_below = []

    for key, cell in strata['by_route_daytype_horizon'].items():
        parts = key.split('__')
        if len(parts) != 3:
            continue
        rt, dt, hb = parts
        mask = (
            (df_res['rt'] == rt) &
            (df_res['_daytype'] == dt) &
            (df_res['_horizon_bucket'] == hb)
        )
        grp = df_res[mask]
        if len(grp) < MIN_CELL_SAMPLES:
            continue
        covered = ((grp['residual'] >= cell['q_low']) & (grp['residual'] <= cell['q_high'])).mean()
        stratum_coverages.append(covered)
        if covered < 0.85:
            strata_below.append({'stratum': key, 'coverage': round(float(covered), 4)})

    result = {
        'global_empirical_coverage': round(float(global_covered), 4),
        'per_stratum_min_coverage': round(float(min(stratum_coverages)), 4) if stratum_coverages else 0.0,
        'per_stratum_max_coverage': round(float(max(stratum_coverages)), 4) if stratum_coverages else 0.0,
        'strata_below_target': strata_below,
    }
    logger.info(f"Coverage verification: global={result['global_empirical_coverage']:.3f}, "
                f"strata_min={result['per_stratum_min_coverage']:.3f}, "
                f"strata_max={result['per_stratum_max_coverage']:.3f}")
    return result


def main():
    """
    Main conformal calibration pipeline.

    1. Load XGBoost model and bias from registry
    2. Load training aggregates
    3. Compute calibration window (days -21 to -7)
    4. Fetch calibration data from DB
    5. Compute conformal quantiles per stratum
    6. Verify coverage (gate: global >= 0.85)
    7. Write conformal_calibration.json artifact
    """
    logger.info("=" * 60)
    logger.info("MONDRIAN CONFORMAL CALIBRATION PIPELINE")
    logger.info("=" * 60)

    models_dir = Path(__file__).parent.parent / 'models' / 'saved'

    # Step 1: Load XGBoost model
    logger.info("Step 1: Loading XGBoost model from registry...")
    xgb_model = load_model()
    if xgb_model is None:
        logger.error("No model found in registry. Run train_regression.py first.")
        return False

    model_info = get_model_info()
    model_version = model_info.get('version', 'unknown') if model_info else 'unknown'
    bias = 0.0
    if model_info:
        bias = model_info.get('metrics', {}).get('bias_correction_seconds', 0.0) or 0.0
    logger.info(f"Model version: {model_version}, bias_correction: {bias:.2f}s")

    # Step 2: Load training aggregates
    logger.info("Step 2: Loading training aggregates...")
    try:
        aggregates = load_training_aggregates(models_dir)
    except FileNotFoundError as e:
        logger.error(str(e))
        return False

    # Step 3: Compute calibration window
    now = datetime.now(timezone.utc)
    cal_end = now - timedelta(days=CAL_LAG_DAYS)
    cal_start = cal_end - timedelta(days=CAL_WINDOW_DAYS)
    logger.info(f"Step 3: Calibration window: {cal_start.date()} to {cal_end.date()} ({CAL_WINDOW_DAYS} days)")

    # Step 4: Fetch calibration data
    logger.info("Step 4: Fetching calibration data from DB...")
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        logger.error("DATABASE_URL not set")
        return False

    try:
        from sqlalchemy import create_engine
        engine = create_engine(database_url, pool_pre_ping=True)
        df_cal = fetch_calibration_data(cal_start, cal_end, engine)
    except Exception as e:
        logger.error(f"Failed to fetch calibration data: {e}")
        import traceback
        traceback.print_exc()
        return False

    if len(df_cal) < 1000:
        logger.warning(f"Only {len(df_cal)} calibration rows — too few for reliable calibration (need 1000+)")
        return False

    logger.info(f"Fetched {len(df_cal)} calibration rows")

    # Step 5: Compute conformal quantiles
    logger.info("Step 5: Computing conformal quantiles per stratum...")
    feature_cols = get_regression_feature_columns()
    try:
        strata = compute_conformal_quantiles(df_cal, xgb_model, bias, aggregates, feature_cols)
    except Exception as e:
        logger.error(f"Failed to compute quantiles: {e}")
        import traceback
        traceback.print_exc()
        return False

    # Step 6: Verify coverage
    logger.info("Step 6: Verifying empirical coverage...")
    coverage_verification = verify_coverage(strata)

    global_coverage = coverage_verification['global_empirical_coverage']
    if global_coverage < MIN_GLOBAL_COVERAGE:
        logger.error(
            f"COVERAGE GATE FAILED: global empirical coverage {global_coverage:.3f} < "
            f"minimum {MIN_GLOBAL_COVERAGE}. Artifact NOT written."
        )
        return False
    logger.info(f"Coverage gate passed: {global_coverage:.3f} >= {MIN_GLOBAL_COVERAGE}")

    # Step 7: Build and write artifact
    logger.info("Step 7: Writing conformal_calibration.json...")

    # Remove internal residuals df before serializing
    strata_clean = {k: v for k, v in strata.items() if k != '_residuals_df'}

    artifact = {
        'version': now.strftime('%Y%m%d_%H%M%S'),
        'calibrated_at': now.isoformat(),
        'xgb_model_version': model_version,
        'coverage_target': COVERAGE_TARGET,
        'cal_window_days': CAL_WINDOW_DAYS,
        'cal_start': cal_start.isoformat(),
        'cal_end': cal_end.isoformat(),
        'total_cal_points': strata_clean['global']['n'],
        'global': strata_clean['global'],
        'by_daytype_horizon': strata_clean['by_daytype_horizon'],
        'by_route': strata_clean['by_route'],
        'by_route_daytype': strata_clean['by_route_daytype'],
        'by_route_daytype_horizon': strata_clean['by_route_daytype_horizon'],
        'coverage_verification': coverage_verification,
    }

    artifact_path = models_dir / 'conformal_calibration.json'
    with open(artifact_path, 'w') as f:
        json.dump(artifact, f, indent=2)

    logger.info(f"Artifact written to {artifact_path}")
    logger.info("=" * 60)
    logger.info("CONFORMAL CALIBRATION COMPLETE")
    logger.info(f"  Version: {artifact['version']}")
    logger.info(f"  XGBoost model: {model_version}")
    logger.info(f"  Total cal points: {artifact['total_cal_points']}")
    logger.info(f"  Full strata: {len(strata_clean['by_route_daytype_horizon'])}")
    logger.info(f"  Global coverage: {global_coverage:.3f}")
    logger.info(f"  Global q_low: {strata_clean['global']['q_low']:.1f}s, q_high: {strata_clean['global']['q_high']:.1f}s")
    logger.info("=" * 60)

    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
