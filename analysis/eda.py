"""
Madison Metro EDA - Exploratory Data Analysis

Analyzes historical collected data to understand:
1. When are delays most common? (time of day, day of week)
2. Which routes are most/least reliable?
3. How accurate are the API's own predictions (prdctdn)?

Run: python analysis/eda.py
"""

import os
import glob
import pandas as pd
import numpy as np
from datetime import datetime
from collections import defaultdict

# Data directories
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'backend', 'collected_data')

def load_all_vehicles():
    """Load all vehicle CSV files into a single DataFrame."""
    pattern = os.path.join(DATA_DIR, 'vehicles_*.csv')
    files = glob.glob(pattern)
    print(f"Found {len(files)} vehicle files")
    
    if not files:
        print(f"No files found in {DATA_DIR}")
        return pd.DataFrame()
    
    dfs = []
    for f in files:
        try:
            df = pd.read_csv(f)
            # Extract timestamp from filename
            basename = os.path.basename(f)
            ts_str = basename.replace('vehicles_', '').replace('.csv', '')
            df['file_timestamp'] = ts_str
            dfs.append(df)
        except Exception as e:
            print(f"Error reading {f}: {e}")
    
    if dfs:
        return pd.concat(dfs, ignore_index=True)
    return pd.DataFrame()


def load_all_predictions():
    """Load all prediction CSV files into a single DataFrame."""
    pattern = os.path.join(DATA_DIR, 'predictions_*.csv')
    files = glob.glob(pattern)
    print(f"Found {len(files)} prediction files")
    
    if not files:
        return pd.DataFrame()
    
    dfs = []
    for f in files:
        try:
            df = pd.read_csv(f)
            basename = os.path.basename(f)
            ts_str = basename.replace('predictions_', '').replace('.csv', '')
            df['file_timestamp'] = ts_str
            dfs.append(df)
        except Exception as e:
            print(f"Error reading {f}: {e}")
    
    if dfs:
        return pd.concat(dfs, ignore_index=True)
    return pd.DataFrame()


def analyze_delays(vehicles_df):
    """Analyze delay patterns."""
    print("\n" + "="*60)
    print("DELAY ANALYSIS")
    print("="*60)
    
    if vehicles_df.empty or 'dly' not in vehicles_df.columns:
        print("No delay data available")
        return
    
    # Overall delay rate
    total = len(vehicles_df)
    delayed = vehicles_df['dly'].sum() if vehicles_df['dly'].dtype == bool else (vehicles_df['dly'] == True).sum()
    delay_rate = delayed / total * 100 if total > 0 else 0
    print(f"\nOverall delay rate: {delay_rate:.2f}% ({delayed:,} of {total:,} observations)")
    
    # Parse timestamp to get hour
    if 'tmstmp' in vehicles_df.columns:
        try:
            # tmstmp format: "20250912 11:53"
            vehicles_df['hour'] = vehicles_df['tmstmp'].astype(str).str[9:11].astype(int)
            
            print("\n--- Delays by Hour of Day ---")
            delay_by_hour = vehicles_df.groupby('hour').agg({
                'dly': ['sum', 'count']
            })
            delay_by_hour.columns = ['delayed', 'total']
            delay_by_hour['delay_rate'] = delay_by_hour['delayed'] / delay_by_hour['total'] * 100
            delay_by_hour = delay_by_hour.sort_index()
            
            for hour, row in delay_by_hour.iterrows():
                bar = "█" * int(row['delay_rate'] / 2)
                print(f"  {hour:02d}:00  {row['delay_rate']:5.1f}%  {bar}")
        except Exception as e:
            print(f"Could not parse timestamp: {e}")
    
    # Delays by route
    if 'rt' in vehicles_df.columns:
        print("\n--- Delays by Route ---")
        delay_by_route = vehicles_df.groupby('rt').agg({
            'dly': ['sum', 'count']
        })
        delay_by_route.columns = ['delayed', 'total']
        delay_by_route['delay_rate'] = delay_by_route['delayed'] / delay_by_route['total'] * 100
        delay_by_route = delay_by_route.sort_values('delay_rate', ascending=False)
        
        print("\n  TOP 5 MOST DELAYED ROUTES:")
        for rt, row in delay_by_route.head(5).iterrows():
            print(f"    Route {rt:>3}: {row['delay_rate']:5.1f}% delayed ({int(row['delayed'])} of {int(row['total'])})")
        
        print("\n  TOP 5 MOST RELIABLE ROUTES:")
        for rt, row in delay_by_route.tail(5).iterrows():
            print(f"    Route {rt:>3}: {row['delay_rate']:5.1f}% delayed ({int(row['delayed'])} of {int(row['total'])})")


