import React, { useState, useEffect, createContext, useContext } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Save, User, Bell, Sliders, Globe, Shield,
  ChevronRight, Check, LogOut, Eye, EyeOff,
  MapPin, Loader2, Send, AlertTriangle, Key,
  Thermometer, Droplets, Wind, Leaf, Waves,
  FlaskConical, Clock,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

import { auth, db } from '../firebase';
import { ref, get, set, update } from 'firebase/database';
import {
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signOut,
} from 'firebase/auth';

/* ─────────────────────────────────────────────────────────────────────
   TRANSLATIONS
───────────────────────────────────────────────────────────────────── */
const T = {
  id: {
    pageTitle: 'Pengaturan - Tandurai',
    heading: 'Pengaturan',
    subheading: 'Kelola preferensi farm dan konfigurasi sistem Anda',
    saveBtn: 'Simpan Perubahan',
    saving: 'Menyimpan…',
    saved: 'Tersimpan!',
    savedToast: 'Pengaturan berhasil disimpan',
    settings: 'Pengaturan',
    unsaved: 'Ada perubahan yang belum disimpan',
    tabs: {
      general:       { label: 'Umum',          desc: 'Info farm & lokasi' },
      automation:    { label: 'Otomasi',        desc: 'Ambang & pemicu' },
      notifications: { label: 'Notifikasi',     desc: 'Telegram & peringatan' },
      account:       { label: 'Akun',           desc: 'Profil pengguna' },
      security:      { label: 'Keamanan',       desc: 'Kata sandi & akses' },
    },
    general: {
      farmIdentity: 'Identitas Farm',
      farmIdentityDesc: 'Informasi dasar tentang fasilitas Anda',
      farmName: 'Nama Farm',
      farmNameHint: 'Ditampilkan di seluruh dashboard dan laporan',
      farmType: 'Jenis Farm',
      farmTypeHint: 'Kategori tanaman utama',
      location: 'Lokasi Farm',
      locationHint: 'Klik "Deteksi" untuk mengambil lokasi GPS saat ini',
      locationBtn: 'Deteksi Lokasi',
      locationDetecting: 'Mendeteksi…',
      locationDetail: 'Detail Lokasi',
      locationDetailHint: 'Terisi otomatis — kecamatan, kota, provinsi',
      regional: 'Pengaturan Regional',
      regionalDesc: 'Preferensi lokal dan waktu',
      timezone: 'Zona Waktu',
      timezoneHint: 'Semua cap waktu menggunakan zona ini',
      language: 'Bahasa',
    },
    automation: {
      master: 'Kontrol Utama',
      masterDesc: 'Saklar otomasi global',
      masterEnable: 'Aktifkan Otomasi Utama',
      masterEnableHint: 'Saat mati, semua tindakan otomatis dijeda — perangkat dikontrol manual',
      emergencyShutoff: 'Pemutusan Darurat Otomatis',
      emergencyShutoffHint: 'Segera matikan semua aktuator jika sensor mendeteksi kondisi kritis',
      climate: 'Ambang Iklim & Aktuator',
      climateDesc: 'Nilai target yang memicu respons otomatis perangkat',
      targetHumidity: 'Target Kelembaban (%)',
      targetHumidityHint: 'Misting aktif jika kelembaban turun di bawah nilai ini',
      targetTemp: 'Target Suhu (°C)',
      targetTempHint: 'Suhu dasar untuk kondisi tumbuh jamur optimal',
      fanTrigger: 'Pemicu Kipas Exhaust (°C)',
      fanTriggerHint: 'Kipas exhaust menyala jika suhu melewati nilai ini',
      sprayDuration: 'Durasi Misting (detik)',
      sprayDurationHint: 'Berapa lama misting berjalan per siklus',
      co2: 'Ambang CO₂ — Pemicu Ventilasi (ppm)',
      co2Hint: 'Ventilasi aktif jika CO₂ melampaui nilai ini',
      schedules: 'Jadwal Otomasi',
      schedulesDesc: 'Jendela waktu aktif untuk semua otomasi',
      activeHours: 'Jam Aktif',
      activeHoursHint: 'Otomasi hanya berjalan dalam rentang jam ini',
      to: 'hingga',
      cooldown: 'Anti-Spam Notifikasi',
      cooldownDesc: 'Pengaturan ini sinkron dengan Cloud Functions — mencegah notifikasi berulang',
      cooldownMinutes: 'Cooldown Notifikasi (menit)',
      cooldownHint: 'Alert yang sama tidak dikirim ulang dalam X menit. Default: 10 menit',
    },
    notifications: {
      telegram: 'Konfigurasi Telegram Bot',
      telegramDesc: 'Kirim peringatan farm langsung ke Telegram via bot',
      telegramEnable: 'Aktifkan Notifikasi Telegram',
      telegramEnableHint: 'Peringatan sensor dikirim via bot ke grup atau chat personal',
      botToken: 'Bot Token',
      botTokenHint: 'Dapatkan dari @BotFather — jangan bagikan ke siapa pun',
      botTokenPlaceholder: '123456789:AAFxxxxxxx',
      chatId: 'Chat ID Tujuan',
      chatIdHint: 'ID grup (awali minus) atau personal. Cek via @userinfobot',
      chatIdPlaceholder: '-100123456789',
      testBtn: 'Kirim Pesan Test',
      testSending: 'Mengirim…',
      testSuccess: '✅ Pesan test berhasil diterima!',
      testFail: 'Gagal kirim. Periksa Token & Chat ID.',
      filters: 'Filter Jenis Peringatan',
      filtersDesc: 'Pilih kategori alert yang ingin diterima di Telegram',
      notifCritical: 'Peringatan Kritis',
      notifCriticalHint: 'Suhu/kelembaban/CO₂ melampaui batas berbahaya bagi jamur',
      notifWarning: 'Peringatan Sedang (Warning)',
      notifWarningHint: 'Kondisi belum kritis tapi perlu perhatian segera',
      notifOffline: 'Perangkat Offline',
      notifOfflineHint: 'Sensor atau aktuator kehilangan koneksi',
      notifAutomation: 'Event Otomasi',
      notifAutomationHint: 'Kipas aktif, misting dimulai, ventilasi terbuka, dll',
      notifWeekly: 'Ringkasan Mingguan',
      notifWeeklyHint: 'Rangkuman aktivitas farm setiap Senin pukul 08:00 WIB',
      alertThresholds: 'Batas Peringatan Sensor',
      alertThresholdsDesc: 'Nilai-nilai ini dibaca langsung oleh Cloud Functions untuk memutuskan kapan mengirim alert. Simpan perubahan agar sinkron.',
      tempCriticalHigh: 'Suhu Kritis Atas (°C)',
      tempCriticalHighHint: 'CRITICAL — suhu di atas ini sangat berbahaya bagi jamur',
      tempWarnHigh: 'Suhu Warning Atas (°C)',
      tempWarnHighHint: 'WARNING — suhu mulai di atas optimal',
      tempWarnLow: 'Suhu Warning Bawah (°C)',
      tempWarnLowHint: 'WARNING — suhu mulai terlalu dingin',
      tempCriticalLow: 'Suhu Kritis Bawah (°C)',
      tempCriticalLowHint: 'CRITICAL — suhu terlalu rendah, metabolisme terhambat',
      humWarnLow: 'Kelembaban Warning Bawah (%)',
      humWarnLowHint: 'WARNING — kelembaban udara terlalu rendah',
      humWarnHigh: 'Kelembaban Warning Atas (%)',
      humWarnHighHint: 'WARNING — kelembaban terlalu tinggi, risiko kontaminasi',
      co2Critical: 'CO₂ Kritis (ppm)',
      co2CriticalHint: 'CRITICAL — kadar CO₂ sangat berbahaya',
      co2Warn: 'CO₂ Warning (ppm)',
      co2WarnHint: 'WARNING — CO₂ mulai melampaui batas aman',
      moistCriticalLow: 'Media Tanam Kritis Kering (%)',
      moistCriticalLowHint: 'CRITICAL — media tanam sangat kering',
      moistWarnLow: 'Media Tanam Warning Kering (%)',
      moistWarnLowHint: 'WARNING — media tanam mulai kering',
      moistWarnHigh: 'Media Tanam Warning Basah (%)',
      moistWarnHighHint: 'WARNING — media tanam terlalu lembap, risiko busuk akar',
      waterCritical: 'Tangki Air Kritis (%)',
      waterCriticalHint: 'CRITICAL — tangki hampir kosong',
      waterWarn: 'Tangki Air Warning (%)',
      waterWarnHint: 'WARNING — level tangki mulai rendah',
      howTo: 'Cara Setup Telegram Bot',
      howToStep1: '1. Buka Telegram → cari @BotFather',
      howToStep2: '2. Kirim /newbot → ikuti instruksi → salin token',
      howToStep3: '3. Tambahkan bot ke grup atau mulai chat personal dengan bot',
      howToStep4: '4. Kirim pesan ke bot/grup → buka @userinfobot untuk Chat ID',
      howToStep5: '5. Tempel token & Chat ID di atas → klik "Kirim Pesan Test"',
    },
    account: {
      profile: 'Profil Akun',
      profileDesc: 'Data akun yang sedang aktif login',
      displayName: 'Nama Tampilan',
      displayNameHint: 'Nama yang muncul di header dashboard',
      email: 'Alamat Email',
      emailHint: 'Digunakan untuk login — tidak bisa diubah dari sini',
      uid: 'User ID',
      provider: 'Metode Login',
      lastSignIn: 'Login Terakhir',
      updateProfile: 'Simpan Perubahan Profil',
      updating: 'Menyimpan…',
      preferences: 'Preferensi Tampilan',
      preferencesDesc: 'Pengaturan visual antarmuka',
      compactMode: 'Mode Ringkas',
      compactModeHint: 'Kurangi padding di kartu-kartu dashboard',
      liveIndicators: 'Indikator Live Sensor',
      liveIndicatorsHint: 'Animasi denyut pada sensor yang aktif',
    },
    security: {
      changePassword: 'Ubah Kata Sandi',
      changePasswordDesc: 'Perbarui kata sandi akun Anda — memerlukan kata sandi saat ini',
      currentPassword: 'Kata Sandi Saat Ini',
      currentPasswordHint: 'Diperlukan untuk verifikasi identitas sebelum ganti',
      newPassword: 'Kata Sandi Baru',
      newPasswordHint: 'Minimal 8 karakter — kombinasi huruf, angka & simbol lebih aman',
      confirmPassword: 'Konfirmasi Kata Sandi Baru',
      confirmPasswordHint: 'Ketik ulang kata sandi baru untuk konfirmasi',
      changeBtn: 'Ganti Kata Sandi',
      changing: 'Memproses…',
      pwSuccess: 'Kata sandi berhasil diubah!',
      pwMismatch: 'Konfirmasi kata sandi tidak cocok.',
      pwWeak: 'Kata sandi baru minimal 8 karakter.',
      pwWrongCurrent: 'Kata sandi saat ini salah.',
      access: 'Kontrol Sesi',
      accessDesc: 'Pengaturan keamanan sesi login',
      sessionTimeout: 'Auto-Logout Saat Tidak Aktif',
      sessionTimeoutHint: 'Keluar otomatis setelah 30 menit tidak ada aktivitas',
      dangerZone: 'Zona Bahaya',
      dangerZoneDesc: 'Tindakan yang mempengaruhi semua sesi aktif',
      signOutAllLabel: 'Keluar dari semua perangkat',
      signOutAllHint: 'Membatalkan semua sesi aktif — Anda akan diarahkan ke halaman login',
      signOutAllBtn: 'Keluar Semua',
      signOutConfirm: 'Berhasil keluar dari semua perangkat.',
    },
  },
  en: {
    pageTitle: 'Settings - Tandurai',
    heading: 'Settings',
    subheading: 'Manage your farm preferences and system configuration',
    saveBtn: 'Save Changes',
    saving: 'Saving…',
    saved: 'Saved!',
    savedToast: 'Settings saved successfully',
    settings: 'Settings',
    unsaved: 'You have unsaved changes',
    tabs: {
      general:       { label: 'General',       desc: 'Farm info & locale' },
      automation:    { label: 'Automation',     desc: 'Thresholds & triggers' },
      notifications: { label: 'Notifications', desc: 'Telegram & alerts' },
      account:       { label: 'Account',        desc: 'Profile details' },
      security:      { label: 'Security',       desc: 'Password & access' },
    },
    general: {
      farmIdentity: 'Farm Identity',
      farmIdentityDesc: 'Basic information about your facility',
      farmName: 'Farm Name',
      farmNameHint: 'Displayed across dashboards and reports',
      farmType: 'Farm Type',
      farmTypeHint: 'Primary crop category',
      location: 'Farm Location',
      locationHint: 'Click "Detect" to get current GPS coordinates',
      locationBtn: 'Detect Location',
      locationDetecting: 'Detecting…',
      locationDetail: 'Location Detail',
      locationDetailHint: 'Auto-filled — district, city, province',
      regional: 'Regional Settings',
      regionalDesc: 'Locale and time preferences',
      timezone: 'Time Zone',
      timezoneHint: 'All timestamps use this zone',
      language: 'Language',
    },
    automation: {
      master: 'Master Control',
      masterDesc: 'Global automation switch',
      masterEnable: 'Enable Master Automation',
      masterEnableHint: 'When off, all automated actions are paused — devices must be controlled manually',
      emergencyShutoff: 'Emergency Auto-Shutoff',
      emergencyShutoffHint: 'Immediately cut all actuators if sensors detect a critical reading',
      climate: 'Climate & Actuator Thresholds',
      climateDesc: 'Target values that trigger automated device responses',
      targetHumidity: 'Target Humidity (%)',
      targetHumidityHint: 'Misting activates if humidity drops below this value',
      targetTemp: 'Target Temperature (°C)',
      targetTempHint: 'Baseline temperature for optimal mushroom growing',
      fanTrigger: 'Exhaust Fan Trigger (°C)',
      fanTriggerHint: 'Exhaust fan turns on when temperature exceeds this value',
      sprayDuration: 'Misting Duration (seconds)',
      sprayDurationHint: 'How long misting runs per cycle',
      co2: 'CO₂ Ventilation Trigger (ppm)',
      co2Hint: 'Ventilation activates when CO₂ exceeds this level',
      schedules: 'Automation Schedule',
      schedulesDesc: 'Active time window for all automation',
      activeHours: 'Active Hours',
      activeHoursHint: 'Automation only runs within this time window',
      to: 'to',
      cooldown: 'Anti-Spam Notification',
      cooldownDesc: 'Synced with Cloud Functions — prevents repeated notifications',
      cooldownMinutes: 'Notification Cooldown (minutes)',
      cooldownHint: 'Same alert won\'t resend within X minutes. Default: 10 min',
    },
    notifications: {
      telegram: 'Telegram Bot Configuration',
      telegramDesc: 'Send farm alerts directly to Telegram via a bot',
      telegramEnable: 'Enable Telegram Notifications',
      telegramEnableHint: 'Sensor alerts sent via bot to a group or personal chat',
      botToken: 'Bot Token',
      botTokenHint: 'Get from @BotFather — never share this with anyone',
      botTokenPlaceholder: '123456789:AAFxxxxxxx',
      chatId: 'Destination Chat ID',
      chatIdHint: 'Group ID (starts with minus) or personal. Check via @userinfobot',
      chatIdPlaceholder: '-100123456789',
      testBtn: 'Send Test Message',
      testSending: 'Sending…',
      testSuccess: '✅ Test message received!',
      testFail: 'Failed to send. Check Token & Chat ID.',
      filters: 'Alert Type Filters',
      filtersDesc: 'Choose which alert categories to receive on Telegram',
      notifCritical: 'Critical Alerts',
      notifCriticalHint: 'Temp/humidity/CO₂ exceeds danger threshold for mushrooms',
      notifWarning: 'Moderate Warnings',
      notifWarningHint: 'Conditions not yet critical but need attention',
      notifOffline: 'Device Offline',
      notifOfflineHint: 'Sensor or actuator loses connection',
      notifAutomation: 'Automation Events',
      notifAutomationHint: 'Fan activated, misting started, ventilation opened, etc',
      notifWeekly: 'Weekly Summary',
      notifWeeklyHint: 'Farm activity digest every Monday 08:00 WIB',
      alertThresholds: 'Sensor Alert Thresholds',
      alertThresholdsDesc: 'These values are read directly by Cloud Functions to decide when to send alerts. Save changes to sync.',
      tempCriticalHigh: 'Critical High Temp (°C)',
      tempCriticalHighHint: 'CRITICAL — above this temp is dangerous for mushrooms',
      tempWarnHigh: 'Warning High Temp (°C)',
      tempWarnHighHint: 'WARNING — temp starting to exceed optimal range',
      tempWarnLow: 'Warning Low Temp (°C)',
      tempWarnLowHint: 'WARNING — temp getting too cold',
      tempCriticalLow: 'Critical Low Temp (°C)',
      tempCriticalLowHint: 'CRITICAL — too cold, metabolism impaired',
      humWarnLow: 'Warning Low Humidity (%)',
      humWarnLowHint: 'WARNING — air humidity too low',
      humWarnHigh: 'Warning High Humidity (%)',
      humWarnHighHint: 'WARNING — too humid, contamination risk',
      co2Critical: 'Critical CO₂ (ppm)',
      co2CriticalHint: 'CRITICAL — CO₂ level is dangerous',
      co2Warn: 'Warning CO₂ (ppm)',
      co2WarnHint: 'WARNING — CO₂ starting to exceed safe limit',
      moistCriticalLow: 'Critical Dry Substrate (%)',
      moistCriticalLowHint: 'CRITICAL — substrate extremely dry',
      moistWarnLow: 'Warning Dry Substrate (%)',
      moistWarnLowHint: 'WARNING — substrate starting to dry out',
      moistWarnHigh: 'Warning Wet Substrate (%)',
      moistWarnHighHint: 'WARNING — substrate too wet, root rot risk',
      waterCritical: 'Critical Water Level (%)',
      waterCriticalHint: 'CRITICAL — tank almost empty',
      waterWarn: 'Warning Water Level (%)',
      waterWarnHint: 'WARNING — tank level getting low',
      howTo: 'How to Setup Telegram Bot',
      howToStep1: '1. Open Telegram → find @BotFather',
      howToStep2: '2. Send /newbot → follow instructions → copy token',
      howToStep3: '3. Add bot to a group or start a personal chat with it',
      howToStep4: '4. Send a message to bot/group → open @userinfobot for Chat ID',
      howToStep5: '5. Paste token & Chat ID above → click "Send Test Message"',
    },
    account: {
      profile: 'Account Profile',
      profileDesc: 'Data for the currently active login session',
      displayName: 'Display Name',
      displayNameHint: 'Name shown in the dashboard header',
      email: 'Email Address',
      emailHint: 'Used for login — cannot be changed from here',
      uid: 'User ID',
      provider: 'Login Method',
      lastSignIn: 'Last Sign In',
      updateProfile: 'Save Profile Changes',
      updating: 'Saving…',
      preferences: 'Display Preferences',
      preferencesDesc: 'Visual interface settings',
      compactMode: 'Compact Mode',
      compactModeHint: 'Reduce padding in dashboard cards',
      liveIndicators: 'Live Sensor Indicators',
      liveIndicatorsHint: 'Pulse animations on active sensors',
    },
    security: {
      changePassword: 'Change Password',
      changePasswordDesc: 'Update your account password — requires current password',
      currentPassword: 'Current Password',
      currentPasswordHint: 'Required to verify your identity before changing',
      newPassword: 'New Password',
      newPasswordHint: 'At least 8 characters — letters, numbers & symbols recommended',
      confirmPassword: 'Confirm New Password',
      confirmPasswordHint: 'Re-type your new password to confirm',
      changeBtn: 'Change Password',
      changing: 'Processing…',
      pwSuccess: 'Password changed successfully!',
      pwMismatch: 'Password confirmation does not match.',
      pwWeak: 'New password must be at least 8 characters.',
      pwWrongCurrent: 'Current password is incorrect.',
      access: 'Session Control',
      accessDesc: 'Login session security settings',
      sessionTimeout: 'Auto-Logout on Inactivity',
      sessionTimeoutHint: 'Sign out automatically after 30 minutes of inactivity',
      dangerZone: 'Danger Zone',
      dangerZoneDesc: 'Actions that affect all active sessions',
      signOutAllLabel: 'Sign out of all devices',
      signOutAllHint: 'Revokes all active sessions — you will be redirected to login',
      signOutAllBtn: 'Sign Out All',
      signOutConfirm: 'Successfully signed out of all devices.',
    },
  },
};

