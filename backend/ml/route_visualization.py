#!/usr/bin/env python3
"""
Madison Metro Route Visualization
Let's create some badass route maps and analyze what we actually have!
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import glob
import os
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

class MadisonMetroRouteAnalyzer:
    def __init__(self, data_dir="../collected_data"):
        self.data_dir = data_dir
        self.vehicle_data = None
        self.prediction_data = None
        
    def load_data(self):
        """Load all the data"""
        print("📊 Loading Madison Metro data...")
        
        # Load vehicle data
        vehicle_files = glob.glob(os.path.join(self.data_dir, "vehicles_*.csv"))
        vehicle_dfs = []
        for file in vehicle_files:
            df = pd.read_csv(file)
            vehicle_dfs.append(df)
        self.vehicle_data = pd.concat(vehicle_dfs, ignore_index=True)
        
        # Load prediction data
        prediction_files = glob.glob(os.path.join(self.data_dir, "predictions_*.csv"))
        prediction_dfs = []
        for file in prediction_files:
            df = pd.read_csv(file)
            prediction_dfs.append(df)
        self.prediction_data = pd.concat(prediction_dfs, ignore_index=True)
        
        print(f"✅ Loaded {len(self.vehicle_data):,} vehicle records")
        print(f"✅ Loaded {len(self.prediction_data):,} prediction records")
        
        return True
    
    def analyze_route_data(self):
        """Analyze what we actually have"""
        print("🔍 Analyzing route data...")
        
        # Process timestamps
        self.vehicle_data['timestamp'] = pd.to_datetime(self.vehicle_data['tmstmp'])
        self.vehicle_data['hour'] = self.vehicle_data['timestamp'].dt.hour
        self.vehicle_data['day_of_week'] = self.vehicle_data['timestamp'].dt.dayofweek
        
        # Clean numeric data
        self.vehicle_data['lat'] = pd.to_numeric(self.vehicle_data['lat'], errors='coerce')
        self.vehicle_data['lon'] = pd.to_numeric(self.vehicle_data['lon'], errors='coerce')
        self.vehicle_data['spd'] = pd.to_numeric(self.vehicle_data['spd'], errors='coerce')
        self.vehicle_data['psgld'] = pd.to_numeric(self.vehicle_data['psgld'], errors='coerce')
        self.vehicle_data['vid'] = pd.to_numeric(self.vehicle_data['vid'], errors='coerce')
        
        # Remove invalid coordinates
        self.vehicle_data = self.vehicle_data.dropna(subset=['lat', 'lon'])
        
        print(f"✅ Cleaned data: {len(self.vehicle_data):,} valid records")
        print(f"✅ Routes: {sorted(self.vehicle_data['rt'].unique())}")
        print(f"✅ Date range: {self.vehicle_data['timestamp'].min()} to {self.vehicle_data['timestamp'].max()}")
        
        return True
    
    def create_route_map(self):
        """Create an interactive route map"""
        print("🗺️ Creating interactive route map...")
        
        # Sample data for performance
        sample_data = self.vehicle_data.sample(min(50000, len(self.vehicle_data)))
        
        # Create the map
        fig = px.scatter_mapbox(
            sample_data,
            lat='lat',
            lon='lon',
            color='rt',
            size='spd',
            hover_data=['spd', 'psgld', 'hour', 'day_of_week'],
            title='Madison Metro Bus Routes - Real-Time Locations',
            mapbox_style='open-street-map',
            zoom=11,
            center={'lat': 43.0731, 'lon': -89.4012}  # Madison center
        )
        
        fig.update_layout(
            height=800,
            title_font_size=20,
            showlegend=True
        )
        
        fig.write_html('visualizations/madison_metro_routes.html')
        print("✅ Route map saved to visualizations/madison_metro_routes.html")
        
        return True
    
    def create_route_analysis(self):
        """Analyze route performance and patterns"""
        print("📈 Creating route analysis...")
        
        # Route statistics
        route_stats = self.vehicle_data.groupby('rt').agg({
            'lat': ['count', 'mean'],
            'lon': 'mean',
            'spd': ['mean', 'std'],
            'psgld': ['mean', 'std'],
            'hour': ['min', 'max']
        }).round(2)
        
        route_stats.columns = ['trip_count', 'avg_lat', 'avg_lon', 'avg_speed', 'speed_std', 
                              'avg_passengers', 'passenger_std', 'earliest_hour', 'latest_hour']
        route_stats = route_stats.reset_index()
        
        # Create visualizations
        fig, axes = plt.subplots(2, 2, figsize=(20, 16))
        
        # 1. Route frequency
        route_counts = self.vehicle_data['rt'].value_counts()
        route_counts.plot(kind='barh', ax=axes[0,0], color='skyblue')
        axes[0,0].set_title('Bus Frequency by Route', fontsize=14, fontweight='bold')
        axes[0,0].set_xlabel('Number of Records')
        
        # 2. Average speed by route
        route_speeds = self.vehicle_data.groupby('rt')['spd'].mean()
        route_speeds.plot(kind='barh', ax=axes[0,1], color='lightcoral')
        axes[0,1].set_title('Average Speed by Route', fontsize=14, fontweight='bold')
        axes[0,1].set_xlabel('Speed (mph)')
        
        # 3. Speed distribution
        self.vehicle_data['spd'].hist(bins=50, ax=axes[1,0], alpha=0.7, color='lightgreen')
        axes[1,0].set_title('Speed Distribution Across All Routes', fontsize=14, fontweight='bold')
        axes[1,0].set_xlabel('Speed (mph)')
        axes[1,0].set_ylabel('Frequency')
        axes[1,0].axvline(self.vehicle_data['spd'].mean(), color='red', linestyle='--', 
                         label=f'Mean: {self.vehicle_data["spd"].mean():.1f} mph')
        axes[1,0].legend()
        
        # 4. Hourly activity
        hourly_activity = self.vehicle_data.groupby('hour').size()
        hourly_activity.plot(kind='line', ax=axes[1,1], marker='o', color='purple', linewidth=2)
        axes[1,1].set_title('Bus Activity by Hour of Day', fontsize=14, fontweight='bold')
        axes[1,1].set_xlabel('Hour of Day')
        axes[1,1].set_ylabel('Number of Records')
        axes[1,1].grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.savefig('visualizations/route_analysis.png', dpi=300, bbox_inches='tight')
        plt.show()
        
        return True
    
    def create_3d_route_visualization(self):
        """Create a 3D visualization of routes"""
        print("🚀 Creating 3D route visualization...")
        
        # Sample data for performance
        sample_data = self.vehicle_data.sample(min(10000, len(self.vehicle_data)))
        
        # Create 3D scatter plot
        fig = px.scatter_3d(
            sample_data,
            x='lon',
            y='lat',
            z='spd',
            color='rt',
            size='psgld',
            title='3D Madison Metro Route Visualization',
            labels={'spd': 'Speed (mph)', 'lat': 'Latitude', 'lon': 'Longitude'}
        )
        
        fig.update_layout(
            height=800,
            scene=dict(
                xaxis_title='Longitude',
                yaxis_title='Latitude',
                zaxis_title='Speed (mph)'
            )
        )
        
        fig.write_html('visualizations/3d_route_visualization.html')
        print("✅ 3D visualization saved to visualizations/3d_route_visualization.html")
        
        return True
    
    def create_route_heatmap(self):
        """Create a heatmap of bus activity"""
        print("🔥 Creating route activity heatmap...")
        
        # Create hour vs day of week heatmap
        activity_pivot = self.vehicle_data.groupby(['day_of_week', 'hour']).size().unstack(fill_value=0)
        
        fig, ax = plt.subplots(figsize=(16, 8))
        sns.heatmap(activity_pivot, annot=True, fmt='d', cmap='YlOrRd', ax=ax)
        ax.set_title('Madison Metro Bus Activity Heatmap', fontsize=16, fontweight='bold')
        ax.set_xlabel('Hour of Day')
        ax.set_ylabel('Day of Week (0=Monday)')
        
        plt.tight_layout()
        plt.savefig('visualizations/activity_heatmap.png', dpi=300, bbox_inches='tight')
        plt.show()
        
        return True
    
    def create_summary_report(self):
        """Create a comprehensive summary report"""
        print("📊 Creating summary report...")
        
        # Calculate statistics
        stats = {
            'Total Records': len(self.vehicle_data),
            'Unique Routes': self.vehicle_data['rt'].nunique(),
            'Unique Vehicles': self.vehicle_data['vid'].nunique(),
            'Date Range': f"{self.vehicle_data['timestamp'].min().date()} to {self.vehicle_data['timestamp'].max().date()}",
            'Average Speed': f"{self.vehicle_data['spd'].mean():.2f} mph",
            'Max Speed': f"{self.vehicle_data['spd'].max():.2f} mph",
            'Average Passengers': f"{self.vehicle_data['psgld'].mean():.2f}",
            'Most Active Route': self.vehicle_data['rt'].value_counts().index[0],
            'Peak Hour': self.vehicle_data.groupby('hour').size().idxmax(),
            'Coverage Area': f"{self.vehicle_data['lat'].max() - self.vehicle_data['lat'].min():.3f}° lat × {self.vehicle_data['lon'].max() - self.vehicle_data['lon'].min():.3f}° lon"
        }
        
        # Create summary visualization
        fig, ax = plt.subplots(figsize=(12, 8))
        ax.axis('off')
        
        summary_text = "🏆 MADISON METRO ROUTE ANALYSIS 🏆\n\n"
        for key, value in stats.items():
            summary_text += f"• {key}: {value}\n"
        
        summary_text += f"\n🎯 KEY INSIGHTS:\n"
        summary_text += f"• We have {len(self.vehicle_data):,} real-time bus location records\n"
        summary_text += f"• {self.vehicle_data['rt'].nunique()} different routes tracked\n"
        summary_text += f"• Data spans {len(self.vehicle_data['timestamp'].dt.date.unique())} days\n"
        summary_text += f"• Average bus speed: {self.vehicle_data['spd'].mean():.1f} mph\n"
        summary_text += f"• Peak activity: {self.vehicle_data.groupby('hour').size().idxmax()}:00\n"
        
        ax.text(0.1, 0.9, summary_text, transform=ax.transAxes, fontsize=12,
                verticalalignment='top', fontfamily='monospace',
                bbox=dict(boxstyle="round,pad=0.5", facecolor="lightblue", alpha=0.8))
        
        plt.title('Madison Metro Route Analysis Summary', fontsize=16, fontweight='bold', pad=20)
        plt.savefig('visualizations/route_summary.png', dpi=300, bbox_inches='tight')
        plt.show()
        
        return stats
    
    def run_analysis(self):
        """Run the complete route analysis"""
        print("🚀 Starting Madison Metro Route Analysis")
        print("="*60)
        
        # Create output directory
        os.makedirs('visualizations', exist_ok=True)
        
        try:
            self.load_data()
            self.analyze_route_data()
            self.create_route_map()
            self.create_route_analysis()
            self.create_3d_route_visualization()
            self.create_route_heatmap()
            stats = self.create_summary_report()
            
            print("\n✅ Route Analysis Complete!")
            print("📁 Check the 'visualizations' folder for all outputs")
            print("🌐 Open the .html files in your browser for interactive maps")
            
            return True
            
        except Exception as e:
            print(f"❌ Analysis failed: {str(e)}")
            return False

if __name__ == "__main__":
    analyzer = MadisonMetroRouteAnalyzer()
    analyzer.run_analysis()
