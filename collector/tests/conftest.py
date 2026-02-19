"""
Shared fixtures for collector unit tests.
Uses SQLite in-memory for DB tests to avoid requiring a real PostgreSQL connection.

The root conftest.py adds collector/ to sys.path so bare imports work.
"""

import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


@pytest.fixture(autouse=True)
def no_database_url(monkeypatch):
    """Ensure DATABASE_URL is unset so collector code uses the no-DB fallback path."""
    monkeypatch.delenv("DATABASE_URL", raising=False)


@pytest.fixture()
def sqlite_engine():
    """In-memory SQLite engine with all collector tables created."""
    from db import Base
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def sqlite_session(sqlite_engine):
    """Bound session against the in-memory SQLite engine."""
    Session = sessionmaker(bind=sqlite_engine)
    session = Session()
    yield session
    session.close()
