"""
Advanced Geospatial Analysis for Madison Metro Transit
Inspired by: https://www.kaggle.com/code/virajkadam/geospatial-analysis-of-bus-routes
"""
import pandas as pd
import numpy as np
from scipy.spatial import ConvexHull
from sklearn.cluster import DBSCAN
from collections import defaultdict

class GeospatialAnalyzer:
    def __init__(self, df):
        """Initialize with DataFrame containing lat, lon, and error data"""
        self.df = df[df[['lat', 'lon']].notna().all(axis=1)].copy()
        print(f"[Geospatial] Loaded {len(self.df):,} records with coordinates")

    def hexbin_aggregation(self, gridsize=20):
        """
        Aggregate delay data into hexagonal bins for cleaner visualization
        Better than individual points for dense data
        """
        from scipy.stats import binned_statistic_2d

        # Define grid bounds
        lat_min, lat_max = self.df['lat'].min(), self.df['lat'].max()
        lon_min, lon_max = self.df['lon'].min(), self.df['lon'].max()

        # Create bins
        lat_bins = np.linspace(lat_min, lat_max, gridsize)
        lon_bins = np.linspace(lon_min, lon_max, gridsize)

        # Aggregate error by hexbin
        result = binned_statistic_2d(
            self.df['lat'].values,
            self.df['lon'].values,
            self.df['api_prediction_error'].abs().values,
            statistic='mean',
            bins=[lat_bins, lon_bins]
        )

        # Convert to list of hex cells with data
        hexbins = []
        for i in range(len(lat_bins) - 1):
            for j in range(len(lon_bins) - 1):
                error = result.statistic[i, j]
                if not np.isnan(error):
                    hexbins.append({
                        'lat': (lat_bins[i] + lat_bins[i+1]) / 2,
                        'lon': (lon_bins[j] + lon_bins[j+1]) / 2,
                        'avg_error': float(error),
                        'lat_min': float(lat_bins[i]),
                        'lat_max': float(lat_bins[i+1]),
                        'lon_min': float(lon_bins[j]),
                        'lon_max': float(lon_bins[j+1])
                    })

        return sorted(hexbins, key=lambda x: x['avg_error'], reverse=True)

    def corridor_analysis(self):
        """
        Identify high-traffic corridors and their performance
        Groups stops by geographic proximity and route overlap
        """
        # Use DBSCAN to cluster nearby stops
        coords = self.df[['lat', 'lon']].drop_duplicates().values

        # DBSCAN with ~300m radius (rough approximation in degrees)
        epsilon = 0.003  # ~300 meters at Madison's latitude
        clustering = DBSCAN(eps=epsilon, min_samples=3).fit(coords)

        clusters = defaultdict(list)
        for idx, label in enumerate(clustering.labels_):
            if label != -1:  # Ignore noise
                lat, lon = coords[idx]
                # Find all data points in this cluster
                mask = (self.df['lat'].between(lat - epsilon, lat + epsilon) &
                       self.df['lon'].between(lon - epsilon, lon + epsilon))
                clusters[label].extend(self.df[mask].index.tolist())

        # Analyze each corridor
        corridors = []
        for cluster_id, indices in clusters.items():
            if len(indices) < 50:  # Skip small clusters
                continue

            cluster_data = self.df.loc[indices]

            # Calculate corridor metrics
            corridor = {
                'cluster_id': int(cluster_id),
                'center_lat': float(cluster_data['lat'].mean()),
                'center_lon': float(cluster_data['lon'].mean()),
                'num_stops': int(cluster_data['stpid'].nunique()),
                'num_routes': int(cluster_data['rt'].nunique()),
                'total_predictions': len(cluster_data),
                'avg_error': float(cluster_data['api_prediction_error'].abs().mean()),
                'error_std': float(cluster_data['api_prediction_error'].std()),
                'routes': cluster_data['rt'].unique().tolist()[:10],  # Top 10 routes
                'peak_hour': int(cluster_data['hour'].mode().iloc[0]) if 'hour' in cluster_data.columns else None
            }
            corridors.append(corridor)

        return sorted(corridors, key=lambda x: x['total_predictions'], reverse=True)

    def stop_density_heatmap(self):
        """
        Calculate stop density and service frequency by area
        Shows where transit access is concentrated
        """
        # Group by stop
        stop_data = self.df.groupby(['stpid', 'stpnm', 'lat', 'lon']).agg({
            'rt': 'nunique',  # Number of routes serving stop
            'api_prediction_error': ['count', 'mean'],
            'minutes_until_arrival': 'mean'
        }).reset_index()

        stop_data.columns = ['stpid', 'stpnm', 'lat', 'lon', 'num_routes', 'frequency', 'avg_error', 'avg_wait']

        # Add density metric (routes × frequency)
        stop_data['density_score'] = stop_data['num_routes'] * np.log1p(stop_data['frequency'])

        return stop_data.nlargest(100, 'density_score').to_dict('records')

    def route_coverage_analysis(self):
        """
        Analyze geographic coverage of each route
        Calculate service area, span, and compactness
        """
        route_coverage = []

        for route in self.df['rt'].unique():
            route_data = self.df[self.df['rt'] == route]

            if len(route_data) < 10:
                continue

            # Geographic extent
            lat_span = route_data['lat'].max() - route_data['lat'].min()
            lon_span = route_data['lon'].max() - route_data['lon'].min()

            # Approximate service area using convex hull
            try:
                coords = route_data[['lat', 'lon']].drop_duplicates().values
                if len(coords) >= 3:
                    hull = ConvexHull(coords)
                    service_area = float(hull.volume)  # In square degrees
                else:
                    service_area = 0.0
            except:
                service_area = 0.0

            coverage = {
                'route': route,
                'num_stops': int(route_data['stpid'].nunique()),
                'lat_span_km': float(lat_span * 111),  # Rough conversion to km
                'lon_span_km': float(lon_span * 111 * np.cos(np.radians(route_data['lat'].mean()))),
                'service_area_sq_km': float(service_area * 111 * 111),  # Square km
                'avg_error': float(route_data['api_prediction_error'].abs().mean()),
                'total_predictions': len(route_data),
                'center_lat': float(route_data['lat'].mean()),
                'center_lon': float(route_data['lon'].mean())
            }
            route_coverage.append(coverage)

        return sorted(route_coverage, key=lambda x: x['service_area_sq_km'], reverse=True)

    def delay_propagation_analysis(self):
        """
        Analyze how delays propagate geographically along routes
        Identify if delays cluster or spread across service area
        """
        # Group by route and sort by time
        propagation = []

        for route in self.df['rt'].unique()[:10]:  # Top 10 routes
            route_data = self.df[self.df['rt'] == route].sort_values('tmstmp')

            if len(route_data) < 100:
                continue

            # Calculate spatial autocorrelation of errors
            # Simple version: correlation between nearby stops' errors
            route_data = route_data.sort_values(['lat', 'lon'])
            errors = route_data['api_prediction_error'].values

            # Lag-1 autocorrelation
            if len(errors) > 1:
                correlation = float(np.corrcoef(errors[:-1], errors[1:])[0, 1])
            else:
                correlation = 0.0

            propagation.append({
                'route': route,
                'spatial_autocorrelation': correlation,
                'interpretation': 'High clustering' if abs(correlation) > 0.3 else 'Dispersed delays',
                'avg_error': float(route_data['api_prediction_error'].abs().mean()),
                'sample_size': len(route_data)
            })

        return propagation


