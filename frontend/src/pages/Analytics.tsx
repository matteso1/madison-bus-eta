import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
    Activity, RefreshCcw, Target, BarChart3, TrendingUp,
    AlertTriangle, Clock, Layers, Zap, GitBranch, Map
} from 'lucide-react';
import {
    XAxis, YAxis, Tooltip, ResponsiveContainer,
    ReferenceLine, BarChart, Bar, LineChart, Line,
    ScatterChart, Scatter, Cell, AreaChart, Area
} from 'recharts';

const BACKEND_URL = 'https://madison-bus-eta-production.up.railway.app';

// Types
interface HorizonBucket {
    horizon: string;
    mae: number;
    bias: number;
    stddev: number;
    count: number;
    within_1min_pct: number;
    within_2min_pct: number;
}

interface ScatterPoint {
    predicted: number;
    actual: number;
    error_seconds: number;
    route: string;
}

interface WorstPrediction {
    route: string;
    stop_id: string;
    vehicle_id: string;
    predicted_minutes: number | null;
    error_seconds: number;
    error_minutes: number;
    direction: string;
    hour: number | null;
}

interface HourlyData {
    hour: number;
    hour_label: string;
    bias: number;
    mae: number;
    stddev: number;
    count: number;
}

interface FeatureImportance {
    name: string;
    importance: number;
}

interface RouteData {
    route: string;
    predictions: number;
    avgError: number;
    medianError: number;
    within1min: number;
    within2min: number;
}

