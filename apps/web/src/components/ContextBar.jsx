import React from 'react';
import { Link } from 'react-router-dom';
import { Building2, Warehouse, Radio, Loader2, AlertTriangle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useFarmContext } from '@/contexts/FarmContext';

const SENSOR_STATUS = {
  active: 'aktif',
  pending: 'menunggu gateway',
  maintenance: 'perawatan',
};

/** Pemilih konteks farm → kumbung → sensor yang dipakai seluruh halaman dashboard. */
export default function ContextBar() {
  const {
    loading, error, farms, farm, kumbungs, kumbungSensors, selection,
    setFarmId, setKumbungId, setSensorId,
  } = useFarmContext();

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
  if (!farms.length) {
    return (
      <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
        Akun Anda belum menjadi anggota farm. Minta owner farm menambahkan Anda sebagai operator.
      </div>
    );
  }

  const usableSensors = kumbungSensors.filter(sensor => sensor.status !== 'inactive');

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
      <div className="flex items-center gap-1.5">
        <Building2 size={15} className="text-muted-foreground" aria-hidden />
        <Select value={selection.farmId || ''} onValueChange={setFarmId}>
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Pilih farm"><SelectValue placeholder="Farm" /></SelectTrigger>
          <SelectContent>
            {farms.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {farm && <Badge variant="outline" className="text-[10px]">{farm.role}</Badge>}
      </div>

      <div className="flex items-center gap-1.5">
        <Warehouse size={15} className="text-muted-foreground" aria-hidden />
        {kumbungs.length ? (
          <Select value={selection.kumbungId || ''} onValueChange={setKumbungId}>
            <SelectTrigger className="h-8 w-44 text-xs" aria-label="Pilih kumbung"><SelectValue placeholder="Kumbung" /></SelectTrigger>
            <SelectContent>
              {kumbungs.map(item => <SelectItem key={item.id} value={item.id}>{item.name || item.id}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">{loading ? 'Memuat kumbung…' : 'Belum ada kumbung'}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Radio size={15} className="text-muted-foreground" aria-hidden />
        {usableSensors.length ? (
          <Select value={selection.sensorId || ''} onValueChange={setSensorId}>
            <SelectTrigger className="h-8 w-52 text-xs" aria-label="Pilih sensor"><SelectValue placeholder="Sensor" /></SelectTrigger>
            <SelectContent>
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
      </div>
    </div>
  );
}
