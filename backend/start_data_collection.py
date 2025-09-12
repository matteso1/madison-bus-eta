#!/usr/bin/env python3
"""
Madison Metro Data Collection - Production Startup Script
Simple script to start the optimal data collector for production use
"""

import os
import sys
from datetime import datetime
from optimal_collector import OptimalBusDataCollector

def main():
    """Start the data collection system"""
    print("🚌 MADISON METRO DATA COLLECTION SYSTEM")
    print("=" * 50)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)
    
    # Check if we're in the right directory
    if not os.path.exists('collected_data'):
        print("❌ Error: collected_data directory not found")
        print("Please run this script from the backend directory")
        sys.exit(1)
    
    # Initialize collector
    print("🔧 Initializing data collector...")
    collector = OptimalBusDataCollector()
    
    # Show initial status
    print(f"📊 API calls remaining: {collector.max_daily_calls - collector.daily_api_calls:,}")
    print(f"⏰ Current schedule: {collector.get_current_schedule()['description']}")
    print(f"📁 Data directory: {collector.data_dir}")
    
    # Confirm before starting
    print("\n⚠️  WARNING: This will run continuously and use API calls!")
    print("Press Ctrl+C to stop at any time")
    print("Starting in 5 seconds...")
    
    try:
        import time
        for i in range(5, 0, -1):
            print(f"Starting in {i}...")
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n❌ Cancelled by user")
        sys.exit(0)
    
    # Start collection
    print("\n🚀 Starting data collection...")
    print("=" * 50)
    
    try:
        collector.run()
    except KeyboardInterrupt:
        print("\n\n⏹️  Data collection stopped by user")
        collector.print_daily_summary()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        collector.print_daily_summary()
        sys.exit(1)

if __name__ == "__main__":
    main()
