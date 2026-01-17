import { useState, useEffect } from 'react';
import axios from 'axios';
import {
    Activity, RefreshCcw, TrendingUp, Zap, Database,
    Shield, Clock, AlertTriangle, CheckCircle, BarChart3, PieChart
} from 'lucide-react';
import {
    XAxis, YAxis, Tooltip, ResponsiveContainer,
    ReferenceLine, BarChart, Bar, LineChart, Line, Area, AreaChart
} from 'recharts';

const BACKEND_URL = 'https://madison-bus-eta-production.up.railway.app';
// const BACKEND_URL = 'http://localhost:5000';

// Types
interface ModelPerf {
    model_available: boolean;
    current_model: { version: string; mae_seconds: number; improvement_vs_baseline_pct: number; samples_trained: number };
    api_baseline: { mae_seconds: number };
    training_history: { version: string; mae: number }[];
    feature_importance: Record<string, string>;
}

interface ModelStatus {
    model_version: string;
    model_age_days: number;
    staleness_status: string;
    current_mae: number;
    predictions_today: number;
    data_freshness_minutes: number;
    health: string;
}

interface ErrorDistribution {
    bins: { bin: string; count: number }[];
    statistics: { mean: number; median: number; std_dev: number; total: number };
}

interface TemporalData {
    daily_metrics: { date: string; mae: number; within_2min_pct: number; predictions: number }[];
    drift_detected: boolean;
}

interface Coverage {
    coverage: { threshold: string; percentage: number }[];
    meets_target: boolean;
}

