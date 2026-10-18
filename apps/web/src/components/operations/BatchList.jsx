import React from 'react';
import { ArrowRight, FileBarChart, PackagePlus, Pencil, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { STATUS_LABELS, SUBSTRATE_LABELS, batchDay, batchLabel, phaseInfo } from '@/lib/operationsView';

const STATUS_STYLE = {
  active: 'bg-emerald-600 text-white',
  completed: 'bg-muted text-foreground',
  cancelled: 'bg-amber-500/20 text-amber-800 dark:text-amber-300',
};

/** Siklus batch kumbung: yang berjalan di atas, riwayat di bawah. */
export default function BatchList({ batches, isOwner, onStart, onEdit, onAdvance, onClose, onRecap }) {
  const sorted = [...batches].sort((a, b) => (a.status === 'active') === (b.status === 'active') ? b.startedAt - a.startedAt : a.status === 'active' ? -1 : 1);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Batch baglog</h2>
          <p className="text-sm text-muted-foreground">Satu batch = satu kelompok baglog yang masuk bersamaan.</p>
        </div>
        <Button className="h-12" onClick={onStart}><PackagePlus size={18} className="mr-2" />Mulai batch baru</Button>
      </div>

      {!sorted.length && <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Belum ada batch di kumbung ini.</CardContent></Card>}

      {sorted.map(batch => {
        const phase = phaseInfo(batch.growthStage);
        const active = batch.status === 'active';
        const days = active ? batchDay(batch) : batch.endedAt ? batchDay(batch, batch.endedAt) : null;
        return (
          <Card key={batch.id} className={active ? 'border-emerald-500/40 shadow-sm' : 'shadow-sm'}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold leading-snug">{batchLabel(batch)}</p>
                  <p className="text-sm text-muted-foreground">{batch.mushroomType || 'tiram'} · {SUBSTRATE_LABELS[batch.substrateType] || batch.substrateType}{batch.spawnSource ? ` · ${batch.spawnSource}` : ''}</p>
                </div>
                <Badge className={`shrink-0 ${STATUS_STYLE[batch.status] || ''}`}>{active ? phase.title : batch.status === 'cancelled' ? 'Afkir' : STATUS_LABELS[batch.status]}</Badge>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">{active ? 'Hari ke' : 'Lama'}</dt><dd className="font-semibold">{days ? (active ? days : `${days} hari`) : '—'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Baglog aktif</dt><dd className="font-semibold">{batch.baglogCountActive.toLocaleString('id-ID')}/{batch.baglogCountInitial.toLocaleString('id-ID')}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Kontaminasi</dt><dd className="font-semibold">{batch.contaminationPct}%</dd></div>
              </dl>
              <div className="flex flex-wrap gap-2">
                {active && phase.next && phase.id !== 'harvesting' && phase.id !== 'completed' && (
                  <Button variant="outline" className="h-11" onClick={() => onAdvance(batch)}>Pindah tahap<ArrowRight size={15} className="ml-1" /></Button>
                )}
                {active && isOwner && <Button variant="outline" className="h-11" onClick={() => onClose(batch)}><Square size={14} className="mr-1" />Tutup batch</Button>}
                {isOwner && <Button variant="ghost" className="h-11" onClick={() => onEdit(batch)}><Pencil size={14} className="mr-1" />Ubah</Button>}
                <Button variant="ghost" className="h-11" onClick={() => onRecap(batch)}><FileBarChart size={14} className="mr-1" />Rekap</Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
