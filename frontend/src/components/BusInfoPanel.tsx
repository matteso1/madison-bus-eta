import { useEffect, useState } from 'react';
import axios from 'axios';
import type { BusClickEvent, TrackedBus } from './MapView';

interface NextStop {
    stpnm: string;
    stpid: string;
    eta: string;
    minutes: number;
    lat: number;
    lon: number;
}

interface BusInfoPanelProps {
    bus: BusClickEvent;
    onClose: () => void;
    onTrackBus?: (bus: TrackedBus) => void;
}

export default function BusInfoPanel({ bus, onClose, onTrackBus }: BusInfoPanelProps) {
    const [nextStops, setNextStops] = useState<NextStop[]>([]);
    const [loading, setLoading] = useState(true);
    const API_BASE = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setNextStops([]);

        const load = async () => {
            try {
                const res = await axios.get(`${API_BASE}/predictions?vid=${bus.vid}`);
                const prdArray = res.data?.['bustime-response']?.prd || [];
                const prds = Array.isArray(prdArray) ? prdArray : [prdArray];

                if (!cancelled) {
                    setNextStops(prds.map((p: any) => ({
                        stpnm: p.stpnm || 'Unknown',
                        stpid: String(p.stpid),
                        eta: p.prdctdn === 'DUE' ? 'DUE' : `${p.prdctdn} min`,
                        minutes: p.prdctdn === 'DUE' ? 0 : (parseInt(p.prdctdn) || 0),
                        lat: parseFloat(p.stplat) || 0,
                        lon: parseFloat(p.stplon) || 0,
                    })));
                }
            } catch (e) {
                console.error('Bus info fetch error:', e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        const timer = setInterval(load, 15000);
        return () => { cancelled = true; clearInterval(timer); };
    }, [bus.vid, API_BASE]);

    const handleTrack = (stop: NextStop) => {
        if (!onTrackBus) return;
        onTrackBus({
            vid: bus.vid,
            route: bus.route,
            stopId: stop.stpid,
            stopName: stop.stpnm,
            stopPosition: stop.lat && stop.lon ? [stop.lon, stop.lat] : undefined,
        });
        onClose();
    };

    return (
        <div style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            width: 340,
            maxHeight: 400,
            background: 'rgba(8, 8, 16, 0.96)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            zIndex: 20,
            fontFamily: 'Inter, system-ui, sans-serif',
        }}>
            {/* Header */}
            <div style={{
                padding: '14px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
            }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{
                            fontSize: 18,
                            fontWeight: 700,
                            color: '#00d4ff',
                        }}>
                            Route {bus.route}
                        </span>
                        <span style={{
                            fontSize: 9,
                            padding: '2px 6px',
                            borderRadius: 3,
                            background: bus.delayed ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
                            color: bus.delayed ? '#ef4444' : '#10b981',
                            fontFamily: 'JetBrains Mono, monospace',
                            fontWeight: 600,
                        }}>
                            {bus.delayed ? 'DELAYED' : 'ON TIME'}
                        </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 500 }}>
                        → {bus.destination}
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                        Bus {bus.vid}
                    </div>
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background: 'none',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        color: '#94a3b8',
                        cursor: 'pointer',
                        padding: '3px 8px',
                        fontSize: 11,
                    }}
                >
                    ✕
                </button>
            </div>

            {/* Next Stops */}
            <div style={{
                padding: '8px 0',
                maxHeight: 280,
                overflowY: 'auto',
            }}>
                <div style={{
                    fontSize: 9,
                    color: '#64748b',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    padding: '4px 16px 8px',
                }}>
                    Next Stops
                </div>

                {loading ? (
                    <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 12, textAlign: 'center' }}>
                        Loading...
                    </div>
                ) : nextStops.length === 0 ? (
                    <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 12, textAlign: 'center' }}>
                        No upcoming stops
                    </div>
                ) : (
                    nextStops.map((stop, i) => (
                        <div
                            key={`${stop.stpid}-${i}`}
                            onClick={() => handleTrack(stop)}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '10px 16px',
                                cursor: 'pointer',
                                borderLeft: i === 0 ? '3px solid #00d4ff' : '3px solid transparent',
                                background: i === 0 ? 'rgba(0,212,255,0.04)' : 'transparent',
                                transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                            onMouseLeave={e => (e.currentTarget.style.background = i === 0 ? 'rgba(0,212,255,0.04)' : 'transparent')}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontSize: 12,
                                    color: '#e2e8f0',
                                    fontWeight: i === 0 ? 600 : 400,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}>
                                    {stop.stpnm}
                                </div>
                            </div>
                            <div style={{
                                fontSize: stop.eta === 'DUE' ? 14 : 13,
                                fontWeight: 700,
                                color: stop.eta === 'DUE' ? '#00d4ff' : '#e2e8f0',
                                fontFamily: 'JetBrains Mono, monospace',
                                marginLeft: 12,
                                flexShrink: 0,
                            }}>
                                {stop.eta}
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div style={{
                padding: '8px 16px 12px',
                fontSize: 10,
                color: '#475569',
                borderTop: '1px solid rgba(255,255,255,0.04)',
                textAlign: 'center',
            }}>
                Click a stop to track this bus there
            </div>
        </div>
    );
}
