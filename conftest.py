"""
Root conftest.py — adds collector/ to sys.path so tests can import its modules
as bare names (e.g. `from gtfsrt_collector import ...`) matching how the
collector itself runs.
"""

import sys
import os

# Insert the collector directory so modules like db, gtfsrt_collector, etc. are importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "collector"))
