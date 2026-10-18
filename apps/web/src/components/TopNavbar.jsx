import React, { useState, useEffect } from 'react';
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
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useFarmContext } from '@/contexts/FarmContext';
import { useKumbungTelemetry } from '@/hooks/useKumbungTelemetry';
import { useAlerts } from '@/hooks/useAlerts';
import { ActiveActuatorsBadge } from '@/components/iot/ActiveActuators';
import { FarmSwitcher } from '@/components/ContextBar';

export default function TopNavbar() {
  const { theme, toggleTheme } = useTheme();
  const [currentTime, setCurrentTime]   = useState(new Date());

  // Auth & profil user (backend)
  const [user, setUser] = useState(auth.currentUser);
  const { profile, adminConsole } = useFarmContext();
  const username = profile?.username || user?.email?.split('@')[0] || '';

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  // ── 1. Jam Digital
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── 2. Kondisi kumbung terpilih (gabungan semua sensor, SSE backend).
  const telemetry = useKumbungTelemetry();
  const isEspOnline = telemetry.online;
  const liveData = { temperature: telemetry.values.temperature ?? '--', humidity: telemetry.values.humidity ?? '--' };
  const lastSyncText = telemetry.timestamp
    ? `${isEspOnline ? 'Synced' : 'Terakhir'} ${new Date(telemetry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    : telemetry.sensorCount ? 'Belum ada data' : 'Belum ada sensor';

  // ── 3. Alert aktif seluruh farm (dievaluasi backend, realtime lewat SSE)
  const { alerts } = useAlerts();
  const activeAlerts = alerts.filter(alert => alert.status === 'active');
  const notificationCount = activeAlerts.length;
  const notifications = activeAlerts.slice(0, 3);

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

        {/* ── Bagian Kiri — Pencarian (layar lebar; di HP ruang dipakai pemilih farm, kiri untuk tombol menu) ── */}
        <div className="w-10 shrink-0 lg:hidden" aria-hidden />
        <div className="hidden flex-1 max-w-md md:block">
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
        <div className="flex min-w-0 items-center gap-1 sm:gap-2 lg:gap-4">

          {/* Konsol admin: tanpa widget kumbung & pemilih farm */}
          {adminConsole && (
            <span className="hidden sm:inline-flex items-center rounded-full bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">Admin Tandurai</span>
          )}

          {/* Aktuator yang sedang menyala (jadwal/otomatis/manual) */}
          {!adminConsole && <ActiveActuatorsBadge />}

          {/* Widget Suhu & Kelembaban */}
          <div className={adminConsole ? 'hidden' : 'hidden md:flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50'}>
            <CloudRain className="text-primary" size={20} />
            <div className="text-sm">
              <div className="font-medium">{liveData.temperature}°C</div>
              <div className="text-xs text-muted-foreground">Hum: {liveData.humidity}%</div>
            </div>
          </div>

          {/* Last Sync */}
          <div className={adminConsole ? 'hidden' : 'hidden xl:flex items-center gap-2 text-sm text-muted-foreground'}>
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

          {/* Pilih farm (berlaku untuk semua halaman) */}
          {!adminConsole && <FarmSwitcher />}

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
                <DropdownMenuItem key={`${alert.farmId}/${alert.id}`}>
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
