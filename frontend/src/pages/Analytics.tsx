import { useState, useEffect } from 'react';
import axios from 'axios';
import {
    Activity, RefreshCcw, TrendingUp, Zap, Database,
    Shield, Clock, CheckCircle, BarChart3, Target
} from 'lucide-react';
import {
    XAxis, YAxis, Tooltip, ResponsiveContainer,
    ReferenceLine, BarChart, Bar, LineChart, Line, Area, AreaChart
} from 'recharts';

const BACKEND_URL = 'https://madison-bus-eta-production.up.railway.app';

// Types
interface RouteData {
    route: string;
    predictions: number;
    avgError: string;
    medianError: number;
    within1min: string;
    within2min: string;
}

export default function AnalyticsPage() {
    const [modelPerf, setModelPerf] = useState<any>(null);
    const [modelStatus, setModelStatus] = useState<any>(null);
    const [errorDist, setErrorDist] = useState<any>(null);
    const [temporal, setTemporal] = useState<any>(null);
    const [coverage, setCoverage] = useState<any>(null);
    const [routeStats, setRouteStats] = useState<RouteData[]>([]);
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
            <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
                <div className="flex items-center gap-3 text-slate-400">
                    <RefreshCcw className="w-5 h-5 animate-spin" />
                    <span className="font-medium">Loading Analytics...</span>
                </div>
            </div>
        );
    }

    const comparisonData = modelPerf ? [
        { name: 'API Baseline', value: modelPerf.api_baseline?.mae_seconds || 0, fill: '#ef4444' },
        { name: 'ML Model', value: modelPerf.current_model?.mae_seconds || 0, fill: '#10b981' }
    ] : [];

    const coverageData = coverage?.coverage || [];
    const historyData = modelPerf?.training_history?.slice().reverse() || [];
    const distributionData = errorDist?.bins || [];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
            {/* Header */}
            <header className="border-b border-white/10 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
                            <Activity className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold">ML Analytics</h1>
                            <p className="text-xs text-slate-500">Madison Metro ETA Prediction</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Tabs */}
                        <div className="flex rounded-xl bg-slate-800/50 p-1 gap-1">
                            {(['overview', 'diagnostics', 'routes'] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === tab
                                        ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg'
                                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                                        }`}
                                >
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            ))}
                        </div>

                        {/* Status */}
                        <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-800/30 border border-white/5">
                            <div className={`w-2 h-2 rounded-full ${modelStatus?.health === 'healthy' ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50' : 'bg-amber-500'}`} />
                            <span className="text-sm text-slate-400">{lastUpdated.toLocaleTimeString()}</span>
                            <button onClick={fetchData} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                                <RefreshCcw className="w-4 h-4 text-slate-400" />
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                {activeTab === 'overview' && (
                    <div className="space-y-6">
                        {/* Hero Stats */}
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                            <StatCard
                                icon={<Target className="w-5 h-5" />}
                                label="Model MAE"
                                value={`${modelPerf?.current_model?.mae_seconds?.toFixed(0) || '--'}s`}
                                change={`${modelPerf?.current_model?.improvement_vs_baseline_pct?.toFixed(0) || 0}% better`}
                                positive
                            />
                            <StatCard
                                icon={<Zap className="w-5 h-5" />}
                                label="API Baseline"
                                value={`${modelPerf?.api_baseline?.mae_seconds?.toFixed(0) || '--'}s`}
                                change="Raw API error"
                            />
                            <StatCard
                                icon={<Clock className="w-5 h-5" />}
                                label="Model Age"
                                value={`${modelStatus?.model_age_days || 0} days`}
                                change={modelStatus?.staleness_status === 'fresh' ? 'Fresh' : 'Needs update'}
                                positive={modelStatus?.staleness_status === 'fresh'}
                            />
                            <StatCard
                                icon={<Database className="w-5 h-5" />}
                                label="Today"
                                value={modelStatus?.predictions_today?.toLocaleString() || '--'}
                                change="Predictions"
                            />
                            <StatCard
                                icon={<CheckCircle className="w-5 h-5" />}
                                label="Within 2min"
                                value={`${coverageData.find((c: any) => c.threshold === '2min')?.percentage?.toFixed(0) || '--'}%`}
                                change={coverage?.meets_target ? 'Target met' : 'Below 80%'}
                                positive={coverage?.meets_target}
                            />
                            <StatCard
                                icon={<Shield className="w-5 h-5" />}
                                label="Data Fresh"
                                value={`${modelStatus?.data_freshness_minutes || '--'}m`}
                                change="Last outcome"
                                positive={(modelStatus?.data_freshness_minutes || 999) < 30}
                            />
                        </div>

                        {/* Charts Row 1 */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <ChartCard title="MAE Comparison" icon={<BarChart3 className="w-4 h-4" />}>
                                <ResponsiveContainer width="100%" height={180}>
                                    <BarChart data={comparisonData} layout="vertical" margin={{ left: 0 }}>
                                        <XAxis type="number" stroke="#475569" tickFormatter={v => `${v}s`} fontSize={11} />
                                        <YAxis dataKey="name" type="category" stroke="#475569" width={80} fontSize={11} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }} />
                                        <Bar dataKey="value" radius={[0, 6, 6, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </ChartCard>

                            <ChartCard title="Prediction Coverage" icon={<Target className="w-4 h-4" />}>
                                <ResponsiveContainer width="100%" height={180}>
                                    <BarChart data={coverageData}>
                                        <XAxis dataKey="threshold" stroke="#475569" fontSize={11} />
                                        <YAxis stroke="#475569" fontSize={11} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }} />
                                        <Bar dataKey="percentage" fill="#10b981" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </ChartCard>

                            <ChartCard title="Training History" icon={<TrendingUp className="w-4 h-4" />}>
                                <ResponsiveContainer width="100%" height={180}>
                                    <LineChart data={historyData}>
                                        <XAxis dataKey="version" stroke="#475569" fontSize={10} />
                                        <YAxis stroke="#475569" fontSize={11} tickFormatter={v => `${v}s`} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }} />
                                        <Line type="monotone" dataKey="mae" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6', r: 4 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </ChartCard>
                        </div>

                        {/* Charts Row 2 */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <ChartCard title="Error Distribution (7 days)" icon={<BarChart3 className="w-4 h-4" />}>
                                <ResponsiveContainer width="100%" height={200}>
                                    <BarChart data={distributionData}>
                                        <XAxis dataKey="bin" stroke="#475569" fontSize={9} angle={-15} textAnchor="end" height={60} />
                                        <YAxis stroke="#475569" fontSize={11} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }} />
                                        <Bar dataKey="count" fill="#f97316" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                                {errorDist?.statistics && (
                                    <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-white/10">
                                        <MiniStat label="Mean" value={`${errorDist.statistics.mean?.toFixed(0)}s`} />
                                        <MiniStat label="Median" value={`${errorDist.statistics.median?.toFixed(0)}s`} />
                                        <MiniStat label="Std Dev" value={`${errorDist.statistics.std_dev?.toFixed(0)}s`} />
                                        <MiniStat label="Total" value={errorDist.statistics.total?.toLocaleString()} />
                                    </div>
                                )}
                            </ChartCard>

                            <ChartCard title="Top Routes by Volume" icon={<Database className="w-4 h-4" />}>
                                <div className="space-y-2 max-h-[240px] overflow-y-auto pr-2">
                                    {routeStats.slice(0, 8).map((r, i) => (
                                        <RouteBar key={r.route} rank={i + 1} route={r} />
                                    ))}
                                </div>
                            </ChartCard>
                        </div>
                    </div>
                )}

                {activeTab === 'diagnostics' && (
                    <div className="space-y-6">
                        {/* Temporal Charts */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <ChartCard
                                title="Daily MAE (14 days)"
                                icon={<TrendingUp className="w-4 h-4" />}
                                badge={temporal?.drift_detected ? { text: 'Drift Detected', color: 'red' } : undefined}
                            >
                                <ResponsiveContainer width="100%" height={220}>
                                    <AreaChart data={temporal?.daily_metrics || []}>
                                        <defs>
                                            <linearGradient id="maeGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={d => d?.slice(5) || ''} />
                                        <YAxis stroke="#475569" fontSize={11} tickFormatter={v => `${v}s`} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }} />
                                        <Area type="monotone" dataKey="mae" stroke="#8b5cf6" strokeWidth={2} fill="url(#maeGradient)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </ChartCard>

                            <ChartCard title="Daily Coverage (% within 2min)" icon={<CheckCircle className="w-4 h-4" />}>
                                <ResponsiveContainer width="100%" height={220}>
                                    <LineChart data={temporal?.daily_metrics || []}>
                                        <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={d => d?.slice(5) || ''} />
                                        <YAxis stroke="#475569" fontSize={11} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }} />
                                        <ReferenceLine y={80} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Target', fill: '#10b981', fontSize: 10 }} />
                                        <Line type="monotone" dataKey="within_2min_pct" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </ChartCard>
                        </div>

                        {/* Health Check */}
                        <ChartCard title="Model Health Check" icon={<Shield className="w-4 h-4" />}>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <HealthCard icon={<Database />} label="Model Version" value={modelStatus?.model_version || 'N/A'} status="info" />
                                <HealthCard icon={<Clock />} label="Model Age" value={`${modelStatus?.model_age_days || 0} days`} status={modelStatus?.model_age_days < 3 ? 'good' : modelStatus?.model_age_days < 7 ? 'warn' : 'bad'} />
                                <HealthCard icon={<RefreshCcw />} label="Data Freshness" value={`${modelStatus?.data_freshness_minutes || 0} min`} status={(modelStatus?.data_freshness_minutes || 0) < 30 ? 'good' : 'warn'} />
                                <HealthCard icon={<Shield />} label="Overall Health" value={modelStatus?.health === 'healthy' ? 'Healthy' : 'Degraded'} status={modelStatus?.health === 'healthy' ? 'good' : 'bad'} />
                            </div>
                        </ChartCard>
                    </div>
                )}

                {activeTab === 'routes' && (
                    <ChartCard title="Route Performance Analysis" icon={<Database className="w-4 h-4" />}>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-white/10">
                                        <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Route</th>
                                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Predictions</th>
                                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Avg Error</th>
                                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Median</th>
                                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Within 1min</th>
                                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Within 2min</th>
                                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {routeStats.map((r) => {
                                        const avgError = parseFloat(r.avgError);
                                        const within1 = parseFloat(r.within1min);
                                        const within2 = parseFloat(r.within2min);
                                        const status = avgError < 100 ? 'good' : avgError < 200 ? 'warn' : 'bad';

                                        return (
                                            <tr key={r.route} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                <td className="py-3 px-4">
                                                    <span className="font-mono font-bold text-violet-400">{r.route}</span>
                                                </td>
                                                <td className="py-3 px-4 text-right text-slate-300">{r.predictions?.toLocaleString()}</td>
                                                <td className="py-3 px-4 text-right">
                                                    <span className={`font-medium ${status === 'good' ? 'text-emerald-400' : status === 'warn' ? 'text-amber-400' : 'text-red-400'}`}>
                                                        {avgError.toFixed(0)}s
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 text-right text-slate-400">{r.medianError}s</td>
                                                <td className="py-3 px-4 text-right text-slate-300">{within1.toFixed(0)}%</td>
                                                <td className="py-3 px-4 text-right text-slate-300">{within2.toFixed(0)}%</td>
                                                <td className="py-3 px-4 text-right">
                                                    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium ${status === 'good' ? 'bg-emerald-500/20 text-emerald-400' :
                                                        status === 'warn' ? 'bg-amber-500/20 text-amber-400' :
                                                            'bg-red-500/20 text-red-400'
                                                        }`}>
                                                        {status === 'good' ? 'Good' : status === 'warn' ? 'OK' : 'Poor'}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </ChartCard>
                )}
            </main>
        </div>
    );
}

// Components
function StatCard({ icon, label, value, change, positive }: { icon: React.ReactNode; label: string; value: string; change: string; positive?: boolean }) {
    return (
        <div className="rounded-xl bg-slate-800/50 border border-white/5 p-4 hover:border-white/10 transition-colors">
            <div className="flex items-center gap-2 mb-2 text-slate-400">
                {icon}
                <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
            </div>
            <div className="text-2xl font-bold text-white mb-1">{value}</div>
            <div className={`text-xs ${positive ? 'text-emerald-400' : positive === false ? 'text-red-400' : 'text-slate-500'}`}>
                {change}
            </div>
        </div>
    );
}

function ChartCard({ title, icon, children, badge }: { title: string; icon: React.ReactNode; children: React.ReactNode; badge?: { text: string; color: string } }) {
    return (
        <div className="rounded-xl bg-slate-800/50 border border-white/5 p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-slate-300">
                    <span className="text-violet-400">{icon}</span>
                    <span className="font-medium">{title}</span>
                </div>
                {badge && (
                    <span className={`text-xs px-2 py-1 rounded-md ${badge.color === 'red' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                        {badge.text}
                    </span>
                )}
            </div>
            {children}
        </div>
    );
}

function MiniStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="text-center">
            <div className="text-xs text-slate-500 mb-1">{label}</div>
            <div className="text-sm font-semibold text-white">{value}</div>
        </div>
    );
}

function RouteBar({ rank, route }: { rank: number; route: RouteData }) {
    const avgError = parseFloat(route.avgError);
    const maxError = 350;
    const width = Math.min((avgError / maxError) * 100, 100);
    const color = avgError < 100 ? 'bg-emerald-500' : avgError < 200 ? 'bg-amber-500' : 'bg-red-500';

    return (
        <div className="flex items-center gap-3">
            <span className="w-5 text-xs text-slate-500 text-right">{rank}</span>
            <span className="w-8 font-mono font-bold text-violet-400">{route.route}</span>
            <div className="flex-1 h-6 bg-slate-700/50 rounded-md overflow-hidden relative">
                <div className={`h-full ${color} rounded-md transition-all`} style={{ width: `${width}%` }} />
                <span className="absolute inset-0 flex items-center justify-end pr-2 text-xs text-white font-medium">
                    {avgError.toFixed(0)}s
                </span>
            </div>
            <span className="w-16 text-xs text-slate-400 text-right">{parseFloat(route.within2min).toFixed(0)}% &lt;2m</span>
        </div>
    );
}

function HealthCard({ icon, label, value, status }: { icon: React.ReactNode; label: string; value: string; status: 'good' | 'warn' | 'bad' | 'info' }) {
    const colors = {
        good: 'border-emerald-500/30 bg-emerald-500/10',
        warn: 'border-amber-500/30 bg-amber-500/10',
        bad: 'border-red-500/30 bg-red-500/10',
        info: 'border-blue-500/30 bg-blue-500/10'
    };
    const iconColors = {
        good: 'text-emerald-400',
        warn: 'text-amber-400',
        bad: 'text-red-400',
        info: 'text-blue-400'
    };

    return (
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${colors[status]}`}>
            <div className={iconColors[status]}>{icon}</div>
            <div>
                <div className="text-xs text-slate-500">{label}</div>
                <div className="text-sm font-semibold text-white">{value}</div>
            </div>
        </div>
    );
}
