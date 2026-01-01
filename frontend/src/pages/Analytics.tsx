import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

const BACKEND_URL = 'https://madison-bus-eta-production.up.railway.app';

interface PipelineStats {
    db_connected: boolean;
    total_observations: { vehicles: number; predictions: number };
    routes_tracked: number;
    vehicles_tracked: number;
    collection_rate: { last_hour: number; last_24h: number; per_minute_avg: number };
    timeline: { first_collection: string | null; last_collection: string | null; uptime_hours: number };
    health: { delayed_buses_24h_pct: number; is_collecting: boolean };
}

export default function AnalyticsPage() {
    const [stats, setStats] = useState<PipelineStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await axios.get(`${BACKEND_URL}/api/pipeline-stats`);
                setStats(res.data);
            } catch (e) {
                setError('Failed to fetch stats');
            } finally {
                setLoading(false);
            }
        };
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    // Mock hourly data for visualization
    const hourlyData = Array.from({ length: 24 }, (_, i) => ({
        hour: `${i}:00`,
        observations: Math.floor(Math.random() * 200 + 100),
        delayed: Math.floor(Math.random() * 10),
    }));

    return (
        <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-white">
            {/* Navigation */}
            <nav className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-lg sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                            Madison Metro Analytics
                        </h1>
                        <div className="hidden md:flex items-center gap-4">
                            <Link to="/" className="text-zinc-400 hover:text-white transition-colors text-sm">
                                ← Back to Map
                            </Link>
                        </div>
                    </div>
                    {stats?.health?.is_collecting && (
                        <div className="flex items-center gap-2 text-sm text-emerald-400">
                            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                            Live
                        </div>
                    )}
                </div>
            </nav>

            <main className="max-w-7xl mx-auto px-4 py-8">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : error ? (
                    <div className="text-center text-red-400 py-8">{error}</div>
                ) : stats && (
                    <>
                        {/* Hero Stats */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                            <StatCard
                                label="Total Observations"
                                value={stats.total_observations.vehicles.toLocaleString()}
                                color="emerald"
                                icon="📊"
                            />
                            <StatCard
                                label="Collection Rate"
                                value={`${stats.collection_rate.per_minute_avg}/min`}
                                color="blue"
                                icon="⚡"
                            />
                            <StatCard
                                label="Uptime"
                                value={`${stats.timeline.uptime_hours}h`}
                                color="yellow"
                                icon="⏱️"
                            />
                            <StatCard
                                label="Routes Tracked"
                                value={String(stats.routes_tracked)}
                                color="purple"
                                icon="🚌"
                            />
                        </div>

                        {/* Charts Row */}
                        <div className="grid md:grid-cols-2 gap-6 mb-8">
                            {/* Collection Over Time */}
                            <div className="bg-zinc-900/50 rounded-2xl border border-zinc-800 p-6">
                                <h3 className="text-lg font-semibold mb-4">Collection Activity (24h)</h3>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={hourlyData}>
                                            <defs>
                                                <linearGradient id="colorObs" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                            <XAxis dataKey="hour" stroke="#666" fontSize={12} />
                                            <YAxis stroke="#666" fontSize={12} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
                                                labelStyle={{ color: '#fff' }}
                                            />
                                            <Area type="monotone" dataKey="observations" stroke="#10b981" fill="url(#colorObs)" strokeWidth={2} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Delay Rate */}
                            <div className="bg-zinc-900/50 rounded-2xl border border-zinc-800 p-6">
                                <h3 className="text-lg font-semibold mb-4">Bus Delays (24h)</h3>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={hourlyData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                            <XAxis dataKey="hour" stroke="#666" fontSize={12} />
                                            <YAxis stroke="#666" fontSize={12} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
                                                labelStyle={{ color: '#fff' }}
                                            />
                                            <Line type="monotone" dataKey="delayed" stroke="#ef4444" strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* Detailed Stats */}
                        <div className="grid md:grid-cols-3 gap-6">
                            {/* Pipeline Info */}
                            <div className="bg-zinc-900/50 rounded-2xl border border-zinc-800 p-6">
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                    <span className="text-emerald-400">📡</span> Data Pipeline
                                </h3>
                                <div className="space-y-4">
                                    <InfoRow label="Database" value="PostgreSQL" status="connected" />
                                    <InfoRow label="Message Queue" value="Sentinel (Custom)" status="connected" />
                                    <InfoRow label="Collection Interval" value="20 seconds" />
                                    <InfoRow label="Vehicles Tracked" value={String(stats.vehicles_tracked)} />
                                </div>
                            </div>

                            {/* Collection Stats */}
                            <div className="bg-zinc-900/50 rounded-2xl border border-zinc-800 p-6">
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                    <span className="text-blue-400">📈</span> Collection Metrics
                                </h3>
                                <div className="space-y-4">
                                    <InfoRow label="Last Hour" value={stats.collection_rate.last_hour.toLocaleString()} />
                                    <InfoRow label="Last 24 Hours" value={stats.collection_rate.last_24h.toLocaleString()} />
                                    <InfoRow label="Per Minute" value={String(stats.collection_rate.per_minute_avg)} />
                                    <InfoRow label="Delayed Buses" value={`${stats.health.delayed_buses_24h_pct}%`} status={stats.health.delayed_buses_24h_pct < 5 ? 'good' : 'warning'} />
                                </div>
                            </div>

                            {/* Timeline */}
                            <div className="bg-zinc-900/50 rounded-2xl border border-zinc-800 p-6">
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                    <span className="text-yellow-400">⏱️</span> Timeline
                                </h3>
                                <div className="space-y-4">
                                    <InfoRow label="First Collection" value={stats.timeline.first_collection ? new Date(stats.timeline.first_collection).toLocaleString() : 'N/A'} />
                                    <InfoRow label="Last Collection" value={stats.timeline.last_collection ? new Date(stats.timeline.last_collection).toLocaleString() : 'N/A'} />
                                    <InfoRow label="Total Uptime" value={`${stats.timeline.uptime_hours} hours`} />
                                </div>
                            </div>
                        </div>

                        {/* Back to Map */}
                        <div className="mt-8 text-center md:hidden">
                            <Link
                                to="/"
                                className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-medium transition-colors"
                            >
                                ← Back to Live Map
                            </Link>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}

function StatCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
    const colors: Record<string, string> = {
        emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30',
        blue: 'from-blue-500/20 to-blue-500/5 border-blue-500/30',
        yellow: 'from-yellow-500/20 to-yellow-500/5 border-yellow-500/30',
        purple: 'from-purple-500/20 to-purple-500/5 border-purple-500/30',
    };

    return (
        <div className={`bg-gradient-to-br ${colors[color]} border rounded-2xl p-6`}>
            <div className="text-2xl mb-2">{icon}</div>
            <div className="text-3xl font-bold mb-1">{value}</div>
            <div className="text-sm text-zinc-400">{label}</div>
        </div>
    );
}

function InfoRow({ label, value, status }: { label: string; value: string; status?: 'connected' | 'good' | 'warning' }) {
    return (
        <div className="flex justify-between items-center">
            <span className="text-zinc-400">{label}</span>
            <div className="flex items-center gap-2">
                <span className="font-mono text-sm">{value}</span>
                {status === 'connected' && <span className="w-2 h-2 bg-emerald-400 rounded-full" />}
                {status === 'good' && <span className="w-2 h-2 bg-emerald-400 rounded-full" />}
                {status === 'warning' && <span className="w-2 h-2 bg-yellow-400 rounded-full" />}
            </div>
        </div>
    );
}
