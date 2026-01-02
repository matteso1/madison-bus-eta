import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { TrendingUp, Bus, CheckCircle, HardDrive, BarChart3, Clock, Cpu, Activity } from 'lucide-react';
import {
    AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Cell, ReferenceLine, ScatterChart, Scatter
} from 'recharts';

const BACKEND_URL = 'https://madison-bus-eta-production.up.railway.app';

// Types
interface PipelineStats {
    db_connected: boolean;
    total_observations: { vehicles: number; predictions: number };
    routes_tracked: number;
    vehicles_tracked: number;
    collection_rate: { last_hour: number; last_24h: number; per_minute_avg: number };
    timeline: { first_collection: string | null; last_collection: string | null; uptime_hours: number };
    health: { delayed_buses_24h_pct: number; is_collecting: boolean };
}

interface SystemHealth {
    status: 'healthy' | 'degraded' | 'unhealthy' | 'error';
    checks: {
        database?: { status: string; message: string };
        collector?: { status: string; message: string };
    };
    metrics?: {
        collection: {
            last_hour: number;
            last_5min: number;
            rate_per_min: number;
            latest_record: string | null;
            data_freshness: string;
            age_seconds: number | null;
        };
        data_quality: {
            distinct_routes_1h: number;
            distinct_vehicles_1h: number;
            total_records: number;
            expected_rate_ok: boolean;
        };
    };
}

interface ChartData {
    hourly_trend: { hour: string; records: number; vehicles: number; delay_pct: number }[];
    route_distribution: { route: string; observations: number; delay_pct: number }[];
    data_quality: { score: number; rate_score: number; route_score: number; records_last_hour: number; routes_covered: number };
    storage: { total_records: number; estimated_mb: number; free_tier_pct: number };
}

interface MLTrainingData {
    runs: Array<{
        version: string;
        accuracy: number;
        f1_score: number;
        precision: number;
        recall: number;
        samples_used: number;
        deployed: boolean;
        deployment_reason: string;
        improvement_pct: number | null;
        previous_f1: number | null;
    }>;
    latest_model: { version: string; f1_score: number } | null;
    total_runs: number;
}
// Color palette
const COLORS = ['#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#84cc16'];

// Format version string (20260102_210437) to readable format
function formatVersion(version: string, short = false): string {
    if (!version || version.length < 15) return version;
    // Parse: YYYYMMDD_HHMMSS
    const month = parseInt(version.slice(4, 6));
    const day = parseInt(version.slice(6, 8));
    const hour = version.slice(9, 11);
    const min = version.slice(11, 13);
    if (short) return `${month}/${day} ${hour}:${min}`;
    return `${month}/${day} ${hour}:${min}`;
}

