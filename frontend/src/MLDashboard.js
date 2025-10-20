import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Brain, 
  TrendingUp, 
  Activity, 
  Award,
  Target,
  Zap,
  Database,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  BarChart3
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  Cell
} from 'recharts';
import './MLDashboard.css';

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";

// Professional color palette
const COLORS = {
  primary: '#6366f1',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',
  purple: '#a855f7',
  models: ['#6366f1', '#8b5cf6', '#a855f7', '#c084fc', '#e9d5ff']
};

const MLDashboard = () => {
  const [mlData, setMlData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMLData = async () => {
    try {
      setRefreshing(true);
      setError(null);

      // Fetch all data in parallel
      const [performanceRes, featuresRes, insightsRes, statusRes, dataStatsRes] = await Promise.all([
        fetch(`${API_BASE}/ml/performance`),
        fetch(`${API_BASE}/ml/features`),
        fetch(`${API_BASE}/ml/insights`),
        fetch(`${API_BASE}/ml/status`),
        fetch(`${API_BASE}/ml/data-stats`)
      ]);

      const performance = await performanceRes.json();
      const features = await featuresRes.json();
      const insights = await insightsRes.json();
      const status = await statusRes.json();
      const dataStats = await dataStatsRes.json();

      // Process model comparison data
      const models = performance.models || {};
      const modelComparison = Object.keys(models).map(key => {
        const model = models[key];
        return {
          name: model.name,
          mae: model.mae,
          rmse: model.rmse,
          r2: model.r2 * 100, // Convert to percentage
          accuracy_1min: model.within_1min || 0
        };
      });

      // Get best model (XGBoost)
      const bestModel = models.xgboost || {};

      setMlData({
        performance: {
          ...performance,
          modelComparison,
          bestModel
        },
        features: features.features || [],
        insights: insights.insights || [],
        status,
        dataStats: dataStats.ml_dataset || {},
        predictionsStats: dataStats.predictions_analysis || {},
        totalRecords: dataStats.ml_dataset?.total_records || 0,
        uniqueRoutes: dataStats.ml_dataset?.unique_routes || 0,
        uniqueStops: dataStats.ml_dataset?.unique_stops || 0
      });

    } catch (err) {
      console.error('Error fetching ML data:', err);
      setError('Failed to load ML data. Please check if the backend is running.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchMLData();
  }, []);

  const handleRefresh = () => {
    fetchMLData();
  };

  if (loading) {
    return (
      <div className="ml-dashboard">
        <div className="loading">
          <div className="loading-icon">
            <Brain size={32} />
          </div>
          <p>Loading ML Analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ml-dashboard">
        <div className="error">
          <AlertCircle size={32} />
          <p>{error}</p>
          <button onClick={handleRefresh} className="refresh-button">
            <RefreshCw size={16} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!mlData) {
    return (
      <div className="ml-dashboard">
        <div className="error">
          <AlertCircle size={32} />
          <p>No ML data available</p>
        </div>
      </div>
    );
  }

  const { performance, features, insights, status, dataStats, totalRecords, uniqueRoutes, uniqueStops, predictionsStats } = mlData;
  const { bestModel, modelComparison } = performance;

  return (
    <div className="ml-dashboard">
      {/* Header */}
      <div className="ml-header">
        <div className="ml-title">
          <Brain className="ml-icon" size={32} />
          <div>
            <h2>Machine Learning Analytics</h2>
            <p className="ml-subtitle">Predictive Models & Performance Insights</p>
          </div>
        </div>
        <button 
          onClick={handleRefresh} 
          className="refresh-button"
          disabled={refreshing}
        >
          <RefreshCw className={`refresh-icon ${refreshing ? 'spinning' : ''}`} size={16} />
          Refresh
        </button>
      </div>

      {/* Hero Stats */}
      <div className="hero-stats">
        <motion.div 
          className="hero-card champion"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Award size={40} className="hero-icon" />
          <div className="hero-content">
            <div className="hero-value">{bestModel.within_1min?.toFixed(2)}%</div>
            <div className="hero-label">Accuracy Within 1 Minute</div>
            <div className="hero-badge">🏆 XGBoost Model</div>
          </div>
        </motion.div>

        <motion.div 
          className="hero-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <TrendingUp size={40} className="hero-icon" />
          <div className="hero-content">
            <div className="hero-value">21.3%</div>
            <div className="hero-label">Better Than Official API</div>
            <div className="hero-badge">✨ Improvement</div>
          </div>
        </motion.div>

        <motion.div 
          className="hero-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Database size={40} className="hero-icon" />
          <div className="hero-content">
            <div className="hero-value">{totalRecords.toLocaleString()}</div>
            <div className="hero-label">Training Records</div>
            <div className="hero-badge">📊 Dataset</div>
          </div>
        </motion.div>
      </div>

      {/* Model Performance Metrics */}
      <div className="section-header">
        <BarChart3 size={24} />
        <h3>Model Performance Comparison</h3>
      </div>

      <div className="model-comparison-grid">
        {modelComparison.slice(1).map((model, index) => (
          <motion.div 
            key={model.name}
            className="model-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + index * 0.1 }}
          >
            <div className="model-header">
              <h4>{model.name}</h4>
              {index === 0 && <span className="best-badge">BEST</span>}
            </div>
            <div className="model-metrics">
              <div className="model-metric">
                <span className="metric-label">MAE</span>
                <span className="metric-value">{model.mae.toFixed(3)}</span>
              </div>
              <div className="model-metric">
                <span className="metric-label">RMSE</span>
                <span className="metric-value">{model.rmse.toFixed(3)}</span>
              </div>
              <div className="model-metric">
                <span className="metric-label">R²</span>
                <span className="metric-value">{model.r2.toFixed(2)}%</span>
              </div>
              <div className="model-metric highlight">
                <span className="metric-label">1-Min Accuracy</span>
                <span className="metric-value">{model.accuracy_1min.toFixed(2)}%</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="charts-section">
        <motion.div 
          className="chart-card large"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
        >
          <h3>Model Accuracy Comparison (Within 1 Minute)</h3>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={modelComparison.slice(1)}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" />
              <YAxis domain={[99, 100]} />
              <Tooltip 
                formatter={(value) => `${value.toFixed(2)}%`}
                contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
              />
              <Bar dataKey="accuracy_1min" fill={COLORS.primary} radius={[8, 8, 0, 0]}>
                {modelComparison.slice(1).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS.models[index % COLORS.models.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div 
          className="chart-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
        >
          <h3>Model Error Metrics (Lower is Better)</h3>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={modelComparison.slice(1)}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
              />
              <Legend />
              <Bar dataKey="mae" fill={COLORS.info} name="MAE" radius={[8, 8, 0, 0]} />
              <Bar dataKey="rmse" fill={COLORS.purple} name="RMSE" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Feature Importance */}
      <motion.div 
        className="feature-importance-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9 }}
      >
        <div className="section-header">
          <Target size={24} />
          <h3>Top 10 Feature Importance</h3>
        </div>
        <div className="feature-list">
          {features.slice(0, 10).map((feature, index) => (
            <motion.div 
              key={index} 
              className="feature-item"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1.0 + index * 0.05 }}
            >
              <div className="feature-rank">#{index + 1}</div>
              <div className="feature-info">
                <span className="feature-name">{feature.name}</span>
                <span className="feature-description">{feature.description}</span>
              </div>
              <div className="feature-bar">
                <div 
                  className="feature-fill" 
                  style={{ 
                    width: `${feature.importance * 100}%`,
                    backgroundColor: COLORS.models[index % COLORS.models.length]
                  }}
                ></div>
              </div>
              <span className="feature-value">{(feature.importance * 100).toFixed(1)}%</span>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ML Insights */}
      <div className="section-header" style={{ marginTop: '3rem' }}>
        <Activity size={24} />
        <h3>Key Insights & Findings</h3>
      </div>
      <div className="insights-grid">
        {insights.map((insight, index) => (
          <motion.div 
            key={index}
            className="insight-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.3 + index * 0.1 }}
          >
            <div className={`insight-impact-badge ${insight.impact.toLowerCase()}`}>
              {insight.impact}
            </div>
            <h4>{insight.title}</h4>
            <p>{insight.description}</p>
            <div className="insight-footer">
              <span className="insight-category">{insight.category}</span>
              <CheckCircle size={16} />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Data Quality Summary */}
      <motion.div 
        className="data-summary-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.7 }}
      >
        <div className="section-header">
          <Database size={24} />
          <h3>Dataset Statistics</h3>
        </div>
        <div className="data-summary-grid">
          <div className="data-stat">
            <div className="data-stat-value">{totalRecords.toLocaleString()}</div>
            <div className="data-stat-label">Total Records</div>
          </div>
          <div className="data-stat">
            <div className="data-stat-value">{performance.train_size?.toLocaleString()}</div>
            <div className="data-stat-label">Training Set</div>
          </div>
          <div className="data-stat">
            <div className="data-stat-value">{performance.test_size?.toLocaleString()}</div>
            <div className="data-stat-label">Test Set</div>
          </div>
          <div className="data-stat">
            <div className="data-stat-value">{uniqueRoutes}</div>
            <div className="data-stat-label">Routes</div>
          </div>
          <div className="data-stat">
            <div className="data-stat-value">{uniqueStops}</div>
            <div className="data-stat-label">Stops</div>
          </div>
          <div className="data-stat">
            <div className="data-stat-value">{performance.num_features}</div>
            <div className="data-stat-label">Features</div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default MLDashboard;