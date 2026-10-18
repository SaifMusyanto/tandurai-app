import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Clock, AlertCircle, Thermometer, Droplets, Wind,
  Leaf, Droplet, TrendingUp, TrendingDown, Minus,
  Gauge, Wifi, WifiOff,
} from 'lucide-react';
import { useFarmContext } from '@/contexts/FarmContext';
import KumbungSensorSummary from '@/components/KumbungSensorSummary';
import { ActiveActuatorsStrip } from '@/components/iot/ActiveActuators';
import { useKumbungHistory, useKumbungTelemetry } from '@/hooks/useKumbungTelemetry';
import { PARAMETERS, PARAMETER_KEYS, latestValues } from '@/lib/parameters';
import { useWeather } from '@/hooks/useWeather';
import WeatherCard from '@/components/WeatherCard';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
const TIME_FILTERS = [
  { label: 'Last Hour',   value: 'hour', minutes: 60    },
  { label: 'Last 24 Hrs', value: '24h',  minutes: 1440  },
  { label: 'Last Week',   value: 'week', minutes: 10080 },
];


// Parameter resmi (satu sumber: lib/parameters) + rentang optimal farm (FarmContext) + id gradien grafik.
const buildSensorConfig = ranges => Object.fromEntries(PARAMETER_KEYS.map(key => {
  const { label, unit, color } = PARAMETERS[key];
  const [min, max] = ranges[key];
  return [key, { label, unit, color, min, max, gradientId: `${key}Grad` }];
}));

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
const formatXAxis = (ts, filter) => {
  const d = new Date(ts);
  if (filter === 'hour') return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (filter === '24h')  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' });
};

const getStatus = (value, min, max) => {
  if (value === 0 || value === null || value === undefined) return 'no-data';
  if (value < min || value > max) return 'warning';
  return 'optimal';
};

const statusBadge = {
  optimal:  'bg-green-500/10 text-green-600 border-green-500/20',
  warning:  'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  'no-data':'bg-muted/30 text-muted-foreground border-muted/30',
};

const getTrend = (data) => {
  if (data.length < 2) return 'stable';
  const last = data[data.length - 1]?.value;
  const prev = data[data.length - 2]?.value;
  if (last > prev + 0.5) return 'up';
  if (last < prev - 0.5) return 'down';
  return 'stable';
};

// ─────────────────────────────────────────────────────────────
// CUSTOM TOOLTIP
// ─────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-xl text-xs min-w-[140px]">
      <p className="text-muted-foreground mb-1.5 font-medium">{label}</p>
      <p className="font-black text-base text-foreground">
        {payload[0].value}
        <span className="text-muted-foreground font-normal ml-1">{unit}</span>
      </p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// SENSOR CHART CARD
