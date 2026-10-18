import React, { useEffect, useState } from 'react';
import { Loader2, Search, Link2, Radio, ToggleRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIot } from '@/contexts/IotContext';
import { METRIC_LABEL } from '@/lib/iot';

const UID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;
const FOLLOW = '__follow__';   // ikut kumbung utama gateway
const NONE = '__none__';       // belum ditempatkan
const ACTUATOR_LABEL = { sprayer: 'Sprayer', fan: 'Kipas', humidifier: 'Humidifier', pump: 'Pompa', light: 'Lampu', heater: 'Pemanas', other: 'Aktuator' };
const defaultName = (kind, item) => (kind === 'sensors' ? `Sensor ${item.id}` : `${ACTUATOR_LABEL[item.type] || 'Aktuator'} ${item.id}`);

/** Satu baris pelabelan sensor/aktuator: kode perangkat, nama, kumbung. */
function LabelRow({ code, detail, label, kumbungs, onChange }) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr] sm:grid-cols-[3.5rem_1fr_11rem] items-center gap-2">
      <span className="font-mono text-xs rounded bg-muted px-1.5 py-1 text-center" title={detail}>{code}</span>
      <Input value={label.name} onChange={event => onChange({ ...label, name: event.target.value })} maxLength={100} className="h-8 text-sm" aria-label={`Nama ${code}`} />
      <Select value={label.kumbung} onValueChange={kumbung => onChange({ ...label, kumbung })}>
        <SelectTrigger className="h-8 text-xs col-span-2 sm:col-span-1" aria-label={`Kumbung ${code}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={FOLLOW}>Ikut kumbung utama</SelectItem>
          <SelectItem value={NONE}>Belum ditempatkan</SelectItem>
          {kumbungs.map(kumbung => <SelectItem key={kumbung.id} value={kumbung.id}>{kumbung.name || kumbung.id}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Tambah gateway: UID + kode klaim → pratinjau perangkat → beri nama gateway, sensor, aktuator dan
 * pilih kumbung (utama atau per item) → klaim. Label ini yang tampil di Monitoring & Kontrol.
 */
export default function AddGatewayDialog({ open, farm, kumbungs, onClose }) {
  const { preview, claim } = useIot();
  const [hwUid, setHwUid] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [device, setDevice] = useState(null);
  const [name, setName] = useState('');
  const [kumbungId, setKumbungId] = useState('');
  const [labels, setLabels] = useState({ sensors: {}, actuators: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setHwUid(''); setClaimCode(''); setDevice(null); setName(''); setError('');
    setKumbungId(kumbungs[0]?.id || '');
    // Isi ulang hanya saat dialog dibuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const check = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await preview(hwUid.trim(), claimCode.trim());
      setDevice(result);
      const kumbung = kumbungs.find(item => item.id === kumbungId);
      setName(kumbung ? `Gateway ${kumbung.name || kumbung.id}` : result.id);
      const initial = kind => Object.fromEntries((result.capabilities[kind] || []).map(item => [item.id, { name: defaultName(kind, item), kumbung: FOLLOW }]));
      setLabels({ sensors: initial('sensors'), actuators: initial('actuators') });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Nama & kumbung per item; "ikut kumbung utama" tidak dikirim (backend memakai kumbung utama).
      const toPayload = kind => Object.fromEntries(Object.entries(labels[kind]).map(([localId, label]) => [localId, {
        ...(label.name.trim() ? { name: label.name.trim() } : {}),
        ...(label.kumbung === FOLLOW ? {} : { kumbungId: label.kumbung === NONE ? null : label.kumbung }),
      }]));
      const gateway = await claim({
        hwUid: device.id, claimCode: claimCode.trim(), farmId: farm?.id || null, kumbungId: kumbungId || null, name: name.trim(),
        sensors: toPayload('sensors'), actuators: toPayload('actuators'),
      });
      toast.success(`${gateway.name} ditambahkan: ${gateway.sensors.length} sensor, ${gateway.actuators.length} aktuator.`);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={value => !value && !busy && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tambah gateway</DialogTitle>
          <DialogDescription>
            Masukkan UID dan kode klaim dari label perangkat. Gateway harus sudah menyala dan tersambung internet minimal sekali.
          </DialogDescription>
        </DialogHeader>

        {!device ? (
          <form onSubmit={check} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="iot-uid">UID gateway</Label>
              <Input id="iot-uid" value={hwUid} onChange={event => setHwUid(event.target.value.trim())} placeholder="TDR-A1B2C3D4E5F6" className="font-mono" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iot-code">Kode klaim</Label>
              <Input id="iot-code" value={claimCode} onChange={event => setClaimCode(event.target.value)} placeholder="K7Q2-M9XD" className="font-mono uppercase" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
              <Button type="submit" disabled={busy || !UID_PATTERN.test(hwUid) || claimCode.replace(/[\s-]/g, '').length !== 8}>
                {busy ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Search size={15} className="mr-1.5" />}
                Periksa perangkat
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{device.model || 'Gateway'} <span className="font-mono text-xs text-muted-foreground">{device.id}</span></p>
              <p className="text-xs text-muted-foreground">
                Firmware {device.firmware || '—'} · {device.online ? 'online' : 'offline'} · {device.capabilities.sensors?.length || 0} sensor · {device.capabilities.actuators?.length || 0} aktuator
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="iot-name">Nama gateway</Label>
                <Input id="iot-name" value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder="mis. Gateway Kumbung A" />
              </div>
              <div className="space-y-1.5">
                <Label>Kumbung utama</Label>
                {kumbungs.length ? (
                  <Select value={kumbungId} onValueChange={setKumbungId}>
                    <SelectTrigger aria-label="Kumbung utama"><SelectValue placeholder="Pilih kumbung" /></SelectTrigger>
                    <SelectContent>
                      {kumbungs.map(kumbung => <SelectItem key={kumbung.id} value={kumbung.id}>{kumbung.name || kumbung.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : <p className="text-xs text-muted-foreground">Farm ini belum punya kumbung; penempatan bisa diatur nanti.</p>}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium flex items-center gap-1"><Radio size={14} /> Sensor <span className="text-xs font-normal text-muted-foreground">(masing-masing membaca {['temperature', 'humidity', 'co2'].map(metric => METRIC_LABEL[metric]).join(', ')})</span></p>
              {(device.capabilities.sensors || []).map(sensor => (
                <LabelRow key={sensor.id} code={sensor.id} detail={sensor.type} label={labels.sensors[sensor.id]} kumbungs={kumbungs}
                  onChange={label => setLabels(current => ({ ...current, sensors: { ...current.sensors, [sensor.id]: label } }))} />
              ))}
              {!device.capabilities.sensors?.length && <p className="text-xs text-muted-foreground">Gateway tidak melaporkan sensor.</p>}
              <p className="text-[11px] text-muted-foreground">Beri nama sesuai posisinya, mis. “Rak depan”, “Dekat pintu”, agar grafik Monitoring mudah dibaca.</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium flex items-center gap-1"><ToggleRight size={14} /> Aktuator</p>
              {(device.capabilities.actuators || []).map(actuator => (
                <LabelRow key={actuator.id} code={actuator.id} detail={`${actuator.type} · maks ${actuator.maxRunSec} dtk`} label={labels.actuators[actuator.id]} kumbungs={kumbungs}
                  onChange={label => setLabels(current => ({ ...current, actuators: { ...current.actuators, [actuator.id]: label } }))} />
              ))}
              {!device.capabilities.actuators?.length && <p className="text-xs text-muted-foreground">Gateway tidak melaporkan aktuator.</p>}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDevice(null)} disabled={busy}>Kembali</Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Link2 size={15} className="mr-1.5" />}
                Klaim gateway
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
