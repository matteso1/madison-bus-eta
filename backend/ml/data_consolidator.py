"""
Data Consolidation and Analysis for Madison Metro ML Project

This script consolidates all collected CSV files and prepares them for ML training.
"""

import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime, timedelta
import json
from typing import Dict, List, Tuple
import warnings
import sys
warnings.filterwarnings('ignore')

# Fix Windows console encoding for emojis
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')


class MadisonMetroDataConsolidator:
    def __init__(self, data_dir: str = "collected_data"):
        self.data_dir = Path(data_dir)
        self.predictions_df = None
        self.vehicles_df = None
        self.consolidated_df = None
        
    def load_all_predictions(self) -> pd.DataFrame:
        """Load and consolidate all prediction CSV files"""
        print("🔄 Loading prediction data...")
        
        prediction_files = sorted(self.data_dir.glob("predictions_*.csv"))
        print(f"Found {len(prediction_files)} prediction files")
        
        dfs = []
        for i, file in enumerate(prediction_files):
            try:
                df = pd.read_csv(file)
                dfs.append(df)
                if (i + 1) % 500 == 0:
                    print(f"  Loaded {i + 1}/{len(prediction_files)} files...")
            except Exception as e:
                print(f"  Error loading {file.name}: {e}")
                
        if dfs:
            self.predictions_df = pd.concat(dfs, ignore_index=True)
            print(f"✅ Loaded {len(self.predictions_df):,} prediction records")
            return self.predictions_df
        else:
            print("❌ No prediction data loaded")
            return None
            
    def load_all_vehicles(self) -> pd.DataFrame:
        """Load and consolidate all vehicle CSV files"""
        print("\n🔄 Loading vehicle data...")
        
        vehicle_files = sorted(self.data_dir.glob("vehicles_*.csv"))
        print(f"Found {len(vehicle_files)} vehicle files")
        
        dfs = []
        for i, file in enumerate(vehicle_files):
            try:
                df = pd.read_csv(file)
                dfs.append(df)
                if (i + 1) % 500 == 0:
                    print(f"  Loaded {i + 1}/{len(vehicle_files)} files...")
            except Exception as e:
                print(f"  Error loading {file.name}: {e}")
                
        if dfs:
            self.vehicles_df = pd.concat(dfs, ignore_index=True)
            print(f"✅ Loaded {len(self.vehicles_df):,} vehicle records")
            return self.vehicles_df
        else:
            print("❌ No vehicle data loaded")
            return None
            
    def analyze_data_quality(self, df: pd.DataFrame, name: str) -> Dict:
        """Analyze data quality and completeness"""
        print(f"\n📊 Data Quality Analysis: {name}")
        print("=" * 60)
        
        analysis = {
            'total_records': len(df),
            'columns': list(df.columns),
            'missing_values': df.isnull().sum().to_dict(),
            'missing_percentages': (df.isnull().sum() / len(df) * 100).to_dict(),
            'duplicates': df.duplicated().sum(),
            'memory_usage_mb': df.memory_usage(deep=True).sum() / 1024 / 1024
        }
        
        print(f"Total Records: {analysis['total_records']:,}")
        print(f"Columns: {len(analysis['columns'])}")
        print(f"Duplicates: {analysis['duplicates']:,}")
        print(f"Memory Usage: {analysis['memory_usage_mb']:.2f} MB")
        
        # Show columns with missing values
        missing = {k: v for k, v in analysis['missing_percentages'].items() if v > 0}
        if missing:
            print("\nMissing Values:")
            for col, pct in sorted(missing.items(), key=lambda x: x[1], reverse=True):
                print(f"  {col}: {pct:.2f}%")
        else:
            print("\n✅ No missing values!")
            
        return analysis
        
    def analyze_predictions(self) -> Dict:
        """Detailed analysis of prediction data"""
        if self.predictions_df is None:
            return {}
            
        print("\n🎯 Prediction Data Analysis")
        print("=" * 60)
        
        df = self.predictions_df
        
        # Convert timestamps
        df['prdtm'] = pd.to_datetime(df['prdtm'], format='%Y%m%d %H:%M', errors='coerce')
        df['tmstmp'] = pd.to_datetime(df['tmstmp'], format='%Y%m%d %H:%M', errors='coerce')
        df['collection_timestamp'] = pd.to_datetime(df['collection_timestamp'], errors='coerce')
        
        analysis = {
            'unique_routes': df['rt'].nunique(),
            'unique_stops': df['stpid'].nunique(),
            'unique_vehicles': df['vid'].nunique() if 'vid' in df.columns else 0,
            'date_range': {
                'start': df['collection_timestamp'].min(),
                'end': df['collection_timestamp'].max(),
                'days': (df['collection_timestamp'].max() - df['collection_timestamp'].min()).days
            },
            'predictions_per_route': df.groupby('rt').size().to_dict(),
            'delay_distribution': df['dly'].value_counts().to_dict() if 'dly' in df.columns else {},
            'prediction_countdown_stats': {
                'mean_minutes': df['prdctdn'].astype(str).apply(lambda x: 0 if x == 'DUE' else (int(x) if x.isdigit() else np.nan)).mean(),
                'max_minutes': df['prdctdn'].astype(str).apply(lambda x: 0 if x == 'DUE' else (int(x) if x.isdigit() else np.nan)).max(),
            }
        }
        
        print(f"Routes: {analysis['unique_routes']}")
        print(f"Stops: {analysis['unique_stops']}")
        print(f"Vehicles: {analysis['unique_vehicles']}")
        print(f"Date Range: {analysis['date_range']['start'].date()} to {analysis['date_range']['end'].date()}")
        print(f"Days of Data: {analysis['date_range']['days']}")
        
        print("\nTop 10 Routes by Prediction Count:")
        top_routes = sorted(analysis['predictions_per_route'].items(), key=lambda x: x[1], reverse=True)[:10]
        for route, count in top_routes:
            print(f"  Route {route}: {count:,} predictions")
            
        if analysis['delay_distribution']:
            print("\nDelay Distribution:")
            for status, count in analysis['delay_distribution'].items():
                pct = count / len(df) * 100
                print(f"  {status}: {count:,} ({pct:.1f}%)")
                
        return analysis
        
    def analyze_vehicles(self) -> Dict:
        """Detailed analysis of vehicle data"""
        if self.vehicles_df is None:
            return {}
            
        print("\n🚌 Vehicle Data Analysis")
        print("=" * 60)
        
        df = self.vehicles_df
        
        # Convert timestamps
        df['tmstmp'] = pd.to_datetime(df['tmstmp'], format='%Y%m%d %H:%M', errors='coerce')
        df['collection_timestamp'] = pd.to_datetime(df['collection_timestamp'], errors='coerce')
        
        analysis = {
            'unique_routes': df['rt'].nunique(),
            'unique_vehicles': df['vid'].nunique(),
            'date_range': {
                'start': df['collection_timestamp'].min(),
                'end': df['collection_timestamp'].max(),
                'days': (df['collection_timestamp'].max() - df['collection_timestamp'].min()).days
            },
            'vehicles_per_route': df.groupby('rt').size().to_dict(),
            'delay_distribution': df['dly'].value_counts().to_dict() if 'dly' in df.columns else {},
            'passenger_load': df['psgld'].value_counts().to_dict() if 'psgld' in df.columns else {},
            'speed_stats': {
                'mean_mph': df['spd'].astype(float).mean(),
                'max_mph': df['spd'].astype(float).max(),
                'median_mph': df['spd'].astype(float).median()
            } if 'spd' in df.columns else {}
        }
        
        print(f"Routes: {analysis['unique_routes']}")
        print(f"Vehicles: {analysis['unique_vehicles']}")
        print(f"Date Range: {analysis['date_range']['start'].date()} to {analysis['date_range']['end'].date()}")
        print(f"Days of Data: {analysis['date_range']['days']}")
        
        print("\nTop 10 Routes by Vehicle Records:")
        top_routes = sorted(analysis['vehicles_per_route'].items(), key=lambda x: x[1], reverse=True)[:10]
        for route, count in top_routes:
            print(f"  Route {route}: {count:,} records")
            
        if analysis['passenger_load']:
            print("\nPassenger Load Distribution:")
            for load, count in sorted(analysis['passenger_load'].items()):
                pct = count / len(df) * 100
                print(f"  {load}: {count:,} ({pct:.1f}%)")
                
        if analysis['speed_stats']:
            print("\nSpeed Statistics:")
            print(f"  Mean: {analysis['speed_stats']['mean_mph']:.1f} mph")
            print(f"  Median: {analysis['speed_stats']['median_mph']:.1f} mph")
            print(f"  Max: {analysis['speed_stats']['max_mph']:.1f} mph")
            
        return analysis
        
    def create_ml_dataset(self) -> pd.DataFrame:
        """Create a consolidated dataset for ML training"""
        print("\n🤖 Creating ML Dataset")
        print("=" * 60)
        
        if self.predictions_df is None or self.vehicles_df is None:
            print("⚠️  Loading data first...")
            self.load_all_predictions()
            self.load_all_vehicles()
            
        # For now, focus on predictions since they have arrival time info
        df = self.predictions_df.copy()
        
        print(f"Starting with {len(df):,} prediction records")
        
        # Convert timestamps
        df['prdtm'] = pd.to_datetime(df['prdtm'], format='%Y%m%d %H:%M', errors='coerce')
        df['tmstmp'] = pd.to_datetime(df['tmstmp'], format='%Y%m%d %H:%M', errors='coerce')
        df['collection_timestamp'] = pd.to_datetime(df['collection_timestamp'], errors='coerce')
        
        # Remove invalid timestamps
        df = df.dropna(subset=['prdtm', 'tmstmp', 'collection_timestamp'])
        print(f"After timestamp validation: {len(df):,} records")
        
        # Calculate actual time until arrival in minutes
        df['minutes_until_arrival'] = (df['prdtm'] - df['collection_timestamp']).dt.total_seconds() / 60
        
        # Convert prediction countdown to numeric
        def parse_prediction(x):
            if pd.isna(x):
                return np.nan
            x = str(x).strip()
            if x == 'DUE' or x == 'APPROACHING':
                return 0
            try:
                return int(x)
            except:
                return np.nan
                
        df['predicted_minutes'] = df['prdctdn'].apply(parse_prediction)
        
        # Remove invalid predictions
        df = df.dropna(subset=['predicted_minutes', 'minutes_until_arrival'])
        df = df[df['minutes_until_arrival'] >= 0]  # Remove past predictions
        df = df[df['minutes_until_arrival'] <= 120]  # Remove unrealistic predictions (>2 hours)
        print(f"After prediction validation: {len(df):,} records")
        
        # Calculate prediction error (our target to beat!)
        df['api_prediction_error'] = abs(df['predicted_minutes'] - df['minutes_until_arrival'])
        
        # Binary delay classification (is bus late compared to prediction?)
        df['is_delayed'] = (df['dly'] == True) | (df['dly'] == 'True') | (df['dly'] == 'true')
        
        # Drop duplicates
        df = df.drop_duplicates(subset=['vid', 'stpid', 'collection_timestamp'], keep='first')
        print(f"After deduplication: {len(df):,} records")
        
        self.consolidated_df = df
        
        print(f"\n✅ ML Dataset Created: {len(df):,} records")
        print(f"   Columns: {len(df.columns)}")
        print(f"   Memory: {df.memory_usage(deep=True).sum() / 1024 / 1024:.2f} MB")
        
        return df
        
    def save_consolidated_data(self, output_path: str = "ml/data/consolidated_metro_data.csv"):
        """Save consolidated dataset"""
        if self.consolidated_df is None:
            print("⚠️  No consolidated data to save. Run create_ml_dataset() first.")
            return
            
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        print(f"\n💾 Saving consolidated data to {output_path}")
        self.consolidated_df.to_csv(output_file, index=False)
        print(f"✅ Saved {len(self.consolidated_df):,} records ({output_file.stat().st_size / 1024 / 1024:.2f} MB)")
        
    def generate_summary_report(self) -> Dict:
        """Generate comprehensive summary report"""
        print("\n" + "=" * 60)
        print("📈 MADISON METRO DATA SUMMARY REPORT")
        print("=" * 60)
        
        report = {
            'collection_date': datetime.now().isoformat(),
            'predictions_analysis': {},
            'vehicles_analysis': {},
            'ml_dataset_ready': self.consolidated_df is not None
        }
        
        if self.predictions_df is not None:
            pred_quality = self.analyze_data_quality(self.predictions_df, "Predictions")
            pred_analysis = self.analyze_predictions()
            report['predictions_analysis'] = {**pred_quality, **pred_analysis}
            
        if self.vehicles_df is not None:
            veh_quality = self.analyze_data_quality(self.vehicles_df, "Vehicles")
            veh_analysis = self.analyze_vehicles()
            report['vehicles_analysis'] = {**veh_quality, **veh_analysis}
            
        if self.consolidated_df is not None:
            print("\n🎯 ML-Ready Dataset Statistics")
            print("=" * 60)
            print(f"Total Records: {len(self.consolidated_df):,}")
            print(f"Unique Routes: {self.consolidated_df['rt'].nunique()}")
            print(f"Unique Stops: {self.consolidated_df['stpid'].nunique()}")
            print(f"Unique Vehicles: {self.consolidated_df['vid'].nunique()}")
            
            print("\nTarget Variable: minutes_until_arrival")
            print(f"  Mean: {self.consolidated_df['minutes_until_arrival'].mean():.2f} min")
            print(f"  Median: {self.consolidated_df['minutes_until_arrival'].median():.2f} min")
            print(f"  Std Dev: {self.consolidated_df['minutes_until_arrival'].std():.2f} min")
            
            print("\nAPI Prediction Error (Baseline to Beat):")
            print(f"  Mean Error: {self.consolidated_df['api_prediction_error'].mean():.2f} min")
            print(f"  Median Error: {self.consolidated_df['api_prediction_error'].median():.2f} min")
            
            delay_rate = self.consolidated_df['is_delayed'].mean() * 100
            print(f"\nDelay Rate: {delay_rate:.1f}% of predictions")
            
            report['ml_dataset'] = {
                'total_records': len(self.consolidated_df),
                'unique_routes': int(self.consolidated_df['rt'].nunique()),
                'unique_stops': int(self.consolidated_df['stpid'].nunique()),
                'unique_vehicles': int(self.consolidated_df['vid'].nunique()),
                'target_stats': {
                    'mean_minutes': float(self.consolidated_df['minutes_until_arrival'].mean()),
                    'median_minutes': float(self.consolidated_df['minutes_until_arrival'].median()),
                    'std_minutes': float(self.consolidated_df['minutes_until_arrival'].std())
                },
                'baseline_error': {
                    'mean': float(self.consolidated_df['api_prediction_error'].mean()),
                    'median': float(self.consolidated_df['api_prediction_error'].median())
                },
                'delay_rate': float(delay_rate)
            }
            
        return report
        
    def save_report(self, report: Dict, output_path: str = "ml/data/data_summary.json"):
        """Save summary report as JSON"""
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Convert non-serializable objects
        def convert(obj):
            if isinstance(obj, (np.integer, np.int64)):
                return int(obj)
            elif isinstance(obj, (np.floating, np.float64)):
                return float(obj)
            elif isinstance(obj, (datetime, pd.Timestamp)):
                return obj.isoformat()
            elif isinstance(obj, np.ndarray):
                return obj.tolist()
            return obj
            
        serializable_report = json.loads(json.dumps(report, default=convert))
        
        with open(output_file, 'w') as f:
            json.dump(serializable_report, f, indent=2)
            
        print(f"\n💾 Report saved to {output_path}")


def main():
    """Run the complete data consolidation pipeline"""
    print("🚀 Madison Metro Data Consolidation Pipeline")
    print("=" * 60)
    
    consolidator = MadisonMetroDataConsolidator()
    
    # Load all data
    consolidator.load_all_predictions()
    consolidator.load_all_vehicles()
    
    # Create ML dataset
    consolidator.create_ml_dataset()
    
    # Generate report
    report = consolidator.generate_summary_report()
    
    # Save everything
    consolidator.save_consolidated_data()
    consolidator.save_report(report)
    
    print("\n" + "=" * 60)
    print("✅ Data consolidation complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Feature engineering")
    print("2. Model training")
    print("3. Evaluation and comparison")


if __name__ == "__main__":
    main()

