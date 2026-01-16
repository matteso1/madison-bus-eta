"""
Headway Analysis Module
Calculates time between buses (headway) and identifies service gaps
"""

import pandas as pd
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import numpy as np

class HeadwayAnalyzer:
    """Analyze bus headways (time between consecutive buses)"""
    
    def __init__(self, predictions_df: Optional[pd.DataFrame] = None):
        self.predictions_df = predictions_df
    
    def calculate_headways(self, route: str, stop_id: str, 
                          peak_hours: tuple = (7, 9, 16, 18)) -> Dict:
        """Calculate headways for a specific route/stop"""
        if self.predictions_df is None or len(self.predictions_df) == 0:
            return {}
        
        # Filter for route and stop
        route_data = self.predictions_df[
            (self.predictions_df['rt'] == route) & 
            (self.predictions_df['stpid'] == stop_id)
        ].copy()
        
        if len(route_data) == 0:
            return {}
        
        # Convert prdtm to datetime
        route_data['prdtm_dt'] = pd.to_datetime(route_data['prdtm'], format='%Y%m%d %H:%M', errors='coerce')
        route_data = route_data.sort_values('prdtm_dt')
        
        # Calculate headways
        route_data['headway_minutes'] = route_data['prdtm_dt'].diff().dt.total_seconds() / 60
        
        # Filter for peak hours
        route_data['hour'] = route_data['prdtm_dt'].dt.hour
        peak_data = route_data[
            ((route_data['hour'] >= peak_hours[0]) & (route_data['hour'] < peak_hours[1])) |
            ((route_data['hour'] >= peak_hours[2]) & (route_data['hour'] < peak_hours[3]))
        ]
        
        return {
            'route': route,
            'stop_id': stop_id,
            'avg_headway_all': float(route_data['headway_minutes'].mean()) if len(route_data) > 1 else None,
            'avg_headway_peak': float(peak_data['headway_minutes'].mean()) if len(peak_data) > 1 else None,
            'max_headway_peak': float(peak_data['headway_minutes'].max()) if len(peak_data) > 0 else None,
            'service_gaps': int((peak_data['headway_minutes'] > 20).sum()) if len(peak_data) > 0 else 0,
            'total_trips': len(route_data)
        }
    
    def find_service_gaps(self, min_headway_minutes: int = 20, 
                         peak_hours: tuple = (7, 9, 16, 18)) -> List[Dict]:
        """Find stops with service gaps (headway > threshold during peak)"""
        if self.predictions_df is None:
            return []
        
        gaps = []
        
        # Group by route and stop
        grouped = self.predictions_df.groupby(['rt', 'stpid'])
        
        for (route, stop_id), group in grouped:
            result = self.calculate_headways(route, stop_id, peak_hours)
            if result.get('service_gaps', 0) > 0:
                gaps.append({
                    'route': route,
                    'stop_id': stop_id,
                    'stop_name': group['stpnm'].iloc[0] if 'stpnm' in group.columns else 'Unknown',
                    'max_headway_peak': result.get('max_headway_peak'),
                    'service_gaps': result.get('service_gaps'),
                    'avg_headway_peak': result.get('avg_headway_peak')
                })
        
        return sorted(gaps, key=lambda x: x.get('max_headway_peak', 0), reverse=True)
    
    def get_route_headway_summary(self) -> Dict:
        """Get headway summary by route"""
        if self.predictions_df is None:
            return {}
        
        route_summaries = {}
        
        for route in self.predictions_df['rt'].unique():
            route_data = self.predictions_df[self.predictions_df['rt'] == route].copy()
            route_data['prdtm_dt'] = pd.to_datetime(route_data['prdtm'], format='%Y%m%d %H:%M', errors='coerce')
            route_data = route_data.sort_values('prdtm_dt')
            
            # Calculate headways by stop
            headways = []
            for stop_id in route_data['stpid'].unique():
                stop_data = route_data[route_data['stpid'] == stop_id].sort_values('prdtm_dt')
                stop_data['headway'] = stop_data['prdtm_dt'].diff().dt.total_seconds() / 60
                headways.extend(stop_data['headway'].dropna().tolist())
            
            if headways:
                route_summaries[route] = {
                    'avg_headway': float(np.mean(headways)),
                    'median_headway': float(np.median(headways)),
                    'min_headway': float(np.min(headways)),
                    'max_headway': float(np.max(headways)),
                    'std_headway': float(np.std(headways))
                }
        
        return route_summaries

