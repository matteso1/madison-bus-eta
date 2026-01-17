import { useState, useEffect } from 'react';
import axios from 'axios';
import {
    Activity, RefreshCcw, TrendingUp, TrendingDown, Zap, Database, Award, Clock
} from 'lucide-react';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    ScatterChart, Scatter, ReferenceLine, BarChart, Bar, LineChart, Line
} from 'recharts';

const BACKEND_URL = 'https://madison-bus-eta-production.up.railway.app';
// const BACKEND_URL = 'http://localhost:5000'; // Local dev override

// --- Types ---
interface ModelPerformance {
    model_available: boolean;
    current_model: {
        version: string;
        trained_at: string;
        mae_seconds: number;
        mae_minutes: number;
        rmse_seconds: number;
        improvement_vs_baseline_pct: number;
        samples_trained: number;
    };
    api_baseline: {
        mae_seconds: number;
        mae_minutes: number;
    };
    training_history: {
        version: string;
        mae: number;
        improvement_pct: number;
        samples: number;
    }[];
    feature_importance: Record<string, string>;
    model_summary: string;
}

interface ScientificMetrics {
    mape: number;
    r_squared: number;
    buffer_time_index: number;
    mae: number;
    std_dev: number;
    p95_error: number;
    sample_count: number;
}

interface ResidualPoint {
    predicted: number;
    actual: number;
    residual: number;
}

interface RouteRow {
    route: string;
    predictions: number;
    avgError: number;
    within1min: number;
}

