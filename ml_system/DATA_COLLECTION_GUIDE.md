# Madison Metro Data Collection Guide

## 🎯 **Data Collection Strategy**

### **Minimum Requirements for ML Training**

| Data Type | Minimum Records | Optimal Records | Collection Time |
|-----------|----------------|-----------------|-----------------|
| **Vehicle Positions** | 50,000 | 200,000+ | 1-2 weeks |
| **Predictions** | 200,000 | 1,000,000+ | 1-2 weeks |
| **Unique Routes** | 15+ | 25+ | Continuous |
| **Time Coverage** | 7 days | 14+ days | Continuous |

### **Data Quality Metrics**

- **Completeness**: >95% of expected data points
- **Accuracy**: GPS coordinates within 10m accuracy
- **Consistency**: Timestamps aligned with collection schedule
- **Coverage**: All major routes represented

## ⏰ **Recommended Collection Duration**

### **Phase 1: Minimum Viable Dataset (1 Week)**
- **Duration**: 7 days continuous
- **Expected Records**: 
  - Vehicle: ~50,000 records
  - Predictions: ~200,000 records
- **Use Case**: Basic model training, proof of concept

### **Phase 2: Robust Dataset (2-4 Weeks)**
- **Duration**: 14-28 days continuous
- **Expected Records**:
  - Vehicle: ~200,000+ records
  - Predictions: ~1,000,000+ records
- **Use Case**: Production-ready models, comprehensive evaluation

### **Phase 3: Long-term Monitoring (Ongoing)**
- **Duration**: Continuous
- **Purpose**: Model retraining, performance monitoring, system improvements

## 📊 **Data Collection Schedule**

Your current `optimal_collector.py` is perfectly configured with:

### **Rush Hours (7-9 AM, 5-7 PM)**
- **Frequency**: Every 1 minute
- **Routes**: Rapid + UW Campus + Peak routes
- **Priority**: High (most important for delay prediction)

### **Business Hours (9 AM - 5 PM)**
- **Frequency**: Every 2 minutes
- **Routes**: All active routes
- **Priority**: Medium (good coverage for demand forecasting)

### **Evening (8-10 PM)**
- **Frequency**: Every 3 minutes
- **Routes**: UW Campus routes
- **Priority**: Medium (student transportation)

### **Night (10 PM - 6 AM)**
- **Frequency**: Every 10 minutes
- **Routes**: UW Campus routes only
- **Priority**: Low (minimal service)

## 🔍 **Data Sufficiency Indicators**

### **✅ Ready for Training When:**
- [ ] At least 1 week of continuous data
- [ ] 50,000+ vehicle position records
- [ ] 200,000+ prediction records
- [ ] 15+ unique routes covered
- [ ] Data spans all time periods (rush, business, evening, night)
- [ ] No major gaps in data collection

### **⚠️ Warning Signs:**
- [ ] Less than 1,000 records per day
- [ ] Missing data for major routes (A, B, C, D, E, F, 80, 81, 82, 84)
- [ ] Large gaps in timestamps (>2 hours)
- [ ] Inconsistent data formats

## 🚀 **Quick Start Commands**

### **1. Start Data Collection**
```bash
# Terminal 1: Start API server
cd backend
python app.py

# Terminal 2: Start data collector
cd backend
python optimal_collector.py
```

### **2. Monitor Collection**
```bash
# Check log file
tail -f backend/optimal_collection.log

# Check data files
ls -la backend/collected_data/ | wc -l

# Check latest data
head -5 backend/collected_data/vehicles_*.csv | tail -1
```

### **3. Verify Data Quality**
```bash
# Count records
wc -l backend/collected_data/vehicles_*.csv
wc -l backend/collected_data/predictions_*.csv

# Check data freshness
ls -lt backend/collected_data/ | head -5
```

## 📈 **Expected Data Growth**

### **Daily Estimates**
- **Vehicle Records**: 5,000-15,000 per day
- **Prediction Records**: 20,000-60,000 per day
- **File Size**: ~50-150 MB per day
- **API Calls**: 2,000-5,000 per day

### **Weekly Estimates**
- **Vehicle Records**: 35,000-105,000 per week
- **Prediction Records**: 140,000-420,000 per week
- **Total Size**: ~350 MB - 1 GB per week

## 🎯 **ML Training Readiness**

### **Run This Command to Check:**
```bash
cd ml_system
python -c "
import sys
sys.path.append('.')
from train_delay_predictor import check_data_sufficiency
import yaml

with open('configs/config.yaml', 'r') as f:
    config = yaml.safe_load(f)

if check_data_sufficiency(config):
    print('✅ Ready for ML training!')
else:
    print('❌ Need more data. Keep collecting!')
"
```

## 🔧 **Troubleshooting**

### **Common Issues:**

1. **API Limit Reached**
   - **Solution**: Wait until midnight for reset
   - **Prevention**: Monitor daily usage in logs

2. **No Data Files**
   - **Check**: API server running on port 5000
   - **Check**: API key in .env file
   - **Check**: Network connectivity

3. **Insufficient Data**
   - **Solution**: Let collection run longer
   - **Check**: Route coverage in data

4. **Data Quality Issues**
   - **Check**: GPS coordinate ranges (Madison area)
   - **Check**: Timestamp consistency
   - **Check**: Route ID validity

## 📋 **Data Collection Checklist**

### **Before Starting:**
- [ ] API key configured in `.env`
- [ ] Backend API server running
- [ ] Data collector script ready
- [ ] Sufficient disk space (>5 GB)

### **During Collection:**
- [ ] Monitor log files daily
- [ ] Check data file creation
- [ ] Verify API call limits
- [ ] Monitor system resources

### **After Collection:**
- [ ] Verify data completeness
- [ ] Check data quality metrics
- [ ] Run ML training readiness check
- [ ] Backup data files

## 🎉 **Success Criteria**

Your data collection is successful when you can run:

```bash
cd ml_system
python train_delay_predictor.py
```

And see:
```
✅ Data sufficiency check passed!
✅ Processed 150,000+ records
🚀 Starting Madison Metro ML Training Pipeline
```

**Remember**: The more data you collect, the better your ML models will perform. 2-4 weeks of continuous collection will give you production-ready models that can compete with commercial transit prediction systems!
