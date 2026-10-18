import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Warehouse, Radio, Loader2, AlertTriangle, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ALL_SENSORS, useFarmContext } from '@/contexts/FarmContext';

const SENSOR_STATUS = {
  active: 'aktif',
  pending: 'menunggu gateway',
  error: 'bermasalah',
  maintenance: 'perawatan',
};

/** Akun tanpa farm: buat farm sendiri (menjadi owner) atau minta owner menambahkan sebagai operator. */
function CreateFarmPrompt() {
  const { createFarm } = useFarmContext();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    try {
      const farm = await createFarm({ name: name.trim(), location: location.trim() || 'Indonesia' });
      toast.success(`Farm ${farm.name} dibuat. Tambahkan kumbung di menu Operasional.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-3 text-xs text-yellow-800 dark:text-yellow-300 space-y-2">
      <p>Akun Anda belum menjadi anggota farm. Buat farm baru (Anda menjadi owner), atau minta owner farm menambahkan email Anda sebagai operator.</p>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <Input value={name} onChange={event => setName(event.target.value)} placeholder="Nama farm" aria-label="Nama farm" className="h-8 w-48 text-xs bg-background" maxLength={100} required />
        <Input value={location} onChange={event => setLocation(event.target.value)} placeholder="Lokasi (opsional)" aria-label="Lokasi farm" className="h-8 w-48 text-xs bg-background" maxLength={150} />
        <Button type="submit" size="sm" className="h-8" disabled={saving || !name.trim()}>
          {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Plus size={14} className="mr-1" />}Buat farm
        </Button>
      </form>
    </div>
  );
}

/** Pemilih farm di navbar (kiri ikon notifikasi); berlaku untuk semua halaman. */
export function FarmSwitcher() {
  const { farms, farm, selection, setFarmId } = useFarmContext();
  if (!farms.length) return null;
  return (
    <div className="flex items-center gap-1.5">
      <Building2 size={16} className="hidden text-muted-foreground sm:block" aria-hidden />
      <Select value={selection.farmId || ''} onValueChange={setFarmId}>
        <SelectTrigger className="h-9 w-32 text-xs sm:w-44" aria-label="Pilih farm"><SelectValue placeholder="Farm" /></SelectTrigger>
        <SelectContent>
          {farms.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {farm && <Badge variant="outline" className="hidden text-[10px] md:inline-flex">{farm.role}</Badge>}
    </div>
  );
}

/**
 * Pemilih kumbung → sensor di atas halaman (farm dipilih di navbar lewat `FarmSwitcher`).
 * `level` = tingkat terdalam yang dibutuhkan halaman ('kumbung' | 'sensor'); 'farm'/null = tidak
 * ditampilkan (ajakan membuat farm untuk akun tanpa farm tetap muncul).
 */
export default function ContextBar({ level = 'sensor' }) {
  const {
    loading, error, farms, kumbungs, kumbungSensors, selection, setKumbungId, setSensorId,
  } = useFarmContext();
  const showKumbung = level === 'kumbung' || level === 'sensor';
  const showSensor = level === 'sensor';

  if (!showKumbung && farms.length) return null;
  if (loading && !farms.length) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
        <Loader2 size={14} className="animate-spin" /> Memuat farm…
      </div>
    );
  }
  if (error && !farms.length) {
    return <p className="text-xs text-red-600 mb-4">Gagal memuat konteks farm: {error}</p>;
  }
  if (!farms.length) return <CreateFarmPrompt />;
  if (!showKumbung) return null;

  const usableSensors = kumbungSensors.filter(sensor => sensor.status !== 'inactive');

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
      {showKumbung && <div className="flex items-center gap-1.5">
        <Warehouse size={15} className="text-muted-foreground" aria-hidden />
        {kumbungs.length ? (
          <Select value={selection.kumbungId || ''} onValueChange={setKumbungId}>
            <SelectTrigger className="h-8 w-44 text-xs" aria-label="Pilih kumbung"><SelectValue placeholder="Kumbung" /></SelectTrigger>
            <SelectContent>
              {kumbungs.map(item => <SelectItem key={item.id} value={item.id}>{item.name || item.id}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">
            {loading ? 'Memuat kumbung…' : <>Belum ada kumbung. <Link to="/operations" className="underline underline-offset-2 hover:text-foreground">Tambah di Operasional</Link></>}
          </span>
        )}
      </div>}

      {showSensor && <div className="flex items-center gap-1.5">
        <Radio size={15} className="text-muted-foreground" aria-hidden />
        {usableSensors.length ? (
          <Select value={selection.allSensors ? ALL_SENSORS : selection.sensorId || ''} onValueChange={setSensorId}>
            <SelectTrigger className="h-8 w-56 text-xs" aria-label="Pilih sensor"><SelectValue placeholder="Sensor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SENSORS}>Semua sensor (rata-rata {usableSensors.length})</SelectItem>
              {usableSensors.map(item => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name || item.id} · {SENSOR_STATUS[item.status] || item.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : selection.legacy ? (
          <span className="flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-400" title="Kumbung ini belum punya sensor di katalog; memakai sensor default lama.">
            <AlertTriangle size={13} /> {selection.sensorId} (default lama)
          </span>
        ) : selection.kumbungId ? (
          <span className="text-xs text-muted-foreground">
            Belum ada sensor.{' '}
            <Link to="/devices" className="underline underline-offset-2 hover:text-foreground">Tambah di Perangkat</Link>
          </span>
        ) : null}
      </div>}
    </div>
  );
}
