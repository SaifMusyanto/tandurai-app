import React, { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Thermometer, Droplets, Wind, Gauge,
  TrendingUp, TrendingDown, Minus, Wifi, Database, Activity,
  CheckCircle2, AlertCircle, Clock, Sparkles, RefreshCw, Zap,
  Lightbulb, AlertTriangle, Info, Send, X, MessageCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ref, onValue, get } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase';
import { subscribeLatestTelemetry } from '@/lib/telemetryService';
import { useFarmContext } from '@/contexts/FarmContext';
import DashboardForecastCard from '@/components/DashboardForecastCard';

// ─────────────────────────────────────────────────────────────
// WEATHER HELPERS
// ─────────────────────────────────────────────────────────────
const getWeatherEmoji = (conditionCode) => {
  const code = String(conditionCode).toLowerCase();
  if (code.includes('thunder') || code.includes('badai') || code.includes('petir')) return '⛈️';
  if (code.includes('heavy rain') || code.includes('hujan lebat')) return '🌧️';
  if (code.includes('rain') || code.includes('hujan') || code.includes('shower')) return '🌧️';
  if (code.includes('drizzle') || code.includes('gerimis')) return '🌦️';
  if (code.includes('cloudy') || code.includes('berawan')) return '☁️';
  if (code.includes('partly cloudy') || code.includes('cerah berawan')) return '⛅';
  if (code.includes('clear') || code.includes('sunny') || code.includes('cerah')) return '☀️';
  return '☁️';
};

