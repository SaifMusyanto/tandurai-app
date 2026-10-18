import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DataTable from '@/components/DataTable';
import TelemetryExportCard from '@/components/TelemetryExportCard';
import { useFarmContext } from '@/contexts/FarmContext';
import { api } from '@/lib/api';
import { PARAMETERS, PARAMETER_KEYS, formatParameter, mergeReadings } from '@/lib/parameters';
import { todayJakarta } from '@/lib/operationsView';
import { cn } from '@/lib/utils';

const HOUR = 3600 * 1000;
const RANGES = [
  { id: '24h', label: '24 jam', ms: 24 * HOUR },
  { id: '7d', label: '7 hari', ms: 7 * 24 * HOUR },
  { id: '30d', label: '30 hari', ms: 30 * 24 * HOUR },
  { id: 'custom', label: 'Atur sendiri' },
];
const ALL = 'all';
const CHART_POINTS = 240;

const stats = (rows, key) => {
  const values = rows.map(row => row[key]).filter(value => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return null;
  return { avg: values.reduce((sum, value) => sum + value, 0) / values.length, min: Math.min(...values), max: Math.max(...values) };
};

const tooltipStyle = { backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' };

/**
 * Data historis parameter kumbung: filter kumbung/sensor/periode di halaman ini (bukan ContextBar),
 * satu grafik tiga garis (suhu, kelembapan, CO₂), tabel log, dan export
 * data lengkap (Excel/CSV) dari backend.
 */
export default function HistoricalPage() {
  const { farm, kumbungs, sensors, kumbung: contextKumbung, ranges } = useFarmContext();
  const [kumbungId, setKumbungId] = useState(contextKumbung?.id || '');
  const [sensorId, setSensorId] = useState(ALL);
  const [range, setRange] = useState('24h');
  const [customFrom, setCustomFrom] = useState(todayJakarta(-6));
  const [customTo, setCustomTo] = useState(todayJakarta());
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!kumbungs.some(item => item.id === kumbungId)) setKumbungId(contextKumbung?.id || kumbungs[0]?.id || '');
  }, [kumbungs, kumbungId, contextKumbung?.id]);
  useEffect(() => { setSensorId(ALL); }, [kumbungId]);

  const kumbungSensors = useMemo(() => sensors.filter(sensor => sensor.kumbungId === kumbungId), [sensors, kumbungId]);
  const period = useMemo(() => {
    if (range === 'custom') return { from: Date.parse(`${customFrom}T00:00:00+07:00`), to: Date.parse(`${customTo}T00:00:00+07:00`) + 24 * HOUR };
    const to = Date.now();
    return { from: to - RANGES.find(item => item.id === range).ms, to };
  }, [range, customFrom, customTo]);

  useEffect(() => {
    if (!kumbungId) { setRaw([]); return undefined; }
    let active = true;
    setLoading(true);
    setError('');
    api.kumbungTelemetry(kumbungId, {
      from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(), maxPoints: 20000,
      sensorId: sensorId === ALL ? undefined : sensorId,
    })
      .then(rows => active && setRaw(rows))
      .catch(err => { if (active) { setError(err.message); setRaw([]); } })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [kumbungId, sensorId, period]);

  // Semua sensor terpilih dirata-rata per 10 menit (sesuai bucket histori backend).
  const rows = useMemo(() => mergeReadings(raw, { bucketMs: 10 * 60 * 1000 }), [raw]);
  const step = Math.max(1, Math.ceil(rows.length / CHART_POINTS));
  const chartData = rows.filter((_, index) => index % step === 0 || index === rows.length - 1);
  const summary = useMemo(() => Object.fromEntries(PARAMETER_KEYS.map(key => [key, stats(rows, key)])), [rows]);
  const tableRows = useMemo(() => [...rows].reverse().map(row => ({ ...row, id: String(row.timestamp) })), [rows]);
  const longRange = period.to - period.from > 2 * 24 * HOUR;
  const tick = value => new Date(value).toLocaleString('id-ID', longRange ? { day: '2-digit', month: 'short' } : { hour: '2-digit', minute: '2-digit' });
  const emptyText = !kumbungSensors.length ? 'Kumbung ini belum punya sensor. Tempatkan sensor gateway di halaman Perangkat.'
    : error ? `Gagal memuat data: ${error}` : 'Belum ada data pada periode ini.';

  const chartBox = content => (
    <div className="h-[300px] w-full sm:h-[360px]">
      {chartData.length < 2
        ? <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{loading ? 'Memuat data…' : emptyText}</div>
        : <ResponsiveContainer width="100%" height="100%">{content}</ResponsiveContainer>}
    </div>
  );

  return (
    <>
      <Helmet><title>Data Historis - Dashboard Tandurai</title></Helmet>

      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Data Historis</h1>
          <p className="text-sm text-muted-foreground">Riwayat suhu, kelembapan, dan CO₂ per kumbung (data tersimpan per 10 menit).</p>
        </div>

        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="space-y-1 text-sm font-medium">Kumbung
              <Select value={kumbungId} onValueChange={setKumbungId}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Pilih kumbung" /></SelectTrigger>
                <SelectContent>{kumbungs.map(item => <SelectItem key={item.id} value={item.id}>{item.name || item.id}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-sm font-medium">Sensor
              <Select value={sensorId} onValueChange={setSensorId}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Semua sensor (rata-rata {kumbungSensors.length})</SelectItem>
                  {kumbungSensors.map(sensor => <SelectItem key={sensor.id} value={sensor.id}>{sensor.name || sensor.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <div className="space-y-1">
              <p className="text-sm font-medium">Periode</p>
              <div className="flex flex-wrap gap-1">
                {RANGES.map(item => (
                  <button key={item.id} type="button" onClick={() => setRange(item.id)} aria-pressed={range === item.id}
                    className={cn('h-11 rounded-md border px-3 text-sm', range === item.id ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            {range === 'custom' && (
              <div className="grid grid-cols-2 gap-2 sm:col-span-3 sm:max-w-md">
                <label className="space-y-1 text-sm">Dari<Input type="date" value={customFrom} max={customTo} onChange={event => event.target.value && setCustomFrom(event.target.value)} className="h-11" /></label>
                <label className="space-y-1 text-sm">Sampai<Input type="date" value={customTo} min={customFrom} max={todayJakarta()} onChange={event => event.target.value && setCustomTo(event.target.value)} className="h-11" /></label>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PARAMETER_KEYS.map(key => {
            const item = summary[key];
            const [low, high] = ranges[key];
            return (
              <Card key={key}>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Rata-rata {PARAMETERS[key].label}</p>
                  <p className="text-2xl font-bold">{item ? formatParameter(key, item.avg) : '—'}</p>
                  <p className="text-xs text-muted-foreground">
                    {item ? `min ${formatParameter(key, item.min)} · maks ${formatParameter(key, item.max)}` : 'Tidak ada data'} · optimal {low}–{high} {PARAMETERS[key].unit}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Suhu, kelembapan & CO₂</CardTitle>
            <p className="text-xs text-muted-foreground">Sumbu kiri: suhu (°C) · sumbu kanan: kelembapan (%) dan CO₂ (ppm)</p>
          </CardHeader>
          <CardContent className="px-1 sm:px-6">
            {chartBox(
              <LineChart data={chartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="timestamp" tickFormatter={tick} stroke="hsl(var(--muted-foreground))" fontSize={11} minTickGap={24} />
                <YAxis yAxisId="temperature" stroke={PARAMETERS.temperature.color} fontSize={11} width={32} domain={['auto', 'auto']} />
                <YAxis yAxisId="humidity" orientation="right" stroke={PARAMETERS.humidity.color} fontSize={11} width={30} domain={['auto', 'auto']} />
                <YAxis yAxisId="co2" orientation="right" stroke={PARAMETERS.co2.color} fontSize={11} width={40} domain={['auto', 'auto']} />
                <Tooltip labelFormatter={value => new Date(value).toLocaleString('id-ID')} contentStyle={tooltipStyle}
                  formatter={(value, name, item) => [formatParameter(item.dataKey, value), name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="temperature" type="monotone" dataKey="temperature" name="Suhu" stroke={PARAMETERS.temperature.color} strokeWidth={2} dot={false} connectNulls />
                <Line yAxisId="humidity" type="monotone" dataKey="humidity" name="Kelembapan" stroke={PARAMETERS.humidity.color} strokeWidth={2} dot={false} connectNulls />
                <Line yAxisId="co2" type="monotone" dataKey="co2" name="CO₂" stroke={PARAMETERS.co2.color} strokeWidth={2} dot={false} connectNulls />
              </LineChart>,
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-lg">Log data <span className="font-normal text-muted-foreground">({rows.length})</span></CardTitle></CardHeader>
          <CardContent>
            <DataTable
              pageSize={20}
              loading={loading}
              rows={tableRows}
              emptyText={emptyText}
              columns={[
                { key: 'timestamp', header: 'Waktu', className: 'font-medium text-xs sm:text-sm sm:whitespace-nowrap', cell: row => new Date(row.timestamp).toLocaleString('id-ID', { day: 'numeric', month: 'short', ...(longRange ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' }) },
                { key: 'temperature', header: 'Suhu (°C)', cell: row => formatParameter('temperature', row.temperature) },
                { key: 'humidity', header: 'Kelembapan (%)', cell: row => formatParameter('humidity', row.humidity) },
                { key: 'co2', header: 'CO₂ (ppm)', cell: row => formatParameter('co2', row.co2) },
                { key: 'sensors', header: 'Sensor', hideOnMobile: true, className: 'text-xs text-muted-foreground', cell: row => `${row.sensors || 1} sensor` },
              ]}
            />
          </CardContent>
        </Card>

        {farm && <TelemetryExportCard farm={farm} kumbungs={kumbungs} sensors={sensors} defaultKumbungId={kumbungId} />}
      </div>
    </>
  );
}