// ─────────────────────────────────────────────────────────────
const SensorChart = ({ sensorKey, cfg, data, filter, delay = 0, espOnline }) => {
  const latest = data[data.length - 1]?.value ?? 0;
  const status = getStatus(latest, cfg.min, cfg.max);
  const trend = getTrend(data);
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  // Tentukan domain Y yang rapi
  const values = data.map(d => d.value).filter(Boolean);
  const minVal = values.length ? Math.min(...values) : cfg.min;
  const maxVal = values.length ? Math.max(...values) : cfg.max;
  const padding = (maxVal - minVal) * 0.2 || 5;
  const yMin = Math.floor(minVal - padding);
  const yMax = Math.ceil(maxVal + padding);

  const isArea = sensorKey === 'humidity';

  return (
    <motion.div
      id={`sensor-${sensorKey}`}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay }}
    >
      <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
        {/* Header */}
        <CardHeader className="pb-3 pt-4 px-5 border-b border-border/50">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: cfg.color }}
              />
              {cfg.label}
              <span className="text-muted-foreground font-normal">({cfg.unit})</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              {espOnline ? (
                <span className="flex items-center gap-1 text-[10px] text-green-600 font-semibold">
                  <Wifi size={11} /> Live
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-semibold">
                  <WifiOff size={11} /> Offline
                </span>
              )}
              <Badge variant="outline" className={`text-[10px] px-2 py-0 h-5 ${statusBadge[status]}`}>
                {status === 'no-data' ? 'No Data' : status}
              </Badge>
            </div>
          </div>

          {/* Current value + trend */}
          <div className="flex items-baseline gap-3 mt-2">
            <span className="text-3xl font-black" style={{ color: cfg.color }}>
              {latest > 0 ? latest : '—'}
            </span>
            <span className="text-sm text-muted-foreground">{cfg.unit}</span>
            <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
              <TrendIcon size={13} />
              <span>Optimal: {cfg.min}–{cfg.max} {cfg.unit}</span>
            </div>
          </div>
        </CardHeader>

        {/* Chart */}
        <CardContent className="px-2 pt-3 pb-2">
          <ResponsiveContainer width="100%" height={190}>
            {isArea ? (
              <AreaChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id={cfg.gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={cfg.color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={9} tickMargin={6} interval="preserveStartEnd" />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={[yMin, yMax]} width={38} />
                <Tooltip content={<CustomTooltip unit={cfg.unit} />} />
                <ReferenceLine y={cfg.min} stroke={cfg.color} strokeDasharray="4 3" strokeOpacity={0.5} label={{ value: `min ${cfg.min}`, fill: cfg.color, fontSize: 9, position: 'insideTopLeft' }} />
                <ReferenceLine y={cfg.max} stroke={cfg.color} strokeDasharray="4 3" strokeOpacity={0.5} label={{ value: `max ${cfg.max}`, fill: cfg.color, fontSize: 9, position: 'insideTopLeft' }} />
                <Area type="monotone" dataKey="value" stroke={cfg.color} fill={`url(#${cfg.gradientId})`} strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
              </AreaChart>
            ) : (
              <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id={cfg.gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={cfg.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={9} tickMargin={6} interval="preserveStartEnd" />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={[yMin, yMax]} width={38} />
                <Tooltip content={<CustomTooltip unit={cfg.unit} />} />
                <ReferenceLine y={cfg.min} stroke={cfg.color} strokeDasharray="4 3" strokeOpacity={0.5} label={{ value: `min ${cfg.min}`, fill: cfg.color, fontSize: 9, position: 'insideTopLeft' }} />
                <ReferenceLine y={cfg.max} stroke={cfg.color} strokeDasharray="4 3" strokeOpacity={0.5} label={{ value: `max ${cfg.max}`, fill: cfg.color, fontSize: 9, position: 'insideTopLeft' }} />
                <Line type="monotone" dataKey="value" stroke={cfg.color} strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </motion.div>
  );
};

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────
export default function MonitoringPage() {
  const [searchParams] = useSearchParams();
  const [activeFilter, setActiveFilter] = useState('24h');
  const focusedSensor = searchParams.get('focus');
  const { target, kumbung, sensor, ranges } = useFarmContext();
  const sensorConfig = useMemo(() => buildSensorConfig(ranges), [ranges]);
  const focusedConfig = sensorConfig[focusedSensor];

  useEffect(() => {
    if (!focusedConfig) return;
    const timer = setTimeout(() => document.getElementById(`sensor-${focusedSensor}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
    return () => clearTimeout(timer);
  }, [focusedSensor, focusedConfig]);

  // Grafik yang sudah difilter + diformat
  const [charts, setCharts] = useState({
    temperature: [], humidity: [], co2: [],
  });

  const weather = useWeather();

  // Satu sumber data: gabungan semua sensor kumbung terpilih (histori 10 menit + live SSE).
  const { kumbungId: targetKumbungId } = target;
  const { online: espOnline, sensorCount, allSensors } = useKumbungTelemetry();
  const filterMinutes = TIME_FILTERS.find(filter => filter.value === activeFilter).minutes;
  const { rows: logs } = useKumbungHistory({ rangeMs: filterMinutes * 60 * 1000, maxPoints: 6000 });

  // ── EFFECT 2: Filter + format chart data setiap kali filter/logs berubah
  useEffect(() => {
    const filterCfg = TIME_FILTERS.find(f => f.value === activeFilter);
    const cutoff = Date.now() - filterCfg.minutes * 60 * 1000;
    const filtered = logs.filter(p => p.timestamp >= cutoff);

    // Jumlah maksimum titik yang ditampilkan di grafik (agar tidak overcrowded)
    const MAX_POINTS = activeFilter === 'week' ? 168 : activeFilter === '24h' ? 96 : 60;

    // Downsample jika terlalu banyak
    const downsampled = filtered.length > MAX_POINTS
      ? filtered.filter((_, i) => i % Math.ceil(filtered.length / MAX_POINTS) === 0)
      : filtered;

    // Hanya titik yang punya nilai parameter tsb (sensor berbeda bisa mengirim parameter berbeda).
    const toChart = (key) =>
      downsampled.filter(p => typeof p[key] === 'number').map(p => ({
        time: formatXAxis(p.timestamp, activeFilter),
        value: p[key],
      }));

    setCharts({
      temperature: toChart('temperature'),
      humidity:    toChart('humidity'),
      co2:         toChart('co2'),
    });
  }, [activeFilter, logs]);

  // Nilai terakhir per parameter (bisa dari sensor berbeda) untuk stats bar
  const latest = useMemo(() => (logs.length ? latestValues(logs) : null), [logs]);

  return (
    <>
      <Helmet>
        <title>Monitoring - Dashboard Tandurai</title>
        <meta name="description" content="Real-time environmental monitoring charts and trends" />
      </Helmet>

      <div className="space-y-6">

        {focusedConfig && (
          <Alert className="border-amber-500/40 bg-amber-500/10">
            <AlertCircle />
            <AlertTitle>Periksa {focusedConfig.label}</AlertTitle>
            <AlertDescription>Anda diarahkan dari ringkasan perkiraan panen. Grafik yang perlu diperhatikan akan ditampilkan di bawah.</AlertDescription>
          </Alert>
        )}

        {/* ── Header ── */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold mb-1">Environmental Monitoring</h1>
              <p className="text-sm font-medium mb-1">
                {kumbung?.name || targetKumbungId || 'Pilih kumbung'}
                <span className="text-muted-foreground font-normal"> · {allSensors ? `rata-rata ${sensorCount} sensor` : sensor?.name || 'sensor'}</span>
              </p>
              <p className="text-muted-foreground text-sm flex items-center gap-2">
                Real-time sensor trends dari hardware Tandurai
                {espOnline ? (
                  <span className="inline-flex items-center gap-1 text-green-600 font-semibold text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    Sensor Online
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                    Sensor Offline
                  </span>
                )}
              </p>
            </div>

            {/* Time filter buttons */}
            <div className="flex gap-2">
              {TIME_FILTERS.map(f => (
                <Button
                  key={f.value}
                  variant={activeFilter === f.value ? 'default' : 'outline'}
                  onClick={() => setActiveFilter(f.value)}
                  className="text-xs h-9 px-4 font-semibold transition-all"
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── Cuaca luar (lokasi dari Pengaturan) ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <WeatherCard weather={weather} />
        </motion.div>

        {/* ── Aktuator yang sedang menyala di kumbung ini ── */}
        {targetKumbungId && <ActiveActuatorsStrip kumbungId={targetKumbungId} />}

        {/* ── Ringkasan per sensor gateway di kumbung terpilih ── */}
        <KumbungSensorSummary />

        {/* ── Latest Values Summary Bar ── */}
        {latest && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Object.entries(sensorConfig).map(([key, cfg]) => {
                const val = latest[key] ?? 0;
                const st = getStatus(val, cfg.min, cfg.max);
                return (
                  <div key={key} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground truncate">{cfg.label}</p>
                      <p className="text-lg font-black leading-tight">
                        {val > 0 ? val : '—'}
                        <span className="text-xs font-normal text-muted-foreground ml-1">{cfg.unit}</span>
                      </p>
                    </div>
                    <Badge variant="outline" className={`ml-auto text-[9px] px-1.5 py-0 h-4 flex-shrink-0 ${statusBadge[st]}`}>
                      {st === 'no-data' ? '—' : st}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ── Charts Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SensorChart sensorKey="temperature" cfg={sensorConfig.temperature} data={charts.temperature} filter={activeFilter} delay={0}    espOnline={espOnline} />
          <SensorChart sensorKey="humidity" cfg={sensorConfig.humidity}    data={charts.humidity}    filter={activeFilter} delay={0.05} espOnline={espOnline} />
          <SensorChart sensorKey="co2" cfg={sensorConfig.co2}         data={charts.co2}         filter={activeFilter} delay={0.1}  espOnline={espOnline} />
        </div>


      </div>
    </>
  );
}
