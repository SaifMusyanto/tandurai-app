import React from 'react';
import { AlertTriangle, ArrowRight, ClipboardList, Droplets, Leaf, PackagePlus, Scale, Sprout, Thermometer, Undo2, Wind, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFarmContext } from '@/contexts/FarmContext';
import { useKumbungTelemetry } from '@/hooks/useKumbungTelemetry';
import { PARAMETERS, formatParameter, parameterStatus } from '@/lib/parameters';
import { PHASES, TYPE_LABELS, batchDay, batchLabel, describeRecapRow, formatKg, formatTime, phaseInfo } from '@/lib/operationsView';
import { cn } from '@/lib/utils';

const KIND_STYLE = {
  harvest: { icon: Scale, className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  care: { icon: ClipboardList, className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  problem: { icon: AlertTriangle, className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  batch: { icon: Sprout, className: 'bg-violet-500/15 text-violet-700 dark:text-violet-400' },
};
const PARAM_ICON = { temperature: Thermometer, humidity: Droplets, co2: Wind };

/** Kondisi kumbung sekarang (rata-rata sensor) dengan status Aman/Perhatikan dari rentang optimal farm. */
function ConditionStrip() {
  const { ranges } = useFarmContext();
  const { values, timestamp, sensorCount } = useKumbungTelemetry();
  if (!sensorCount) return null;
  return (
    <div className="grid grid-cols-3 gap-2">
      {Object.keys(PARAMETERS).map(key => {
        const Icon = PARAM_ICON[key];
        const status = parameterStatus(key, values[key], ranges);
        return (
          <div key={key} className={cn('rounded-xl border p-3', status === 'warning' && 'border-amber-500/50 bg-amber-500/10')}>
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><Icon size={13} />{PARAMETERS[key].label}</p>
            <p className="mt-0.5 text-lg font-bold leading-tight">{formatParameter(key, values[key])}</p>
            <p className={cn('text-xs font-medium', status === 'warning' ? 'text-amber-700 dark:text-amber-400' : status === 'optimal' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
              {status === 'warning' ? 'Perhatikan' : status === 'optimal' ? 'Aman' : timestamp ? '—' : 'Belum ada data'}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** Daftar catatan (hari ini) dengan aksi koreksi panen / batalkan catatan. */
export function ActivityList({ rows, uid, isOwner, onVoid, onCorrect, emptyText = 'Belum ada catatan hari ini.' }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="divide-y">
      {rows.map(row => {
        const style = KIND_STYLE[row.kind] || KIND_STYLE.care;
        const Icon = style.icon;
        const canVoid = ['care', 'note', 'problem'].includes(row.type) && (isOwner || row.recordedBy === uid);
        return (
          <li key={row.id} className="flex items-start gap-3 py-3">
            <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full', style.className)}><Icon size={17} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug">
                {TYPE_LABELS[row.type]}{row.corrected && <Badge variant="secondary" className="ml-2 align-middle text-[10px]">dikoreksi</Badge>}
              </p>
              <p className="text-sm leading-snug">{describeRecapRow(row)}</p>
              {row.notes && row.kind !== 'batch' && <p className="text-xs text-muted-foreground">“{row.notes}”</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">{formatTime(row.occurredAt)} · {row.recordedBy === uid ? 'Anda' : row.recordedByName}</p>
            </div>
            {row.kind === 'harvest' && onCorrect && (
              <Button size="sm" variant="ghost" className="h-10 shrink-0" onClick={() => onCorrect(row)}><Pencil size={15} className="mr-1" />Koreksi</Button>
            )}
            {canVoid && onVoid && (
              <Button size="sm" variant="ghost" className="h-10 shrink-0 text-muted-foreground" onClick={() => onVoid(row)}><Undo2 size={15} className="mr-1" />Batal</Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Layar utama operasional: batch berjalan (hari ke-N, tahap, baglog, total panen), kondisi kumbung,
 * panduan tahap, dan catatan hari ini. `today` = hasil rekap hari ini untuk kumbung ini.
 */
export default function TodayPanel({ kumbung, batch, batchHarvestKg, today, uid, isOwner, onStartBatch, onAdvance, onCloseBatch, onVoid, onCorrect }) {
  const phase = batch ? phaseInfo(batch.growthStage) : null;
  const nextIsClose = phase && (phase.id === 'harvesting' || phase.id === 'completed');

  return (
    <div className="space-y-4">
      {batch ? (
        <Card className="border-emerald-500/40 shadow-sm">
          <CardHeader className="space-y-1 pb-3">
            <p className="text-sm text-muted-foreground">{batchLabel(batch)}</p>
            <CardTitle className="flex flex-wrap items-baseline gap-x-2 text-2xl">
              Hari ke-{batchDay(batch)}
              <span className="text-base font-semibold text-emerald-700 dark:text-emerald-400">· {phase.title}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Baglog aktif</p>
                <p className="text-lg font-bold">{batch.baglogCountActive.toLocaleString('id-ID')} <span className="text-sm font-normal text-muted-foreground">/ {batch.baglogCountInitial.toLocaleString('id-ID')}</span></p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Total panen batch</p>
                <p className="text-lg font-bold">{batchHarvestKg == null ? '…' : formatKg(batchHarvestKg)}</p>
              </div>
            </div>

            {/* Progres tahap: titik berurutan, mudah dibaca di HP */}
            <ol className="flex items-center gap-1" aria-label="Tahap budidaya">
              {PHASES.map(item => (
                <li key={item.id} className={cn('h-2 flex-1 rounded-full', item.number <= phase.number ? 'bg-emerald-600' : 'bg-muted')} title={item.title} />
              ))}
            </ol>
            <div className="rounded-xl bg-emerald-500/10 p-3">
              <p className="text-sm font-semibold">Yang perlu dilakukan</p>
              <p className="mt-0.5 text-sm">{phase.description}</p>
            </div>

            {phase.next && !nextIsClose && (
              <Button variant="outline" className="h-12 w-full justify-between text-left text-sm" onClick={() => onAdvance(batch)}>
                <span className="truncate">{phase.next}</span><ArrowRight size={16} className="shrink-0" />
              </Button>
            )}
            {nextIsClose && (isOwner ? (
              <Button variant="outline" className="h-12 w-full justify-between text-sm" onClick={() => onCloseBatch(batch)}>
                <span>{phase.next || 'Tutup batch'}</span><ArrowRight size={16} />
              </Button>
            ) : <p className="text-xs text-muted-foreground">Jika panen sudah habis, minta owner farm menutup batch ini.</p>)}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <Leaf className="text-muted-foreground" size={28} />
            <div>
              <p className="font-semibold">Belum ada batch berjalan di {kumbung.name}</p>
              <p className="text-sm text-muted-foreground">Mulai batch saat baglog masuk kumbung agar hari dan panen terhitung.</p>
            </div>
            <Button className="h-12 text-base" onClick={onStartBatch}><PackagePlus size={18} className="mr-2" />Mulai batch</Button>
          </CardContent>
        </Card>
      )}

      <ConditionStrip />

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
          <CardTitle className="text-lg">Catatan hari ini</CardTitle>
          {today?.summary?.harvestCount > 0 && <Badge variant="outline" className="text-sm">{formatKg(today.summary.harvestKg)} dipanen</Badge>}
        </CardHeader>
        <CardContent>
          {today ? <ActivityList rows={today.rows} uid={uid} isOwner={isOwner} onVoid={onVoid} onCorrect={onCorrect} />
            : <p className="py-6 text-center text-sm text-muted-foreground">Memuat…</p>}
        </CardContent>
      </Card>
    </div>
  );
}
