import React, { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Download, Search, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import { exportToCSV, exportToExcel } from '@/lib/exportUtils.js';
import { useSensorHistory } from '@/hooks/useSensorHistory';
import { useFarmContext } from '@/contexts/FarmContext';

const RANGES = [
  { value: '24h', label: '24 Jam', ms: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7 Hari', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: '30 Hari', ms: 30 * 24 * 60 * 60 * 1000 },
];
const CHART_POINTS = 200;

const average = (rows, key) => {
  const values = rows.map(row => Number(row[key])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};

function summarize(rows) {
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];
  const change = key => (latest && previous ? (Number(latest[key]) || 0) - (Number(previous[key]) || 0) : 0);
  const format = (value, digits, unit) => (value === null ? '--' : `${value.toFixed(digits)}${unit}`);
  return {
    avgTemp: format(average(rows, 'temperature'), 1, '°C'),
    avgHumidity: format(average(rows, 'humidity'), 1, '%'),
    avgCo2: format(average(rows, 'co2'), 0, ' ppm'),
    avgPressure: format(average(rows, 'pressure'), 1, ' hPa'),
    trends: {
      temp: change('temperature') >= 0 ? 'up' : 'down',
      hum: change('humidity') >= 0 ? 'up' : 'down',
      co2: change('co2') >= 0 ? 'up' : 'down',
      pressure: change('pressure') >= 0 ? 'up' : 'down',
    },
    changes: {
      temp: Math.abs(change('temperature')).toFixed(1),
      hum: Math.abs(change('humidity')).toFixed(1),
      co2: Math.abs(change('co2')).toFixed(0),
      pressure: Math.abs(change('pressure')).toFixed(1),
    },
  };
}

export default function HistoricalPage() {
  const [range, setRange] = useState('24h');
  const [searchTerm, setSearchTerm] = useState('');
  const rangeMs = RANGES.find(item => item.value === range).ms;
  const { rows, loading, error, target } = useSensorHistory({ rangeMs, maxPoints: 2000 });
  const { kumbung, sensor } = useFarmContext();

  const summary = useMemo(() => summarize(rows), [rows]);
  const historyLog = useMemo(() => [...rows].reverse().map(row => ({
    id: `${row.sensorId || target.sensorId}_${row.timestamp}`,
    timestamp: row.timestamp,
    temperature: row.temperature ?? null,
    humidity: row.humidity ?? null,
    co2: row.co2 ?? null,
    pressure: row.pressure ?? null,
    quality: row.quality?.status || 'unknown',
    mistingStatus: row.mistingStatus ?? false,
    sensorId: row.sensorId || target.sensorId,
  })), [rows, target.sensorId]);

  const filteredData = historyLog.filter(item =>
    Object.values(item).some(val =>
      String(val).toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  const step = Math.max(1, Math.ceil(rows.length / CHART_POINTS));
  const chartData = rows.filter((_, index) => index % step === 0 || index === rows.length - 1);
  const emptyText = !target.sensorId
    ? 'Kumbung terpilih belum punya sensor. Tambahkan sensor di halaman Perangkat.'
    : error
      ? `Gagal memuat history: ${error}`
      : 'Belum ada data pada rentang ini.';

  const SummaryCard = ({ title, value, trend, change }) => (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm text-muted-foreground font-medium mb-2">{title}</p>
        <div className="flex items-end justify-between">
          <h3 className="text-3xl font-bold">{value}</h3>
          {value !== '--' && (
            <div className={`flex items-center text-sm ${trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
              {trend === 'up' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
              <span>{change}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <>
      <Helmet>
        <title>Historical Data - Tumbara</title>
      </Helmet>

      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Historical Data</h1>
            <p className="text-muted-foreground">
              {kumbung?.name || target.kumbungId || 'Pilih kumbung'}
              {target.sensorId && ` · ${sensor?.name || target.sensorId} (${target.sensorId})`}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {RANGES.map(item => (
              <Button key={item.value} variant={range === item.value ? 'default' : 'outline'} onClick={() => setRange(item.value)}>
                {item.label}
              </Button>
            ))}
            <Button variant="outline" onClick={() => exportToCSV(filteredData, 'historical_data.csv')}>
              <Download size={16} className="mr-2" /> CSV
            </Button>
            <Button variant="outline" onClick={() => exportToExcel(filteredData, 'historical_data.xlsx')}>
              <Download size={16} className="mr-2" /> Excel
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard title="Average Temperature" value={summary.avgTemp}     trend={summary.trends.temp}     change={summary.changes.temp}     />
          <SummaryCard title="Average Humidity"    value={summary.avgHumidity} trend={summary.trends.hum}      change={summary.changes.hum}      />
          <SummaryCard title="Average CO₂"         value={summary.avgCo2}      trend={summary.trends.co2}      change={summary.changes.co2}      />
          <SummaryCard title="Avg Pressure"        value={summary.avgPressure} trend={summary.trends.pressure} change={summary.changes.pressure} />
        </div>

        {/* Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Temperature & Humidity Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {chartData.length < 2 ? (
                <div className="h-full w-full flex flex-col items-center justify-center border border-dashed rounded-lg gap-2">
                  <p className="text-sm text-muted-foreground">
                    {loading ? 'Memuat history sensor…' : chartData.length ? 'Butuh minimal 2 titik data untuk grafik.' : emptyText}
                  </p>
                  {!loading && chartData.length === 1 && (
                    <p className="text-xs text-muted-foreground">Grafik muncul setelah data kedua masuk</p>
                  )}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(val) => val ? new Date(val).toLocaleString('id-ID', range === '24h' ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', hour: '2-digit' }) : '--:--'}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis yAxisId="left"  stroke="hsl(var(--muted-foreground))" />
                    <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      labelFormatter={(label) => label ? new Date(label).toLocaleString('id-ID') : ''}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                    />
                    <Line yAxisId="left"  type="monotone" dataKey="temperature" name="Temp (°C)" stroke="hsl(var(--primary))"   strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="humidity"    name="Hum (%)"   stroke="hsl(var(--secondary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle>Data Log</CardTitle>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search records..."
                  className="pl-8"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 rounded-tl-lg">Timestamp</th>
                    <th className="px-4 py-3">Temp (°C)</th>
                    <th className="px-4 py-3">Humidity (%)</th>
                    <th className="px-4 py-3">CO₂ (ppm)</th>
                    <th className="px-4 py-3">Pressure (hPa)</th>
                    <th className="px-4 py-3">Kualitas</th>
                    <th className="px-4 py-3 rounded-tr-lg">Misting</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="7" className="text-center py-8 text-muted-foreground">Memuat history sensor…</td></tr>
                  ) : filteredData.length === 0 ? (
                    <tr><td colSpan="7" className="text-center py-8 text-muted-foreground">{searchTerm ? 'Tidak ada data yang cocok.' : emptyText}</td></tr>
                  ) : (
                    filteredData.slice(0, 500).map((row) => (
                      <tr key={row.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          {new Date(row.timestamp).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' })}
                        </td>
                        <td className="px-4 py-3 font-semibold">{row.temperature ?? '--'}°C</td>
                        <td className="px-4 py-3">{row.humidity ?? '--'}%</td>
                        <td className="px-4 py-3">{row.co2 ?? '--'} ppm</td>
                        <td className="px-4 py-3">{row.pressure ?? '--'} hPa</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-bold ${row.quality === 'valid' ? 'bg-green-500/20 text-green-600' : row.quality === 'invalid' ? 'bg-red-500/20 text-red-500' : 'bg-yellow-500/20 text-yellow-700'}`}>
                            {row.quality}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-bold ${row.mistingStatus ? 'bg-green-500/20 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                            {row.mistingStatus ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}