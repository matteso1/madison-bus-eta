import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

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

export default function AnalyticsPage() {
    const [stats, setStats] = useState<PipelineStats | null>(null);
    const [health, setHealth] = useState<SystemHealth | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [statsRes, healthRes] = await Promise.all([
                    axios.get(`${BACKEND_URL}/api/pipeline-stats`),
                    axios.get(`${BACKEND_URL}/api/system-health`)
                ]);
                if (statsRes.data.db_connected) {
                    setStats(statsRes.data);
                } else {
                    setError(statsRes.data.error || 'Database not connected');
                }
                setHealth(healthRes.data);
            } catch {
                setError('Failed to fetch data');
            } finally {
                setLoading(false);
            }
        };
        fetchData();
        const interval = setInterval(fetchData, 15000); // Faster refresh for health
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="min-h-screen bg-[#0a0a0f] text-white">
            {/* Gradient Background */}
            <div className="fixed inset-0 bg-gradient-to-br from-emerald-900/20 via-transparent to-cyan-900/20 pointer-events-none" />
            <div className="fixed top-0 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="fixed bottom-0 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Navigation */}
            <nav className="relative z-50 border-b border-white/5">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <Link to="/" className="flex items-center gap-3 group">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-lg font-bold shadow-lg shadow-emerald-500/20">
                                M
                            </div>
                            <span className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                                Madison Metro
                            </span>
                        </Link>
                    </div>
                    <div className="flex items-center gap-4">
                        {stats?.health?.is_collecting && (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                                <span className="text-sm text-emerald-400">Collecting</span>
                            </div>
                        )}
                        <Link
                            to="/"
                            className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm transition-colors"
                        >
                            ← Back to Map
                        </Link>
                    </div>
                </div>
            </nav>

            <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-10 h-10 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : error ? (
                    <div className="text-center py-20">
                        <div className="text-6xl mb-4">⚠️</div>
                        <h2 className="text-2xl font-bold text-red-400 mb-2">Database Connection Error</h2>
                        <p className="text-zinc-400">{error}</p>
                        <p className="text-zinc-500 text-sm mt-4">Make sure DATABASE_URL is configured and the backend is redeployed.</p>
                    </div>
                ) : stats && (
                    <>
                        {/* Hero Section */}
                        <div className="text-center mb-16">
                            <h1 className="text-5xl md:text-6xl font-bold mb-4">
                                <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                                    Live Pipeline Analytics
                                </span>
                            </h1>
                            <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
                                Real-time statistics from PostgreSQL • Powered by Sentinel
                            </p>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                            <StatCard
                                icon="📊"
                                value={stats.total_observations.vehicles.toLocaleString()}
                                label="Vehicle Observations"
                                gradient="from-emerald-500 to-teal-500"
                            />
                            <StatCard
                                icon="⚡"
                                value={`${stats.collection_rate.per_minute_avg}/min`}
                                label="Collection Rate"
                                gradient="from-blue-500 to-indigo-500"
                            />
                            <StatCard
                                icon="🚌"
                                value={String(stats.routes_tracked)}
                                label="Routes Tracked"
                                gradient="from-purple-500 to-pink-500"
                            />
                            <StatCard
                                icon="⏱️"
                                value={`${stats.timeline.uptime_hours}h`}
                                label="Pipeline Uptime"
                                gradient="from-amber-500 to-orange-500"
                            />
                        </div>

                        {/* System Health Panel */}
                        {health && (
                            <div className="mb-12 bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8">
                                <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                                    <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">🏥</span>
                                    System Health
                                    <span className={`ml-auto px-3 py-1 rounded-full text-sm font-medium ${health.status === 'healthy' ? 'bg-emerald-500/20 text-emerald-400' :
                                            health.status === 'degraded' ? 'bg-amber-500/20 text-amber-400' :
                                                'bg-red-500/20 text-red-400'
                                        }`}>
                                        {health.status.toUpperCase()}
                                    </span>
                                </h2>
                                <div className="grid md:grid-cols-4 gap-4">
                                    {/* Database Status */}
                                    <div className={`p-4 rounded-2xl border ${health.checks.database?.status === 'ok' ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'
                                        }`}>
                                        <div className="text-sm text-zinc-400 mb-1">Database</div>
                                        <div className={`font-bold ${health.checks.database?.status === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {health.checks.database?.status === 'ok' ? '✓ Connected' : '✗ Error'}
                                        </div>
                                    </div>
                                    {/* Data Freshness */}
                                    <div className={`p-4 rounded-2xl border ${health.metrics?.collection.data_freshness === 'fresh' ? 'bg-emerald-500/10 border-emerald-500/20' :
                                            health.metrics?.collection.data_freshness === 'stale' ? 'bg-amber-500/10 border-amber-500/20' :
                                                'bg-zinc-500/10 border-zinc-500/20'
                                        }`}>
                                        <div className="text-sm text-zinc-400 mb-1">Data Freshness</div>
                                        <div className={`font-bold ${health.metrics?.collection.data_freshness === 'fresh' ? 'text-emerald-400' :
                                                health.metrics?.collection.data_freshness === 'stale' ? 'text-amber-400' :
                                                    'text-zinc-400'
                                            }`}>
                                            {health.metrics?.collection.data_freshness === 'fresh' ? '🟢 Fresh' :
                                                health.metrics?.collection.data_freshness === 'stale' ? '🟡 Stale' : '⚪ No Data'}
                                            {health.metrics?.collection.age_seconds && (
                                                <span className="text-xs ml-2">({health.metrics.collection.age_seconds}s ago)</span>
                                            )}
                                        </div>
                                    </div>
                                    {/* Collection Rate */}
                                    <div className="p-4 rounded-2xl border bg-blue-500/10 border-blue-500/20">
                                        <div className="text-sm text-zinc-400 mb-1">Rate (5min)</div>
                                        <div className="font-bold text-blue-400">
                                            {health.metrics?.collection.last_5min || 0} records
                                        </div>
                                    </div>
                                    {/* Active Routes */}
                                    <div className="p-4 rounded-2xl border bg-purple-500/10 border-purple-500/20">
                                        <div className="text-sm text-zinc-400 mb-1">Active (1h)</div>
                                        <div className="font-bold text-purple-400">
                                            {health.metrics?.data_quality.distinct_routes_1h} routes, {health.metrics?.data_quality.distinct_vehicles_1h} buses
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Main Content Grid */}
                        <div className="grid lg:grid-cols-3 gap-8">
                            {/* Collection Metrics */}
                            <div className="lg:col-span-2 bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8">
                                <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                                    <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">📈</span>
                                    Collection Metrics
                                </h2>
                                <div className="grid md:grid-cols-2 gap-6">
                                    <MetricCard
                                        label="Last Hour"
                                        value={stats.collection_rate.last_hour.toLocaleString()}
                                        unit="records"
                                        color="emerald"
                                    />
                                    <MetricCard
                                        label="Last 24 Hours"
                                        value={stats.collection_rate.last_24h.toLocaleString()}
                                        unit="records"
                                        color="blue"
                                    />
                                    <MetricCard
                                        label="Vehicles Tracked"
                                        value={String(stats.vehicles_tracked)}
                                        unit="unique"
                                        color="purple"
                                    />
                                    <MetricCard
                                        label="Delayed Buses (24h)"
                                        value={`${stats.health.delayed_buses_24h_pct.toFixed(1)}%`}
                                        unit="of fleet"
                                        color={stats.health.delayed_buses_24h_pct < 10 ? 'emerald' : 'amber'}
                                    />
                                </div>
                            </div>

                            {/* Tech Stack */}
                            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8">
                                <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                                    <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">🔧</span>
                                    Tech Stack
                                </h2>
                                <div className="space-y-4">
                                    <TechRow icon="📡" name="Sentinel" desc="Custom Message Queue" />
                                    <TechRow icon="🗄️" name="PostgreSQL" desc="Time-series Storage" />
                                    <TechRow icon="🐍" name="Flask" desc="API Backend" />
                                    <TechRow icon="⚛️" name="React" desc="Frontend" />
                                    <TechRow icon="🚂" name="Railway" desc="Cloud Platform" />
                                </div>
                            </div>
                        </div>

                        {/* Timeline */}
                        <div className="mt-8 bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8">
                            <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                                <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">🕐</span>
                                Pipeline Timeline
                            </h2>
                            <div className="grid md:grid-cols-3 gap-6">
                                <TimelineCard
                                    label="First Collection"
                                    value={stats.timeline.first_collection ? new Date(stats.timeline.first_collection).toLocaleString() : 'N/A'}
                                />
                                <TimelineCard
                                    label="Latest Collection"
                                    value={stats.timeline.last_collection ? new Date(stats.timeline.last_collection).toLocaleString() : 'N/A'}
                                />
                                <TimelineCard
                                    label="Total Uptime"
                                    value={`${stats.timeline.uptime_hours} hours`}
                                    highlight
                                />
                            </div>
                        </div>
                    </>
                )}
            </main>

            {/* Footer */}
            <footer className="relative z-10 border-t border-white/5 mt-16">
                <div className="max-w-7xl mx-auto px-6 py-8 text-center text-zinc-500 text-sm">
                    Data collected via Sentinel → PostgreSQL • Auto-refreshes every 30 seconds
                </div>
            </footer>
        </div>
    );
}

function StatCard({ icon, value, label, gradient }: { icon: string; value: string; label: string; gradient: string }) {
    return (
        <div className="relative group">
            <div className={`absolute inset-0 bg-gradient-to-br ${gradient} rounded-3xl opacity-20 blur-xl group-hover:opacity-30 transition-opacity`} />
            <div className="relative bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 h-full">
                <div className="text-3xl mb-3">{icon}</div>
                <div className="text-3xl font-bold text-white mb-1">{value}</div>
                <div className="text-sm text-zinc-400">{label}</div>
            </div>
        </div>
    );
}

function MetricCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
    const colors: Record<string, string> = {
        emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
        blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
        purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
        amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    };

    return (
        <div className={`p-6 rounded-2xl border ${colors[color]}`}>
            <div className="text-sm text-zinc-400 mb-2">{label}</div>
            <div className="text-3xl font-bold">{value}</div>
            <div className="text-xs text-zinc-500 mt-1">{unit}</div>
        </div>
    );
}

function TechRow({ icon, name, desc }: { icon: string; name: string; desc: string }) {
    return (
        <div className="flex items-center gap-4 p-3 bg-white/5 rounded-xl">
            <span className="text-2xl">{icon}</span>
            <div>
                <div className="font-medium">{name}</div>
                <div className="text-sm text-zinc-400">{desc}</div>
            </div>
        </div>
    );
}

function TimelineCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className={`p-6 rounded-2xl text-center ${highlight ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-white/5'}`}>
            <div className="text-sm text-zinc-400 mb-2">{label}</div>
            <div className={`text-lg font-mono ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</div>
        </div>
    );
}
