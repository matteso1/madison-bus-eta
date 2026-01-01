"""
Database models and utilities for Madison Metro data persistence.
Requires DATABASE_URL environment variable (from Railway PostgreSQL).
"""

from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime, Text
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, timezone
import os
import logging

logger = logging.getLogger(__name__)

Base = declarative_base()


class VehicleObservation(Base):
    """A single observation of a vehicle at a point in time."""
    __tablename__ = 'vehicle_observations'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    # Vehicle identifiers
    vid = Column(String(20), index=True)       # Vehicle ID
    rt = Column(String(10), index=True)        # Route designator
    # Position
    lat = Column(Float)
    lon = Column(Float)
    hdg = Column(Integer)                      # Heading in degrees
    # Status
    dly = Column(Boolean, default=False)       # Delayed flag
    spd = Column(Integer, nullable=True)       # Speed (if available)
    # Pattern/destination
    pid = Column(String(20), nullable=True)    # Pattern ID
    des = Column(String(100), nullable=True)   # Destination
    # Timestamps
    tmstmp = Column(String(20))                # API timestamp (YYYYMMDD HH:MM)
    collected_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Prediction(Base):
    """A bus arrival prediction for a stop."""
    __tablename__ = 'predictions'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    # Stop info
    stpid = Column(String(20), index=True)     # Stop ID
    stpnm = Column(String(100))                # Stop name
    # Vehicle/route info
    vid = Column(String(20), index=True)       # Vehicle ID
    rt = Column(String(10), index=True)        # Route
    des = Column(String(100), nullable=True)   # Destination
    # Prediction
    prdtm = Column(String(20))                 # Predicted arrival (YYYYMMDD HH:MM)
    prdctdn = Column(Integer)                  # Countdown in minutes
    # Metadata
    collected_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class MLTrainingRun(Base):
    """Tracks ML model training runs for autonomous retraining."""
    __tablename__ = 'ml_training_runs'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    version = Column(String(50), unique=True, index=True)  # Model version (timestamp)
    trained_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Training data info
    samples_used = Column(Integer)
    days_of_data = Column(Integer, default=7)
    
    # Model metrics
    accuracy = Column(Float)
    precision = Column(Float)
    recall = Column(Float)
    f1_score = Column(Float)
    
    # Comparison with previous
    previous_f1 = Column(Float, nullable=True)
    improvement_pct = Column(Float, nullable=True)
    
    # Deployment status
    deployed = Column(Boolean, default=False)
    deployment_reason = Column(String(200), nullable=True)  # "improved" / "first_model" / "not_deployed"


# Database connection
_engine = None
_SessionLocal = None


def get_db_engine():
    """Get or create database engine."""
    global _engine
    if _engine is None:
        database_url = os.getenv('DATABASE_URL')
        if not database_url:
            return None
        
        # Railway provides DATABASE_URL like: postgresql://user:pass@host:port/db
        _engine = create_engine(database_url, pool_pre_ping=True)
        
        # Create tables if they don't exist
        Base.metadata.create_all(_engine)
        logger.info("Database connected and tables created")
    
    return _engine


def get_session():
    """Get a database session."""
    global _SessionLocal
    engine = get_db_engine()
    if engine is None:
        return None
    
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=engine)
    
    return _SessionLocal()


def save_vehicles_to_db(vehicles: list) -> int:
    """Save vehicle observations to database. Returns count saved."""
    session = get_session()
    if session is None:
        return 0
    
    try:
        observations = []
        for v in vehicles:
            obs = VehicleObservation(
                vid=str(v.get('vid', '')),
                rt=str(v.get('rt', '')),
                lat=float(v.get('lat', 0)),
                lon=float(v.get('lon', 0)),
                hdg=int(v.get('hdg', 0)),
                dly=v.get('dly', False),
                spd=v.get('spd'),
                pid=str(v.get('pid', '')) if v.get('pid') else None,
                des=v.get('des'),
                tmstmp=v.get('tmstmp', '')
            )
            observations.append(obs)
        
        session.bulk_save_objects(observations)
        session.commit()
        return len(observations)
    except Exception as e:
        logger.error(f"Error saving vehicles to DB: {e}")
        session.rollback()
        return 0
    finally:
        session.close()


def save_predictions_to_db(predictions: list) -> int:
    """Save predictions to database. Returns count saved."""
    session = get_session()
    if session is None:
        return 0
    
    try:
        pred_objects = []
        for p in predictions:
            pred = Prediction(
                stpid=str(p.get('stpid', '')),
                stpnm=p.get('stpnm', ''),
                vid=str(p.get('vid', '')),
                rt=str(p.get('rt', '')),
                des=p.get('des'),
                prdtm=p.get('prdtm', ''),
                prdctdn=int(p.get('prdctdn', 0)) if p.get('prdctdn') else 0
            )
            pred_objects.append(pred)
        
        session.bulk_save_objects(pred_objects)
        session.commit()
        return len(pred_objects)
    except Exception as e:
        logger.error(f"Error saving predictions to DB: {e}")
        session.rollback()
        return 0
    finally:
        session.close()