export default function AnalyticsPage() {
    const [stats, setStats] = useState<PipelineStats | null>(null);
    const [health, setHealth] = useState<SystemHealth | null>(null);
    const [charts, setCharts] = useState<ChartData | null>(null);
    const [mlData, setMlData] = useState<MLTrainingData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [statsRes, healthRes, chartsRes, mlRes] = await Promise.all([
                    axios.get(`${BACKEND_URL}/api/pipeline-stats`),
                    axios.get(`${BACKEND_URL}/api/system-health`),
                    axios.get(`${BACKEND_URL}/api/analytics-charts`),
                    axios.get(`${BACKEND_URL}/api/ml-training-history`).catch(() => ({ data: null }))
                ]);
                if (statsRes.data.db_connected) {
                    setStats(statsRes.data);
                } else {
                    setError(statsRes.data.error || 'Database not connected');
                }
                setHealth(healthRes.data);
                setCharts(chartsRes.data);
                if (mlRes.data) setMlData(mlRes.data);
            } catch {
                setError('Failed to fetch data');
            } finally {
                setLoading(false);
            }
        };
        fetchData();
        const interval = setInterval(fetchData, 15000);
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
                <div className="text-center">
                    <div className="text-6xl mb-4">⚠️</div>
                    <h2 className="text-2xl font-bold text-red-400 mb-2">Error</h2>
                    <p className="text-zinc-400">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0a0f] text-white">
            {/* Background */}
            <div className="fixed inset-0 bg-gradient-to-br from-emerald-900/20 via-transparent to-cyan-900/20 pointer-events-none" />

            {/* Nav */}
            <nav className="relative z-50 border-b border-white/5">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-lg font-bold">M</div>
                        <span className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Madison Metro</span>
                    </Link>
                    <div className="flex items-center gap-4">
                        {health?.status === 'healthy' && (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                                <span className="text-sm text-emerald-400">Live</span>
                            </div>
                        )}
                        <Link to="/" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm">← Back</Link>
                    </div>
                </div>
            </nav>

            <main className="relative z-10 max-w-7xl mx-auto px-6 py-8">
                {/* Header */}
                <div className="text-center mb-10">
                    <h1 className="text-4xl md:text-5xl font-bold mb-2">
                        <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                            Pipeline Analytics
                        </span>
                    </h1>
                    <p className="text-zinc-400">Real-time system diagnostics • Auto-refreshes every 15s</p>
                </div>

                {/* Quick Stats Row */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                    <QuickStat label="Total Records" value={charts?.storage.total_records?.toLocaleString() || '0'} icon={<BarChart3 className="w-6 h-6" />} />
                    <QuickStat label="Rate/min" value={stats?.collection_rate.per_minute_avg?.toFixed(1) || '0'} icon={<Activity className="w-6 h-6" />} />
                    <QuickStat label="Routes Active" value={String(health?.metrics?.data_quality.distinct_routes_1h || 0)} icon={<Bus className="w-6 h-6" />} />
                    <QuickStat label="Data Quality" value={`${charts?.data_quality.score || 0}%`} icon={<CheckCircle className="w-6 h-6" />} color={charts?.data_quality.score && charts.data_quality.score > 80 ? 'emerald' : 'amber'} />
                    <QuickStat label="Storage" value={`${charts?.storage.estimated_mb?.toFixed(1) || 0} MB`} icon={<HardDrive className="w-6 h-6" />} />
                </div>

                {/* System Health Bar */}
                {health && (
                    <div className="mb-8 p-4 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${health.status === 'healthy' ? 'bg-emerald-500/20 text-emerald-400' :
                                health.status === 'degraded' ? 'bg-amber-500/20 text-amber-400' :
                                    'bg-red-500/20 text-red-400'
                                }`}>
                                {health.status.toUpperCase()}
                            </span>
                            <span className="text-zinc-400">DB: {health.checks.database?.status === 'ok' ? '✓' : '✗'}</span>
                            <span className={health.metrics?.collection.data_freshness === 'fresh' ? 'text-emerald-400' : 'text-amber-400'}>
                                Data: {health.metrics?.collection.data_freshness} ({health.metrics?.collection.age_seconds}s ago)
                            </span>
                        </div>
                        <div className="text-zinc-500 text-sm">Last 5min: {health.metrics?.collection.last_5min || 0} records</div>
                    </div>
                )}

                {/* Charts Grid */}
                <div className="grid lg:grid-cols-2 gap-6 mb-8">
                    {/* Hourly Trend Chart */}
                    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-emerald-400" />
                            Hourly Collection Trend
                            <span className="text-xs text-zinc-500 font-normal ml-auto">Last 24h</span>
                        </h3>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={charts?.hourly_trend || []}>
                                    <defs>
                                        <linearGradient id="colorRecords" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                    <XAxis dataKey="hour" stroke="#666" tick={{ fill: '#888', fontSize: 11 }} />
                                    <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 11 }} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: '8px' }}
                                        labelStyle={{ color: '#fff' }}
                                    />
                                    <Area type="monotone" dataKey="records" stroke="#10b981" fillOpacity={1} fill="url(#colorRecords)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Route Distribution Chart */}
                    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <Bus className="w-5 h-5 text-cyan-400" />
                            Route Distribution
                            <span className="text-xs text-zinc-500 font-normal ml-auto">Top 10 routes</span>
                        </h3>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={charts?.route_distribution || []} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                    <XAxis type="number" stroke="#666" tick={{ fill: '#888', fontSize: 11 }} />
                                    <YAxis dataKey="route" type="category" stroke="#666" tick={{ fill: '#888', fontSize: 11 }} width={40} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: '8px' }}
                                        labelStyle={{ color: '#fff' }}
                                        formatter={(value: number) => [value.toLocaleString(), 'Observations']}
                                    />
                                    <Bar dataKey="observations" radius={[0, 4, 4, 0]}>
                                        {(charts?.route_distribution || []).map((_, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* Bottom Stats Grid */}
                <div className="grid md:grid-cols-3 gap-6">
                    {/* Data Quality Breakdown */}
                    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-purple-400" />
                            Data Quality
                        </h3>
                        <div className="space-y-4">
                            <QualityBar label="Collection Rate" value={charts?.data_quality.rate_score || 0} />
                            <QualityBar label="Route Coverage" value={charts?.data_quality.route_score || 0} />
                            <div className="pt-4 border-t border-white/10">
                                <div className="text-4xl font-bold text-emerald-400">{charts?.data_quality.score || 0}%</div>
                                <div className="text-sm text-zinc-400">Overall Score</div>
                            </div>
                        </div>
                    </div>

                    {/* Pipeline Timeline */}
                    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <Clock className="w-5 h-5 text-blue-400" />
                            Pipeline Timeline
                        </h3>
                        <div className="space-y-4">
                            <TimelineItem label="First Record" value={stats?.timeline.first_collection ? new Date(stats.timeline.first_collection).toLocaleString() : 'N/A'} />
                            <TimelineItem label="Latest Record" value={stats?.timeline.last_collection ? new Date(stats.timeline.last_collection).toLocaleString() : 'N/A'} />
                            <TimelineItem label="Uptime" value={`${stats?.timeline.uptime_hours || 0} hours`} highlight />
                        </div>
                    </div>

                    {/* Storage Info */}
                    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <HardDrive className="w-5 h-5 text-amber-400" />
                            Storage
                        </h3>
                        <div className="space-y-4">
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Total Records</span>
                                <span className="font-mono">{charts?.storage.total_records?.toLocaleString() || 0}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Estimated Size</span>
                                <span className="font-mono">{charts?.storage.estimated_mb?.toFixed(2) || 0} MB</span>
                            </div>
                            <div className="pt-4 border-t border-white/10">
                                <div className="text-sm text-zinc-400 mb-2">Free Tier Usage</div>
                                <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${charts?.storage.free_tier_pct && charts.storage.free_tier_pct > 80 ? 'bg-red-500' : 'bg-emerald-500'}`}
                                        style={{ width: `${Math.min(100, charts?.storage.free_tier_pct || 0)}%` }}
                                    />
                                </div>
                                <div className="text-right text-sm text-zinc-500 mt-1">{charts?.storage.free_tier_pct?.toFixed(2) || 0}% of 1GB</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ML Performance Section */}
                <div className="mt-8 bg-gradient-to-br from-purple-900/20 to-indigo-900/20 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-6">
                    <h3 className="text-xl font-bold mb-6 flex items-center gap-3">
                        <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center">
                            <Cpu className="w-5 h-5 text-white" />
                        </span>
                        Autonomous ML Pipeline
                        <span className={`ml-auto px-3 py-1 rounded-full text-xs border ${mlData?.latest_model ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30'}`}>
                            {mlData?.latest_model ? 'Model Active' : 'Collecting Data'}
                        </span>
                    </h3>

                    {/* Key Metrics Row */}
                    <div className="grid md:grid-cols-5 gap-4 mb-6">
                        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                            <div className="text-sm text-zinc-400 mb-1">Current Model</div>
                            <div className="text-lg font-bold text-purple-400">
                                {mlData?.latest_model ? formatVersion(mlData.latest_model.version) : 'None'}
                            </div>
                            <div className="text-xs text-zinc-500 mt-1">{mlData?.total_runs || 0} runs total</div>
                        </div>
                        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                            <div className="text-sm text-zinc-400 mb-1">F1 Score</div>
                            <div className="text-lg font-bold text-cyan-400">
                                {mlData?.latest_model?.f1_score?.toFixed(3) || 'N/A'}
                            </div>
                            <div className="text-xs text-zinc-500 mt-1">Delay prediction</div>
                        </div>
                        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                            <div className="text-sm text-zinc-400 mb-1">Accuracy</div>
                            <div className="text-lg font-bold text-indigo-400">
                                {mlData?.runs?.[0]?.accuracy ? `${(mlData.runs[0].accuracy * 100).toFixed(1)}%` : 'N/A'}
                            </div>
                            <div className="text-xs text-zinc-500 mt-1">XGBoost Classifier</div>
                        </div>
                        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                            <div className="text-sm text-zinc-400 mb-1">Last Improvement</div>
                            <div className={`text-lg font-bold ${(mlData?.runs?.[0]?.improvement_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {mlData?.runs?.[0]?.improvement_pct != null ? `${mlData.runs[0].improvement_pct > 0 ? '+' : ''}${mlData.runs[0].improvement_pct.toFixed(1)}%` : 'N/A'}
                            </div>
                            <div className="text-xs text-zinc-500 mt-1">vs previous model</div>
                        </div>
                        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                            <div className="text-sm text-zinc-400 mb-1">Training Data</div>
                            <div className="text-lg font-bold text-emerald-400">
                                {mlData?.runs?.[0]?.samples_used?.toLocaleString() || 'N/A'}
                            </div>
                            <div className="text-xs text-zinc-500 mt-1">samples used</div>
                        </div>
                    </div>

                    {/* Charts Row */}
                    <div className="grid lg:grid-cols-2 gap-6 mb-6">
                        {/* F1 Score History Chart */}
                        <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                            <h4 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
                                <TrendingUp className="w-4 h-4 text-purple-400" />
                                F1 Score History
                                <span className="text-xs text-zinc-500 ml-auto">Last {mlData?.runs?.length || 0} runs</span>
                            </h4>
                            <div className="h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={[...(mlData?.runs || [])].reverse().map((run, idx) => ({
                                        run: idx + 1,
                                        f1: run.f1_score,
                                        deployed: run.deployed,
                                        version: formatVersion(run.version, true)
                                    }))}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                        <XAxis dataKey="run" stroke="#666" tick={{ fill: '#888', fontSize: 10 }} label={{ value: 'Run #', position: 'bottom', fill: '#666', fontSize: 10 }} />
                                        <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 10 }} domain={['dataMin - 0.05', 'dataMax + 0.05']} tickFormatter={(v) => v.toFixed(2)} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: '8px' }}
                                            labelStyle={{ color: '#fff' }}
                                            formatter={(value: number) => value.toFixed(4)}
                                        />
                                        <ReferenceLine y={mlData?.latest_model?.f1_score || 0} stroke="#10b981" strokeDasharray="5 5" label={{ value: 'Current', fill: '#10b981', fontSize: 10 }} />
                                        <Line
                                            type="monotone"
                                            dataKey="f1"
                                            stroke="#8b5cf6"
                                            strokeWidth={2}
                                            dot={{ fill: '#8b5cf6', r: 4 }}
                                            activeDot={{ r: 6, fill: '#10b981' }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex items-center justify-center gap-4 mt-2 text-xs">
                                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-500"></span> Deployed</span>
                                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500"></span> Rejected</span>
                            </div>
                        </div>

                        {/* Training Runs Detail */}
                        <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                            <h4 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
                                <BarChart3 className="w-4 h-4 text-indigo-400" />
                                Training Run Details
                                <span className="text-xs text-zinc-500 ml-auto">Precision vs Recall</span>
                            </h4>
                            <div className="h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                        <XAxis
                                            dataKey="precision"
                                            type="number"
                                            stroke="#666"
                                            tick={{ fill: '#888', fontSize: 10 }}
                                            domain={[0, 1]}
                                            name="Precision"
                                            label={{ value: 'Precision', position: 'bottom', fill: '#666', fontSize: 10 }}
                                        />
                                        <YAxis
                                            dataKey="recall"
                                            type="number"
                                            stroke="#666"
                                            tick={{ fill: '#888', fontSize: 10 }}
                                            domain={[0, 1]}
                                            name="Recall"
                                            label={{ value: 'Recall', angle: -90, position: 'left', fill: '#666', fontSize: 10 }}
                                        />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: '8px' }}
                                            formatter={(value: number) => value.toFixed(3)}
                                        />
                                        <Scatter
                                            data={(mlData?.runs || []).map(run => ({
                                                precision: run.precision,
                                                recall: run.recall,
                                                f1: run.f1_score,
                                                deployed: run.deployed,
                                                version: formatVersion(run.version, true)
                                            }))}
                                            fill="#8b5cf6"
                                        >
                                            {(mlData?.runs || []).map((run, idx) => (
                                                <Cell
                                                    key={idx}
                                                    fill={run.deployed ? '#10b981' : '#ef4444'}
                                                />
                                            ))}
                                        </Scatter>
                                    </ScatterChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="text-xs text-zinc-500 text-center mt-2">
                                Each point represents a training run • Ideal: top-right corner
                            </div>
                        </div>
                    </div>

                    {/* Training Run History Table */}
                    <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                        <h4 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
                            <Activity className="w-4 h-4 text-cyan-400" />
                            Recent Training Runs
                        </h4>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-zinc-400 border-b border-white/10">
                                        <th className="text-left py-2 px-2">Version</th>
                                        <th className="text-right py-2 px-2">F1</th>
                                        <th className="text-right py-2 px-2">Δ</th>
                                        <th className="text-right py-2 px-2">Samples</th>
                                        <th className="text-left py-2 px-2">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(mlData?.runs || []).slice(0, 5).map((run, idx) => (
                                        <tr key={idx} className="border-b border-white/5 hover:bg-white/5">
                                            <td className="py-2 px-2 font-mono text-purple-400">{formatVersion(run.version)}</td>
                                            <td className="py-2 px-2 text-right text-cyan-400">{run.f1_score?.toFixed(3)}</td>
                                            <td className={`py-2 px-2 text-right ${(run.improvement_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {run.improvement_pct != null ? `${run.improvement_pct > 0 ? '+' : ''}${run.improvement_pct.toFixed(1)}%` : '—'}
                                            </td>
                                            <td className="py-2 px-2 text-right text-zinc-300">{run.samples_used?.toLocaleString()}</td>
                                            <td className="py-2 px-2">
                                                <span className={`px-2 py-0.5 rounded-full text-xs ${run.deployed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-500/20 text-zinc-400'}`}>
                                                    {run.deployed ? '✓ Deployed' : 'Skipped'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Status Footer */}
                    <div className="mt-4 p-4 rounded-xl bg-black/20 border border-white/5">
                        <div className="flex items-center gap-2 text-sm text-zinc-400">
                            {mlData?.latest_model ? (
                                <><span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                                    Model deployed: {mlData.runs?.[0]?.deployment_reason || 'first_model'} • Next training: 3 AM CST</>
                            ) : (
                                <><span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></span>
                                    Collecting training data... First model training will run at 3 AM.</>
                            )}
                        </div>
                    </div>
                </div>
            </main>

            <footer className="relative z-10 border-t border-white/5 mt-12">
                <div className="max-w-7xl mx-auto px-6 py-6 text-center text-zinc-500 text-sm">
                    Collector → PostgreSQL • Sentinel Message Queue • Auto-refresh 15s
                </div>
            </footer>
        </div>
    );
}

// Sub-components
function QuickStat({ label, value, icon, color = 'white' }: { label: string; value: string; icon: React.ReactNode; color?: string }) {
    return (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 text-center">
            <div className="flex justify-center text-zinc-400 mb-1">{icon}</div>
            <div className={`text-2xl font-bold ${color === 'emerald' ? 'text-emerald-400' : color === 'amber' ? 'text-amber-400' : 'text-white'}`}>{value}</div>
            <div className="text-xs text-zinc-400">{label}</div>
        </div>
    );
}

function QualityBar({ label, value }: { label: string; value: number }) {
    return (
        <div>
            <div className="flex justify-between text-sm mb-1">
                <span className="text-zinc-400">{label}</span>
                <span className={value > 80 ? 'text-emerald-400' : value > 50 ? 'text-amber-400' : 'text-red-400'}>{value.toFixed(0)}%</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full ${value > 80 ? 'bg-emerald-500' : value > 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, value)}%` }}
                />
            </div>
        </div>
    );
}

function TimelineItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className={`p-3 rounded-xl ${highlight ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-white/5'}`}>
            <div className="text-xs text-zinc-400 mb-1">{label}</div>
            <div className={`font-mono text-sm ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</div>
        </div>
    );
}
