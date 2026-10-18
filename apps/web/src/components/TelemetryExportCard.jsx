import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { saveBlob } from '@/lib/download';
import { todayJakarta } from '@/lib/operationsView';
import { cn } from '@/lib/utils';

const INTERVALS = [
  { id: '10m', label: '10 menit', hint: 'data asli' },
  { id: '1h', label: 'Per jam', hint: 'rata-rata, min, maks' },
  { id: '1d', label: 'Per hari', hint: 'rata-rata, min, maks' },
];
const GROUPS = [
  { id: 'sensor', label: 'Per sensor' },
  { id: 'kumbung', label: 'Rata-rata per kumbung' },
];

function Chip({ selected, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={cn('min-h-10 rounded-full border px-3 py-1.5 text-sm transition-colors',
        selected ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border hover:bg-muted')}>
      {children}
    </button>
  );
}

/**
 * Unduh data parameter lengkap (suhu, kelembapan, CO₂) dari backend sebagai Excel/CSV dengan filter
 * rentang tanggal, kumbung, sensor, interval, dan pengelompokan. Kosong = semua.
 */
export default function TelemetryExportCard({ farm, kumbungs, sensors, defaultKumbungId }) {
  const [from, setFrom] = useState(todayJakarta(-6));
  const [to, setTo] = useState(todayJakarta());
  const [kumbungIds, setKumbungIds] = useState(defaultKumbungId ? [defaultKumbungId] : []);
  const [sensorIds, setSensorIds] = useState([]);
  const [interval, setIntervalChoice] = useState('1h');
  const [groupBy, setGroupBy] = useState('sensor');
  const [busy, setBusy] = useState('');

  useEffect(() => { setKumbungIds(defaultKumbungId ? [defaultKumbungId] : []); setSensorIds([]); }, [farm?.id, defaultKumbungId]);

  const shownSensors = useMemo(() => sensors.filter(sensor => !kumbungIds.length || kumbungIds.includes(sensor.kumbungId)), [sensors, kumbungIds]);
  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter(item => item !== value) : [...list, value]);
  const kumbungName = id => kumbungs.find(item => item.id === id)?.name || id;

  const download = async format => {
    setBusy(format);
    try {
      saveBlob(await api.telemetryExport(farm.id, {
        from, to, interval, groupBy, format,
        kumbungIds: kumbungIds.join(',') || undefined,
        sensorIds: groupBy === 'sensor' ? sensorIds.filter(id => shownSensors.some(sensor => sensor.id === id)).join(',') || undefined : undefined,
      }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><FileSpreadsheet size={18} className="text-primary" />Unduh data parameter</CardTitle>
        <CardDescription>Suhu, kelembapan, dan CO₂ lengkap dari database. Tanpa pilihan = semua kumbung / semua sensor.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <label className="space-y-1 text-sm font-medium">Dari tanggal
            <Input type="date" value={from} max={to} onChange={event => event.target.value && setFrom(event.target.value)} className="h-11" />
          </label>
          <label className="space-y-1 text-sm font-medium">Sampai tanggal
            <Input type="date" value={to} min={from} max={todayJakarta()} onChange={event => event.target.value && setTo(event.target.value)} className="h-11" />
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Kumbung</p>
          <div className="flex flex-wrap gap-2">
            <Chip selected={!kumbungIds.length} onClick={() => setKumbungIds([])}>Semua kumbung</Chip>
            {kumbungs.map(item => <Chip key={item.id} selected={kumbungIds.includes(item.id)} onClick={() => toggle(kumbungIds, setKumbungIds, item.id)}>{item.name || item.id}</Chip>)}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Pengelompokan</p>
          <div className="flex flex-wrap gap-2">
            {GROUPS.map(item => <Chip key={item.id} selected={groupBy === item.id} onClick={() => setGroupBy(item.id)}>{item.label}</Chip>)}
          </div>
        </div>

        {groupBy === 'sensor' && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Sensor</p>
            {shownSensors.length ? (
              <div className="flex flex-wrap gap-2">
                <Chip selected={!sensorIds.length} onClick={() => setSensorIds([])}>Semua sensor</Chip>
                {shownSensors.map(sensor => (
                  <Chip key={sensor.id} selected={sensorIds.includes(sensor.id)} onClick={() => toggle(sensorIds, setSensorIds, sensor.id)}>
                    {sensor.name || sensor.id}{kumbungIds.length !== 1 ? ` · ${kumbungName(sensor.kumbungId)}` : ''}
                  </Chip>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">Belum ada sensor di kumbung terpilih.</p>}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Interval data</p>
          <div className="flex flex-wrap gap-2">
            {INTERVALS.map(item => <Chip key={item.id} selected={interval === item.id} onClick={() => setIntervalChoice(item.id)}>{item.label} <span className="text-xs text-muted-foreground">· {item.hint}</span></Chip>)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button className="h-11 flex-1 sm:flex-none" onClick={() => download('xlsx')} disabled={Boolean(busy)}>
            {busy === 'xlsx' ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Download size={16} className="mr-2" />}Unduh Excel
          </Button>
          <Button variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => download('csv')} disabled={Boolean(busy)}>
            {busy === 'csv' ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Download size={16} className="mr-2" />}Unduh CSV
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
