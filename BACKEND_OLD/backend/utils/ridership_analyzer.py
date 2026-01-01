"""
Ridership Analysis Module
Analyzes ridership data from Madison Metro open data
"""

import pandas as pd
import json
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime

class RidershipAnalyzer:
    """Analyze ridership patterns from Metro open data"""
    
    def __init__(self, ridership_file='opendata/Metro_Ridership_by_Stop.csv', 
                 stops_file='opendata/Metro_Transit_Bus_Stops.csv'):
        # Paths are relative to project root, not backend directory
        base_path = Path(__file__).parent.parent.parent  # Go up from utils/ to project root
        self.ridership_file = base_path / ridership_file
        self.stops_file = base_path / stops_file
        self.ridership_df = None
        self.stops_df = None
        self._load_data()
    
    def _load_data(self):
        """Load ridership and stops data"""
        try:
            if self.ridership_file.exists():
                self.ridership_df = pd.read_csv(self.ridership_file)
                # Clean column names
                self.ridership_df.columns = self.ridership_df.columns.str.strip()
            else:
                print(f"Ridership file not found: {self.ridership_file}")
            
            if self.stops_file.exists():
                self.stops_df = pd.read_csv(self.stops_file)
                self.stops_df.columns = self.stops_df.columns.str.strip()
            else:
                print(f"Stops file not found: {self.stops_file}")
        except Exception as e:
            print(f"Error loading ridership data: {e}")
    
    def get_route_ridership_summary(self) -> Dict:
        """Get ridership summary by route"""
        if self.ridership_df is None:
            return {}
        
        # Get route columns (F28, F38, A, B, C, etc.)
        route_cols = [col for col in self.ridership_df.columns 
                     if col.startswith('F') or col in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'L', 'O', 'P', 'R', 'S', 'W']]
        
        route_totals = {}
        for col in route_cols:
            route_id = col.replace('F', '')  # F28 -> 28
            total = self.ridership_df[col].sum()
            if total > 0:
                route_totals[route_id] = {
                    'total_ridership': float(total),
                    'avg_per_stop': float(self.ridership_df[col].mean()),
                    'stops_served': int((self.ridership_df[col] > 0).sum())
                }
        
        # Sort by ridership
        sorted_routes = sorted(route_totals.items(), key=lambda x: x[1]['total_ridership'], reverse=True)
        
        return {
            'routes': {route: data for route, data in sorted_routes},
            'top_routes': [route for route, _ in sorted_routes[:10]],
            'total_stops': len(self.ridership_df) if self.ridership_df is not None else 0
        }
    
    def get_stop_ridership_heatmap(self, top_n: int = 50) -> List[Dict]:
        """Get top stops by ridership for heatmap"""
        if self.ridership_df is None:
            return []
        
        # Calculate total ridership per stop
        route_cols = [col for col in self.ridership_df.columns 
                     if col.startswith('F') or col in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'L', 'O', 'P', 'R', 'S', 'W']]
        
        self.ridership_df['total_ridership'] = self.ridership_df[route_cols].sum(axis=1)
        
        # Ridership data already has lat/lon, just use it directly
        merged = self.ridership_df.copy()
        
        # Get top stops
        top_stops = merged.nlargest(top_n, 'total_ridership')
        
        return [
            {
                'stop_id': str(row.get('stop_code', '')),
                'stop_name': str(row.get('stop_name', 'Unknown')),
                'lat': float(row.get('stop_lat', 0)) if pd.notna(row.get('stop_lat')) else 43.0731,
                'lon': float(row.get('stop_lon', 0)) if pd.notna(row.get('stop_lon')) else -89.4012,
                'ridership': float(row.get('total_ridership', 0)),
                'weekday': float(row.get('Weekday', 0))
            }
            for _, row in top_stops.iterrows()
            if pd.notna(row.get('stop_lat')) and pd.notna(row.get('stop_lon'))
        ]
    
    def get_route_performance_metrics(self) -> List[Dict]:
        """Calculate route performance metrics"""
        if self.ridership_df is None:
            return []
        
        route_cols = [col for col in self.ridership_df.columns 
                     if col.startswith('F') or col in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'L', 'O', 'P', 'R', 'S', 'W']]
        
        metrics = []
        for col in route_cols:
            route_id = col.replace('F', '')
            route_data = self.ridership_df[col]
            
            total = route_data.sum()
            if total > 0:
                metrics.append({
                    'route': route_id,
                    'total_ridership': float(total),
                    'avg_per_stop': float(route_data.mean()),
                    'stops_served': int((route_data > 0).sum()),
                    'max_stop_ridership': float(route_data.max()),
                    'ridership_variance': float(route_data.var())
                })
        
        return sorted(metrics, key=lambda x: x['total_ridership'], reverse=True)
    
    def get_underserved_areas(self, min_population: int = 1000, max_distance_m: float = 800) -> List[Dict]:
        """Identify underserved areas (would need census data)"""
        # Placeholder - would need census block group data
        return []

