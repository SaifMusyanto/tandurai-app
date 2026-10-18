import React from 'react';
import { Helmet } from 'react-helmet';
import {
  AlertTriangle, CircleHelp, CalendarClock, CheckCircle2, Database, Gauge, History,
  Loader2, LockKeyhole, RefreshCw, ShieldAlert, Sparkles, TrendingUp,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useForecastData } from '@/hooks/useForecastData';
import DataTable from '@/components/DataTable';
import { forecastViewState, formatForecastDate, formatJakarta, formatKg } from '@/lib/forecast';

const fieldClass = 'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm sm:min-w-72';

const confidenceLabel = { high: 'Tinggi', medium: 'Sedang', low: 'Rendah' };
const stageLabels = { inoculation: 'Masukkan bibit', incubation: 'Pertumbuhan miselium', fruiting: 'Pembentukan jamur', harvesting: 'Masa panen', completed: 'Selesai' };


const confidenceClass = {
  high: 'bg-green-500/15 text-green-700 dark:text-green-300',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  low: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

const riskLabels = {
  synthetic_demo_input: 'Sebagian data masih berupa contoh',
  temperature_outside_reference: 'Suhu sering di luar rentang optimal',
  humidity_outside_reference: 'Kelembapan sering di luar rentang optimal',
  co2_high: 'CO₂ sering di atas batas optimal',
  no_sensor_history: 'Belum ada histori sensor; perkiraan memakai kondisi rata-rata',
};

/** Ringkasan histori kondisi batch yang dipakai model (model v3). */
function ConditionBasis({ forecast }) {
  const history = forecast.conditionHistory;
  const perThousand = forecast.prediction?.kgPer1000ActiveBaglogs;
  if (!history) return 'Model AI menghitung total panen dan masa panen dari jumlah baglog, kontaminasi, bahan, serta kondisi kumbung.';
  const pct = value => (value == null ? '—' : `${Math.round(value)}%`);
  return (
    <div className="space-y-1">
      {history.used ? (
        <p>
          Dihitung dari histori kondisi {history.daysWithData ?? 0} hari batch ini: suhu di rentang optimal {pct(history.temperatureOptimalPct)} waktu,
          kelembapan {pct(history.humidityOptimalPct)}, CO₂ {pct(history.co2OptimalPct)}.
        </p>
      ) : <p>Belum ada histori sensor yang cukup untuk batch ini, jadi perkiraan memakai kondisi rata-rata. Hasil akan menyesuaikan setelah sensor merekam data.</p>}
      {perThousand != null && <p>Setara <strong>{Number(perThousand).toLocaleString('id-ID', { maximumFractionDigits: 0 })} kg per 1.000 baglog</strong> aktif (kondisi selalu buruk ±300 kg, selalu optimal ±500 kg).</p>}
    </div>
  );
}

function StateNotice({ state, error, refresh }) {
  if (state === 'loading') {
    return <div className="min-h-[45vh] flex items-center justify-center gap-3 text-muted-foreground"><Loader2 className="animate-spin" /> Menghitung perkiraan panen...</div>;
  }
  if (state === 'unauthorized') {
    return <Alert variant="destructive"><LockKeyhole /><AlertTitle>Akses ditolak</AlertTitle><AlertDescription>Akun ini belum mendapat akses ke data kumbung tersebut.</AlertDescription></Alert>;
  }
  if (state === 'error') {
    return <Alert variant="destructive"><ShieldAlert /><AlertTitle>Perkiraan panen belum dapat dibuka</AlertTitle><AlertDescription className="flex items-center justify-between gap-3"><span>Sambungan data sedang bermasalah. Silakan coba kembali.</span><Button size="sm" variant="outline" onClick={refresh}>Coba lagi</Button></AlertDescription></Alert>;
  }
  if (state === 'empty') {
    return <Alert><Database /><AlertTitle>Perkiraan panen belum tersedia</AlertTitle><AlertDescription>Perkiraan belum dihitung untuk kumbung ini. Hubungi pengelola atau coba muat ulang beberapa saat lagi.</AlertDescription></Alert>;
  }
  if (state === 'insufficient') {
    return <Alert><AlertTriangle /><AlertTitle>Data belum cukup</AlertTitle><AlertDescription>Catatan sensor belum cukup untuk membuat perkiraan yang dapat dipercaya. Biarkan sensor mengumpulkan data lebih lama.</AlertDescription></Alert>;
  }
  return null;
}

function IntervalChart({ forecast }) {
  const maximum = Math.max(forecast.p90Kg, forecast.forecastKg, 1);
  const position = value => `${Math.min(100, Math.max(0, Number(value || 0) / maximum * 100))}%`;
  return (
    <div className="space-y-6">
      <div className="relative h-5 overflow-hidden rounded-full border bg-muted/70 shadow-inner">
        <div className="absolute inset-y-0 bg-emerald-500/35 rounded-full" style={{ left: position(forecast.p10Kg), width: `${Math.max(1, (forecast.p90Kg - forecast.p10Kg) / maximum * 100)}%` }} />
        <div className="absolute top-0 bottom-0 w-0.5 bg-primary" style={{ left: position(forecast.p50Kg) }} />
        <div className="absolute top-0 bottom-0 w-1 bg-foreground" style={{ left: position(forecast.forecastKg) }} />
      </div>
      <div className="grid grid-cols-1 gap-2 text-center sm:grid-cols-3 sm:gap-3">
        <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Jumlah aman</p><p className="mt-1 font-bold">{formatKg(forecast.p10Kg)}</p></div>
        <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Paling mungkin</p><p className="mt-1 font-bold">{formatKg(forecast.p50Kg)}</p></div>
        <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Jika kondisi sangat baik</p><p className="mt-1 font-bold">{formatKg(forecast.p90Kg)}</p></div>
      </div>
    </div>
  );
}

export default function AIForecastPage() {
  const {
    scope, batches, selectedKumbungId, setSelectedKumbungId,
    selectedBatchId, setSelectedBatchId, forecast, history,
    calculation, loading, error, refresh,
  } = useForecastData();
  const calculating = ['pending', 'processing'].includes(calculation?.status);
  const state = forecastViewState({ loading, error, forecast });
  const noScope = !loading && !error && scope.kumbungs.length === 0;
  const showForecast = forecast && ['success', 'stale'].includes(state);
  const isDemo = forecast?.status === 'demo'
    || forecast?.model?.evidenceScope === 'synthetic_benchmark'
    || forecast?.input?.provenance?.mode === 'hybrid_synthetic_fill';
  const missing = forecast?.dataQuality?.missingFeatures || [];
  const risks = forecast?.riskFactors || [];
  const fullBestCase = forecast?.input?.provenance?.mode === 'full_synthetic_best_case';
  const readinessPct = fullBestCase
    ? Number(forecast?.dataQuality?.scenarioCompletenessPct || 100)
    : Number(forecast?.dataQuality?.completenessPct || 0);
  const sellingAdvice = Number(forecast?.supplyCommitmentKg || 0) > 0
    ? 'Dari batch ini, siapkan rencana penjualan mulai ' + formatKg(forecast.supplyCommitmentKg) + '. Hasil paling mungkin sekitar ' + formatKg(forecast?.p50Kg) + '.'
    : 'Jangan menjanjikan jumlah panen kepada pembeli dulu. Tunggu data sensor bertambah dan perhitungan berikutnya.';

  return (
    <>
      <Helmet><title>Perkiraan Panen - Dashboard Tandurai</title></Helmet>
      <div className="mx-auto max-w-[1600px] space-y-8 pb-8">
        <div className="flex flex-col gap-5 rounded-2xl border bg-card/70 p-5 shadow-sm backdrop-blur sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2"><Sparkles className="text-emerald-500" size={22} /><Badge variant="outline">Asisten Panen</Badge></div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Perkiraan Hasil Panen</h1>
            <p className="text-sm text-muted-foreground mt-1">Lihat perkiraan hasil panen agar penjualan dan pengiriman lebih mudah direncanakan.</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap lg:w-auto lg:max-w-[920px] lg:shrink-0 lg:justify-end">
            <select aria-label="Pilih kumbung" className={fieldClass} value={selectedKumbungId} onChange={event => setSelectedKumbungId(event.target.value)}>
              {scope.kumbungs.map(kumbung => <option key={kumbung.id} value={kumbung.id}>{kumbung.name || kumbung.id} · {kumbung.id}</option>)}
            </select>
            <select aria-label="Pilih batch" className={fieldClass} value={selectedBatchId} onChange={event => setSelectedBatchId(event.target.value)} disabled={!batches.length}>
              {batches.length === 0 && <option value="">Belum ada batch aktif</option>}
              {batches.map(batch => <option key={batch.id} value={batch.id}>{batch.id} · {Number(batch.baglogCountActive || 0).toLocaleString('id-ID')} baglog · {stageLabels[batch.growthStage] || batch.growthStage}</option>)}
            </select>
            <Button variant="outline" onClick={refresh} disabled={calculating || !selectedKumbungId || !selectedBatchId}><RefreshCw size={16} className={calculating ? 'animate-spin mr-2' : 'mr-2'} />{calculating ? 'Menghitung...' : 'Hitung ulang'}</Button>
          </div>
        </div>

        {noScope && <Alert variant="destructive"><LockKeyhole /><AlertTitle>Tidak ada kumbung yang dapat diakses</AlertTitle><AlertDescription>Minta pengelola menambahkan akses akun Anda ke farm yang sesuai.</AlertDescription></Alert>}
        {!noScope && batches.length > 0 && <StateNotice state={state} error={error} refresh={refresh} />}
        {!noScope && !loading && batches.length === 0 && <Alert><AlertTriangle /><AlertTitle>Belum ada batch aktif</AlertTitle><AlertDescription>Buat atau aktifkan batch pada menu Operasional Kumbung sebelum meminta perkiraan.</AlertDescription></Alert>}
        {!noScope && calculating && <Alert className="border-blue-500/40 bg-blue-500/5"><Loader2 className="animate-spin text-blue-600" /><AlertTitle>Perkiraan sedang dihitung</AlertTitle><AlertDescription>Worker sedang membaca batch aktif, jumlah baglog, fase budidaya, dan riwayat kondisi kumbung. Hasil akan muncul otomatis.</AlertDescription></Alert>}
        {!noScope && calculation?.status === 'failed' && <Alert variant="destructive"><ShieldAlert /><AlertTitle>Perhitungan belum berhasil</AlertTitle><AlertDescription>{calculation.message || 'Pastikan worker lokal sedang berjalan, lalu pilih Hitung ulang.'}</AlertDescription></Alert>}

        {showForecast && (
          <>
            {state === 'stale' && (
              <Alert className="border-orange-500/50"><CalendarClock /><AlertTitle>Perkiraan perlu diperbarui</AlertTitle><AlertDescription>Perkiraan ini sudah lebih dari satu hari. Minta pengelola memperbarui perhitungan.</AlertDescription></Alert>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="h-full border-emerald-500/30 bg-emerald-500/5 shadow-sm"><CardContent className="flex h-full min-h-40 flex-col p-5"><TrendingUp className="text-emerald-500 mb-3" /><p className="text-xs text-muted-foreground">Perkiraan total panen</p><p className="text-3xl font-black">{formatKg(forecast.forecastKg)}</p><p className="mt-auto pt-3 text-xs text-muted-foreground">perkiraan hasil seluruh batch</p></CardContent></Card>
              <Card className="h-full shadow-sm"><CardContent className="flex h-full min-h-40 flex-col p-5"><CheckCircle2 className="text-blue-500 mb-3" /><p className="text-xs text-muted-foreground">Baglog yang dihitung</p><p className="text-3xl font-black">{Number(forecast.input?.baglogCountActive || 0).toLocaleString('id-ID')}</p><p className="mt-auto pt-3 text-xs text-muted-foreground">{forecast.input?.batchId || 'batch aktif terbaru'}</p></CardContent></Card>
              <Card className="h-full shadow-sm"><CardContent className="flex h-full min-h-40 flex-col p-5"><CalendarClock className="text-orange-500 mb-3" /><p className="text-xs text-muted-foreground">Rentang masa panen</p><p className="text-lg font-black">{formatForecastDate(forecast.forecastPeriodStart)}</p><p className="text-sm font-semibold">sampai {formatForecastDate(forecast.forecastPeriodEnd)}</p><p className="mt-auto pt-3 text-xs text-muted-foreground">awal sampai akhir masa panen</p></CardContent></Card>
              <Card className="h-full shadow-sm"><CardContent className="flex h-full min-h-40 flex-col p-5"><Gauge className="text-violet-500 mb-3" /><p className="text-xs text-muted-foreground">Tingkat kepastian</p><Badge className={'mt-2 text-base capitalize ' + (confidenceClass[forecast.confidence] || confidenceClass.low)}>{confidenceLabel[forecast.confidence] || 'Rendah'}</Badge><p className="mt-auto pt-3 text-xs text-muted-foreground">diperbarui {formatJakarta(forecast.generatedAt)}</p></CardContent></Card>
            </div>

            <Alert className="border-emerald-500/40 bg-emerald-500/5"><CheckCircle2 className="text-emerald-600" /><AlertTitle>Saran hari ini</AlertTitle><AlertDescription>{sellingAdvice}</AlertDescription></Alert>
            <Alert><Database /><AlertTitle>Dasar perhitungan</AlertTitle><AlertDescription><ConditionBasis forecast={forecast} /></AlertDescription></Alert>

            <div>
              <Card className="shadow-sm">
                <CardHeader className="p-5 pb-4 sm:p-6 sm:pb-4"><CardTitle>Kemungkinan hasil panen</CardTitle></CardHeader>
                <CardContent><IntervalChart forecast={forecast} /></CardContent>
              </Card>
            </div>

            <div className="grid items-start gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
              <Card className="h-full shadow-sm">
                <CardHeader className="p-5 pb-4 sm:p-6 sm:pb-4"><CardTitle className="flex items-center gap-2"><Database size={18} /> Kesiapan data</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between text-sm"><span>Data sensor terkumpul</span><strong>{readinessPct.toLocaleString('id-ID')}%</strong></div>
                  <Progress value={readinessPct} />
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-muted p-3"><p className="text-muted-foreground text-xs">Catatan masuk</p><p className="font-bold">{fullBestCase ? 'Lengkap untuk simulasi' : (forecast.dataQuality?.sampleCount ?? 0) + '/' + (forecast.dataQuality?.expectedSampleCount ?? 144)}</p></div>
                    <div className="rounded-lg bg-muted p-3"><p className="text-muted-foreground text-xs">Jenis data belum tersedia</p><p className="font-bold">{missing.length}</p></div>
                  </div>
                  {missing.length > 0 && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">Ada {missing.length} jenis catatan yang belum tersedia. Sensor perlu terus menyala agar perkiraan berikutnya lebih baik.</p>}
                </CardContent>
              </Card>
              <Card className="h-full shadow-sm">
                <CardHeader className="p-5 pb-4 sm:p-6 sm:pb-4"><CardTitle className="flex items-center gap-2"><CircleHelp size={18} /> Cara membaca perkiraan</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="rounded-lg bg-muted p-3"><p className="font-semibold">Perkiraan total panen</p><p className="text-muted-foreground mt-1">Jumlah yang diperkirakan terkumpul dari awal sampai akhir masa panen batch.</p></div>
                  <div className="rounded-lg bg-muted p-3"><p className="font-semibold">Perkiraan paling hati-hati</p><p className="text-muted-foreground mt-1">Batas bawah hasil yang dapat dipakai untuk membuat rencana penjualan.</p></div>
                  <div className="rounded-lg bg-muted p-3"><p className="font-semibold">Kemungkinan hasil</p><p className="text-muted-foreground mt-1">Hasil nyata dapat berada antara jumlah aman dan kondisi sangat baik.</p></div>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-sm">
              <CardHeader className="p-5 pb-4 sm:p-6 sm:pb-4"><CardTitle className="flex items-center gap-2"><History size={18} /> Riwayat perkiraan panen</CardTitle></CardHeader>
              <CardContent>
                {history.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada perkiraan sebelumnya.</p> : (
                  <DataTable
                    rows={history}
                    columns={[
                      { key: 'asOfDate', header: 'Tanggal' },
                      { key: 'forecastKg', header: 'Perkiraan panen', className: 'font-semibold', cell: item => formatKg(item.forecastKg) },
                      { key: 'range', hideOnMobile: true, header: 'Aman – kondisi baik', cell: item => `${formatKg(item.p10Kg)} – ${formatKg(item.p90Kg)}` },
                      { key: 'confidence', hideOnMobile: true, header: 'Tingkat kepastian', cell: item => confidenceLabel[item.confidence] || 'Rendah' },
                    ]}
                  />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
