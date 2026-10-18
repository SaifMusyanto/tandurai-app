import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Thermometer, Droplets, Wind,
  TrendingUp, TrendingDown, Minus, Wifi, Database, Activity,
  CheckCircle2, AlertCircle, Clock, Sparkles, RefreshCw, Zap,
  Lightbulb, AlertTriangle, Info, Send, X, MessageCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { auth } from '../firebase';
import { useKumbungHistory, useKumbungTelemetry } from '@/hooks/useKumbungTelemetry';
import { PARAMETERS, formatParameter, parameterStatus } from '@/lib/parameters';
import { useIot } from '@/contexts/IotContext';
import { useFarmContext } from '@/contexts/FarmContext';
import DashboardForecastCard from '@/components/DashboardForecastCard';
import WeatherCard from '@/components/WeatherCard';
import { useWeather } from '@/hooks/useWeather';
import { averageValues, farmHealthScore } from '@/lib/healthScore';

// ─────────────────────────────────────────────────────────────
// RULE-BASED INSIGHT ENGINE
// ─────────────────────────────────────────────────────────────
// Saran untuk jamur tiram di kumbung; batas dari rentang optimal & ambang alert farm (FarmContext).
const generateInsights = (kpiData, currentWeather, ranges, thresholds) => {
  const insights = [];
  const temp     = kpiData.temperature.value;
  const humidity = kpiData.humidity.value;
  const co2      = kpiData.co2.value;
  const [tLow, tHigh] = ranges.temperature;
  const [hLow, hHigh] = ranges.humidity;
  const [, cHigh]     = ranges.co2;

  // ── Suhu
  if (temp > thresholds.temperature.critical) {
    insights.push({ type: 'critical', title: 'Suhu Kritis — Miselium & Jamur Terancam', description: `Suhu ${temp}°C melewati batas kritis ${thresholds.temperature.critical}°C. Tubuh buah bisa layu dan miselium rusak. Nyalakan pengkabutan, buka ventilasi, dan basahi lantai/dinding kumbung untuk menurunkan suhu ke ${tLow}–${tHigh}°C.`, action: 'Turunkan Suhu' });
  } else if (temp > tHigh) {
    insights.push({ type: 'warning', title: 'Suhu Di Atas Optimal', description: `Suhu ${temp}°C di atas rentang optimal ${tLow}–${tHigh}°C. Jamur cenderung cepat mekar dengan tudung tipis. Tambah pengkabutan dan sirkulasi udara.`, action: 'Cek Ventilasi' });
  } else if (temp < tLow) {
    insights.push({ type: 'info', title: 'Suhu Di Bawah Optimal', description: `Suhu ${temp}°C di bawah ${tLow}°C. Pertumbuhan jamur melambat. Kurangi bukaan ventilasi di malam hari agar panas kumbung tertahan.`, action: 'Atur Ventilasi' });
  } else {
    insights.push({ type: 'success', title: 'Suhu Ideal untuk Jamur Tiram', description: `Suhu ${temp}°C berada di rentang optimal ${tLow}–${tHigh}°C untuk pembentukan tubuh buah.`, action: 'Lihat Detail' });
  }

  // ── Kelembapan udara
  if (humidity < thresholds.humidity.critical) {
    insights.push({ type: 'critical', title: 'Kumbung Terlalu Kering', description: `Kelembapan ${humidity}% di bawah batas kritis ${thresholds.humidity.critical}%. Pinggir tudung akan mengering dan pecah. Nyalakan pengkabutan sekarang.`, action: 'Nyalakan Pengkabutan' });
  } else if (humidity < hLow) {
    insights.push({ type: 'warning', title: 'Kelembapan Kurang', description: `Kelembapan ${humidity}% di bawah rentang optimal ${hLow}–${hHigh}%. Tambah frekuensi pengkabutan agar jamur tidak kerdil.`, action: 'Tambah Pengkabutan' });
  } else if (humidity > hHigh) {
    insights.push({ type: 'warning', title: 'Kelembapan Terlalu Tinggi', description: `Kelembapan ${humidity}% di atas ${hHigh}%. Air menggenang di tudung memicu bercak bakteri dan baglog busuk. Kurangi pengkabutan dan perbaiki sirkulasi udara.`, action: 'Kurangi Pengkabutan' });
  } else {
    insights.push({ type: 'success', title: 'Kelembapan Ideal', description: `Kelembapan ${humidity}% berada di rentang optimal ${hLow}–${hHigh}% untuk pertumbuhan tubuh buah.`, action: 'Lihat Detail' });
  }

  // ── CO₂ (makin rendah makin baik; tinggi = tangkai panjang, tudung kecil)
  if (co2 > thresholds.co2.critical) {
    insights.push({ type: 'critical', title: 'CO₂ Sangat Tinggi', description: `CO₂ ${co2} ppm melewati batas kritis ${thresholds.co2.critical} ppm. Jamur akan bertangkai panjang dengan tudung kecil. Buka ventilasi penuh dan nyalakan kipas.`, action: 'Buka Ventilasi Penuh' });
  } else if (co2 > cHigh) {
    insights.push({ type: 'warning', title: 'Sirkulasi Udara Kurang', description: `CO₂ ${co2} ppm di atas batas optimal ${cHigh} ppm. Tambah pertukaran udara segar, terutama saat jamur mulai tumbuh.`, action: 'Nyalakan Kipas' });
  } else if (co2 > 0) {
    insights.push({ type: 'success', title: 'Sirkulasi Udara Baik', description: `CO₂ ${co2} ppm masih di bawah ${cHigh} ppm, pertukaran udara kumbung cukup.`, action: 'Lihat Detail' });
  }

  // ── Cuaca luar
  if (currentWeather) {
    if (currentWeather.temp > 32 && temp > tHigh - 1) {
      insights.push({ type: 'warning', title: 'Cuaca Luar Panas', description: `Suhu luar ${currentWeather.temp}°C ikut menaikkan suhu kumbung (${temp}°C). Siapkan pengkabutan lebih sering di siang hari.`, action: 'Siapkan Pendinginan' });
    } else if (currentWeather.humidity < 60 && humidity < hLow + 5) {
      insights.push({ type: 'info', title: 'Udara Luar Kering', description: `Kelembapan luar ${currentWeather.humidity}%. Batasi bukaan ventilasi agar kumbung tidak cepat kering.`, action: 'Atur Ventilasi' });
    }
  }

  const priority = { critical: 0, warning: 1, info: 2, success: 3 };
  return insights.sort((a, b) => priority[a.type] - priority[b.type]).slice(0, 3);
};

