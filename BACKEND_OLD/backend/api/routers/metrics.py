from fastapi import APIRouter, HTTPException
from ..db import get_db_connection
import logging

router = APIRouter(prefix="/metrics", tags=["metrics"])
logger = logging.getLogger(__name__)

@router.get("/otp")
async def get_otp():
    """
    Get daily On-Time Performance.
    """
    conn = get_db_connection()
    try:
        # Get overall OTP by date
        result = conn.execute("""
            SELECT 
                date,
                SUM(total_predictions) as total,
                SUM(delayed_count) as delayed,
                ROUND(1.0 - (SUM(delayed_count) * 1.0 / SUM(total_predictions)), 4) as otp
            FROM analytics_otp_daily
            GROUP BY 1
            ORDER BY 1
        """).fetchall()
        
        return [
            {"date": row[0], "total": row[1], "delayed": row[2], "otp": row[3]}
            for row in result
        ]
    finally:
        conn.close()

@router.get("/bunching/summary")
async def get_bunching_summary():
    """
    Get bunching events summary by route.
    """
    conn = get_db_connection()
    try:
        result = conn.execute("""
            SELECT 
                rt,
                COUNT(*) as event_count,
                AVG(bus_count) as avg_buses_involved
            FROM analytics_bunching
            GROUP BY 1
            ORDER BY 2 DESC
            LIMIT 10
        """).fetchall()
        
        return [
            {"route": row[0], "events": row[1], "avg_buses": row[2]}
            for row in result
        ]
    finally:
        conn.close()
