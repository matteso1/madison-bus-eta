# Madison Metro ML System

Professional ML system for transit optimization using PyTorch and GPU acceleration.

## 🏗️ Directory Structure

```
ml_system/
├── data/                    # Data processing and feature engineering
│   ├── processors/         # Data processors and transformers
│   ├── features/           # Feature engineering pipelines
│   └── validation/         # Data validation and quality checks
├── models/                 # PyTorch model architectures
│   ├── delay_prediction/   # Delay prediction models
│   ├── demand_forecasting/ # Demand forecasting models
│   └── anomaly_detection/  # Anomaly detection models
├── training/               # Model training scripts
│   ├── trainers/           # Training classes and utilities
│   ├── configs/            # Training configurations
│   └── experiments/        # Experiment tracking
├── inference/              # Model inference and serving
│   ├── api/                # FastAPI prediction endpoints
│   ├── batch/              # Batch prediction scripts
│   └── realtime/           # Real-time prediction services
├── evaluation/             # Model evaluation and metrics
│   ├── metrics/            # Custom evaluation metrics
│   ├── visualizations/     # Model performance visualizations
│   └── reports/            # Automated evaluation reports
├── deployment/             # Deployment and MLOps
│   ├── docker/             # Docker configurations
│   ├── monitoring/         # Model monitoring and alerting
│   └── pipelines/          # CI/CD pipelines
├── notebooks/              # Jupyter notebooks for exploration
├── tests/                  # Unit and integration tests
├── configs/                # Configuration files
└── requirements/           # Python dependencies
```

## 🚀 Quick Start

1. **Setup Environment:**
   ```bash
   cd ml_system
   pip install -r requirements/pytorch-gpu.txt
   ```

2. **Process Data:**
   ```bash
   python -m data.processors.metro_processor
   ```

3. **Train Models:**
   ```bash
   python -m training.train_delay_predictor
   ```

4. **Start API:**
   ```bash
   python -m inference.api.main
   ```

## 🎯 ML Problems

1. **Real-Time Delay Prediction** - Predict bus delays with <1s response time
2. **Demand Forecasting** - Forecast passenger demand for route optimization
3. **Anomaly Detection** - Detect system issues and traffic incidents
4. **Route Optimization** - Optimize bus frequencies and routes

## 🔧 Tech Stack

- **PyTorch** with CUDA acceleration
- **FastAPI** for high-performance APIs
- **Weights & Biases** for experiment tracking
- **PostgreSQL** for feature storage
- **Docker** for deployment
- **Streamlit** for dashboards

## 📊 Data Requirements

- **Minimum**: 1 week of continuous data collection
- **Optimal**: 2-4 weeks for robust model training
- **Target**: 100K+ vehicle records, 500K+ prediction records
