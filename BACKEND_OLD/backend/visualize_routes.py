#!/usr/bin/env python3
"""
Madison Metro Route Visualization
Creates interactive maps showing bus routes and vehicle positions from collected data
"""

import pandas as pd
import folium
import os
import glob
from datetime import datetime
import json
from typing import List, Dict, Tuple
import numpy as np

class RouteVisualizer:
    def __init__(self, data_dir: str = "collected_data"):
        self.data_dir = data_dir
        self.madison_center = [43.0731, -89.4012]  # Madison, WI center coordinates
        
    def load_latest_data(self) -> pd.DataFrame:
        """Load the most recent vehicle data file"""
        vehicle_files = glob.glob(f"{self.data_dir}/vehicles_*.csv")
        if not vehicle_files:
            raise FileNotFoundError(f"No vehicle data files found in {self.data_dir}")
        
        # Get the file with the most data (largest file size)
        largest_file = max(vehicle_files, key=os.path.getsize)
        print(f"Loading data from: {largest_file}")
        
        df = pd.read_csv(largest_file)
        print(f"Loaded {len(df)} vehicle records")
        return df
    
    def get_route_colors(self) -> Dict[str, str]:
        """Define colors for different route types"""
        return {
            # Rapid routes (BRT) - Bright colors
            'A': '#FF0000',  # Red
            'B': '#00FF00',  # Green  
            'C': '#0000FF',  # Blue
            'D': '#FF00FF',  # Magenta
            'E': '#00FFFF',  # Cyan
            'F': '#FFFF00',  # Yellow
            
            # UW Campus routes - Purple shades
            '80': '#800080',  # Purple
            '81': '#9932CC',  # Dark Orchid
            '82': '#8A2BE2',  # Blue Violet
            '84': '#9400D3',  # Dark Violet
            
            # Major local routes - Orange shades
            '28': '#FF8C00',  # Dark Orange
            '38': '#FF7F50',  # Coral
            
            # Other local routes - Various colors
            'G': '#32CD32',   # Lime Green
            'H': '#FF1493',   # Deep Pink
            'J': '#1E90FF',   # Dodger Blue
            'L': '#FFD700',   # Gold
            'O': '#FF69B4',   # Hot Pink
            'P': '#00CED1',   # Dark Turquoise
            'R': '#FF4500',   # Orange Red
            'S': '#9370DB',   # Medium Purple
            'W': '#20B2AA',   # Light Sea Green
        }
    
    def create_route_map(self, df: pd.DataFrame) -> folium.Map:
        """Create an interactive map showing all routes and vehicles"""
        # Create base map centered on Madison
        m = folium.Map(
            location=self.madison_center,
            zoom_start=12,
            tiles='OpenStreetMap'
        )
        
        # Get route colors
        route_colors = self.get_route_colors()
        
        # Group data by route
        routes = df['rt'].unique()
        print(f"Found {len(routes)} unique routes: {sorted(routes)}")
        
        # Add each route as a separate layer
        for route in sorted(routes):
            route_data = df[df['rt'] == route]
            if len(route_data) == 0:
                continue
                
            # Get color for this route
            color = route_colors.get(route, '#808080')  # Default gray
            
            # Create route layer
            route_group = folium.FeatureGroup(name=f"Route {route}")
            
            # Add vehicle positions for this route
            for _, vehicle in route_data.iterrows():
                if pd.isna(vehicle['lat']) or pd.isna(vehicle['lon']):
                    continue
                    
                # Create popup with vehicle info
                popup_text = f"""
                <b>Route {vehicle['rt']}</b><br>
                Vehicle ID: {vehicle['vid']}<br>
                Destination: {vehicle['des']}<br>
                Speed: {vehicle['spd']} mph<br>
                Delay: {'Yes' if vehicle['dly'] else 'No'}<br>
                Passengers: {vehicle['psgld']}<br>
                Time: {vehicle['tmstmp']}
                """
                
                # Add marker for vehicle position
                folium.CircleMarker(
                    location=[vehicle['lat'], vehicle['lon']],
                    radius=6,
                    popup=folium.Popup(popup_text, max_width=200),
                    color='black',
                    weight=2,
                    fillColor=color,
                    fillOpacity=0.8,
                    tooltip=f"Route {route} - Vehicle {vehicle['vid']}"
                ).add_to(route_group)
            
            # Add route group to map
            route_group.add_to(m)
        
        # Add layer control
        folium.LayerControl().add_to(m)
        
        # Add title
        title_html = '''
        <h3 align="center" style="font-size:20px"><b>Madison Metro Bus Routes & Vehicle Positions</b></h3>
        '''
        m.get_root().html.add_child(folium.Element(title_html))
        
        return m
    
    def create_route_density_map(self, df: pd.DataFrame) -> folium.Map:
        """Create a heatmap showing route density"""
        m = folium.Map(
            location=self.madison_center,
            zoom_start=12,
            tiles='OpenStreetMap'
        )
        
        # Prepare data for heatmap
        heat_data = []
        for _, vehicle in df.iterrows():
            if pd.notna(vehicle['lat']) and pd.notna(vehicle['lon']):
                heat_data.append([vehicle['lat'], vehicle['lon']])
        
        # Add heatmap
        from folium.plugins import HeatMap
        HeatMap(heat_data, radius=15, blur=10, max_zoom=1).add_to(m)
        
        # Add title
        title_html = '''
        <h3 align="center" style="font-size:20px"><b>Madison Metro Vehicle Density Heatmap</b></h3>
        '''
        m.get_root().html.add_child(folium.Element(title_html))
        
        return m
    
    def create_route_analysis_map(self, df: pd.DataFrame) -> folium.Map:
        """Create a map with route analysis and statistics"""
        m = folium.Map(
            location=self.madison_center,
            zoom_start=12,
            tiles='OpenStreetMap'
        )
        
        route_colors = self.get_route_colors()
        
        # Calculate route statistics
        route_stats = df.groupby('rt').agg({
            'vid': 'count',
            'dly': 'sum',
            'spd': 'mean',
            'psgld': lambda x: (x == 'HALF_EMPTY').sum() + (x == 'EMPTY').sum()
        }).round(2)
        
        route_stats.columns = ['vehicle_count', 'delayed_vehicles', 'avg_speed', 'empty_vehicles']
        route_stats['delay_rate'] = (route_stats['delayed_vehicles'] / route_stats['vehicle_count'] * 100).round(1)
        
        # Add route statistics as markers
        for route, stats in route_stats.iterrows():
            route_data = df[df['rt'] == route]
            if len(route_data) == 0:
                continue
                
            # Calculate center point for this route
            center_lat = route_data['lat'].mean()
            center_lon = route_data['lon'].mean()
            
            if pd.isna(center_lat) or pd.isna(center_lon):
                continue
            
            color = route_colors.get(route, '#808080')
            
            # Create detailed popup
            popup_text = f"""
            <b>Route {route} Statistics</b><br>
            Vehicles: {stats['vehicle_count']}<br>
            Delayed: {stats['delayed_vehicles']} ({stats['delay_rate']}%)<br>
            Avg Speed: {stats['avg_speed']} mph<br>
            Empty Vehicles: {stats['empty_vehicles']}
            """
            
            # Add marker for route center
            folium.CircleMarker(
                location=[center_lat, center_lon],
                radius=10,
                popup=folium.Popup(popup_text, max_width=250),
                color='black',
                weight=2,
                fillColor=color,
                fillOpacity=0.7,
                tooltip=f"Route {route} - {stats['vehicle_count']} vehicles"
            ).add_to(m)
        
        # Add title
        title_html = '''
        <h3 align="center" style="font-size:20px"><b>Madison Metro Route Analysis</b></h3>
        '''
        m.get_root().html.add_child(folium.Element(title_html))
        
        return m
    
    def save_map(self, map_obj: folium.Map, filename: str):
        """Save map to HTML file"""
        output_path = f"{self.data_dir}/{filename}"
        map_obj.save(output_path)
        print(f"Map saved to: {output_path}")
        return output_path
    
    def generate_all_maps(self):
        """Generate all visualization maps"""
        try:
            # Load data
            df = self.load_latest_data()
            
            print("Generating route visualization maps...")
            
            # Create route map
            route_map = self.create_route_map(df)
            route_file = self.save_map(route_map, "madison_metro_routes.html")
            
            # Create density map
            density_map = self.create_route_density_map(df)
            density_file = self.save_map(density_map, "madison_metro_density.html")
            
            # Create analysis map
            analysis_map = self.create_route_analysis_map(df)
            analysis_file = self.save_map(analysis_map, "madison_metro_analysis.html")
            
            print(f"\nGenerated maps:")
            print(f"1. Route Map: {route_file}")
            print(f"2. Density Map: {density_file}")
            print(f"3. Analysis Map: {analysis_file}")
            
            return {
                'route_map': route_file,
                'density_map': density_file,
                'analysis_map': analysis_file
            }
            
        except Exception as e:
            print(f"Error generating maps: {e}")
            return None

def main():
    """Main function to generate route visualizations"""
    visualizer = RouteVisualizer()
    maps = visualizer.generate_all_maps()
    
    if maps:
        print("\n✅ Successfully generated all route visualization maps!")
        print("Open the HTML files in your browser to view the interactive maps.")
    else:
        print("❌ Failed to generate maps. Check the error messages above.")

if __name__ == "__main__":
    main()
