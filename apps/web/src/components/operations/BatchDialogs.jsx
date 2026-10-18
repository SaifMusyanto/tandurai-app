import React, { useEffect, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { saveBatch } from '@/lib/operationsService';
import { batchDay, batchLabel, formatKg, nextPhase, phaseInfo } from '@/lib/operationsView';
import { ChoiceButton, FieldBlock } from './controls';

/** Konfirmasi pindah ke tahap berikutnya (tercatat otomatis di rekap). */
export function PhaseAdvanceDialog({ batch, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  if (!batch) return null;
  const current = phaseInfo(batch.growthStage);
  const next = nextPhase(batch.growthStage);

  const submit = async () => {
    setSaving(true);
    try {
      await saveBatch(batch.id, { growthStage: next.id });
      toast.success(`Tahap sekarang: ${next.title}`);
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={value => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Pindah tahap?</DialogTitle>
          <DialogDescription className="text-sm">{batchLabel(batch)}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-4 text-base">
          <span className="font-semibold">{current.title}</span>
          <ArrowRight className="shrink-0 text-emerald-600" />
          <span className="font-bold text-emerald-700 dark:text-emerald-400">{next.title}</span>
        </div>
        <p className="text-sm text-muted-foreground">{next.description}</p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-12" onClick={onClose}>Batal</Button>
          <Button className="h-12 text-base" onClick={submit} disabled={saving}>
            {saving && <Loader2 size={16} className="mr-2 animate-spin" />}Ya, pindah tahap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tutup batch (Selesai / Afkir) dengan ringkasan hasil satu siklus. Hanya owner. */
export function BatchCloseDialog({ batch, farmId, onClose, onSaved }) {
  const [result, setResult] = useState('completed');
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!batch) return undefined;
    let active = true;
    setResult('completed'); setNote(''); setSummary(null);
    api.recap(farmId, { batchId: batch.id, kinds: 'harvest' })
      .then(data => active && setSummary(data.summary))
      .catch(() => active && setSummary({ harvestKg: null }));
    return () => { active = false; };
  }, [batch, farmId]);

  if (!batch) return null;
  const perThousand = summary?.harvestKg != null ? (summary.harvestKg / batch.baglogCountInitial) * 1000 : null;
  const stats = [
    ['Lama siklus', `${batchDay(batch)} hari`],
    ['Total panen', summary ? (summary.harvestKg != null ? formatKg(summary.harvestKg) : '—') : '…'],
    ['Per 1.000 baglog', perThousand != null ? formatKg(perThousand) : '…'],
    ['Kontaminasi', `${batch.contaminationPct}% (${(batch.baglogCountInitial - batch.baglogCountActive).toLocaleString('id-ID')} baglog)`],
  ];

  const submit = async () => {
    setSaving(true);
    try {
      await saveBatch(batch.id, { status: result, ...(result === 'completed' ? { growthStage: 'completed' } : {}), closeNote: note.trim() });
      toast.success(result === 'completed' ? 'Batch ditutup: selesai' : 'Batch ditutup: afkir');
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Tutup batch</DialogTitle>
          <DialogDescription className="text-sm">{batchLabel(batch)}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-2">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-base font-bold">{value}</dd>
            </div>
          ))}
        </dl>
        <FieldBlock label="Hasil akhir">
          <div className="grid grid-cols-2 gap-2">
            <ChoiceButton selected={result === 'completed'} onClick={() => setResult('completed')}>Selesai</ChoiceButton>
            <ChoiceButton selected={result === 'cancelled'} onClick={() => setResult('cancelled')} tone="amber">Afkir (gagal)</ChoiceButton>
          </div>
        </FieldBlock>
        <FieldBlock label="Catatan (boleh kosong)" htmlFor="close-note">
          <Input id="close-note" value={note} maxLength={300} onChange={event => setNote(event.target.value)} className="h-12 text-base" placeholder="mis. baglog habis masa produksi" />
        </FieldBlock>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-12" onClick={onClose}>Batal</Button>
          <Button className="h-12 text-base" variant={result === 'cancelled' ? 'destructive' : 'default'} onClick={submit} disabled={saving}>
            {saving && <Loader2 size={16} className="mr-2 animate-spin" />}Tutup batch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
