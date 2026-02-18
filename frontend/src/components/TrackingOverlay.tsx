import { useEffect, useState } from 'react';
import axios from 'axios';
import type { TrackedBus, VehicleData } from './MapView';

interface TrackingOverlayProps {
    trackedBus: TrackedBus;
    vehicles: VehicleData[];
    onStopTracking: () => void;
}

export default function TrackingOverlay({ trackedBus, vehicles, onStopTracking }: TrackingOverlayProps) {
    const [eta, setEta] = useState<{ low: number; median: number; high: number } | null>(null);
    const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

    const vehicle = vehicles.find(v => v.vid === trackedBus.vid);
    const vehicleFound = !!vehicle;

    useEffect(() => {
        if (!vehicleFound) return;
        const fetchEta = async () => {
            try {
                let apiMinutes = 10;
                try {
                    const predRes = await axios.get(`${API_BASE}/predictions?stpid=${trackedBus.stopId}`);
                    const prdData = predRes.data?.['bustime-response']?.prd;
                    const prds = Array.isArray(prdData) ? prdData : prdData ? [prdData] : [];
                    const match = prds.find((p: any) => p.vid === trackedBus.vid);
                    if (match) {
                        apiMinutes = match.prdctdn === 'DUE' ? 0 : (parseInt(match.prdctdn) || 10);
                    }
                } catch { /* use fallback */ }

                const res = await axios.post(`${API_BASE}/api/predict-arrival-v2`, {
                    route: trackedBus.route,
                    stop_id: trackedBus.stopId,
                    vehicle_id: trackedBus.vid,
                    api_prediction: apiMinutes,
                });
                if (res.data?.eta_low_min != null) {
                    setEta({
                        low: Math.round(res.data.eta_low_min),
                        median: Math.round(res.data.eta_median_min),
                        high: Math.round(res.data.eta_high_min),
                    });
                }
            } catch {}
        };
        fetchEta();
        const timer = setInterval(fetchEta, 15000);
        return () => clearInterval(timer);
    }, [vehicleFound, trackedBus.vid, trackedBus.route, trackedBus.stopId, API_BASE]);

    if (!vehicle) {
        return (
            <div className="tracking-overlay">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        Bus not found on network
                    </div>
                    <button onClick={onStopTracking} style={stopBtnStyle}>
                        Stop Tracking
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="tracking-overlay">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div className="live-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--signal)' }} />
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-data)', letterSpacing: '0.1em', color: 'var(--signal)' }}>
                            TRACKING LIVE
                        </span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                        Route {trackedBus.route} &rarr; {trackedBus.stopName}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {vehicle.des} &middot; VID {vehicle.vid}
                    </div>
                </div>
                <button onClick={onStopTracking} style={stopBtnStyle}>
                    Stop
                </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1 }}>
                    {eta ? (
                        <>
                            <div className="data-num" style={{ fontSize: 36, fontWeight: 700, color: 'var(--signal)', lineHeight: 1, letterSpacing: '-0.02em' }}>
                                {eta.median}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                                min &middot; {eta.low}&ndash;{eta.high} range
                            </div>
                        </>
                    ) : (
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            Calculating...
                        </div>
                    )}
                </div>

                <div style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    background: vehicle.dly ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
                    border: `1px solid ${vehicle.dly ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
                }}>
                    <div className="data-num" style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: vehicle.dly ? 'var(--danger)' : 'var(--success)',
                    }}>
                        {vehicle.dly ? 'DELAYED' : 'ON TIME'}
                    </div>
                </div>
            </div>

            <div style={{ marginTop: 12, height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{
                    height: '100%',
                    borderRadius: 2,
                    background: 'var(--signal)',
                    width: eta ? `${Math.max(10, Math.min(90, 100 - (eta.median / 30) * 100))}%` : '10%',
                    transition: 'width 1s ease',
                }} />
            </div>
        </div>
    );
}

const stopBtnStyle: React.CSSProperties = {
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8,
    color: '#ef4444',
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 14px',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    flexShrink: 0,
};
