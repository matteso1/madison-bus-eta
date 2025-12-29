import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bus, MapPin, Clock, TrendingUp } from 'lucide-react';
import './HomePage.css';

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";

function HomePage() {
    const navigate = useNavigate();
    const [routes, setRoutes] = useState([]);
    const [selectedRoute, setSelectedRoute] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchRoutes();
    }, []);

    const fetchRoutes = async () => {
        try {
            const response = await fetch(`${API_BASE}/routes`);
            const data = await response.json();
            const routeList = data['bustime-response']?.routes || [];
            setRoutes(routeList);
        } catch (error) {
            console.error('Error fetching routes:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRouteSelect = (routeNumber) => {
        setSelectedRoute(routeNumber);
        navigate(`/map?route=${routeNumber}`);
    };

    const popularRoutes = ['80', 'A', 'B', 'C', '2', '6', '11', '12'];
    const displayRoutes = routes.filter(r => popularRoutes.includes(r.rt));

    return (
        <div className="home-page">
            {/* Hero Section */}
            <div className="hero-section">
                <div className="hero-content">
                    <Bus className="hero-icon" size={64} strokeWidth={1.5} />
                    <h1 className="hero-title">Where's My Bus?</h1>
                    <p className="hero-subtitle">
                        Real-time arrival predictions for Madison Metro
                    </p>
                </div>
            </div>

            {/* Quick Route Selection */}
            <div className="content-container">
                <div className="section">
                    <h2 className="section-title">Popular Routes</h2>
                    <p className="section-description">
                        Select a route to see live bus locations and predictions
                    </p>

                    {loading ? (
                        <div className="loading-state">Loading routes...</div>
                    ) : (
                        <div className="route-grid">
                            {displayRoutes.map(route => (
                                <button
                                    key={route.rt}
                                    className="route-card"
                                    onClick={() => handleRouteSelect(route.rt)}
                                >
                                    <div className="route-number">{route.rt}</div>
                                    <div className="route-name">{route.rtnm}</div>
                                </button>
                            ))}
                        </div>
                    )}

                    <button
                        className="view-all-button"
                        onClick={() => navigate('/map')}
                    >
                        <MapPin size={20} />
                        View All Routes on Map
                    </button>
                </div>

                {/* Features */}
                <div className="features-section">
                    <div className="feature-card">
                        <Clock className="feature-icon" size={32} />
                        <h3>Real-Time Tracking</h3>
                        <p>See exactly where your bus is right now</p>
                    </div>
                    <div className="feature-card">
                        <TrendingUp className="feature-icon" size={32} />
                        <h3>Smart Predictions</h3>
                        <p>ML-powered arrival times, 21% more accurate</p>
                    </div>
                    <div className="feature-card">
                        <MapPin className="feature-icon" size={32} />
                        <h3>Stop-by-Stop</h3>
                        <p>Track your bus along its entire route</p>
                    </div>
                </div>

                {/* Footer */}
                <div className="home-footer">
                    <p>
                        Interested in the data science behind this app?{' '}
                        <button
                            className="research-link"
                            onClick={() => navigate('/research')}
                        >
                            View Research Dashboard
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
}

export default HomePage;