// ─────────────────────────────────────────────────────────────
// RULE-BASED INSIGHT ENGINE
// ─────────────────────────────────────────────────────────────
const generateInsights = (kpiData, currentWeather) => {
  const insights = [];
  const temp     = kpiData.temperature.value;
  const humidity = kpiData.humidity.value;
  const co2      = kpiData.co2.value;
  const pressure = kpiData.pressure.value;

  // ── Suhu
  if (temp > 33) {
    insights.push({ type: 'critical', title: 'Suhu Kritis — Tanaman Terancam Layu', description: `Suhu ${temp}°C sangat berbahaya bagi pertumbuhan. Aktifkan kipas ventilasi dan mist spray segera untuk menurunkan suhu ke rentang aman 24–30°C.`, action: 'Aktifkan Ventilasi' });
  } else if (temp > 30) {
    insights.push({ type: 'warning', title: 'Suhu Di Atas Optimal', description: `Suhu ${temp}°C sedikit melampaui batas aman 30°C. Pertimbangkan menambah sirkulasi udara atau menyemprot kabut tipis untuk menstabilkan suhu.`, action: 'Cek Ventilasi' });
  } else if (temp < 20) {
    insights.push({ type: 'critical', title: 'Suhu Terlalu Rendah', description: `Suhu ${temp}°C jauh di bawah optimal. Metabolisme tanaman melambat drastis. Aktifkan pemanas atau grow light untuk menaikkan suhu ruangan.`, action: 'Aktifkan Pemanas' });
  } else if (temp < 24) {
    insights.push({ type: 'warning', title: 'Suhu Sedikit Dingin', description: `Suhu ${temp}°C di bawah rentang ideal 24–30°C. Pertimbangkan menyalakan grow light lebih lama untuk membantu meningkatkan suhu secara bertahap.`, action: 'Sesuaikan Grow Light' });
  } else {
    insights.push({ type: 'success', title: 'Suhu Sempurna untuk Pertumbuhan', description: `Suhu ${temp}°C berada di rentang optimal 24–30°C. Kondisi termal sangat mendukung fotosintesis dan pertumbuhan akar yang sehat.`, action: 'Lihat Detail' });
  }

  // ── Kelembapan udara
  if (humidity < 60) {
    insights.push({ type: 'warning', title: 'Udara Terlalu Kering', description: `Kelembapan ${humidity}% di bawah 70%. Tanaman berisiko dehidrasi melalui stomata. Aktifkan mist spray untuk menaikkan kelembapan udara di kebun.`, action: 'Aktifkan Mist Spray' });
  } else if (humidity > 90) {
    insights.push({ type: 'warning', title: 'Kelembapan Terlalu Tinggi', description: `Kelembapan ${humidity}% melebihi 85% meningkatkan risiko pertumbuhan jamur dan busuk akar. Tingkatkan sirkulasi udara untuk menurunkan kelembapan.`, action: 'Tingkatkan Sirkulasi' });
  } else if (humidity >= 70 && humidity <= 85) {
    insights.push({ type: 'success', title: 'Kelembapan Udara Ideal', description: `Kelembapan ${humidity}% berada di zona optimal 70–85%. Stomata tanaman terbuka sempurna untuk proses transpirasi dan penyerapan nutrisi.`, action: 'Lihat Detail' });
  } else {
    insights.push({ type: 'info', title: 'Kelembapan Perlu Diperhatikan', description: `Kelembapan ${humidity}% mendekati batas. Pantau tren dalam 1–2 jam ke depan dan siapkan mist spray jika terus menurun.`, action: 'Pantau Tren' });
  }

  // ── CO₂
  if (co2 > 800) {
    insights.push({ type: 'critical', title: 'Kadar CO₂ Berbahaya', description: `CO₂ ${co2} ppm sangat tinggi dan dapat mengganggu ekosistem kebun. Buka ventilasi maksimal dan aktifkan kipas exhaust segera.`, action: 'Buka Ventilasi Penuh' });
  } else if (co2 > 600) {
    insights.push({ type: 'warning', title: 'CO₂ Melampaui Batas Aman', description: `CO₂ ${co2} ppm melebihi ambang 600 ppm. Tingkatkan aliran udara segar untuk menjaga keseimbangan gas di dalam ruangan.`, action: 'Aktifkan Exhaust Fan' });
  } else if (co2 >= 400 && co2 <= 600) {
    insights.push({ type: 'success', title: 'Level CO₂ Mendukung Fotosintesis', description: `CO₂ ${co2} ppm berada di rentang ideal 400–600 ppm. Tanaman dapat melakukan fotosintesis secara maksimal pada kondisi ini.`, action: 'Lihat Detail' });
  } else if (co2 < 400 && co2 > 0) {
    insights.push({ type: 'info', title: 'CO₂ Rendah — Fotosintesis Kurang Optimal', description: `CO₂ ${co2} ppm di bawah 400 ppm. Pertimbangkan mengurangi ventilasi sedikit atau menambah sumber CO₂ organik untuk meningkatkan produktivitas tanaman.`, action: 'Sesuaikan Ventilasi' });
  }

  // ── Tekanan udara (pressure)
  if (pressure > 0) {
    if (pressure < 1000) {
      insights.push({ type: 'warning', title: 'Tekanan Udara Rendah', description: `Tekanan udara ${pressure} hPa di bawah normal (1013 hPa). Kondisi ini sering menandakan cuaca buruk atau hujan. Pantau ventilasi dan pastikan atap kebun tertutup rapat.`, action: 'Pantau Cuaca' });
    } else if (pressure > 1025) {
      insights.push({ type: 'info', title: 'Tekanan Udara Tinggi', description: `Tekanan udara ${pressure} hPa di atas normal. Cuaca cenderung cerah dan kering. Pastikan irigasi berjalan optimal karena penguapan lebih cepat.`, action: 'Cek Irigasi' });
    } else {
      insights.push({ type: 'success', title: 'Tekanan Udara Normal', description: `Tekanan udara ${pressure} hPa berada di kisaran normal 1000–1025 hPa. Kondisi atmosfer stabil dan mendukung pertumbuhan tanaman yang sehat.`, action: 'Lihat Detail' });
    }
  }

  // ── Cuaca luar
  if (currentWeather) {
    const isHot    = currentWeather.temp > 35;
    const isWindy  = currentWeather.windSpeed > 30;
    if (isHot && temp > 28) {
      insights.push({ type: 'warning', title: 'Cuaca Panas Luar Memperburuk Kondisi Dalam', description: `Suhu luar ${currentWeather.temp}°C sangat panas. Kombinasi dengan suhu dalam ${temp}°C memperberat beban pendinginan. Pantau ventilasi secara aktif.`, action: 'Tingkatkan Pendinginan' });
    } else if (isWindy) {
      insights.push({ type: 'info', title: 'Angin Kencang — Manfaatkan Ventilasi Alami', description: `Angin luar ${currentWeather.windSpeed} km/jam. Buka ventilasi samping untuk memanfaatkan aliran udara alami dan mengurangi konsumsi listrik kipas.`, action: 'Atur Ventilasi' });
    }
  }

  const priority = { critical: 0, warning: 1, info: 2, success: 3 };
  return insights.sort((a, b) => priority[a.type] - priority[b.type]).slice(0, 3);
};

