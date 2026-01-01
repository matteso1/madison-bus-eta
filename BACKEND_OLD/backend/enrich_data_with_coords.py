"""
Enrich consolidated_metro_data.csv with lat/lon coordinates from stop_cache.json
"""
import pandas as pd
import json
from pathlib import Path

# Load the CSV
print("Loading consolidated data...")
df = pd.read_csv('ml/data/consolidated_metro_data.csv')
print(f"Loaded {len(df):,} records")

# Load stop cache
print("Loading stop cache...")
with open('ml/data/stop_cache.json', 'r', encoding='utf-8') as f:
    cache = json.load(f)
stops = cache.get('stops', {})
print(f"Loaded {len(stops):,} stops from cache")

# Create mapping from stpid to lat/lon
stop_coords = {}
for stpid, meta in stops.items():
    stop_coords[str(stpid)] = {
        'lat': meta.get('lat'),
        'lon': meta.get('lon')
    }

# Add lat/lon columns
print("Adding lat/lon columns...")
df['stpid_str'] = df['stpid'].astype(str)
df['lat'] = df['stpid_str'].map(lambda x: stop_coords.get(x, {}).get('lat'))
df['lon'] = df['stpid_str'].map(lambda x: stop_coords.get(x, {}).get('lon'))
df.drop('stpid_str', axis=1, inplace=True)

# Check results
total = len(df)
with_coords = df[['lat', 'lon']].notna().all(axis=1).sum()
print(f"\nResults: {with_coords:,} / {total:,} records now have coordinates ({with_coords/total*100:.1f}%)")

# Save enriched data
output_path = 'ml/data/consolidated_metro_data.csv'
print(f"\nSaving enriched data to {output_path}...")
df.to_csv(output_path, index=False)
print("Done!")