/* ─────────────────────────────────────────────────────────────────────
   CONTEXT
───────────────────────────────────────────────────────────────────── */
const LangCtx = createContext('id');
const FormCtx = createContext({});
const useLang = () => useContext(LangCtx);
const useForm = () => useContext(FormCtx);

/* ─────────────────────────────────────────────────────────────────────
   REUSABLE PRIMITIVES
───────────────────────────────────────────────────────────────────── */
function Field({ label, hint, children }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-2 sm:gap-6 items-start py-4 border-b border-border last:border-0">
      <div className="pt-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ToggleRow({ label, hint, formKey, badge, disabled }) {
  const { form, setField } = useForm();
  return (
    <div className="flex items-center justify-between py-4 border-b border-border last:border-0">
      <div className="flex-1 pr-8">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-sm font-medium ${disabled ? 'text-muted-foreground' : ''}`}>{label}</p>
          {badge && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{badge}</Badge>}
        </div>
        {hint && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      <Switch
        checked={!!form[formKey]}
        onCheckedChange={(val) => !disabled && setField(formKey, val)}
        disabled={disabled}
      />
    </div>
  );
}

function Section({ title, description, children, accent, warning }) {
  const borderClass = accent ? 'border-l-4 border-l-green-500' : warning ? 'border-l-4 border-l-amber-400' : '';
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className={`overflow-hidden border-border/60 shadow-sm ${borderClass}`}>
        <div className="px-6 pt-5 pb-2">
          <h3 className="text-base font-semibold tracking-tight">{title}</h3>
          {description && <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{description}</p>}
        </div>
        <div className="px-6 pb-5">{children}</div>
      </Card>
    </motion.div>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-border last:border-0 gap-4">
      <p className="text-sm text-muted-foreground shrink-0">{label}</p>
      <p className={`text-sm font-medium text-right break-all ${mono ? 'font-mono text-xs bg-muted px-2 py-0.5 rounded' : ''}`}>{value || '—'}</p>
    </div>
  );
}

// Numeric input with sensor icon
function ThresholdInput({ icon: Icon, iconColor, value, onChange, min, max, disabled }) {
  return (
    <div className={`flex items-center gap-2 ${disabled ? 'opacity-50' : ''}`}>
      {Icon && <Icon size={14} className={`shrink-0 ${iconColor}`} />}
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        disabled={disabled}
        className="w-[100px]"
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   GENERAL TAB
───────────────────────────────────────────────────────────────────── */
function GeneralTab() {
  const lang = useLang();
  const t = T[lang].general;
  const { form, setField } = useForm();
  const [detecting, setDetecting] = useState(false);

  const detectLocation = async () => {
    if (!navigator.geolocation) {
      toast.error(lang === 'id' ? 'Browser tidak mendukung geolokasi.' : 'Browser does not support geolocation.');
      return;
    }
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setField('locationCoords', `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
            { headers: { 'Accept-Language': lang === 'id' ? 'id' : 'en' } }
          );
          const data = await res.json();
          const addr = data.address || {};
          // Build layered detail: village → district → city → state
          const kecamatan = addr.city_district || addr.suburb || addr.village || addr.neighbourhood || '';
          const kota      = addr.city || addr.town || addr.municipality || addr.county || '';
          const provinsi  = addr.state || '';
          const detail    = [kecamatan, kota, provinsi].filter(Boolean).join(', ');
          const short     = [kota, provinsi].filter(Boolean).join(', ');
          setField('locationDetail', detail);
          setField('location', short || detail);
        } catch {
          setField('locationDetail', `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        }
        setDetecting(false);
        toast.success(lang === 'id' ? 'Lokasi berhasil dideteksi!' : 'Location detected!');
      },
      () => {
        setDetecting(false);
        toast.error(lang === 'id' ? 'Gagal mendapatkan lokasi. Izinkan akses lokasi di browser.' : 'Failed to get location. Allow location access in browser.');
      },
      { timeout: 12000 }
    );
  };

  return (
    <div className="space-y-5">
      <Section title={t.farmIdentity} description={t.farmIdentityDesc}>
        <Field label={t.farmName} hint={t.farmNameHint}>
          <Input value={form.farmName} onChange={(e) => setField('farmName', e.target.value)} className="max-w-sm" />
        </Field>
        <Field label={t.farmType} hint={t.farmTypeHint}>
          <Select value={form.farmType} onValueChange={(v) => setField('farmType', v)}>
            <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mushroom">🍄 {lang === 'id' ? 'Jamur' : 'Mushroom'}</SelectItem>
              <SelectItem value="vegetable">🥬 {lang === 'id' ? 'Sayuran' : 'Vegetable'}</SelectItem>
              <SelectItem value="herb">🌿 {lang === 'id' ? 'Herbal' : 'Herb'}</SelectItem>
              <SelectItem value="microgreens">🌱 Microgreens</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t.location} hint={t.locationHint}>
          <div className="space-y-2 max-w-sm">
            <div className="flex gap-2">
              <Input
                value={form.location}
                onChange={(e) => setField('location', e.target.value)}
                placeholder={lang === 'id' ? 'Kota, Provinsi' : 'City, Province'}
                className="flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={detectLocation} disabled={detecting} className="shrink-0 gap-1.5">
                {detecting ? <Loader2 size={13} className="animate-spin" /> : <MapPin size={13} />}
                {detecting ? t.locationDetecting : t.locationBtn}
              </Button>
            </div>
            {form.locationCoords && (
              <p className="text-[11px] text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded">
                📍 {form.locationCoords}
              </p>
            )}
          </div>
        </Field>
        {form.locationDetail && (
          <Field label={t.locationDetail} hint={t.locationDetailHint}>
            <Input
              value={form.locationDetail}
              onChange={(e) => setField('locationDetail', e.target.value)}
              className="max-w-sm"
            />
          </Field>
        )}
      </Section>

      <Section title={t.regional} description={t.regionalDesc}>
        <Field label={t.timezone} hint={t.timezoneHint}>
          <Select value={form.timezone} onValueChange={(v) => setField('timezone', v)}>
            <SelectTrigger className="max-w-[230px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="wib">WIB (GMT+7) — Jakarta</SelectItem>
              <SelectItem value="wita">WITA (GMT+8) — Makassar</SelectItem>
              <SelectItem value="wit">WIT (GMT+9) — Jayapura</SelectItem>
              <SelectItem value="utc">UTC (GMT+0)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t.language}>
          <Select value={form.language} onValueChange={(v) => setField('language', v)}>
            <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="id">🇮🇩 Bahasa Indonesia</SelectItem>
              <SelectItem value="en">🇬🇧 English</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </Section>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   AUTOMATION TAB
───────────────────────────────────────────────────────────────────── */
function AutomationTab() {
  const lang = useLang();
  const t = T[lang].automation;
  const { form, setField } = useForm();

  return (
    <div className="space-y-5">
      <Section title={t.master} description={t.masterDesc}>
        <ToggleRow label={t.masterEnable}    hint={t.masterEnableHint}    formKey="masterAutomation" badge="LIVE" />
        <ToggleRow label={t.emergencyShutoff} hint={t.emergencyShutoffHint} formKey="emergencyShutoff" />
      </Section>

      <Section title={t.climate} description={t.climateDesc}>
        {[
          { label: t.targetHumidity, hint: t.targetHumidityHint, key: 'targetHumidity', min: 0,   max: 100,  icon: Droplets,  color: 'text-blue-500' },
          { label: t.targetTemp,     hint: t.targetTempHint,     key: 'targetTemp',     min: 0,   max: 50,   icon: Thermometer, color: 'text-orange-500' },
          { label: t.fanTrigger,     hint: t.fanTriggerHint,     key: 'fanTriggerTemp', min: 0,   max: 60,   icon: Wind,      color: 'text-cyan-500' },
          { label: t.sprayDuration,  hint: t.sprayDurationHint,  key: 'sprayDuration',  min: 5,   max: 300,  icon: Waves,     color: 'text-sky-500' },
          { label: t.co2,            hint: t.co2Hint,            key: 'co2Threshold',   min: 400, max: 5000, icon: Wind,      color: 'text-purple-500' },
        ].map(({ label, hint, key, min, max, icon: Icon, color }) => (
          <Field key={key} label={label} hint={hint}>
            <div className="flex items-center gap-3">
              <Icon size={14} className={`shrink-0 ${color}`} />
              <Input
                type="number"
                value={form[key]}
                min={min}
                max={max}
                onChange={(e) => setField(key, e.target.value)}
                className="w-[110px]"
              />
              <span className="text-xs text-muted-foreground">{min}–{max}</span>
            </div>
          </Field>
        ))}
      </Section>

      <Section title={t.schedules} description={t.schedulesDesc}>
        <Field label={t.activeHours} hint={t.activeHoursHint}>
          <div className="flex items-center gap-3">
            <Clock size={14} className="text-muted-foreground shrink-0" />
            <Input type="time" value={form.activeFrom} onChange={(e) => setField('activeFrom', e.target.value)} className="w-[130px]" />
            <span className="text-muted-foreground text-sm">{t.to}</span>
            <Input type="time" value={form.activeTo} onChange={(e) => setField('activeTo', e.target.value)} className="w-[130px]" />
          </div>
        </Field>
      </Section>

      {/* Cooldown — synced to index.js COOLDOWN_MINUTES */}
      <Section title={t.cooldown} description={t.cooldownDesc} warning>
        <Field label={t.cooldownMinutes} hint={t.cooldownHint}>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              value={form.cooldownMinutes}
              min={1}
              max={60}
              onChange={(e) => setField('cooldownMinutes', e.target.value)}
              className="w-[100px]"
            />
            <span className="text-xs text-muted-foreground">1–60 min</span>
          </div>
        </Field>
      </Section>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   NOTIFICATIONS TAB
───────────────────────────────────────────────────────────────────── */
function NotificationsTab() {
  const lang = useLang();
  const t = T[lang].notifications;
  const { form, setField } = useForm();
  const [testing, setTesting] = useState(false);

  const sendTestMessage = async () => {
    const token  = form.telegramBotToken?.trim();
    const chatId = form.telegramChatId?.trim();
    if (!token || !chatId) {
      toast.error(lang === 'id' ? 'Isi Bot Token dan Chat ID terlebih dahulu.' : 'Please fill in Bot Token and Chat ID first.');
      return;
    }
    setTesting(true);
    try {
      const farmName = form.farmName || 'Tandurai';
      const location = form.locationDetail || form.location || 'Farm';
      const now = new Date().toLocaleString(lang === 'id' ? 'id-ID' : 'en-US', {
        timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short',
      });
      const msg = lang === 'id'
        ? `🌿 <b>${farmName}</b>\n\n✅ <b>Koneksi Telegram Berhasil!</b>\n\nSistem monitoring farm Anda terhubung dengan baik.\n\n📍 Lokasi: ${location}\n🕐 Waktu: ${now}\n\n<i>Pesan ini dikirim dari halaman Pengaturan untuk memverifikasi koneksi.</i>`
        : `🌿 <b>${farmName}</b>\n\n✅ <b>Telegram Connected!</b>\n\nYour farm monitoring system is connected.\n\n📍 Location: ${location}\n🕐 Time: ${now}\n\n<i>This message was sent from Settings to verify the connection.</i>`;

      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(t.testSuccess);
      } else {
        toast.error(`${t.testFail} (${data.description || 'unknown'})`);
      }
    } catch {
      toast.error(t.testFail);
    } finally {
      setTesting(false);
    }
  };

  // Alert threshold fields — grouped by sensor, matching index.js getAlerts()
  const thresholdGroups = [
    {
      label: lang === 'id' ? '🌡️ Suhu' : '🌡️ Temperature',
      icon: Thermometer, color: 'text-orange-500',
      fields: [
        { key: 'alertTempCriticalHigh', label: t.tempCriticalHigh, hint: t.tempCriticalHighHint, min: 25, max: 60, badge: 'CRITICAL', badgeColor: 'bg-red-100 text-red-600' },
        { key: 'alertTempWarnHigh',     label: t.tempWarnHigh,     hint: t.tempWarnHighHint,     min: 20, max: 50, badge: 'WARNING',  badgeColor: 'bg-amber-100 text-amber-600' },
        { key: 'alertTempWarnLow',      label: t.tempWarnLow,      hint: t.tempWarnLowHint,      min: 10, max: 30, badge: 'WARNING',  badgeColor: 'bg-amber-100 text-amber-600' },
        { key: 'alertTempCriticalLow',  label: t.tempCriticalLow,  hint: t.tempCriticalLowHint,  min: 0,  max: 25, badge: 'CRITICAL', badgeColor: 'bg-red-100 text-red-600' },
      ],
    },
    {
      label: lang === 'id' ? '💧 Kelembaban Udara' : '💧 Air Humidity',
      icon: Droplets, color: 'text-blue-500',
      fields: [
        { key: 'alertHumWarnLow',  label: t.humWarnLow,  hint: t.humWarnLowHint,  min: 30, max: 80,  badge: 'WARNING', badgeColor: 'bg-amber-100 text-amber-600' },
        { key: 'alertHumWarnHigh', label: t.humWarnHigh, hint: t.humWarnHighHint, min: 70, max: 100, badge: 'WARNING', badgeColor: 'bg-amber-100 text-amber-600' },
      ],
    },
    {
      label: lang === 'id' ? '🌬️ CO₂' : '🌬️ CO₂',
      icon: Wind, color: 'text-purple-500',
      fields: [
        { key: 'alertCo2Critical', label: t.co2Critical, hint: t.co2CriticalHint, min: 500, max: 5000, badge: 'CRITICAL', badgeColor: 'bg-red-100 text-red-600' },
        { key: 'alertCo2Warn',     label: t.co2Warn,     hint: t.co2WarnHint,     min: 400, max: 2000, badge: 'WARNING',  badgeColor: 'bg-amber-100 text-amber-600' },
      ],
    },
    {
      label: lang === 'id' ? '🌱 Media Tanam' : '🌱 Substrate Moisture',
      icon: Leaf, color: 'text-green-500',
      fields: [
        { key: 'alertMoistCriticalLow', label: t.moistCriticalLow, hint: t.moistCriticalLowHint, min: 0,  max: 60,  badge: 'CRITICAL', badgeColor: 'bg-red-100 text-red-600' },
        { key: 'alertMoistWarnLow',     label: t.moistWarnLow,     hint: t.moistWarnLowHint,     min: 30, max: 75,  badge: 'WARNING',  badgeColor: 'bg-amber-100 text-amber-600' },
        { key: 'alertMoistWarnHigh',    label: t.moistWarnHigh,    hint: t.moistWarnHighHint,    min: 60, max: 100, badge: 'WARNING',  badgeColor: 'bg-amber-100 text-amber-600' },
      ],
    },
    {
      label: lang === 'id' ? '🚰 Level Air Tangki' : '🚰 Water Tank Level',
      icon: Waves, color: 'text-sky-500',
      fields: [
        { key: 'alertWaterCritical', label: t.waterCritical, hint: t.waterCriticalHint, min: 0,  max: 40, badge: 'CRITICAL', badgeColor: 'bg-red-100 text-red-600' },
        { key: 'alertWaterWarn',     label: t.waterWarn,     hint: t.waterWarnHint,     min: 20, max: 70, badge: 'WARNING',  badgeColor: 'bg-amber-100 text-amber-600' },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      {/* ── Telegram Config ── */}
      <Section title={t.telegram} description={t.telegramDesc} accent>
        <ToggleRow label={t.telegramEnable} hint={t.telegramEnableHint} formKey="telegramEnabled" />

        <Field label={t.botToken} hint={t.botTokenHint}>
          <Input
            value={form.telegramBotToken}
            onChange={(e) => setField('telegramBotToken', e.target.value)}
            placeholder={t.botTokenPlaceholder}
            type="password"
            disabled={!form.telegramEnabled}
            className={`max-w-sm ${!form.telegramEnabled ? 'opacity-50' : ''}`}
          />
        </Field>

        <Field label={t.chatId} hint={t.chatIdHint}>
          <div className="flex gap-2 max-w-sm">
            <Input
              value={form.telegramChatId}
              onChange={(e) => setField('telegramChatId', e.target.value)}
              placeholder={t.chatIdPlaceholder}
              disabled={!form.telegramEnabled}
              className={`flex-1 ${!form.telegramEnabled ? 'opacity-50' : ''}`}
            />
            <Button
              type="button" variant="outline" size="sm"
              onClick={sendTestMessage}
              disabled={!form.telegramEnabled || testing}
              className="shrink-0 gap-1.5"
            >
              {testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {testing ? t.testSending : t.testBtn}
            </Button>
          </div>
        </Field>

        {/* Setup guide */}
        <div className="mt-3 p-3 bg-muted/40 rounded-lg border border-border/40 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground mb-1.5">{t.howTo}</p>
          {[t.howToStep1, t.howToStep2, t.howToStep3, t.howToStep4, t.howToStep5].map((step, i) => (
            <p key={i} className="text-xs text-muted-foreground leading-5">{step}</p>
          ))}
        </div>
      </Section>

      {/* ── Alert Filters ── */}
      <Section title={t.filters} description={t.filtersDesc}>
        <ToggleRow label={t.notifCritical}  hint={t.notifCriticalHint}  formKey="notifCritical"  badge="CRITICAL" disabled={!form.telegramEnabled} />
        <ToggleRow label={t.notifWarning}   hint={t.notifWarningHint}   formKey="notifWarning"   badge="WARNING"  disabled={!form.telegramEnabled} />
        <ToggleRow label={t.notifOffline}   hint={t.notifOfflineHint}   formKey="notifOffline"   disabled={!form.telegramEnabled} />
        <ToggleRow label={t.notifAutomation} hint={t.notifAutomationHint} formKey="notifAutomation" disabled={!form.telegramEnabled} />
        <ToggleRow label={t.notifWeekly}    hint={t.notifWeeklyHint}    formKey="notifWeekly"    disabled={!form.telegramEnabled} />
      </Section>

      {/* ── Threshold Groups ── */}
      <Section title={t.alertThresholds} description={t.alertThresholdsDesc} warning>
        {thresholdGroups.map((group) => (
          <div key={group.label} className="mb-1">
            <div className="flex items-center gap-2 py-3 border-b border-border/50">
              <group.icon size={14} className={group.color} />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.label}</p>
            </div>
            {group.fields.map(({ key, label, hint, min, max, badge, badgeColor }) => (
              <Field key={key} label={
                <span className="flex items-center gap-2">
                  {label}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badgeColor}`}>{badge}</span>
                </span>
              } hint={hint}>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={form[key]}
                    min={min}
                    max={max}
                    onChange={(e) => setField(key, e.target.value)}
                    disabled={!form.telegramEnabled}
                    className={`w-[100px] ${!form.telegramEnabled ? 'opacity-50' : ''}`}
                  />
                  <span className="text-xs text-muted-foreground">{min}–{max}</span>
                </div>
              </Field>
            ))}
          </div>
        ))}
      </Section>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   ACCOUNT TAB
