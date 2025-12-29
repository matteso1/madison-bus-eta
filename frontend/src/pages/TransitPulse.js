import React, { useEffect, useState, useMemo } from 'react';
import { Activity, AlertTriangle, CloudRain, Loader2, MapPin, ShieldCheck, Zap } from 'lucide-react';
import './TransitPulse.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const formatNumber = (value) => {
  if (value === null || value === undefined) return '—';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
};

const relativeTime = (isoString) => {
  if (!isoString) return 'Unknown';
  const now = Date.now();
  const timestamp = Date.parse(isoString);
  if (Number.isNaN(timestamp)) return 'Unknown';
  const diffMinutes = Math.max(0, Math.round((now - timestamp) / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const hours = Math.round(diffMinutes / 60);
  return `${hours}h ago`;
};

const PulseMetric = ({ label, value, sublabel, icon: Icon, accent }) => (
  <div className={`pulse-metric ${accent || ''}`}>
    <div className="metric-icon">
      <Icon size={20} />
    </div>
    <div className="metric-body">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sublabel && <div className="metric-sublabel">{sublabel}</div>}
    </div>
  </div>
);

function TransitPulse({ apiBase = API_BASE }) {
  const [pulse, setPulse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const fetchPulse = async () => {
      try {
        const res = await fetch(`${apiBase}/pulse/overview`);
        if (!res.ok) {
          throw new Error(`Pulse endpoint returned ${res.status}`);
        }
        const data = await res.json();
        if (isMounted) {
          setPulse(data);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchPulse();
    const interval = setInterval(fetchPulse, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [apiBase]);

  const collectorStatus = pulse?.collector_status;
  const systemOverview = pulse?.system_overview;
  const alertsPayload = pulse?.alerts;
  const analytics = pulse?.analytics || {};

  const apiUsagePercent = collectorStatus?.api_usage?.usage_percent || 0;
  const apiUsageLabel = `${collectorStatus?.api_usage?.daily_calls || 0}/${collectorStatus?.api_usage?.max_daily_calls || 0} calls`;

  const anomalies = useMemo(() => {
    if (!analytics?.anomalies) return [];
    if (Array.isArray(analytics.anomalies)) return analytics.anomalies;
    if (Array.isArray(analytics.anomalies?.anomalies)) return analytics.anomalies.anomalies;
    return [];
  }, [analytics]);

  if (loading) {
    return (
      <div className="pulse-loading">
        <Loader2 className="spin" size={28} />
        Loading live system pulse...
      </div>
    );
  }

  if (error) {
    return (
      <div className="pulse-error">
        <AlertTriangle size={20} />
        {error}
      </div>
    );
  }

  return (
    <div className="pulse-page">
      <section className="pulse-hero-grid">
        <PulseMetric
          label="Routes tracked"
          value={formatNumber(systemOverview?.total_routes)}
          sublabel="Live + historical"
          icon={MapPin}
        />
        <PulseMetric
          label="Predictions analyzed"
          value={formatNumber(systemOverview?.total_predictions)}
          sublabel="Historical dataset size"
          icon={Activity}
        />
        <PulseMetric
          label="System reliability"
          value={
            systemOverview?.system_reliability
              ? `${(systemOverview.system_reliability * 100).toFixed(1)}%`
              : '—'
          }
          sublabel="ML-adjusted accuracy"
          icon={ShieldCheck}
        />
        <PulseMetric
          label="Active alerts"
          value={alertsPayload?.summary?.total_active ?? '0'}
          sublabel="Detours, events, weather"
          icon={AlertTriangle}
          accent={alertsPayload?.summary?.total_active ? 'warn' : ''}
        />
      </section>

      <section className="pulse-grid">
        <div className="pulse-card">
          <div className="pulse-card-header">
            <div>
              <h3>Collector Health</h3>
              <p>Real-time telemetry from the data ingestion service</p>
            </div>
            <span className={`status-pill ${collectorStatus?.collector_running ? 'ok' : 'warn'}`}>
              {collectorStatus?.collector_running ? 'Running' : 'Offline'}
            </span>
          </div>

          <div className="collector-metrics">
            <div>
              <div className="metric-label">Unique stops sampled</div>
              <div className="metric-figure">
                {formatNumber(collectorStatus?.stats?.unique_stops_sampled)}
              </div>
            </div>
            <div>
              <div className="metric-label">Prediction rows collected</div>
              <div className="metric-figure">
                {formatNumber(collectorStatus?.stats?.prediction_records_collected)}
              </div>
            </div>
            <div>
              <div className="metric-label">Last cycle</div>
              <div className="metric-figure">
                {collectorStatus?.recent_cycle?.last_prediction_count || 0} preds ·{' '}
                {collectorStatus?.recent_cycle?.last_vehicle_count || 0} vehicles
              </div>
            </div>
          </div>

          <div className="api-usage">
            <div className="api-usage-label">
              <Zap size={16} />
              API quota usage ({apiUsageLabel})
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.min(apiUsagePercent, 100)}%` }}
              />
            </div>
            <div className="api-usage-meta">
              Last updated {relativeTime(collectorStatus?.last_updated)}
            </div>
          </div>
        </div>

        <div className="pulse-card">
          <div className="pulse-card-header">
            <div>
              <h3>Alert Radar</h3>
              <p>Official GTFS-RT alerts currently impacting service</p>
            </div>
            {!alertsPayload?.available && <span className="status-pill warn">Offline</span>}
          </div>
          {alertsPayload?.available ? (
            <>
              <div className="alert-summary-grid">
                <div>
                  <div className="metric-label">Detours</div>
                  <div className="metric-figure">
                    {alertsPayload?.summary?.detours ?? 0}
                  </div>
                </div>
                <div>
                  <div className="metric-label">Events</div>
                  <div className="metric-figure">
                    {alertsPayload?.summary?.events ?? 0}
                  </div>
                </div>
                <div>
                  <div className="metric-label">Weather</div>
                  <div className="metric-figure">
                    {alertsPayload?.summary?.weather ?? 0}
                  </div>
                </div>
                <div>
                  <div className="metric-label">Construction</div>
                  <div className="metric-figure">
                    {alertsPayload?.summary?.construction ?? 0}
                  </div>
                </div>
              </div>
              <div className="alert-list">
                {(alertsPayload?.recent_alerts || []).map((alert) => (
                  <div key={alert.id} className="alert-row">
                    <div className="alert-icon">
                      <CloudRain size={16} />
                    </div>
                    <div>
                      <div className="alert-title">{alert.header || 'Service alert'}</div>
                      <div className="alert-meta">
                        {alert.routes && alert.routes.length > 0
                          ? `Routes: ${alert.routes.join(', ')}`
                          : 'System-wide'}
                      </div>
                    </div>
                  </div>
                ))}
                {(!alertsPayload?.recent_alerts || alertsPayload.recent_alerts.length === 0) && (
                  <div className="no-data">No active alerts 🎉</div>
                )}
              </div>
            </>
          ) : (
            <div className="no-data">GTFS-RT alerts feed unavailable.</div>
          )}
        </div>
      </section>

      <section className="pulse-grid">
        <div className="pulse-card">
          <div className="pulse-card-header">
            <div>
              <h3>Routes to Watch</h3>
              <p>Top performers vs. routes with elevated delays</p>
            </div>
          </div>
          <div className="routes-grid">
            <div>
              <h4>Most reliable</h4>
              <ul className="route-list">
                {(analytics.top_routes || []).map((route) => (
                  <li key={route.route}>
                    <span className="route-id">{route.route}</span>
                    <span>{(route.reliability_score * 100).toFixed(1)}% reliable</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Needs attention</h4>
              <ul className="route-list warn">
                {(analytics.routes_to_watch || []).map((route) => (
                  <li key={route.route}>
                    <span className="route-id">{route.route}</span>
                    <span>{(route.reliability_score * 100).toFixed(1)}% reliable</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="pulse-card">
          <div className="pulse-card-header">
            <div>
              <h3>Anomaly Scanner</h3>
              <p>Recent route-hour pairs with unusual error spikes</p>
            </div>
          </div>
          {anomalies.length > 0 ? (
            <ul className="anomaly-list">
              {anomalies.map((item, idx) => (
                <li key={idx}>
                  <div>
                    <div className="anomaly-route">Route {item.route}</div>
                    <div className="anomaly-detail">
                      {item.hour !== undefined ? `${item.hour}:00 hour` : 'All day'}
                    </div>
                  </div>
                  <div className="anomaly-metric">
                    {(item.mean_error || item.std_error || 0).toFixed(2)} min
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="no-data">No anomalies detected in the latest window.</div>
          )}
        </div>
      </section>
    </div>
  );
}

export default TransitPulse;