def analyze_routes(vehicles_df):
    """Analyze route patterns."""
    print("\n" + "="*60)
    print("ROUTE ANALYSIS")
    print("="*60)
    
    if vehicles_df.empty or 'rt' not in vehicles_df.columns:
        print("No route data available")
        return
    
    # Route frequency
    route_counts = vehicles_df['rt'].value_counts()
    print(f"\nNumber of unique routes: {len(route_counts)}")
    
    print("\n--- Observations per Route (top 10) ---")
    for rt, count in route_counts.head(10).items():
        bar = "█" * int(count / route_counts.max() * 30)
        print(f"  Route {rt:>3}: {count:6,} obs  {bar}")
    
    # Unique vehicles per route
    print("\n--- Unique Vehicles per Route ---")
    vehicles_per_route = vehicles_df.groupby('rt')['vid'].nunique().sort_values(ascending=False)
    for rt, count in vehicles_per_route.head(10).items():
        print(f"  Route {rt:>3}: {count:3} unique vehicles")


def analyze_predictions(predictions_df):
    """Analyze prediction accuracy."""
    print("\n" + "="*60)
    print("PREDICTION ANALYSIS")
    print("="*60)
    
    if predictions_df.empty:
        print("No prediction data available")
        return
    
    # Basic stats on prdctdn (countdown minutes)
    if 'prdctdn' in predictions_df.columns:
        predictions_df['prdctdn'] = pd.to_numeric(predictions_df['prdctdn'], errors='coerce')
        valid_preds = predictions_df['prdctdn'].dropna()
        
        print(f"\nTotal predictions recorded: {len(valid_preds):,}")
        print(f"Average countdown (prdctdn): {valid_preds.mean():.1f} minutes")
        print(f"Median countdown: {valid_preds.median():.1f} minutes")
        print(f"Min countdown: {valid_preds.min():.0f} minutes")
        print(f"Max countdown: {valid_preds.max():.0f} minutes")
        
        # Distribution of countdown times
        print("\n--- Prediction Countdown Distribution ---")
        bins = [0, 5, 10, 15, 20, 30, 60, 120]
        labels = ['0-5', '5-10', '10-15', '15-20', '20-30', '30-60', '60+']
        predictions_df['countdown_bucket'] = pd.cut(predictions_df['prdctdn'], bins=bins, labels=labels)
        bucket_counts = predictions_df['countdown_bucket'].value_counts().sort_index()
        
        for bucket, count in bucket_counts.items():
            pct = count / len(valid_preds) * 100
            bar = "█" * int(pct / 2)
            print(f"  {bucket:>6} min: {pct:5.1f}%  {bar}")
    
    # Predictions by route
    if 'rt' in predictions_df.columns:
        print("\n--- Predictions per Route (top 10) ---")
        route_preds = predictions_df['rt'].value_counts().head(10)
        for rt, count in route_preds.items():
            print(f"  Route {rt:>3}: {count:,} predictions")


def generate_summary(vehicles_df, predictions_df):
    """Generate overall summary."""
    print("\n" + "="*60)
    print("DATA SUMMARY")
    print("="*60)
    
    # Date range
    if not vehicles_df.empty and 'tmstmp' in vehicles_df.columns:
        try:
            vehicles_df['date'] = vehicles_df['tmstmp'].astype(str).str[:8]
            dates = vehicles_df['date'].unique()
            print(f"\nDate range: {min(dates)} to {max(dates)}")
            print(f"Unique dates: {len(dates)}")
        except:
            pass
    
    print(f"\nVehicle observations: {len(vehicles_df):,}")
    print(f"Prediction records: {len(predictions_df):,}")
    
    if not vehicles_df.empty:
        print(f"Unique vehicles: {vehicles_df['vid'].nunique() if 'vid' in vehicles_df.columns else 'N/A'}")
        print(f"Unique routes: {vehicles_df['rt'].nunique() if 'rt' in vehicles_df.columns else 'N/A'}")


def main():
    print("="*60)
    print("MADISON METRO - EXPLORATORY DATA ANALYSIS")
    print("="*60)
    print(f"Data directory: {DATA_DIR}")
    
    # Load data
    print("\nLoading data...")
    vehicles_df = load_all_vehicles()
    predictions_df = load_all_predictions()
    
    # Generate summary first
    generate_summary(vehicles_df, predictions_df)
    
    # Analysis
    analyze_delays(vehicles_df)
    analyze_routes(vehicles_df)
    analyze_predictions(predictions_df)
    
    print("\n" + "="*60)
    print("EDA COMPLETE")
    print("="*60)


if __name__ == '__main__':
    main()
