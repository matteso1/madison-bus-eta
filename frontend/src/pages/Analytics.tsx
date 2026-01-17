import { useState, useEffect } from 'react';
import axios from 'axios';
import {
    Activity, RefreshCcw, Zap, Database,
    Shield, Clock, Target, Cpu
} from 'lucide-react';
import {
    XAxis, YAxis, Tooltip, ResponsiveContainer,
    ReferenceLine, BarChart, Bar, LineChart, Line, Area, AreaChart
} from 'recharts';

const BACKEND_URL = 'https://madison-bus-eta-production.up.railway.app';

interface RouteData {
    route: string;
    predictions: number;
    avgError: string;
    medianError: number;
    within1min: string;
    within2min: string;
}

// Custom tooltip component to ensure white text
const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-slate-900 border border-cyan-500/30 rounded-lg px-4 py-3 shadow-xl shadow-cyan-500/10">
                <p className="text-cyan-400 text-sm font-medium mb-1">{label}</p>
                {payload.map((entry: any, index: number) => (
                    <p key={index} className="text-white text-sm">
                        <span className="text-slate-400">{entry.name}:</span>{' '}
                        <span className="font-bold" style={{ color: entry.color }}>{entry.value?.toFixed?.(1) || entry.value}</span>
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

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
            <div className="min-h-screen bg-[#0a0b0f] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
                        <Cpu className="absolute inset-0 m-auto w-6 h-6 text-cyan-400" />
                    </div>
                    <span className="text-slate-500 font-mono text-sm tracking-wider">LOADING NEURAL METRICS...</span>
                </div>
            </div>
        );
    }

    const comparisonData = modelPerf ? [
        { name: 'API', value: modelPerf.api_baseline?.mae_seconds || 0, fill: '#f43f5e' },
        { name: 'ML', value: modelPerf.current_model?.mae_seconds || 0, fill: '#06b6d4' }
    ] : [];

    const coverageData = coverage?.coverage || [];
    const historyData = modelPerf?.training_history?.slice().reverse() || [];
    const distributionData = errorDist?.bins || [];

    const improvementPct = modelPerf?.current_model?.improvement_vs_baseline_pct || 0;

    return (
        <div className="min-h-screen bg-[#0a0b0f] text-white overflow-hidden">
            {/* Atmospheric background */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-[150px]" />
                <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-rose-500/5 rounded-full blur-[150px]" />
            </div>

            {/* Header */}
            <header className="relative border-b border-white/5 bg-[#0a0b0f]/80 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-[1600px] mx-auto px-8 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-5">
                        <div className="relative">
                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
                                <Activity className="w-6 h-6 text-white" />
                            </div>
                            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-[#0a0b0f] flex items-center justify-center">
                                <span className="text-[8px] font-bold">✓</span>
                            </div>
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight">
                                <span className="text-white">ML</span>
                                <span className="text-cyan-400">Analytics</span>
                            </h1>
                            <p className="text-xs text-slate-600 font-mono tracking-widest">MADISON METRO • ETA PREDICTION</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        {/* Tabs - brutalist style */}
                        <div className="flex border border-white/10 rounded-none overflow-hidden">
                            {(['overview', 'diagnostics', 'routes'] as const).map((tab, i) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`px-6 py-3 text-sm font-mono uppercase tracking-wider transition-all relative ${activeTab === tab
                                        ? 'bg-cyan-500 text-black font-bold'
                                        : 'text-slate-500 hover:text-white hover:bg-white/5'
                                        } ${i > 0 ? 'border-l border-white/10' : ''}`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        {/* Live indicator */}
                        <div className="flex items-center gap-3 px-4 py-2">
                            <div className="relative flex items-center gap-2">
                                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                                <span className="text-xs font-mono text-slate-500">{lastUpdated.toLocaleTimeString()}</span>
                            </div>
                            <button onClick={fetchData} className="p-2 hover:bg-white/5 transition-colors border border-white/10">
                                <RefreshCcw className="w-4 h-4 text-slate-500 hover:text-cyan-400 transition-colors" />
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="relative max-w-[1600px] mx-auto px-8 py-10">
                {activeTab === 'overview' && (
                    <div className="space-y-8">
                        {/* Hero improvement metric */}
                        <div className="relative overflow-hidden border border-cyan-500/20 bg-gradient-to-r from-cyan-950/30 to-transparent p-8">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 blur-3xl" />
                            <div className="relative flex items-center justify-between">
                                <div>
                                    <p className="text-cyan-400 font-mono text-sm tracking-widest mb-2">MODEL IMPROVEMENT</p>
                                    <div className="flex items-baseline gap-3">
                                        <span className="text-7xl font-black tracking-tight text-white">{improvementPct.toFixed(0)}</span>
                                        <span className="text-4xl font-bold text-cyan-400">%</span>
                                    </div>
                                    <p className="text-slate-500 mt-2">Better than raw API predictions</p>
                                </div>
                                <div className="grid grid-cols-2 gap-8">
                                    <MetricBox
                                        label="ML MODEL"
                                        value={`${modelPerf?.current_model?.mae_seconds?.toFixed(0) || '--'}s`}
                                        sub="MAE"
                                        accent="cyan"
                                    />
                                    <MetricBox
                                        label="API BASELINE"
                                        value={`${modelPerf?.api_baseline?.mae_seconds?.toFixed(0) || '--'}s`}
                                        sub="MAE"
                                        accent="rose"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Quick stats row */}
                        <div className="grid grid-cols-4 gap-4">
                            <QuickStat icon={<Clock />} label="Model Age" value={`${modelStatus?.model_age_days || 0}d`} status={modelStatus?.staleness_status === 'fresh' ? 'good' : 'warn'} />
                            <QuickStat icon={<Database />} label="Predictions Today" value={modelStatus?.predictions_today?.toLocaleString() || '--'} />
                            <QuickStat icon={<Target />} label="Within 2min" value={`${coverageData.find((c: any) => c.threshold === '2min')?.percentage?.toFixed(0) || '--'}%`} status={coverage?.meets_target ? 'good' : 'warn'} />
                            <QuickStat icon={<Zap />} label="Data Fresh" value={`${modelStatus?.data_freshness_minutes || '--'}m`} status={(modelStatus?.data_freshness_minutes || 999) < 30 ? 'good' : 'warn'} />
                        </div>

                        {/* Charts grid */}
                        <div className="grid grid-cols-12 gap-6">
                            {/* MAE Comparison */}
                            <div className="col-span-4 border border-white/10 bg-white/[0.02] p-6">
                                <h3 className="text-xs font-mono text-slate-500 tracking-widest mb-6">MAE COMPARISON</h3>
                                <ResponsiveContainer width="100%" height={180}>
                                    <BarChart data={comparisonData} layout="vertical" margin={{ left: 0 }}>
                                        <XAxis type="number" stroke="#334155" tickFormatter={v => `${v}s`} fontSize={10} axisLine={false} />
                                        <YAxis dataKey="name" type="category" stroke="#334155" width={40} fontSize={11} axisLine={false} tickLine={false} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Bar dataKey="value" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Coverage */}
                            <div className="col-span-4 border border-white/10 bg-white/[0.02] p-6">
                                <h3 className="text-xs font-mono text-slate-500 tracking-widest mb-6">PREDICTION COVERAGE</h3>
                                <ResponsiveContainer width="100%" height={180}>
                                    <BarChart data={coverageData}>
                                        <XAxis dataKey="threshold" stroke="#334155" fontSize={10} axisLine={false} tickLine={false} />
                                        <YAxis stroke="#334155" fontSize={10} domain={[0, 100]} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Bar dataKey="percentage" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Training History */}
                            <div className="col-span-4 border border-white/10 bg-white/[0.02] p-6">
                                <h3 className="text-xs font-mono text-slate-500 tracking-widest mb-6">TRAINING EVOLUTION</h3>
                                <ResponsiveContainer width="100%" height={180}>
                                    <LineChart data={historyData}>
                                        <XAxis dataKey="version" stroke="#334155" fontSize={9} axisLine={false} tickLine={false} />
                                        <YAxis stroke="#334155" fontSize={10} tickFormatter={v => `${v}s`} axisLine={false} tickLine={false} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Line type="monotone" dataKey="mae" stroke="#a855f7" strokeWidth={2} dot={{ fill: '#a855f7', r: 4 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Error Distribution */}
                            <div className="col-span-6 border border-white/10 bg-white/[0.02] p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-xs font-mono text-slate-500 tracking-widest">ERROR DISTRIBUTION</h3>
                                    {errorDist?.statistics && (
                                        <div className="flex gap-6 text-xs">
                                            <span className="text-slate-500">μ = <span className="text-white font-bold">{errorDist.statistics.mean?.toFixed(0)}s</span></span>
                                            <span className="text-slate-500">σ = <span className="text-white font-bold">{errorDist.statistics.std_dev?.toFixed(0)}s</span></span>
                                        </div>
                                    )}
                                </div>
                                <ResponsiveContainer width="100%" height={200}>
                                    <BarChart data={distributionData}>
                                        <XAxis dataKey="bin" stroke="#334155" fontSize={8} angle={-15} textAnchor="end" height={50} axisLine={false} tickLine={false} />
                                        <YAxis stroke="#334155" fontSize={10} axisLine={false} tickLine={false} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Bar dataKey="count" fill="#f97316" radius={[2, 2, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Top Routes */}
                            <div className="col-span-6 border border-white/10 bg-white/[0.02] p-6">
                                <h3 className="text-xs font-mono text-slate-500 tracking-widest mb-6">TOP ROUTES</h3>
                                <div className="space-y-3">
                                    {routeStats.slice(0, 6).map((r, i) => {
                                        const avgError = parseFloat(r.avgError);
                                        const color = avgError < 100 ? '#06b6d4' : avgError < 200 ? '#f59e0b' : '#f43f5e';
                                        const width = Math.min((avgError / 350) * 100, 100);
                                        return (
                                            <div key={r.route} className="flex items-center gap-4">
                                                <span className="w-6 text-xs text-slate-600 font-mono">{String(i + 1).padStart(2, '0')}</span>
                                                <span className="w-10 font-bold text-cyan-400 font-mono">{r.route}</span>
                                                <div className="flex-1 h-6 bg-white/5 relative overflow-hidden">
                                                    <div className="h-full transition-all" style={{ width: `${width}%`, backgroundColor: color }} />
                                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-mono text-white">{avgError.toFixed(0)}s</span>
                                                </div>
                                                <span className="w-20 text-right text-xs text-slate-500">{parseFloat(r.within2min).toFixed(0)}% &lt;2m</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'diagnostics' && (
                    <div className="space-y-8">
                        <div className="grid grid-cols-2 gap-6">
                            {/* Temporal MAE */}
                            <div className="border border-white/10 bg-white/[0.02] p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-xs font-mono text-slate-500 tracking-widest">DAILY MAE · 14 DAYS</h3>
                                    {temporal?.drift_detected && (
                                        <span className="px-2 py-1 bg-rose-500/20 text-rose-400 text-xs font-mono">DRIFT DETECTED</span>
                                    )}
                                </div>
                                <ResponsiveContainer width="100%" height={240}>
                                    <AreaChart data={temporal?.daily_metrics || []}>
                                        <defs>
                                            <linearGradient id="maeGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <XAxis dataKey="date" stroke="#334155" fontSize={9} tickFormatter={d => d?.slice(5) || ''} axisLine={false} tickLine={false} />
                                        <YAxis stroke="#334155" fontSize={10} tickFormatter={v => `${v}s`} axisLine={false} tickLine={false} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Area type="monotone" dataKey="mae" stroke="#a855f7" strokeWidth={2} fill="url(#maeGrad)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Coverage trend */}
                            <div className="border border-white/10 bg-white/[0.02] p-6">
                                <h3 className="text-xs font-mono text-slate-500 tracking-widest mb-6">DAILY COVERAGE · % WITHIN 2MIN</h3>
                                <ResponsiveContainer width="100%" height={240}>
                                    <LineChart data={temporal?.daily_metrics || []}>
                                        <XAxis dataKey="date" stroke="#334155" fontSize={9} tickFormatter={d => d?.slice(5) || ''} axisLine={false} tickLine={false} />
                                        <YAxis stroke="#334155" fontSize={10} domain={[0, 100]} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <ReferenceLine y={80} stroke="#06b6d4" strokeDasharray="8 4" label={{ value: 'TARGET', fill: '#06b6d4', fontSize: 9, position: 'right' }} />
                                        <Line type="monotone" dataKey="within_2min_pct" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Health grid */}
                        <div className="border border-white/10 bg-white/[0.02] p-6">
                            <h3 className="text-xs font-mono text-slate-500 tracking-widest mb-6">MODEL HEALTH CHECK</h3>
                            <div className="grid grid-cols-4 gap-4">
                                <HealthCard label="VERSION" value={modelStatus?.model_version || 'N/A'} icon={<Cpu className="w-5 h-5" />} />
                                <HealthCard label="AGE" value={`${modelStatus?.model_age_days || 0} days`} status={modelStatus?.model_age_days < 3 ? 'good' : 'warn'} icon={<Clock className="w-5 h-5" />} />
                                <HealthCard label="DATA FRESH" value={`${modelStatus?.data_freshness_minutes || 0} min`} status={(modelStatus?.data_freshness_minutes || 0) < 30 ? 'good' : 'warn'} icon={<RefreshCcw className="w-5 h-5" />} />
                                <HealthCard label="STATUS" value={modelStatus?.health === 'healthy' ? 'HEALTHY' : 'DEGRADED'} status={modelStatus?.health === 'healthy' ? 'good' : 'bad'} icon={<Shield className="w-5 h-5" />} />
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'routes' && (
                    <div className="border border-white/10 bg-white/[0.02]">
                        <div className="border-b border-white/10 px-6 py-4">
                            <h3 className="text-xs font-mono text-slate-500 tracking-widest">ROUTE PERFORMANCE ANALYSIS</h3>
                        </div>
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-white/10 text-xs font-mono text-slate-500">
                                    <th className="text-left py-4 px-6">ROUTE</th>
                                    <th className="text-right py-4 px-6">PREDICTIONS</th>
                                    <th className="text-right py-4 px-6">AVG ERROR</th>
                                    <th className="text-right py-4 px-6">MEDIAN</th>
                                    <th className="text-right py-4 px-6">WITHIN 1MIN</th>
                                    <th className="text-right py-4 px-6">WITHIN 2MIN</th>
                                    <th className="text-right py-4 px-6">STATUS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {routeStats.map((r) => {
                                    const avgError = parseFloat(r.avgError);
                                    const status = avgError < 100 ? 'good' : avgError < 200 ? 'warn' : 'bad';
                                    return (
                                        <tr key={r.route} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                            <td className="py-4 px-6 font-bold font-mono text-cyan-400">{r.route}</td>
                                            <td className="py-4 px-6 text-right text-slate-400">{r.predictions?.toLocaleString()}</td>
                                            <td className={`py-4 px-6 text-right font-bold ${status === 'good' ? 'text-cyan-400' : status === 'warn' ? 'text-amber-400' : 'text-rose-400'}`}>
                                                {avgError.toFixed(0)}s
                                            </td>
                                            <td className="py-4 px-6 text-right text-slate-500">{r.medianError}s</td>
                                            <td className="py-4 px-6 text-right text-slate-400">{parseFloat(r.within1min).toFixed(0)}%</td>
                                            <td className="py-4 px-6 text-right text-slate-400">{parseFloat(r.within2min).toFixed(0)}%</td>
                                            <td className="py-4 px-6 text-right">
                                                <span className={`inline-flex px-3 py-1 text-xs font-mono font-bold ${status === 'good' ? 'bg-cyan-500/20 text-cyan-400' :
                                                    status === 'warn' ? 'bg-amber-500/20 text-amber-400' :
                                                        'bg-rose-500/20 text-rose-400'
                                                    }`}>
                                                    {status === 'good' ? 'GOOD' : status === 'warn' ? 'OK' : 'POOR'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </main>
        </div>
    );
}

// Components
function MetricBox({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: 'cyan' | 'rose' }) {
    const colors = {
        cyan: 'border-cyan-500/30 bg-cyan-950/30',
        rose: 'border-rose-500/30 bg-rose-950/30'
    };
    const textColors = { cyan: 'text-cyan-400', rose: 'text-rose-400' };

    return (
        <div className={`border ${colors[accent]} px-6 py-4`}>
            <p className={`text-xs font-mono ${textColors[accent]} tracking-widest mb-1`}>{label}</p>
            <p className="text-3xl font-black text-white">{value}</p>
            <p className="text-xs text-slate-500">{sub}</p>
        </div>
    );
}

function QuickStat({ icon, label, value, status }: { icon: React.ReactNode; label: string; value: string; status?: 'good' | 'warn' }) {
    return (
        <div className="border border-white/10 bg-white/[0.02] p-5 flex items-center gap-4">
            <div className={`w-10 h-10 flex items-center justify-center ${status === 'good' ? 'text-cyan-400' : status === 'warn' ? 'text-amber-400' : 'text-slate-600'}`}>
                {icon}
            </div>
            <div>
                <p className="text-xs font-mono text-slate-500 tracking-wide">{label}</p>
                <p className="text-xl font-bold text-white">{value}</p>
            </div>
        </div>
    );
}

function HealthCard({ label, value, status, icon }: { label: string; value: string; status?: 'good' | 'warn' | 'bad'; icon: React.ReactNode }) {
    const colors = {
        good: 'border-cyan-500/30 bg-cyan-950/20 text-cyan-400',
        warn: 'border-amber-500/30 bg-amber-950/20 text-amber-400',
        bad: 'border-rose-500/30 bg-rose-950/20 text-rose-400'
    };
    const color = status ? colors[status] : 'border-white/10 bg-white/[0.02] text-slate-400';

    return (
        <div className={`border ${color} p-5 flex items-center gap-4`}>
            <div className="opacity-60">{icon}</div>
            <div>
                <p className="text-xs font-mono text-slate-500 tracking-wide">{label}</p>
                <p className="text-lg font-bold text-white">{value}</p>
            </div>
        </div>
    );
}
