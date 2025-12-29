import React, { useState, useEffect, useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ScatterChart, Scatter, ZAxis, Cell, AreaChart, Area, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { AlertCircle, TrendingUp, TrendingDown, Clock, MapPin, Calendar, Activity } from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './DataExplorer.css';

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";

function DataExplorer() {
    const [data, setData] = useState({
        routeStats: [],
        features: [],
        heatmap: [],
        geoHeatmap: [],
        dayOfWeek: [],
        systemOverview: null,
        errorDistribution: null,
        calibration: [],
        rankings: null,
        anomalies: [],
        correlation: null,
        statisticalTests: [],
        timeSeries: null,
        insights: [],
        ridershipSummary: null,
        ridershipHeatmap: [],
        ridershipPerformance: [],
        serviceGaps: [],
        headwaySummary: null
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchAllData = async () => {
            try {
                const [routeStats, features, heatmap, geoHeatmap, dayOfWeek, systemOverview, errorDistribution, calibration, rankings, anomalies, correlation, statisticalTests, timeSeries, insights, ridershipSummary, ridershipHeatmap, ridershipPerformance, serviceGaps, headwaySummary] = await Promise.all([
                    fetch(`${API_BASE}/viz/route-stats`).then(r => r.json()),
                    fetch(`${API_BASE}/ml/features`).then(r => r.json()),
                    fetch(`${API_BASE}/viz/heatmap`).then(r => r.json()),
                    fetch(`${API_BASE}/viz/geo-heatmap`).then(r => r.json()),
                    fetch(`${API_BASE}/viz/day-of-week`).then(r => r.json()),
                    fetch(`${API_BASE}/viz/system-overview`).then(r => r.json()),
                    fetch(`${API_BASE}/viz/error-distribution`).then(r => r.json()),
                    fetch(`${API_BASE}/viz/calibration`).then(r => r.json()),
                    fetch(`${API_BASE}/viz/reliability-rankings`).then(r => r.json()),
                    fetch(`${API_BASE}/viz/anomalies`).then(r => r.json()),
                    fetch(`${API_BASE}/viz/correlation`).then(r => r.json()).catch(() => null),
                    fetch(`${API_BASE}/viz/statistical-tests`).then(r => r.json()).catch(() => []),
                    fetch(`${API_BASE}/viz/time-series`).then(r => r.json()).catch(() => null),
                    fetch(`${API_BASE}/viz/insights`).then(r => r.json()).catch(() => []),
                    fetch(`${API_BASE}/viz/ridership/summary`).then(r => r.json()).catch(() => null),
                    fetch(`${API_BASE}/viz/ridership/heatmap?top_n=100`).then(r => r.json()).catch(() => []),
                    fetch(`${API_BASE}/viz/ridership/route-performance`).then(r => r.json()).catch(() => []),
                    fetch(`${API_BASE}/viz/headway/service-gaps?min_headway=20`).then(r => r.json()).catch(() => ({service_gaps: []})),
                    fetch(`${API_BASE}/viz/headway/route-summary`).then(r => r.json()).catch(() => null)
                ]);
                setData({
                    routeStats,
                    features: features.features || [],
                    heatmap,
                    geoHeatmap,
                    dayOfWeek,
                    systemOverview,
                    errorDistribution,
                    calibration,
                    rankings,
                    anomalies,
                    correlation,
                    statisticalTests,
                    timeSeries,
                    insights,
                    ridershipSummary,
                    ridershipHeatmap: ridershipHeatmap || [],
                    ridershipPerformance: ridershipPerformance || [],
                    serviceGaps: serviceGaps.service_gaps || [],
                    headwaySummary
                });
            } catch (err) {
                console.error('Error fetching data:', err);
                setError('Failed to load analytical data. Please ensure the backend server is running.');
            } finally {
                setLoading(false);
            }
        };
        fetchAllData();
    }, []);

    if (loading) {
        return <div className="loading-container">Analyzing 204,380 transit records...</div>;
    }

    if (error) {
        return <div className="error-container"><AlertCircle /> {error}</div>;
    }

    return (
        <div className="data-explorer">
            {/* System Overview */}
            {data.systemOverview && (
                <section className="dashboard-section">
                    <h2 className="section-title">System Overview</h2>
                    <div className="stats-grid">
                        <div className="stat-card">
                            <div className="stat-icon"><MapPin /></div>
                            <div className="stat-content">
                                <div className="stat-label">Total Routes</div>
                                <div className="stat-value">{data.systemOverview.total_routes}</div>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon"><Activity /></div>
                            <div className="stat-content">
                                <div className="stat-label">Total Predictions</div>
                                <div className="stat-value">{data.systemOverview.total_predictions?.toLocaleString()}</div>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon"><Clock /></div>
                            <div className="stat-content">
                                <div className="stat-label">Avg Wait Time</div>
                                <div className="stat-value">{data.systemOverview.avg_wait_time?.toFixed(1)} min</div>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon"><TrendingUp /></div>
                            <div className="stat-content">
                                <div className="stat-label">System Reliability</div>
                                <div className="stat-value">{(data.systemOverview.system_reliability * 100)?.toFixed(1)}%</div>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {/* Anomaly Alerts - Priority Issues */}
            {data.anomalies && data.anomalies.length > 0 && (
                <section className="dashboard-section">
                    <h2 className="section-title">Anomaly Alerts - Service Issues Requiring Attention</h2>
                    <div className="chart-card full-width">
                        <h3>Detected Timing Anomalies & Service Irregularities</h3>
                        <p className="chart-subtitle">These route-hour combinations show unusually high prediction errors or inconsistent service quality. Investigating these could improve system reliability.</p>
                        <AnomalyTable anomalies={data.anomalies} />
                    </div>
                </section>
            )}

            {/* Performance Leaderboards - Only show actionable ones */}
            {data.rankings && (
                <section className="dashboard-section">
                    <h2 className="section-title">Route Reliability Rankings</h2>
                    <div className="grid-col-2">
                        <div className="chart-card">
                            <h3>Most Reliable Routes</h3>
                            <p className="chart-subtitle">Use these routes when you need to be on time</p>
                            <ReliabilityLeaderboard data={data.rankings.routes.most_reliable} type="good" />
                        </div>
                        <div className="chart-card">
                            <h3>Routes Needing Improvement</h3>
                            <p className="chart-subtitle">These routes have higher prediction errors - plan extra time</p>
                            <ReliabilityLeaderboard data={data.rankings.routes.least_reliable} type="bad" />
                        </div>
                    </div>
                </section>
            )}

            {/* Geospatial Analysis */}
            <section className="dashboard-section">
                <h2 className="section-title">Geospatial Delay Analysis</h2>
                <div className="chart-card full-width">
                    <h3>Where Are Delays Happening?</h3>
                    <p className="chart-subtitle">This map shows delay hotspots across Madison's transit network. Larger, redder circles indicate locations with higher prediction errors.</p>
                    <GeospatialHeatmap data={data.geoHeatmap} />
                </div>
            </section>

            {/* Temporal Patterns - Actionable insights only */}
            <section className="dashboard-section">
                <h2 className="section-title">When Are Delays Worst?</h2>
                <div className="grid-col-2">
                    <div className="chart-card">
                        <h3>Delays by Day of Week</h3>
                        <p className="chart-subtitle">Plan extra time on these days</p>
                        <DayOfWeekChart data={data.dayOfWeek} />
                    </div>
                    <div className="chart-card">
                        <h3>Delays by Hour</h3>
                        <p className="chart-subtitle">Rush hours (7-9am, 4-6pm) have more delays</p>
                        <HourlyTrendsChart data={data.heatmap} />
                    </div>
                </div>
            </section>


            {/* Key Insights */}
            {data.insights && data.insights.length > 0 && (
                <section className="dashboard-section">
                    <h2 className="section-title">Key Insights & Recommendations</h2>
                    <div className="insights-grid">
                        {data.insights.map((insight, idx) => (
                            <div key={idx} className={`insight-card ${insight.severity}`}>
                                <div className="insight-header">
                                    <span className="insight-category">{insight.category}</span>
                                    <span className={`insight-severity ${insight.severity}`}>
                                        {insight.severity.toUpperCase()}
                                    </span>
                                </div>
                                <h3 className="insight-title">{insight.title}</h3>
                                <p className="insight-description">{insight.description}</p>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Statistical Analysis - Only if it's actually useful */}
            {data.statisticalTests && data.statisticalTests.length > 0 && (
                <section className="dashboard-section">
                    <h2 className="section-title">Statistical Validation</h2>
                    <div className="chart-card">
                        <h3>What Patterns Are Actually Significant?</h3>
                        <p className="chart-subtitle">Hypothesis tests showing which observed patterns are statistically real (not just noise)</p>
                        <StatisticalTestsTable tests={data.statisticalTests} />
                    </div>
                </section>
            )}

            {/* Ridership Analysis */}
            {data.ridershipSummary && (
                <section className="dashboard-section">
                    <h2 className="section-title">Ridership Analysis (Open Data)</h2>
                    <div className="grid-col-2">
                        {data.ridershipSummary.routes && (
                            <div className="chart-card">
                                <h3>Top Routes by Ridership</h3>
                                <p className="chart-subtitle">Total weekday ridership from Metro open data</p>
                                <RidershipRouteChart data={data.ridershipSummary.routes} />
                            </div>
                        )}
                        {data.ridershipPerformance && data.ridershipPerformance.length > 0 && (
                            <div className="chart-card">
                                <h3>Route Performance Metrics</h3>
                                <p className="chart-subtitle">Ridership per stop, variance, and coverage</p>
                                <RidershipPerformanceTable data={data.ridershipPerformance} />
                            </div>
                        )}
                    </div>
                    {data.ridershipHeatmap && data.ridershipHeatmap.length > 0 && (
                        <div className="chart-card full-width">
                            <h3>Ridership Heatmap</h3>
                            <p className="chart-subtitle">Top stops by weekday ridership - geospatial visualization</p>
                            <RidershipHeatmap data={data.ridershipHeatmap} />
                        </div>
                    )}
                </section>
            )}

            {/* Headway & Service Gaps */}
            {data.serviceGaps && data.serviceGaps.length > 0 && (
                <section className="dashboard-section">
                    <h2 className="section-title">Service Gaps Analysis</h2>
                    <div className="chart-card full-width">
                        <h3>Stops with Service Gaps (Headway &gt; 20 min during peak)</h3>
                        <p className="chart-subtitle">Identifies stops where buses are too far apart during rush hours (7-9am, 4-6pm)</p>
                        <ServiceGapsTable gaps={data.serviceGaps} />
                    </div>
                </section>
            )}

            {data.headwaySummary && (
                <section className="dashboard-section">
                    <h2 className="section-title">Headway Analysis</h2>
                    <div className="chart-card full-width">
                        <h3>Average Time Between Buses by Route</h3>
                        <p className="chart-subtitle">Headway statistics - lower is better (more frequent service)</p>
                        <HeadwaySummaryChart data={data.headwaySummary} />
                    </div>
                </section>
            )}

            {/* ML Model Info - Keep it simple */}
            {data.features && data.features.length > 0 && (
                <section className="dashboard-section">
                    <h2 className="section-title">ML Model Insights</h2>
                    <div className="chart-card">
                        <h3>What the Model Actually Uses</h3>
                        <p className="chart-subtitle">Feature importance - what actually matters for predictions</p>
                        <FeatureImportanceChart features={data.features} />
                    </div>
                </section>
            )}

            {/* Disclaimer */}
            <section className="dashboard-section">
                <div className="disclaimer-box">
                    <AlertCircle size={24} />
                    <div>
                        <h3>⚠️ College Student Disclaimer</h3>
                        <p>
                            This was built by a student who's probably procrastinating on actual homework. 
                            The ML model is trained on limited data and might be hilariously wrong. 
                            Don't trust machines blindly—always check the actual bus schedule! 
                            If you miss your bus because of this, blame the algorithm, not me. 🚌💀
                        </p>
                        <p className="disclaimer-note">
                            <strong>Seriously though:</strong> This is a data science project, not an official transit app. 
                            Use at your own risk. The model achieves ~21% better accuracy than the API, but that doesn't 
                            mean it's perfect. Buses are unpredictable. Life is unpredictable. Trust but verify.
                        </p>
                    </div>
                </div>
            </section>
        </div>
    );
}


// ===== VISUALIZATION COMPONENTS =====

const AnomalyTable = ({ anomalies }) => {
    if (!anomalies || anomalies.length === 0) {
        return <div className="no-data">No anomalies detected - system operating normally</div>;
    }

    const getSeverityColor = (severity) => {
        switch(severity) {
            case 'high': return '#dc2626';
            case 'medium': return '#f97316';
            default: return '#64748b';
        }
    };

    return (
        <div className="anomaly-table-container">
            <table className="data-table">
                <thead>
                    <tr>
                        <th>Severity</th>
                        <th>Type</th>
                        <th>Route</th>
                        <th>Details</th>
                        <th>Impact</th>
                    </tr>
                </thead>
                <tbody>
                    {anomalies.slice(0, 10).map((anomaly, idx) => (
                        <tr key={idx}>
                            <td>
                                <span
                                    className="severity-badge"
                                    style={{ backgroundColor: getSeverityColor(anomaly.severity) }}
                                >
                                    {anomaly.severity?.toUpperCase()}
                                </span>
                            </td>
                            <td>{anomaly.type === 'high_error_period' ? 'High Error Period' : 'High Variance'}</td>
                            <td><strong>Route {anomaly.route}</strong></td>
                            <td>
                                {anomaly.hour !== undefined ? (
                                    `${anomaly.hour}:00 - ${anomaly.hour + 1}:00`
                                ) : (
                                    anomaly.description || 'Inconsistent service'
                                )}
                            </td>
                            <td>
                                {anomaly.mean_error ?
                                    `${anomaly.mean_error.toFixed(2)} min avg error` :
                                    `${anomaly.std_error?.toFixed(2)} min std dev`
                                }
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const ReliabilityLeaderboard = ({ data, type }) => {
    if (!data || data.length === 0) {
        return <div className="no-data">No data available</div>;
    }

    const isGood = type === 'good';

    return (
        <div className="leaderboard-container">
            <ol className="leaderboard-list">
                {data.map((item, idx) => (
                    <li key={idx} className="leaderboard-item">
                        <div className="leaderboard-rank">{idx + 1}</div>
                        <div className="leaderboard-content">
                            <div className="leaderboard-title">Route {item.route}</div>
                            <div className="leaderboard-metrics">
                                <span>MAE: {item.mae?.toFixed(3)} min</span>
                                <span className="metric-divider">•</span>
                                <span>Reliability: {(item.reliability_score * 100)?.toFixed(1)}%</span>
                            </div>
                            <div className="leaderboard-sample">
                                {item.count?.toLocaleString()} predictions
                            </div>
                        </div>
                        <div className={`leaderboard-badge ${isGood ? 'good' : 'bad'}`}>
                            {isGood ? (
                                <TrendingUp size={20} />
                            ) : (
                                <TrendingDown size={20} />
                            )}
                        </div>
                    </li>
                ))}
            </ol>
        </div>
    );
};

const StopLeaderboard = ({ data, type }) => {
    if (!data || data.length === 0) {
        return <div className="no-data">No data available</div>;
    }

    const isGood = type === 'good';

    return (
        <div className="leaderboard-container">
            <ol className="leaderboard-list">
                {data.map((item, idx) => (
                    <li key={idx} className="leaderboard-item">
                        <div className="leaderboard-rank">{idx + 1}</div>
                        <div className="leaderboard-content">
                            <div className="leaderboard-title">{item.stop_name || `Stop ${item.stop_id}`}</div>
                            <div className="leaderboard-metrics">
                                <span>MAE: {item.mae?.toFixed(3)} min</span>
                            </div>
                            <div className="leaderboard-sample">
                                {item.count?.toLocaleString()} predictions
                            </div>
                        </div>
                        <div className={`leaderboard-badge ${isGood ? 'good' : 'bad'}`}>
                            {isGood ? (
                                <TrendingUp size={20} />
                            ) : (
                                <TrendingDown size={20} />
                            )}
                        </div>
                    </li>
                ))}
            </ol>
        </div>
    );
};

const GeospatialHeatmap = ({ data }) => {
    if (!data || data.length === 0) return <div className="no-data">No geospatial data available</div>;

    const center = [43.0731, -89.4012]; // Madison, WI
    const maxError = Math.max(...data.map(d => d.avg_error || 0));
    
    const getColor = (error) => {
        const intensity = Math.min(error / maxError, 1);
        return `rgba(239, 68, 68, ${0.3 + intensity * 0.7})`; // Red gradient
    };

    return (
        <div style={{ height: '500px', width: '100%', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                />
                {data.map((point, idx) => (
                    <CircleMarker
                        key={idx}
                        center={[point.lat, point.lon]}
                        radius={8 + (point.avg_error / maxError) * 12}
                        fillColor={getColor(point.avg_error)}
                        color="#0f172a"
                        weight={1}
                        fillOpacity={0.7}
                    >
                        <Popup>
                            <strong>Delay Hotspot</strong><br />
                            Avg Error: {point.avg_error?.toFixed(2)} min<br />
                            Location: {point.lat.toFixed(4)}, {point.lon.toFixed(4)}
                        </Popup>
                    </CircleMarker>
                ))}
            </MapContainer>
        </div>
    );
};

const DayOfWeekChart = ({ data }) => {
    // Backend sends correct day_name from pandas (Monday=0), so use it directly
    const chartData = data;

    return (
        <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData} margin={{ top: 20, right: 20, bottom: 60, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day_name" angle={-45} textAnchor="end" height={80} />
                <YAxis label={{ value: 'Avg Error (min)', angle: -90, position: 'insideLeft' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="avg_error" fill="#0f172a" />
            </BarChart>
        </ResponsiveContainer>
    );
};

const HourlyTrendsChart = ({ data }) => {
    const hourlyAgg = useMemo(() => {
        const grouped = {};
        data.forEach(d => {
            if (!grouped[d.hour]) grouped[d.hour] = { hour: d.hour, total_error: 0, count: 0 };
            // Use 'error' field from heatmap data, not 'avg_error'
            grouped[d.hour].total_error += (d.error || d.avg_error || 0);
            grouped[d.hour].count += 1;
        });
        return Object.values(grouped).map(g => ({
            hour: g.hour,
            avg_error: g.total_error / g.count
        })).sort((a, b) => a.hour - b.hour);
    }, [data]);

    return (
        <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={hourlyAgg} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <defs>
                    <linearGradient id="errorGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0f172a" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#0f172a" stopOpacity={0.1}/>
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="hour" label={{ value: 'Hour of Day', position: 'insideBottom', offset: -10 }} />
                <YAxis label={{ value: 'Avg Error (min)', angle: -90, position: 'insideLeft' }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="avg_error" stroke="#0f172a" fillOpacity={1} fill="url(#errorGradient)" />
            </AreaChart>
        </ResponsiveContainer>
    );
};

const CustomHeatmap = ({ data }) => {
    const { routes, hours, heatmapData, maxError } = useMemo(() => {
        const routes = [...new Set(data.map(d => d.route))].sort();
        const hours = [...new Set(data.map(d => d.hour))].sort((a, b) => a - b);

        const errorLookup = {};
        data.forEach(d => {
            if (!errorLookup[d.route]) errorLookup[d.route] = {};
            // Backend sends 'error' field, not 'avg_error'
            errorLookup[d.route][d.hour] = d.error || d.avg_error || 0;
        });

        const heatmapData = [];
        routes.forEach(route => {
            hours.forEach(hour => {
                heatmapData.push({
                    route,
                    hour,
                    error: errorLookup[route]?.[hour] || 0
                });
            });
        });
        
        const maxError = Math.max(...heatmapData.map(d => d.error));
        return { routes, hours, heatmapData, maxError };
    }, [data]);

    return (
        <ResponsiveContainer width="100%" height={500}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 40, left: 40 }}>
                <CartesianGrid stroke="#e2e8f0" />
                <XAxis 
                    type="number" 
                    dataKey="hour" 
                    name="Hour" 
                    domain={['dataMin - 1', 'dataMax + 1']}
                    label={{ value: 'Hour of Day', position: 'insideBottom', offset: -20 }}
                    ticks={hours.filter(h => h % 2 === 0)}
                    interval={0}
                />
                <YAxis 
                    type="category" 
                    dataKey="route" 
                    name="Route" 
                    label={{ value: 'Route', angle: -90, position: 'insideLeft' }}
                    width={80}
                />
                <ZAxis dataKey="size" range={[400, 400]} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<CustomTooltip />} />
                <Scatter name="Error" data={heatmapData} shape="square">
                    {heatmapData.map((entry, index) => {
                        const opacity = entry.error > 0 ? 0.15 + (entry.error / maxError) * 0.85 : 0;
                        return <Cell key={`cell-${index}`} fill={'#0f172a'} style={{ opacity }} />;
                    })}
                </Scatter>
            </ScatterChart>
        </ResponsiveContainer>
    );
};

const RouteReliabilityScatterPlot = ({ data }) => {
    const chartData = data.map(d => ({ ...d, size: d.total_predictions }));

    return (
        <ResponsiveContainer width="100%" height={400}>
            <ScatterChart margin={{ top: 20, right: 30, bottom: 60, left: 60 }}>
                <CartesianGrid stroke="#e2e8f0" />
                <XAxis 
                    type="number" 
                    dataKey="total_predictions" 
                    name="Volume" 
                    label={{ value: 'Total Predictions (Volume)', position: 'insideBottom', offset: -10 }}
                    tickFormatter={(value) => new Intl.NumberFormat('en', { notation: 'compact' }).format(value)}
                />
                <YAxis 
                    type="number" 
                    dataKey="reliability_score" 
                    name="Reliability" 
                    domain={[0.6, 1.0]}
                    label={{ value: 'Reliability Score', angle: -90, position: 'insideLeft' }}
                />
                <ZAxis type="number" dataKey="size" range={[50, 800]} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<CustomTooltip />} />
                <Scatter name="Routes" data={chartData} fill="#0f172a" opacity={0.7}/>
            </ScatterChart>
        </ResponsiveContainer>
    );
};

const RouteVolumeChart = ({ data }) => {
    const top10 = useMemo(() => 
        [...data].sort((a, b) => b.total_predictions - a.total_predictions).slice(0, 10),
    [data]);

    return (
        <ResponsiveContainer width="100%" height={400}>
            <BarChart data={top10} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="route" label={{ value: 'Route', position: 'insideBottom', offset: -10 }} />
                <YAxis tickFormatter={(value) => new Intl.NumberFormat('en', { notation: 'compact' }).format(value)} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="total_predictions" fill="#0f172a" />
            </BarChart>
        </ResponsiveContainer>
    );
};

const FeatureImportanceChart = ({ features }) => {
    const sortedFeatures = useMemo(() => 
        [...features].sort((a, b) => b.importance - a.importance).slice(0, 10),
    [features]);

    return (
        <ResponsiveContainer width="100%" height={400}>
            <BarChart data={sortedFeatures} layout="vertical" margin={{ top: 5, right: 30, left: 140, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={140} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="importance" fill="#0f172a" />
            </BarChart>
        </ResponsiveContainer>
    );
};

// ===== RIDERSHIP & HEADWAY VISUALIZATIONS =====

const RidershipRouteChart = ({ data }) => {
    if (!data || Object.keys(data).length === 0) {
        return <div className="no-data">No ridership data available</div>;
    }
    
    const chartData = Object.entries(data)
        .map(([route, info]) => ({
            route,
            ridership: info.total_ridership,
            avg_per_stop: info.avg_per_stop,
            stops_served: info.stops_served
        }))
        .sort((a, b) => b.ridership - a.ridership)
        .slice(0, 15);
    
    return (
        <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData} margin={{ top: 20, right: 20, bottom: 60, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="route" angle={-45} textAnchor="end" height={80} />
                <YAxis label={{ value: 'Weekday Ridership', angle: -90, position: 'insideLeft' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="ridership" fill="#3b82f6">
                    {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.route.match(/^[A-F]$/) ? '#8b5cf6' : '#3b82f6'} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
};

const RidershipPerformanceTable = ({ data }) => {
    if (!data || data.length === 0) {
        return <div className="no-data">No performance data available</div>;
    }
    
    return (
        <div className="table-container">
            <table className="data-table">
                <thead>
                    <tr>
                        <th>Route</th>
                        <th>Total Ridership</th>
                        <th>Avg/Stop</th>
                        <th>Stops Served</th>
                        <th>Max Stop</th>
                    </tr>
                </thead>
                <tbody>
                    {data.slice(0, 15).map((route, idx) => (
                        <tr key={idx}>
                            <td><strong>{route.route}</strong></td>
                            <td>{route.total_ridership.toLocaleString()}</td>
                            <td>{route.avg_per_stop.toFixed(1)}</td>
                            <td>{route.stops_served}</td>
                            <td>{route.max_stop_ridership.toFixed(1)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const RidershipHeatmap = ({ data }) => {
    if (!data || data.length === 0) return <div className="no-data">No ridership heatmap data available</div>;
    
    const center = [43.0731, -89.4012];
    const maxRidership = Math.max(...data.map(d => d.ridership || 0));
    
    const getColor = (ridership) => {
        const intensity = Math.min(ridership / maxRidership, 1);
        return `rgba(59, 130, 246, ${0.3 + intensity * 0.7})`;
    };
    
    const getRadius = (ridership) => {
        return 5 + (ridership / maxRidership) * 20;
    };
    
    return (
        <div style={{ height: '500px', width: '100%', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                />
                {data.map((stop, idx) => (
                    <CircleMarker
                        key={idx}
                        center={[stop.lat, stop.lon]}
                        radius={getRadius(stop.ridership)}
                        fillColor={getColor(stop.ridership)}
                        color="#1e40af"
                        weight={1}
                        fillOpacity={0.7}
                    >
                        <Popup>
                            <strong>{stop.stop_name}</strong><br />
                            Weekday Ridership: {stop.ridership.toLocaleString()}<br />
                            Stop ID: {stop.stop_id}
                        </Popup>
                    </CircleMarker>
                ))}
            </MapContainer>
        </div>
    );
};

const ServiceGapsTable = ({ gaps }) => {
    if (!gaps || gaps.length === 0) {
        return <div className="no-data">No service gaps detected - good service frequency!</div>;
    }
    
    return (
        <div className="table-container">
            <table className="data-table">
                <thead>
                    <tr>
                        <th>Route</th>
                        <th>Stop Name</th>
                        <th>Max Headway (peak)</th>
                        <th>Avg Headway (peak)</th>
                        <th>Gap Count</th>
                    </tr>
                </thead>
                <tbody>
                    {gaps.slice(0, 20).map((gap, idx) => (
                        <tr key={idx}>
                            <td><strong>{gap.route}</strong></td>
                            <td>{gap.stop_name || gap.stop_id}</td>
                            <td>{gap.max_headway_peak?.toFixed(1)} min</td>
                            <td>{gap.avg_headway_peak?.toFixed(1)} min</td>
                            <td>{gap.service_gaps}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const HeadwaySummaryChart = ({ data }) => {
    if (!data || Object.keys(data).length === 0) {
        return <div className="no-data">No headway data available</div>;
    }
    
    const chartData = Object.entries(data)
        .map(([route, stats]) => ({
            route,
            avg: stats.avg_headway,
            median: stats.median_headway,
            min: stats.min_headway,
            max: stats.max_headway
        }))
        .sort((a, b) => a.avg - b.avg)
        .slice(0, 20);
    
    return (
        <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData} margin={{ top: 20, right: 20, bottom: 60, left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="route" angle={-45} textAnchor="end" height={80} />
                <YAxis label={{ value: 'Headway (minutes)', angle: -90, position: 'insideLeft' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="avg" fill="#3b82f6" name="Average" />
                <Bar dataKey="median" fill="#8b5cf6" name="Median" />
            </BarChart>
        </ResponsiveContainer>
    );
};

const RouteRadarChart = ({ data }) => {
    const top6Routes = useMemo(() =>
        [...data].sort((a, b) => b.total_predictions - a.total_predictions).slice(0, 6).map(d => ({
            route: d.route,
            reliability: d.reliability_score
        })),
    [data]);

    return (
        <ResponsiveContainer width="100%" height={400}>
            <RadarChart data={top6Routes}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="route" />
                <PolarRadiusAxis domain={[0.6, 1.0]} />
                <Tooltip content={<CustomTooltip />} />
                <Radar name="Reliability" dataKey="reliability" stroke="#0f172a" fill="#0f172a" fillOpacity={0.6} />
            </RadarChart>
        </ResponsiveContainer>
    );
};

const ErrorDistributionChart = ({ data }) => {
    if (!data || !data.hist || data.hist.length === 0) {
        return <div className="no-data">No error distribution data available</div>;
    }

    const chartData = data.hist.map(bucket => ({
        range: `${bucket.start.toFixed(0)}-${bucket.end.toFixed(0)}`,
        count: bucket.count,
        start: bucket.start
    }));

    return (
        <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="range" label={{ value: 'Error Range (minutes)', position: 'insideBottom', offset: -10 }} />
                <YAxis label={{ value: 'Frequency', angle: -90, position: 'insideLeft' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill="#0f172a" />
            </BarChart>
        </ResponsiveContainer>
    );
};

const CalibrationChart = ({ data }) => {
    if (!data || data.length === 0) {
        return <div className="no-data">No calibration data available</div>;
    }

    const chartData = data.map(bucket => ({
        range: `${bucket.start}-${bucket.end}`,
        mae: bucket.mae,
        count: bucket.count,
        midpoint: (bucket.start + bucket.end) / 2
    }));

    return (
        <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                    dataKey="range"
                    label={{ value: 'Prediction Horizon (minutes)', position: 'insideBottom', offset: -10 }}
                />
                <YAxis label={{ value: 'Mean Absolute Error (min)', angle: -90, position: 'insideLeft' }} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="mae" stroke="#0f172a" strokeWidth={2} dot={{ r: 5 }} />
            </LineChart>
        </ResponsiveContainer>
    );
};

const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;

        // Error distribution histogram tooltip
        if (data.range && data.count !== undefined && data.start !== undefined) {
            return (
                <div className="custom-tooltip">
                    <p><strong>Error Range: {data.range} min</strong></p>
                    <p>Frequency: {data.count?.toLocaleString()}</p>
                </div>
            );
        }

        // Calibration curve tooltip
        if (data.mae !== undefined && data.range) {
            return (
                <div className="custom-tooltip">
                    <p><strong>Horizon: {data.range} min</strong></p>
                    <p>Mean Absolute Error: {data.mae?.toFixed(2)} min</p>
                    <p>Sample Size: {data.count?.toLocaleString()}</p>
                </div>
            );
        }

        // Heatmap tooltip
        if (data.error !== undefined) {
            return (
                <div className="custom-tooltip">
                    <p><strong>Route {data.route} at {data.hour}:00</strong></p>
                    <p>Avg. Error: {data.error?.toFixed(2)} min</p>
                </div>
            );
        }
        
        // Reliability scatter tooltip
        if (data.reliability_score !== undefined) {
            return (
                <div className="custom-tooltip">
                    <p><strong>Route: {data.route}</strong></p>
                    <p>Reliability: {(data.reliability_score * 100)?.toFixed(1)}%</p>
                    <p>Volume: {data.total_predictions?.toLocaleString()}</p>
                </div>
            );
        }
        
        // Feature importance tooltip
        if (data.importance !== undefined) {
            return (
                <div className="custom-tooltip">
                    <p><strong>{data.name}</strong></p>
                    <p>Importance: {data.importance?.toFixed(3)}</p>
                </div>
            );
        }
        
        // Day of week tooltip
        if (data.day_name) {
            return (
                <div className="custom-tooltip">
                    <p><strong>{data.day_name}</strong></p>
                    <p>Avg. Error: {data.avg_error?.toFixed(2)} min</p>
                    <p>Predictions: {data.prediction_count?.toLocaleString()}</p>
                </div>
            );
        }
        
        // Hourly trends tooltip
        if (data.hour !== undefined && data.avg_error !== undefined) {
            return (
                <div className="custom-tooltip">
                    <p><strong>Hour: {data.hour}:00</strong></p>
                    <p>Avg. Error: {data.avg_error?.toFixed(2)} min</p>
                </div>
            );
        }
        
        // Radar tooltip
        if (data.reliability !== undefined) {
            return (
                <div className="custom-tooltip">
                    <p><strong>Route: {data.route}</strong></p>
                    <p>Reliability: {(data.reliability * 100)?.toFixed(1)}%</p>
                </div>
            );
        }
    }
    return null;
};

const CorrelationMatrix = ({ data }) => {
    if (!data || !data.correlations || data.correlations.length === 0) {
        return <div className="no-data">No correlation data available</div>;
    }

    const topCorrelations = data.correlations.slice(0, 10);

    return (
        <div className="correlation-container">
            <div className="correlation-list">
                {topCorrelations.map((corr, idx) => {
                    const absCorr = Math.abs(corr.correlation);
                    const color = corr.correlation > 0 ? '#0f172a' : '#ef4444';
                    return (
                        <div key={idx} className="correlation-item">
                            <div className="correlation-features">
                                <span className="correlation-feature">{corr.feature1}</span>
                                <span className="correlation-arrow">↔</span>
                                <span className="correlation-feature">{corr.feature2}</span>
                            </div>
                            <div className="correlation-bar-container">
                                <div 
                                    className="correlation-bar"
                                    style={{
                                        width: `${absCorr * 100}%`,
                                        backgroundColor: color
                                    }}
                                />
                                <span className="correlation-value">
                                    {corr.correlation.toFixed(3)}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
            {data.insights && data.insights.length > 0 && (
                <div className="correlation-insights">
                    <h4>Key Relationships:</h4>
                    <ul>
                        {data.insights.map((insight, idx) => (
                            <li key={idx}>
                                <strong>{insight.feature1} ↔ {insight.feature2}</strong>: 
                                {insight.strength} {insight.direction} correlation ({insight.value.toFixed(3)})
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

const StatisticalTestsTable = ({ tests }) => {
    if (!tests || tests.length === 0) {
        return <div className="no-data">No statistical tests available</div>;
    }

    return (
        <div className="statistical-tests-container">
            <table className="data-table">
                <thead>
                    <tr>
                        <th>Test</th>
                        <th>P-Value</th>
                        <th>Significant</th>
                        <th>Interpretation</th>
                    </tr>
                </thead>
                <tbody>
                    {tests.map((test, idx) => (
                        <tr key={idx}>
                            <td><strong>{test.test}</strong></td>
                            <td>{test.p_value.toFixed(4)}</td>
                            <td>
                                <span className={test.significant ? 'significant-yes' : 'significant-no'}>
                                    {test.significant ? '✓ Yes' : '✗ No'}
                                </span>
                            </td>
                            <td className="test-interpretation">{test.interpretation}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const TimeSeriesChart = ({ data }) => {
    if (!data || (!data.trend || data.trend.length === 0)) {
        return <div className="no-data">No time series data available</div>;
    }

    // Combine all components for display
    const chartData = [];
    const dates = new Set();
    
    [...(data.trend || []), ...(data.seasonal || []), ...(data.residual || [])].forEach(item => {
        dates.add(item.date);
    });

    Array.from(dates).sort().forEach(date => {
        const trendItem = data.trend?.find(d => d.date === date);
        const seasonalItem = data.seasonal?.find(d => d.date === date);
        const residualItem = data.residual?.find(d => d.date === date);
        
        chartData.push({
            date,
            trend: trendItem?.trend || 0,
            seasonal: seasonalItem?.seasonal || 0,
            residual: residualItem?.residual || 0
        });
    });

    return (
        <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis 
                    dataKey="date" 
                    angle={-45} 
                    textAnchor="end" 
                    height={80}
                    tick={{ fontSize: 10 }}
                />
                <YAxis label={{ value: 'Error Component', angle: -90, position: 'insideLeft' }} />
                <Tooltip content={<CustomTooltip />} />
                <Line 
                    type="monotone" 
                    dataKey="trend" 
                    stroke="#0f172a" 
                    strokeWidth={2} 
                    name="Trend"
                    dot={false}
                />
                <Line 
                    type="monotone" 
                    dataKey="seasonal" 
                    stroke="#3b82f6" 
                    strokeWidth={2} 
                    name="Seasonal"
                    dot={false}
                />
                <Line 
                    type="monotone" 
                    dataKey="residual" 
                    stroke="#ef4444" 
                    strokeWidth={1} 
                    name="Residual"
                    dot={false}
                    strokeDasharray="5 5"
                />
            </LineChart>
        </ResponsiveContainer>
    );
};

export default DataExplorer;