// ─────────────────────────────────────────────────────────────
// FARM HEALTH SCORE
// ─────────────────────────────────────────────────────────────
const calcTempScore = (val) => {
  if (val === 0) return 0;
  if (val >= 24 && val <= 30) return 100;
  if (val > 30 && val <= 33) return Math.round(100 - ((val - 30) / 3) * 40);
  if (val < 24 && val >= 20) return Math.round(100 - ((24 - val) / 4) * 40);
  if (val > 33 && val <= 38) return Math.round(60 - ((val - 33) / 5) * 50);
  if (val < 20 && val >= 15) return Math.round(60 - ((20 - val) / 5) * 50);
  return 10;
};
const calcHumScore = (val) => {
  if (val === 0) return 0;
  if (val >= 70 && val <= 85) return 100;
  if (val >= 60 && val < 70) return Math.round(100 - ((70 - val) / 10) * 35);
  if (val > 85 && val <= 95) return Math.round(100 - ((val - 85) / 10) * 35);
  if (val < 60 && val >= 45) return Math.round(65 - ((60 - val) / 15) * 45);
  if (val > 95) return Math.round(65 - ((val - 95) / 5) * 45);
  return 20;
};
const calcCo2Score = (val) => {
  if (val === 0) return 0;
  if (val >= 400 && val <= 600) return 100;
  if (val > 600 && val <= 700) return Math.round(100 - ((val - 600) / 100) * 30);
  if (val < 400 && val >= 300) return Math.round(100 - ((400 - val) / 100) * 25);
  if (val > 700 && val <= 900) return Math.round(70 - ((val - 700) / 200) * 40);
  if (val < 300) return Math.round(75 - ((300 - val) / 100) * 25);
  return 20;
};
// Pressure score: normal range 1000–1025 hPa → 100, makin jauh makin rendah
const calcPressureScore = (val) => {
  if (val === 0) return 0;
  if (val >= 1000 && val <= 1025) return 100;
  if (val >= 990 && val < 1000) return Math.round(100 - ((1000 - val) / 10) * 30);
  if (val > 1025 && val <= 1035) return Math.round(100 - ((val - 1025) / 10) * 25);
  if (val >= 980 && val < 990) return Math.round(70 - ((990 - val) / 10) * 30);
  if (val > 1035) return Math.round(75 - ((val - 1035) / 10) * 25);
  return 30;
};
const FarmHealthScore = ({ kpiData, currentWeather }) => {
  const temp     = kpiData.temperature.value;
  const humidity = kpiData.humidity.value;
  const co2      = kpiData.co2.value;
  const pressure = kpiData.pressure.value;

  const tScore = calcTempScore(temp);
  const hScore = calcHumScore(humidity);
  const cScore = calcCo2Score(co2);
  const pScore = calcPressureScore(pressure);

  let weatherPenalty = 0;
  if (currentWeather) {
    if (currentWeather.temp > 35) weatherPenalty = 5;
    else if (currentWeather.temp > 32) weatherPenalty = 3;
    const wCode = String(currentWeather.code);
    if (['95'].includes(wCode)) weatherPenalty += 3;
  }

  const ventilasi      = Math.max(0, Math.round((tScore * 0.6 + cScore * 0.4) - weatherPenalty));
  const kualitasUdara  = Math.round(pScore * 0.5 + hScore * 0.5);

  const overall = Math.min(100, Math.round(
    ventilasi     * 0.50 +
    kualitasUdara * 0.50
  ));

  const circumference    = 2 * Math.PI * 26;
  const strokeDashoffset = circumference - (overall / 100) * circumference;

  const getBarColor   = (v) => v >= 80 ? 'bg-green-500' : v >= 60 ? 'bg-yellow-500' : v >= 40 ? 'bg-orange-500' : 'bg-red-500';
  const getScoreLabel = (v) => v >= 85 ? 'Sangat Baik' : v >= 70 ? 'Baik' : v >= 55 ? 'Cukup' : v >= 40 ? 'Perlu Perhatian' : 'Kritis';
  const getScoreColor = (v) => v >= 85 ? 'text-green-600' : v >= 70 ? 'text-emerald-600' : v >= 55 ? 'text-yellow-600' : v >= 40 ? 'text-orange-600' : 'text-red-600';

  const sensorDetails = [
    { label: 'Suhu',             value: tScore, raw: temp     > 0 ? `${temp}°C`        : '–' },
    { label: 'Kelembapan',       value: hScore, raw: humidity > 0 ? `${humidity}%`     : '–' },
    { label: 'CO₂',              value: cScore, raw: co2      > 0 ? `${co2} ppm`       : '–' },
    { label: 'Tekanan Udara',    value: pScore, raw: pressure > 0 ? `${pressure} hPa`  : '–' },
  ];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 border-b border-border/60">
        <CardTitle className="flex items-center gap-2 text-base font-bold">
          <Activity className="text-primary" size={20} />
          Farm Health Score
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 flex-1 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold">{overall}</span>
              <span className="text-muted-foreground text-sm">/100</span>
            </div>
            <p className={`text-xs font-semibold mt-1 ${getScoreColor(overall)}`}>{getScoreLabel(overall)}</p>
            {weatherPenalty > 0 && (
              <p className="text-[10px] text-orange-500 mt-0.5">⚠ Cuaca luar -{weatherPenalty} poin</p>
            )}
          </div>
          <svg width="72" height="72" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/30" />
            <circle
              cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="6"
              strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className={overall >= 80 ? 'text-green-500' : overall >= 60 ? 'text-yellow-500' : overall >= 40 ? 'text-orange-500' : 'text-red-500'}
              style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 0.8s ease' }}
            />
          </svg>
        </div>

        <div className="space-y-2">
          {[
            { label: 'Suhu & Ventilasi', value: ventilasi },
            { label: 'Tekanan & Udara',  value: kualitasUdara },
          ].map((m) => (
            <div key={m.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">{m.label}</span>
                <span className={`font-bold ${getScoreColor(m.value)}`}>{m.value}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${getBarColor(m.value)}`} style={{ width: `${m.value}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border/50 pt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {sensorDetails.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-muted-foreground truncate">{s.label}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[10px] text-muted-foreground">{s.raw}</span>
                <span className={`text-[10px] font-bold ${getScoreColor(s.value)}`}>{s.value}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// ─────────────────────────────────────────────────────────────
// KPI CARD
// ─────────────────────────────────────────────────────────────
const KPICard = ({ title, value, unit, trend, status, optimalRange, icon: Icon, delay }) => {
  const statusColors = {
    optimal:  'bg-green-500/10 text-green-600 border-green-500/20',
    warning:  'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
    critical: 'bg-red-500/10 text-red-600 border-red-500/20',
  };
  const trendIcons = { up: TrendingUp, down: TrendingDown, stable: Minus };
  const TrendIcon = trendIcons[trend] || Minus;
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay }}>
      <Card className="hover:shadow-lg transition-all duration-200 hover:-translate-y-1">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          <Icon className="text-primary" size={20} />
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-bold">{value}</span>
            <span className="text-muted-foreground">{unit}</span>
          </div>
          <div className="flex items-center justify-between">
            <Badge variant="outline" className={statusColors[status] || statusColors.optimal}>{status}</Badge>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <TrendIcon size={16} />
              <span>{optimalRange}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

// ─────────────────────────────────────────────────────────────
// AI INSIGHTS PANEL
// ─────────────────────────────────────────────────────────────
const AIInsightsPanel = ({ kpiData, currentWeather }) => {
  const [insights, setInsights] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (kpiData.temperature.value === 0) return;
    setInsights(generateInsights(kpiData, currentWeather));
    setLastUpdated(new Date());
  }, [
    kpiData.temperature.value,
    kpiData.humidity.value,
    kpiData.co2.value,
    kpiData.pressure.value,
    currentWeather,
    refreshKey,
  ]);

  const typeConfig = {
    critical: { icon: AlertTriangle, bg: 'bg-red-500/10',    border: 'border-red-500/20',    icon_color: 'text-red-500',    badge: 'bg-red-500/10 text-red-600 border-red-500/20' },
    warning:  { icon: AlertCircle,   bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', icon_color: 'text-yellow-500', badge: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
    info:     { icon: Info,          bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   icon_color: 'text-blue-500',   badge: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
    success:  { icon: CheckCircle2,  bg: 'bg-green-500/10',  border: 'border-green-500/20',  icon_color: 'text-green-500',  badge: 'bg-green-500/10 text-green-600 border-green-500/20' },
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-4 border-b border-border/60">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-bold">
            <Sparkles className="text-primary" size={20} />
            Smart Farm Insights
            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20 ml-1">Rule-Based</Badge>
          </CardTitle>
          <button onClick={() => setRefreshKey(k => k + 1)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-md hover:bg-muted">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        {lastUpdated && <p className="text-xs text-muted-foreground mt-1">Diperbarui pukul {lastUpdated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>}
      </CardHeader>
      <CardContent className="p-5 flex-1">
        {insights.length > 0 ? (
          <AnimatePresence mode="wait">
            <div className="space-y-3">
              {insights.map((insight, i) => {
                const cfg = typeConfig[insight.type] || typeConfig.info;
                const IconComp = cfg.icon;
                return (
                  <motion.div key={`${insight.title}-${refreshKey}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }} className={`flex gap-3 items-start p-3.5 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                    <div className="p-1.5 rounded-lg bg-white/60 dark:bg-black/20 flex-shrink-0 mt-0.5"><IconComp size={16} className={cfg.icon_color} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="text-sm font-semibold leading-tight">{insight.title}</p>
                        <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ${cfg.badge}`}>{insight.type}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{insight.description}</p>
                      {insight.action && <button className="mt-2 text-xs font-medium text-primary hover:underline flex items-center gap-1"><Zap size={11} />{insight.action}</button>}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </AnimatePresence>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
            <Lightbulb size={32} className="text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Menunggu data sensor untuk dianalisis...</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ─────────────────────────────────────────────────────────────
// FORMAT MESSAGE HELPER
// ─────────────────────────────────────────────────────────────
const formatMessage = (text) => {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) => i % 2 === 1 ? <strong key={i} className="font-semibold">{part}</strong> : part);
};

// ─────────────────────────────────────────────────────────────
// CHATBOT POPUP
// ─────────────────────────────────────────────────────────────
const ChatbotPopup = ({ kpiData, currentWeather }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([{ role: 'assistant', content: 'Halo! Saya asisten AI Tandurai 🌱 Saya bisa membantu menganalisis kondisi kebun kamu — suhu, kelembapan, CO₂, tekanan udara, irigasi, dan lainnya. Ada yang bisa saya bantu?' }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const QUICK_CHIPS = ['Analisis kondisi kebun sekarang', 'CO₂ terlalu tinggi, apa solusinya?', 'Kapan waktu terbaik untuk irigasi?', 'Tips hemat energi untuk kebun'];

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isLoading]);
  useEffect(() => { if (isOpen) setUnreadCount(0); }, [isOpen]);

  const handleInputChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
  };

  const buildSystemPrompt = () => {
    const { temperature, humidity, co2, pressure } = kpiData;
    const weather = currentWeather
      ? `Cuaca luar: ${currentWeather.condition}, ${currentWeather.temp}°C, angin ${currentWeather.windSpeed} km/jam, kelembapan luar ${currentWeather.humidity}%`
      : 'Data cuaca luar tidak tersedia';
    return `Kamu adalah asisten AI cerdas untuk sistem smart farm bernama Tandurai, sebuah kebun hidroponik/vertikal berbasis IoT di Sidoarjo, Jawa Timur, Indonesia.\n\nDATA SENSOR REAL-TIME KEBUN SAAT INI:\n- Suhu: ${temperature.value}°C (optimal: 24–30°C) — status: ${temperature.status}\n- Kelembapan udara: ${humidity.value}% (optimal: 70–85%) — status: ${humidity.status}\n- Kadar CO₂: ${co2.value} ppm (optimal: 400–600 ppm) — status: ${co2.status}\n- Tekanan udara: ${pressure.value} hPa (normal: 1000–1025 hPa) — status: ${pressure.status}\n- ${weather}\n\nPERAN & TUGAS KAMU:\n- Berikan analisis dan saran berbasis data sensor di atas secara real-time\n- Gunakan bahasa Indonesia yang ramah, profesional, dan mudah dipahami petani\n- Berikan rekomendasi tindakan konkret dan spesifik, bukan jawaban umum\n- Jika ada kondisi kritis/warning, prioritaskan penanganannya terlebih dahulu\n- Jawaban singkat untuk pertanyaan sederhana, detail untuk pertanyaan teknis\n- Gunakan emoji secukupnya agar respons lebih hidup dan mudah dibaca\n- Jangan mengulang semua data sensor kecuali memang relevan dengan pertanyaan\n- Format respons dengan rapi, gunakan poin/angka jika ada langkah-langkah
- Jangan menghitung, menebak, atau mengubah angka perkiraan panen. Angka resmi hanya berasal dari Python AI Worker dan ditampilkan pada halaman Perkiraan Panen
- Jika ditanya angka perkiraan panen, arahkan pengguna membuka halaman Perkiraan Panen`;
  };

  // Endpoint proxy opsional. Secret provider tidak boleh berada di bundle browser.
  const chatApiUrl = import.meta.env.VITE_CHAT_API_URL?.trim();

  const sendMessage = async (text) => {
    const userText = (text || input).trim();
    if (!userText || isLoading) return;
    const newMessages = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsLoading(true);
    try {
      if (!chatApiUrl) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Fitur chat AI sedang dinonaktifkan sampai endpoint proxy yang aman dikonfigurasi. Data sensor dan fitur dashboard tetap dapat digunakan.',
        }]);
        return;
      }

      const response = await fetch(chatApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1000,
          temperature: 0.7,
          messages: [
            { role: 'system', content: buildSystemPrompt() },
            ...newMessages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
          ],
        }),
      });
      const data = await response.json();
      if (data.error) { setMessages(prev => [...prev, { role: 'assistant', content: `❌ Error: ${data.error.message}` }]); return; }
      const reply = data.choices?.[0]?.message?.content || 'Maaf, tidak ada respons.';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      if (!isOpen) setUnreadCount(n => n + 1);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Error: ${err.message}` }]);
    } finally { setIsLoading(false); }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  const clearChat = () => setMessages([{ role: 'assistant', content: 'Halo! Saya asisten AI Tandurai 🌱 Percakapan baru dimulai. Ada yang bisa saya bantu untuk kebun kamu?' }]);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92, y: 20 }} transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed bottom-20 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] sm:w-[380px] h-[540px] flex flex-col rounded-2xl shadow-2xl overflow-hidden border border-border/60 bg-background"
            style={{ maxWidth: '420px' }}
          >
            <div className="flex items-center gap-3 px-4 py-3 bg-green-600 text-white flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm flex-shrink-0 font-bold">🌱</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight">Tandurai AI Assistant</p>
                <p className="text-[11px] text-green-100 flex items-center gap-1.5 mt-0.5"><span className="w-1.5 h-1.5 rounded-full bg-green-300 flex-shrink-0 animate-pulse" />Online • Smart Farm Analysis</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={clearChat} title="Mulai percakapan baru" className="text-white/70 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10"><RefreshCw size={14} /></button>
                <button onClick={() => setIsOpen(false)} className="text-white/70 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10"><X size={16} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-border">
              {messages.map((msg, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className={`flex gap-2 items-end ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${msg.role === 'user' ? 'bg-blue-100 dark:bg-blue-900/50' : 'bg-green-100 dark:bg-green-900/50'}`}>{msg.role === 'user' ? '👤' : '🤖'}</div>
                  <div className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-green-600 text-white rounded-br-sm' : 'bg-muted/60 border border-border/40 rounded-bl-sm text-foreground'}`} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {formatMessage(msg.content)}
                  </div>
                </motion.div>
              ))}
              {isLoading && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2 items-end">
                  <div className="w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center text-xs flex-shrink-0">🤖</div>
                  <div className="bg-muted/60 border border-border/40 rounded-2xl rounded-bl-sm px-4 py-3">
                    <div className="flex gap-1 items-center">
                      {[0,1,2].map(i => <motion.span key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" animate={{ y: [0,-5,0], opacity: [0.4,1,0.4] }} transition={{ duration: 0.9, delay: i*0.18, repeat: Infinity }} />)}
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>
            {messages.length <= 2 && (
              <div className="px-3 pb-2 flex gap-1.5 flex-wrap">
                {QUICK_CHIPS.map(chip => (
                  <button key={chip} onClick={() => sendMessage(chip)} disabled={isLoading} className="text-[11px] px-2.5 py-1 rounded-full border border-green-500/40 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {chip}
                  </button>
                ))}
              </div>
            )}
            <div className="p-3 border-t border-border/50 flex gap-2 items-end flex-shrink-0 bg-background/95 backdrop-blur-sm">
              <textarea
                ref={textareaRef} value={input} onChange={handleInputChange} onKeyDown={handleKeyDown}
                placeholder="Tanya tentang kebun kamu… (Enter kirim)" rows={1} disabled={isLoading}
                className="flex-1 resize-none bg-muted/30 border border-border/50 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20 transition-all min-h-[38px] max-h-[100px] disabled:opacity-50 placeholder:text-muted-foreground/60"
              />
              <button onClick={() => sendMessage()} disabled={!input.trim() || isLoading} className="w-9 h-9 rounded-full bg-green-600 hover:bg-green-700 disabled:bg-muted flex items-center justify-center flex-shrink-0 transition-colors disabled:cursor-not-allowed">
                <Send size={15} className="text-white" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.button onClick={() => setIsOpen(v => !v)} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.95 }} className="fixed bottom-5 right-4 sm:right-6 z-50 w-14 h-14 rounded-full bg-green-600 hover:bg-green-700 shadow-lg shadow-green-600/30 flex items-center justify-center transition-colors">
        {unreadCount > 0 && !isOpen && <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{unreadCount}</span>}
        <AnimatePresence mode="wait">
          {isOpen
            ? <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}><X size={24} className="text-white" /></motion.div>
            : <motion.div key="open"  initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}><MessageCircle size={24} className="text-white" /></motion.div>
          }
        </AnimatePresence>
      </motion.button>
    </>
  );
};

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────
export default function HomePage() {
  const [username, setUsername] = useState('');

  const [kpiData, setKpiData] = useState({
    temperature: { value: 0,    trend: 'stable', status: 'optimal' },
    humidity:    { value: 0,    trend: 'stable', status: 'optimal' },
    co2:         { value: 0,    trend: 'stable', status: 'optimal' },
    // ── diganti dari airQuality → pressure (dari sensor1 Firebase)
    pressure:    { value: 0,    trend: 'stable', status: 'optimal' },
  });

  const [systemStatus, setSystemStatus] = useState({
    sensorsOnline: 12, devicesOnline: 8, automationStatus: 'active', networkStatus: 'connected', firebaseStatus: 'connecting',
  });

  const [lastSyncTime, setLastSyncTime]   = useState(new Date());
  const [currentWeather, setCurrentWeather] = useState(null);
  const [hourlyForecast, setHourlyForecast] = useState([]);
  const [weatherLoading, setWeatherLoading] = useState(true);

  // ── Ambil username dari Firebase
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const profileRef = ref(db, `users/${user.uid}/profile`);
          const snapshot   = await get(profileRef);
          if (snapshot.exists()) {
            setUsername(snapshot.val().username || 'Manager');
          } else {
            setUsername(user.email?.split('@')[0] || 'Manager');
          }
        } catch (err) {
          console.error('Gagal ambil username:', err);
          setUsername('Manager');
        }
      }
    });
    return () => unsubAuth();
  }, []);

  // ── Cuaca
  useEffect(() => {
    const fetchRealWeather = async () => {
      try {
        setWeatherLoading(true);
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=-7.4478&longitude=112.7183&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,weather_code,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Asia%2FJakarta&forecast_days=1';
        const response = await fetch(url);
        if (!response.ok) throw new Error('Gagal mengambil data cuaca.');
        const data = await response.json();
        const codeMap = { 0:'Cerah',1:'Cerah Berawan',2:'Cerah Berawan',3:'Berawan',45:'Kabut',48:'Kabut Rime',51:'Gerimis Ringan',53:'Gerimis',61:'Hujan Ringan',63:'Hujan',65:'Hujan Lebat',80:'Hujan Mandi',95:'Hujan Petir' };
        setCurrentWeather({ temp: Math.round(data.current.temperature_2m), humidity: data.current.relative_humidity_2m, windSpeed: Math.round(data.current.wind_speed_10m), condition: codeMap[data.current.weather_code] || 'Berawan', code: data.current.weather_code });
        const currentHourIndex = new Date().getHours();
        const formattedHourly  = [];
        for (let i = 0; i < 7; i++) {
          const index   = (currentHourIndex + i) % 24;
          const rawTime = data.hourly.time[index];
          formattedHourly.push({ time: i === 0 ? 'Sekarang' : rawTime ? rawTime.split('T')[1]?.substring(0, 5) : '--:--', temp: Math.round(data.hourly.temperature_2m[index]), condition: codeMap[data.hourly.weather_code[index]] || 'Berawan', code: data.hourly.weather_code[index], wind: Math.round(data.hourly.wind_speed_10m[index]) });
        }
        setHourlyForecast(formattedHourly);
        setWeatherLoading(false);
      } catch (error) { console.error('Weather fetch error:', error); setWeatherLoading(false); }
    };
    fetchRealWeather();
    const interval = setInterval(fetchRealWeather, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Telemetry sensor terpilih di konteks farm/kumbung
  const { target } = useFarmContext();
  const { kumbungId: targetKumbungId, sensorId: targetSensorId } = target;
  useEffect(() => subscribeLatestTelemetry(db, sensorData => {
    if (!sensorData) {
      setSystemStatus(prev => ({ ...prev, firebaseStatus: 'disconnected', networkStatus: 'disconnected', sensorsOnline: 0 }));
      return;
    }
    setKpiData(prev => {
      const tempVal = sensorData.temperature ?? prev.temperature.value;
      const humVal = sensorData.humidity ?? prev.humidity.value;
      const co2Val = sensorData.co2 ?? prev.co2.value;
      const pressureVal = sensorData.pressure ?? prev.pressure.value;
      return {
        ...prev,
        temperature: { value: tempVal, trend: tempVal > prev.temperature.value ? 'up' : tempVal < prev.temperature.value ? 'down' : 'stable', status: tempVal < 24 || tempVal > 30 ? 'warning' : 'optimal' },
        humidity: { value: humVal, trend: humVal > prev.humidity.value ? 'up' : humVal < prev.humidity.value ? 'down' : 'stable', status: humVal < 70 || humVal > 85 ? 'warning' : 'optimal' },
        co2: { value: co2Val, trend: co2Val > prev.co2.value ? 'up' : co2Val < prev.co2.value ? 'down' : 'stable', status: co2Val > 600 ? 'warning' : 'optimal' },
        pressure: { value: pressureVal, trend: pressureVal > prev.pressure.value ? 'up' : pressureVal < prev.pressure.value ? 'down' : 'stable', status: pressureVal < 1000 || pressureVal > 1025 ? 'warning' : 'optimal' },
      };
    });
    const online = !sensorData.quality.stale && sensorData.quality.status !== 'invalid';
    setSystemStatus(prev => ({ ...prev, firebaseStatus: 'connected', networkStatus: online ? 'connected' : 'disconnected', sensorsOnline: online ? 1 : 0 }));
    setLastSyncTime(new Date(sensorData.timestamp || Date.now()));
  }, error => {
    console.error('Firebase telemetry error:', error);
    setSystemStatus(prev => ({ ...prev, firebaseStatus: 'error' }));
  }, { kumbungId: targetKumbungId, sensorId: targetSensorId }), [targetKumbungId, targetSensorId]);

  return (
    <>
      <Helmet>
        <title>Dashboard Overview - Tandurai</title>
        <meta name="description" content="Real-time monitoring dashboard for Tandurai smart farm control system" />
      </Helmet>

      <div className="space-y-6">
        {/* ── Header ── */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-1">
                Dasbor Overview{' '}
                {username && <span className="text-green-600 dark:text-green-500">{username}</span>}
              </h1>
              <p className="text-muted-foreground text-sm">
                Monitoring real-time lingkungan smart farm kamu · {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-600 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Sistem Aktif
            </div>
          </div>
        </motion.div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <KPICard title="Temperature"            value={kpiData.temperature.value} unit="°C"  trend={kpiData.temperature.trend} status={kpiData.temperature.status} optimalRange="24-30°C"       icon={Thermometer} delay={0}   />
          <KPICard title="Humidity"               value={kpiData.humidity.value}    unit="%"   trend={kpiData.humidity.trend}    status={kpiData.humidity.status}    optimalRange="70-85%"        icon={Droplets}    delay={0.1} />
          <KPICard title="CO₂ Level"              value={kpiData.co2.value}         unit="ppm" trend={kpiData.co2.trend}         status={kpiData.co2.status}         optimalRange="400-600 ppm"   icon={Wind}        delay={0.2} />
          {/* ── Diganti: Air Quality → Air Pressure ── */}
          <KPICard title="Air Pressure"           value={kpiData.pressure.value}    unit="hPa" trend={kpiData.pressure.trend}    status={kpiData.pressure.status}    optimalRange="1000-1025 hPa" icon={Gauge}       delay={0.3} />
        </div>

        {/* Angka resmi dibaca langsung dari aiForecasts/latest; Dashboard tidak menghitung ulang. */}
        <DashboardForecastCard />

        {/* ── Weather + System Status ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <motion.div className="xl:col-span-2" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.6 }}>
            <Card className="h-full flex flex-col justify-between overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border/60 bg-muted/10">
                <CardTitle className="flex items-center gap-2.5 text-base font-bold"><Clock className="text-primary" size={20} />Ramalan 24 Jam — Sidoarjo</CardTitle>
                <Badge variant="secondary" className="text-[10px] bg-blue-500/10 text-blue-600 border-none px-2.5 font-bold">📡 Live Satelit</Badge>
              </CardHeader>
              <CardContent className="p-5 flex-1 flex flex-col justify-between space-y-6">
                {weatherLoading ? (
                  <div className="flex flex-col items-center justify-center py-20 mx-auto space-y-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                    <p className="text-xs text-muted-foreground">Menghubungkan satelit cuaca Sidoarjo...</p>
                  </div>
                ) : currentWeather ? (
                  <>
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gradient-to-br from-primary/5 to-transparent p-4 rounded-xl border border-primary/10 gap-4">
                      <div className="flex items-center gap-4">
                        <span className="text-5xl select-none leading-none filter drop-shadow">{getWeatherEmoji(currentWeather.code)}</span>
                        <div>
                          <h3 className="text-2xl font-black text-foreground leading-tight">{currentWeather.temp}°C</h3>
                          <p className="text-xs font-bold text-muted-foreground mt-0.5">{currentWeather.condition}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs font-semibold text-muted-foreground w-full sm:w-auto border-t sm:border-t-0 sm:border-l border-border/80 pt-3 sm:pt-0 sm:pl-5">
                        <div className="flex justify-between gap-4">Kelembapan: <span className="text-foreground font-bold">{currentWeather.humidity}%</span></div>
                        <div className="flex justify-between gap-4">Kecepatan Angin: <span className="text-foreground font-bold">{currentWeather.windSpeed} km/j</span></div>
                      </div>
                    </div>
                    <div className="overflow-x-auto pb-2 scrollbar-none">
                      <div className="flex gap-2.5 min-w-max">
                        {hourlyForecast.map((fc, idx) => (
                          <div key={idx} className={`rounded-xl p-3 flex flex-col items-center text-center border transition-all w-[92px] ${idx === 0 ? 'bg-primary text-primary-foreground border-primary shadow-md shadow-primary/10' : 'bg-muted/40 border-border/50 hover:bg-muted/70'}`}>
                            <span className={`text-[10px] font-bold ${idx === 0 ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{fc.time}</span>
                            <span className="text-2xl my-2 select-none filter drop-shadow-sm">{getWeatherEmoji(fc.code)}</span>
                            <span className="text-sm font-black tracking-tight">{fc.temp}°C</span>
                            <span className={`text-[9px] font-medium mt-1 truncate w-full ${idx === 0 ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>💨 {fc.wind} km/j</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-destructive py-10 justify-center mx-auto"><AlertCircle size={18} /><p className="text-xs font-bold">Gagal memuat sistem ramalan cuaca.</p></div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.7 }}>
            <Card className="h-full flex flex-col justify-between">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="flex items-center gap-2 text-base font-bold"><Activity className="text-primary" size={20} />Live System Status</CardTitle>
              </CardHeader>
              <CardContent className="p-5 flex-1 flex flex-col justify-between pt-4">
                <div className="space-y-3.5 text-sm">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground font-medium">Sensors Online</span><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 font-bold">{systemStatus.sensorsOnline} / 12</Badge></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground font-medium">Devices Online</span><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 font-bold">{systemStatus.devicesOnline} / 8</Badge></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground font-medium">Automation Status</span><div className="flex items-center gap-1.5 font-bold text-xs text-green-600"><CheckCircle2 size={15} /><span className="capitalize">{systemStatus.automationStatus}</span></div></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground font-medium">Last DB Sync</span><span className="font-bold text-foreground">{lastSyncTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground font-medium">Network Status</span><div className="flex items-center gap-1.5 font-bold text-xs text-green-600"><Wifi size={15} /><span className="capitalize">{systemStatus.networkStatus}</span></div></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground font-medium">Firebase Connection</span><div className="flex items-center gap-1.5"><Database className={systemStatus.firebaseStatus === 'connected' ? 'text-green-500' : 'text-yellow-500'} size={15} /><span className="font-bold text-xs capitalize">{systemStatus.firebaseStatus}</span></div></div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* ── AI Insights + Farm Health Score ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <motion.div className="xl:col-span-2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
            <AIInsightsPanel kpiData={kpiData} currentWeather={currentWeather} />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
            <FarmHealthScore kpiData={kpiData} currentWeather={currentWeather} />
          </motion.div>
        </div>
      </div>

      <ChatbotPopup kpiData={kpiData} currentWeather={currentWeather} />
    </>
  );
}
