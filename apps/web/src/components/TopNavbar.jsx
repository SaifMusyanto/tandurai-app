import React, { useState, useEffect, useRef } from 'react';
import { Search, Sun, Moon, Bell, User, CloudRain, Wifi, WifiOff, LogOut } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { ref, onValue, get, set } from 'firebase/database';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from '../firebase';
import { subscribeLatestTelemetry } from '@/lib/telemetryService';
import { TELEMETRY_STALE_AFTER_MS } from '@/lib/telemetry';

const OFFLINE_AFTER_MS = TELEMETRY_STALE_AFTER_MS;

const ALERT_META = {
  temperature_high: { type: 'Suhu Tinggi', device: 'Sensor Suhu Kumbung', unit: '°C' },
  humidity_low: { type: 'Kelembapan Rendah', device: 'Sensor Kelembapan Kumbung', unit: '%' },
  co2_high: { type: 'CO₂ Tinggi', device: 'Sensor CO₂ Kumbung', unit: 'ppm' },
  device_offline: { type: 'Perangkat Offline', device: 'ESP32 Sensor Kumbung', unit: 'detik' },
};

const evaluateSensor = (data) => {
  const results = [];
  const toNumber = value => value === null || value === undefined || value === '' ? Number.NaN : Number(value);
  const temperature = toNumber(data.temperature);
  const humidity = toNumber(data.humidity);
  const co2 = toNumber(data.co2);

  if (Number.isFinite(temperature)) {
    const severity = temperature > 33 ? 'critical' : temperature > 30 ? 'warning' : 'normal';
    results.push({
      key: 'temperature_high', severity, value: temperature,
      threshold: severity === 'critical' ? 33 : 30,
      message: severity === 'normal' ? `Suhu kembali aman pada ${temperature}°C.` : `Suhu ${temperature}°C melewati batas ${severity === 'critical' ? 'kritis' : 'peringatan'}.`,
    });
  }
  if (Number.isFinite(humidity)) {
    const severity = humidity < 60 ? 'critical' : humidity < 70 ? 'warning' : 'normal';
    results.push({
      key: 'humidity_low', severity, value: humidity,
      threshold: severity === 'critical' ? 60 : 70,
      message: severity === 'normal' ? `Kelembapan kembali aman pada ${humidity}%.` : `Kelembapan ${humidity}% berada di bawah batas ${severity === 'critical' ? 'kritis' : 'peringatan'}.`,
    });
  }
  if (Number.isFinite(co2)) {
    const severity = co2 > 1200 ? 'critical' : co2 > 800 ? 'warning' : 'normal';
    results.push({
      key: 'co2_high', severity, value: co2,
      threshold: severity === 'critical' ? 1200 : 800,
      message: severity === 'normal' ? `Kadar CO₂ kembali aman pada ${co2} ppm.` : `Kadar CO₂ ${co2} ppm melewati batas ${severity === 'critical' ? 'kritis' : 'peringatan'}.`,
    });
  }
  return results;
};

const syncAlert = async (alert, now) => {
  const alertRef = ref(db, `tumbara/alerts/${alert.key}`);
  const previousSnapshot = await get(alertRef);
  const previous = previousSnapshot.val() || {};
  const active = alert.severity !== 'normal';
  const severityChanged = previous.severity !== alert.severity;
  const meta = ALERT_META[alert.key];

  await set(alertRef, {
    id: alert.key,
    sensor: alert.key,
    type: meta.type,
    device: meta.device,
    unit: meta.unit,
    severity: alert.severity,
    status: active ? 'active' : 'resolved',
    message: alert.message,
    value: alert.value,
    threshold: alert.threshold,
    startedAt: active && (previous.status !== 'active' || severityChanged) ? now : (previous.startedAt || null),
    updatedAt: now,
    resolvedAt: !active && previous.status === 'active' ? now : (previous.resolvedAt || null),
    source: 'client-fallback',
  });
};

