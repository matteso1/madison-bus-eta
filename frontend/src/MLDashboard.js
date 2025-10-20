import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Brain, 
  TrendingUp, 
  Activity, 
  Clock, 
  Target,
  Zap,
  Database,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";

const MLDashboard = () => {
  const [mlData, setMlData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMLData = async () => {
    try {
      setRefreshing(true);
      setError(null);

      // Fetch ML performance data
      const performanceResponse = await fetch(`${API_BASE}/ml/performance`);
      const performance = await performanceResponse.json();

      // Fetch feature importance
      const featuresResponse = await fetch(`${API_BASE}/ml/features`);
      const features = await featuresResponse.json();

      // Fetch insights
      const insightsResponse = await fetch(`${API_BASE}/ml/insights`);
      const insights = await insightsResponse.json();

      // Fetch ML status
      const statusResponse = await fetch(`${API_BASE}/ml/status`);
      const status = await statusResponse.json();

      // Create mock prediction data for visualization
      const delayPredictions = generatePredictionData();
      const routePerformance = generateRouteData();

      setMlData({
        performance,
        features: features.features || [],
        insights: insights.insights || [],
        status,
        delayPredictions,
        routePerformance,
        dataQuality: [
          { name: 'Complete', value: 95.4, color: '#00C851' },
          { name: 'Missing', value: 4.6, color: '#FF4444' }
        ]
      });

    } catch (err) {
      console.error('Error fetching ML data:', err);
      setError('Failed to load ML data. Please check if the backend is running.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const generatePredictionData = () => {
    // Generate sample prediction data for visualization
    const hours = ['6:00', '7:00', '8:00', '9:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
    return hours.map(hour => {
      const h = parseInt(hour.split(':')[0]);
      const baseDelay = h >= 7 && h <= 9 ? 3.5 : h >= 17 && h <= 19 ? 3.2 : 2.0;
      const actual = baseDelay + (Math.random() - 0.5) * 1.5;
      const predicted = baseDelay + (Math.random() - 0.5) * 1.0;
      return {
        time: hour,
        actual: Math.max(0, actual),
        predicted: Math.max(0, predicted),
        route: 'A'
      };
    });
  };

  const generateRouteData = () => {
    const routes = ['A', 'B', 'C', 'D', 'E', 'F', '80', '81', '82', '84'];
    return routes.map(route => ({
      route,
      delays: 1.5 + Math.random() * 2.0,
      passengers: 30 + Math.random() * 40,
      trips: 80 + Math.random() * 50
    }));
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

  const { performance, features, insights, status, delayPredictions, routePerformance, dataQuality } = mlData;

  return (
    <div className="ml-dashboard">
      <div className="ml-header">
        <div className="ml-title">
          <Brain className="ml-icon" />
          <h2>Machine Learning Analytics</h2>
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

      <div className="ml-status">
        <div className={`status-indicator ${status.ml_available ? 'active' : 'inactive'}`}>
          <div className="status-dot"></div>
          <span>ML System: {status.ml_available ? 'Active' : 'Inactive'}</span>
        </div>
        <div className={`status-indicator ${status.model_loaded ? 'active' : 'inactive'}`}>
          <div className="status-dot"></div>
          <span>Model: {status.model_loaded ? 'Loaded' : 'Not Loaded'}</span>
        </div>
      </div>

      <div className="metrics-grid">
        <motion.div 
          className="metric-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="metric-icon">
            <Target />
          </div>
          <div className="metric-content">
            <h3>Model Accuracy</h3>
            <p>{performance.accuracy ? `${(performance.accuracy * 100).toFixed(1)}%` : 'N/A'}</p>
          </div>
        </motion.div>

        <motion.div 
          className="metric-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="metric-icon">
            <TrendingUp />
          </div>
          <div className="metric-content">
            <h3>Mean Absolute Error</h3>
            <p>{performance.mae ? `${performance.mae.toFixed(2)} min` : 'N/A'}</p>
          </div>
        </motion.div>

        <motion.div 
          className="metric-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="metric-icon">
            <Database />
          </div>
          <div className="metric-content">
            <h3>Total Predictions</h3>
            <p>{performance.total_predictions ? performance.total_predictions.toLocaleString() : 'N/A'}</p>
          </div>
        </motion.div>

        <motion.div 
          className="metric-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="metric-icon">
            <Zap />
          </div>
          <div className="metric-content">
            <h3>Model Type</h3>
            <p>{performance.model_type || 'XGBoost'}</p>
          </div>
        </motion.div>
      </div>

      <div className="charts-grid">
        <motion.div 
          className="chart-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <h3>Delay Predictions vs Actual</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={delayPredictions}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="actual" stroke="#8884d8" strokeWidth={2} name="Actual" />
              <Line type="monotone" dataKey="predicted" stroke="#82ca9d" strokeWidth={2} name="Predicted" />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div 
          className="chart-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <h3>Route Performance</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={routePerformance}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="route" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="delays" fill="#8884d8" name="Avg Delay (min)" />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      <div className="feature-importance">
        <h3>Feature Importance</h3>
        <div className="feature-list">
          {features.slice(0, 5).map((feature, index) => (
            <div key={index} className="feature-item">
              <span className="feature-name">{feature.name}</span>
              <div className="feature-bar">
                <div 
                  className="feature-fill" 
                  style={{ width: `${feature.importance * 100}%` }}
                ></div>
              </div>
              <span className="feature-value">{(feature.importance * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ml-insights">
        <h3>ML Insights</h3>
        <div className="insights-grid">
          {insights.map((insight, index) => (
            <motion.div 
              key={index}
              className="insight-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 + index * 0.1 }}
            >
              <div className="insight-icon">
                <Brain />
              </div>
              <h4>{insight.title}</h4>
              <p>{insight.description}</p>
              <div className={`insight-impact ${insight.impact?.toLowerCase()}`}>
                {insight.impact}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MLDashboard;