export default function AnalyticsPage() {
    const [modelPerf, setModelPerf] = useState<ModelPerf | null>(null);
    const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
    const [errorDist, setErrorDist] = useState<ErrorDistribution | null>(null);
    const [temporal, setTemporal] = useState<TemporalData | null>(null);
    const [coverage, setCoverage] = useState<Coverage | null>(null);
    const [routeStats, setRouteStats] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'overview' | 'diagnostics' | 'routes'>('overview');
    const [lastUpdated, setLastUpdated] = useState(new Date());

    const fetchData = async () => {
        try {
            const [perfRes, statusRes, distRes, tempRes, covRes, routeRes] = await Promise.all([
                axios.get(`${BACKEND_URL}/api/model-performance`).catch(() => ({ data: null })),
                axios.get(`${BACKEND_URL}/api/model-status`).catch(() => ({ data: null })),
                axios.get(`${BACKEND_URL}/api/model-diagnostics/error-distribution`).catch(() => ({ data: null })),
                axios.get(`${BACKEND_URL}/api/model-diagnostics/temporal-stability`).catch(() => ({ data: null })),
                axios.get(`${BACKEND_URL}/api/model-diagnostics/coverage`).catch(() => ({ data: null })),
                axios.get(`${BACKEND_URL}/api/route-accuracy`).catch(() => ({ data: { routes: [] } }))
            ]);

            if (perfRes.data) setModelPerf(perfRes.data);
            if (statusRes.data) setModelStatus(statusRes.data);
            if (distRes.data) setErrorDist(distRes.data);
            if (tempRes.data) setTemporal(tempRes.data);
            if (covRes.data) setCoverage(covRes.data);
            if (routeRes.data?.routes) setRouteStats(routeRes.data.routes);

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
            <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-zinc-500">
                <RefreshCcw className="w-5 h-5 mr-2 animate-spin" />
                Loading ML Analytics...
            </div>
        );
    }

    const comparisonData = modelPerf ? [
        { name: 'API Baseline', value: modelPerf.api_baseline.mae_seconds, fill: '#ef4444' },
        { name: 'ML Model', value: modelPerf.current_model.mae_seconds, fill: '#22c55e' }
    ] : [];

    const historyData = modelPerf?.training_history?.slice().reverse() || [];
    const featureData = modelPerf?.feature_importance ?
        Object.entries(modelPerf.feature_importance).slice(0, 10).map(([k, v]) => ({
            name: k.replace(/_/g, ' ').slice(0, 15),
            value: parseFloat(v) * 100
        })) : [];

    return (
        <div className="min-h-screen bg-[#0a0a0f] text-zinc-300">
            {/* Header */}
            <header className="border-b border-white/5 bg-[#0a0a0f]/90 backdrop-blur sticky top-0 z-50">
                <div className="max-w-[1800px] mx-auto px-4 h-12 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Activity className="w-5 h-5 text-indigo-400" />
                        <span className="font-semibold text-white">ML Analytics</span>
                    </div>
                    <div className="flex items-center gap-6">
                        {/* Tabs */}
                        <div className="flex gap-1 bg-white/5 p-0.5 rounded-lg">
                            {['overview', 'diagnostics', 'routes'].map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab as any)}
                                    className={`px-3 py-1 text-xs rounded ${activeTab === tab ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                                >
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                            <span className={`w-2 h-2 rounded-full ${modelStatus?.health === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                            {lastUpdated.toLocaleTimeString()}
                            <button onClick={fetchData} className="p-1 hover:text-white"><RefreshCcw className="w-3 h-3" /></button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-[1800px] mx-auto px-4 py-4">
                {activeTab === 'overview' && (
                    <>
                        {/* Quick Stats Row */}
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
                            <StatCard
                                label="Model MAE"
                                value={`${modelPerf?.current_model.mae_seconds?.toFixed(0) || '--'}s`}
                                sub={`${modelPerf?.current_model.improvement_vs_baseline_pct?.toFixed(0) || 0}% better`}
                                trend="good"
                            />
                            <StatCard
                                label="API Baseline"
                                value={`${modelPerf?.api_baseline.mae_seconds?.toFixed(0) || '--'}s`}
                                sub="Without ML"
                                trend="neutral"
                            />
                            <StatCard
                                label="Model Age"
                                value={`${modelStatus?.model_age_days || 0}d`}
                                sub={modelStatus?.staleness_status || ''}
                                trend={modelStatus?.model_age_days && modelStatus.model_age_days < 3 ? 'good' : 'bad'}
                            />
                            <StatCard
                                label="Predictions Today"
                                value={modelStatus?.predictions_today?.toLocaleString() || '--'}
                                sub="Outcomes tracked"
                                trend="neutral"
                            />
                            <StatCard
                                label="Within 2min"
                                value={`${coverage?.coverage.find(c => c.threshold === '2min')?.percentage.toFixed(0) || '--'}%`}
                                sub={coverage?.meets_target ? 'Target met' : 'Below target'}
                                trend={coverage?.meets_target ? 'good' : 'bad'}
                            />
                            <StatCard
                                label="Data Fresh"
                                value={`${modelStatus?.data_freshness_minutes || '--'}m`}
                                sub="Since last outcome"
                                trend={modelStatus?.data_freshness_minutes && modelStatus.data_freshness_minutes < 30 ? 'good' : 'neutral'}
                            />
                        </div>

                        {/* Main Charts Row */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                            {/* API vs ML Comparison */}
                            <div className="bg-[#111118] border border-white/5 rounded-lg p-4">
                                <h3 className="text-xs font-medium text-zinc-400 mb-3 flex items-center gap-2">
                                    <Zap className="w-3.5 h-3.5 text-yellow-400" />
                                    MAE Comparison
                                </h3>
                                <ResponsiveContainer width="100%" height={150}>
                                    <BarChart data={comparisonData} layout="vertical">
                                        <XAxis type="number" stroke="#444" tickFormatter={v => `${v}s`} fontSize={10} />
                                        <YAxis dataKey="name" type="category" stroke="#444" width={80} fontSize={10} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', color: '#fff' }} />
                                        <Bar dataKey="value" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Coverage Chart */}
                            <div className="bg-[#111118] border border-white/5 rounded-lg p-4">
                                <h3 className="text-xs font-medium text-zinc-400 mb-3 flex items-center gap-2">
                                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                                    Prediction Coverage
                                </h3>
                                <ResponsiveContainer width="100%" height={150}>
                                    <BarChart data={coverage?.coverage || []}>
                                        <XAxis dataKey="threshold" stroke="#444" fontSize={10} />
                                        <YAxis stroke="#444" fontSize={10} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', color: '#fff' }} />
                                        <Bar dataKey="percentage" fill="#22c55e" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Training History */}
                            <div className="bg-[#111118] border border-white/5 rounded-lg p-4">
                                <h3 className="text-xs font-medium text-zinc-400 mb-3 flex items-center gap-2">
                                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                                    Training History
                                </h3>
                                <ResponsiveContainer width="100%" height={150}>
                                    <LineChart data={historyData}>
                                        <XAxis dataKey="version" stroke="#444" fontSize={9} />
                                        <YAxis stroke="#444" fontSize={10} tickFormatter={v => `${v}s`} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', color: '#fff' }} />
                                        <Line type="monotone" dataKey="mae" stroke="#818cf8" strokeWidth={2} dot={{ r: 3 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Feature Importance + Error Distribution */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="bg-[#111118] border border-white/5 rounded-lg p-4">
                                <h3 className="text-xs font-medium text-zinc-400 mb-3 flex items-center gap-2">
                                    <BarChart3 className="w-3.5 h-3.5 text-purple-400" />
                                    Feature Importance
                                </h3>
                                <ResponsiveContainer width="100%" height={220}>
                                    <BarChart data={featureData} layout="vertical">
                                        <XAxis type="number" stroke="#444" fontSize={10} />
                                        <YAxis dataKey="name" type="category" stroke="#444" width={100} fontSize={9} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', color: '#fff' }} formatter={(v: number) => `${v.toFixed(1)}%`} />
                                        <Bar dataKey="value" fill="#a855f7" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            <div className="bg-[#111118] border border-white/5 rounded-lg p-4">
                                <h3 className="text-xs font-medium text-zinc-400 mb-3 flex items-center gap-2">
                                    <PieChart className="w-3.5 h-3.5 text-orange-400" />
                                    Error Distribution (7d)
                                </h3>
                                <ResponsiveContainer width="100%" height={220}>
                                    <BarChart data={errorDist?.bins || []}>
                                        <XAxis dataKey="bin" stroke="#444" fontSize={8} angle={-20} textAnchor="end" height={50} />
                                        <YAxis stroke="#444" fontSize={10} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', color: '#fff' }} />
                                        <Bar dataKey="count" fill="#f97316" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                                {errorDist?.statistics && (
                                    <div className="grid grid-cols-4 gap-2 mt-2 text-xs">
                                        <div className="text-center"><span className="text-zinc-500">Mean</span><br />{errorDist.statistics.mean.toFixed(0)}s</div>
                                        <div className="text-center"><span className="text-zinc-500">Median</span><br />{errorDist.statistics.median.toFixed(0)}s</div>
                                        <div className="text-center"><span className="text-zinc-500">Std Dev</span><br />{errorDist.statistics.std_dev.toFixed(0)}s</div>
                                        <div className="text-center"><span className="text-zinc-500">Total</span><br />{errorDist.statistics.total.toLocaleString()}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {activeTab === 'diagnostics' && (
                    <>
                        {/* Temporal Stability */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                            <div className="bg-[#111118] border border-white/5 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-xs font-medium text-zinc-400 flex items-center gap-2">
                                        <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                                        Daily MAE (14 days)
                                    </h3>
                                    {temporal?.drift_detected && (
                                        <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded">Drift Detected</span>
                                    )}
                                </div>
                                <ResponsiveContainer width="100%" height={200}>
                                    <AreaChart data={temporal?.daily_metrics || []}>
                                        <defs>
                                            <linearGradient id="maeGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <XAxis dataKey="date" stroke="#444" fontSize={9} tickFormatter={d => d?.slice(5) || ''} />
                                        <YAxis stroke="#444" fontSize={10} tickFormatter={v => `${v}s`} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', color: '#fff' }} />
                                        <Area type="monotone" dataKey="mae" stroke="#818cf8" fill="url(#maeGrad)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>

                            <div className="bg-[#111118] border border-white/5 rounded-lg p-4">
                                <h3 className="text-xs font-medium text-zinc-400 mb-3 flex items-center gap-2">
                                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                    Daily Coverage (% within 2min)
                                </h3>
                                <ResponsiveContainer width="100%" height={200}>
                                    <LineChart data={temporal?.daily_metrics || []}>
                                        <XAxis dataKey="date" stroke="#444" fontSize={9} tickFormatter={d => d?.slice(5) || ''} />
                                        <YAxis stroke="#444" fontSize={10} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', color: '#fff' }} />
                                        <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="3 3" />
                                        <Line type="monotone" dataKey="within_2min_pct" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Model Health */}
                        <div className="bg-[#111118] border border-white/5 rounded-lg p-4">
                            <h3 className="text-xs font-medium text-zinc-400 mb-4 flex items-center gap-2">
                                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                                Model Health Check
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <HealthItem
                                    label="Model Version"
                                    value={modelStatus?.model_version || 'N/A'}
                                    status="info"
                                />
                                <HealthItem
                                    label="Model Age"
                                    value={`${modelStatus?.model_age_days || 0} days`}
                                    status={modelStatus?.model_age_days && modelStatus.model_age_days < 3 ? 'good' : modelStatus?.model_age_days && modelStatus.model_age_days < 7 ? 'warn' : 'bad'}
                                />
                                <HealthItem
                                    label="Data Freshness"
                                    value={`${modelStatus?.data_freshness_minutes || 0} min`}
                                    status={modelStatus?.data_freshness_minutes && modelStatus.data_freshness_minutes < 30 ? 'good' : 'warn'}
                                />
                                <HealthItem
                                    label="Overall Health"
                                    value={modelStatus?.health === 'healthy' ? 'Healthy' : 'Degraded'}
                                    status={modelStatus?.health === 'healthy' ? 'good' : 'bad'}
                                />
                            </div>
                        </div>
                    </>
                )}

                {activeTab === 'routes' && (
                    <div className="bg-[#111118] border border-white/5 rounded-lg p-4">
                        <h3 className="text-xs font-medium text-zinc-400 mb-4 flex items-center gap-2">
                            <Database className="w-3.5 h-3.5 text-purple-400" />
                            Route Performance
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="text-zinc-500 border-b border-white/10">
                                    <tr>
                                        <th className="text-left py-2 px-3">Route</th>
                                        <th className="text-right py-2 px-3">Predictions</th>
                                        <th className="text-right py-2 px-3">Avg Error</th>
                                        <th className="text-right py-2 px-3">Within 1min</th>
                                        <th className="text-right py-2 px-3">Within 2min</th>
                                        <th className="text-right py-2 px-3">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {routeStats.slice(0, 15).map(r => (
                                        <tr key={r.route} className="border-b border-white/5 hover:bg-white/5">
                                            <td className="py-2 px-3 font-mono text-indigo-400">{r.route}</td>
                                            <td className="py-2 px-3 text-right text-zinc-400">{r.predictions?.toLocaleString()}</td>
                                            <td className="py-2 px-3 text-right">
                                                <span className={r.avgError < 90 ? 'text-emerald-400' : r.avgError < 150 ? 'text-amber-400' : 'text-red-400'}>
                                                    {r.avgError?.toFixed(0)}s
                                                </span>
                                            </td>
                                            <td className="py-2 px-3 text-right">{r.within1min?.toFixed(0)}%</td>
                                            <td className="py-2 px-3 text-right">{(r.within2min || r.within1min * 1.3)?.toFixed(0)}%</td>
                                            <td className="py-2 px-3 text-right">
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] ${r.avgError < 90 ? 'bg-emerald-500/20 text-emerald-400' : r.avgError < 150 ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}`}>
                                                    {r.avgError < 90 ? 'GOOD' : r.avgError < 150 ? 'OK' : 'POOR'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

function StatCard({ label, value, sub, trend }: { label: string; value: string; sub: string; trend: 'good' | 'bad' | 'neutral' }) {
    const colors = { good: 'text-emerald-400', bad: 'text-red-400', neutral: 'text-zinc-400' };
    return (
        <div className="bg-[#111118] border border-white/5 rounded-lg p-3">
            <div className="text-[10px] text-zinc-500 uppercase mb-1">{label}</div>
            <div className={`text-xl font-bold ${colors[trend]}`}>{value}</div>
            <div className="text-[10px] text-zinc-600">{sub}</div>
        </div>
    );
}

function HealthItem({ label, value, status }: { label: string; value: string; status: 'good' | 'warn' | 'bad' | 'info' }) {
    const icons = {
        good: <CheckCircle className="w-4 h-4 text-emerald-400" />,
        warn: <AlertTriangle className="w-4 h-4 text-amber-400" />,
        bad: <AlertTriangle className="w-4 h-4 text-red-400" />,
        info: <Database className="w-4 h-4 text-blue-400" />
    };
    return (
        <div className="flex items-center gap-3 p-3 bg-black/20 rounded-lg">
            {icons[status]}
            <div>
                <div className="text-[10px] text-zinc-500">{label}</div>
                <div className="text-sm font-medium text-white">{value}</div>
            </div>
        </div>
    );
}
