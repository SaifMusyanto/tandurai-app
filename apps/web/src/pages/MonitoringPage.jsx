import React, { useState, useEffect } from 'react';
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
import { db } from '../firebase';
import { FIREBASE_PATHS } from '@/lib/firebasePaths';
import { readTelemetryHistory, subscribeLatestTelemetry } from '@/lib/telemetryService';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
const TIME_FILTERS = [
  { label: 'Last Hour',   value: 'hour', minutes: 60    },
  { label: 'Last 24 Hrs', value: '24h',  minutes: 1440  },
  { label: 'Last Week',   value: 'week', minutes: 10080 },
];


// Optimal range per sensor (untuk reference lines & status badge)
const SENSOR_CONFIG = {
  temperature: { min: 24,  max: 30,  unit: '°C',  label: 'Temperature',       color: '#f97316', gradientId: 'tempGrad'  },
  humidity:    { min: 70,  max: 85,  unit: '%',   label: 'Humidity',           color: '#3b82f6', gradientId: 'humGrad'   },
  co2:         { min: 400, max: 600, unit: 'ppm', label: 'CO₂ Level',          color: '#8b5cf6', gradientId: 'co2Grad'   },
  pressure:    { min: 1005,max: 1025,unit: 'hPa', label: 'Pressure',           color: '#06b6d4', gradientId: 'presGrad'  },
};