export default function TopNavbar() {
  const { theme, toggleTheme } = useTheme();
  const [currentTime, setCurrentTime]   = useState(new Date());
  const [notificationCount, setNotificationCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [liveData, setLiveData]         = useState({ temperature: '--', humidity: '--' });
  const [isEspOnline, setIsEspOnline]   = useState(false);
  const [lastSyncText, setLastSyncText] = useState('Never synced');

  // Auth & user profile
  const [user, setUser]         = useState(null);
  const [username, setUsername] = useState('');
  const lastSensorUpdateRef = useRef(Date.now());
  const offlineRecordedRef = useRef(false);

  // ── 0. Auth listener + fetch username dari Firebase
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const profileRef = ref(db, `users/${currentUser.uid}/profile`);
          const snapshot = await get(profileRef);
          if (snapshot.exists()) {
            setUsername(snapshot.val().username || 'Manager');
          } else {
            // Fallback ke bagian depan email jika profil belum tersimpan
            const emailName = currentUser.email?.split('@')[0] || 'Manager';
            setUsername(emailName);
          }
        } catch (err) {
          console.error('Gagal ambil username navbar:', err);
          setUsername('Manager');
        }
      } else {
        setUsername('');
      }
    });
    return () => unsubscribeAuth();
  }, []);

  // ── 1. Jam Digital
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── 2. Live telemetry; histori hanya ditulis oleh pengirim ESP32
  useEffect(() => subscribeLatestTelemetry(db, data => {
    if (!data) {
      setIsEspOnline(false);
      return;
    }
    const now = data.timestamp || Date.now();
    lastSensorUpdateRef.current = now;
    offlineRecordedRef.current = false;
    setIsEspOnline(!data.quality.stale && data.quality.status !== 'invalid');
    setLiveData({ temperature: data.temperature ?? '--', humidity: data.humidity ?? '--' });
    setLastSyncText(`Synced ${new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);

    const resolvedDeviceAlert = { key: 'device_offline', severity: 'normal', value: 0, threshold: 30, message: 'Perangkat kembali online dan mengirim data sensor.' };
    Promise.all([
      ...evaluateSensor(data).map(alert => syncAlert(alert, now)),
      syncAlert(resolvedDeviceAlert, now),
    ]).catch(error => console.error('Gagal memperbarui alert:', error));
  }), []);

  // ── 3. Alert aktif dari Cloud Function
  useEffect(() => {
    const alertsRef = ref(db, 'tumbara/alerts');
    return onValue(alertsRef, (snapshot) => {
      const alertList = Object.values(snapshot.val() || {})
        .filter(alert => alert.status === 'active')
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      setNotificationCount(alertList.length);
      setNotifications(alertList.slice(0, 3));
    });
  }, []);

  // ── 4. Offline jika sensor tidak berubah selama lebih dari 30 detik
  useEffect(() => {
    const checkInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastSensorUpdateRef.current;
      if (elapsed <= OFFLINE_AFTER_MS || offlineRecordedRef.current) return;

      offlineRecordedRef.current = true;
      setIsEspOnline(false);
      setLastSyncText(`Offline ${Math.floor(elapsed / 1000)}s`);
      syncAlert({
        key: 'device_offline',
        severity: 'critical',
        value: Math.floor(elapsed / 1000),
        threshold: 30,
        message: `ESP32 tidak mengirim pembaruan selama ${Math.floor(elapsed / 1000)} detik.`,
      }, now).catch(error => console.error('Gagal menyimpan alert offline:', error));
    }, 5000);

    return () => clearInterval(checkInterval);
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      // App.jsx akan otomatis redirect ke AuthPage setelah logout
    } catch (err) {
      console.error("Gagal Logout:", err);
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-card border-b border-border backdrop-blur-sm bg-card/95">
      <div className="flex items-center justify-between px-4 lg:px-6 h-16 gap-4">

        {/* ── Bagian Kiri — Pencarian ── */}
        <div className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <Input
              type="search"
              placeholder="Search devices, sensors..."
              className="pl-10 bg-muted/50 border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* ── Bagian Kanan ── */}
        <div className="flex items-center gap-2 lg:gap-4">

          {/* Widget Suhu & Kelembaban */}
          <div className="hidden md:flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50">
            <CloudRain className="text-primary" size={20} />
            <div className="text-sm">
              <div className="font-medium">{liveData.temperature}°C</div>
              <div className="text-xs text-muted-foreground">Hum: {liveData.humidity}%</div>
            </div>
          </div>

          {/* Last Sync */}
          <div className="hidden xl:flex items-center gap-2 text-sm text-muted-foreground">
            {isEspOnline
              ? <Wifi className="text-green-500" size={16} />
              : <WifiOff className="text-muted-foreground" size={16} />
            }
            <span>{lastSyncText}</span>
          </div>

          {/* Toggle Tema */}
          <Button variant="ghost" size="icon" onClick={toggleTheme} className="transition-all duration-200 hover:scale-105">
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </Button>

          {/* Notifikasi */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative transition-all duration-200 hover:scale-105">
                <Bell size={20} />
                {notificationCount > 0 && (
                  <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs bg-destructive text-destructive-foreground">
                    {notificationCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifications.length > 0 ? notifications.map((alert) => (
                <DropdownMenuItem key={alert.id || alert.sensor}>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{alert.type}</p>
                      <Badge variant="outline" className={alert.severity === 'critical' ? 'text-red-600 border-red-500/20' : 'text-yellow-600 border-yellow-500/20'}>
                        {alert.severity}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{alert.message}</p>
                  </div>
                </DropdownMenuItem>
              )) : (
                <DropdownMenuItem disabled>Tidak ada peringatan aktif</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* ── Profil Dropdown — selalu tampil karena user pasti sudah login ── */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="transition-all duration-200 hover:scale-105 text-primary"
              >
                {/* Avatar inisial nama */}
                <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white text-xs font-bold">
                  {username ? username.charAt(0).toUpperCase() : <User size={16} />}
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-foreground truncate">
                    {username || 'Farm Manager'}
                  </span>
                  <span className="text-xs text-muted-foreground truncate font-normal">
                    {user?.email}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sign Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

        </div>
      </div>
    </header>
  );
}
