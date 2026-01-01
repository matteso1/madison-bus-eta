import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart3, Database, Activity, Clock, Zap, X, RefreshCw, TrendingUp, Gauge } from 'lucide-react';

interface PipelineStats {
    db_connected: boolean;
    total_observations: {
        vehicles: number;
        predictions: number;
    };
    routes_tracked: number;
    vehicles_tracked: number;
    collection_rate: {
        last_hour: number;
        last_24h: number;
        per_minute_avg: number;
    };
    timeline: {
        first_collection: string | null;
        last_collection: string | null;
        uptime_hours: number;
    };
    health: {
        delayed_buses_24h_pct: number;
        is_collecting: boolean;
    };
    generated_at: string;
}

interface PipelineStatsPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'https://madison-bus-eta-production.up.railway.app';

export default function PipelineStatsPanel({ isOpen, onClose }: PipelineStatsPanelProps) {
    const [stats, setStats] = useState<PipelineStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    const fetchStats = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/pipeline-stats`);
            if (!res.ok) throw new Error('Failed to fetch stats');
            const data = await res.json();
            setStats(data);
            setLastRefresh(new Date());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchStats();
            // Auto-refresh every 30 seconds when panel is open
            const interval = setInterval(fetchStats, 30000);
            return () => clearInterval(interval);
        }
    }, [isOpen]);

    const formatNumber = (n: number) => n.toLocaleString();
    const formatTime = (iso: string | null) => {
        if (!iso) return 'N/A';
        const d = new Date(iso);
        return d.toLocaleString();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="fixed bottom-4 right-4 w-96 max-h-[80vh] overflow-y-auto bg-zinc-900/95 backdrop-blur-xl rounded-2xl border border-zinc-700/50 shadow-2xl z-50"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-zinc-700/50">
                        <div className="flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-emerald-400" />
                            <h2 className="text-lg font-semibold text-white">Pipeline Stats</h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={fetchStats}
                                disabled={loading}
                                className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-50"
                            >
                                <RefreshCw className={`w-4 h-4 text-zinc-300 ${loading ? 'animate-spin' : ''}`} />
                            </button>
                            <button
                                onClick={onClose}
                                className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
                            >
                                <X className="w-4 h-4 text-zinc-300" />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-4 space-y-4">
                        {error ? (
                            <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                                {error}
                            </div>
                        ) : !stats ? (
                            <div className="flex items-center justify-center py-8">
                                <RefreshCw className="w-6 h-6 text-zinc-500 animate-spin" />
                            </div>
                        ) : (
                            <>
                                {/* Connection Status */}
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${stats.health.is_collecting ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'}`} />
                                    <span className="text-sm text-zinc-400">
                                        {stats.health.is_collecting ? 'Actively collecting data' : 'Collection paused'}
                                    </span>
                                </div>

                                {/* Total Observations */}
                                <div className="grid grid-cols-2 gap-3">
                                    <StatCard
                                        icon={<Database className="w-4 h-4" />}
                                        label="Vehicle Obs"
                                        value={formatNumber(stats.total_observations.vehicles)}
                                        color="emerald"
                                    />
                                    <StatCard
                                        icon={<Activity className="w-4 h-4" />}
                                        label="Predictions"
                                        value={formatNumber(stats.total_observations.predictions)}
                                        color="blue"
                                    />
                                </div>

                                {/* Collection Rate */}
                                <div className="bg-zinc-800/50 rounded-xl p-3 space-y-2">
                                    <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
                                        <Zap className="w-4 h-4" />
                                        <span>Collection Rate</span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        <div>
                                            <div className="text-xl font-bold text-white">{stats.collection_rate.per_minute_avg}</div>
                                            <div className="text-xs text-zinc-500">per min</div>
                                        </div>
                                        <div>
                                            <div className="text-xl font-bold text-white">{formatNumber(stats.collection_rate.last_hour)}</div>
                                            <div className="text-xs text-zinc-500">last hour</div>
                                        </div>
                                        <div>
                                            <div className="text-xl font-bold text-white">{formatNumber(stats.collection_rate.last_24h)}</div>
                                            <div className="text-xs text-zinc-500">last 24h</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Infrastructure */}
                                <div className="grid grid-cols-2 gap-3">
                                    <StatCard
                                        icon={<TrendingUp className="w-4 h-4" />}
                                        label="Routes Tracked"
                                        value={String(stats.routes_tracked)}
                                        color="purple"
                                    />
                                    <StatCard
                                        icon={<Gauge className="w-4 h-4" />}
                                        label="Vehicles"
                                        value={String(stats.vehicles_tracked)}
                                        color="orange"
                                    />
                                </div>

                                {/* Timeline */}
                                <div className="bg-zinc-800/50 rounded-xl p-3 space-y-2">
                                    <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
                                        <Clock className="w-4 h-4" />
                                        <span>Timeline</span>
                                    </div>
                                    <div className="space-y-1 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500">First collection:</span>
                                            <span className="text-zinc-300">{formatTime(stats.timeline.first_collection)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500">Last collection:</span>
                                            <span className="text-zinc-300">{formatTime(stats.timeline.last_collection)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500">Uptime:</span>
                                            <span className="text-emerald-400 font-medium">{stats.timeline.uptime_hours} hours</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Health */}
                                <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-xl">
                                    <span className="text-sm text-zinc-400">Delayed Buses (24h)</span>
                                    <span className={`text-lg font-bold ${stats.health.delayed_buses_24h_pct < 5 ? 'text-emerald-400' : stats.health.delayed_buses_24h_pct < 15 ? 'text-yellow-400' : 'text-red-400'}`}>
                                        {stats.health.delayed_buses_24h_pct}%
                                    </span>
                                </div>

                                {/* Footer */}
                                {lastRefresh && (
                                    <div className="text-xs text-zinc-600 text-center">
                                        Updated: {lastRefresh.toLocaleTimeString()}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
    const colorClasses: Record<string, string> = {
        emerald: 'text-emerald-400 bg-emerald-400/10',
        blue: 'text-blue-400 bg-blue-400/10',
        purple: 'text-purple-400 bg-purple-400/10',
        orange: 'text-orange-400 bg-orange-400/10',
    };

    return (
        <div className="bg-zinc-800/50 rounded-xl p-3">
            <div className={`inline-flex p-1.5 rounded-lg ${colorClasses[color]} mb-2`}>
                {icon}
            </div>
            <div className="text-2xl font-bold text-white">{value}</div>
            <div className="text-xs text-zinc-500">{label}</div>
        </div>
    );
}
