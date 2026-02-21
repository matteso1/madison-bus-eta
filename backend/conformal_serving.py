"""
Conformal Serving Module for Madison Bus ETA.

Thin serving layer — no DB calls. Reads conformal_calibration.json artifact
and provides lookup helpers for the /api/conformal-prediction endpoint.

The artifact is reloaded automatically when it changes on disk (Railway auto-deploy).
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Module-level singleton — reloaded on file change
_CONFORMAL_CACHE: dict = {'artifact': None, 'mtime': 0.0}


def get_conformal_artifact(ml_saved_dir: Path) -> Optional[dict]:
    """
    Load conformal_calibration.json from disk, reloading when the file changes.

    Returns None if the file does not exist (calibration not yet run).
    """
    artifact_path = ml_saved_dir / 'conformal_calibration.json'
    if not artifact_path.exists():
        return None

    try:
        mtime = artifact_path.stat().st_mtime
        if _CONFORMAL_CACHE['artifact'] is not None and mtime == _CONFORMAL_CACHE['mtime']:
            return _CONFORMAL_CACHE['artifact']

        with open(artifact_path) as f:
            artifact = json.load(f)

        _CONFORMAL_CACHE['artifact'] = artifact
        _CONFORMAL_CACHE['mtime'] = mtime
        logger.info(f"Conformal artifact loaded (version={artifact.get('version', 'unknown')})")
        return artifact
    except Exception as e:
        logger.warning(f"Failed to load conformal artifact: {e}")
        return None


def get_daytype(now: datetime) -> str:
    """
    Classify a datetime as 'weekday' or 'weekend_holiday'.

    Uses the US holiday calendar from the holidays package.
    """
    try:
        import holidays
        us_holidays = holidays.US()
        date = now.date()
        if now.weekday() >= 5 or date in us_holidays:
            return 'weekend_holiday'
        return 'weekday'
    except ImportError:
        # Fallback: use weekday only
        return 'weekend_holiday' if now.weekday() >= 5 else 'weekday'


def get_horizon_bucket(api_prediction_min: float) -> str:
    """
    Classify prediction horizon into 'short', 'medium', or 'long'.

    Buckets:
    - short: 0-5 minutes
    - medium: 6-15 minutes
    - long: 16+ minutes
    """
    if api_prediction_min <= 5:
        return 'short'
    elif api_prediction_min <= 15:
        return 'medium'
    else:
        return 'long'


def lookup_quantiles(artifact: dict, route: str, daytype: str, horizon_bucket: str) -> dict:
    """
    4-level fallback lookup for conformal quantiles.

    Fallback hierarchy (most specific to least):
    1. route__daytype__horizon_bucket (full stratum)
    2. route__daytype (drop horizon)
    3. route only
    4. daytype__horizon_bucket
    5. global

    Returns dict with keys: n, q_low, q_high
    """
    route = str(route) if route else ''

    # Level 1: full stratum
    full_key = f"{route}__{daytype}__{horizon_bucket}"
    cell = artifact.get('by_route_daytype_horizon', {}).get(full_key)
    if cell is not None:
        return cell

    # Level 2: route x daytype
    rd_key = f"{route}__{daytype}"
    cell = artifact.get('by_route_daytype', {}).get(rd_key)
    if cell is not None:
        return cell

    # Level 3: route only
    cell = artifact.get('by_route', {}).get(route)
    if cell is not None:
        return cell

    # Level 4: daytype x horizon
    dh_key = f"{daytype}__{horizon_bucket}"
    cell = artifact.get('by_daytype_horizon', {}).get(dh_key)
    if cell is not None:
        return cell

    # Level 5: global
    return artifact.get('global', {'n': 0, 'q_low': -180.0, 'q_high': 300.0})
