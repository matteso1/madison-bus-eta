#!/usr/bin/env python3
"""
Simple Madison Metro Route Map
Let's create some cool visualizations of what we actually have!
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import plotly.express as px
import plotly.graph_objects as go
import glob
import os
import warnings
warnings.filterwarnings('ignore')

def create_route_map():
    """Create a simple route map"""
    print("🗺️ Creating Madison Metro Route Map...")
    
    # Load data
    vehicle_files = glob.glob("../collected_data/vehicles_*.csv")
    df = pd.read_csv(vehicle_files[0])
    
    # Clean data
    df['lat'] = pd.to_numeric(df['lat'], errors='coerce')
    df['lon'] = pd.to_numeric(df['lon'], errors='coerce')
    df['spd'] = pd.to_numeric(df['spd'], errors='coerce')
    df = df.dropna(subset=['lat', 'lon'])
    
    print(f"✅ Loaded {len(df)} bus location records")
    print(f"✅ Routes: {sorted(df['rt'].unique())}")
    
    # Create interactive map
    fig = px.scatter_mapbox(
        df,
        lat='lat',
        lon='lon',
        color='rt',
        size='spd',
        hover_data=['spd', 'rt'],
        title='Madison Metro Bus Routes - Real-Time Locations',
        mapbox_style='open-street-map',
        zoom=11,
        center={'lat': 43.0731, 'lon': -89.4012}
    )
    
    fig.update_layout(height=800)
    fig.write_html('visualizations/madison_metro_map.html')
    print("✅ Map saved to visualizations/madison_metro_map.html")
    
    return True

def create_route_stats():
    """Create route statistics"""
    print("📊 Creating route statistics...")
    
    # Load data
    vehicle_files = glob.glob("../collected_data/vehicles_*.csv")
    df = pd.read_csv(vehicle_files[0])
    
    # Clean data
    df['spd'] = pd.to_numeric(df['spd'], errors='coerce')
    
    # Create visualizations
    fig, axes = plt.subplots(2, 2, figsize=(16, 12))
    
    # 1. Route frequency
    route_counts = df['rt'].value_counts()
    route_counts.plot(kind='bar', ax=axes[0,0], color='skyblue')
    axes[0,0].set_title('Bus Frequency by Route', fontsize=14, fontweight='bold')
    axes[0,0].set_xlabel('Route')
    axes[0,0].set_ylabel('Number of Records')
    axes[0,0].tick_params(axis='x', rotation=45)
    
    # 2. Speed distribution
    df['spd'].hist(bins=30, ax=axes[0,1], alpha=0.7, color='lightgreen')
    axes[0,1].set_title('Speed Distribution', fontsize=14, fontweight='bold')
    axes[0,1].set_xlabel('Speed (mph)')
    axes[0,1].set_ylabel('Frequency')
    
    # 3. Average speed by route
    route_speeds = df.groupby('rt')['spd'].mean()
    route_speeds.plot(kind='bar', ax=axes[1,0], color='lightcoral')
    axes[1,0].set_title('Average Speed by Route', fontsize=14, fontweight='bold')
    axes[1,0].set_xlabel('Route')
    axes[1,0].set_ylabel('Average Speed (mph)')
    axes[1,0].tick_params(axis='x', rotation=45)
    
    # 4. Route coverage
    route_coverage = df.groupby('rt').agg({
        'lat': ['min', 'max'],
        'lon': ['min', 'max']
    })
    route_coverage.columns = ['lat_min', 'lat_max', 'lon_min', 'lon_max']
    route_coverage['lat_range'] = route_coverage['lat_max'] - route_coverage['lat_min']
    route_coverage['lon_range'] = route_coverage['lon_max'] - route_coverage['lon_min']
    route_coverage['coverage_area'] = route_coverage['lat_range'] * route_coverage['lon_range']
    
    route_coverage['coverage_area'].plot(kind='bar', ax=axes[1,1], color='purple')
    axes[1,1].set_title('Route Coverage Area', fontsize=14, fontweight='bold')
    axes[1,1].set_xlabel('Route')
    axes[1,1].set_ylabel('Coverage Area (lat × lon)')
    axes[1,1].tick_params(axis='x', rotation=45)
    
    plt.tight_layout()
    plt.savefig('visualizations/route_stats.png', dpi=300, bbox_inches='tight')
    plt.show()
    
    return True

def create_summary():
    """Create a summary of what we have"""
    print("📋 Creating summary...")
    
    # Load data
    vehicle_files = glob.glob("../collected_data/vehicles_*.csv")
    df = pd.read_csv(vehicle_files[0])
    
    # Calculate stats
    stats = {
        'Total Records': len(df),
        'Unique Routes': df['rt'].nunique(),
        'Unique Vehicles': df['vid'].nunique(),
        'Average Speed': f"{df['spd'].mean():.1f} mph",
        'Max Speed': f"{df['spd'].max():.1f} mph",
        'Latitude Range': f"{df['lat'].min():.3f} to {df['lat'].max():.3f}",
        'Longitude Range': f"{df['lon'].min():.3f} to {df['lon'].max():.3f}",
        'Most Active Route': df['rt'].value_counts().index[0],
        'Routes': ', '.join(sorted(df['rt'].unique()))
    }
    
    # Create summary visualization
    fig, ax = plt.subplots(figsize=(12, 8))
    ax.axis('off')
    
    summary_text = "🏆 MADISON METRO DATA SUMMARY 🏆\n\n"
    for key, value in stats.items():
        summary_text += f"• {key}: {value}\n"
    
    summary_text += f"\n🎯 WHAT WE HAVE:\n"
    summary_text += f"• Real-time bus location data\n"
    summary_text += f"• {df['rt'].nunique()} different routes\n"
    summary_text += f"• Speed and passenger data\n"
    summary_text += f"• Geographic coverage of Madison\n"
    summary_text += f"• {len(df):,} location records\n"
    
    ax.text(0.1, 0.9, summary_text, transform=ax.transAxes, fontsize=12,
            verticalalignment='top', fontfamily='monospace',
            bbox=dict(boxstyle="round,pad=0.5", facecolor="lightblue", alpha=0.8))
    
    plt.title('Madison Metro Data Analysis', fontsize=16, fontweight='bold', pad=20)
    plt.savefig('visualizations/data_summary.png', dpi=300, bbox_inches='tight')
    plt.show()
    
    return stats

def main():
    """Main function"""
    print("🚀 Madison Metro Route Visualization")
    print("="*50)
    
    # Create output directory
    os.makedirs('visualizations', exist_ok=True)
    
    try:
        create_route_map()
        create_route_stats()
        stats = create_summary()
        
        print("\n✅ Analysis Complete!")
        print("📁 Check the 'visualizations' folder for outputs")
        print("🌐 Open madison_metro_map.html in your browser for the interactive map")
        
        return True
        
    except Exception as e:
        print(f"❌ Analysis failed: {str(e)}")
        return False

if __name__ == "__main__":
    main()