const getWeatherEmoji = (code) => {
  const c = String(code).toLowerCase();
  if (c.includes('thunder') || c.includes('petir')) return '⛈️';
  if (c.includes('heavy rain') || c.includes('hujan lebat')) return '🌧️';
  if (c.includes('rain') || c.includes('hujan') || c.includes('shower')) return '🌧️';
  if (c.includes('drizzle') || c.includes('gerimis')) return '🌦️';
  if (c.includes('cloudy') || c.includes('berawan')) return '☁️';
  if (c.includes('partly cloudy') || c.includes('cerah berawan')) return '⛅';
  if (c.includes('clear') || c.includes('sunny') || c.includes('cerah')) return '☀️';
  return '☁️';
};

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
const SensorChart = ({ sensorKey, data, filter, delay = 0, espOnline }) => {
  const cfg = SENSOR_CONFIG[sensorKey];
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

  const isArea = sensorKey === 'humidity' || sensorKey === 'pressure';

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
  const focusedConfig = SENSOR_CONFIG[focusedSensor];

  useEffect(() => {
    if (!focusedConfig) return;
    const timer = setTimeout(() => document.getElementById(`sensor-${focusedSensor}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
    return () => clearTimeout(timer);
  }, [focusedSensor, focusedConfig]);

  // Semua data history tersimpan di sini (key = timestamp ms)
  const [logs, setLogs] = useState([]);

  // Status koneksi sensor
  const [espOnline, setEspOnline] = useState(false);
  const [sensorQuality, setSensorQuality] = useState(null);

  // Grafik yang sudah difilter + diformat
  const [charts, setCharts] = useState({
    temperature: [], humidity: [], co2: [], pressure: [],
  });

  // Weather
  const [currentWeather, setCurrentWeather] = useState(null);
  const [hourlyForecast, setHourlyForecast] = useState([]);
  const [weatherLoading, setWeatherLoading] = useState(true);

  // ── EFFECT 1: Query histori terbatas + live telemetry dengan fallback sensor1
  useEffect(() => {
    let active = true;
    const filterCfg = TIME_FILTERS.find(filter => filter.value === activeFilter);
    const endAt = Date.now();
    const startAt = endAt - filterCfg.minutes * 60 * 1000;

    readTelemetryHistory(db, {
      kumbungId: FIREBASE_PATHS.defaultKumbungId,
      startAt,
      endAt,
      maxPoints: activeFilter === 'week' ? 1200 : 300,
    }).then(rows => {
      if (active) setLogs(rows);
    }).catch(error => console.error('Gagal membaca histori telemetry:', error));

    const unsubscribeLive = subscribeLatestTelemetry(db, telemetry => {
      if (!telemetry) {
        setEspOnline(false);
        return;
      }
      setSensorQuality(telemetry.quality);
      setEspOnline(!telemetry.quality.stale && telemetry.quality.status !== 'invalid');
      const point = {
        timestamp: telemetry.timestamp || Date.now(),
        temperature: telemetry.temperature,
        humidity: telemetry.humidity,
        co2: telemetry.co2,
        pressure: telemetry.pressure,
      };
      setLogs(previous => {
        if (previous.some(row => row.timestamp === point.timestamp)) return previous;
        return [...previous, point].slice(-2000);
      });
    }, error => {
      console.error('Firebase telemetry error:', error);
      setEspOnline(false);
    });

    return () => {
      active = false;
      unsubscribeLive();
    };
  }, [activeFilter]);

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

    const toChart = (key) =>
      downsampled.map(p => ({
        time: formatXAxis(p.timestamp, activeFilter),
        value: p[key],
      }));

    setCharts({
      temperature: toChart('temperature'),
      humidity:    toChart('humidity'),
      co2:         toChart('co2'),
      pressure:    toChart('pressure'),
    });
  }, [activeFilter, logs]);

  // ── EFFECT 3: Cuaca Sidoarjo
  useEffect(() => {
    const fetchWeather = async () => {
      try {
        setWeatherLoading(true);
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=-7.4478&longitude=112.7183&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code,wind_speed_10m&timezone=Asia%2FJakarta&forecast_days=1';
        const res  = await fetch(url);
        if (!res.ok) throw new Error();
        const data = await res.json();

        const codeMap = { 0:'Cerah',1:'Cerah Berawan',2:'Cerah Berawan',3:'Berawan',45:'Kabut',51:'Gerimis',61:'Hujan Ringan',63:'Hujan',65:'Hujan Lebat',80:'Hujan Mandi',95:'Hujan Petir' };

        setCurrentWeather({
          temp:      Math.round(data.current.temperature_2m),
          humidity:  data.current.relative_humidity_2m,
          windSpeed: Math.round(data.current.wind_speed_10m),
          condition: codeMap[data.current.weather_code] || 'Berawan',
          code:      data.current.weather_code,
        });

        const nowH = new Date().getHours();
        setHourlyForecast(
          Array.from({ length: 6 }, (_, i) => {
            const idx = (nowH + i) % 24;
            return {
              time: i === 0 ? 'Sekarang' : (data.hourly.time[idx]?.split('T')[1]?.slice(0,5) || '--:--'),
              temp: Math.round(data.hourly.temperature_2m[idx]),
              code: data.hourly.weather_code[idx],
              wind: Math.round(data.hourly.wind_speed_10m[idx]),
              condition: codeMap[data.hourly.weather_code[idx]] || 'Berawan',
            };
          })
        );
        setWeatherLoading(false);
      } catch {
        setWeatherLoading(false);
      }
    };

    fetchWeather();
    const iv = setInterval(fetchWeather, 15 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  // Latest values untuk stats bar
  const latest = logs[logs.length - 1];

  return (
    <>
      <Helmet>
        <title>Monitoring — Tandurai</title>
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
                {sensorQuality?.invalidSensors?.length > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    Invalid: {sensorQuality.invalidSensors.join(', ')}
                  </Badge>
                )}
                {sensorQuality?.missingSensors?.length > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    Missing: {sensorQuality.missingSensors.join(', ')}
                  </Badge>
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

        {/* ── Latest Values Summary Bar ── */}
        {latest && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(SENSOR_CONFIG).map(([key, cfg]) => {
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
          <SensorChart sensorKey="temperature" data={charts.temperature} filter={activeFilter} delay={0}    espOnline={espOnline} />
          <SensorChart sensorKey="humidity"    data={charts.humidity}    filter={activeFilter} delay={0.05} espOnline={espOnline} />
          <SensorChart sensorKey="co2"         data={charts.co2}         filter={activeFilter} delay={0.1}  espOnline={espOnline} />
          <SensorChart sensorKey="pressure"    data={charts.pressure}    filter={activeFilter} delay={0.15} espOnline={espOnline} />
        </div>

        {/* ── Weather Forecast ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border/60 bg-muted/10">
              <CardTitle className="flex items-center gap-2 text-base font-bold">
                <Clock className="text-primary" size={20} />
                Ramalan 24 Jam — Sidoarjo
              </CardTitle>
              <Badge variant="secondary" className="text-[10px] bg-blue-500/10 text-blue-600 border-none px-2.5 font-bold">
                📡 Live Satelit
              </Badge>
            </CardHeader>
            <CardContent className="p-5">
              {weatherLoading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                  <p className="text-xs text-muted-foreground">Menghubungkan satelit cuaca Sidoarjo...</p>
                </div>
              ) : currentWeather ? (
                <div className="flex flex-col sm:flex-row gap-6">
                  {/* Current */}
                  <div className="flex items-center gap-4 bg-gradient-to-br from-primary/5 to-transparent p-4 rounded-xl border border-primary/10 flex-shrink-0">
                    <span className="text-5xl leading-none select-none">{getWeatherEmoji(currentWeather.code)}</span>
                    <div>
                      <p className="text-2xl font-black">{currentWeather.temp}°C</p>
                      <p className="text-xs text-muted-foreground font-semibold">{currentWeather.condition}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        💧 {currentWeather.humidity}% &nbsp;·&nbsp; 💨 {currentWeather.windSpeed} km/j
                      </p>
                    </div>
                  </div>

                  {/* Hourly */}
                  <div className="overflow-x-auto flex-1 scrollbar-none">
                    <div className="flex gap-2.5 min-w-max">
                      {hourlyForecast.map((fc, i) => (
                        <div
                          key={i}
                          className={`rounded-xl p-3 flex flex-col items-center text-center border w-[88px] transition-all ${
                            i === 0
                              ? 'bg-primary text-primary-foreground border-primary shadow-md shadow-primary/10'
                              : 'bg-muted/40 border-border/50 hover:bg-muted/70'
                          }`}
                        >
                          <span className={`text-[10px] font-bold ${i === 0 ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                            {fc.time}
                          </span>
                          <span className="text-2xl my-2 select-none">{getWeatherEmoji(fc.code)}</span>
                          <span className="text-sm font-black">{fc.temp}°C</span>
                          <span className={`text-[9px] mt-1 truncate w-full font-medium ${i === 0 ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                            💨 {fc.wind} km/j
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-destructive justify-center py-6">
                  <AlertCircle size={16} />
                  <p className="text-xs font-bold">Gagal memuat ramalan cuaca.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

      </div>
    </>
  );
}
