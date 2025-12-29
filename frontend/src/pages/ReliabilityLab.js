import React, { useEffect, useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { AlertCircle, Activity, Flame, MapPin, TrendingUp } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import './ReliabilityLab.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const ReliabilityLab = ({ apiBase = API_BASE }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState({
    routeStats: [],
    dayOfWeek: [],
    heatmap: [],
    geoHeatmap: [],
    calibration: [],
    anomalies: [],
  });

  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      try {
        const [
          routeStats,
          dayOfWeek,
          heatmap,
          geoHeatmap,
          calibration,
          anomalies,
        ] = await Promise.all([
          fetch(`${apiBase}/viz/route-stats`).then((r) => r.json()),
          fetch(`${apiBase}/viz/day-of-week`).then((r) => r.json()),
          fetch(`${apiBase}/viz/heatmap`).then((r) => r.json()),
          fetch(`${apiBase}/viz/geo-heatmap`).then((r) => r.json()),
          fetch(`${apiBase}/viz/calibration`).then((r) => r.json()),
          fetch(`${apiBase}/viz/anomalies`).then((r) => r.json()).catch(() => []),
        ]);

        if (mounted) {
          setPayload({
            routeStats,
            dayOfWeek,
            heatmap,
            geoHeatmap,
            calibration,
            anomalies: Array.isArray(anomalies) ? anomalies : anomalies?.anomalies || [],
          });
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError('Failed to load reliability data. Ensure backend is running.');
          setLoading(false);
        }
      }
    };
    fetchData();
    return () => {
      mounted = false;
    };
  }, [apiBase]);

  const heroMetrics = useMemo(() => {
    if (!payload.routeStats || payload.routeStats.length === 0) {
      return null;
    }
    const sortedByReliability = [...payload.routeStats].sort(
      (a, b) => b.reliability_score - a.reliability_score,
    );
    const best = sortedByReliability[0];
    const worst = sortedByReliability[sortedByReliability.length - 1];

    const groupedHours = payload.heatmap.reduce((acc, cur) => {
      const hour = cur.hour;
      if (!acc[hour]) {
        acc[hour] = { hour, total: 0, count: 0 };
      }
      acc[hour].total += cur.error || cur.avg_error || 0;
      acc[hour].count += 1;
      return acc;
    }, {});
    const hourAgg = Object.values(groupedHours).map((item) => ({
      hour: item.hour,
      avg_error: item.total / (item.count || 1),
    }));
    const worstHour = hourAgg.sort((a, b) => b.avg_error - a.avg_error)[0];

    return {
      bestRoute: best,
      worstRoute: worst,
      worstHour,
      totalRoutes: payload.routeStats.length,
    };
  }, [payload.routeStats, payload.heatmap]);

  const hourlySeries = useMemo(() => {
    const grouped = payload.heatmap.reduce((acc, cur) => {
      if (!acc[cur.hour]) {
        acc[cur.hour] = { hour: cur.hour, total: 0, count: 0 };
      }
      acc[cur.hour].total += cur.error || cur.avg_error || 0;
      acc[cur.hour].count += 1;
      return acc;
    }, {});
    return Object.values(grouped)
      .map((v) => ({
        hour: v.hour,
        avg_error: v.total / (v.count || 1),
      }))
      .sort((a, b) => a.hour - b.hour);
  }, [payload.heatmap]);

  const daySeries = useMemo(() => {
    return (payload.dayOfWeek || []).map((d) => ({
      day_name: d.day_name,
      avg_error: d.avg_error,
    }));
  }, [payload.dayOfWeek]);

  if (loading) {
    return (
      <div className="lab-loading">
        <Activity className="spin" size={24} />
        Crunching route reliability…
      </div>
    );
  }

  if (error) {
    return (
      <div className="lab-error">
        <AlertCircle size={20} />
        {error}
      </div>
    );
  }

  return (
    <div className="lab-page">
      <section className="lab-hero">
        <div className="lab-hero-text">
          <h2>Reliability Lab</h2>
          <p>
            A curated view of when, where, and why Madison Metro performance shifts—grounded in 200k+
            predictions and live GTFS alerts.
          </p>
        </div>
        <div className="lab-hero-actions">
          <span>Need every chart?</span>
          <button
            onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}
          >
            Jump to Legacy Analytics
          </button>
        </div>
      </section>

      {heroMetrics && (
        <section className="lab-metric-grid">
          <div className="lab-metric-card">
            <div className="metric-label">Most reliable route</div>
            <div className="metric-value">Route {heroMetrics.bestRoute.route}</div>
            <div className="metric-sub">
              {(heroMetrics.bestRoute.reliability_score * 100).toFixed(1)}% on-time
            </div>
          </div>
          <div className="lab-metric-card warn">
            <div className="metric-label">Route needing love</div>
            <div className="metric-value">Route {heroMetrics.worstRoute.route}</div>
            <div className="metric-sub">
              {(heroMetrics.worstRoute.reliability_score * 100).toFixed(1)}% on-time
            </div>
          </div>
          <div className="lab-metric-card">
            <div className="metric-label">Spiciest hour</div>
            <div className="metric-value">
              {heroMetrics.worstHour ? `${heroMetrics.worstHour.hour}:00` : '—'}
            </div>
            <div className="metric-sub">
              {heroMetrics.worstHour
                ? `${heroMetrics.worstHour.avg_error.toFixed(2)} min average error`
                : 'N/A'}
            </div>
          </div>
          <div className="lab-metric-card">
            <div className="metric-label">Routes monitored</div>
            <div className="metric-value">{heroMetrics.totalRoutes}</div>
            <div className="metric-sub">Live + historical coverage</div>
          </div>
        </section>
      )}

      <section className="lab-grid">
        <div className="lab-card">
          <div className="lab-card-header">
            <div>
              <h3>Daily rhythm</h3>
              <p>Which days consistently run hot or smooth?</p>
            </div>
            <TrendingUp size={18} />
          </div>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daySeries} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="day_name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="avg_error" fill="#0f172a" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lab-card">
          <div className="lab-card-header">
            <div>
              <h3>Rush hour penalty</h3>
              <p>Average mean absolute error by hour of day</p>
            </div>
            <Flame size={18} />
          </div>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlySeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="hourGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="avg_error"
                  stroke="#db2777"
                  fill="url(#hourGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="lab-grid">
        <div className="lab-card full">
          <div className="lab-card-header">
            <div>
              <h3>Delay hotspots</h3>
              <p>Locations where MAE spikes. Size = severity.</p>
            </div>
            <MapPin size={18} />
          </div>
          <div className="lab-map">
            <MapContainer center={[43.0731, -89.4012]} zoom={12} style={{ height: '100%' }}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; OpenStreetMap contributors'
              />
              {(payload.geoHeatmap || []).map((point, idx) => {
                const radius = 4 + Math.min(point.avg_error || 0, 4) * 4;
                const opacity = Math.min((point.avg_error || 0) / 4, 1);
                return (
                  <CircleMarker
                    key={idx}
                    center={[point.lat, point.lon]}
                    radius={radius}
                    pathOptions={{
                      color: '#ef4444',
                      fillColor: '#ef4444',
                      fillOpacity: 0.3 + opacity * 0.5,
                    }}
                  >
                    <Popup>
                      <strong>Hotspot</strong>
                      <br />
                      Avg error: {point.avg_error?.toFixed(2)} min
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
        </div>
      </section>

      <section className="lab-grid">
        <div className="lab-card">
          <div className="lab-card-header">
            <div>
              <h3>Calibration ladder</h3>
              <p>Model accuracy vs. prediction horizon</p>
            </div>
          </div>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={payload.calibration} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="start" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="mae" stroke="#0f172a" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lab-card">
          <div className="lab-card-header">
            <div>
              <h3>Anomaly ticker</h3>
              <p>Latest route-hour pairs with unusual variance</p>
            </div>
          </div>
          <ul className="lab-anomaly-list">
            {payload.anomalies.slice(0, 5).map((item, idx) => (
              <li key={idx}>
                <div>
                  <div className="anomaly-title">Route {item.route}</div>
                  <div className="anomaly-meta">
                    {item.hour !== undefined ? `${item.hour}:00 hour` : 'System-wide'}
                  </div>
                </div>
                <div className="anomaly-value">
                  {(item.mean_error || item.std_error || 0).toFixed(2)} min
                </div>
              </li>
            ))}
            {payload.anomalies.length === 0 && (
              <li className="no-data">No anomalies detected in the latest window.</li>
            )}
          </ul>
        </div>
      </section>

      <section className="lab-legacy-card">
        <h3>Need every chart?</h3>
        <p>The original analytics explorer is still available for exhaustive breakdowns.</p>
        <button
          onClick={() => {
            const explorerSection = document.getElementById('legacy-analytics');
            if (explorerSection) explorerSection.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          Scroll to Legacy Explorer
        </button>
      </section>

      <div id="legacy-analytics" style={{ marginTop: '2rem' }}>
        <DataExplorerShim />
      </div>
    </div>
  );
};

const DataExplorerShim = () => {
  return (
    <div className="legacy-shim">
      <h3>Legacy Analytics Explorer</h3>
      <p>
        The full analytics experience (204k records, 15+ charts) still lives here for deep dives.
        Toggle back to the “Full Analytics” tab to interact with every visualization.
      </p>
    </div>
  );
};

export default ReliabilityLab;