export default function AnalyticsPage() {
    const [modelPerf, setModelPerf] = useState<ModelPerformance | null>(null);
    const [metrics, setMetrics] = useState<ScientificMetrics | null>(null);
    const [residuals, setResiduals] = useState<ResidualPoint[]>([]);
    const [routeStats, setRouteStats] = useState<RouteRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

    const fetchData = async () => {
        try {
            const [modelRes, metricsRes, residRes, routeRes] = await Promise.all([
                axios.get(`${BACKEND_URL}/api/model-performance`),
                axios.get(`${BACKEND_URL}/api/scientific-metrics`),
                axios.get(`${BACKEND_URL}/api/model-diagnostics/residuals`),
                axios.get(`${BACKEND_URL}/api/route-accuracy`)
            ]);

            setModelPerf(modelRes.data);
            setMetrics(metricsRes.data);
            setResiduals(residRes.data);

            if (routeRes.data?.routes) {
                const rows = routeRes.data.routes.map((r: any) => ({
                    route: r.route,
                    predictions: r.predictions,
                    avgError: Number(r.avgError || 0),
                    within1min: Number(r.within1min || 0)
                }));
                setRouteStats(rows);
            }

            setLastUpdated(new Date());
            setLoading(false);
        } catch (err) {
            console.error("Failed to fetch analytics", err);
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000); // 60s refresh
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0f1117] flex items-center justify-center text-zinc-500 font-mono text-sm">
                <RefreshCcw className="w-4 h-4 mr-2 animate-spin" />
                LOADING ANALYTICS...
            </div>
        );
    }

    // Prepare comparison data for chart
    const comparisonData = modelPerf ? [
        { name: 'API Baseline', mae: modelPerf.api_baseline.mae_seconds, fill: '#ef4444' },
        { name: 'ML Model', mae: modelPerf.current_model.mae_seconds, fill: '#22c55e' }
    ] : [];

    // Training history for line chart
    const historyData = modelPerf?.training_history?.slice().reverse().map(h => ({
        version: h.version,
        mae: h.mae
    })) || [];

    // Feature importance for bar chart
    const featureData = modelPerf?.feature_importance ?
        Object.entries(modelPerf.feature_importance).slice(0, 8).map(([name, val]) => ({
            name: name.replace(/_/g, ' '),
            importance: parseFloat(val) * 100
        })) : [];

    return (
        <div className="min-h-screen bg-[#0f1117] text-zinc-300 font-sans">
            {/* Header */}
            <header className="border-b border-white/10 bg-[#0f1117]/80 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-7 h-7 bg-indigo-600 rounded flex items-center justify-center">
                            <Activity className="w-4 h-4 text-white" />
                        </div>
                        <h1 className="text-base font-semibold text-white">
                            ML Model Analytics
                        </h1>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono text-zinc-500">
                        <span className="flex items-center gap-2">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            LIVE
                        </span>
                        <span>{lastUpdated.toLocaleTimeString()}</span>
                        <button onClick={fetchData} className="p-1 hover:text-white">
                            <RefreshCcw className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-[1600px] mx-auto px-6 py-6">
                {/* MODEL IMPROVEMENT HERO SECTION */}
                {modelPerf?.model_available && (
                    <div className="bg-gradient-to-r from-emerald-900/30 to-indigo-900/30 border border-emerald-500/30 rounded-lg p-6 mb-6">
                        <div className="flex items-center gap-3 mb-4">
                            <Award className="w-6 h-6 text-emerald-400" />
                            <h2 className="text-lg font-semibold text-white">ML Model Performance</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            {/* ML MAE */}
                            <div className="bg-black/20 rounded-lg p-4">
                                <div className="text-xs text-emerald-400 font-medium mb-1">ML MODEL MAE</div>
                                <div className="text-3xl font-bold text-white">
                                    {modelPerf.current_model.mae_seconds.toFixed(1)}s
                                </div>
                                <div className="text-sm text-zinc-400">
                                    ({modelPerf.current_model.mae_minutes.toFixed(2)} min)
                                </div>
                            </div>
                            {/* API Baseline */}
                            <div className="bg-black/20 rounded-lg p-4">
                                <div className="text-xs text-red-400 font-medium mb-1">API BASELINE MAE</div>
                                <div className="text-3xl font-bold text-zinc-400">
                                    {modelPerf.api_baseline.mae_seconds.toFixed(1)}s
                                </div>
                                <div className="text-sm text-zinc-500">
                                    ({modelPerf.api_baseline.mae_minutes.toFixed(2)} min)
                                </div>
                            </div>
                            {/* Improvement */}
                            <div className="bg-black/20 rounded-lg p-4">
                                <div className="text-xs text-indigo-400 font-medium mb-1">IMPROVEMENT</div>
                                <div className="text-3xl font-bold text-emerald-400 flex items-center gap-2">
                                    <TrendingUp className="w-6 h-6" />
                                    {modelPerf.current_model.improvement_vs_baseline_pct.toFixed(1)}%
                                </div>
                                <div className="text-sm text-zinc-400">vs API baseline</div>
                            </div>
                            {/* Training samples */}
                            <div className="bg-black/20 rounded-lg p-4">
                                <div className="text-xs text-zinc-400 font-medium mb-1">TRAINING DATA</div>
                                <div className="text-3xl font-bold text-white">
                                    {(modelPerf.current_model.samples_trained / 1000).toFixed(1)}K
                                </div>
                                <div className="text-sm text-zinc-500">
                                    v{modelPerf.current_model.version}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* COMPARISON CHARTS ROW */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    {/* MAE Comparison Bar Chart */}
                    <div className="bg-[#16181d] border border-white/5 rounded-lg p-4">
                        <h3 className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-yellow-400" />
                            API vs ML Model Comparison
                        </h3>
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={comparisonData} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                <XAxis type="number" stroke="#666" tickFormatter={v => `${v}s`} />
                                <YAxis dataKey="name" type="category" stroke="#666" width={100} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#2d2d3d', border: '1px solid #555', color: '#fff' }}
                                    formatter={(value: number) => [`${value.toFixed(1)}s`, 'MAE']}
                                />
                                <Bar dataKey="mae" radius={[0, 4, 4, 0]}>
                                    {comparisonData.map((entry, index) => (
                                        <rect key={index} fill={entry.fill} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Training History */}
                    <div className="bg-[#16181d] border border-white/5 rounded-lg p-4">
                        <h3 className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
                            <Clock className="w-4 h-4 text-blue-400" />
                            Training History (MAE over time)
                        </h3>
                        <ResponsiveContainer width="100%" height={200}>
                            <LineChart data={historyData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                <XAxis dataKey="version" stroke="#666" fontSize={10} />
                                <YAxis stroke="#666" tickFormatter={v => `${v}s`} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#2d2d3d', border: '1px solid #555', color: '#fff' }}
                                    formatter={(value: number) => [`${value?.toFixed(1)}s`, 'MAE']}
                                />
                                <Line type="monotone" dataKey="mae" stroke="#818cf8" strokeWidth={2} dot={{ fill: '#818cf8' }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* RAW DATA METRICS */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <MetricCard
                        title="MAPE (24h)"
                        value={metrics ? `${metrics.mape.toFixed(1)}%` : "--"}
                        sub="Raw prediction error"
                        trend={metrics && metrics.mape < 15 ? "good" : "neutral"}
                    />
                    <MetricCard
                        title="R² Score"
                        value={metrics ? metrics.r_squared.toFixed(3) : "--"}
                        sub="Variance explained"
                        trend={metrics && metrics.r_squared > 0.3 ? "good" : "neutral"}
                    />
                    <MetricCard
                        title="Std Deviation"
                        value={metrics ? `${metrics.std_dev.toFixed(0)}s` : "--"}
                        sub="Error spread"
                        trend="neutral"
                    />
                    <MetricCard
                        title="95th Percentile"
                        value={metrics ? `${(metrics.p95_error / 60).toFixed(1)}m` : "--"}
                        sub="Worst case error"
                        trend={metrics && metrics.p95_error < 300 ? "good" : "bad"}
                    />
                </div>

                {/* FEATURE IMPORTANCE & ROUTE TABLE */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    {/* Feature Importance */}
                    <div className="bg-[#16181d] border border-white/5 rounded-lg p-4">
                        <h3 className="text-sm font-medium text-zinc-300 mb-4 flex items-center gap-2">
                            <Database className="w-4 h-4 text-purple-400" />
                            Top Features (Importance %)
                        </h3>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={featureData} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                <XAxis type="number" stroke="#666" />
                                <YAxis dataKey="name" type="category" stroke="#666" width={120} fontSize={11} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#2d2d3d', border: '1px solid #555', color: '#fff' }}
                                    formatter={(value: number) => [`${value.toFixed(1)}%`, 'Importance']}
                                />
                                <Bar dataKey="importance" fill="#a855f7" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Route Performance Table */}
                    <div className="bg-[#16181d] border border-white/5 rounded-lg p-4 overflow-hidden">
                        <h3 className="text-sm font-medium text-zinc-300 mb-4">
                            Route Performance (Top 10)
                        </h3>
                        <div className="overflow-x-auto max-h-[250px] overflow-y-auto">
                            <table className="w-full text-xs">
                                <thead className="text-zinc-500 border-b border-white/10">
                                    <tr>
                                        <th className="text-left py-2 px-2">Route</th>
                                        <th className="text-right py-2 px-2">Samples</th>
                                        <th className="text-right py-2 px-2">Avg Error</th>
                                        <th className="text-right py-2 px-2">Within 1min</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {routeStats.slice(0, 10).map(row => (
                                        <tr key={row.route} className="border-b border-white/5 hover:bg-white/5">
                                            <td className="py-2 px-2 font-mono text-indigo-400">{row.route}</td>
                                            <td className="py-2 px-2 text-right text-zinc-400">{row.predictions.toLocaleString()}</td>
                                            <td className="py-2 px-2 text-right">
                                                <span className={row.avgError < 90 ? 'text-emerald-400' : row.avgError < 150 ? 'text-yellow-400' : 'text-red-400'}>
                                                    {row.avgError.toFixed(0)}s
                                                </span>
                                            </td>
                                            <td className="py-2 px-2 text-right">
                                                <span className={row.within1min > 60 ? 'text-emerald-400' : 'text-zinc-400'}>
                                                    {row.within1min.toFixed(0)}%
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* RESIDUALS SCATTER */}
                <div className="bg-[#16181d] border border-white/5 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-zinc-300 mb-4">
                        Predicted vs Actual (Residual Analysis)
                    </h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <ScatterChart margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                            <XAxis
                                type="number"
                                dataKey="predicted"
                                name="Predicted"
                                stroke="#666"
                                label={{ value: 'Predicted (s)', position: 'bottom', fill: '#666', fontSize: 10 }}
                            />
                            <YAxis
                                type="number"
                                dataKey="actual"
                                name="Actual"
                                stroke="#666"
                                label={{ value: 'Actual (s)', angle: -90, position: 'left', fill: '#666', fontSize: 10 }}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#2d2d3d', border: '1px solid #555', color: '#fff' }}
                                formatter={(value: number) => value.toFixed(1)}
                            />
                            <ReferenceLine stroke="#22c55e" strokeDasharray="3 3" segment={[{ x: 0, y: 0 }, { x: 1000, y: 1000 }]} />
                            <Scatter data={residuals.slice(0, 500)} fill="#f97316" opacity={0.6} />
                        </ScatterChart>
                    </ResponsiveContainer>
                    <p className="text-xs text-zinc-500 mt-2 text-center">
                        Green line = perfect prediction. Points above = bus arrived later than predicted.
                    </p>
                </div>
            </main>
        </div>
    );
}

// --- Subcomponents ---

function MetricCard({ title, value, sub, trend }: { title: string, value: string, sub: string, trend: 'good' | 'bad' | 'neutral' }) {
    const trendColor = {
        good: 'text-emerald-400',
        bad: 'text-red-400',
        neutral: 'text-zinc-400'
    };

    return (
        <div className="bg-[#16181d] border border-white/5 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-zinc-500 uppercase">{title}</span>
                {trend === 'good' && <TrendingUp className="w-3 h-3 text-emerald-400" />}
                {trend === 'bad' && <TrendingDown className="w-3 h-3 text-red-400" />}
            </div>
            <div className={`text-2xl font-bold ${trendColor[trend]}`}>{value}</div>
            <div className="text-xs text-zinc-600 mt-1">{sub}</div>
        </div>
    );
}
