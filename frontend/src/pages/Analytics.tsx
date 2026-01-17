import { useState, useEffect } from 'react';
import axios from 'axios';
import {
    Activity, RefreshCcw, Target, BarChart3, TrendingUp
} from 'lucide-react';
import {
    XAxis, YAxis, Tooltip, ResponsiveContainer,
    ReferenceLine, BarChart, Bar, LineChart, Line, Area, AreaChart
} from 'recharts';

const BACKEND_URL = 'https://madison-bus-eta-production.up.railway.app';

interface RouteData {
    route: string;
    predictions: number;
    avgError: string; // comes as string from API
    medianError: number;
    within1min: string;
    within2min: string;
}

// Clean, high-contrast tooltip for readability
const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white text-slate-900 border border-slate-200 rounded p-2 shadow-lg text-xs">
                <p className="font-bold mb-1">{label}</p>
                {payload.map((entry: any, index: number) => (
                    <p key={index} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                        <span className="text-slate-600">{entry.name}:</span>
                        <span className="font-mono font-bold">{entry.value?.toFixed?.(1) || entry.value}</span>
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
            <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-slate-400">
                <RefreshCcw className="w-5 h-5 mr-3 animate-spin" />
                <span>Loading Analytics...</span>
            </div>
        );
    }

    // Data prep
    const comparisonData = modelPerf ? [
        { name: 'API Baseline', value: modelPerf.api_baseline?.mae_seconds || 0, fill: '#ef4444' }, // Red
        { name: 'ML Model', value: modelPerf.current_model?.mae_seconds || 0, fill: '#10b981' }      // Green
    ] : [];

    const coverageData = coverage?.coverage || [];
    const historyData = modelPerf?.training_history?.slice().reverse() || [];
    const distributionData = errorDist?.bins || [];

    return (
        <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans">
            {/* Simple Header */}
            <div className="border-b border-slate-800 bg-[#0f172a] sticky top-0 z-30">
                <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Activity className="w-5 h-5 text-indigo-400" />
                        <h1 className="font-semibold text-white">ML Analytics</h1>
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">Phase 3</span>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Clean Tabs */}
                        <div className="flex rounded bg-slate-800/50 p-1">
                            {['overview', 'diagnostics', 'routes'].map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab as any)}
                                    className={`px-3 py-1 text-xs font-medium rounded transition-colors uppercase tracking-wide ${activeTab === tab
                                        ? 'bg-indigo-600 text-white'
                                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                        }`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        <div className="text-xs text-slate-500 font-mono">
                            {lastUpdated.toLocaleTimeString()}
                        </div>
                    </div>
                </div>
            </div>

            <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">

                {/* 1. KEY METRICS ROW */}
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                    <StatBox
                        label="Model MAE"
                        value={`${modelPerf?.current_model?.mae_seconds?.toFixed(0) || '-'}s`}
                        sub={`${modelPerf?.current_model?.improvement_vs_baseline_pct?.toFixed(0)}% better`}
                        good={true}
                    />
                    <StatBox
                        label="API Baseline"
                        value={`${modelPerf?.api_baseline?.mae_seconds?.toFixed(0) || '-'}s`}
                        sub="Raw error"
                        neutral={true}
                    />
                    <StatBox
                        label="Coverage < 2min"
                        value={`${coverageData.find((c: any) => c.threshold === '2min')?.percentage?.toFixed(0) || '-'}%`}
                        sub={coverage?.meets_target ? 'Target met' : 'Below target'}
                        good={coverage?.meets_target}
                        bad={!coverage?.meets_target}
                    />
                    <StatBox
                        label="Model Age"
                        value={`${modelStatus?.model_age_days || 0}d`}
                        sub={modelStatus?.staleness_status || '-'}
                        good={modelStatus?.staleness_status === 'fresh'}
                    />
                    <StatBox
                        label="Data Freshness"
                        value={`${modelStatus?.data_freshness_minutes || 0}m`}
                        sub="Last prediction"
                        good={(modelStatus?.data_freshness_minutes || 99) < 30}
                    />
                    <StatBox
                        label="Today's Vol"
                        value={modelStatus?.predictions_today?.toLocaleString() || '-'}
                        sub="Total Predictions"
                        neutral={true}
                    />
                </div>

                {/* 2. OVERVIEW TAB */}
                {activeTab === 'overview' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* MAE Chart */}
                        <div className="bg-slate-900 border border-slate-800 rounded p-4">
                            <h3 className="text-xs text-slate-400 font-bold uppercase mb-4 flex items-center gap-2">
                                <BarChart3 className="w-4 h-4" /> Performance Comparison
                            </h3>
                            <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={comparisonData} layout="vertical">
                                    <XAxis type="number" stroke="#475569" fontSize={10} tickFormatter={v => `${v}s`} />
                                    <YAxis dataKey="name" type="category" stroke="#94a3b8" width={80} fontSize={11} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={30} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Coverage Chart */}
                        <div className="bg-slate-900 border border-slate-800 rounded p-4">
                            <h3 className="text-xs text-slate-400 font-bold uppercase mb-4 flex items-center gap-2">
                                <Target className="w-4 h-4" /> Prediction Coverage
                            </h3>
                            <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={coverageData}>
                                    <XAxis dataKey="threshold" stroke="#475569" fontSize={10} />
                                    <YAxis stroke="#475569" fontSize={10} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Bar dataKey="percentage" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>

                        {/* History Chart */}
                        <div className="bg-slate-900 border border-slate-800 rounded p-4">
                            <h3 className="text-xs text-slate-400 font-bold uppercase mb-4 flex items-center gap-2">
                                <TrendingUp className="w-4 h-4" /> Training History
                            </h3>
                            <ResponsiveContainer width="100%" height={200}>
                                <LineChart data={historyData}>
                                    <XAxis dataKey="version" stroke="#475569" fontSize={10} />
                                    <YAxis stroke="#475569" fontSize={10} tickFormatter={v => `${v}s`} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Line type="monotone" dataKey="mae" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Error Distribution */}
                        <div className="col-span-1 md:col-span-2 lg:col-span-3 bg-slate-900 border border-slate-800 rounded p-4">
                            <h3 className="text-xs text-slate-400 font-bold uppercase mb-4 flex items-center gap-2">
                                <Activity className="w-4 h-4" /> Error Distribution (7 Days)
                            </h3>
                            <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={distributionData}>
                                    <XAxis dataKey="bin" stroke="#475569" fontSize={10} />
                                    <YAxis stroke="#475569" fontSize={10} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                            {/* Distribution Stats */}
                            {errorDist?.statistics && (
                                <div className="flex gap-8 mt-4 pt-4 border-t border-slate-800 justify-center">
                                    <StatInline label="Mean" value={`${errorDist.statistics.mean?.toFixed(0)}s`} />
                                    <StatInline label="Median" value={`${errorDist.statistics.median?.toFixed(0)}s`} />
                                    <StatInline label="StdDev" value={`${errorDist.statistics.std_dev?.toFixed(0)}s`} />
                                    <StatInline label="Total" value={`${errorDist.statistics.total?.toLocaleString()}`} />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 3. DIAGNOSTICS TAB */}
                {activeTab === 'diagnostics' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-slate-900 border border-slate-800 rounded p-4">
                            <h3 className="text-xs text-slate-400 font-bold uppercase mb-4">Temporal Stability (MAE)</h3>
                            <ResponsiveContainer width="100%" height={250}>
                                <AreaChart data={temporal?.daily_metrics || []}>
                                    <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={d => d?.slice(5)} />
                                    <YAxis stroke="#475569" fontSize={10} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Area type="monotone" dataKey="mae" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="bg-slate-900 border border-slate-800 rounded p-4">
                            <h3 className="text-xs text-slate-400 font-bold uppercase mb-4">Consistency (% &lt; 2min)</h3>
                            <ResponsiveContainer width="100%" height={250}>
                                <LineChart data={temporal?.daily_metrics || []}>
                                    <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={d => d?.slice(5)} />
                                    <YAxis stroke="#475569" fontSize={10} domain={[0, 100]} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <ReferenceLine y={80} stroke="#10b981" strokeDasharray="3 3" />
                                    <Line type="monotone" dataKey="within_2min_pct" stroke="#10b981" strokeWidth={2} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                {/* 4. ROUTES TAB - DATA TABLE */}
                {activeTab === 'routes' && (
                    <div className="bg-slate-900 border border-slate-800 rounded overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-800">
                            <h3 className="text-sm text-slate-300 font-bold uppercase">Route Performance Table</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-950 text-slate-400 uppercase text-xs">
                                    <tr>
                                        <th className="px-6 py-3">Route</th>
                                        <th className="px-6 py-3 text-right">Predictions</th>
                                        <th className="px-6 py-3 text-right">Avg Error</th>
                                        <th className="px-6 py-3 text-right">Median</th>
                                        <th className="px-6 py-3 text-right">1min Acc</th>
                                        <th className="px-6 py-3 text-right">2min Acc</th>
                                        <th className="px-6 py-3 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                    {routeStats.map((r) => {
                                        const avgError = parseFloat(r.avgError || '0');
                                        const status = avgError < 100 ? 'Good' : avgError < 180 ? 'Fair' : 'Poor';
                                        const statusColor = avgError < 100 ? 'text-emerald-400 bg-emerald-950/30' : avgError < 180 ? 'text-amber-400 bg-amber-950/30' : 'text-red-400 bg-red-950/30';

                                        return (
                                            <tr key={r.route} className="hover:bg-slate-800/50">
                                                <td className="px-6 py-3 font-mono font-bold text-indigo-400">{r.route}</td>
                                                <td className="px-6 py-3 text-right text-slate-300">{r.predictions?.toLocaleString()}</td>
                                                <td className="px-6 py-3 text-right font-mono">{avgError.toFixed(0)}s</td>
                                                <td className="px-6 py-3 text-right font-mono text-slate-400">{r.medianError}s</td>
                                                <td className="px-6 py-3 text-right text-slate-400">{parseFloat(r.within1min).toFixed(0)}%</td>
                                                <td className="px-6 py-3 text-right text-slate-400">{parseFloat(r.within2min).toFixed(0)}%</td>
                                                <td className="px-6 py-3 text-center">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${statusColor}`}>
                                                        {status}
                                                    </span>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

function StatBox({ label, value, sub, good, bad, neutral }: any) {
    let colorClass = "text-slate-200";
    if (good) colorClass = "text-emerald-400";
    if (bad) colorClass = "text-red-400";
    if (neutral) colorClass = "text-indigo-400";

    return (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded shadow-sm">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">{label}</div>
            <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
            <div className="text-xs text-slate-500 mt-1">{sub}</div>
        </div>
    );
}

function StatInline({ label, value }: any) {
    return (
        <div className="text-center">
            <div className="text-xs text-slate-500 uppercase">{label}</div>
            <div className="font-bold text-slate-200">{value}</div>
        </div>
    );
}