// Clean tooltip component
const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-slate-900 text-slate-100 border border-slate-700 rounded px-3 py-2 shadow-xl text-xs">
                <p className="font-bold mb-1 text-slate-300">{label}</p>
                {payload.map((entry: any, index: number) => (
                    <p key={index} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                        <span className="text-slate-400">{entry.name}:</span>
                        <span className="font-mono font-bold text-white">
                            {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
                        </span>
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

export default function AnalyticsPage() {
    // State
    const [activeTab, setActiveTab] = useState<'health' | 'errors' | 'features' | 'segments'>('health');
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(new Date());

    // Data state
    const [modelPerf, setModelPerf] = useState<any>(null);
    const [modelStatus, setModelStatus] = useState<any>(null);
    const [coverage, setCoverage] = useState<any>(null);
    const [temporal, setTemporal] = useState<any>(null);
    const [errorDist, setErrorDist] = useState<any>(null);

    // New diagnostic data
    const [horizonData, setHorizonData] = useState<HorizonBucket[]>([]);
    const [scatterData, setScatterData] = useState<{ points: ScatterPoint[], statistics: any }>({ points: [], statistics: {} });
    const [worstPredictions, setWorstPredictions] = useState<WorstPrediction[]>([]);
    const [hourlyBias, setHourlyBias] = useState<{ hourly: HourlyData[], insights: any }>({ hourly: [], insights: {} });
    const [featureImportance, setFeatureImportance] = useState<FeatureImportance[]>([]);
    const [routeStats, setRouteStats] = useState<RouteData[]>([]);
    const [routeHeatmap, setRouteHeatmap] = useState<any>(null);

    const fetchData = async () => {
        try {
            // Core metrics (always fetch)
            const [perfRes, statusRes, covRes, tempRes, distRes] = await Promise.all([
                axios.get(`${BACKEND_URL}/api/model-performance`).catch(() => ({ data: null })),
                axios.get(`${BACKEND_URL}/api/model-status`).catch(() => ({ data: null })),
                axios.get(`${BACKEND_URL}/api/model-diagnostics/coverage`).catch(() => ({ data: null })),
                axios.get(`${BACKEND_URL}/api/model-diagnostics/temporal-stability`).catch(() => ({ data: null })),
                axios.get(`${BACKEND_URL}/api/model-diagnostics/error-distribution`).catch(() => ({ data: null }))
            ]);

            if (perfRes.data) setModelPerf(perfRes.data);
            if (statusRes.data) setModelStatus(statusRes.data);
            if (covRes.data) setCoverage(covRes.data);
            if (tempRes.data) setTemporal(tempRes.data);
            if (distRes.data) setErrorDist(distRes.data);

            // New diagnostic endpoints
            const [horizonRes, scatterRes, worstRes, hourlyRes, featRes, routeRes, heatmapRes] = await Promise.all([
                axios.get(`${BACKEND_URL}/api/diagnostics/error-by-horizon`).catch(() => ({ data: { buckets: [] } })),
                axios.get(`${BACKEND_URL}/api/diagnostics/predicted-vs-actual`).catch(() => ({ data: { points: [], statistics: {} } })),
                axios.get(`${BACKEND_URL}/api/diagnostics/worst-predictions`).catch(() => ({ data: { worst_predictions: [] } })),
                axios.get(`${BACKEND_URL}/api/diagnostics/hourly-bias`).catch(() => ({ data: { hourly: [], insights: {} } })),
                axios.get(`${BACKEND_URL}/api/diagnostics/feature-importance`).catch(() => ({ data: { current: [] } })),
                axios.get(`${BACKEND_URL}/api/route-accuracy`).catch(() => ({ data: { routes: [] } })),
                axios.get(`${BACKEND_URL}/api/model-diagnostics/route-heatmap`).catch(() => ({ data: null }))
            ]);

            if (horizonRes.data?.buckets) setHorizonData(horizonRes.data.buckets);
            if (scatterRes.data) setScatterData(scatterRes.data);
            if (worstRes.data?.worst_predictions) setWorstPredictions(worstRes.data.worst_predictions);
            if (hourlyRes.data) setHourlyBias(hourlyRes.data);
            if (featRes.data?.current) setFeatureImportance(featRes.data.current);
            if (routeRes.data?.routes) setRouteStats(routeRes.data.routes);
            if (heatmapRes.data) setRouteHeatmap(heatmapRes.data);

            setLastUpdated(new Date());
            setLoading(false);
        } catch (err) {
            console.error("Fetch error:", err);
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000);
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center text-slate-400">
                <RefreshCcw className="w-5 h-5 mr-3 animate-spin" />
                <span>Loading ML Diagnostics...</span>
            </div>
        );
    }

    // Derived data
    const coverageData = coverage?.coverage || [];
    // Use trained_at date for X-axis label (more readable than truncated version hash)
    const historyData = (modelPerf?.training_history || []).slice().reverse().map((run: any) => ({
        ...run,
        label: run.trained_at ? run.trained_at.slice(5, 10) : run.version // MM-DD format
    }));
    const distributionData = errorDist?.bins || [];

    return (
        <div className="min-h-screen bg-[#0a0f1a] text-slate-200 font-mono">
            {/* Header */}
            <div className="border-b border-slate-800 bg-[#0a0f1a]/95 backdrop-blur sticky top-0 z-30">
                <div className="max-w-[1800px] mx-auto px-4 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link
                            to="/"
                            className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-xs"
                        >
                            <Map className="w-3.5 h-3.5" />
                            Map
                        </Link>
                        <Activity className="w-5 h-5 text-emerald-400" />
                        <h1 className="font-bold text-white">ML Diagnostics</h1>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-400 uppercase tracking-wider">
                            Production
                        </span>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Tabs */}
                        <div className="flex gap-1 bg-slate-900 rounded p-1">
                            {[
                                { id: 'health', label: 'Health', icon: Activity },
                                { id: 'errors', label: 'Errors', icon: AlertTriangle },
                                { id: 'features', label: 'Features', icon: Layers },
                                { id: 'segments', label: 'Segments', icon: GitBranch }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={`px-3 py-1.5 text-xs font-medium rounded flex items-center gap-1.5 transition-all ${
                                        activeTab === tab.id
                                            ? 'bg-slate-700 text-white'
                                            : 'text-slate-500 hover:text-slate-300'
                                    }`}
                                >
                                    <tab.icon className="w-3.5 h-3.5" />
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        <div className="text-[10px] text-slate-600">
                            Updated {lastUpdated.toLocaleTimeString()}
                        </div>
                    </div>
                </div>
            </div>

            <main className="max-w-[1800px] mx-auto px-4 py-4 space-y-4">
                {/* Key Metrics Row - Always Visible */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    <MetricCard
                        label="Model MAE"
                        value={`${modelPerf?.current_model?.mae_seconds?.toFixed(0) || '-'}s`}
                        subtitle={`${modelPerf?.current_model?.improvement_vs_baseline_pct?.toFixed(0) || 0}% better than API`}
                        status="good"
                    />
                    <MetricCard
                        label="API Baseline"
                        value={`${modelPerf?.api_baseline?.mae_seconds?.toFixed(0) || '-'}s`}
                        subtitle="Raw API error"
                        status="neutral"
                    />
                    <MetricCard
                        label="Coverage &lt;2min"
                        value={`${coverageData.find((c: any) => c.threshold === '2min')?.percentage?.toFixed(0) || '-'}%`}
                        subtitle={coverage?.meets_target ? 'Target met' : 'Below 80% target'}
                        status={coverage?.meets_target ? 'good' : 'warning'}
                    />
                    <MetricCard
                        label="Model Age"
                        value={`${modelStatus?.model_age_days || 0}d`}
                        subtitle={modelStatus?.staleness_status === 'fresh' ? 'Fresh' : 'Needs retrain'}
                        status={modelStatus?.staleness_status === 'fresh' ? 'good' : 'warning'}
                    />
                    <MetricCard
                        label="Data Fresh"
                        value={`${modelStatus?.data_freshness_minutes || 0}m`}
                        subtitle="Since last prediction"
                        status={(modelStatus?.data_freshness_minutes || 99) < 30 ? 'good' : 'warning'}
                    />
                    <MetricCard
                        label="Predictions"
                        value={modelStatus?.predictions_today?.toLocaleString() || '-'}
                        subtitle="Today"
                        status="neutral"
                    />
                </div>

                {/* TAB: Model Health */}
                {activeTab === 'health' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                        {/* MAE Trend */}
                        <Card title="MAE Over Time (14 days)" icon={TrendingUp}>
                            <ResponsiveContainer width="100%" height={200}>
                                <AreaChart data={temporal?.daily_metrics || []}>
                                    <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={d => d?.slice(5, 10)} />
                                    <YAxis stroke="#475569" fontSize={10} tickFormatter={v => `${v}s`} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Area type="monotone" dataKey="mae" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.15} name="MAE (s)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </Card>

                        {/* Coverage Trend */}
                        <Card title="Coverage Thresholds" icon={Target}>
                            <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={coverageData} layout="vertical">
                                    <XAxis type="number" stroke="#475569" fontSize={10} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                                    <YAxis dataKey="threshold" type="category" stroke="#94a3b8" width={50} fontSize={10} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Bar dataKey="percentage" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Coverage %" />
                                    <ReferenceLine x={80} stroke="#10b981" strokeDasharray="3 3" />
                                </BarChart>
                            </ResponsiveContainer>
                        </Card>

                        {/* Training History */}
                        <Card title="Training History" icon={Clock}>
                            {historyData.length === 0 ? (
                                <div className="h-[200px] flex items-center justify-center text-slate-500 text-sm">
                                    No training history available
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height={200}>
                                    <LineChart data={historyData}>
                                        <XAxis dataKey="label" stroke="#475569" fontSize={10} />
                                        <YAxis stroke="#475569" fontSize={10} tickFormatter={v => `${v}s`} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Line type="monotone" dataKey="mae" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, fill: '#f59e0b' }} name="MAE (s)" />
                                    </LineChart>
                                </ResponsiveContainer>
                            )}
                        </Card>

                        {/* Error Distribution */}
                        <Card title="Error Distribution (7 days)" icon={BarChart3} className="xl:col-span-2">
                            <ResponsiveContainer width="100%" height={180}>
                                <BarChart data={distributionData}>
                                    <XAxis dataKey="bin" stroke="#475569" fontSize={9} angle={-45} textAnchor="end" height={60} />
                                    <YAxis stroke="#475569" fontSize={10} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Count" />
                                </BarChart>
                            </ResponsiveContainer>
                            {errorDist?.statistics && (
                                <div className="flex gap-6 mt-2 pt-2 border-t border-slate-800 text-xs">
                                    <Stat label="Mean" value={`${errorDist.statistics.mean?.toFixed(0)}s`} />
                                    <Stat label="Median" value={`${errorDist.statistics.median?.toFixed(0)}s`} />
                                    <Stat label="StdDev" value={`${errorDist.statistics.std_dev?.toFixed(0)}s`} />
                                    <Stat label="Samples" value={errorDist.statistics.total?.toLocaleString()} />
                                </div>
                            )}
                        </Card>

                        {/* Consistency */}
                        <Card title="Daily Accuracy Trend" icon={Target}>
                            <ResponsiveContainer width="100%" height={180}>
                                <LineChart data={temporal?.daily_metrics || []}>
                                    <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={d => d?.slice(5, 10)} />
                                    <YAxis stroke="#475569" fontSize={10} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <ReferenceLine y={80} stroke="#10b981" strokeDasharray="3 3" />
                                    <Line type="monotone" dataKey="within_2min_pct" stroke="#10b981" strokeWidth={2} name="&lt;2min %" />
                                </LineChart>
                            </ResponsiveContainer>
                        </Card>
                    </div>
                )}

                {/* TAB: Error Analysis */}
                {activeTab === 'errors' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Error by Horizon - THE KEY CHART */}
                        <Card title="Error by Prediction Horizon" icon={Clock} className="lg:col-span-2">
                            <p className="text-xs text-slate-500 mb-3">
                                Horizon is the #1 feature. Longer predictions have more error - this shows how much.
                            </p>
                            {!horizonData || horizonData.length === 0 ? (
                                <div className="h-[220px] flex items-center justify-center text-slate-500 text-sm">
                                    No horizon data available - deploy backend to enable this chart
                                </div>
                            ) : (
                                <>
                                    <ResponsiveContainer width="100%" height={220}>
                                        <BarChart data={horizonData}>
                                            <XAxis dataKey="horizon" stroke="#475569" fontSize={11} />
                                            <YAxis stroke="#475569" fontSize={10} tickFormatter={v => `${v}s`} />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Bar dataKey="mae" fill="#ef4444" radius={[4, 4, 0, 0]} name="MAE (s)" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                    <div className="grid grid-cols-5 gap-2 mt-3 text-xs">
                                        {horizonData.map(h => (
                                            <div key={h.horizon} className="bg-slate-900 rounded p-2 text-center">
                                                <div className="text-slate-500 text-[10px]">{h.horizon}</div>
                                                <div className="font-bold text-white">{h.mae.toFixed(0)}s MAE</div>
                                                <div className="text-slate-500">{h.count.toLocaleString()} samples</div>
                                                <div className="text-emerald-400">{h.within_2min_pct.toFixed(0)}% &lt;2min</div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </Card>

                        {/* Predicted vs Actual Scatter */}
                        <Card title="Predicted vs Actual (24h)" icon={Target}>
                            {!scatterData.points || scatterData.points.length === 0 ? (
                                <div className="h-[250px] flex items-center justify-center text-slate-500 text-sm">
                                    No scatter data available - deploy backend to enable this chart
                                </div>
                            ) : (
                                <>
                                    <ResponsiveContainer width="100%" height={250}>
                                        <ScatterChart>
                                            <XAxis dataKey="predicted" stroke="#475569" fontSize={10} name="Predicted" unit="min" domain={[0, 30]} />
                                            <YAxis dataKey="actual" stroke="#475569" fontSize={10} name="Actual" unit="min" domain={[0, 30]} />
                                            <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<CustomTooltip />} />
                                            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 30, y: 30 }]} stroke="#475569" strokeDasharray="3 3" />
                                            <Scatter data={scatterData.points} fill="#8b5cf6" fillOpacity={0.6}>
                                                {scatterData.points.map((_, i) => (
                                                    <Cell key={i} fill="#8b5cf6" />
                                                ))}
                                            </Scatter>
                                        </ScatterChart>
                                    </ResponsiveContainer>
                                    {scatterData.statistics && Object.keys(scatterData.statistics).length > 0 && (
                                        <div className="flex gap-4 mt-2 pt-2 border-t border-slate-800 text-xs">
                                            <Stat label="R^2" value={scatterData.statistics.r_squared != null ? scatterData.statistics.r_squared.toFixed(3) : '-'} />
                                            <Stat label="MAE" value={scatterData.statistics.mae_seconds != null ? `${scatterData.statistics.mae_seconds.toFixed(0)}s` : '-'} />
                                            <Stat label="Bias" value={scatterData.statistics.bias_seconds != null ? `${scatterData.statistics.bias_seconds.toFixed(0)}s` : '-'} />
                                            <Stat label="n" value={scatterData.statistics.sample_size ?? '-'} />
                                        </div>
                                    )}
                                </>
                            )}
                        </Card>

                        {/* Hourly Bias */}
                        <Card title="Error by Hour of Day" icon={Clock}>
                            {!hourlyBias.hourly || hourlyBias.hourly.length === 0 ? (
                                <div className="h-[250px] flex items-center justify-center text-slate-500 text-sm">
                                    No hourly data available - deploy backend to enable this chart
                                </div>
                            ) : (
                                <>
                                    <ResponsiveContainer width="100%" height={250}>
                                        <BarChart data={hourlyBias.hourly}>
                                            <XAxis dataKey="hour" stroke="#475569" fontSize={10} />
                                            <YAxis stroke="#475569" fontSize={10} />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Bar dataKey="mae" fill="#f59e0b" radius={[2, 2, 0, 0]} name="MAE (s)" />
                                            <Bar dataKey="bias" fill="#3b82f6" radius={[2, 2, 0, 0]} name="Bias (s)" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                    {hourlyBias.insights && Object.keys(hourlyBias.insights).length > 0 && (
                                        <div className="flex gap-4 mt-2 pt-2 border-t border-slate-800 text-xs">
                                            <Stat label="Rush Hour MAE" value={hourlyBias.insights.rush_hour_mae != null ? `${hourlyBias.insights.rush_hour_mae}s` : '-'} />
                                            <Stat label="Non-Rush MAE" value={hourlyBias.insights.non_rush_mae != null ? `${hourlyBias.insights.non_rush_mae}s` : '-'} />
                                            <Stat label="Rush Penalty" value={hourlyBias.insights.rush_hour_penalty != null ? `+${hourlyBias.insights.rush_hour_penalty}s` : '-'} />
                                        </div>
                                    )}
                                </>
                            )}
                        </Card>

                        {/* Worst Predictions Table */}
                        <Card title="Worst Predictions (24h)" icon={AlertTriangle} className="lg:col-span-2">
                            {!worstPredictions || worstPredictions.length === 0 ? (
                                <div className="text-center py-8 text-slate-500 text-sm">
                                    No worst predictions data available - deploy backend to enable this table
                                </div>
                            ) : (
                                <div className="overflow-x-auto max-h-64">
                                    <table className="w-full text-xs">
                                        <thead className="text-slate-500 uppercase border-b border-slate-800">
                                            <tr>
                                                <th className="text-left py-2 px-2">Route</th>
                                                <th className="text-left py-2 px-2">Stop</th>
                                                <th className="text-right py-2 px-2">Predicted</th>
                                                <th className="text-right py-2 px-2">Error</th>
                                                <th className="text-center py-2 px-2">Direction</th>
                                                <th className="text-right py-2 px-2">Hour</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/50">
                                            {worstPredictions.slice(0, 10).map((p, i) => (
                                                <tr key={i} className="hover:bg-slate-800/30">
                                                    <td className="py-1.5 px-2 font-bold text-indigo-400">{p.route}</td>
                                                    <td className="py-1.5 px-2 text-slate-400">{p.stop_id}</td>
                                                    <td className="py-1.5 px-2 text-right">{p.predicted_minutes ?? '-'}m</td>
                                                    <td className="py-1.5 px-2 text-right font-bold text-red-400">{p.error_minutes}m</td>
                                                    <td className="py-1.5 px-2 text-center">
                                                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                                            p.direction === 'late' ? 'bg-red-900/50 text-red-400' : 'bg-blue-900/50 text-blue-400'
                                                        }`}>
                                                            {p.direction}
                                                        </span>
                                                    </td>
                                                    <td className="py-1.5 px-2 text-right text-slate-500">{p.hour}:00</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </Card>
                    </div>
                )}

                {/* TAB: Features */}
                {activeTab === 'features' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Feature Importance */}
                        <Card title="Feature Importance (Top 15)" icon={Layers} className="lg:col-span-2">
                            {!featureImportance || featureImportance.length === 0 ? (
                                <div className="h-[350px] flex items-center justify-center text-slate-500 text-sm">
                                    No feature importance data available - deploy backend to enable this chart
                                </div>
                            ) : (
                                <>
                                    <ResponsiveContainer width="100%" height={350}>
                                        <BarChart data={featureImportance} layout="vertical">
                                            <XAxis type="number" stroke="#475569" fontSize={10} />
                                            <YAxis dataKey="name" type="category" stroke="#94a3b8" width={140} fontSize={10} />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Bar dataKey="importance" fill="#10b981" radius={[0, 4, 4, 0]} name="Importance" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                    <div className="mt-3 p-3 bg-slate-900 rounded text-xs text-slate-400">
                                        <strong className="text-white">Key Insight:</strong> horizon_min (prediction horizon) should be the most important feature.
                                        If it's not in top 3, the model may not be learning the key pattern correctly.
                                    </div>
                                </>
                            )}
                        </Card>

                        {/* Model Info */}
                        <Card title="Current Model" icon={Zap}>
                            <div className="space-y-3 text-sm">
                                <InfoRow label="Version" value={modelStatus?.model_version || 'Unknown'} />
                                <InfoRow label="Trained" value={modelStatus?.trained_at?.slice(0, 10) || 'Unknown'} />
                                <InfoRow label="Training Samples" value={modelPerf?.current_model?.samples_trained?.toLocaleString() || '-'} />
                                <InfoRow label="MAE" value={`${modelPerf?.current_model?.mae_seconds?.toFixed(1) || '-'}s`} />
                                <InfoRow label="RMSE" value={`${modelPerf?.current_model?.rmse_seconds?.toFixed(1) || '-'}s`} />
                                <InfoRow label="Improvement" value={`${modelPerf?.current_model?.improvement_vs_baseline_pct?.toFixed(1) || '-'}%`} />
                            </div>
                        </Card>

                        {/* Training Runs */}
                        <Card title="Recent Training Runs" icon={GitBranch}>
                            <div className="space-y-2 text-xs">
                                {(modelPerf?.training_history || []).slice(0, 5).map((run: any, i: number) => (
                                    <div key={i} className="flex items-center justify-between py-2 border-b border-slate-800/50">
                                        <div>
                                            <span className="font-mono text-indigo-400">{run.version}</span>
                                            <span className="ml-2 text-slate-500">{run.trained_at?.slice(0, 10)}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="font-bold">{run.mae?.toFixed(0)}s</span>
                                            {run.deployed && (
                                                <span className="px-1.5 py-0.5 bg-emerald-900/50 text-emerald-400 rounded text-[10px]">
                                                    deployed
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    </div>
                )}

                {/* TAB: Segments */}
                {activeTab === 'segments' && (
                    <div className="space-y-4">
                        {/* Route Performance Table */}
                        <Card title="Route Performance" icon={GitBranch}>
                            {!routeStats || routeStats.length === 0 ? (
                                <div className="text-center py-8 text-slate-500">
                                    <p>No route data available.</p>
                                    <p className="text-xs mt-1">Route performance data will appear once the backend is connected and has prediction outcomes.</p>
                                </div>
                            ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead className="text-slate-500 uppercase border-b border-slate-800">
                                        <tr>
                                            <th className="text-left py-2 px-3">Route</th>
                                            <th className="text-right py-2 px-3">Predictions</th>
                                            <th className="text-right py-2 px-3">Avg Error</th>
                                            <th className="text-right py-2 px-3">Median</th>
                                            <th className="text-right py-2 px-3">&lt;1min</th>
                                            <th className="text-right py-2 px-3">&lt;2min</th>
                                            <th className="text-center py-2 px-3">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {routeStats.slice(0, 20).map((r) => {
                                            // Convert to numbers in case API returns strings
                                            const avgErr = Number(r.avgError) || 0;
                                            const medianErr = Number(r.medianError) || 0;
                                            const w1min = Number(r.within1min) || 0;
                                            const w2min = Number(r.within2min) || 0;

                                            const status = avgErr < 60 ? 'Excellent' : avgErr < 90 ? 'Good' : avgErr < 120 ? 'Fair' : 'Poor';
                                            const statusColor = avgErr < 60 ? 'text-emerald-400 bg-emerald-950/50' :
                                                avgErr < 90 ? 'text-green-400 bg-green-950/50' :
                                                avgErr < 120 ? 'text-amber-400 bg-amber-950/50' : 'text-red-400 bg-red-950/50';

                                            return (
                                                <tr key={r.route} className="hover:bg-slate-800/30">
                                                    <td className="py-2 px-3 font-bold text-indigo-400">{r.route}</td>
                                                    <td className="py-2 px-3 text-right text-slate-300">{r.predictions?.toLocaleString()}</td>
                                                    <td className="py-2 px-3 text-right font-mono">{avgErr.toFixed(0)}s</td>
                                                    <td className="py-2 px-3 text-right font-mono text-slate-500">{medianErr.toFixed(0)}s</td>
                                                    <td className="py-2 px-3 text-right">{w1min.toFixed(0)}%</td>
                                                    <td className="py-2 px-3 text-right">{w2min.toFixed(0)}%</td>
                                                    <td className="py-2 px-3 text-center">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusColor}`}>
                                                            {status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            )}
                        </Card>

                        {/* Route x Hour Heatmap placeholder */}
                        {routeHeatmap && (
                            <Card title="Route x Hour Heatmap" icon={BarChart3}>
                                <p className="text-xs text-slate-500 mb-3">
                                    MAE by route and hour. Darker = higher error. Click to drill down.
                                </p>
                                <div className="overflow-x-auto">
                                    <table className="text-[10px]">
                                        <thead>
                                            <tr>
                                                <th className="px-2 py-1 text-left text-slate-500">Route</th>
                                                {routeHeatmap.hours?.map((h: number) => (
                                                    <th key={h} className="px-1 py-1 text-center text-slate-500 w-8">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {routeHeatmap.heatmap?.slice(0, 12).map((row: any) => (
                                                <tr key={row.route}>
                                                    <td className="px-2 py-1 font-bold text-indigo-400">{row.route}</td>
                                                    {routeHeatmap.hours?.map((h: number) => {
                                                        const val = row[`h${h}`];
                                                        const intensity = val ? Math.min(val / 180, 1) : 0;
                                                        return (
                                                            <td
                                                                key={h}
                                                                className="px-1 py-1 text-center"
                                                                style={{
                                                                    backgroundColor: val ? `rgba(239, 68, 68, ${intensity * 0.7})` : 'transparent'
                                                                }}
                                                            >
                                                                {val ? Math.round(val) : '-'}
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </Card>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

// Components
function Card({ title, icon: Icon, children, className = '' }: { title: string; icon: any; children: React.ReactNode; className?: string }) {
    return (
        <div className={`bg-slate-900/50 border border-slate-800 rounded-lg p-4 ${className}`}>
            <h3 className="text-xs text-slate-400 font-bold uppercase mb-3 flex items-center gap-2">
                <Icon className="w-4 h-4" />
                {title}
            </h3>
            {children}
        </div>
    );
}

function MetricCard({ label, value, subtitle, status }: { label: string; value: string; subtitle: string; status: 'good' | 'warning' | 'bad' | 'neutral' }) {
    const statusColors = {
        good: 'text-emerald-400',
        warning: 'text-amber-400',
        bad: 'text-red-400',
        neutral: 'text-indigo-400'
    };

    return (
        <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
            <div className={`text-xl font-bold ${statusColors[status]}`}>{value}</div>
            <div className="text-[10px] text-slate-600 mt-0.5">{subtitle}</div>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string | number | undefined }) {
    return (
        <div>
            <span className="text-slate-500">{label}: </span>
            <span className="font-bold text-white">{value ?? '-'}</span>
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between py-1.5 border-b border-slate-800/50">
            <span className="text-slate-500">{label}</span>
            <span className="font-mono text-white">{value}</span>
        </div>
    );
}
