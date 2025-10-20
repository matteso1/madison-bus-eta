import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Bus, MapPin, Brain, Clock, Users, RefreshCw } from 'lucide-react';
import MapView from './MapView';
import MLDashboard from './MLDashboard';
import AboutPage from './AboutPage';
import './App.css';

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";

function App() {
  const [routes, setRoutes] = useState([]);
  const [directions, setDirections] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState('');
  const [selectedDir, setSelectedDir] = useState('');
  const [activeTab, setActiveTab] = useState('map');
  const [stats, setStats] = useState({
    totalRoutes: 0,
    activeBuses: 0,
    predictions: 0,
    accuracy: 87.5
  });
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    setRefreshing(true);
    try {
      const routesResponse = await fetch(`${API_BASE}/routes`);
      const routesData = await routesResponse.json();
      const routes = routesData['bustime-response']?.routes || [];
      
      let activeBuses = 0;
      let totalPredictions = 0;
      
      // Sample first 5 routes to get active bus count without hitting API limits
      const sampleRoutes = routes.slice(0, 5);
      for (const route of sampleRoutes) {
        try {
          const vehiclesResponse = await fetch(`${API_BASE}/vehicles?rt=${route.rt}`);
          const vehiclesData = await vehiclesResponse.json();
          const vehicles = vehiclesData['bustime-response']?.vehicle || [];
          if (Array.isArray(vehicles)) {
            activeBuses += vehicles.length;
          } else if (vehicles) {
            activeBuses += 1;
          }
        } catch (err) {
          console.log(`No vehicles for route ${route.rt}`);
        }
      }
      
      // Scale up the sample to estimate total active buses
      const estimatedActiveBuses = Math.round(activeBuses * (routes.length / sampleRoutes.length));
      
      // Get predictions from a sample stop
      try {
        const predictionsResponse = await fetch(`${API_BASE}/predictions?stpid=1001`);
        const predictionsData = await predictionsResponse.json();
        const predictions = predictionsData['bustime-response']?.prd || [];
        totalPredictions = Array.isArray(predictions) ? predictions.length : (predictions ? 1 : 0);
      } catch (err) {
        console.log('No predictions available');
      }
      
      setRoutes(routes);
      setStats(prev => ({ 
        ...prev, 
        totalRoutes: routes.length,
        activeBuses: estimatedActiveBuses,
        predictions: totalPredictions
      }));
      
    } catch (err) {
      console.error('Error fetching stats:', err);
      setStats(prev => ({ 
        ...prev, 
        totalRoutes: 29,
        activeBuses: 0,
        predictions: 0
      }));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // Load direction options when route changes
  useEffect(() => {
    if (selectedRoute) {
      fetch(`${API_BASE}/directions?rt=${selectedRoute}`)
        .then(res => res.json())
        .then(data => {
          const dirs = data['bustime-response']?.directions || [];
          setDirections(dirs);
          setSelectedDir('');
        });
    }
  }, [selectedRoute]);

  const tabs = [
    { id: 'map', label: 'Live Map', icon: MapPin },
    { id: 'ml', label: 'ML Analytics', icon: Brain },
    { id: 'stats', label: 'Statistics', icon: Clock },
    { id: 'about', label: 'About & Process', icon: Users }
  ];

  return (
    <div className="app">
      {/* Header */}
      <motion.header 
        className="header"
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
      >
        <div className="header-content">
          <div className="logo">
            <Bus className="logo-icon" />
            <h1>Madison Metro ML</h1>
          </div>
          <div className="stats-bar">
            <div className="stat-item">
              <Bus className="stat-icon" />
              <span>{stats.totalRoutes} Routes</span>
            </div>
            <div className="stat-item">
              <Users className="stat-icon" />
              <span>{stats.activeBuses} Active</span>
            </div>
            <div className="stat-item">
              <RefreshCw className="stat-icon" />
              <span>{stats.accuracy}% Accuracy</span>
            </div>
            <button 
              className="refresh-button"
              onClick={fetchStats}
              disabled={refreshing}
            >
              <RefreshCw className={`refresh-icon ${refreshing ? 'spinning' : ''}`} />
              {refreshing ? 'Updating...' : 'Refresh'}
            </button>
          </div>
        </div>
      </motion.header>

      {/* Navigation */}
      <motion.nav 
        className="nav"
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon className="nav-icon" />
              {tab.label}
            </button>
          );
        })}
      </motion.nav>

      {/* Main Content */}
      <main className="main-content">
        {activeTab === 'map' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="map-section"
          >
            <div className="controls">
              <div className="control-group">
                <label>Route:</label>
                <select 
                  value={selectedRoute} 
                  onChange={e => setSelectedRoute(e.target.value)}
                  className="select"
                >
                  <option value="">Select Route</option>
                  {routes.map(route => (
                    <option key={route.rt} value={route.rt}>
                      {route.rt} - {route.rtnm}
                    </option>
                  ))}
                </select>
              </div>
              {directions.length > 0 && (
                <div className="control-group">
                  <label>Direction:</label>
                  <select 
                    value={selectedDir} 
                    onChange={e => setSelectedDir(e.target.value)}
                    className="select"
                  >
                    <option value="">Select Direction</option>
                    {directions.map(dir => (
                      <option key={dir.id} value={dir.id}>{dir.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <MapView 
              selectedRoute={selectedRoute} 
              selectedDir={selectedDir} 
              apiBase={API_BASE} 
            />
          </motion.div>
        )}


        {activeTab === 'ml' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <MLDashboard />
          </motion.div>
        )}

        {activeTab === 'stats' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="stats-section"
          >
            <h2>Project Statistics</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <Clock className="stat-card-icon" />
                <h3>Data Collection</h3>
                <p>1,880+ CSV files collected</p>
                <p>100,000+ prediction records</p>
              </div>
              <div className="stat-card">
                <Brain className="stat-card-icon" />
                <h3>ML Models</h3>
                <p>XGBoost, LightGBM, Neural Networks</p>
                <p>87.5% prediction accuracy</p>
              </div>
              <div className="stat-card">
              <Clock className="stat-card-icon" />
                <h3>Analysis</h3>
                <p>Real-time delay prediction</p>
                <p>Route performance analytics</p>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'about' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="about-section"
          >
            <AboutPage />
          </motion.div>
        )}
      </main>
    </div>
  );
}

export default App;