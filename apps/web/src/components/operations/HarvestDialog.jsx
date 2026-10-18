import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { auth } from '../../firebase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { buildHarvestPayload } from '@/lib/operations';
import { createHarvestEvent } from '@/lib/operationsService';
import { batchLabel, datetimeInputJakarta, formatKg } from '@/lib/operationsView';
import { ChoiceButton, FieldBlock, nowLocalInput } from './controls';

// Mutu sederhana untuk petani; grade C dan persen A ada di "Detail".
const QUICK_GRADES = [
  { id: 'A', label: 'Bagus (A)', pct: 100 },
  { id: 'B', label: 'Sedang (B)', pct: 0 },
  { id: 'mixed', label: 'Campur', pct: 50 },
];
const GRADE_PCT = { A: 100, B: 0, C: 0, mixed: 50 };

const initialForm = (batchId, event) => (event ? {
  batchId: event.batchId, weightKg: String(event.weightKg).replace('.', ','), grade: event.grade, gradeAPct: String(event.gradeAPct),
  harvestedAt: datetimeInputJakarta(event.harvestedAt), notes: event.notes || '', correctionReason: '',
} : { batchId: batchId || '', weightKg: '', grade: 'A', gradeAPct: '100', harvestedAt: nowLocalInput(), notes: '', correctionReason: '' });

/**
 * Catat panen cepat (dialog tetap terbuka untuk timbangan berikutnya) atau koreksi catatan lama
 * (`correcting` = baris panen; koreksi disimpan sebagai catatan baru, riwayat tidak dihapus).
 * `today` = { kg, count } total panen kumbung hari ini (dari rekap).
 */
