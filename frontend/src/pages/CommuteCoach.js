import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { Target, Clock, ShieldCheck, Activity, Loader2 } from 'lucide-react';
import './CommuteCoach.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const CommuteCoach = ({ apiBase = API_BASE }) => {
  const [routes, setRoutes] = useState([]);
  const [routeStats, setRouteStats] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState('');
  const [stopId, setStopId] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [walkBuffer, setWalkBuffer] = useState(5);
  const [riskTolerance, setRiskTolerance] = useState(0.5);
  const [result, setResult] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    const loadInitial = async () => {
      try {
        const [routesRes, statsRes] = await Promise.all([
          fetch(`${apiBase}/routes`).then((r) => r.json()),
          fetch(`${apiBase}/viz/route-stats`).then((r) => r.json()),
        ]);
        if (!mounted) return;
        const routesList = routesRes['bustime-response']?.routes || [];
        setRoutes(routesList);
        setRouteStats(statsRes || []);
        setSelectedRoute(routesList[0]?.rt || '');
      } catch (err) {
        if (mounted) setError('Unable to load routes. Ensure backend is running.');
      }
    };
    loadInitial();
    return () => {
      mounted = false;
    };
  }, [apiBase]);

  const selectedRouteStat = useMemo(
    () => routeStats.find((stat) => stat.route === selectedRoute),
    [routeStats, selectedRoute],
  );

  const handlePlan = async () => {
    if (!selectedRoute || !stopId) {
      setError('Please choose a route and enter a stop ID.');
      return;
    }
    setLoadingPlan(true);
    setError(null);
    setResult(null);
    try {
      const predictionsRes = await fetch(`${apiBase}/predictions?stpid=${stopId}`);
      const predictionsData = await predictionsRes.json();
      const prds = predictionsData['bustime-response']?.prd || [];
      const filtered = prds
        .filter((prd) => String(prd.rt) === String(selectedRoute))
        .map((prd) => ({
          ...prd,
          minutes: Number(prd.prdctdn),
        }))
        .sort((a, b) => a.minutes - b.minutes);

      if (filtered.length === 0) {
        setError('No upcoming predictions for that route/stop. Try another stop.');
        setLoadingPlan(false);
        return;
      }

      const primary = filtered[0];
      const now = new Date();
      const payload = {
        route: selectedRoute,
        stop_id: stopId,
        api_prediction: primary.minutes,
        hour: now.getHours(),
        day_of_week: now.getDay(),
      };

      const mlRes = await fetch(`${apiBase}/predict/enhanced`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let mlData = null;
      if (mlRes.ok) {
        mlData = await mlRes.json();
      }

      const mlMinutes = mlData?.predicted_minutes ?? primary.minutes;
      const improvement = mlData?.improvement_percent ?? 0;
      const confidence = mlData?.confidence ?? 0.75;

      const targetArrival = arrivalTime ? new Date(arrivalTime) : null;
      const riskBufferMinutes = (1 - riskTolerance) * 5; // up to 5-minute cushion
      const adjustedMinutes = Math.max(1, mlMinutes + riskBufferMinutes);
      const leaveAt = new Date(Date.now() + (adjustedMinutes - walkBuffer) * 60000);

      setResult({
        apiMinutes: primary.minutes,
        mlMinutes,
        improvement,
        confidence,
        schedule: {
          leave: leaveAt,
          board: new Date(Date.now() + mlMinutes * 60000),
          arrive: targetArrival,
        },
        predictions: filtered.slice(0, 3),
      });
    } catch (err) {
      setError('Failed to compute plan. Try again.');
    } finally {
      setLoadingPlan(false);
    }
  };

  const timelineData = result
    ? [
        { label: 'Now', minutes: 0 },
        { label: 'API ETA', minutes: result.apiMinutes },
        { label: 'ML ETA', minutes: result.mlMinutes },
      ]
    : [];

  return (
    <div className="coach-page">
      <section className="coach-hero">
        <div>
          <h2>Commute Coach</h2>
          <p>Plug in your route, stop, and arrival target—get a confidence-weighted plan with ML-corrected ETAs.</p>
        </div>
        <div className="coach-inputs">
          <label>
            Route
            <select value={selectedRoute} onChange={(e) => setSelectedRoute(e.target.value)}>
              {routes.map((route) => (
                <option key={route.rt} value={route.rt}>
                  {route.rtnm} ({route.rt})
                </option>
              ))}
            </select>
          </label>
          <label>
            Stop ID
            <input
              type="text"
              placeholder="e.g. 10086"
              value={stopId}
              onChange={(e) => setStopId(e.target.value)}
            />
          </label>
          <label>
            Need to arrive by
            <input
              type="datetime-local"
              value={arrivalTime}
              onChange={(e) => setArrivalTime(e.target.value)}
            />
          </label>
          <label>
            Walk buffer (min)
            <input
              type="number"
              min={0}
              max={15}
              value={walkBuffer}
              onChange={(e) => setWalkBuffer(Number(e.target.value))}
            />
          </label>
          <label>
            Risk tolerance ({Math.round(riskTolerance * 100)}%)
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={riskTolerance}
              onChange={(e) => setRiskTolerance(parseFloat(e.target.value))}
            />
          </label>
          <button className="plan-btn" onClick={handlePlan} disabled={loadingPlan}>
            {loadingPlan ? <Loader2 className="spin" size={18} /> : <Target size={18} />}
            Plan Departure
          </button>
        </div>
      </section>

      {error && (
        <div className="coach-error">
          <Activity size={18} />
          {error}
        </div>
      )}

      {result && (
        <section className="coach-grid">
          <div className="coach-card">
            <div className="coach-card-header">
              <h3>Timeline</h3>
              <Clock size={18} />
            </div>
            <div className="coach-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" />
                  <YAxis domain={[0, Math.max(result.mlMinutes + 5, 10)]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="minutes" stroke="#0ea5e9" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="coach-metrics">
              <div>
                <span>Leave by</span>
                <strong>{result.schedule.leave.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
              </div>
              <div>
                <span>Board around</span>
                <strong>{result.schedule.board.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
              </div>
              {result.schedule.arrive && (
                <div>
                  <span>Target arrival</span>
                  <strong>
                    {new Date(result.schedule.arrive).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </strong>
                </div>
              )}
            </div>
          </div>

          <div className="coach-card">
            <div className="coach-card-header">
              <h3>Confidence dial</h3>
              <ShieldCheck size={18} />
            </div>
            <div className="confidence-meter">
              <div className="meter-track">
                <div className="meter-fill" style={{ width: `${result.confidence * 100}%` }} />
              </div>
              <div className="meter-label">{Math.round(result.confidence * 100)}% confident</div>
              <p>
                ML trimmed <strong>{result.improvement?.toFixed?.(1) ?? '0.0'}%</strong> error vs. Madison Metro API for this route.
              </p>
            </div>
            {selectedRouteStat && (
              <div className="route-context">
                <div>
                  <span>Route reliability</span>
                  <strong>{(selectedRouteStat.reliability_score * 100).toFixed(1)}%</strong>
                </div>
                <div>
                  <span>Dataset volume</span>
                  <strong>{selectedRouteStat.total_predictions.toLocaleString()} records</strong>
                </div>
              </div>
            )}
          </div>

          <div className="coach-card">
            <div className="coach-card-header">
              <h3>Upcoming vehicles</h3>
              <Activity size={18} />
            </div>
            <ul className="forecast-list">
              {result.predictions.map((prd, idx) => (
                <li key={idx}>
                  <div>
                    <strong>{prd.des || 'Destination'}</strong>
                    <span>{prd.prdtm}</span>
                  </div>
                  <div className="forecast-mins">{prd.minutes} min</div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
};

export default CommuteCoach;

