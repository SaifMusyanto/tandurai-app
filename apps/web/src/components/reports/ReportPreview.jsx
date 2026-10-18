import React from 'react';
import { AlertTriangle, ClipboardList, Scale, Sprout } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PARAMETERS, PARAMETER_KEYS, formatParameter } from '@/lib/parameters';
import { formatKg } from '@/lib/operationsView';
import { cn } from '@/lib/utils';

const STAGE = { inoculation: 'Inokulasi', incubation: 'Inkubasi', fruiting: 'Buka baglog', harvesting: 'Masa panen', completed: 'Selesai' };
const pctTone = pct => (pct == null ? 'text-muted-foreground' : pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600');

/** Isi laporan farm per kumbung (hasil GET /farms/:id/report). */
export default function ReportPreview({ report }) {
  const has = section => report.sections.includes(section);
  const totalKg = report.kumbungs.reduce((sum, item) => sum + (item.recap?.harvestKg || 0), 0);

  if (!report.kumbungs.length) return <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada kumbung aktif pada pilihan ini.</p>;

  return (
    <div className="space-y-4">
      {has('harvest') && report.kumbungs.length > 1 && (
        <div className="rounded-xl border bg-emerald-500/5 p-4">
          <p className="text-sm text-muted-foreground">Total panen semua kumbung</p>
          <p className="text-2xl font-bold">{formatKg(totalKg)}</p>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {report.kumbungs.map(item => (
          <Card key={item.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{item.name}</CardTitle>
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <Sprout size={14} />{item.batch ? `Batch ${item.batch.number ?? ''} · hari ke-${item.batch.day} · ${STAGE[item.batch.stage] || item.batch.stage} · ${item.batch.active.toLocaleString('id-ID')} baglog` : 'Tidak ada batch berjalan'}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {has('parameters') && (item.parameters ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Parameter</th><th className="font-medium">Rata-rata</th><th className="font-medium">Min–maks</th><th className="font-medium">Optimal</th></tr>
                    </thead>
                    <tbody>
                      {PARAMETER_KEYS.map(key => {
                        const value = item.parameters[key];
                        return (
                          <tr key={key} className="border-t">
                            <td className="py-1.5">{PARAMETERS[key].label}</td>
                            <td className="font-semibold">{formatParameter(key, value.avg)}</td>
                            <td className="text-xs text-muted-foreground">{value.min == null ? '—' : `${formatParameter(key, value.min)} – ${formatParameter(key, value.max)}`}</td>
                            <td className={cn('font-semibold', pctTone(value.optimalPct))}>{value.optimalPct == null ? '—' : `${value.optimalPct}%`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-1 text-xs text-muted-foreground">Optimal = persentase waktu parameter berada di rentang optimal farm.</p>
                </div>
              ) : <p className="text-sm text-muted-foreground">Tidak ada data sensor pada periode ini.</p>)}

              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                {has('harvest') && item.recap && (
                  <div className="rounded-lg bg-muted/50 p-2.5">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground"><Scale size={13} />Panen</p>
                    <p className="font-bold">{formatKg(item.recap.harvestKg)}</p>
                    <p className="text-xs text-muted-foreground">{item.recap.harvestCount}× · A {formatKg(item.recap.gradeKg.A)}</p>
                  </div>
                )}
                {has('activities') && item.recap && (
                  <div className="rounded-lg bg-muted/50 p-2.5">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground"><ClipboardList size={13} />Kegiatan</p>
                    <p className="font-bold">{item.recap.careCount} catatan</p>
                    <p className="text-xs text-muted-foreground">{item.recap.problemCount} masalah · {item.recap.baglogRemoved} baglog dibuang</p>
                  </div>
                )}
                {has('alerts') && item.alerts && (
                  <div className="rounded-lg bg-muted/50 p-2.5">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground"><AlertTriangle size={13} />Peringatan</p>
                    <p className={cn('font-bold', item.alerts.critical ? 'text-red-600' : '')}>{item.alerts.critical} kritis</p>
                    <p className="text-xs text-muted-foreground">{item.alerts.warning} peringatan</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