export default function HarvestDialog({ open, kumbung, batches, defaultBatchId, correcting, today, onClose, onSaved }) {
  const [form, setForm] = useState(initialForm(defaultBatchId));
  const [detail, setDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(defaultBatchId, correcting));
    setDetail(Boolean(correcting));
    setLastSaved(null);
  }, [open, correcting, defaultBatchId]);

  const set = changes => setForm(current => ({ ...current, ...changes }));
  const weight = Number(String(form.weightKg).replace(',', '.'));
  const selectable = correcting ? batches.filter(item => item.id === correcting.batchId) : batches.filter(item => item.status === 'active');

  const submit = async () => {
    setSaving(true);
    try {
      const batch = batches.find(item => item.id === form.batchId);
      const payload = buildHarvestPayload({ ...form, weightKg: weight, farmId: kumbung.farmId, kumbungId: kumbung.id }, batch, auth.currentUser.uid);
      if (correcting) {
        if (!form.correctionReason.trim()) throw new Error('Alasan koreksi wajib diisi');
        await createHarvestEvent(kumbung.id, { ...payload, correctsEventId: correcting.id, correctionReason: form.correctionReason.trim().slice(0, 300) });
        toast.success('Koreksi panen disimpan');
        onSaved?.();
        onClose();
        return;
      }
      await createHarvestEvent(kumbung.id, payload);
      setLastSaved(weight);
      set({ weightKg: '', notes: '', harvestedAt: nowLocalInput() });
      onSaved?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">{correcting ? 'Koreksi catatan panen' : 'Catat panen'}</DialogTitle>
          <DialogDescription className="text-sm">
            {correcting ? 'Catatan lama tetap tersimpan; koreksi dicatat sebagai riwayat.' : `Isi angka dari timbangan. ${kumbung?.name || ''}`}
          </DialogDescription>
        </DialogHeader>

        {!correcting && (lastSaved !== null || today?.count > 0) && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
            <p>
              {lastSaved !== null && <span className="block font-semibold">{formatKg(lastSaved)} tersimpan.</span>}
              Total hari ini: <span className="font-bold">{formatKg(today?.kg)}</span> ({today?.count || 0} kali panen)
            </p>
          </div>
        )}

        <div className="space-y-4">
          {!selectable.length ? (
            <p className="rounded-xl bg-muted p-3 text-sm">Belum ada batch yang berjalan di kumbung ini. Mulai batch dulu di tab Batch.</p>
          ) : selectable.length > 1 && (
            <FieldBlock label="Batch" htmlFor="harvest-batch">
              <select id="harvest-batch" className="h-12 w-full rounded-md border border-input bg-background px-3 text-base" value={form.batchId} onChange={event => set({ batchId: event.target.value })}>
                <option value="">Pilih batch</option>
                {selectable.map(item => <option key={item.id} value={item.id}>{batchLabel(item)}</option>)}
              </select>
            </FieldBlock>
          )}

          <FieldBlock label="Berat panen" htmlFor="harvest-weight">
            <div className="relative">
              <Input id="harvest-weight" inputMode="decimal" autoFocus={!correcting} value={form.weightKg} placeholder="0"
                onChange={event => set({ weightKg: event.target.value.replace(/[^\d.,]/g, '') })}
                className="h-16 pr-14 text-3xl font-bold placeholder:font-normal placeholder:text-muted-foreground/40" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground">kg</span>
            </div>
          </FieldBlock>

          <FieldBlock label="Mutu jamur">
            <div className="grid grid-cols-3 gap-2">
              {QUICK_GRADES.map(grade => (
                <ChoiceButton key={grade.id} selected={form.grade === grade.id} onClick={() => set({ grade: grade.id, gradeAPct: String(grade.pct) })} className="justify-center px-2 text-center">
                  {grade.label}
                </ChoiceButton>
              ))}
            </div>
          </FieldBlock>

          <button type="button" className="flex items-center gap-1 text-sm text-primary" onClick={() => setDetail(value => !value)} aria-expanded={detail}>
            <ChevronDown size={15} className={detail ? 'rotate-180 transition-transform' : 'transition-transform'} />Detail (waktu, catatan, mutu lain)
          </button>
          {detail && (
            <div className="space-y-3 rounded-xl border p-3">
              <FieldBlock label="Waktu panen" htmlFor="harvest-time">
                <Input id="harvest-time" type="datetime-local" value={form.harvestedAt} onChange={event => set({ harvestedAt: event.target.value })} className="h-12 text-base" />
              </FieldBlock>
              <div className="grid grid-cols-2 gap-3">
                <FieldBlock label="Mutu" htmlFor="harvest-grade">
                  <select id="harvest-grade" className="h-12 w-full rounded-md border border-input bg-background px-3 text-base" value={form.grade}
                    onChange={event => set({ grade: event.target.value, gradeAPct: String(GRADE_PCT[event.target.value]) })}>
                    <option value="A">Bagus (A)</option><option value="B">Sedang (B)</option><option value="C">Rendah (C)</option><option value="mixed">Campur</option>
                  </select>
                </FieldBlock>
                <FieldBlock label="Bagian mutu A (%)" htmlFor="harvest-pct">
                  <Input id="harvest-pct" inputMode="numeric" value={form.gradeAPct} onChange={event => set({ gradeAPct: event.target.value.replace(/[^\d]/g, '') })} className="h-12 text-base" />
                </FieldBlock>
              </div>
              <FieldBlock label="Catatan (boleh kosong)" htmlFor="harvest-notes">
                <Input id="harvest-notes" value={form.notes} maxLength={500} onChange={event => set({ notes: event.target.value })} className="h-12 text-base" />
              </FieldBlock>
            </div>
          )}

          {correcting && (
            <FieldBlock label="Alasan koreksi" hint="Contoh: salah membaca timbangan" htmlFor="harvest-reason">
              <Input id="harvest-reason" value={form.correctionReason} maxLength={300} onChange={event => set({ correctionReason: event.target.value })} className="h-12 text-base" />
            </FieldBlock>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-12" onClick={onClose}>{lastSaved !== null ? 'Selesai' : 'Batal'}</Button>
          <Button className="h-12 text-base" onClick={submit} disabled={saving || !form.batchId || !(weight > 0) || (correcting && !form.correctionReason.trim())}>
            {saving && <Loader2 size={16} className="mr-2 animate-spin" />}{correcting ? 'Simpan koreksi' : 'Simpan panen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
