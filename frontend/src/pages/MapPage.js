import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import MapView from './MapView';
import { ArrowLeft } from 'lucide-react';
import './MapPage.css';

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";

function MapPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [routes, setRoutes] = useState([]);
    const [selectedRoute, setSelectedRoute] = useState(searchParams.get('route') || '');
    const [selectedDir, setSelectedDir] = useState('');
    const [directions, setDirections] = useState([]);

    useEffect(() => {
        fetchRoutes();
    }, []);

    useEffect(() => {
        if (selectedRoute) {
            fetchDirections(selectedRoute);
        }
    }, [selectedRoute]);

    const fetchRoutes = async () => {
        try {
            const response = await fetch(`${API_BASE}/routes`);
            const data = await response.json();
            const routeList = data['bustime-response']?.routes || [];
            setRoutes(routeList);
        } catch (error) {
            console.error('Error fetching routes:', error);
        }
    };

    const fetchDirections = async (rt) => {
        try {
            const response = await fetch(`${API_BASE}/directions?rt=${rt}`);
            const data = await response.json();
            const dirList = data['bustime-response']?.directions || [];
            setDirections(dirList);
            if (dirList.length > 0) {
                setSelectedDir(dirList[0].dir || dirList[0].name || dirList[0].id || '');
            }
        } catch (error) {
            console.error('Error fetching directions:', error);
        }
    };

    const handleRouteChange = (rt) => {
        setSelectedRoute(rt);
        setSelectedDir('');
    };

    return (
        <div className="map-page">
            {/* Top Navigation Bar */}
            <div className="map-nav-bar">
                <button className="back-button" onClick={() => navigate('/')}>
                    <ArrowLeft size={20} />
                    Home
                </button>

                <div className="route-selector">
                    <label htmlFor="route-select">Route:</label>
                    <select
                        id="route-select"
                        value={selectedRoute}
                        onChange={(e) => handleRouteChange(e.target.value)}
                    >
                        <option value="">Select a route</option>
                        {routes.map(route => (
                            <option key={route.rt} value={route.rt}>
                                {route.rt} - {route.rtnm}
                            </option>
                        ))}
                    </select>

                    {directions.length > 0 && (
                        <>
                            <label htmlFor="dir-select">Direction:</label>
                            <select
                                id="dir-select"
                                value={selectedDir}
                                onChange={(e) => setSelectedDir(e.target.value)}
                            >
                                {directions.map((dir, idx) => (
                                    <option key={idx} value={dir.dir || dir.name || dir.id}>
                                        {dir.dir || dir.name || dir.id}
                                    </option>
                                ))}
                            </select>
                        </>
                    )}
                </div>
            </div>

            {/* Full-Screen Map */}
            <div className="map-container-full">
                <MapView
                    selectedRoute={selectedRoute}
                    selectedDir={selectedDir}
                    apiBase={API_BASE}
                />
            </div>
        </div>
    );
}

export default MapPage;
