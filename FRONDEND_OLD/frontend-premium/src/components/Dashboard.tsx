import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Clock, AlertTriangle } from 'lucide-react';

interface OTPData {
    date: string;
    otp: number;
}

interface BunchingData {
    route: string;
    events: number;
}

export default function Dashboard() {
    const [otpData, setOtpData] = useState<OTPData[]>([]);
    const [bunchingData, setBunchingData] = useState<BunchingData[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const otpRes = await axios.get('http://localhost:8000/metrics/otp');
                setOtpData(otpRes.data);

                const bunchingRes = await axios.get('http://localhost:8000/metrics/bunching/summary');
                setBunchingData(bunchingRes.data);
            } catch (error) {
                console.error("Error fetching metrics:", error);
            }
        };
        fetchData();
    }, []);

    return (
        <div className="absolute top-4 left-4 w-96 bg-black/80 backdrop-blur-md border border-gray-800 rounded-xl p-6 text-white shadow-2xl z-50">
            <h1 className="text-2xl font-bold mb-6 bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">
                Madison Metro Analytics
            </h1>

            {/* OTP Section */}
            <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                    <Clock className="w-5 h-5 text-green-400" />
                    <h2 className="text-lg font-semibold">On-Time Performance</h2>
                </div>
                <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={otpData.slice(-7)}>
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#666" />
                            <YAxis domain={[0.8, 1]} hide />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#333', border: 'none' }}
                                itemStyle={{ color: '#fff' }}
                            />
                            <Bar dataKey="otp" fill="#4ade80" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Bunching Section */}
            <div>
                <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-5 h-5 text-yellow-400" />
                    <h2 className="text-lg font-semibold">Top Bunching Routes</h2>
                </div>
                <div className="space-y-3">
                    {bunchingData.slice(0, 5).map((item) => (
                        <div key={item.route} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center font-bold text-sm">
                                    {item.route}
                                </span>
                                <div className="h-2 w-32 bg-gray-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-yellow-500"
                                        style={{ width: `${Math.min(100, item.events / 10)}%` }}
                                    />
                                </div>
                            </div>
                            <span className="text-sm text-gray-400">{item.events} events</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