if __name__ == "__main__":
    # Test the analyzer
    print("Loading data...")
    df = pd.read_csv('ml/data/consolidated_metro_data.csv')
    df['tmstmp'] = pd.to_datetime(df['tmstmp'])
    df['hour'] = df['tmstmp'].dt.hour

    analyzer = GeospatialAnalyzer(df)

    print("\n[Hexbin Aggregation]")
    hexbins = analyzer.hexbin_aggregation(gridsize=15)
    print(f"Created {len(hexbins)} hexbins")
    print(f"Worst hexbin: {hexbins[0]['avg_error']:.2f} min avg error")

    print("\n[Corridor Analysis]")
    corridors = analyzer.corridor_analysis()
    print(f"Identified {len(corridors)} corridors")
    if corridors:
        print(f"Busiest: {corridors[0]['num_routes']} routes, {corridors[0]['total_predictions']:,} predictions")

    print("\n[Stop Density]")
    density = analyzer.stop_density_heatmap()
    print(f"Analyzed {len(density)} high-density stops")

    print("\n[Route Coverage]")
    coverage = analyzer.route_coverage_analysis()
    print(f"Analyzed {len(coverage)} routes")
    if coverage:
        print(f"Largest coverage: Route {coverage[0]['route']} - {coverage[0]['service_area_sq_km']:.1f} sq km")
