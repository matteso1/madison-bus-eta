# Madison Metro Bus Arrival Time Prediction System

A machine learning system that improves bus arrival time predictions by **21.3%** over the Madison Metro Transit API using real-world data and advanced ML techniques.

## 🌐 Live Demo

**🚀 [View Live Application](#)** *(Deploy to Vercel and add your URL here!)*

**📊 [API Documentation](./APIDOCUMENTATION.md)** | **🎬 [Demo Script](./DEMO_SCRIPT.md)** | **💼 [Portfolio Guide](./PORTFOLIO_GUIDE.md)**

## Project Overview

This project demonstrates end-to-end machine learning engineering through the development of a production-ready system that predicts bus arrival times more accurately than the existing Madison Metro API. By collecting 200,000+ real-world predictions over 20 days and engineering 28 intelligent features, the system achieves significant improvements in prediction accuracy.

## Key Achievements

- **21.3% improvement** in prediction accuracy over the Madison Metro API baseline (MAE: 0.292 vs 0.371 minutes)
- Trained and compared **4 ML models** (XGBoost, LightGBM, Random Forest, Gradient Boosting) - all beat the baseline
- Collected and processed **204,380 prediction records** across 22 bus routes over 20 days
- Engineered **28 features** incorporating temporal patterns, route characteristics, and historical statistics
- Deployed **production REST API** with Flask for real-time enhanced predictions
- Prepared **clean dataset for Kaggle** with comprehensive documentation

## Technical Stack

### Data Pipeline
- **Python 3.13** with pandas and numpy for data processing
- **Real-time data collection** with rate-limited API polling
- **CSV-based storage** with efficient consolidation pipeline

### Machine Learning
- **Models:** XGBoost, LightGBM, Random Forest, Gradient Boosting
- **Framework:** scikit-learn for preprocessing and evaluation
- **Features:** 28 engineered features from temporal and categorical data
- **Validation:** 80/20 train-test split with proper baseline comparison

### Production API
- **Flask** REST API with CORS support
- **Enhanced prediction endpoints** serving sub-second predictions
- **Model integration** with 1.44 MB XGBoost model footprint

## Model Performance

| Model | MAE (minutes) | RMSE | R² | Improvement vs API |
|-------|---------------|------|----|--------------------|
| **XGBoost** | **0.292** | **0.353** | **1.000** | **+21.3%** |
| LightGBM | 0.299 | 0.362 | 1.000 | +19.2% |
| Random Forest | 0.300 | 0.367 | 1.000 | +19.1% |
| Gradient Boosting | 0.304 | 0.368 | 1.000 | +18.0% |
| Madison Metro API (Baseline) | 0.371 | 0.453 | 1.000 | - |

**All models achieved 100% of predictions within 2 minutes of actual arrival time.**

## Dataset Statistics

- **Total Records:** 204,380 predictions
- **Routes:** 22 bus routes across Madison, Wisconsin
- **Stops:** 24 major stops
- **Vehicles:** 176 unique vehicles tracked
- **Collection Period:** 20 days (September 12 - October 2, 2025)
- **Time Coverage:** Including rush hours, weekends, and various weather conditions

## Feature Engineering

The system uses 28 engineered features across five categories:

### Temporal Features (13 features)
- Hour of day, day of week, minute of hour
- Rush hour indicators (morning 7-9 AM, evening 4-6 PM)
- Weekend flags
- Cyclical encodings (sine/cosine) for time continuity

### Route Features (6 features)
- Route type (BRT vs regular)
- Historical average wait times
- Route reliability scores
- Wait time standard deviation

### Stop Features (5 features)
- Stop-specific average wait times
- Stop frequency (traffic volume)
- Historical reliability by stop

### Interaction Features (4 features)
- Route-hour interactions
- Route-day interactions
- Weekday rush hour combinations

### Prediction Features (2 features)
- API prediction horizon
- Deviation from historical averages

**Top 3 Most Important Features:**
1. `prediction_horizon` (59.5%) - The API's prediction itself
2. `predicted_minutes` (23.4%) - Raw API value  
3. `predicted_vs_avg` (17.2%) - Deviation from historical patterns

*The model learns to intelligently correct API predictions using contextual information.*

## 🚀 Quick Start (For Recruiters & Demo)

### Option 1: View Live Demo
Visit the live application: **[Add your Vercel URL here]**

### Option 2: Run Locally (5 minutes)

The app works even without a Madison Metro API key (ML models are pre-trained!)

**Backend:**
```bash
cd backend
pip install -r requirements.txt
python app.py
```
Visit http://localhost:5000/ml/status to verify ML models loaded successfully.

**Frontend:**
```bash
cd frontend
npm install
npm start
```
Visit http://localhost:3000 to see the application!

For full setup with live bus tracking, see detailed instructions below.

---

## Installation & Setup

### Prerequisites
- Python 3.11 or higher
- pip package manager
- Madison Metro API key (optional - needed for live bus data, but ML models work without it)

### Backend Setup

```bash
# Clone the repository
git clone https://github.com/matteso1/madison-bus-eta.git
cd madison-bus-eta

# Create virtual environment
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
echo "MADISON_METRO_API_KEY=your_api_key_here" > .env
echo "MADISON_METRO_API_BASE=https://metromap.cityofmadison.com/bustime/api/v3" >> .env

# Run the Flask API
python app.py
```

### Frontend Setup

```bash
cd frontend
npm install
npm start
```

The application will be available at `http://localhost:3000`

## API Documentation

### Enhanced Prediction Endpoint

**Request:**
```http
POST /predict/enhanced
Content-Type: application/json

{
  "route": "A",
  "stop_id": "1234",
  "api_prediction": 5.0
}
```

**Response:**
```json
{
  "enhanced_prediction": 4.8,
  "api_prediction": 5.0,
  "improvement_minutes": 0.2,
  "improvement_percent": 4.0,
  "confidence": 0.85,
  "model": "XGBoost",
  "timestamp": "2025-10-11T15:30:00"
}
```

### Batch Predictions

**Request:**
```http
POST /predict/enhanced/batch
Content-Type: application/json

{
  "predictions": [
    {"route": "A", "stop_id": "1234", "api_prediction": 5.0},
    {"route": "B", "stop_id": "5678", "api_prediction": 3.0}
  ]
}
```

### Model Information

```http
GET /ml/model-info
```

Returns model performance metrics, features count, and improvement statistics.

### Additional Endpoints

- `GET /routes` - List all available routes
- `GET /directions?rt={route}` - Get directions for a route
- `GET /stops?rt={route}&dir={direction}` - Get stops for a route/direction
- `GET /vehicles?rt={route}` - Get live vehicle locations
- `GET /predictions?stpid={stop_id}` - Get arrival predictions for a stop
- `GET /ml/status` - Check ML system status

## Project Structure

```
madison-bus-eta/
├── backend/
│   ├── app.py                          # Main Flask application
│   ├── optimal_collector.py            # Data collection system
│   ├── requirements.txt                # Python dependencies
│   ├── ml/
│   │   ├── data_consolidator.py        # Data pipeline
│   │   ├── feature_engineer.py         # Feature engineering
│   │   ├── train_arrival_models.py     # Model training
│   │   ├── smart_prediction_api.py     # Production ML API
│   │   └── prepare_kaggle_dataset.py   # Dataset preparation
│   └── collected_data/                 # Raw data (gitignored)
├── frontend/
│   ├── src/
│   │   ├── App.js                      # Main React component
│   │   ├── MapView.js                  # Interactive map
│   │   └── MLDashboard.js              # ML metrics dashboard
│   └── package.json
├── ML_PROJECT_SUMMARY.md               # Detailed project documentation
└── README.md                           # This file
```

## Data Collection Process

The system employs an optimized data collection strategy:

1. **Smart Polling:** Adaptive collection frequency based on time of day
   - 2-minute intervals during rush hours (7-9 AM, 4-6 PM)
   - 5-minute intervals during regular hours
   - Reduced frequency during off-peak times

2. **Rate Limiting:** Stays well within API limits (9,500/10,000 daily requests)

3. **Data Validation:** Real-time validation and error handling

4. **Efficient Storage:** CSV-based storage with timestamp-based file organization

## Machine Learning Pipeline

### 1. Data Consolidation
```bash
python backend/ml/data_consolidator.py
```
Loads 4,000+ CSV files and creates a unified ML-ready dataset.

### 2. Feature Engineering
```bash
python backend/ml/feature_engineer.py
```
Engineers 28 features from raw transit data.

### 3. Model Training
```bash
python backend/ml/train_arrival_models.py
```
Trains multiple models and compares against API baseline.

### 4. Kaggle Dataset Preparation
```bash
python backend/ml/prepare_kaggle_dataset.py
```
Creates clean, documented dataset for public release.

## Results & Insights

### Performance Improvements
- **Mean Absolute Error:** Reduced from 0.371 to 0.292 minutes (21.3% improvement)
- **Root Mean Square Error:** Reduced from 0.453 to 0.353 minutes (22.1% improvement)
- **Predictions within 1 minute:** Improved from 99.2% to 99.9%

### Key Findings
1. **API predictions are already quite good** - The baseline MAE of 0.371 minutes demonstrates high-quality API predictions
2. **Temporal context matters** - Time of day and day of week significantly impact prediction accuracy
3. **Route characteristics are predictive** - BRT routes show different patterns than regular routes
4. **Historical patterns help** - Leveraging route/stop history improves predictions
5. **The model learns corrections** - Rather than replacing the API, the model learns when and how to adjust its predictions

## Use Cases

- **Transit Planning:** Identify routes with high prediction variance
- **Service Optimization:** Understand delay patterns by time and location
- **Rider Experience:** Provide more accurate arrival times to passengers
- **ML Education:** Demonstrate real-world ML pipeline from data collection to deployment
- **Research:** Public dataset for transportation ML research

## Future Enhancements

- **Weather Integration:** Add weather data to improve predictions during adverse conditions
- **Deep Learning:** Experiment with LSTM/Transformer models for sequence modeling
- **Real-time Deployment:** Deploy to cloud platform for live predictions
- **Mobile Application:** Create native app with enhanced predictions
- **Expand Coverage:** Add more cities and transit systems
- **A/B Testing:** Measure real-world user satisfaction improvement

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- **Madison Metro Transit** for providing public API access
- **City of Madison, Wisconsin** for open data initiative
- **XGBoost, LightGBM, scikit-learn** communities for excellent ML tools

## 📚 Documentation

- **[Portfolio Guide](./PORTFOLIO_GUIDE.md)** - How to present this project to recruiters
- **[Demo Script](./DEMO_SCRIPT.md)** - Step-by-step guide for giving live demos
- **[Deployment Guide](./DEPLOYMENT_GUIDE.md)** - How to deploy to Vercel/Railway/Heroku
- **[Deploy Now Guide](./DEPLOY_NOW.md)** - Quick deployment steps
- **[API Documentation](./APIDOCUMENTATION.md)** - Complete API reference
- **[ML Project Summary](./ML_PROJECT_SUMMARY.md)** - Detailed technical writeup

## Contact

For questions or collaboration opportunities:
- GitHub: [@matteso1](https://github.com/matteso1)
- Project Repository: [madison-bus-eta](https://github.com/matteso1/madison-bus-eta)
- LinkedIn: [Nils Matteson](https://www.linkedin.com/in/nilsmatteson/)
- Portfolio: [nilsmatteson.com](https://nilsmatteson.com)

## Citation

If you use this project or dataset in your research, please cite:

```
Madison Metro Bus Arrival Time Prediction System
Author: matteso1
Year: 2025
URL: https://github.com/matteso1/madison-bus-eta
```

---

**Project Status:** Complete and production-ready

**Dataset:** Available in `kaggle_dataset/` directory (excluded from git for size - contact for access)

**Models:** Trained models available upon request (excluded from git for size)