───────────────────────────────────────────────────────────────────── */
function AccountTab() {
  const lang = useLang();
  const t = T[lang].account;
  const { form, setField } = useForm();
  const user = auth.currentUser;

  const [localName, setLocalName] = useState(user?.displayName || '');
  const [updatingProfile, setUpdatingProfile] = useState(false);

  const handleUpdateProfile = async () => {
    if (!localName.trim()) {
      toast.error(lang === 'id' ? 'Nama tidak boleh kosong.' : 'Name cannot be empty.');
      return;
    }
    setUpdatingProfile(true);
    try {
      await updateProfile(user, { displayName: localName.trim() });
      await update(ref(db, `users/${user.uid}/profile`), {
        username: localName.trim(),
        updatedAt: Date.now(),
      });
      toast.success(lang === 'id' ? 'Profil berhasil diperbarui!' : 'Profile updated!');
    } catch (err) {
      toast.error(err.message || (lang === 'id' ? 'Gagal memperbarui profil.' : 'Failed to update profile.'));
    } finally {
      setUpdatingProfile(false);
    }
  };

  const lastSignIn = user?.metadata?.lastSignInTime
    ? new Date(user.metadata.lastSignInTime).toLocaleString(lang === 'id' ? 'id-ID' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

  const provider = user?.providerData?.[0]?.providerId === 'password'
    ? 'Email & Password'
    : (user?.providerData?.[0]?.providerId || '—');

  return (
    <div className="space-y-5">
      <Section title={t.profile} description={t.profileDesc}>
        <InfoRow label="User ID"       value={user?.uid}   mono />
        <InfoRow label={t.email}       value={user?.email} />
        <InfoRow label={t.provider}    value={provider} />
        <InfoRow label={t.lastSignIn}  value={lastSignIn} />

        <Field label={t.displayName} hint={t.displayNameHint}>
          <div className="flex gap-2 max-w-sm">
            <Input
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              placeholder={lang === 'id' ? 'Nama tampilan' : 'Display name'}
              className="flex-1"
            />
            {user?.emailVerified && (
              <Badge className="shrink-0 bg-green-100 text-green-700 border-0 text-xs self-center">
                <Check size={10} className="mr-1" />
                {lang === 'id' ? 'Verified' : 'Verified'}
              </Badge>
            )}
          </div>
        </Field>

        <div className="pt-3">
          <Button type="button" size="sm" onClick={handleUpdateProfile} disabled={updatingProfile} className="gap-2">
            {updatingProfile ? <Loader2 size={13} className="animate-spin" /> : <User size={13} />}
            {updatingProfile ? t.updating : t.updateProfile}
          </Button>
        </div>
      </Section>

      <Section title={t.preferences} description={t.preferencesDesc}>
        <ToggleRow label={t.compactMode}    hint={t.compactModeHint}    formKey="compactMode" />
        <ToggleRow label={t.liveIndicators} hint={t.liveIndicatorsHint} formKey="liveIndicators" />
      </Section>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SECURITY TAB
───────────────────────────────────────────────────────────────────── */
function SecurityTab() {
  const lang = useLang();
  const t = T[lang].security;
  const { form, setField } = useForm();
  const [showPw, setShowPw] = useState({ current: false, new: false, confirm: false });
  const [pw, setPw] = useState({ current: '', new: '', confirm: '' });
  const [changingPw, setChangingPw] = useState(false);
  const [pwError, setPwError] = useState('');

  const toggleShow = (field) => setShowPw(v => ({ ...v, [field]: !v[field] }));

  const handleChangePassword = async () => {
    setPwError('');
    if (pw.new.length < 8)      { setPwError(t.pwWeak);     return; }
    if (pw.new !== pw.confirm)   { setPwError(t.pwMismatch); return; }
    setChangingPw(true);
    try {
      const user = auth.currentUser;
      const credential = EmailAuthProvider.credential(user.email, pw.current);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, pw.new);
      setPw({ current: '', new: '', confirm: '' });
      toast.success(t.pwSuccess);
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setPwError(t.pwWrongCurrent);
      } else {
        setPwError(err.message);
      }
    } finally {
      setChangingPw(false);
    }
  };

  const handleSignOutAll = async () => {
    try {
      await signOut(auth);
      toast.success(t.signOutConfirm);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const PwInput = ({ field, label, hint }) => (
    <Field label={label} hint={hint}>
      <div className="relative max-w-sm">
        <Input
          type={showPw[field] ? 'text' : 'password'}
          placeholder="••••••••"
          value={pw[field]}
          onChange={(e) => setPw(v => ({ ...v, [field]: e.target.value }))}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => toggleShow(field)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          {showPw[field] ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </Field>
  );

  return (
    <div className="space-y-5">
      <Section title={t.changePassword} description={t.changePasswordDesc}>
        <PwInput field="current" label={t.currentPassword} hint={t.currentPasswordHint} />
        <PwInput field="new"     label={t.newPassword}     hint={t.newPasswordHint} />
        <PwInput field="confirm" label={t.confirmPassword} hint={t.confirmPasswordHint} />

        {pwError && (
          <div className="flex items-center gap-2 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            <AlertTriangle size={14} className="shrink-0" />
            {pwError}
          </div>
        )}

        <div className="pt-4">
          <Button
            type="button" size="sm"
            onClick={handleChangePassword}
            disabled={changingPw || !pw.current || !pw.new || !pw.confirm}
            className="gap-2"
          >
            {changingPw ? <Loader2 size={13} className="animate-spin" /> : <Key size={13} />}
            {changingPw ? t.changing : t.changeBtn}
          </Button>
        </div>
      </Section>

      <Section title={t.access} description={t.accessDesc}>
        <ToggleRow label={t.sessionTimeout} hint={t.sessionTimeoutHint} formKey="sessionTimeout" />
      </Section>

      <Section title={t.dangerZone} description={t.dangerZoneDesc}>
        <div className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{t.signOutAllLabel}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t.signOutAllHint}</p>
          </div>
          <Button
            type="button" variant="outline" size="sm"
            onClick={handleSignOutAll}
            className="text-red-500 border-red-200 hover:bg-red-50 hover:border-red-300 shrink-0 gap-1.5"
          >
            <LogOut size={14} />
            {t.signOutAllBtn}
          </Button>
        </div>
      </Section>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   INITIAL FORM STATE
   — Alert thresholds match default values in index.js getAlerts()
   — Cloud Functions reads: tumbara/config/alerts/{uid} OR global fallback
───────────────────────────────────────────────────────────────────── */
const INITIAL_FORM = {
  // General
  farmName: 'Tandurai Main Facility',
  farmType: 'mushroom',
  location: 'Surabaya, East Java',
  locationCoords: '',
  locationDetail: '',
  timezone: 'wib',
  language: 'id',
  // Automation
  masterAutomation: true,
  emergencyShutoff: true,
  targetHumidity: '80',
  targetTemp: '26',
  fanTriggerTemp: '30',
  sprayDuration: '45',
  co2Threshold: '1200',
  activeFrom: '06:00',
  activeTo: '22:00',
  cooldownMinutes: '10',          // synced → index.js COOLDOWN_MINUTES
  // Notifications
  telegramEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  notifCritical: true,
  notifWarning: true,
  notifOffline: true,
  notifAutomation: false,
  notifWeekly: true,
  // Alert thresholds — synced → index.js getAlerts()
  alertTempCriticalHigh: '33',    // temp > 33  → CRITICAL
  alertTempWarnHigh:     '30',    // temp > 30  → WARNING
  alertTempWarnLow:      '24',    // temp < 24  → WARNING
  alertTempCriticalLow:  '20',    // temp < 20  → CRITICAL
  alertHumWarnLow:       '60',    // hum  < 60  → WARNING
  alertHumWarnHigh:      '90',    // hum  > 90  → WARNING
  alertCo2Critical:      '800',   // co2  > 800 → CRITICAL
  alertCo2Warn:          '600',   // co2  > 600 → WARNING
  alertMoistCriticalLow: '45',    // moist < 45 → CRITICAL
  alertMoistWarnLow:     '60',    // moist < 60 → WARNING
  alertMoistWarnHigh:    '85',    // moist > 85 → WARNING
  alertWaterCritical:    '20',    // water < 20 → CRITICAL
  alertWaterWarn:        '40',    // water < 40 → WARNING
  // Account
  compactMode: false,
  liveIndicators: true,
  // Security
  sessionTimeout: true,
};

/* ─────────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const [form, setForm]           = useState(INITIAL_FORM);
  const [saved, setSaved]         = useState(INITIAL_FORM);
  const [activeTab, setActiveTab] = useState('general');
  const [isSaving, setIsSaving]   = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [loading, setLoading]     = useState(true);

  const user = auth.currentUser;
  const lang = form.language;
  const t    = T[lang];

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  // Load settings from Firebase
  useEffect(() => {
    if (!user) return;
    get(ref(db, `users/${user.uid}/settings`)).then((snap) => {
      if (snap.exists()) {
        const merged = { ...INITIAL_FORM, ...snap.val() };
        setForm(merged);
        setSaved(merged);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user]);

  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);
    try {
      // Save full settings
      await set(ref(db, `users/${user.uid}/settings`), form);

      // Also publish alert thresholds to a shared path read by Cloud Functions
      // Path: tumbara/config/alerts  (global, readable by index.js)
      await set(ref(db, 'tumbara/config/alerts'), {
        tempCriticalHigh: Number(form.alertTempCriticalHigh),
        tempWarnHigh:     Number(form.alertTempWarnHigh),
        tempWarnLow:      Number(form.alertTempWarnLow),
        tempCriticalLow:  Number(form.alertTempCriticalLow),
        humWarnLow:       Number(form.alertHumWarnLow),
        humWarnHigh:      Number(form.alertHumWarnHigh),
        co2Critical:      Number(form.alertCo2Critical),
        co2Warn:          Number(form.alertCo2Warn),
        moistCriticalLow: Number(form.alertMoistCriticalLow),
        moistWarnLow:     Number(form.alertMoistWarnLow),
        moistWarnHigh:    Number(form.alertMoistWarnHigh),
        waterCritical:    Number(form.alertWaterCritical),
        waterWarn:        Number(form.alertWaterWarn),
        cooldownMinutes:  Number(form.cooldownMinutes),
        telegramEnabled:  form.telegramEnabled,
        telegramToken:    form.telegramBotToken,
        telegramChatId:   form.telegramChatId,
        notifCritical:    form.notifCritical,
        notifWarning:     form.notifWarning,
        notifOffline:     form.notifOffline,
        notifAutomation:  form.notifAutomation,
        updatedAt:        Date.now(),
      });

      setSaved(form);
      setShowSaved(true);
      toast.success(t.savedToast);
      setTimeout(() => setShowSaved(false), 2500);
    } catch (err) {
      toast.error(lang === 'id' ? 'Gagal menyimpan. Coba lagi.' : 'Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const TABS = [
    { id: 'general',       icon: Globe,   ...t.tabs.general },
    { id: 'automation',    icon: Sliders, ...t.tabs.automation },
    { id: 'notifications', icon: Bell,    ...t.tabs.notifications },
    { id: 'account',       icon: User,    ...t.tabs.account },
    { id: 'security',      icon: Shield,  ...t.tabs.security },
  ];

  const TAB_CONTENT = {
    general:       <GeneralTab />,
    automation:    <AutomationTab />,
    notifications: <NotificationsTab />,
    account:       <AccountTab />,
    security:      <SecurityTab />,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin text-green-600" />
          <p className="text-sm text-muted-foreground">{lang === 'id' ? 'Memuat pengaturan…' : 'Loading settings…'}</p>
        </div>
      </div>
    );
  }

  const activeTabMeta = TABS.find(tb => tb.id === activeTab);

  return (
    <LangCtx.Provider value={lang}>
      <FormCtx.Provider value={{ form, setField }}>
        <Helmet><title>{t.pageTitle}</title></Helmet>

        <form onSubmit={handleSave} className="max-w-5xl mx-auto pb-24 space-y-6">

          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
            className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
          >
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{t.heading}</h1>
              <p className="text-muted-foreground text-sm mt-1">{t.subheading}</p>
            </div>
            <Button type="submit" disabled={isSaving || !isDirty} className="w-full sm:w-auto min-w-[160px]">
              <AnimatePresence mode="wait" initial={false}>
                {showSaved ? (
                  <motion.span key="saved" className="flex items-center gap-2"
                    initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}>
                    <Check size={15} /> {t.saved}
                  </motion.span>
                ) : (
                  <motion.span key="save" className="flex items-center gap-2"
                    initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}>
                    <Save size={15} />
                    {isSaving ? t.saving : t.saveBtn}
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          </motion.div>

          {/* Unsaved banner */}
          <AnimatePresence>
            {isDirty && !isSaving && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  {t.unsaved}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Layout */}
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 items-start">

            {/* Sidebar nav */}
            <motion.nav
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.08 }}
              className="md:sticky md:top-6 space-y-1 rounded-xl border border-border/60 bg-card p-2 shadow-sm"
            >
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all
                      ${isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
                  >
                    <Icon size={16} className="shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-none truncate">{tab.label}</p>
                      <p className={`text-[11px] mt-0.5 truncate ${isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{tab.desc}</p>
                    </div>
                    {isActive && <ChevronRight size={14} className="ml-auto shrink-0 opacity-60" />}
                  </button>
                );
              })}
            </motion.nav>

            {/* Content */}
            <div className="min-w-0">
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, delay: 0.12 }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4"
              >
                <span>{t.settings}</span>
                <ChevronRight size={12} />
                <span className="text-foreground font-medium">{activeTabMeta?.label}</span>
              </motion.div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                >
                  {TAB_CONTENT[activeTab]}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </form>
      </FormCtx.Provider>
    </LangCtx.Provider>
  );
}