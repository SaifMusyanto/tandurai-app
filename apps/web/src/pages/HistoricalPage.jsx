import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { Download, Search, Filter, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import { db } from '../firebase';
import { subscribeLatestTelemetry } from '@/lib/telemetryService';
import { exportToCSV, exportToExcel } from '@/lib/exportUtils.js';

// ✅ Persistent cache — tidak hilang saat navigasi antar halaman
let cachedHistoryLog = [];
let cachedSummary = {
  avgTemp: '--',
  avgHumidity: '--',
  avgCo2: '--',
  avgPressure: '--',
  trends: { temp: 'up', hum: 'down', co2: 'up', pressure: 'up' },
  changes: { temp: '0.0', hum: '0.0', co2: '0.0', pressure: '0.0' }
};

export default function HistoricalPage() {
  const [historyLog, setHistoryLog] = useState(cachedHistoryLog);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(cachedHistoryLog.length === 0);
  const [summary, setSummary] = useState(cachedSummary);

  useEffect(() => {
    const unsubscribe = subscribeLatestTelemetry(db, sensorData => {
      setLoading(false);
      if (!sensorData) return;

      const newEntry = {
        id: `log-${Date.now()}`,
        timestamp: Date.now(),
        temperature: sensorData.temperature ?? null,
        humidity:    sensorData.humidity    ?? null,
        co2:         sensorData.co2         ?? null,
        pressure:    sensorData.pressure    ?? null,
        espStatus:   sensorData.espStatus   ?? 'Unknown',
        sprayStatus: sensorData.sprayStatus ?? false,
        fanStatus:   sensorData.fanStatus   ?? false,
      };

      // ✅ Update cache dulu, baru set state
      const updated = [newEntry, ...cachedHistoryLog].slice(0, 100);
      cachedHistoryLog = updated;

      const total = updated.length;
      const sumTemp     = updated.reduce((a, c) => a + (Number(c.temperature) || 0), 0);
      const sumHum      = updated.reduce((a, c) => a + (Number(c.humidity)    || 0), 0);
      const sumCo2      = updated.reduce((a, c) => a + (Number(c.co2)         || 0), 0);
      const sumPressure = updated.reduce((a, c) => a + (Number(c.pressure)    || 0), 0);

      const avgTemp     = (sumTemp     / total).toFixed(1);
      const avgHum      = (sumHum      / total).toFixed(1);
      const avgCo2      = Math.round(sumCo2 / total);
      const avgPressure = (sumPressure / total).toFixed(1);

      let trends  = { temp: 'up', hum: 'up', co2: 'up', pressure: 'up' };
      let changes = { temp: '0.0', hum: '0.0', co2: '0', pressure: '0.0' };

      if (total > 1) {
        const latest = updated[0];
        const prev   = updated[1];

        const td = ((latest.temperature || 0) - (prev.temperature || 0));
        const hd = ((latest.humidity    || 0) - (prev.humidity    || 0));
        const cd = ((latest.co2         || 0) - (prev.co2         || 0));
        const pd = ((latest.pressure    || 0) - (prev.pressure    || 0));

        trends  = { temp: td >= 0 ? 'up' : 'down', hum: hd >= 0 ? 'up' : 'down', co2: cd >= 0 ? 'up' : 'down', pressure: pd >= 0 ? 'up' : 'down' };
        changes = { temp: Math.abs(td).toFixed(1), hum: Math.abs(hd).toFixed(1), co2: Math.abs(cd).toFixed(0), pressure: Math.abs(pd).toFixed(1) };
      }

      const newSummary = {
        avgTemp:     `${avgTemp}°C`,
        avgHumidity: `${avgHum}%`,
        avgCo2:      `${avgCo2} ppm`,
        avgPressure: `${avgPressure} hPa`,
        trends,
        changes,
      };

      // ✅ Update cache summary juga
      cachedSummary = newSummary;

      setHistoryLog(updated);
      setSummary(newSummary);
    });

    return () => unsubscribe();
  }, []);

  const filteredData = historyLog.filter(item =>
    Object.values(item).some(val =>
      String(val).toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  const chartData = [...historyLog].slice(0, 20).reverse();

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
            <p className="text-muted-foreground">Analyze past environmental conditions and system actions</p>
          </div>
          <div className="flex gap-2">
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
                    {loading
                      ? 'Menghubungkan ke sensor...'
                      : `Mengumpulkan data grafik... (${chartData.length}/2 titik)`}
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
                      tickFormatter={(val) => val ? new Date(val).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'}
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
              <Button variant="outline" size="icon"><Filter size={16} /></Button>
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
                    <th className="px-4 py-3">ESP Status</th>
                    <th className="px-4 py-3 rounded-tr-lg">Spray</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="7" className="text-center py-8 text-muted-foreground">Menghubungkan ke sensor1...</td></tr>
                  ) : filteredData.length === 0 ? (
                    <tr><td colSpan="7" className="text-center py-8 text-muted-foreground">Belum ada data yang masuk. Tunggu sebentar...</td></tr>
                  ) : (
                    filteredData.map((row) => (
                      <tr key={row.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          {new Date(row.timestamp).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' })}
                        </td>
                        <td className="px-4 py-3 font-semibold">{row.temperature ?? '--'}°C</td>
                        <td className="px-4 py-3">{row.humidity ?? '--'}%</td>
                        <td className="px-4 py-3">{row.co2 ?? '--'} ppm</td>
                        <td className="px-4 py-3">{row.pressure ?? '--'} hPa</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-bold ${row.espStatus === 'Online' ? 'bg-green-500/20 text-green-600' : 'bg-red-500/20 text-red-500'}`}>
                            {row.espStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-bold ${row.sprayStatus === true || row.sprayStatus === 'Active' ? 'bg-green-500/20 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                            {row.sprayStatus === true || row.sprayStatus === 'Active' ? 'Active' : 'Inactive'}
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