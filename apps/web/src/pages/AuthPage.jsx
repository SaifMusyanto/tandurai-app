import React, { useState } from 'react';
import { auth, db } from '../firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from 'firebase/auth';
import { ref, set } from 'firebase/database';
import {
  AlertCircle, CheckCircle2, ArrowLeft, Leaf,
  Thermometer, Droplets, Wind, Zap, Activity, Shield, Wifi
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* ── Sensor SVG ilustrasi (inline, selalu muncul) ── */
function SensorIllustration() {
  return (
    <svg viewBox="0 0 200 260" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full drop-shadow-2xl">
      {/* Body utama */}
      <rect x="30" y="20" width="140" height="170" rx="18" fill="#d1d5db" />
      <rect x="30" y="20" width="140" height="170" rx="18" fill="url(#bodyGrad)" />

      {/* Panel depan */}
      <rect x="40" y="32" width="120" height="146" rx="12" fill="#e5e7eb" />
      <rect x="40" y="32" width="120" height="146" rx="12" fill="url(#panelGrad)" />

      {/* Logo Tandurai area */}
      <rect x="55" y="44" width="90" height="28" rx="6" fill="white" fillOpacity="0.7" />
      {/* Leaf icon simplified */}
      <ellipse cx="72" cy="58" rx="7" ry="8" fill="#16a34a" transform="rotate(-15 72 58)" />
      <line x1="72" y1="66" x2="72" y2="58" stroke="#15803d" strokeWidth="1.5" strokeLinecap="round" />
      <text x="84" y="62" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="11" fill="#15803d">Tandurai</text>

      {/* Status LEDs */}
      <circle cx="120" cy="50" r="4" fill="#22c55e">
        <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="133" cy="50" r="4" fill="#22c55e" fillOpacity="0.4" />

      {/* Big center button / sensor dial */}
      <circle cx="100" cy="118" r="36" fill="#9ca3af" />
      <circle cx="100" cy="118" r="36" fill="url(#dialOuter)" />
      <circle cx="100" cy="118" r="28" fill="#6b7280" />
      <circle cx="100" cy="118" r="28" fill="url(#dialInner)" />
      {/* leaf on dial */}
      <ellipse cx="100" cy="113" rx="9" ry="11" fill="white" fillOpacity="0.9" transform="rotate(-10 100 113)" />
      <line x1="100" y1="124" x2="100" y2="113" stroke="white" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.9" />

      {/* Side grips / clips */}
      <rect x="18" y="70" width="14" height="40" rx="7" fill="#b0b5bd" />
      <rect x="168" y="70" width="14" height="40" rx="7" fill="#b0b5bd" />
      <rect x="18" y="70" width="14" height="40" rx="7" fill="url(#gripGrad)" />
      <rect x="168" y="70" width="14" height="40" rx="7" fill="url(#gripGrad)" />

      {/* Bottom label strip */}
      <rect x="55" y="152" width="90" height="18" rx="5" fill="white" fillOpacity="0.5" />
      <text x="100" y="164" textAnchor="middle" fontFamily="system-ui, sans-serif" fontSize="8" fill="#374151" fontWeight="600">SENSOR NODE v2</text>

      {/* Stem / mounting pole */}
      <rect x="82" y="190" width="36" height="60" rx="8" fill="#9ca3af" />
      <rect x="82" y="190" width="36" height="60" rx="8" fill="url(#stemGrad)" />
      {/* Ventilation holes */}
      <circle cx="91" cy="228" r="3" fill="#6b7280" />
      <circle cx="100" cy="228" r="3" fill="#6b7280" />
      <circle cx="109" cy="228" r="3" fill="#6b7280" />
      <circle cx="91" cy="238" r="3" fill="#6b7280" />
      <circle cx="100" cy="238" r="3" fill="#6b7280" />
      <circle cx="109" cy="238" r="3" fill="#6b7280" />

      {/* Gradients */}
      <defs>
        <linearGradient id="bodyGrad" x1="30" y1="20" x2="170" y2="190" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="white" stopOpacity="0.3" />
          <stop offset="100%" stopColor="black" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="panelGrad" x1="40" y1="32" x2="160" y2="178" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="white" stopOpacity="0.6" />
          <stop offset="100%" stopColor="black" stopOpacity="0.08" />
        </linearGradient>
        <radialGradient id="dialOuter" cx="40%" cy="35%">
          <stop offset="0%" stopColor="white" stopOpacity="0.25" />
          <stop offset="100%" stopColor="black" stopOpacity="0.1" />
        </radialGradient>
        <radialGradient id="dialInner" cx="40%" cy="35%">
          <stop offset="0%" stopColor="white" stopOpacity="0.15" />
          <stop offset="100%" stopColor="black" stopOpacity="0.2" />
        </radialGradient>
        <linearGradient id="gripGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="white" stopOpacity="0.3" />
          <stop offset="100%" stopColor="black" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="stemGrad" x1="82" y1="190" x2="118" y2="250" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="white" stopOpacity="0.2" />
          <stop offset="100%" stopColor="black" stopOpacity="0.15" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── Fitur list ── */
const features = [
  { icon: Thermometer, label: 'Suhu Real-time',    desc: 'Pantau tiap rak setiap detik' },
  { icon: Droplets,    label: 'Irigasi Otomatis',   desc: 'Siram cerdas sesuai kebutuhan' },
  { icon: Wind,        label: 'Monitor CO₂',        desc: 'Kadar CO₂ optimal tanaman' },
  { icon: Zap,         label: 'Alert < 5 Detik',    desc: 'Notifikasi anomali instan' },
  { icon: Wifi,        label: 'Koneksi Nirkabel',   desc: 'WiFi & LoRa tanpa kabel' },
  { icon: Activity,    label: 'Analitik AI',         desc: 'Rekomendasi tumbuh otomatis' },
];

/* ── Live sensor mock data (animasi) ── */
function LiveWidget() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {[
        { label: 'Suhu', value: '26.4°C', color: 'text-orange-300' },
        { label: 'RH',   value: '72%',    color: 'text-blue-300' },
        { label: 'CO₂',  value: '812ppm', color: 'text-purple-300' },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-black/20 rounded-xl p-2.5 text-center backdrop-blur-sm border border-white/10">
          <div className={`text-base font-black ${color}`}>{value}</div>
          <div className="text-green-300 text-xs mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════
   Main Component
══════════════════════════════════════════ */
export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const switchMode = (newMode) => {
    setMode(newMode);
    setEmail(''); setPassword(''); setUsername('');
    setError(''); setSuccess('');
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      if (mode === 'register') {
        if (!username.trim()) { setError('Nama lengkap tidak boleh kosong.'); setLoading(false); return; }
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;
        await set(ref(db, `users/${uid}/profile`), { username: username.trim(), email, createdAt: Date.now() });
        await signOut(auth);
        switchMode('login');
        setSuccess('Akun berhasil dibuat! Silakan login.');
      } else if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else if (mode === 'forgot') {
        await sendPasswordResetEmail(auth, email);
        setSuccess('Link reset dikirim! Cek kotak masuk atau spam.');
        setEmail('');
      }
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')
        setError('Email atau password salah!');
      else if (err.code === 'auth/email-already-in-use') setError('Email ini sudah terdaftar!');
      else if (err.code === 'auth/weak-password') setError('Password minimal 6 karakter.');
      else if (err.code === 'auth/missing-email') setError('Masukkan email kamu terlebih dahulu.');
      else setError('Terjadi kesalahan. Coba beberapa saat lagi.');
    } finally { setLoading(false); }
  };

  const titles = { login: 'Masuk ke Dashboard', register: 'Buat Akun Tandurai', forgot: 'Reset Password' };
  const descs  = {
    login:    'Masukkan email dan password akun manajer lahan kamu.',
    register: 'Daftar untuk mulai mengelola perangkat pertanian vertikal.',
    forgot:   'Masukkan email kamu untuk menerima link pemulihan password.',
  };

  return (
    <div className="min-h-screen bg-background flex">

      {/* ════════════════════════════════
          Panel Kiri — Branding
      ════════════════════════════════ */}
      <div className="hidden lg:flex lg:w-[52%] flex-col bg-gradient-to-br from-green-700 via-green-600 to-emerald-700 p-10 text-white relative overflow-hidden">

        {/* Decorative blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-20 -left-20 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute top-1/2 -right-20 w-64 h-64 rounded-full bg-emerald-900/40 blur-3xl" />
          <div className="absolute -bottom-10 left-1/3 w-72 h-72 rounded-full bg-green-800/40 blur-3xl" />
        </div>

        {/* ── Top: Logo + tagline ── */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Leaf size={20} className="text-white" />
            </div>
            <div>
              <span className="text-xl font-black tracking-tight">Tandurai</span>
              <p className="text-green-200 text-xs">Smart Vertical Farm</p>
            </div>
          </div>
          {/* Online pill */}
          <div className="flex items-center gap-2 bg-black/20 border border-white/10 rounded-full px-3 py-1.5 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs font-semibold">Sistem Online</span>
          </div>
        </div>

        {/* ── Middle: 2-column layout ── */}
        <div className="relative z-10 flex-1 flex items-center gap-8 mt-8">

          {/* Kolom kiri: teks + fitur */}
          <div className="flex-1 flex flex-col gap-6">
            <div>
              <p className="text-green-300 text-xs font-semibold uppercase tracking-widest mb-2">Platform IoT Pertanian</p>
              <h2 className="text-3xl font-black leading-snug">
                Kelola Kebun<br />
                Vertikal Kamu<br />
                <span className="text-green-200">Lebih Cerdas.</span>
              </h2>
              <p className="text-green-100 text-sm mt-3 leading-relaxed">
                Monitor semua parameter kebun secara real-time. Sensor pintar Tandurai bekerja 24/7 tanpa henti.
              </p>
            </div>

            {/* Fitur grid 2×3 */}
            <div className="grid grid-cols-2 gap-2.5">
              {features.map(({ icon: Icon, label, desc }) => (
                <div key={label} className="bg-white/10 hover:bg-white/15 transition-colors rounded-xl p-3 border border-white/10 backdrop-blur-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                      <Icon size={12} className="text-white" />
                    </div>
                    <span className="text-xs font-bold leading-tight">{label}</span>
                  </div>
                  <p className="text-green-200 text-xs leading-snug">{desc}</p>
                </div>
              ))}
            </div>

            {/* Live data widget */}
            <div>
              <p className="text-green-300 text-xs font-semibold mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                Data Langsung — Rak A2
              </p>
              <LiveWidget />
            </div>
          </div>

          {/* Kolom kanan: sensor device */}
          <div className="w-48 flex flex-col items-center gap-4 shrink-0">
            {/* Device card */}
            <div className="relative w-full">
              <div className="absolute inset-0 rounded-2xl bg-green-400/20 blur-xl" />
              <div className="relative bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-4 flex items-center justify-center">
                <div className="w-36 h-48">
                  <SensorIllustration />
                </div>
              </div>
              {/* Floating accuracy badge */}
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-emerald-900 border border-emerald-600 rounded-full px-3 py-1 whitespace-nowrap shadow-lg">
                <span className="text-green-300 text-xs font-bold">✦ 99.8% Akurasi</span>
              </div>
            </div>

            {/* Device name + spec */}
            <div className="mt-4 text-center">
              <p className="text-white text-sm font-bold">Tandurai Node v2</p>
              <p className="text-green-300 text-xs mt-0.5">WiFi · LoRa · Bluetooth</p>
            </div>

            {/* Spec pills */}
            <div className="flex flex-col gap-1.5 w-full">
              {[
                { label: 'Temp Sensor', val: 'DHT22' },
                { label: 'CO₂ Sensor',  val: 'MH-Z19' },
                { label: 'Response',    val: '< 5s' },
              ].map(({ label, val }) => (
                <div key={label} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-1.5 border border-white/10">
                  <span className="text-green-300 text-xs">{label}</span>
                  <span className="text-white text-xs font-bold">{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Bottom stats ── */}
        <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-5 mt-6">
          {[
            { value: '12+',   label: 'Sensor Aktif' },
            { value: '24/7',  label: 'Uptime' },
            { value: '< 5s',  label: 'Respons Alert' },
            { value: '99.8%', label: 'Akurasi Data' },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-xl font-black">{s.value}</div>
              <div className="text-green-300 text-xs">{s.label}</div>
            </div>
          ))}
          <div className="text-green-400 text-xs text-right leading-snug opacity-60">
            © 2025 Tandurai<br />Smart Farm
          </div>
        </div>
      </div>

      {/* ════════════════════════════════
          Panel Kanan — Form
      ════════════════════════════════ */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 bg-background">

        {/* Logo mobile only */}
        <div className="flex lg:hidden items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center">
            <Leaf size={16} className="text-white" />
          </div>
          <span className="text-xl font-black text-foreground">Tandurai</span>
        </div>

        <div className="w-full max-w-sm">
          {/* Header */}
          <div className="mb-8">
            {mode === 'forgot' && (
              <button type="button" onClick={() => switchMode('login')}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
                <ArrowLeft size={16} /> Kembali ke Login
              </button>
            )}
            {mode === 'login' && (
              <div className="inline-flex items-center gap-1.5 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 text-xs font-medium px-2.5 py-1 rounded-full border border-green-200 dark:border-green-800 mb-4">
                <Shield size={11} /> Akses aman terenkripsi
              </div>
            )}
            <h1 className="text-2xl font-black text-foreground">{titles[mode]}</h1>
            <p className="text-muted-foreground text-sm mt-1">{descs[mode]}</p>
          </div>

          {/* Form */}
          <form onSubmit={handleAuth} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 p-3 text-sm rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
                <AlertCircle size={18} className="shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}
            {success && (
              <div className="flex items-start gap-2 p-3 text-sm rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 size={18} className="shrink-0 mt-0.5" /><span>{success}</span>
              </div>
            )}

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="username">Nama Lengkap</Label>
                <Input id="username" type="text" placeholder="Contoh: Alan Pratama"
                  value={username} onChange={(e) => setUsername(e.target.value)}
                  className="bg-muted/50 border-border focus-visible:ring-green-500" required />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="nama@farm.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="bg-muted/50 border-border focus-visible:ring-green-500" required />
            </div>

            {mode !== 'forgot' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === 'login' && (
                    <button type="button" onClick={() => switchMode('forgot')}
                      className="text-xs text-green-600 dark:text-green-400 font-medium hover:underline">
                      Lupa Password?
                    </button>
                  )}
                </div>
                <Input id="password" type="password" placeholder="••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="bg-muted/50 border-border focus-visible:ring-green-500" required />
              </div>
            )}

            <Button type="submit" disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white mt-2 h-11 font-semibold shadow-sm shadow-green-900/20 transition-all">
              {loading ? 'Memproses...'
                : mode === 'forgot' ? 'Kirim Link Reset'
                : mode === 'register' ? 'Daftar Sekarang'
                : 'Masuk Dashboard'}
            </Button>

            {mode !== 'forgot' && (
              <div className="text-center pt-2 text-sm text-muted-foreground">
                {mode === 'register' ? 'Sudah punya akun?' : 'Belum punya akun?'}{' '}
                <button type="button" onClick={() => switchMode(mode === 'register' ? 'login' : 'register')}
                  className="text-green-600 dark:text-green-400 font-medium hover:underline">
                  {mode === 'register' ? 'Login disini' : 'Daftar disini'}
                </button>
              </div>
            )}
          </form>

          {/* Trust badges */}
          {mode === 'login' && (
            <div className="mt-8 pt-6 border-t border-border">
              <p className="text-xs text-muted-foreground text-center mb-3">
                Dipercaya manajer kebun vertikal di seluruh Indonesia
              </p>
              <div className="flex justify-center gap-5">
                {[
                  { icon: Activity, text: 'Live Monitor' },
                  { icon: Shield,   text: 'Data Aman' },
                  { icon: Zap,      text: 'Respons Cepat' },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex flex-col items-center gap-1">
                    <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-green-950 border border-green-100 dark:border-green-900 flex items-center justify-center">
                      <Icon size={15} className="text-green-600 dark:text-green-400" />
                    </div>
                    <span className="text-xs text-muted-foreground">{text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}