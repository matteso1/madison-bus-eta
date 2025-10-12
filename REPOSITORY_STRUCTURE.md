# Repository Structure

## Overview

This document explains the organization and purpose of files in this repository.

## Root Directory

```
madison-bus-eta/
├── README.md                      # Main project documentation
├── LICENSE                        # MIT License
├── CONTRIBUTING.md                # Contribution guidelines
├── GITHUB_SETUP.md               # Guide for pushing to GitHub
├── REPOSITORY_STRUCTURE.md       # This file
├── ML_PROJECT_SUMMARY.md         # Detailed ML project analysis
├── PROJECT_BLOG_POST.md          # Blog-style project writeup
├── APIDOCUMENTATION.md           # API endpoint documentation
├── DEPLOYMENT_GUIDE.md           # Deployment instructions
├── PORTFOLIO_PRESENTATION.md     # Portfolio presentation notes
├── .gitignore                    # Git ignore rules
├── vercel.json                   # Vercel deployment config
├── backend/                      # Backend Python code
├── frontend/                     # Frontend React code
└── ml_system/                    # Advanced ML experiments
```

## Backend Structure

### Main Application Files

**`backend/app.py`**
- Main Flask application
- Defines all API endpoints
- Integrates ML prediction system
- Handles CORS and error management

**`backend/optimal_collector.py`**
- Data collection system
- Implements smart polling strategy
- Rate limiting and API usage tracking
- Saves data to CSV files

**`backend/requirements.txt`**
- Python dependencies
- Includes Flask, pandas, scikit-learn, XGBoost, LightGBM

### Machine Learning Pipeline

**`backend/ml/data_consolidator.py`**
- Loads and merges 4,000+ CSV files
- Creates unified ML-ready dataset
- Data quality analysis
- Generates summary reports

**`backend/ml/feature_engineer.py`**
- Engineers 28 features from raw data
- Temporal features (time of day, day of week)
- Route and stop statistics
- Interaction features
- Saves encoders for production use

**`backend/ml/train_arrival_models.py`**
- Trains 4 ML models (XGBoost, LightGBM, Random Forest, Gradient Boosting)
- Evaluates against API baseline
- Compares model performance
- Saves trained models and results

**`backend/ml/smart_prediction_api.py`**
- Production ML API wrapper
- Loads trained models
- Creates feature vectors for predictions
- Provides enhanced arrival time predictions

**`backend/ml/prepare_kaggle_dataset.py`**
- Cleans and prepares dataset for public release
- Creates train/test splits
- Generates metadata and documentation
- Creates README for Kaggle

**`backend/ml/prediction_api.py`**
- Original prediction API (baseline)
- Legacy ML integration

**`backend/ml/data_processor.py`**
- Data processing utilities
- Feature preparation helpers

**`backend/ml/train_models.py`**
- Model training utilities
- Cross-validation helpers

**`backend/ml/__init__.py`**
- Makes ml/ a Python package

### Utilities

**`backend/data_analysis_api.py`**
- Data analysis endpoints
- Statistics and visualizations API

**`backend/visualize_routes.py`**
- Route visualization generation
- Creates interactive maps

**`backend/setup_ml.py`**
- ML system initialization
- Sample data generation

**`backend/utils/api.py`**
- API utility functions
- Madison Metro API wrappers

### Data Directories (gitignored)

**`backend/collected_data/`**
- Raw CSV files from data collection
- 2,000+ prediction files
- 2,000+ vehicle location files
- HTML visualization files

**`backend/ml/data/`**
- `consolidated_metro_data.csv` - Unified dataset
- `featured_metro_data.csv` - Feature-engineered data
- `data_summary.json` - Statistics

**`backend/ml/models/`**
- `xgboost_arrival_model.pkl` - Best model (1.44 MB)
- `lightgbm_arrival_model.pkl` - Alternative model
- `random_forest_arrival_model.pkl` - Random forest
- `gradient_boosting_arrival_model.pkl` - Gradient boosting

