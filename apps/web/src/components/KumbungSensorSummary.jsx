import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Thermometer, Droplets, Wind, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { db } from '../firebase';
import { subscribeKumbungTelemetry } from '@/lib/telemetryService';
import { useFarmContext } from '@/contexts/FarmContext';

const timeAgo = (timestamp, now) => {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds} dtk lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} jam lalu` : `${Math.floor(hours / 24)} hari lalu`;
};

/** Status pembacaan untuk kartu: belum aktif, belum ada data, stale, invalid, degraded, valid. */
function readingState(sensor, telemetry) {
  if (sensor.status === 'pending') return { label: 'Menunggu gateway', className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' };
  if (!telemetry) return { label: 'Belum ada data', className: 'bg-muted text-muted-foreground border-border' };
  if (telemetry.quality?.stale) return { label: 'Data usang', className: 'bg-orange-500/10 text-orange-600 border-orange-500/20' };
  if (telemetry.quality?.status === 'invalid') return { label: 'Invalid', className: 'bg-red-500/10 text-red-600 border-red-500/20' };
  if (telemetry.quality?.status === 'degraded') return { label: 'Sebagian', className: 'bg-blue-500/10 text-blue-600 border-blue-500/20' };
  return { label: 'Live', className: 'bg-green-500/10 text-green-600 border-green-500/20' };
}

const Metric = ({ icon: Icon, value, unit }) => (
  <span className="inline-flex items-center gap-1">
    <Icon size={13} className="text-muted-foreground" aria-hidden />
    <span className="font-semibold">{value ?? '—'}</span>
    <span className="text-xs text-muted-foreground">{unit}</span>
  </span>
);

/**
 * Ringkasan per sensor di kumbung terpilih. Nilai tidak dirata-ratakan antarsensor: setiap kartu
 * menampilkan sumber, timestamp, dan kualitasnya sendiri. Klik kartu untuk memilih sensor detail.
 */
export default function KumbungSensorSummary() {
  const { kumbung, kumbungSensors, selection, setSensorId } = useFarmContext();
  const sensors = kumbungSensors.filter(sensor => sensor.status !== 'inactive');
  const sensorKey = sensors.map(sensor => sensor.id).join(',');
  const [latest, setLatest] = useState({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!kumbung?.id) return undefined;
    setLatest({});
    return subscribeKumbungTelemetry(db, kumbung.id, sensorKey ? sensorKey.split(',') : [], next => {
      setLatest(next);
      setNow(Date.now());
    }, error => console.error('Gagal memuat telemetry kumbung:', error));
  }, [kumbung?.id, sensorKey]);

  if (!kumbung) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Radio size={18} /> Sensor di {kumbung.name || kumbung.id}
          <span className="text-xs font-normal text-muted-foreground">({sensors.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!sensors.length ? (
          <p className="text-sm text-muted-foreground">
            {selection.legacy
              ? `Kumbung ini belum punya sensor di katalog; grafik memakai sensor default lama ${selection.sensorId}. `
              : 'Kumbung ini belum punya sensor. '}
            <Link to="/devices" className="underline underline-offset-2 hover:text-foreground">Tambahkan sensor di halaman Perangkat</Link>.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sensors.map(sensor => {
              const telemetry = latest[sensor.id];
              const state = readingState(sensor, telemetry);
              const selected = sensor.id === selection.sensorId;
              return (
                <button
                  key={sensor.id}
                  type="button"
                  onClick={() => setSensorId(sensor.id)}
                  aria-pressed={selected}
                  className={`text-left rounded-xl border p-3 transition-colors ${selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{sensor.name || sensor.id}</p>
                      <p className="text-xs text-muted-foreground font-mono">{sensor.id} · {sensor.gatewayId}</p>
                    </div>
                    <Badge variant="outline" className={`shrink-0 text-[10px] ${state.className}`}>{state.label}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <Metric icon={Thermometer} value={telemetry?.temperature} unit="°C" />
                    <Metric icon={Droplets} value={telemetry?.humidity} unit="%" />
                    <Metric icon={Wind} value={telemetry?.co2} unit="ppm" />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                    <Clock size={12} aria-hidden />
                    {telemetry?.timestamp ? timeAgo(telemetry.timestamp, now) : 'Belum pernah mengirim'}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
