import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Send, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api';

/** Ringkasan koneksi Telegram farm (konfigurasi di Pengaturan → Notifikasi). */
export default function TelegramStatus({ farm, purpose = 'alerts' }) {
  const [settings, setSettings] = useState(undefined);

  useEffect(() => {
    if (!farm?.id) return undefined;
    let active = true;
    setSettings(undefined);
    api.alertSettings(farm.id).then(result => active && setSettings(result)).catch(() => active && setSettings(null));
    return () => { active = false; };
  }, [farm?.id]);

  if (settings === undefined) return null;
  const connected = Boolean(settings?.telegramEnabled && settings?.hasTelegramToken && settings?.telegramChatId);
  const settingsLink = (
    <Button asChild variant="outline" size="sm" className="h-9 shrink-0">
      <Link to="/settings?tab=notifications"><Settings size={14} className="mr-1" />{connected ? 'Ubah' : 'Atur sekarang'}</Link>
    </Button>
  );

  if (!connected) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <AlertTriangle className="shrink-0 text-amber-600" size={22} />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Telegram belum terhubung</p>
            <p className="text-muted-foreground">
              {purpose === 'reports' ? 'Laporan terjadwal tidak bisa dikirim sampai Telegram terhubung.' : 'Peringatan tetap tercatat di halaman ini, tetapi tidak dikirim ke HP.'}
              {farm.role === 'owner' ? ' Isi token bot dan chat ID di Pengaturan → Notifikasi.' : ' Minta owner farm menghubungkan Telegram.'}
            </p>
          </div>
          {farm.role === 'owner' && settingsLink}
        </CardContent>
      </Card>
    );
  }

  const { thresholds: t, notify } = settings;
  const kinds = [notify.critical !== false && 'kritis', notify.warning !== false && 'peringatan', notify.offline !== false && 'perangkat offline'].filter(Boolean);
  const chat = String(settings.telegramChatId);
  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
        <Send className="shrink-0 text-emerald-600" size={20} />
        <div className="flex-1 space-y-1 text-sm">
          <p className="font-semibold">Telegram terhubung · chat {chat.length > 6 ? `…${chat.slice(-4)}` : chat}</p>
          <p className="text-muted-foreground">
            Dikirim: {kinds.length ? kinds.join(', ') : 'tidak ada (semua dimatikan)'} · jeda pengiriman ulang {settings.cooldownMinutes} menit
          </p>
          <p className="text-muted-foreground">
            Ambang: suhu &gt; {t.temperature.warning}/{t.temperature.critical} °C · kelembapan &lt; {t.humidity.warning}/{t.humidity.critical} % · CO₂ &gt; {t.co2.warning}/{t.co2.critical} ppm
            <span className="text-xs"> (peringatan/kritis)</span>
          </p>
        </div>
        {farm.role === 'owner' && settingsLink}
      </CardContent>
    </Card>
  );
}
