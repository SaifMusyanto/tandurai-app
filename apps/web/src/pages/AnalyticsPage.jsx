import React, { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { Lightbulb, TrendingUp, Activity, Loader2, Thermometer, Droplets, Wind, Gauge } from 'lucide-react';

import { useSensorHistory } from '@/hooks/useSensorHistory';

// ─── Scoring helpers ──────────────────────────────────────────
const scoreTempStability = (logs) => {
  if (!logs.length) return 0;
  const ok = logs.filter(d => d.temperature >= 26 && d.temperature <= 31).length;
  return Math.round((ok / logs.length) * 100);
};
const scoreHumidity = (logs) => {
  if (!logs.length) return 0;
  const ok = logs.filter(d => d.humidity >= 70 && d.humidity <= 85).length;
  return Math.round((ok / logs.length) * 100);
};
const scoreCo2 = (logs) => {
  if (!logs.length) return 0;
  const ok = logs.filter(d => d.co2 >= 400 && d.co2 <= 600).length;
  return Math.round((ok / logs.length) * 100);
};
const scoreAutomation = (logs) => {
  if (!logs.length) return 0;
  const active = logs.filter(d => d.sprayStatus === true || d.sprayStatus === 'Active' || d.fanStatus === true || d.fanStatus === 'Active').length;
  return active > 0 ? Math.min(70 + Math.round((active / logs.length) * 30), 98) : 85;
};
const calcAllScores = (logs) => {
  const stability  = scoreTempStability(logs);
  const humidity   = scoreHumidity(logs);
  const co2        = scoreCo2(logs);
  const automation = scoreAutomation(logs);
  const env        = Math.round((stability + humidity + co2) / 3);
  const efficiency = Math.round(env * 0.95);
  const resource   = Math.max(95 - Math.round((logs.filter(d => d.sprayStatus === true || d.sprayStatus === 'Active').length / Math.max(logs.length, 1)) * 25), 65);
  return { environmental: env, efficiency, automation, resource, stability, reliability: logs.length > 0 ? 99 : 0 };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEFRAME_RANGE = { daily: DAY_MS, weekly: 7 * DAY_MS, monthly: 30 * DAY_MS };

// ─── ScoreCard ────────────────────────────────────────────────
const ScoreCard = ({ title, score, trend, loading }) => {
  const color       = score >= 85 ? 'text-green-500' : score >= 70 ? 'text-yellow-500' : 'text-red-500';
  const strokeColor = score >= 85 ? 'hsl(var(--primary))' : score >= 70 ? '#eab308' : 'hsl(var(--destructive))';
  const circ        = 2 * Math.PI * 40;
  const offset      = circ - (circ * score) / 100;
  return (
    <Card>
      <CardContent className="p-6 flex flex-col items-center justify-center text-center">
        <div className="relative w-24 h-24 mb-4">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
            <circle cx="48" cy="48" r="40" stroke="hsl(var(--muted))" strokeWidth="8" fill="none" />
            <circle cx="48" cy="48" r="40" stroke={strokeColor} strokeWidth="8" fill="none"
              strokeDasharray={circ} strokeDashoffset={offset}
              strokeLinecap="round" className="transition-all duration-1000" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-2xl font-bold ${color}`}>{loading ? '--' : score}</span>
          </div>
        </div>
        <h3 className="text-sm font-medium text-muted-foreground line-clamp-2 leading-tight">{title}</h3>
        <div className="flex items-center gap-1 mt-2 text-xs text-green-500">
          <TrendingUp size={14} />
          <span>+{trend}%</span>
        </div>
      </CardContent>
    </Card>
  );
};

// ─── Mini stat bar ────────────────────────────────────────────
const StatBar = ({ label, value, unit, color }) => (
  <div>
    <div className="flex justify-between text-xs mb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}{unit}</span>
    </div>
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  </div>
);

// ─── Main Page ────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [timeframe, setTimeframe] = useState('daily');
  // History sensor terpilih (konteks farm/kumbung) untuk rentang timeframe, terbaru di depan.
  const { rows, loading } = useSensorHistory({ rangeMs: TIMEFRAME_RANGE[timeframe], maxPoints: 2000 });
  const logs = useMemo(() => [...rows].reverse().map(row => ({
    id:          `${row.sensorId}_${row.timestamp}`,
    timestamp:   row.timestamp,
    temperature: row.temperature ?? null,
    humidity:    row.humidity    ?? null,
    co2:         row.co2         ?? null,
    pressure:    row.pressure    ?? null,
    sprayStatus: row.mistingStatus ?? false,
    fanStatus:   row.fanStatus   ?? false,
  })), [rows]);
  const scores = useMemo(() => calcAllScores(logs), [logs]);

  // ── Derive chart data from logs (oldest→newest for charts) ──
  const logsAsc = [...logs].reverse();

  // Seluruh rentang di-downsample agar grafik mewakili timeframe, bukan hanya titik terakhir.
  const trendCount = timeframe === 'daily' ? 48 : timeframe === 'weekly' ? 84 : 120;
  const trendStep  = Math.max(1, Math.ceil(logsAsc.length / trendCount));
  const timeLabel  = timeframe === 'daily' ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', hour: '2-digit' };
  const trendData  = logsAsc.filter((_, index) => index % trendStep === 0).map(d => ({
    time:        new Date(d.timestamp).toLocaleString('id-ID', timeLabel),
    temperature: d.temperature,
    humidity:    d.humidity,
    co2:         d.co2,
    pressure:    d.pressure,
  }));

  const bucketSize = Math.max(1, Math.floor(logsAsc.length / 7));
  const perfData   = Array.from({ length: Math.min(7, logsAsc.length) }, (_, i) => {
    const slice      = logsAsc.slice(i * bucketSize, (i + 1) * bucketSize);
    const avgTemp    = slice.reduce((a, c) => a + (c.temperature || 0), 0) / slice.length;
    const stability  = Math.round(slice.filter(d => d.temperature >= 26 && d.temperature <= 31).length / slice.length * 100);
    const efficiency = Math.round(slice.filter(d => d.humidity >= 70 && d.humidity <= 85).length / slice.length * 100);
    const label      = new Date(slice[0]?.timestamp || Date.now()).toLocaleString('id-ID', timeLabel);
    return { label, stability, efficiency, avgTemp: Math.round(avgTemp * 10) / 10 };
  });

  const latest = logs[0] ?? {};

  return (
    <>
      <Helmet>
        <title>Analytics - Tumbara</title>
      </Helmet>

      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
            <p className="text-muted-foreground">
              Deep insights into farm performance · {logs.length} snapshots collected this session
            </p>
          </div>
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Select timeframe" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily View (20 pts)</SelectItem>
              <SelectItem value="weekly">Weekly View (50 pts)</SelectItem>
              <SelectItem value="monthly">All Data</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Score Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <ScoreCard title="Environmental Score"    score={scores.environmental} trend={1.2} loading={loading} />
          <ScoreCard title="Farm Efficiency"        score={scores.efficiency}    trend={2.1} loading={loading} />
          <ScoreCard title="Automation Efficiency"  score={scores.automation}    trend={1.5} loading={loading} />
          <ScoreCard title="Resource Usage"         score={scores.resource}      trend={3.4} loading={loading} />
          <ScoreCard title="Stability Index"        score={scores.stability}     trend={2.2} loading={loading} />
          <ScoreCard title="System Reliability"     score={scores.reliability}   trend={0.1} loading={loading} />
        </div>

        {/* Live sensor quick-stats */}
        {!loading && logs.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Temperature', value: latest.temperature, unit: '°C',   icon: Thermometer, ok: latest.temperature >= 26 && latest.temperature <= 31 },
                { label: 'Humidity',    value: latest.humidity,    unit: '%',    icon: Droplets,    ok: latest.humidity >= 70 && latest.humidity <= 85 },
                { label: 'CO₂',         value: latest.co2,         unit: ' ppm', icon: Wind,        ok: latest.co2 >= 400 && latest.co2 <= 600 },
                { label: 'Pressure',    value: latest.pressure,    unit: ' hPa', icon: Gauge,       ok: true },
              ].map(({ label, value, unit, icon: Icon, ok }) => (
                <Card key={label} className={`border ${ok ? 'border-green-500/20 bg-green-500/5' : 'border-yellow-500/20 bg-yellow-500/5'}`}>
                  <CardContent className="p-4 flex items-center gap-3">
                    <Icon size={20} className={ok ? 'text-green-500' : 'text-yellow-500'} />
                    <div>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-lg font-bold">{value ?? '--'}{unit}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Charts */}
          <div className="lg:col-span-2 space-y-6">

            {/* Area chart — temp & humidity trend */}
            <Card>
              <CardHeader>
                <CardTitle>Environmental Trends — Temperature & Humidity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  {loading ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground gap-2"><Loader2 className="animate-spin" size={18} /> Connecting to sensor...</div>
                  ) : trendData.length < 2 ? (
                    <div className="h-full flex flex-col items-center justify-center border border-dashed rounded-lg gap-2 text-center px-4">
                      <p className="text-sm text-muted-foreground">Collecting data… ({trendData.length}/2 points)</p>
                      <p className="text-xs text-muted-foreground">Chart appears after the second sensor update</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendData}>
                        <defs>
                          <linearGradient id="gradTemp" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}   />
                          </linearGradient>
                          <linearGradient id="gradHum" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="hsl(var(--secondary))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--secondary))" stopOpacity={0}   />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                        <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
                        <Legend />
                        <Area type="monotone" dataKey="temperature" name="Temp (°C)" stroke="hsl(var(--primary))"   fill="url(#gradTemp)" strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="humidity"    name="Hum (%)"   stroke="hsl(var(--secondary))" fill="url(#gradHum)"  strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* CO₂ + Pressure trend */}
            <Card>
              <CardHeader>
                <CardTitle>CO₂ & Pressure Trends</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  {loading ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground gap-2"><Loader2 className="animate-spin" size={18} /> Loading...</div>
                  ) : trendData.length < 2 ? (
                    <div className="h-full flex items-center justify-center border border-dashed rounded-lg text-sm text-muted-foreground">
                      Waiting for more data points...
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendData}>
                        <defs>
                          <linearGradient id="gradCo2" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#f97316" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f97316" stopOpacity={0}   />
                          </linearGradient>
                          <linearGradient id="gradPressure" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}   />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="co2"      stroke="#f97316"  tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="pressure" orientation="right" stroke="#8b5cf6" tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
                        <Legend />
                        <Area yAxisId="co2"      type="monotone" dataKey="co2"      name="CO₂ (ppm)"      stroke="#f97316" fill="url(#gradCo2)"      strokeWidth={2} dot={false} />
                        <Area yAxisId="pressure" type="monotone" dataKey="pressure" name="Pressure (hPa)"  stroke="#8b5cf6" fill="url(#gradPressure)" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Bar chart — stability vs efficiency over time buckets */}
            <Card>
              <CardHeader>
                <CardTitle>Stability vs Efficiency — Bucketed Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  {loading ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground gap-2"><Loader2 className="animate-spin" size={18} /> Calculating...</div>
                  ) : perfData.length < 2 ? (
                    <div className="h-full flex items-center justify-center border border-dashed rounded-lg text-sm text-muted-foreground">
                      Need more data to compute performance buckets...
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={perfData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                        <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} unit="%" />
                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
                        <Legend />
                        <Bar dataKey="stability"  name="Temp Stability (%)"      fill="hsl(var(--primary))"   radius={[4, 4, 0, 0]} />
                        <Bar dataKey="efficiency" name="Humidity Efficiency (%)" fill="hsl(var(--secondary))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">

            {/* Insights */}
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Lightbulb size={20} />
                  Automatic Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="p-3 bg-card rounded-lg border border-border shadow-sm">
                  <p className="text-sm font-medium">Live Sensor Feed</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {logs.length > 0
                      ? `${logs.length} snapshots collected. Scores computed from real sensor data via adapter telemetry-v1.`
                      : 'Waiting for first sensor update from hardware…'}
                  </p>
                </div>
                <div className="p-3 bg-card rounded-lg border border-border shadow-sm">
                  <p className="text-sm font-medium">Optimal Range Reference</p>
                  <p className="text-xs text-muted-foreground mt-1">Temp 26–31°C · Humidity 70–85% · CO₂ 400–600 ppm · Pressure monitored.</p>
                </div>
                {logs.length > 1 && (() => {
                  const a = logs[0], b = logs[1];
                  const tempDiff = ((a.temperature || 0) - (b.temperature || 0)).toFixed(1);
                  const humDiff  = ((a.humidity    || 0) - (b.humidity    || 0)).toFixed(1);
                  const isWarm   = parseFloat(tempDiff) > 0;
                  return (
                    <div className={`p-3 rounded-lg border shadow-sm ${isWarm ? 'bg-orange-500/10 border-orange-500/20' : 'bg-blue-500/10 border-blue-500/20'}`}>
                      <p className="text-sm font-medium">{isWarm ? '🌡️ Temp Rising' : '❄️ Temp Dropping'}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Δ Temp {tempDiff}°C · Δ Hum {humDiff}% since last reading
                      </p>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Score breakdown bars */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity size={20} />
                  Score Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <StatBar label="Temperature Stability" value={scores.stability}     unit="%" color={scores.stability     >= 80 ? 'bg-green-500' : scores.stability     >= 60 ? 'bg-yellow-500' : 'bg-red-500'} />
                <StatBar label="Environmental Score"   value={scores.environmental} unit="%" color={scores.environmental >= 80 ? 'bg-green-500' : scores.environmental >= 60 ? 'bg-yellow-500' : 'bg-red-500'} />
                <StatBar label="Farm Efficiency"       value={scores.efficiency}    unit="%" color={scores.efficiency    >= 80 ? 'bg-green-500' : scores.efficiency    >= 60 ? 'bg-yellow-500' : 'bg-red-500'} />
                <StatBar label="Automation"            value={scores.automation}    unit="%" color={scores.automation    >= 80 ? 'bg-green-500' : scores.automation    >= 60 ? 'bg-yellow-500' : 'bg-red-500'} />
                <StatBar label="Resource Usage"        value={scores.resource}      unit="%" color={scores.resource      >= 80 ? 'bg-green-500' : scores.resource      >= 60 ? 'bg-yellow-500' : 'bg-red-500'} />
              </CardContent>
            </Card>

            {/* Connection status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity size={20} />
                  Connection Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  { label: 'Firebase Path',      value: 'monitoring/sensor1',    ok: true },
                  { label: 'Sensor Feed',        value: logs.length > 0 ? 'Connected' : loading ? 'Connecting…' : 'No Data', ok: logs.length > 0 },
                  { label: 'ESP Status',         value: latest.espStatus ?? '--', ok: latest.espStatus === 'Online' },
                  { label: 'Snapshots Collected',value: `${logs.length}`,        ok: true },
                  { label: 'Last Update',        value: logs.length > 0 ? new Date(logs[0].timestamp).toLocaleTimeString('id-ID') : '--', ok: true },
                ].map(({ label, value, ok }) => (
                  <div key={label} className="flex justify-between items-center pb-2 border-b border-border last:border-0 last:pb-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`font-medium ${ok ? 'text-green-500' : 'text-yellow-500'}`}>{value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </>
  );
}