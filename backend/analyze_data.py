#!/usr/bin/env python3
"""
Quick analysis of collected Madison Metro data for ML readiness
"""

import pandas as pd
import glob
import os
from datetime import datetime

def analyze_data():
    print('🔍 ANALYZING MADISON METRO DATA FOR ML READINESS')
    print('=' * 60)

    # Load sample data
    pred_files = glob.glob('collected_data/predictions_*.csv')[:10]
    veh_files = glob.glob('collected_data/vehicles_*.csv')[:10]

    print(f'📁 Found {len(pred_files)} prediction files (sampling first 10)')
    print(f'📁 Found {len(veh_files)} vehicle files (sampling first 10)')

    # Analyze prediction data
    if pred_files:
        pred_dfs = []
        for f in pred_files:
            try:
                df = pd.read_csv(f)
                pred_dfs.append(df)
            except Exception as e:
                print(f"Error loading {f}: {e}")
                continue
        
        if pred_dfs:
            pred_data = pd.concat(pred_dfs, ignore_index=True)
            print(f'\n📊 PREDICTION DATA ANALYSIS:')
            print(f'  • Total records: {len(pred_data):,}')
            print(f'  • Unique routes: {pred_data["rt"].nunique()}')
            print(f'  • Unique stops: {pred_data["stpid"].nunique()}')
            print(f'  • Time span: {pred_data["collection_timestamp"].min()} to {pred_data["collection_timestamp"].max()}')
            
            # Check prediction quality
            valid_preds = pred_data[pred_data['prdctdn'].notna()]
            print(f'  • Valid predictions: {len(valid_preds):,} ({len(valid_preds)/len(pred_data)*100:.1f}%)')
            
            # Check delay data
            delay_data = pred_data[pred_data['dly'].notna()]
            delay_rate = delay_data['dly'].mean() if len(delay_data) > 0 else 0
            print(f'  • Delay rate: {delay_rate:.1%}')
            
            # Check prediction countdown distribution
            if len(valid_preds) > 0:
                countdown_stats = valid_preds['prdctdn'].value_counts().head(10)
                print(f'  • Top prediction values: {dict(countdown_stats.head(5))}')

    # Analyze vehicle data
    if veh_files:
        veh_dfs = []
        for f in veh_files:
            try:
                df = pd.read_csv(f)
                veh_dfs.append(df)
            except Exception as e:
                print(f"Error loading {f}: {e}")
                continue
        
        if veh_dfs:
            veh_data = pd.concat(veh_dfs, ignore_index=True)
            print(f'\n🚗 VEHICLE DATA ANALYSIS:')
            print(f'  • Total records: {len(veh_data):,}')
            print(f'  • Unique vehicles: {veh_data["vid"].nunique()}')
            print(f'  • Unique routes: {veh_data["rt"].nunique()}')
            print(f'  • Time span: {veh_data["collection_timestamp"].min()} to {veh_data["collection_timestamp"].max()}')
            
            # Check data quality
            valid_speed = veh_data[veh_data['spd'].notna()]
            print(f'  • Valid speed data: {len(valid_speed):,} ({len(valid_speed)/len(veh_data)*100:.1f}%)')
            
            # Check delay data
            delay_data = veh_data[veh_data['dly'].notna()]
            delay_rate = delay_data['dly'].mean() if len(delay_data) > 0 else 0
            print(f'  • Delay rate: {delay_rate:.1%}')
            
            # Speed statistics
            if len(valid_speed) > 0:
                print(f'  • Average speed: {valid_speed["spd"].mean():.1f} mph')
                print(f'  • Speed range: {valid_speed["spd"].min():.1f} - {valid_speed["spd"].max():.1f} mph')

    # ML Readiness Assessment
    print(f'\n🎯 ML READINESS ASSESSMENT:')
    print('=' * 60)
    
    # Calculate total data volume
    total_files = len(glob.glob('collected_data/*.csv'))
    print(f'📈 DATA VOLUME:')
    print(f'  • Total CSV files: {total_files:,}')
    print(f'  • Estimated total records: {total_files * 100:,} (rough estimate)')
    
    # Assess ML readiness
    print(f'\n🤖 ML MODEL READINESS:')
    
    if total_files > 1000:
        print('  ✅ EXCELLENT: More than 1,000 data files')
        print('  ✅ Sufficient for complex ML models (Random Forest, XGBoost)')
        print('  ✅ Good for deep learning models')
    elif total_files > 500:
        print('  ✅ GOOD: More than 500 data files')
        print('  ✅ Sufficient for standard ML models')
        print('  ⚠️  Consider collecting more for deep learning')
    elif total_files > 100:
        print('  ⚠️  MODERATE: More than 100 data files')
        print('  ✅ Sufficient for simple ML models (Linear Regression)')
        print('  ⚠️  Limited for complex models')
    else:
        print('  ❌ LIMITED: Less than 100 data files')
        print('  ⚠️  Consider collecting more data')
    
    print(f'\n💡 RECOMMENDATIONS:')
    print('=' * 60)
    
    if total_files > 1000:
        print('🎉 YOUR DATA IS READY FOR ML!')
        print('  • You have excellent data volume')
        print('  • Can train multiple model types')
        print('  • Good for production deployment')
        print('  • Consider running ML pipeline now!')
    elif total_files > 500:
        print('👍 GOOD TO GO FOR BASIC ML!')
        print('  • Sufficient for most ML models')
        print('  • Can start training now')
        print('  • Continue collecting for better accuracy')
    else:
        print('⏳ CONSIDER COLLECTING MORE DATA')
        print('  • Current data is limited')
        print('  • Can start with simple models')
        print('  • Continue collection for better results')
    
    print(f'\n🚀 NEXT STEPS:')
    print('  1. Run the ML training pipeline')
    print('  2. Evaluate model performance')
    print('  3. Deploy best model to API')
    print('  4. Continue data collection for improvement')

if __name__ == "__main__":
    analyze_data()