// ─────────────────────────────────────────────────────────────
// FARM HEALTH SCORE — rumus di lib/healthScore (rentang optimal + ambang alert farm)
// ─────────────────────────────────────────────────────────────
const FarmHealthScore = ({ values, thresholds, ranges, currentWeather }) => {
  const { overall, parts } = farmHealthScore(values, thresholds, ranges);
  const hotOutside = currentWeather && currentWeather.temp > 32;

  const circumference    = 2 * Math.PI * 26;
  const strokeDashoffset = circumference - ((overall ?? 0) / 100) * circumference;

  const getBarColor   = (v) => v >= 80 ? 'bg-green-500' : v >= 60 ? 'bg-yellow-500' : v >= 40 ? 'bg-orange-500' : 'bg-red-500';
  const getScoreLabel = (v) => v >= 85 ? 'Sangat Baik' : v >= 70 ? 'Baik' : v >= 55 ? 'Cukup' : v >= 40 ? 'Perlu Perhatian' : 'Kritis';
  const getScoreColor = (v) => v >= 85 ? 'text-green-600' : v >= 70 ? 'text-emerald-600' : v >= 55 ? 'text-yellow-600' : v >= 40 ? 'text-orange-600' : 'text-red-600';

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
              <span className="text-4xl font-bold">{overall ?? '–'}</span>
              <span className="text-muted-foreground text-sm">/100</span>
            </div>
            <p className={`text-xs font-semibold mt-1 ${overall === null ? 'text-muted-foreground' : getScoreColor(overall)}`}>
              {overall === null ? 'Belum ada data sensor' : getScoreLabel(overall)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Rata-rata 30 menit terakhir</p>
          </div>
          <svg width="72" height="72" viewBox="0 0 64 64" aria-hidden="true">
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

        <div className="space-y-2.5">
          {parts.map(({ key, value, score }) => (
            <div key={key}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">{PARAMETERS[key].label} <span className="text-[10px]">· {formatParameter(key, value)}</span></span>
                <span className={`font-bold ${score === null ? 'text-muted-foreground' : getScoreColor(score)}`}>{score ?? '–'}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${getBarColor(score ?? 0)}`} style={{ width: `${score ?? 0}%` }} />
              </div>
            </div>
          ))}
        </div>

        <p className="mt-auto border-t border-border/50 pt-3 text-[10px] leading-relaxed text-muted-foreground">
          100 = di rentang optimal, 70 = batas peringatan, 30 = batas kritis (rentang & ambang di Pengaturan → Notifikasi).
          Bobot suhu 40%, kelembapan 35%, CO₂ 25%; skor total maksimal skor terburuk + 20.
          {hotOutside && <span className="block mt-1 text-orange-500">⚠ Cuaca luar {currentWeather.temp}°C — suhu kumbung cenderung naik, siapkan pendinginan.</span>}
        </p>
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
const AIInsightsPanel = ({ kpiData, currentWeather, ranges, thresholds }) => {
  const [insights, setInsights] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (kpiData.temperature.value === 0) return;
    setInsights(generateInsights(kpiData, currentWeather, ranges, thresholds));
    setLastUpdated(new Date());
  }, [
    kpiData.temperature.value,
    kpiData.humidity.value,
    kpiData.co2.value,
    currentWeather,
    ranges,
    thresholds,
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
const ChatbotPopup = ({ kpiData, currentWeather, locationName, ranges }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([{ role: 'assistant', content: 'Halo! Saya asisten AI Tandurai 🌱 Saya bisa membantu menganalisis kondisi kumbung kamu — suhu, kelembapan, CO₂, pengkabutan, dan lainnya. Ada yang bisa saya bantu?' }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const QUICK_CHIPS = ['Analisis kondisi kumbung sekarang', 'CO₂ terlalu tinggi, apa solusinya?', 'Kapan sebaiknya pengkabutan?', 'Tips hemat energi untuk kumbung'];

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isLoading]);
  useEffect(() => { if (isOpen) setUnreadCount(0); }, [isOpen]);

  const handleInputChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
  };

  const buildSystemPrompt = () => {
    const { temperature, humidity, co2 } = kpiData;
    const weather = currentWeather
      ? `Cuaca luar: ${currentWeather.condition}, ${currentWeather.temp}°C, angin ${currentWeather.windSpeed} km/jam, kelembapan luar ${currentWeather.humidity}%`
      : 'Data cuaca luar tidak tersedia';
    return `Kamu adalah asisten AI cerdas untuk sistem smart farm bernama Tandurai, sebuah budidaya jamur di kumbung berbasis IoT di ${locationName}, Indonesia.\n\nDATA SENSOR REAL-TIME KEBUN SAAT INI:\n- Suhu: ${temperature.value}°C (optimal: ${ranges.temperature[0]}–${ranges.temperature[1]}°C) — status: ${temperature.status}\n- Kelembapan udara: ${humidity.value}% (optimal: ${ranges.humidity[0]}–${ranges.humidity[1]}%) — status: ${humidity.status}\n- Kadar CO₂: ${co2.value} ppm (optimal: ≤ ${ranges.co2[1]} ppm) — status: ${co2.status}\n- ${weather}\n\nPERAN & TUGAS KAMU:\n- Berikan analisis dan saran berbasis data sensor di atas secara real-time\n- Gunakan bahasa Indonesia yang ramah, profesional, dan mudah dipahami petani\n- Berikan rekomendasi tindakan konkret dan spesifik, bukan jawaban umum\n- Jika ada kondisi kritis/warning, prioritaskan penanganannya terlebih dahulu\n- Jawaban singkat untuk pertanyaan sederhana, detail untuk pertanyaan teknis\n- Gunakan emoji secukupnya agar respons lebih hidup dan mudah dibaca\n- Jangan mengulang semua data sensor kecuali memang relevan dengan pertanyaan\n- Format respons dengan rapi, gunakan poin/angka jika ada langkah-langkah
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
  const clearChat = () => setMessages([{ role: 'assistant', content: 'Halo! Saya asisten AI Tandurai 🌱 Percakapan baru dimulai. Ada yang bisa saya bantu untuk kumbung kamu?' }]);

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
                placeholder="Tanya tentang kumbung kamu… (Enter kirim)" rows={1} disabled={isLoading}
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
  });

  const [systemStatus, setSystemStatus] = useState({
    sensorsOnline: 12, devicesOnline: 8, automationStatus: 'active', networkStatus: 'connected', backendStatus: 'connecting',
  });

  const [lastSyncTime, setLastSyncTime]   = useState(new Date());
  const weather = useWeather();
  const currentWeather = weather.current;

  // ── Nama pengguna dari profil backend (fallback: bagian depan email)
  const { profile, ranges, thresholds } = useFarmContext();
  useEffect(() => {
    setUsername(profile?.username || auth.currentUser?.email?.split('@')[0] || 'Manager');
  }, [profile?.username]);

  // ── Health score: rata-rata 30 menit terakhir (fallback: nilai live); rentang & ambang dari FarmContext
  const { rows: recentRows } = useKumbungHistory({ rangeMs: 30 * 60 * 1000, maxPoints: 2000 });

  // ── Kondisi kumbung terpilih: gabungan semua sensor (sumber tunggal useKumbungTelemetry)
  const telemetry = useKumbungTelemetry();
  const { streamConnected, error: backendError } = useIot();
  useEffect(() => {
    setSystemStatus(prev => ({ ...prev, backendStatus: streamConnected ? 'connected' : backendError ? 'error' : 'connecting' }));
  }, [streamConnected, backendError]);
  useEffect(() => {
    const { values } = telemetry;
    if (!telemetry.timestamp) {
      setSystemStatus(prev => ({ ...prev, networkStatus: 'disconnected', sensorsOnline: 0 }));
      return;
    }
    setKpiData(prev => Object.fromEntries(Object.keys(PARAMETERS).map(key => {
      const value = values[key] ?? prev[key].value;
      const trend = value > prev[key].value ? 'up' : value < prev[key].value ? 'down' : 'stable';
      return [key, { value, trend, status: parameterStatus(key, value, ranges) === 'warning' ? 'warning' : 'optimal' }];
    })));
    setSystemStatus(prev => ({
      ...prev,
      networkStatus: telemetry.online ? 'connected' : 'disconnected',
      sensorsOnline: telemetry.readings.filter(reading => !reading.quality.stale).length,
    }));
    setLastSyncTime(new Date(telemetry.timestamp));
  }, [telemetry, ranges]);

  const healthValues = useMemo(() => ({ ...telemetry.values, ...averageValues(recentRows) }), [telemetry.values, recentRows]);

  return (
    <>
      <Helmet>
        <title>Dashboard Tandurai</title>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[['temperature', Thermometer], ['humidity', Droplets], ['co2', Wind]].map(([key, Icon], index) => {
            const parameter = PARAMETERS[key];
            return (
              <KPICard key={key} title={parameter.label} value={kpiData[key].value} unit={parameter.unit} trend={kpiData[key].trend}
                status={kpiData[key].status} optimalRange={`${ranges[key][0]}–${ranges[key][1]} ${parameter.unit}`} icon={Icon} delay={index * 0.1} />
            );
          })}
        </div>

        {/* Angka resmi dibaca langsung dari aiForecasts/latest; Dashboard tidak menghitung ulang. */}
        <DashboardForecastCard />

        {/* ── Weather + System Status ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <motion.div className="xl:col-span-2" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.6 }}>
            <WeatherCard weather={weather} className="h-full" />
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
                  <div className="flex items-center justify-between"><span className="text-muted-foreground font-medium">Koneksi Backend</span><div className="flex items-center gap-1.5"><Database className={systemStatus.backendStatus === 'connected' ? 'text-green-500' : 'text-yellow-500'} size={15} /><span className="font-bold text-xs capitalize">{systemStatus.backendStatus}</span></div></div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* ── AI Insights + Farm Health Score ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <motion.div className="xl:col-span-2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
            <AIInsightsPanel kpiData={kpiData} currentWeather={currentWeather} ranges={ranges} thresholds={thresholds} />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
            <FarmHealthScore values={healthValues} thresholds={thresholds} ranges={ranges} currentWeather={currentWeather} />
          </motion.div>
        </div>
      </div>

      <ChatbotPopup kpiData={kpiData} currentWeather={currentWeather} locationName={weather.location.name} ranges={ranges} />
    </>
  );
}
