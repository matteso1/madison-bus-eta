import { useEffect, useState } from 'react';
import axios from 'axios';

interface RouteCount {
  rt: string;
  event_count: number;
  last_seen: string | null;
}

interface RecentEvent {
  rt: string;
  vid_a: string;
  vid_b: string;
  dist_km: number;
  detected_at: string | null;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function BunchingTab() {
  const [routes, setRoutes] = useState<RouteCount[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    axios.get(`${API_BASE}/api/bunching/summary`).then(res => {
      setRoutes(res.data.routes || []);
      setTotal(res.data.total_events || 0);
    }).catch(() => {});

    axios.get(`${API_BASE}/api/bunching/recent`).then(res => {
      setEvents((res.data.events || []).slice(0, 10));
    }).catch(() => {});
  }, [API_BASE]);

  const maxCount = routes.length > 0 ? routes[0].event_count : 1;

  return (
    <div className="fade-in" style={{ padding: '14px' }}>
      <div style={{
        fontSize: 10,
        color: 'var(--text-secondary)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        marginBottom: 12,
      }}>
        Bus Bunching
      </div>

      {/* Summary metric */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '10px 14px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
      }}>
        <span className="data-num" style={{ fontSize: 22, color: 'var(--warning)' }}>
          {total}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          events in the last 7 days
        </span>
      </div>

      {/* Per-route bars */}
      {routes.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 10,
            color: 'var(--text-secondary)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            By Route
          </div>
          {routes.map(r => (
            <div key={r.rt} style={{ marginBottom: 7 }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 3,
              }}>
                <span style={{
                  fontSize: 10,
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-data)',
                }}>
                  Route {r.rt}
                </span>
                <span className="data-num" style={{ fontSize: 10, color: 'var(--warning)' }}>
                  {r.event_count}
                </span>
              </div>
              <div style={{
                height: 4,
                background: 'var(--border)',
                borderRadius: 2,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.round((r.event_count / maxCount) * 100)}%`,
                  background: 'var(--warning)',
                  borderRadius: 2,
                  transition: 'width 0.3s',
                }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent feed */}
      {events.length > 0 && (
        <div>
          <div style={{
            fontSize: 10,
            color: 'var(--text-secondary)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            Recent Events
          </div>
          {events.map((e, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: i < events.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 9,
                  background: 'rgba(245,158,11,0.15)',
                  color: 'var(--warning)',
                  border: '1px solid rgba(245,158,11,0.3)',
                  borderRadius: 3,
                  padding: '1px 5px',
                  fontFamily: 'var(--font-data)',
                }}>
                  {e.rt}
                </span>
                <span className="data-num" style={{ fontSize: 10, color: 'var(--text-primary)' }}>
                  {e.vid_a} / {e.vid_b}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="data-num" style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                  {e.dist_km}km
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                  {relativeTime(e.detected_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {routes.length === 0 && events.length === 0 && (
        <div style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          textAlign: 'center',
          padding: '20px 0',
          lineHeight: 1.6,
        }}>
          No bunching data yet.
          <br />
          Events accumulate as buses run.
        </div>
      )}
    </div>
  );
}