**`backend/ml/encoders/`**
- `feature_encoders.pkl` - Saved encoders and statistics

**`backend/ml/results/`**
- `model_results.json` - Training results

**`backend/kaggle_dataset/`**
- Clean dataset prepared for Kaggle
- Includes README and metadata
- train.csv and test.csv splits

## Frontend Structure

**`frontend/src/App.js`**
- Main React application component
- Route selection and display

**`frontend/src/MapView.js`**
- Interactive map with vehicle locations
- Route visualization

**`frontend/src/MLDashboard.js`**
- ML metrics dashboard
- Model performance display

**`frontend/src/AboutPage.js`**
- About page with project information

**`frontend/src/api.js`**
- API communication utilities

**`frontend/public/`**
- Static assets (icons, images)
- index.html template

**`frontend/package.json`**
- Node.js dependencies
- React, Leaflet for maps

## ML System (Advanced)

**`ml_system/`**
- Experimental advanced ML features
- Transformer models
- Deep learning experiments
- Research notebooks

**Key subdirectories:**
- `configs/` - Configuration files
- `data/processors/` - Advanced data processors
- `models/delay_prediction/` - Transformer models
- `training/trainers/` - Custom training loops
- `notebooks/` - Jupyter notebooks

## Documentation Files

**`README.md`**
- Primary documentation
- Setup instructions
- Project overview
- Results and performance

**`ML_PROJECT_SUMMARY.md`**
- Detailed ML analysis
- Interview talking points
- Technical deep dive

**`APIDOCUMENTATION.md`**
- Complete API reference
- Endpoint documentation
- Request/response examples

**`DEPLOYMENT_GUIDE.md`**
- Deployment instructions
- Production setup
- Environment configuration

**`PROJECT_BLOG_POST.md`**
- Blog-style project writeup
- Narrative format
- Journey and learnings

**`PORTFOLIO_PRESENTATION.md`**
- Portfolio talking points
- Interview preparation
- Key achievements

## Configuration Files

**`.gitignore`**
- Excludes large files (CSV, PKL)
- Excludes environment files
- Excludes node_modules and venv

**`vercel.json`**
- Vercel deployment configuration
- Frontend hosting settings

**`Dockerfile` (if present)**
- Docker containerization
- Production deployment

**`.env` (not committed)**
- Environment variables
- API keys
- Configuration secrets

## File Size Reference

### Small files (committed to git):
- All `.py` files: < 100 KB each
- All `.md` files: < 100 KB each
- Configuration files: < 10 KB each

### Large files (excluded from git):
- CSV data files: 40+ MB
- Model files: 200+ MB total
- Feature-engineered data: 90 MB

## Quick Navigation

### To run the application:
```bash
backend/app.py                    # Start Flask API
frontend/src/App.js               # React frontend entry
```

### To train models:
```bash
backend/ml/data_consolidator.py   # Step 1: Consolidate data
backend/ml/feature_engineer.py    # Step 2: Engineer features
backend/ml/train_arrival_models.py # Step 3: Train models
```

### To prepare dataset:
```bash
backend/ml/prepare_kaggle_dataset.py
```

### To collect data:
```bash
backend/optimal_collector.py
```

## Dependencies

### Python (backend/requirements.txt)
- Flask 3.1.2
- pandas 2.3.2
- scikit-learn 1.7.1
- xgboost 1.7.6
- lightgbm 4.1.0
- numpy 2.3.2
- requests 2.32.5

### JavaScript (frontend/package.json)
- React 18.x
- Leaflet (maps)
- Axios (HTTP)

## Version Control

### Branches:
- `main` - Production-ready code
- Create feature branches for development

### Git Workflow:
1. Make changes
2. `git add .` (respects .gitignore)
3. `git commit -m "message"`
4. `git push origin main`

## Support

For questions about specific files or functionality, refer to:
- Code comments within files
- Docstrings in Python functions
- Individual file documentation
- README.md for general guidance

## Updates

This structure document should be updated when:
- New major files are added
- Directory structure changes
- New ML models are introduced
- API endpoints are modified

