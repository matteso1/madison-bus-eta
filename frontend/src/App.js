import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Bus, Map, Activity, Calendar, Zap, FileText } from 'lucide-react';
import HomePage from './pages/HomePage';
import MapPage from './pages/MapPage';
import RoutePlanner from './pages/RoutePlanner';
import TransitPulse from './pages/TransitPulse';
import CommuteCoach from './pages/CommuteCoach';
import ResearchPage from './pages/ResearchPage';
import './App.css';

const Navigation = () => {
    const location = useLocation();
    const isActive = (path) => location.pathname === path;

    return (
        <nav className="sidebar">
            <div className="logo-container">
                <Bus size={32} className="logo-icon" />
                <span className="logo-text">Metro Minds</span>
            </div>

            <div className="nav-links">
                <NavLink to="/" icon={<Bus size={20} />} label="Overview" active={isActive('/')} />
                <NavLink to="/map" icon={<Map size={20} />} label="Live Map" active={isActive('/map')} />
                <NavLink to="/planner" icon={<Calendar size={20} />} label="Route Planner" active={isActive('/planner')} />
                <NavLink to="/pulse" icon={<Activity size={20} />} label="Transit Pulse" active={isActive('/pulse')} />
                <NavLink to="/coach" icon={<Zap size={20} />} label="Commute Coach" active={isActive('/coach')} />
                <NavLink to="/research" icon={<FileText size={20} />} label="Research" active={isActive('/research')} />
            </div>

            <div className="nav-footer">
                <p>© 2025 Madison Metro AI</p>
            </div>
        </nav>
    );
};

const NavLink = ({ to, icon, label, active }) => (
    <Link to={to} className={`nav-link ${active ? 'active' : ''}`}>
        {icon}
        <span className="link-label">{label}</span>
    </Link>
);

function App() {
    return (
        <Router>
            <div className="app-layout">
                <Navigation />
                <main className="main-content">
                    <Routes>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/map" element={<MapPage />} />
                        <Route path="/planner" element={<RoutePlanner />} />
                        <Route path="/pulse" element={<TransitPulse />} />
                        <Route path="/coach" element={<CommuteCoach />} />
                        <Route path="/research" element={<ResearchPage />} />
                    </Routes>
                </main>
            </div>
        </Router>
    );
}

export default App;
