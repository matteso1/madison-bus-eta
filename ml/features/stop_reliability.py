"""
Stop-level Reliability Features for Madison Bus ETA

Pre-computes reliability statistics per stop:
- Some stops are notoriously unreliable (downtown, high traffic)
- Some stops are very punctual (end of line, low traffic areas)

These features help the model learn stop-specific patterns.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Dict

import pandas as pd
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def compute_stop_reliability_scores(engine, lookback_days: int = 30) -> Dict[str, Dict[str, float]]:
    """
    Compute reliability metrics for each stop from historical prediction_outcomes.
    
    Returns:
        Dict mapping stpid -> {
            'mean_error': average error in seconds,
            'std_error': standard deviation of error,
            'late_rate': % of predictions that were late,
            'reliability_score': computed reliability (higher = more reliable),
            'sample_count': number of predictions at this stop
        }
    """
    from sqlalchemy import text
    
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    
    query = text("""
        SELECT 
            stpid,
            AVG(error_seconds) as mean_error,
            STDDEV(error_seconds) as std_error,
            AVG(CASE WHEN error_seconds > 0 THEN 1 ELSE 0 END) as late_rate,
            COUNT(*) as sample_count
        FROM prediction_outcomes
        WHERE created_at > :cutoff
        AND stpid IS NOT NULL
        GROUP BY stpid
        HAVING COUNT(*) >= 10  -- Need enough samples
        ORDER BY sample_count DESC
    """)
    
    with engine.connect() as conn:
        df = pd.read_sql(query, conn, params={"cutoff": cutoff})
    
    if df.empty:
        logger.warning("No stop-level data found")
        return {}
    
    # Compute reliability score (higher = more reliable)
    # Score = 100 - (abs_mean_error/10 + std_error/10)
    # Normalized to 0-100 scale
    df['abs_mean_error'] = df['mean_error'].abs()
    max_error = max(df['abs_mean_error'].max(), 300)  # Cap at 5 min
    max_std = max(df['std_error'].max(), 300)
    
    df['reliability_score'] = 100 * (
        1 - 0.5 * (df['abs_mean_error'] / max_error) - 
        0.5 * (df['std_error'].fillna(0) / max_std)
    )
    df['reliability_score'] = df['reliability_score'].clip(0, 100)
    
    # Convert to dict
    result = {}
    for _, row in df.iterrows():
        stpid = row['stpid']
        result[stpid] = {
            'mean_error': float(row['mean_error']),
            'std_error': float(row['std_error']) if pd.notna(row['std_error']) else 0.0,
            'late_rate': float(row['late_rate']),
            'reliability_score': float(row['reliability_score']),
            'sample_count': int(row['sample_count'])
        }
    
    logger.info(f"Computed reliability scores for {len(result)} stops")
    
    # Log some examples
    if result:
        sorted_stops = sorted(result.items(), key=lambda x: x[1]['reliability_score'])
        
        logger.info("Least reliable stops:")
        for stpid, metrics in sorted_stops[:5]:
            logger.info(f"  {stpid}: score={metrics['reliability_score']:.1f}, "
                       f"error={metrics['mean_error']:.0f}s, late_rate={metrics['late_rate']:.0%}")
        
        logger.info("Most reliable stops:")
        for stpid, metrics in sorted_stops[-5:]:
            logger.info(f"  {stpid}: score={metrics['reliability_score']:.1f}, "
                       f"error={metrics['mean_error']:.0f}s, late_rate={metrics['late_rate']:.0%}")
    
    return result


def add_stop_reliability_features(df: pd.DataFrame, stop_scores: Dict[str, Dict]) -> pd.DataFrame:
    """
    Add stop-level reliability features to a DataFrame.
    
    Args:
        df: DataFrame with stpid column
        stop_scores: Dict from compute_stop_reliability_scores()
    
    Returns:
        DataFrame with added columns:
        - stop_mean_error
        - stop_reliability_score  
        - stop_late_rate
    """
    df = df.copy()
    
    # Default values for unknown stops
    default_error = np.median([v['mean_error'] for v in stop_scores.values()]) if stop_scores else 60
    default_score = 50.0  # Middle score
    default_late_rate = 0.5  # 50% late
    
    # Map stop features
    df['stop_mean_error'] = df['stpid'].map(
        lambda x: stop_scores.get(x, {}).get('mean_error', default_error)
    )
    df['stop_reliability_score'] = df['stpid'].map(
        lambda x: stop_scores.get(x, {}).get('reliability_score', default_score)
    )
    df['stop_late_rate'] = df['stpid'].map(
        lambda x: stop_scores.get(x, {}).get('late_rate', default_late_rate)
    )
    
    # Categorize stops
    df['is_unreliable_stop'] = (df['stop_reliability_score'] < 40).astype(int)
    df['is_reliable_stop'] = (df['stop_reliability_score'] > 70).astype(int)
    
    return df


def get_stop_feature_columns() -> list:
    """Return list of stop-level feature columns."""
    return [
        'stop_mean_error',
        'stop_reliability_score',
        'stop_late_rate',
        'is_unreliable_stop',
        'is_reliable_stop'
    ]


if __name__ == "__main__":
    import os
    from sqlalchemy import create_engine
    
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        engine = create_engine(database_url, pool_pre_ping=True)
        scores = compute_stop_reliability_scores(engine)
        print(f"Computed scores for {len(scores)} stops")
    else:
        print("DATABASE_URL not set")
