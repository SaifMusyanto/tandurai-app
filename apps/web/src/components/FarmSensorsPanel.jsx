import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Ban, Loader2, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { assignSensor, deactivateSensor, subscribeFarmSensors } from '@/lib/deviceManagementService';
import { sensorHealth } from '@/lib/deviceManagementPlan';
import { subscribeKumbungTelemetry } from '@/lib/telemetryService';
import { db } from '../firebase';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,96}$/;

const STATUS_CONFIG = {
  active: { label: 'Aktif', className: 'bg-green-500/10 text-green-600 border-green-500/20' },
  pending: { label: 'Menunggu gateway', className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  maintenance: { label: 'Perawatan', className: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  inactive: { label: 'Nonaktif', className: 'bg-muted text-muted-foreground border-border' },
};

const HEALTH_CONFIG = {
  ok: { label: 'Terbaca', className: 'text-green-600' },
  stale: { label: 'Tidak terbaca sejak', className: 'text-yellow-600' },
  not_found: { label: 'Tidak ditemukan', className: 'text-red-600' },
  read_error: { label: 'Gagal dibaca', className: 'text-red-600' },
  unknown: { label: 'Menunggu laporan gateway', className: 'text-muted-foreground' },
  inactive: { label: '—', className: 'text-muted-foreground' },
};

const timeAgo = (timestamp, now) => {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds} detik lalu`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} menit lalu` : `${Math.floor(minutes / 60)} jam lalu`;
};

function SensorHealth({ health, now }) {
  const config = HEALTH_CONFIG[health.state] || HEALTH_CONFIG.unknown;
  return (
    <div className={`text-xs ${config.className}`} title={health.error || undefined}>
      <span className="font-medium">{config.label}</span>
      {health.lastReadAt && health.state !== 'inactive' && <span> {timeAgo(health.lastReadAt, now)}</span>}
      {health.error && <p className="text-muted-foreground">{health.error}</p>}
    </div>
  );
}

const emptyForm = { sensorId: '', name: '', kumbungId: '', gatewayId: '', hardwareAddress: '' };

/* ─── Dialog: tambah / tugaskan ulang sensor ─────────────────────────── */
function SensorDialog({ open, farm, sensor, kumbungs, gateways, onClose }) {
  const editing = Boolean(sensor);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const assignableGateways = gateways.filter(gateway => gateway.status !== 'inactive');

  useEffect(() => {
    if (!open) return;
    setForm(sensor
      ? {
        sensorId: sensor.id,
        name: sensor.name || '',
        kumbungId: sensor.kumbungId || '',
        gatewayId: assignableGateways.some(gateway => gateway.id === sensor.gatewayId) ? sensor.gatewayId : '',
        hardwareAddress: sensor.hardwareAddress || '',
      }
      : { ...emptyForm, kumbungId: kumbungs[0]?.id || '', gatewayId: assignableGateways[0]?.id || '' });
    // Form hanya diisi ulang saat dialog dibuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sensor]);

  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  const idValid = ID_PATTERN.test(form.sensorId);
  const ready = idValid && form.name.trim() && form.kumbungId && form.gatewayId;

  const submit = async (event) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const result = await assignSensor({ farmId: farm.id, ...form });
      toast.success(`${result.sensorId} ditugaskan ke ${result.gatewayId} (config v${result.configVersion}). Status aktif setelah gateway menerapkan config.`);
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Ubah penugasan ${sensor.id}` : 'Tambah sensor'}</DialogTitle>
          <DialogDescription>
            Sensor dibaca oleh gateway terpilih dan datanya masuk ke kumbung terpilih. Perubahan menaikkan versi config gateway;
            status kembali “menunggu gateway” sampai gateway menerapkannya. Riwayat lama tetap di kumbung asal.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sensor-id">ID sensor</Label>
              <Input id="sensor-id" value={form.sensorId} onChange={event => setForm(current => ({ ...current, sensorId: event.target.value.trim() }))} placeholder="SNS-0101" disabled={editing} autoFocus={!editing} />
              {form.sensorId && !idValid && <p className="text-xs text-red-600">Format ID tidak valid.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sensor-name">Nama / lokasi</Label>
              <Input id="sensor-name" value={form.name} onChange={set('name')} placeholder="Sensor sisi utara" maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label>Kumbung</Label>
              <Select value={form.kumbungId} onValueChange={value => setForm(current => ({ ...current, kumbungId: value }))}>
                <SelectTrigger aria-label="Kumbung"><SelectValue placeholder="Pilih kumbung" /></SelectTrigger>
                <SelectContent>
                  {kumbungs.map(kumbung => <SelectItem key={kumbung.id} value={kumbung.id}>{kumbung.name || kumbung.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Gateway</Label>
              <Select value={form.gatewayId} onValueChange={value => setForm(current => ({ ...current, gatewayId: value }))}>
                <SelectTrigger aria-label="Gateway"><SelectValue placeholder="Pilih gateway" /></SelectTrigger>
                <SelectContent>
                  {assignableGateways.map(gateway => <SelectItem key={gateway.id} value={gateway.id}>{gateway.name || gateway.id} ({gateway.id})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sensor-address">Alamat hardware (opsional)</Label>
            <Input id="sensor-address" value={form.hardwareAddress} onChange={set('hardwareAddress')} placeholder="mis. alamat bus sensor pada gateway" maxLength={128} />
          </div>
          {!assignableGateways.length && <p className="text-sm text-red-600">Belum ada gateway aktif di farm ini.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
            <Button type="submit" disabled={busy || !ready}>
              {busy ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Plus size={15} className="mr-1.5" />}
              {editing ? 'Simpan penugasan' : 'Tambah sensor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Konfirmasi nonaktifkan ─────────────────────────────────────────── */
function DeactivateDialog({ sensor, onClose }) {
  const [busy, setBusy] = useState(false);

  const run = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await deactivateSensor({ sensorId: sensor.id });
      toast.success(`${sensor.id} dinonaktifkan.`);
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={Boolean(sensor)} onOpenChange={value => !value && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Nonaktifkan {sensor?.id}?</AlertDialogTitle>
          <AlertDialogDescription>
            Gateway berhenti membaca sensor ini dan telemetry barunya ditolak. Katalog dan riwayat tetap tersimpan;
            sensor dapat ditugaskan ulang kapan saja.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
          <AlertDialogAction onClick={run} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white">
            {busy && <Loader2 size={15} className="mr-1.5 animate-spin" />}
            Nonaktifkan
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ─── Tabel sensor satu kumbung + pembacaan terakhir ─────────────────── */
function LatestReading({ telemetry, now }) {
  if (!telemetry) return <span className="text-xs text-muted-foreground">Belum ada data</span>;
  return (
    <div className="text-xs">
      <p className="font-medium whitespace-nowrap">
        {telemetry.temperature ?? '—'}°C · {telemetry.humidity ?? '—'}% · {telemetry.co2 ?? '—'} ppm
      </p>
      <p className={telemetry.quality?.stale ? 'text-orange-600' : 'text-muted-foreground'}>
        {timeAgo(telemetry.timestamp, now)}{telemetry.quality?.stale ? ' (usang)' : ''}
        {telemetry.quality?.status && telemetry.quality.status !== 'valid' && !telemetry.quality.stale ? ` · ${telemetry.quality.status}` : ''}
      </p>
    </div>
  );
}

function KumbungSensorTable({ kumbung, sensors, gatewaysById, isOwner, now, onEdit, onDeactivate }) {
  const [latest, setLatest] = useState({});
  const sensorKey = sensors.map(sensor => sensor.id).join(',');

  useEffect(() => {
    if (!sensorKey) return undefined;
    return subscribeKumbungTelemetry(db, kumbung.id, sensorKey.split(','), setLatest, error => console.error('Gagal memuat telemetry sensor:', error));
  }, [kumbung.id, sensorKey]);

  return (
    <div>
      <p className="text-sm font-semibold mb-2">
        {kumbung.name || kumbung.id} <span className="text-xs font-normal text-muted-foreground font-mono">{kumbung.id}</span>
      </p>
      {!sensors.length ? (
        <p className="text-sm text-muted-foreground">Belum ada sensor.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-2 pr-3 font-medium">Sensor</th>
                <th className="py-2 pr-3 font-medium">Gateway</th>
                <th className="py-2 pr-3 font-medium">Alamat</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Pembacaan</th>
                <th className="py-2 pr-3 font-medium">Data terakhir</th>
                {isOwner && <th className="py-2 font-medium text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {sensors.map(sensor => {
                const status = STATUS_CONFIG[sensor.status] || STATUS_CONFIG.pending;
                return (
                  <tr key={sensor.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{sensor.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{sensor.id}</p>
                    </td>
                    <td className="py-2 pr-3">{gatewaysById[sensor.gatewayId]?.name || sensor.gatewayId}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{sensor.hardwareAddress || '—'}</td>
                    <td className="py-2 pr-3"><Badge variant="outline" className={status.className}>{status.label}</Badge></td>
                    <td className="py-2 pr-3"><SensorHealth health={sensorHealth(sensor, gatewaysById[sensor.gatewayId]?.ack, now)} now={now} /></td>
                    <td className="py-2 pr-3"><LatestReading telemetry={latest[sensor.id]} now={now} /></td>
                    {isOwner && (
                      <td className="py-2 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => onEdit(sensor)} aria-label={`Ubah ${sensor.id}`}>
                          <Pencil size={14} />
                        </Button>
                        {sensor.status !== 'inactive' && (
                          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => onDeactivate(sensor)} aria-label={`Nonaktifkan ${sensor.id}`}>
                            <Ban size={14} />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Panel sensor per kumbung ───────────────────────────────────────── */
export default function FarmSensorsPanel({ farm, isOwner, gateways }) {
  const [data, setData] = useState({ kumbungs: [], sensors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { sensor: object|null }
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    return subscribeFarmSensors(farm.id, next => {
      setData(next);
      setLoading(false);
    }, err => {
      setError(err.message);
      setLoading(false);
    });
  }, [farm.id]);

  const gatewaysById = useMemo(
    () => Object.fromEntries(gateways.map(gateway => [gateway.id, gateway])),
    [gateways],
  );
  const sensorsByKumbung = useMemo(() => data.kumbungs.map(kumbung => ({
    kumbung,
    sensors: data.sensors.filter(sensor => sensor.kumbungId === kumbung.id),
  })), [data]);

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Activity size={18} /> Sensor per kumbung</CardTitle>
        {isOwner && (
          <Button size="sm" onClick={() => setDialog({ sensor: null })} disabled={!data.kumbungs.length}>
            <Plus size={14} className="mr-1" /> Tambah sensor
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="animate-spin" size={18} /> Memuat sensor…
          </div>
        ) : error ? (
          <p className="py-6 text-center text-red-600">Gagal memuat sensor: {error}</p>
        ) : !data.kumbungs.length ? (
          <p className="py-6 text-center text-muted-foreground">Farm ini belum memiliki kumbung. Tambahkan kumbung di halaman Operasional.</p>
        ) : (
          <div className="space-y-5">
            {sensorsByKumbung.map(({ kumbung, sensors }) => (
              <KumbungSensorTable
                key={kumbung.id}
                kumbung={kumbung}
                sensors={sensors}
                gatewaysById={gatewaysById}
                isOwner={isOwner}
                now={now}
                onEdit={sensor => setDialog({ sensor })}
                onDeactivate={setDeactivateTarget}
              />
            ))}
          </div>
        )}
      </CardContent>

      <SensorDialog
        open={Boolean(dialog)}
        farm={farm}
        sensor={dialog?.sensor || null}
        kumbungs={data.kumbungs}
        gateways={gateways}
        onClose={() => setDialog(null)}
      />
      <DeactivateDialog sensor={deactivateTarget} onClose={() => setDeactivateTarget(null)} />
    </Card>
  );
}
