import React, { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Droplets, Info, Thermometer, Wind, WifiOff,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DataTable from '@/components/DataTable';
import TelegramStatus from '@/components/TelegramStatus';
import { useAlerts } from '@/hooks/useAlerts';
import { useFarmContext } from '@/contexts/FarmContext';
import { useIot } from '@/contexts/IotContext';
import { cn } from '@/lib/utils';

const SENSOR_ICONS = { temperature_high: Thermometer, humidity_low: Droplets, co2_high: Wind, device_offline: WifiOff };
const SEVERITY = {
  critical: { label: 'Kritis', icon: AlertTriangle, className: 'bg-red-500/10 text-red-600 border-red-500/20' },
  warning: { label: 'Peringatan', icon: AlertCircle, className: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20' },
  normal: { label: 'Normal', icon: Info, className: 'bg-green-500/10 text-green-600 border-green-500/20' },
};
const ALL = 'all';

const timeAgo = timestamp => {
  const time = Number(timestamp);
  if (!time) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return 'Baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
};
const fullTime = timestamp => (timestamp ? new Date(timestamp).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default function AlertsPage() {
  const { alerts, loading, error } = useAlerts();
  const { farm, kumbungs } = useFarmContext();
  const { gateways } = useIot();
  const [status, setStatus] = useState(ALL);
  const [severity, setSeverity] = useState(ALL);
  const [kumbungId, setKumbungId] = useState(ALL);

  // Nama yang mudah dibaca: kumbung, sensor, dan gateway (bukan ID).
  const names = useMemo(() => {
    const map = new Map(kumbungs.map(item => [item.id, item.name]));
    for (const gateway of gateways) {
      map.set(gateway.id, gateway.name || gateway.id);
      for (const sensor of gateway.sensors || []) map.set(sensor.id, sensor.name || sensor.id);
    }
    return map;
  }, [kumbungs, gateways]);

  const farmAlerts = useMemo(() => alerts.filter(alert => alert.farmId === farm?.id), [alerts, farm?.id]);
  const rows = farmAlerts.filter(alert => (status === ALL || alert.status === status)
    && (severity === ALL || alert.severity === severity)
    && (kumbungId === ALL || alert.kumbungId === kumbungId));

  const active = farmAlerts.filter(alert => alert.status === 'active');
  const cards = [
    { label: 'Kritis aktif', count: active.filter(a => a.severity === 'critical').length, icon: AlertTriangle, tone: 'text-red-600' },
    { label: 'Peringatan aktif', count: active.filter(a => a.severity === 'warning').length, icon: AlertCircle, tone: 'text-yellow-600' },
    { label: 'Sudah pulih', count: farmAlerts.filter(a => a.status === 'resolved').length, icon: CheckCircle2, tone: 'text-green-600' },
  ];

  const location = alert => [alert.kumbungId && (names.get(alert.kumbungId) || alert.kumbungId), names.get(alert.sensorId) || alert.sensorId].filter(Boolean).join(' · ');

  const columns = [
    {
      key: 'alert', header: 'Peringatan', cell: alert => {
        const config = SEVERITY[alert.severity] || SEVERITY.normal;
        const Icon = SENSOR_ICONS[alert.sensor] || Info;
        const isActive = alert.status === 'active';
        return (
          <div className="flex items-start gap-3">
            <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border', isActive ? config.className : SEVERITY.normal.className)}><Icon size={17} /></span>
            <div className="min-w-0">
              <p className="font-semibold leading-snug">{alert.type}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {isActive && <Badge variant="outline" className={cn('text-[11px]', config.className)}>{config.label}</Badge>}
                <Badge variant="outline" className={cn('text-[11px]', isActive ? 'border-red-500/30 text-red-600' : 'border-green-500/30 text-green-600')}>{isActive ? 'Aktif' : 'Pulih'}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{location(alert)}</p>
            </div>
          </div>
        );
      },
    },
    { key: 'message', header: 'Keterangan', hideOnMobile: true, className: 'text-sm max-w-xs', cell: alert => alert.message },
    {
      key: 'value', header: 'Nilai / ambang', hideOnMobile: true, className: 'text-sm whitespace-nowrap',
      cell: alert => (alert.value == null ? '—' : `${alert.value} ${alert.unit}${alert.threshold != null ? ` / ${alert.threshold}` : ''}`),
    },
    {
      key: 'time', header: 'Waktu', className: 'text-sm whitespace-nowrap',
      cell: alert => <span title={fullTime(alert.updatedAt)}>{timeAgo(alert.updatedAt)}</span>,
    },
    { key: 'started', header: 'Mulai', hideOnMobile: true, className: 'text-xs text-muted-foreground whitespace-nowrap', cell: alert => fullTime(alert.startedAt) },
    {
      key: 'telegram', header: 'Telegram', hideOnMobile: true, className: 'text-xs whitespace-nowrap',
      cell: alert => (alert.telegramSentAt ? <span className="text-emerald-600">Terkirim {timeAgo(alert.telegramSentAt)}</span> : <span className="text-muted-foreground">Tidak dikirim</span>),
    },
  ];

  const filterSelect = (value, onChange, label, options) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10 w-full sm:w-44" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([optionValue, text]) => <SelectItem key={optionValue} value={optionValue}>{text}</SelectItem>)}</SelectContent>
    </Select>
  );

  return (
    <>
      <Helmet>
        <title>Peringatan - Dashboard Tandurai</title>
        <meta name="description" content="Peringatan dini kondisi kumbung secara real-time" />
      </Helmet>

      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Peringatan Dini</h1>
          <p className="text-sm text-muted-foreground">Suhu, kelembapan, CO₂, dan koneksi perangkat {farm ? `di ${farm.name}` : ''} — diperbarui otomatis.</p>
        </div>

        {farm && <TelegramStatus farm={farm} />}

        <div className="grid grid-cols-3 gap-3">
          {cards.map(({ label, count, icon: Icon, tone }) => (
            <Card key={label}>
              <CardContent className="flex items-center justify-between gap-2 p-4">
                <div>
                  <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
                  <p className={cn('text-2xl font-bold sm:text-3xl', tone)}>{count}</p>
                </div>
                <Icon className={cn('hidden sm:block', tone)} size={28} />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Daftar peringatan <span className="font-normal text-muted-foreground">({rows.length})</span></CardTitle>
            <div className="grid grid-cols-1 gap-2 sm:flex">
              {filterSelect(status, setStatus, 'Filter status', [[ALL, 'Semua status'], ['active', 'Aktif'], ['resolved', 'Pulih']])}
              {filterSelect(severity, setSeverity, 'Filter tingkat', [[ALL, 'Semua tingkat'], ['critical', 'Kritis'], ['warning', 'Peringatan'], ['normal', 'Normal']])}
              {filterSelect(kumbungId, setKumbungId, 'Filter kumbung', [[ALL, 'Semua kumbung'], ...kumbungs.map(item => [item.id, item.name || item.id])])}
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={alert => alert.id}
              loading={loading}
              pageSize={15}
              rowClassName={alert => (alert.status === 'active' && alert.severity === 'critical' ? 'bg-red-500/5' : undefined)}
              emptyText={error ? `Gagal memuat peringatan: ${error}` : farmAlerts.length ? 'Tidak ada peringatan pada filter ini.' : 'Belum ada peringatan. Kondisi kumbung aman.'}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
