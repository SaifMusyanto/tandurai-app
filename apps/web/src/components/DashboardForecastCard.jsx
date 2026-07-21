import React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, ArrowRight, CalendarClock, CheckCircle2, Loader2,
  RefreshCw, Sparkles, TrendingUp,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboardForecast } from '@/hooks/useDashboardForecast';
import { formatForecastDate, formatJakarta, formatKg } from '@/lib/forecast';

const confidenceLabel = { high: 'Tinggi', medium: 'Sedang', low: 'Rendah' };

const riskDetails = {
  temperature_outside_reference: {
    title: 'Suhu perlu diperhatikan',
    description: 'Periksa suhu kumbung agar perkembangan jamur tetap sesuai rencana.',
    focus: 'temperature',
  },
  humidity_outside_reference: {
    title: 'Kelembapan perlu diperhatikan',
    description: 'Periksa kelembapan kumbung agar pertumbuhan dan hasil panen tetap terjaga.',
    focus: 'humidity',
  },
  co2_high: {
    title: 'Sirkulasi udara perlu diperhatikan',
    description: 'Kadar CO₂ tinggi. Periksa ventilasi dan kondisi udara di kumbung.',
    focus: 'co2',
  },
};

const firstMonitoringRisk = risks => (risks || []).map(code => riskDetails[code]).find(Boolean);

export default function DashboardForecastCard() {
  const { loading, error, forecast, kumbung, batch } = useDashboardForecast();

  if (loading) {
    return <Card><CardContent className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={18} /> Memuat perkiraan panen...</CardContent></Card>;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Ringkasan perkiraan belum dapat dimuat</AlertTitle>
        <AlertDescription>Periksa sambungan internet atau hak akses akun, lalu muat ulang halaman.</AlertDescription>
      </Alert>
    );
  }

  if (!forecast) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center">
          <Sparkles className="text-muted-foreground" />
          <div><p className="font-bold">Perkiraan panen belum tersedia</p><p className="mt-1 text-sm text-muted-foreground">Buka halaman perkiraan setelah batch aktif dibuat.</p></div>
          <Button asChild><Link to="/ai-forecast">Buka Perkiraan Panen <ArrowRight size={16} className="ml-2" /></Link></Button>
        </CardContent>
      </Card>
    );
  }

  const batchId = forecast.input?.batchId;
  const kumbungId = kumbung?.id || forecast.input?.kumbungId;
  const detailUrl = `/ai-forecast?kumbung=${encodeURIComponent(kumbungId || '')}&batch=${encodeURIComponent(batchId || '')}`;
  const risk = firstMonitoringRisk(forecast.riskFactors);
  const monitoringUrl = risk ? `/monitoring?kumbung=${encodeURIComponent(kumbungId || '')}&focus=${risk.focus}` : null;
  const isInactive = batch && batch.status !== 'active';

  return (
    <Card className="overflow-hidden border-emerald-500/30 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="text-emerald-600" size={20} /> Ringkasan Perkiraan Panen</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{kumbung?.name || kumbungId} · Batch {batchId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {forecast.status === 'demo' && <Badge variant="outline">Data latihan</Badge>}
            {forecast.stale && <Badge className="bg-orange-500/15 text-orange-700">Perlu diperbarui</Badge>}
            {isInactive && <Badge variant="secondary">Batch tidak aktif</Badge>}
            <Badge variant="outline">Kepastian {confidenceLabel[forecast.confidence] || 'Rendah'}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl bg-emerald-500/10 p-4"><TrendingUp className="mb-2 text-emerald-600" size={20} /><p className="text-xs text-muted-foreground">Perkiraan total panen</p><p className="mt-1 text-2xl font-black">{formatKg(forecast.forecastKg)}</p></div>
          <div className="rounded-xl bg-muted/60 p-4"><CheckCircle2 className="mb-2 text-blue-600" size={20} /><p className="text-xs text-muted-foreground">Kemungkinan hasil</p><p className="mt-1 font-bold">{formatKg(forecast.p10Kg)} – {formatKg(forecast.p90Kg)}</p></div>
          <div className="rounded-xl bg-muted/60 p-4"><CalendarClock className="mb-2 text-orange-600" size={20} /><p className="text-xs text-muted-foreground">Mulai panen</p><p className="mt-1 font-bold">{formatForecastDate(forecast.forecastPeriodStart)}</p></div>
          <div className="rounded-xl bg-muted/60 p-4"><CalendarClock className="mb-2 text-violet-600" size={20} /><p className="text-xs text-muted-foreground">Akhir masa panen</p><p className="mt-1 font-bold">{formatForecastDate(forecast.forecastPeriodEnd)}</p></div>
        </div>

        {risk ? (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-bold text-amber-800 dark:text-amber-200">{risk.title}</p><p className="mt-1 text-sm text-muted-foreground">{risk.description}</p></div>
            <Button asChild variant="outline" className="shrink-0"><Link to={monitoringUrl}>Lihat Monitoring <ArrowRight size={16} className="ml-2" /></Link></Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm"><CheckCircle2 className="shrink-0 text-emerald-600" size={18} /><span>Kondisi yang terbaca mendukung rencana panen. Lanjutkan pemantauan rutin.</span></div>
        )}

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw size={13} /> Dihitung worker AI: {formatJakarta(forecast.generatedAt)}</p>
          <Button asChild><Link to={detailUrl}>Lihat Perkiraan Lengkap <ArrowRight size={16} className="ml-2" /></Link></Button>
        </div>
      </CardContent>
    </Card>
  );
}