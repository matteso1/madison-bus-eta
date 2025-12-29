import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  AreaChart,
  Area,
} from 'recharts';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { Sparkles, SlidersHorizontal, Activity, Compass, Target } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import './FlowStudio.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const FlowStudio = ({ apiBase = API_BASE }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({
    routeStats: [],
    heatmap: [],
    geoHeatmap: [],
    calibration: [],
  });
  const [selectedRoute, setSelectedRoute] = useState('');
  const [errorThreshold, setErrorThreshold] = useState(1.5);
  const [horizonIndex, setHorizonIndex] = useState(0);

  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      try {
        const [routeStats, heatmap, geoHeatmap, calibration] = await Promise.all([
          fetch(`${apiBase}/viz/route-stats`).then((r) => r.json()),
          fetch(`${apiBase}/viz/heatmap`).then((r) => r.json()),
          fetch(`${apiBase}/viz/geo-heatmap`).then((r) => r.json()),
          fetch(`${apiBase}/viz/calibration`).then((r) => r.json()),
        ]);
        if (mounted) {
          setData({ routeStats, heatmap, geoHeatmap, calibration });
          setSelectedRoute(routeStats?.[0]?.route || '');
          setHorizonIndex(calibration.length ? Math.min(2, calibration.length - 1) : 0);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError('Unable to load Flow Studio data. Ensure backend analytics endpoints are live.');
          setLoading(false);
        }
      }
    };
    fetchData();
    return () => {
      mounted = false;
    };
  }, [apiBase]);

  const scatterData = useMemo(
    () =>
      (data.routeStats || []).map((row) => ({
        route: row.route,
        reliability: row.reliability_score,
        volume: row.total_predictions,
        mae: row.mae,
      })),
    [data.routeStats],
  );

  const selectedRouteStats = scatterData.find((row) => row.route === selectedRoute);

  const routeHourlySeries = useMemo(() => {
    if (!selectedRoute) return [];
    return (data.heatmap || [])
      .filter((row) => row.route === selectedRoute)
      .map((row) => ({
        hour: row.hour,
        avg_error: row.error || row.avg_error || 0,
      }))
      .sort((a, b) => a.hour - b.hour);
  }, [data.heatmap, selectedRoute]);

  const geoFiltered = useMemo(() => {
    return (data.geoHeatmap || []).filter(
      (point) => (point.avg_error || 0) >= errorThreshold,
    );
  }, [data.geoHeatmap, errorThreshold]);

  const calibrationPoint = data.calibration[horizonIndex] || null;

  if (loading) {
    return (
      <div className="flow-loading">
        <Sparkles className="spin" size={24} />
        Building Flow Studio…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flow-error">
        <Target size={18} />
        {error}
      </div>
    );
  }

  return (
    <div className="flow-page">
      <section className="flow-hero">
        <div>
          <h2>Flow Studio</h2>
          <p>Interact with Madison’s transit dynamics: pick a route, trace its rhythm, surface hidden hotspots.</p>
        </div>
        <div className="flow-controls">
          <label>
            Focus route
            <select
              value={selectedRoute}
              onChange={(e) => setSelectedRoute(e.target.value)}
            >
              {scatterData.map((row) => (
                <option key={row.route} value={row.route}>
                  Route {row.route}
                </option>
              ))}
            </select>
          </label>
          <label>
            Hotspot filter ≥ {errorThreshold.toFixed(1)} min
            <input
              type="range"
              min="0.5"
              max="4"
              step="0.25"
              value={errorThreshold}
              onChange={(e) => setErrorThreshold(parseFloat(e.target.value))}
            />
          </label>
          <label>
            Horizon bucket
            <input
              type="range"
              min="0"
              max={Math.max(data.calibration.length - 1, 0)}
              value={horizonIndex}
              onChange={(e) => setHorizonIndex(Number(e.target.value))}
            />
          </label>
        </div>
      </section>

      <section className="flow-grid">
        <div className="flow-card">
          <div className="flow-card-header">
            <div>
              <h3>Route landscape</h3>
              <p>Reliability vs. volume across the network</p>
            </div>
            <Activity size={18} />
          </div>
          <div className="flow-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  dataKey="volume"
                  name="Predictions"
                  tickFormatter={(v) => new Intl.NumberFormat('en', { notation: 'compact' }).format(v)}
                />
                <YAxis
                  type="number"
                  dataKey="reliability"
                  name="Reliability"
                  domain={[0.6, 1]}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter data={scatterData} fill="#0f172a">
                  {scatterData.map((entry, idx) => (
                    <circle
                      key={`dot-${entry.route}`}
                      r={entry.route === selectedRoute ? 7 : 5}
                      fill={entry.route === selectedRoute ? '#6366f1' : '#0f172a'}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
              {selectedRouteStats ? (
            <div className="flow-meta">
              <div>
                <span>Route {selectedRouteStats.route}</span>
                    <strong>
                      {typeof selectedRouteStats.reliability === 'number'
                        ? `${(selectedRouteStats.reliability * 100).toFixed(1)}% on-time`
                        : '—'}
                    </strong>
              </div>
              <div>
                    Volume:{' '}
                    {typeof selectedRouteStats.volume === 'number'
                      ? selectedRouteStats.volume.toLocaleString()
                      : '—'}{' '}
                    records · MAE{' '}
                    {typeof selectedRouteStats.mae === 'number'
                      ? `${selectedRouteStats.mae.toFixed(2)} min`
                      : '—'}
              </div>
            </div>
              ) : (
                <div className="flow-meta">
                  <div>
                    <span>No route data yet</span>
                  </div>
                </div>
              )}
        </div>

        <div className="flow-card">
          <div className="flow-card-header">
            <div>
              <h3>Temporal fingerprint</h3>
              <p>Route {selectedRoute} hourly profile</p>
            </div>
            <Compass size={18} />
          </div>
          <div className="flow-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={routeHourlySeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="flowHourGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="avg_error"
                  stroke="#0ea5e9"
                  fill="url(#flowHourGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="flow-grid">
        <div className="flow-card full">
          <div className="flow-card-header">
            <div>
              <h3>Geo pressure map</h3>
              <p>
                Only showing stops where MAE ≥ {Number.isFinite(errorThreshold) ? errorThreshold.toFixed(1) : '—'} min
              </p>
            </div>
            <SlidersHorizontal size={18} />
          </div>
          <div className="flow-map">
            <MapContainer center={[43.0731, -89.4012]} zoom={12} style={{ height: '100%' }}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; OpenStreetMap contributors'
              />
              {geoFiltered.map((point, idx) => (
                <CircleMarker
                  key={idx}
                  center={[point.lat, point.lon]}
                  radius={4 + Math.min(point.avg_error || 0, 4) * 4}
                  pathOptions={{
                    color: '#f97316',
                    fillColor: '#f97316',
                    fillOpacity: 0.3 + Math.min(point.avg_error || 0, 4) / 4 * 0.5,
                  }}
                >
                  <Popup>
                    <strong>Stop hotspot</strong>
                    <br />
                    Avg error: {point.avg_error?.toFixed(2)} min
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>
      </section>

      <section className="flow-grid">
        <div className="flow-card">
          <div className="flow-card-header">
            <div>
              <h3>Horizon probe</h3>
              <p>How MAE evolves as we predict further out</p>
            </div>
          </div>
          <div className="flow-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.calibration} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="range"
                  tickFormatter={(value, index) => {
                    const bucket = data.calibration[index];
                    if (!bucket) return value;
                    const start = bucket.start ?? '?';
                    const end = bucket.end ?? '?';
                    return `${start}-${end}`;
                  }}
                />
                <YAxis />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="mae"
                  stroke="#0f172a"
                  strokeWidth={2}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {calibrationPoint && typeof calibrationPoint.mae === 'number' ? (
            <div className="flow-meta">
              <div>
                Focus bucket: {calibrationPoint.start}-{calibrationPoint.end} min
              </div>
              <strong>MAE {calibrationPoint.mae.toFixed(2)} min · n={calibrationPoint.count}</strong>
            </div>
          ) : (
            <div className="flow-meta">
              <div>No calibration data yet</div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default FlowStudio;

