import { useState, useEffect } from 'react';
import axios from 'axios';
import {
    Activity, Database, RefreshCcw, ScatterChart as ScatterIcon, BarChart2
} from 'lucide-react';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    ScatterChart, Scatter, ReferenceLine
} from 'recharts';

const BACKEND_URL = 'https://madison-bus-eta-production.up.railway.app';
// const BACKEND_URL = 'http://localhost:5000'; // Local dev override

// --- Types ---
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

interface RoutePerformancRow {
    route: string;
    predictions: number;
    avgError: number;
    mape: number; // calculated roughly per route
    bti: number;
    within1min: number;
}

export default function AnalyticsPage() {
    const [metrics, setMetrics] = useState<ScientificMetrics | null>(null);
    const [residuals, setResiduals] = useState<ResidualPoint[]>([]);
    const [routeStats, setRouteStats] = useState<RoutePerformancRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

    const fetchData = async () => {
        try {
            const [metricsRes, residRes, routeRes] = await Promise.all([
                axios.get(`${BACKEND_URL}/api/scientific-metrics`),
                axios.get(`${BACKEND_URL}/api/model-diagnostics/residuals`),
                axios.get(`${BACKEND_URL}/api/route-accuracy`) // reusing existing endpoint, mapping data
            ]);

            setMetrics(metricsRes.data);
            setResiduals(residRes.data);

            // Transform route data to fit table
            if (routeRes.data?.routes) {
                const rows = routeRes.data.routes.map((r: any) => ({
                    route: r.route,
                    predictions: r.predictions,
                    avgError: Number(r.avgError || 0), // Defensive cast
                    mape: (Number(r.avgError || 0) / 600) * 100,
                    bti: 0.45,
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
        const interval = setInterval(fetchData, 30000); // 30s refresh
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0f1117] flex items-center justify-center text-zinc-500 font-mono text-sm">
                <RefreshCcw className="w-4 h-4 mr-2 animate-spin" />
                INITIALIZING SCIENTIFIC DASHBOARD...
            </div>
        );
    }

    // Theme: "Enterprise Dark" - #0f1117 background, thin borders
    return (
        <div className="min-h-screen bg-[#0f1117] text-zinc-300 font-sans selection:bg-indigo-500/30">
            {/* Header */}
            <header className="border-b border-white/10 bg-[#0f1117]/80 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center">
                            <Activity className="w-5 h-5 text-white" />
                        </div>
                        <h1 className="text-lg font-semibold text-white tracking-tight">
                            Madison Metro <span className="text-zinc-500 font-normal">/ Scientific Observation Deck</span>
                        </h1>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono text-zinc-500">
                        <span className="flex items-center gap-2">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            LIVE SYSTEM
                        </span>
                        <span>UPDATED: {lastUpdated.toLocaleTimeString()}</span>
                        <button onClick={fetchData} className="p-1 hover:text-white transition-colors">
                            <RefreshCcw className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-[1600px] mx-auto px-6 py-8">
                {/* Top Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    <MetricCard
                        title="MAPE (24h)"
                        value={metrics ? `${metrics.mape.toFixed(2)}%` : "--"}
                        sub="Mean Absolute Percentage Error"
                        trend={metrics && metrics.mape < 15 ? "good" : "neutral"}
                    />
                    <MetricCard
                        title="R-Squared (R²)"
                        value={metrics ? metrics.r_squared.toFixed(3) : "--"}
                        sub="Coefficient of Determination"
                        trend={metrics && metrics.r_squared > 0.8 ? "good" : "bad"}
                    />
                    <MetricCard
                        title="Buffer Time Index"
                        value={metrics ? metrics.buffer_time_index.toFixed(2) : "--"}
                        sub="Reliability Factor (95%)"
                        trend={metrics && metrics.buffer_time_index < 0.5 ? "good" : "bad"}
                    />
                    <MetricCard
                        title="MAE"
                        value={metrics ? `${metrics.mae.toFixed(1)}s` : "--"}
                        sub="Mean Absolute Error"
                        trend="neutral"
                    />
                </div>

                {/* Main Content Split */}
                <div className="grid grid-cols-12 gap-6">

                    {/* LEFT COLUMN: Data Density (Table) - Span 7 */}
                    <div className="col-span-12 xl:col-span-7 flex flex-col gap-6">
                        <div className="bg-[#161b22] border border-white/5 rounded-lg overflow-hidden flex flex-col h-[600px]">
                            <div className="px-4 py-3 border-b border-white/5 bg-[#0d1117] flex justify-between items-center">
                                <h3 className="text-sm font-medium text-white flex items-center gap-2">
                                    <Database className="w-4 h-4 text-zinc-500" />
                                    Route Reliability Matrix
                                </h3>
                                <span className="text-xs text-zinc-500">{routeStats.length} Routes Active</span>
                            </div>
                            <div className="flex-1 overflow-auto">
                                <table className="w-full text-sm text-left whitespace-nowrap">
                                    <thead className="text-xs text-zinc-500 bg-[#0d1117] font-mono sticky top-0 z-10">
                                        <tr>
                                            <th className="px-4 py-2">ROUTE</th>
                                            <th className="px-4 py-2 text-right">SAMPLES</th>
                                            <th className="px-4 py-2 text-right">MAE (s)</th>
                                            <th className="px-4 py-2 text-right">ACCURACY</th>
                                            <th className="px-4 py-2 text-right">STATUS</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5 font-mono text-xs">
                                        {routeStats.map((row) => (
                                            <tr key={row.route} className="hover:bg-white/[0.02] transition-colors">
                                                <td className="px-4 py-2 font-bold text-indigo-400">{row.route}</td>
                                                <td className="px-4 py-2 text-right text-zinc-400">{row.predictions.toLocaleString()}</td>
                                                <td className="px-4 py-2 text-right text-zinc-300">
                                                    {row.avgError.toFixed(1)}
                                                </td>
                                                <td className="px-4 py-2 text-right">
                                                    <span className={`${row.within1min > 70 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                                        {row.within1min.toFixed(1)}%
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2 text-right">
                                                    {row.avgError < 90 ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                            OPTIMAL
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                                            DEGRADED
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Scientific Validation (Charts) - Span 5 */}
                    <div className="col-span-12 xl:col-span-5 flex flex-col gap-6">

                        {/* CHART 1: Predicted vs Actual (Scatter) */}
                        <div className="bg-[#161b22] border border-white/5 rounded-lg p-4 h-[350px] flex flex-col">
                            <h3 className="text-xs font-medium text-zinc-400 mb-4 flex items-center justify-between">
                                <span>PREDICTED VS ACTUAL (VALIDATION)</span>
                                <ScatterIcon className="w-3 h-3" />
                            </h3>
                            <div className="flex-1 w-full min-h-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                        <XAxis
                                            type="number"
                                            dataKey="actual"
                                            name="Actual"
                                            unit="s"
                                            stroke="#555"
                                            fontSize={10}
                                            tickFormatter={(val) => `${(val / 60).toFixed(0)}m`}
                                            label={{ value: 'Actual Duration', position: 'bottom', offset: 0, fill: '#666', fontSize: 10 }}
                                        />
                                        <YAxis
                                            type="number"
                                            dataKey="predicted"
                                            name="Predicted"
                                            unit="s"
                                            stroke="#555"
                                            fontSize={10}
                                            tickFormatter={(val) => `${(val / 60).toFixed(0)}m`}
                                            label={{ value: 'Predicted Duration', angle: -90, position: 'insideLeft', fill: '#666', fontSize: 10 }}
                                        />
                                        <Tooltip
                                            cursor={{ strokeDasharray: '3 3' }}
                                            contentStyle={{ backgroundColor: '#0d1117', border: '1px solid #30363d' }}
                                        />
                                        {/* Ideally Line y=x */}
                                        <Scatter name="Predictions" data={residuals} fill="#6366f1" shape="circle" />
                                    </ScatterChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* CHART 2: Residuals vs Predicted (Heteroscedasticity) */}
                        <div className="bg-[#161b22] border border-white/5 rounded-lg p-4 h-[226px] flex flex-col">
                            <h3 className="text-xs font-medium text-zinc-400 mb-4 flex items-center justify-between">
                                <span>RESIDUALS (BIAS CHECK)</span>
                                <BarChart2 className="w-3 h-3" />
                            </h3>
                            <div className="flex-1 w-full min-h-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                        <XAxis
                                            type="number"
                                            dataKey="predicted"
                                            name="Predicted"
                                            stroke="#555"
                                            fontSize={10}
                                            tickFormatter={(val) => `${(val / 60).toFixed(0)}m`}
                                        />
                                        <YAxis
                                            type="number"
                                            dataKey="residual"
                                            name="Residual"
                                            stroke="#555"
                                            fontSize={10}
                                        />
                                        <ReferenceLine y={0} stroke="#10b981" />
                                        <Scatter data={residuals} fill="#f43f5e" shape="cross" />
                                    </ScatterChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                    </div>
                </div>
            </main>
        </div>
    );
}

// --- Subcomponents ---

function MetricCard({ title, value, sub, trend }: { title: string, value: string, sub: string, trend: 'good' | 'bad' | 'neutral' }) {
    const trendColor = trend === 'good' ? 'text-emerald-400' : trend === 'bad' ? 'text-rose-400' : 'text-indigo-400';
    return (
        <div className="bg-[#161b22] border border-white/5 rounded-lg p-5 flex flex-col justify-between h-28 relative overflow-hidden group hover:border-indigo-500/30 transition-colors">
            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <Activity className="w-12 h-12" />
            </div>
            <div>
                <h3 className="text-xs font-medium text-zinc-400 tracking-wider uppercase">{title}</h3>
                <div className={`text-3xl font-mono mt-1 font-bold ${trendColor} tracking-tight`}>
                    {value}
                </div>
            </div>
            <div className="text-[10px] text-zinc-500 font-mono mt-1">
                {sub}
            </div>
        </div>
    );
}
