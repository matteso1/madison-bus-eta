"""
Madison Metro Data Analysis & Visualization
Comprehensive analysis of collected transit data
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import glob
import os
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

# Set style
plt.style.use('seaborn-v0_8')
sns.set_palette("husl")

class MadisonMetroAnalyzer:
    def __init__(self, data_dir="collected_data"):
        self.data_dir = data_dir
        self.vehicle_data = None
        self.prediction_data = None
        self.combined_data = None
        
    def load_data(self):
        """Load all collected data"""
        print("🔄 Loading data for analysis...")
        
        # Load vehicle data
        vehicle_files = glob.glob(os.path.join(self.data_dir, "vehicles_*.csv"))
        vehicle_dfs = []
        
        for file in vehicle_files:
            try:
                df = pd.read_csv(file)
                vehicle_dfs.append(df)
            except Exception as e:
                print(f"⚠️ Error loading {file}: {e}")
        
        if vehicle_dfs:
            self.vehicle_data = pd.concat(vehicle_dfs, ignore_index=True)
            self.vehicle_data['collection_timestamp'] = pd.to_datetime(self.vehicle_data['collection_timestamp'])
            print(f"✅ Loaded {len(vehicle_dfs)} vehicle files: {len(self.vehicle_data)} records")
        
        # Load prediction data
        prediction_files = glob.glob(os.path.join(self.data_dir, "predictions_*.csv"))
        prediction_dfs = []
        
        for file in prediction_files:
            try:
                df = pd.read_csv(file)
                prediction_dfs.append(df)
            except Exception as e:
                print(f"⚠️ Error loading {file}: {e}")
        
        if prediction_dfs:
            self.prediction_data = pd.concat(prediction_dfs, ignore_index=True)
            self.prediction_data['collection_timestamp'] = pd.to_datetime(self.prediction_data['collection_timestamp'])
            print(f"✅ Loaded {len(prediction_files)} prediction files: {len(self.prediction_data)} records")
        
        return True
    
    def create_combined_dataset(self):
        """Create a combined dataset for analysis"""
        print("🔄 Creating combined dataset...")
        
        if self.vehicle_data is None or self.prediction_data is None:
            print("❌ No data available")
            return False
        
        # Clean and prepare data
        vehicles = self.vehicle_data.copy()
        predictions = self.prediction_data.copy()
        
        # Convert timestamps
        vehicles['collection_timestamp'] = pd.to_datetime(vehicles['collection_timestamp'])
        predictions['collection_timestamp'] = pd.to_datetime(predictions['collection_timestamp'])
        
        # Add time features
        vehicles['hour'] = vehicles['collection_timestamp'].dt.hour
        vehicles['day_of_week'] = vehicles['collection_timestamp'].dt.dayofweek
        vehicles['is_weekend'] = vehicles['day_of_week'] >= 5
        vehicles['is_rush_hour'] = (
            (vehicles['hour'] >= 7) & (vehicles['hour'] <= 9) |
            (vehicles['hour'] >= 16) & (vehicles['hour'] <= 18)
        )
        
        predictions['hour'] = predictions['collection_timestamp'].dt.hour
        predictions['day_of_week'] = predictions['collection_timestamp'].dt.dayofweek
        predictions['is_weekend'] = predictions['day_of_week'] >= 5
        predictions['is_rush_hour'] = (
            (predictions['hour'] >= 7) & (predictions['hour'] <= 9) |
            (predictions['hour'] >= 16) & (predictions['hour'] <= 18)
        )
        
        # Convert passenger load to numeric
        psgld_mapping = {'EMPTY': 0, 'LIGHT': 1, 'HALF_EMPTY': 2, 'FULL': 3}
        vehicles['psgld_numeric'] = vehicles['psgld'].map(psgld_mapping).fillna(0)
        
        # Convert prediction countdown to numeric
        predictions['prdctdn_numeric'] = pd.to_numeric(
            predictions['prdctdn'].replace('DUE', 0).replace('DLY', -1), 
            errors='coerce'
        ).fillna(0)
        
        self.combined_data = {
            'vehicles': vehicles,
            'predictions': predictions
        }
        
        print("✅ Combined dataset created")
        return True
    
    def analyze_route_performance(self):
        """Analyze performance by route"""
        print("🔄 Analyzing route performance...")
        
        if self.combined_data is None:
            print("❌ No combined data available")
            return
        
        vehicles = self.combined_data['vehicles']
        predictions = self.combined_data['predictions']
        
        # Route analysis
        route_stats = vehicles.groupby('rt').agg({
            'vid': 'count',
            'spd': ['mean', 'std'],
            'dly': 'mean',
            'psgld_numeric': 'mean'
        }).round(2)
        
        route_stats.columns = ['vehicle_count', 'avg_speed', 'speed_std', 'delay_rate', 'avg_passenger_load']
        route_stats = route_stats.sort_values('vehicle_count', ascending=False)
        
        print("\n📊 Route Performance Summary:")
        print("=" * 60)
        print(route_stats.head(10))
        
        # Create visualizations
        fig, axes = plt.subplots(2, 2, figsize=(15, 12))
        fig.suptitle('Madison Metro Route Performance Analysis', fontsize=16, fontweight='bold')
        
        # 1. Vehicle count by route
        route_counts = vehicles['rt'].value_counts().head(10)
        axes[0, 0].bar(route_counts.index, route_counts.values, color='skyblue')
        axes[0, 0].set_title('Vehicle Count by Route (Top 10)')
        axes[0, 0].set_xlabel('Route')
        axes[0, 0].set_ylabel('Number of Vehicle Records')
        axes[0, 0].tick_params(axis='x', rotation=45)
        
        # 2. Average speed by route
        speed_by_route = vehicles.groupby('rt')['spd'].mean().sort_values(ascending=False).head(10)
        axes[0, 1].bar(range(len(speed_by_route)), speed_by_route.values, color='lightgreen')
        axes[0, 1].set_title('Average Speed by Route (Top 10)')
        axes[0, 1].set_xlabel('Route')
        axes[0, 1].set_ylabel('Average Speed (mph)')
        axes[0, 1].set_xticks(range(len(speed_by_route)))
        axes[0, 1].set_xticklabels(speed_by_route.index, rotation=45)
        
        # 3. Delay rate by route
        delay_by_route = vehicles.groupby('rt')['dly'].mean().sort_values(ascending=False).head(10)
        axes[1, 0].bar(range(len(delay_by_route)), delay_by_route.values, color='salmon')
        axes[1, 0].set_title('Delay Rate by Route (Top 10)')
        axes[1, 0].set_xlabel('Route')
        axes[1, 0].set_ylabel('Delay Rate')
        axes[1, 0].set_xticks(range(len(delay_by_route)))
        axes[1, 0].set_xticklabels(delay_by_route.index, rotation=45)
        
        # 4. Passenger load by route
        load_by_route = vehicles.groupby('rt')['psgld_numeric'].mean().sort_values(ascending=False).head(10)
        axes[1, 1].bar(range(len(load_by_route)), load_by_route.values, color='gold')
        axes[1, 1].set_title('Average Passenger Load by Route (Top 10)')
        axes[1, 1].set_xlabel('Route')
        axes[1, 1].set_ylabel('Average Passenger Load')
        axes[1, 1].set_xticks(range(len(load_by_route)))
        axes[1, 1].set_xticklabels(load_by_route.index, rotation=45)
        
        plt.tight_layout()
        plt.savefig('ml/analysis/route_performance.png', dpi=300, bbox_inches='tight')
        plt.show()
        
        return route_stats
    
    def analyze_temporal_patterns(self):
        """Analyze temporal patterns in the data"""
        print("🔄 Analyzing temporal patterns...")
        
        if self.combined_data is None:
            print("❌ No combined data available")
            return
        
        vehicles = self.combined_data['vehicles']
        predictions = self.combined_data['predictions']
        
        # Create visualizations
        fig, axes = plt.subplots(2, 2, figsize=(15, 12))
        fig.suptitle('Madison Metro Temporal Patterns', fontsize=16, fontweight='bold')
        
        # 1. Activity by hour
        hourly_activity = vehicles.groupby('hour').size()
        axes[0, 0].plot(hourly_activity.index, hourly_activity.values, marker='o', linewidth=2)
        axes[0, 0].set_title('Vehicle Activity by Hour')
        axes[0, 0].set_xlabel('Hour of Day')
        axes[0, 0].set_ylabel('Number of Vehicle Records')
        axes[0, 0].grid(True, alpha=0.3)
        
        # 2. Speed by hour
        speed_by_hour = vehicles.groupby('hour')['spd'].mean()
        axes[0, 1].plot(speed_by_hour.index, speed_by_hour.values, marker='s', color='green', linewidth=2)
        axes[0, 1].set_title('Average Speed by Hour')
        axes[0, 1].set_xlabel('Hour of Day')
        axes[0, 1].set_ylabel('Average Speed (mph)')
        axes[0, 1].grid(True, alpha=0.3)
        
        # 3. Delay rate by hour
        delay_by_hour = vehicles.groupby('hour')['dly'].mean()
        axes[1, 0].plot(delay_by_hour.index, delay_by_hour.values, marker='^', color='red', linewidth=2)
        axes[1, 0].set_title('Delay Rate by Hour')
        axes[1, 0].set_xlabel('Hour of Day')
        axes[1, 0].set_ylabel('Delay Rate')
        axes[1, 0].grid(True, alpha=0.3)
        
        # 4. Activity by day of week
        daily_activity = vehicles.groupby('day_of_week').size()
        day_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        # Ensure we have data for all 7 days
        full_daily_activity = pd.Series(0, index=range(7))
        full_daily_activity.update(daily_activity)
        axes[1, 1].bar(range(7), full_daily_activity.values, color='purple', alpha=0.7)
        axes[1, 1].set_title('Vehicle Activity by Day of Week')
        axes[1, 1].set_xlabel('Day of Week')
        axes[1, 1].set_ylabel('Number of Vehicle Records')
        axes[1, 1].set_xticks(range(7))
        axes[1, 1].set_xticklabels(day_names)
        
        plt.tight_layout()
        plt.savefig('ml/analysis/temporal_patterns.png', dpi=300, bbox_inches='tight')
        plt.show()
    
    def analyze_prediction_accuracy(self):
        """Analyze prediction accuracy and patterns"""
        print("🔄 Analyzing prediction patterns...")
        
        if self.combined_data is None:
            print("❌ No combined data available")
            return
        
        predictions = self.combined_data['predictions']
        
        # Filter valid predictions
        valid_predictions = predictions[
            (predictions['prdctdn_numeric'] > 0) & 
            (predictions['prdctdn_numeric'] < 60)  # Reasonable range
        ].copy()
        
        if len(valid_predictions) == 0:
            print("❌ No valid predictions found")
            return
        
        # Create visualizations
        fig, axes = plt.subplots(2, 2, figsize=(15, 12))
        fig.suptitle('Madison Metro Prediction Analysis', fontsize=16, fontweight='bold')
        
        # 1. Prediction countdown distribution
        axes[0, 0].hist(valid_predictions['prdctdn_numeric'], bins=30, alpha=0.7, color='blue')
        axes[0, 0].set_title('Distribution of Prediction Countdowns')
        axes[0, 0].set_xlabel('Predicted Minutes Until Arrival')
        axes[0, 0].set_ylabel('Frequency')
        axes[0, 0].grid(True, alpha=0.3)
        
        # 2. Predictions by route
        route_predictions = valid_predictions['rt'].value_counts().head(10)
        axes[0, 1].bar(range(len(route_predictions)), route_predictions.values, color='orange')
        axes[0, 1].set_title('Prediction Count by Route (Top 10)')
        axes[0, 1].set_xlabel('Route')
        axes[0, 1].set_ylabel('Number of Predictions')
        axes[0, 1].set_xticks(range(len(route_predictions)))
        axes[0, 1].set_xticklabels(route_predictions.index, rotation=45)
        
        # 3. Average prediction by hour
        hourly_predictions = valid_predictions.groupby('hour')['prdctdn_numeric'].mean()
        axes[1, 0].plot(hourly_predictions.index, hourly_predictions.values, marker='o', color='green')
        axes[1, 0].set_title('Average Prediction Time by Hour')
        axes[1, 0].set_xlabel('Hour of Day')
        axes[1, 0].set_ylabel('Average Predicted Minutes')
        axes[1, 0].grid(True, alpha=0.3)
        
        # 4. Prediction distribution by day of week
        daily_predictions = valid_predictions.groupby('day_of_week')['prdctdn_numeric'].mean()
        day_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        # Ensure we have data for all 7 days
        full_daily_predictions = pd.Series(0, index=range(7))
        full_daily_predictions.update(daily_predictions)
        axes[1, 1].bar(range(7), full_daily_predictions.values, color='purple', alpha=0.7)
        axes[1, 1].set_title('Average Prediction Time by Day of Week')
        axes[1, 1].set_xlabel('Day of Week')
        axes[1, 1].set_ylabel('Average Predicted Minutes')
        axes[1, 1].set_xticks(range(7))
        axes[1, 1].set_xticklabels(day_names)
        
        plt.tight_layout()
        plt.savefig('ml/analysis/prediction_patterns.png', dpi=300, bbox_inches='tight')
        plt.show()
        
        print(f"\n📊 Prediction Analysis Summary:")
        print(f"Total predictions: {len(predictions)}")
        print(f"Valid predictions: {len(valid_predictions)}")
        print(f"Average prediction time: {valid_predictions['prdctdn_numeric'].mean():.1f} minutes")
        print(f"Most active route: {valid_predictions['rt'].mode().iloc[0]}")
    
    def generate_summary_report(self):
        """Generate a comprehensive summary report"""
        print("🔄 Generating summary report...")
        
        if self.combined_data is None:
            print("❌ No combined data available")
            return
        
        vehicles = self.combined_data['vehicles']
        predictions = self.combined_data['predictions']
        
        # Create summary statistics
        summary = {
            'data_collection': {
                'total_vehicle_records': len(vehicles),
                'total_prediction_records': len(predictions),
                'collection_period': {
                    'start': vehicles['collection_timestamp'].min(),
                    'end': vehicles['collection_timestamp'].max(),
                    'duration_hours': (vehicles['collection_timestamp'].max() - vehicles['collection_timestamp'].min()).total_seconds() / 3600
                }
            },
            'route_analysis': {
                'total_routes': vehicles['rt'].nunique(),
                'most_active_route': vehicles['rt'].mode().iloc[0],
                'average_speed': vehicles['spd'].mean(),
                'delay_rate': vehicles['dly'].mean()
            },
            'temporal_analysis': {
                'peak_hour': vehicles.groupby('hour').size().idxmax(),
                'weekend_activity': vehicles['is_weekend'].mean(),
                'rush_hour_activity': vehicles['is_rush_hour'].mean()
            }
        }
        
        # Print summary
        print("\n" + "="*60)
        print("📊 MADISON METRO DATA ANALYSIS SUMMARY")
        print("="*60)
        
        print(f"\n📈 Data Collection:")
        print(f"  • Total vehicle records: {summary['data_collection']['total_vehicle_records']:,}")
        print(f"  • Total prediction records: {summary['data_collection']['total_prediction_records']:,}")
        print(f"  • Collection period: {summary['data_collection']['collection_period']['start']} to {summary['data_collection']['collection_period']['end']}")
        print(f"  • Duration: {summary['data_collection']['collection_period']['duration_hours']:.1f} hours")
        
        print(f"\n🚌 Route Analysis:")
        print(f"  • Total routes tracked: {summary['route_analysis']['total_routes']}")
        print(f"  • Most active route: {summary['route_analysis']['most_active_route']}")
        print(f"  • Average speed: {summary['route_analysis']['average_speed']:.1f} mph")
        print(f"  • Delay rate: {summary['route_analysis']['delay_rate']:.1%}")
        
        print(f"\n⏰ Temporal Patterns:")
        print(f"  • Peak activity hour: {summary['temporal_analysis']['peak_hour']}:00")
        print(f"  • Weekend activity: {summary['temporal_analysis']['weekend_activity']:.1%}")
        print(f"  • Rush hour activity: {summary['temporal_analysis']['rush_hour_activity']:.1%}")
        
        print("\n" + "="*60)
        
        return summary
    
    def run_full_analysis(self):
        """Run the complete analysis pipeline"""
        print("🚀 Starting Madison Metro Data Analysis")
        print("=" * 50)
        
        # Create output directory
        os.makedirs('ml/analysis', exist_ok=True)
        
        # Load data
        if not self.load_data():
            return False
        
        # Create combined dataset
        if not self.create_combined_dataset():
            return False
        
        # Run analyses
        self.analyze_route_performance()
        self.analyze_temporal_patterns()
        self.analyze_prediction_accuracy()
        self.generate_summary_report()
        
        print("\n🎉 Analysis completed successfully!")
        print("📁 Results saved to ml/analysis/")
        return True

def main():
    """Main function to run the analysis"""
    analyzer = MadisonMetroAnalyzer()
    success = analyzer.run_full_analysis()
    
    if success:
        print("\n🎯 Next Steps:")
        print("1. Review the generated visualizations")
        print("2. Use insights to improve data collection")
        print("3. Deploy the prediction API")
        print("4. Continue collecting data for better models")
    else:
        print("❌ Analysis failed. Check the logs above.")

if __name__ == "__main__":
    main()
