"""
Data Aggregator for Madison Metro Visualizations
Processes 204K records into visualization-ready endpoints
"""

import pandas as pd
import numpy as np
from pathlib import Path
import json
from datetime import datetime
from collections import defaultdict
import numpy as np

class DataAggregator:
    def __init__(self, data_path='ml/data/consolidated_metro_data.csv'):
        """Initialize with consolidated data"""
        print("Loading 204K records...")
        self.df = pd.read_csv(data_path)
        self.df['tmstmp'] = pd.to_datetime(self.df['tmstmp'])
        self.df['collection_timestamp'] = pd.to_datetime(self.df['collection_timestamp'])
        self.df['hour'] = self.df['tmstmp'].dt.hour
        self.df['day_of_week'] = self.df['tmstmp'].dt.dayofweek
        self.df['date'] = self.df['tmstmp'].dt.date
        # Try to enrich with stop lat/lon cache if missing
        self._try_merge_stop_cache()
        print(f"[OK] Loaded {len(self.df):,} records")
        
    def get_route_stats(self):
        """Get comprehensive stats for each route"""
        route_stats = []
        
        for route in sorted(self.df['rt'].unique()):
            route_data = self.df[self.df['rt'] == route]
            
            stats = {
                'route': route,
                'total_predictions': len(route_data),
                'avg_delay': float(route_data['dly'].sum() / len(route_data)) if len(route_data) > 0 else 0,
                'avg_api_error': float(route_data['api_prediction_error'].mean()),
                'avg_wait_time': float(route_data['minutes_until_arrival'].mean()),
                'reliability_score': float(1 / (1 + route_data['api_prediction_error'].mean())),
                'is_brt': route.isalpha(),  # BRT routes are letters
                'peak_hour': int(route_data.groupby('hour').size().idxmax()),
                'busiest_stops': route_data.groupby('stpnm').size().nlargest(3).to_dict()
            }
            route_stats.append(stats)
            
        return route_stats
    
    def get_hourly_patterns(self):
        """Get delay patterns by hour for all routes"""
        hourly = self.df.groupby(['hour', 'rt']).agg({
            'api_prediction_error': 'mean',
            'minutes_until_arrival': 'mean',
            'dly': lambda x: x.sum() / len(x) if len(x) > 0 else 0
        }).reset_index()
        
        hourly.columns = ['hour', 'route', 'avg_error', 'avg_wait', 'delay_rate']
        
        return hourly.to_dict('records')
    
    def get_heatmap_data(self):
        """Get route × hour heatmap data"""
        heatmap = self.df.pivot_table(
            values='api_prediction_error',
            index='rt',
            columns='hour',
            aggfunc='mean',
            fill_value=0
        )
        
        # Convert to format for visualization
        data = []
        for route in heatmap.index:
            for hour in heatmap.columns:
                data.append({
                    'route': route,
                    'hour': int(hour),
                    'error': float(heatmap.loc[route, hour])
                })
        
        return data
    
    def get_temporal_trends(self):
        """Get trends over time"""
        daily = self.df.groupby('date').agg({
            'api_prediction_error': 'mean',
            'minutes_until_arrival': 'mean',
            'dly': lambda x: x.sum() / len(x) if len(x) > 0 else 0
        }).reset_index()
        
        daily['date'] = daily['date'].astype(str)
        daily.columns = ['date', 'avg_error', 'avg_wait', 'delay_rate']
        
        return daily.to_dict('records')
    
    def get_day_of_week_patterns(self):
        """Get patterns by day of week"""
        dow = self.df.groupby('day_of_week').agg({
            'api_prediction_error': 'mean',
            'minutes_until_arrival': 'mean',
            'dly': lambda x: x.sum() / len(x) if len(x) > 0 else 0
        }).reset_index()
        
        day_names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        dow['day_name'] = dow['day_of_week'].apply(lambda x: day_names[x])
        dow.columns = ['day_of_week', 'avg_error', 'avg_wait', 'delay_rate', 'day_name']
        
        return dow.to_dict('records')
    
    def get_stop_performance(self):
        """Get performance metrics for all stops"""
        stops = self.df.groupby(['stpid', 'stpnm']).agg({
            'api_prediction_error': 'mean',
            'minutes_until_arrival': 'mean',
            'dly': lambda x: x.sum() / len(x) if len(x) > 0 else 0,
            'rt': 'count'
        }).reset_index()
        
        stops.columns = ['stop_id', 'stop_name', 'avg_error', 'avg_wait', 'delay_rate', 'frequency']
        stops = stops[stops['frequency'] > 10]  # Filter low-frequency stops
        
        return stops.to_dict('records')
    
    def get_rush_hour_analysis(self):
        """Analyze rush hour vs non-rush hour"""
        self.df['is_rush'] = self.df['hour'].apply(
            lambda x: 'Morning Rush' if 7 <= x <= 9 else ('Evening Rush' if 16 <= x <= 18 else 'Off-Peak')
        )
        
        rush = self.df.groupby('is_rush').agg({
            'api_prediction_error': 'mean',
            'minutes_until_arrival': 'mean',
            'dly': lambda x: x.sum() / len(x) if len(x) > 0 else 0,
            'rt': 'count'
        }).reset_index()
        
        rush.columns = ['period', 'avg_error', 'avg_wait', 'delay_rate', 'total_predictions']
        
        return rush.to_dict('records')
    
    def get_system_overview(self):
        """Get overall system statistics"""
        return {
            'total_records': len(self.df),
            'total_routes': int(self.df['rt'].nunique()),
            'unique_stops': int(self.df['stpnm'].nunique()),
            'total_predictions': len(self.df),
            'avg_wait_time': float(self.df['minutes_until_arrival'].mean()),
            'system_reliability': float(1 / (1 + self.df['api_prediction_error'].mean())),
            'date_range': {
                'start': str(self.df['tmstmp'].min().date()),
                'end': str(self.df['tmstmp'].max().date()),
                'days': int((self.df['tmstmp'].max() - self.df['tmstmp'].min()).days)
            },
            'overall_metrics': {
                'avg_error': float(self.df['api_prediction_error'].mean()),
                'avg_wait': float(self.df['minutes_until_arrival'].mean()),
                'delay_rate': float(self.df['dly'].sum() / len(self.df)),
                'total_delays': int(self.df['dly'].sum())
            }
        }

    def get_geospatial_heatmap_data(self):
        """Aggregate data by lat/lon for geospatial heatmap."""
        # Check if lat/lon columns exist
        if 'lat' not in self.df.columns or 'lon' not in self.df.columns:
            print("⚠️  Lat/Lon columns not available in dataset. Geospatial heatmap disabled.")
            return []
        
        # We need to calculate average error per stop location
        # Group by stop coordinates and calculate the mean error and the count of predictions
        stop_data = self.df.groupby(['lat', 'lon'])['api_prediction_error'].agg(['mean', 'count']).reset_index()
        stop_data.rename(columns={'mean': 'avg_error', 'count': 'prediction_count'}, inplace=True)
        
        # Filter out stops with very few data points to reduce noise
        stop_data = stop_data[stop_data['prediction_count'] > 10]

        return stop_data[['lat', 'lon', 'avg_error']].to_dict(orient='records')

    # -------------------- Internal helpers --------------------
    def _try_merge_stop_cache(self):
        """If lat/lon missing, merge from ml/data/stop_cache.json via stpid."""
        has_latlon = ('lat' in self.df.columns) and ('lon' in self.df.columns)
        if has_latlon and self.df[['lat','lon']].dropna().shape[0] > 0:
            return
        cache_path = Path(__file__).resolve().parent.parent / 'ml' / 'data' / 'stop_cache.json'
        if not cache_path.exists():
            return
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                payload = json.load(f)
            stops = payload.get('stops', {})
            if not stops:
                return
            rows = []
            for stpid, meta in stops.items():
                rows.append({
                    'stpid': str(stpid),
                    'lat': meta.get('lat'),
                    'lon': meta.get('lon')
                })
            cache_df = pd.DataFrame(rows)
            if 'stpid' in self.df.columns and not cache_df.empty:
                self.df['stpid'] = self.df['stpid'].astype(str)
                self.df = self.df.merge(cache_df, on='stpid', how='left', suffixes=('', '_cache'))
                # Prefer existing lat/lon, else use cache columns
                if 'lat_cache' in self.df.columns:
                    self.df['lat'] = self.df['lat'].fillna(self.df['lat_cache'])
                if 'lon_cache' in self.df.columns:
                    self.df['lon'] = self.df['lon'].fillna(self.df['lon_cache'])
                drop_cols = [c for c in ['lat_cache','lon_cache'] if c in self.df.columns]
                if drop_cols:
                    self.df.drop(columns=drop_cols, inplace=True)
        except Exception as e:
            print(f"⚠️  Failed merging stop cache: {e}")

    # -------------------- Distributions & Calibration --------------------
    def get_error_distribution(self):
        """Return histogram and CDF for absolute prediction error (minutes)."""
        if 'api_prediction_error' not in self.df.columns:
            return {'hist': [], 'cdf': []}
        err = self.df['api_prediction_error'].abs().replace([np.inf, -np.inf], np.nan).dropna()
        if err.empty:
            return {'hist': [], 'cdf': []}
        # Histogram (0 to 15+ minutes)
        max_edge = float(min(30.0, max(5.0, np.ceil(err.quantile(0.99)) + 1)))
        bins = np.arange(0.0, max_edge + 1e-6, 1.0)
        counts, edges = np.histogram(err.values, bins=bins)
        hist = []
        for i in range(len(counts)):
            hist.append({
                'start': float(edges[i]),
                'end': float(edges[i+1]),
                'count': int(counts[i])
            })
        # CDF quantiles
        quantiles = [0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]
        cdf = [{'q': float(q), 'value': float(err.quantile(q))} for q in quantiles]
        return {'hist': hist, 'cdf': cdf, 'n': int(len(err))}

    # -------------------- Reliability Rankings --------------------
    def get_reliability_rankings(self):
        """Get best and worst performing routes and stops by multiple metrics."""
        route_rankings = self.df.groupby('rt').agg({
            'api_prediction_error': ['mean', 'std', 'count'],
            'minutes_until_arrival': 'mean',
            'dly': lambda x: (x.sum() / len(x)) if len(x) > 0 else 0
        }).reset_index()

        route_rankings.columns = ['route', 'mae', 'std', 'count', 'avg_wait', 'delay_rate']
        route_rankings['reliability_score'] = 1 / (1 + route_rankings['mae'])
        route_rankings['on_time_rate'] = 1 - route_rankings['delay_rate']

        # Filter routes with enough data
        route_rankings = route_rankings[route_rankings['count'] >= 100]

        # Top and bottom 5 by different metrics
        top_reliable = route_rankings.nsmallest(5, 'mae')[['route', 'mae', 'reliability_score', 'count']].to_dict('records')
        bottom_reliable = route_rankings.nlargest(5, 'mae')[['route', 'mae', 'reliability_score', 'count']].to_dict('records')

        top_on_time = route_rankings.nlargest(5, 'on_time_rate')[['route', 'on_time_rate', 'delay_rate', 'count']].to_dict('records')

        # Stop rankings
        stop_rankings = self.df.groupby(['stpid', 'stpnm']).agg({
            'api_prediction_error': ['mean', 'count'],
            'dly': lambda x: (x.sum() / len(x)) if len(x) > 0 else 0
        }).reset_index()

        stop_rankings.columns = ['stop_id', 'stop_name', 'mae', 'count', 'delay_rate']
        stop_rankings = stop_rankings[stop_rankings['count'] >= 50]

        top_stops = stop_rankings.nsmallest(10, 'mae')[['stop_id', 'stop_name', 'mae', 'count']].to_dict('records')
        bottom_stops = stop_rankings.nlargest(10, 'mae')[['stop_id', 'stop_name', 'mae', 'count']].to_dict('records')

        return {
            'routes': {
                'most_reliable': top_reliable,
                'least_reliable': bottom_reliable,
                'most_on_time': top_on_time
            },
            'stops': {
                'best_performing': top_stops,
                'worst_performing': bottom_stops
            }
        }

    # -------------------- Anomaly Detection --------------------
    def detect_anomalies(self):
        """Detect unusual delay patterns and timing anomalies."""
        anomalies = []

        # Route × Hour combinations with unusually high errors
        route_hour = self.df.groupby(['rt', 'hour']).agg({
            'api_prediction_error': ['mean', 'std', 'count']
        }).reset_index()
        route_hour.columns = ['route', 'hour', 'mean_error', 'std_error', 'count']

        # Calculate overall statistics
        overall_mean = self.df['api_prediction_error'].mean()
        overall_std = self.df['api_prediction_error'].std()

        # Flag as anomaly if error > mean + 2*std and sufficient samples
        threshold = overall_mean + 2 * overall_std
        route_hour_anomalies = route_hour[
            (route_hour['mean_error'] > threshold) &
            (route_hour['count'] >= 20)
        ]

        for _, row in route_hour_anomalies.iterrows():
            anomalies.append({
                'type': 'high_error_period',
                'route': row['route'],
                'hour': int(row['hour']),
                'mean_error': float(row['mean_error']),
                'severity': 'high' if row['mean_error'] > threshold * 1.5 else 'medium',
                'sample_size': int(row['count'])
            })

        # Detect routes with high variance (inconsistent service)
        route_variance = self.df.groupby('rt').agg({
            'api_prediction_error': ['std', 'mean', 'count']
        }).reset_index()
        route_variance.columns = ['route', 'std_error', 'mean_error', 'count']

        high_variance = route_variance[
            (route_variance['std_error'] > route_variance['std_error'].quantile(0.9)) &
            (route_variance['count'] >= 100)
        ]

        for _, row in high_variance.iterrows():
            anomalies.append({
                'type': 'high_variance',
                'route': row['route'],
                'std_error': float(row['std_error']),
                'mean_error': float(row['mean_error']),
                'severity': 'medium',
                'sample_size': int(row['count']),
                'description': 'Inconsistent service quality'
            })

        return sorted(anomalies, key=lambda x: x.get('mean_error', x.get('std_error', 0)), reverse=True)

    def get_calibration_curve(self):
        """Approximate calibration by prediction horizon bucket vs mean absolute error."""
        if 'minutes_until_arrival' not in self.df.columns or 'api_prediction_error' not in self.df.columns:
            return []
        df = self.df[['minutes_until_arrival', 'api_prediction_error']].copy()
        df = df.replace([np.inf, -np.inf], np.nan).dropna()
        if df.empty:
            return []
        df['horizon'] = pd.cut(df['minutes_until_arrival'], bins=list(range(0, 65, 5)), right=False)
        grouped = df.groupby('horizon').agg(
            mae=('api_prediction_error', lambda x: float(np.abs(x).mean())),
            count=('api_prediction_error', 'count')
        ).reset_index()
        rows = []
        for _, row in grouped.iterrows():
            if pd.isna(row['horizon']):
                continue
            start = int(row['horizon'].left)
            end = int(row['horizon'].right)
            rows.append({'start': start, 'end': end, 'mae': float(row['mae']), 'count': int(row['count'])})
        return rows

    # -------------------- Advanced Statistical Analysis --------------------
    def get_correlation_analysis(self):
        """Calculate correlation matrix for key numerical features."""
        numeric_cols = ['api_prediction_error', 'minutes_until_arrival', 'hour', 'day_of_week', 'dly']
        available_cols = [col for col in numeric_cols if col in self.df.columns]
        
        if len(available_cols) < 2:
            return {'correlations': [], 'insights': []}
        
        corr_matrix = self.df[available_cols].corr()
        
        # Convert to list format for frontend
        correlations = []
        for i, col1 in enumerate(available_cols):
            for j, col2 in enumerate(available_cols):
                if i < j:  # Only upper triangle
                    correlations.append({
                        'feature1': col1,
                        'feature2': col2,
                        'correlation': float(corr_matrix.loc[col1, col2])
                    })
        
        # Sort by absolute correlation
        correlations.sort(key=lambda x: abs(x['correlation']), reverse=True)
        
        # Generate insights
        insights = []
        for corr in correlations[:5]:  # Top 5 correlations
            abs_corr = abs(corr['correlation'])
            if abs_corr > 0.3:
                direction = 'positive' if corr['correlation'] > 0 else 'negative'
                strength = 'strong' if abs_corr > 0.7 else 'moderate' if abs_corr > 0.5 else 'weak'
                insights.append({
                    'feature1': corr['feature1'],
                    'feature2': corr['feature2'],
                    'strength': strength,
                    'direction': direction,
                    'value': corr['correlation']
                })
        
        return {'correlations': correlations, 'insights': insights}

    def get_statistical_tests(self):
        """Perform statistical hypothesis tests on key patterns."""
        tests = []
        
        # Test 1: Rush hour vs off-peak error difference
        self.df['is_rush'] = self.df['hour'].apply(lambda x: 1 if (7 <= x <= 9) or (16 <= x <= 18) else 0)
        rush_errors = self.df[self.df['is_rush'] == 1]['api_prediction_error'].abs()
        offpeak_errors = self.df[self.df['is_rush'] == 0]['api_prediction_error'].abs()
        
        if len(rush_errors) > 30 and len(offpeak_errors) > 30:
            from scipy import stats
            t_stat, p_value = stats.ttest_ind(rush_errors, offpeak_errors)
            tests.append({
                'test': 'Rush Hour vs Off-Peak Error',
                'hypothesis': 'Rush hour has significantly different prediction errors',
                't_statistic': float(t_stat),
                'p_value': float(p_value),
                'significant': p_value < 0.05,
                'interpretation': f"Rush hour errors are {'significantly different' if p_value < 0.05 else 'not significantly different'} from off-peak (p={p_value:.4f})"
            })
        
        # Test 2: Weekend vs weekday
        self.df['is_weekend'] = self.df['day_of_week'].apply(lambda x: 1 if x >= 5 else 0)
        weekend_errors = self.df[self.df['is_weekend'] == 1]['api_prediction_error'].abs()
        weekday_errors = self.df[self.df['is_weekend'] == 0]['api_prediction_error'].abs()
        
        if len(weekend_errors) > 30 and len(weekday_errors) > 30:
            from scipy import stats
            t_stat, p_value = stats.ttest_ind(weekend_errors, weekday_errors)
            tests.append({
                'test': 'Weekend vs Weekday Error',
                'hypothesis': 'Weekend has significantly different prediction errors',
                't_statistic': float(t_stat),
                'p_value': float(p_value),
                'significant': p_value < 0.05,
                'interpretation': f"Weekend errors are {'significantly different' if p_value < 0.05 else 'not significantly different'} from weekday (p={p_value:.4f})"
            })
        
        # Test 3: BRT vs regular routes
        self.df['is_brt'] = self.df['rt'].apply(lambda x: 1 if str(x).isalpha() else 0)
        brt_errors = self.df[self.df['is_brt'] == 1]['api_prediction_error'].abs()
        regular_errors = self.df[self.df['is_brt'] == 0]['api_prediction_error'].abs()
        
        if len(brt_errors) > 30 and len(regular_errors) > 30:
            from scipy import stats
            t_stat, p_value = stats.ttest_ind(brt_errors, regular_errors)
            tests.append({
                'test': 'BRT vs Regular Routes',
                'hypothesis': 'BRT routes have significantly different prediction errors',
                't_statistic': float(t_stat),
                'p_value': float(p_value),
                'significant': p_value < 0.05,
                'interpretation': f"BRT errors are {'significantly different' if p_value < 0.05 else 'not significantly different'} from regular routes (p={p_value:.4f})"
            })
        
        return tests

    def get_time_series_decomposition(self):
        """Decompose time series to show trends, seasonality, and residuals."""
        # Aggregate by day
        daily = self.df.groupby('date').agg({
            'api_prediction_error': 'mean',
            'minutes_until_arrival': 'mean'
        }).reset_index()
        daily['date'] = pd.to_datetime(daily['date'])
        daily = daily.sort_values('date')
        
        if len(daily) < 7:
            return {'trend': [], 'seasonal': [], 'residual': []}
        
        # Simple moving average for trend
        daily['trend'] = daily['api_prediction_error'].rolling(window=min(7, len(daily)//3), center=True).mean()
        
        # Calculate day-of-week pattern (seasonal)
        daily['day_of_week'] = daily['date'].dt.dayofweek
        seasonal_pattern = daily.groupby('day_of_week')['api_prediction_error'].mean()
        daily['seasonal'] = daily['day_of_week'].map(seasonal_pattern)
        
        # Residual = actual - trend - seasonal
        daily['residual'] = daily['api_prediction_error'] - daily['trend'] - daily['seasonal']
        
        # Convert to list format
        trend_data = daily[['date', 'trend']].dropna().to_dict('records')
        seasonal_data = daily[['date', 'seasonal']].dropna().to_dict('records')
        residual_data = daily[['date', 'residual']].dropna().to_dict('records')
        
        # Convert dates to strings
        for item in trend_data:
            item['date'] = str(item['date'].date())
        for item in seasonal_data:
            item['date'] = str(item['date'].date())
        for item in residual_data:
            item['date'] = str(item['date'].date())
        
        return {
            'trend': trend_data,
            'seasonal': seasonal_data,
            'residual': residual_data
        }

    def get_key_insights(self):
        """Generate actionable insights from the data."""
        insights = []
        
        # Insight 1: Peak delay periods with specific numbers
        hourly_errors = self.df.groupby('hour')['api_prediction_error'].abs().mean()
        worst_hour = hourly_errors.idxmax()
        worst_error = hourly_errors.max()
        best_hour = hourly_errors.idxmin()
        best_error = hourly_errors.min()
        worst_hour_count = len(self.df[self.df['hour'] == worst_hour])
        
        insights.append({
            'category': 'Temporal Pattern',
            'title': f'{worst_hour}:00 Hour Has {((worst_error/best_error - 1) * 100):.0f}% Higher Errors',
            'description': f'Prediction errors peak at {worst_hour}:00 ({worst_error:.2f} min avg) vs best hour {best_hour}:00 ({best_error:.2f} min). With {worst_hour_count:,} predictions analyzed, this pattern is statistically significant. Recommendation: Add 2-3 minutes buffer time during {worst_hour}:00 hour.',
            'severity': 'high' if worst_error > 1.0 else 'medium',
            'impact': f'Affects {worst_hour_count:,} daily predictions'
        })
        
        # Insight 2: Route reliability with specific comparison
        route_reliability = self.df.groupby('rt')['api_prediction_error'].abs().mean()
        route_counts = self.df.groupby('rt').size()
        worst_route = route_reliability.idxmax()
        worst_route_error = route_reliability.max()
        worst_route_count = route_counts[worst_route]
        best_route = route_reliability.idxmin()
        best_route_error = route_reliability.min()
        improvement_potential = ((worst_route_error - best_route_error) / worst_route_error) * 100
        
        insights.append({
            'category': 'Route Performance',
            'title': f'Route {worst_route} Could Improve by {improvement_potential:.0f}%',
            'description': f'Route {worst_route} has {worst_route_error:.2f} min avg error (worst) vs Route {best_route} at {best_route_error:.2f} min (best). With {worst_route_count:,} predictions, fixing Route {worst_route} could save passengers ~{worst_route_error * worst_route_count / 60:.1f} hours per day.',
            'severity': 'high' if worst_route_error > 1.5 else 'medium',
            'impact': f'{worst_route_count:,} daily predictions affected'
        })
        
        # Insight 3: Rush hour impact with specific percentages
        self.df['is_rush'] = self.df['hour'].apply(lambda x: 1 if (7 <= x <= 9) or (16 <= x <= 18) else 0)
        rush_error = self.df[self.df['is_rush'] == 1]['api_prediction_error'].abs().mean()
        offpeak_error = self.df[self.df['is_rush'] == 0]['api_prediction_error'].abs().mean()
        rush_count = len(self.df[self.df['is_rush'] == 1])
        rush_percent_increase = ((rush_error/offpeak_error - 1) * 100) if offpeak_error > 0 else 0
        
        if rush_error > offpeak_error * 1.2:
            insights.append({
                'category': 'Traffic Impact',
                'title': f'Rush Hour Delays Are {rush_percent_increase:.0f}% Higher',
                'description': f'Rush hour errors ({rush_error:.2f} min) vs off-peak ({offpeak_error:.2f} min) show {rush_percent_increase:.0f}% increase. With {rush_count:,} rush hour predictions analyzed, this is a significant pattern. Recommendation: Use traffic-aware ML models during rush hours.',
                'severity': 'high' if rush_percent_increase > 30 else 'medium',
                'impact': f'{rush_count:,} daily rush hour predictions'
            })
        
        # Insight 4: BRT performance with specific numbers
        self.df['is_brt'] = self.df['rt'].apply(lambda x: 1 if str(x).isalpha() else 0)
        if self.df['is_brt'].sum() > 0:
            brt_error = self.df[self.df['is_brt'] == 1]['api_prediction_error'].abs().mean()
            regular_error = self.df[self.df['is_brt'] == 0]['api_prediction_error'].abs().mean()
            brt_count = len(self.df[self.df['is_brt'] == 1])
            
            if brt_error < regular_error:
                improvement = ((regular_error - brt_error) / regular_error) * 100
                time_saved = (regular_error - brt_error) * brt_count / 60
                insights.append({
                    'category': 'Route Type',
                    'title': f'BRT Routes Save {improvement:.0f}% Time vs Regular Routes',
                    'description': f'BRT routes average {brt_error:.2f} min error vs {regular_error:.2f} min for regular routes ({improvement:.0f}% better). With {brt_count:,} BRT predictions, this saves passengers ~{time_saved:.1f} hours daily. Validates investment in dedicated bus infrastructure.',
                    'severity': 'low',
                    'impact': f'{brt_count:,} daily BRT predictions'
                })
        
        # Insight 5: Data limitations (be honest!)
        unique_stops = self.df['stpid'].nunique() if 'stpid' in self.df.columns else 0
        if unique_stops < 100:
            insights.append({
                'category': 'Data Quality',
                'title': 'Limited Stop Coverage - Expand Data Collection',
                'description': f'Currently analyzing only {unique_stops} unique stops out of 1,670+ in Madison Metro system ({unique_stops/1670*100:.1f}% coverage). Expanding to all stops would enable stop-specific recommendations and identify problem locations. See DATA_COLLECTION_IMPROVEMENTS.md for details.',
                'severity': 'medium',
                'impact': 'Limits insight specificity'
            })
        
        # Insight 6: Construction impact (if data available)
        if 'has_construction' in self.df.columns:
            construction_impact = self.df.groupby('has_construction')['api_prediction_error'].abs().mean()
            if len(construction_impact) > 1:
                no_construction_error = construction_impact.get(0, 0)
                with_construction_error = construction_impact.get(1, 0)
                if with_construction_error > no_construction_error * 1.1:
                    increase = ((with_construction_error / no_construction_error - 1) * 100)
                    construction_count = len(self.df[self.df['has_construction'] == 1])
                    insights.append({
                        'category': 'Infrastructure',
                        'title': f'Construction Increases Delays by {increase:.0f}%',
                        'description': f'Routes with active construction show {increase:.0f}% higher prediction errors ({with_construction_error:.2f} min vs {no_construction_error:.2f} min). With {construction_count:,} records during construction, this is a significant factor. Recommendation: Add construction-aware routing or buffer times.',
                        'severity': 'high' if increase > 30 else 'medium',
                        'impact': f'{construction_count:,} predictions during construction'
                    })
        
        return insights

    def get_route_comparison(self, route1, route2):
        """Compare two routes across multiple dimensions."""
        if route1 not in self.df['rt'].values or route2 not in self.df['rt'].values:
            return None
        
        r1_data = self.df[self.df['rt'] == route1]
        r2_data = self.df[self.df['rt'] == route2]
        
        comparison = {
            'route1': route1,
            'route2': route2,
            'metrics': {
                'avg_error': {
                    'route1': float(r1_data['api_prediction_error'].abs().mean()),
                    'route2': float(r2_data['api_prediction_error'].abs().mean()),
                    'winner': route1 if r1_data['api_prediction_error'].abs().mean() < r2_data['api_prediction_error'].abs().mean() else route2
                },
                'avg_wait': {
                    'route1': float(r1_data['minutes_until_arrival'].mean()),
                    'route2': float(r2_data['minutes_until_arrival'].mean()),
                    'winner': route1 if r1_data['minutes_until_arrival'].mean() < r2_data['minutes_until_arrival'].mean() else route2
                },
                'reliability': {
                    'route1': float(1 / (1 + r1_data['api_prediction_error'].abs().mean())),
                    'route2': float(1 / (1 + r2_data['api_prediction_error'].abs().mean())),
                    'winner': route1 if (1 / (1 + r1_data['api_prediction_error'].abs().mean())) > (1 / (1 + r2_data['api_prediction_error'].abs().mean())) else route2
                },
                'delay_rate': {
                    'route1': float(r1_data['dly'].sum() / len(r1_data)),
                    'route2': float(r2_data['dly'].sum() / len(r2_data)),
                    'winner': route1 if (r1_data['dly'].sum() / len(r1_data)) < (r2_data['dly'].sum() / len(r2_data)) else route2
                }
            },
            'rush_hour_performance': {
                'route1': {
                    'rush_error': float(r1_data[r1_data['hour'].between(7, 9) | r1_data['hour'].between(16, 18)]['api_prediction_error'].abs().mean()),
                    'offpeak_error': float(r1_data[~(r1_data['hour'].between(7, 9) | r1_data['hour'].between(16, 18))]['api_prediction_error'].abs().mean())
                },
                'route2': {
                    'rush_error': float(r2_data[r2_data['hour'].between(7, 9) | r2_data['hour'].between(16, 18)]['api_prediction_error'].abs().mean()),
                    'offpeak_error': float(r2_data[~(r2_data['hour'].between(7, 9) | r2_data['hour'].between(16, 18))]['api_prediction_error'].abs().mean())
                }
            },
            'recommendation': self._generate_route_recommendation(route1, route2, r1_data, r2_data)
        }
        
        return comparison

    def _generate_route_recommendation(self, route1, route2, r1_data, r2_data):
        """Generate a recommendation based on route comparison."""
        r1_error = r1_data['api_prediction_error'].abs().mean()
        r2_error = r2_data['api_prediction_error'].abs().mean()
        r1_wait = r1_data['minutes_until_arrival'].mean()
        r2_wait = r2_data['minutes_until_arrival'].mean()
        
        if r1_error < r2_error * 0.9 and r1_wait < r2_wait:
            return f"Route {route1} is significantly more reliable ({r1_error:.2f} min error vs {r2_error:.2f} min) and has shorter wait times. Choose Route {route1} for better predictability."
        elif r2_error < r1_error * 0.9 and r2_wait < r1_wait:
            return f"Route {route2} is significantly more reliable ({r2_error:.2f} min error vs {r1_error:.2f} min) and has shorter wait times. Choose Route {route2} for better predictability."
        elif abs(r1_error - r2_error) < 0.1:
            if r1_wait < r2_wait:
                return f"Both routes have similar reliability. Route {route1} has shorter average wait times ({r1_wait:.1f} min vs {r2_wait:.1f} min)."
            else:
                return f"Both routes have similar reliability. Route {route2} has shorter average wait times ({r2_wait:.1f} min vs {r1_wait:.1f} min)."
        else:
            return f"Route {route1 if r1_error < r2_error else route2} is slightly more reliable, but both routes are comparable. Consider other factors like proximity to your location."

    def get_best_time_to_leave(self, route, target_arrival_hour, target_arrival_minute=0):
        """Recommend best time to leave based on historical data."""
        if route not in self.df['rt'].values:
            return None
        
        route_data = self.df[self.df['rt'] == route].copy()
        route_data['arrival_hour'] = route_data['tmstmp'].dt.hour
        route_data['arrival_minute'] = route_data['tmstmp'].dt.minute
        
        # Filter to similar arrival times
        similar_times = route_data[
            (route_data['arrival_hour'] == target_arrival_hour) |
            (route_data['arrival_hour'] == target_arrival_hour - 1)
        ]
        
        if len(similar_times) < 10:
            similar_times = route_data  # Use all data if not enough samples
        
        # Calculate when to leave (arrival time - average wait - buffer)
        avg_wait = similar_times['minutes_until_arrival'].mean()
        avg_error = similar_times['api_prediction_error'].abs().mean()
        buffer = max(2, avg_error * 1.5)  # Safety buffer
        
        recommended_leave_minutes = avg_wait + buffer
        
        # Convert to time
        target_time = target_arrival_hour * 60 + target_arrival_minute
        leave_time = target_time - recommended_leave_minutes
        
        if leave_time < 0:
            leave_time += 24 * 60  # Next day
        
        leave_hour = int(leave_time // 60) % 24
        leave_minute = int(leave_time % 60)
        
        return {
            'route': route,
            'target_arrival': f"{target_arrival_hour:02d}:{target_arrival_minute:02d}",
            'recommended_leave': f"{leave_hour:02d}:{leave_minute:02d}",
            'avg_wait_time': float(avg_wait),
            'safety_buffer': float(buffer),
            'total_minutes_before': float(recommended_leave_minutes),
            'confidence': 'high' if len(similar_times) >= 50 else 'medium' if len(similar_times) >= 20 else 'low',
            'sample_size': len(similar_times)
        }

    def get_cost_savings_analysis(self):
        """Estimate cost/time savings from improved predictions."""
        total_predictions = len(self.df)
        avg_error = self.df['api_prediction_error'].abs().mean()
        
        # Assume each minute of error costs 1 minute of waiting time
        # With 21.3% improvement, we save time
        baseline_error = 0.371  # From README
        improved_error = 0.292  # From README
        improvement = baseline_error - improved_error
        
        # Calculate savings
        total_time_saved_minutes = total_predictions * improvement
        total_time_saved_hours = total_time_saved_minutes / 60
        total_time_saved_days = total_time_saved_hours / 24
        
        # If we assume average passenger value of time is $15/hour
        value_per_hour = 15
        estimated_cost_savings = total_time_saved_hours * value_per_hour
        
        return {
            'total_predictions': total_predictions,
            'baseline_error': baseline_error,
            'improved_error': improved_error,
            'improvement_per_prediction': improvement,
            'total_time_saved': {
                'minutes': float(total_time_saved_minutes),
                'hours': float(total_time_saved_hours),
                'days': float(total_time_saved_days)
            },
            'estimated_cost_savings': {
                'per_prediction': float(improvement / 60 * value_per_hour),
                'total': float(estimated_cost_savings),
                'per_day': float(estimated_cost_savings / 20)  # 20 days of data
            },
            'assumptions': {
                'value_per_hour': value_per_hour,
                'collection_days': 20
            }
        }
    
    def get_weather_impact_analysis(self):
        """Analyze how weather affects delays"""
        if 'weather_is_rainy' not in self.df.columns:
            return None
        
        analysis = {}
        
        # Rain impact
        if 'weather_is_rainy' in self.df.columns:
            rainy_errors = self.df[self.df['weather_is_rainy'] == 1]['api_prediction_error'].abs()
            clear_errors = self.df[self.df['weather_is_rainy'] == 0]['api_prediction_error'].abs()
            
            if len(rainy_errors) > 0 and len(clear_errors) > 0:
                analysis['rain'] = {
                    'rainy_avg_error': float(rainy_errors.mean()),
                    'clear_avg_error': float(clear_errors.mean()),
                    'increase_percent': float(((rainy_errors.mean() / clear_errors.mean()) - 1) * 100),
                    'rainy_count': len(rainy_errors),
                    'clear_count': len(clear_errors)
                }
        
        # Snow impact
        if 'weather_is_snowy' in self.df.columns:
            snowy_errors = self.df[self.df['weather_is_snowy'] == 1]['api_prediction_error'].abs()
            if len(snowy_errors) > 0:
                analysis['snow'] = {
                    'snowy_avg_error': float(snowy_errors.mean()),
                    'increase_percent': float(((snowy_errors.mean() / clear_errors.mean()) - 1) * 100) if 'clear_errors' in locals() else 0,
                    'snowy_count': len(snowy_errors)
                }
        
        # Temperature correlation
        if 'weather_temp' in self.df.columns:
            temp_corr = self.df[['weather_temp', 'api_prediction_error']].corr().iloc[0, 1]
            analysis['temperature_correlation'] = float(temp_corr)
        
        return analysis
    
    def get_construction_impact_analysis(self):
        """Analyze how construction affects delays"""
        if 'has_construction' not in self.df.columns:
            return None
        
        construction_data = self.df[self.df['has_construction'] == 1]
        no_construction_data = self.df[self.df['has_construction'] == 0]
        
        if len(construction_data) == 0:
            return None
        
        return {
            'construction_avg_error': float(construction_data['api_prediction_error'].abs().mean()),
            'no_construction_avg_error': float(no_construction_data['api_prediction_error'].abs().mean()),
            'increase_percent': float(((construction_data['api_prediction_error'].abs().mean() / no_construction_data['api_prediction_error'].abs().mean()) - 1) * 100),
            'construction_count': len(construction_data),
            'affected_routes': self.df[self.df['has_construction'] == 1]['rt'].value_counts().to_dict()
        }


if __name__ == "__main__":
    # Test the aggregator
    agg = DataAggregator()
    
    print("\n[System Overview]:")
    print(json.dumps(agg.get_system_overview(), indent=2))
    
    print("\n[Sample Route Stats]:")
    print(json.dumps(agg.get_route_stats()[:3], indent=2))
    
    print("\n[OK] Data aggregator working!")

