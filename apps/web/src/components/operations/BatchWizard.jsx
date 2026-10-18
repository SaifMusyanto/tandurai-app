import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { auth } from '../../firebase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { buildBatchPayload, SUBSTRATE_TYPES } from '@/lib/operations';
import { createBatch, saveBatch } from '@/lib/operationsService';
import { SUBSTRATE_LABELS, batchLabel, dateInputJakarta, todayJakarta } from '@/lib/operationsView';
import { ChoiceButton, FieldBlock } from './controls';

// Tahap awal yang umum: bibit baru diinokulasi, baglog jadi (sedang inkubasi), atau langsung dibuka.
const START_STAGES = [
  { id: 'inoculation', label: 'Baru inokulasi (bibit baru masuk)' },
  { id: 'incubation', label: 'Baglog jadi, masih inkubasi' },
  { id: 'fruiting', label: 'Baglog sudah dibuka' },
];

const initialForm = (capacity, batch) => (batch ? {
  startedDate: dateInputJakarta(batch.startedAt), baglogCountInitial: String(batch.baglogCountInitial), baglogCountActive: String(batch.baglogCountActive),
  growthStage: batch.growthStage, substrateType: batch.substrateType, mushroomType: batch.mushroomType || 'tiram',
  spawnSource: batch.spawnSource || '', notes: batch.notes || '',
} : {
  startedDate: todayJakarta(), baglogCountInitial: String(capacity || 1000), baglogCountActive: '',
  growthStage: 'inoculation', substrateType: 'serbuk-kayu', mushroomType: 'tiram putih', spawnSource: '', notes: '',
});

/**
 * Mulai batch (2 langkah) atau ubah data batch (`batch`). Form hanya direset saat dialog dibuka
 * (bukan saat objek kumbung diperbarui realtime), jadi isian tidak hilang.
 */
export default function BatchWizard({ open, kumbung, defaultCapacity, batch, onClose, onSaved }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initialForm(defaultCapacity, batch));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setForm(initialForm(defaultCapacity, batch));
  }, [open, defaultCapacity, batch]);

  const set = changes => setForm(current => ({ ...current, ...changes }));
  const initial = Number(form.baglogCountInitial) || 0;
  const active = batch ? Number(form.baglogCountActive) || 0 : initial;
  const stepOneValid = initial > 0 && form.startedDate && (!batch || (active >= 0 && active <= initial));

  const submit = async () => {
    setSaving(true);
    try {
      const built = buildBatchPayload({
        farmId: kumbung.farmId, kumbungId: kumbung.id, startedDate: form.startedDate,
        baglogCountInitial: initial, baglogCountActive: active, substrateType: form.substrateType, growthStage: form.growthStage,
        contaminationPct: batch ? Math.round(((initial - active) / initial) * 1000) / 10 : 0, status: batch?.status || 'active',
      }, kumbung, auth.currentUser.uid);
      const extra = { mushroomType: form.mushroomType.trim() || 'tiram', spawnSource: form.spawnSource.trim(), notes: form.notes.trim() };
      if (batch) await saveBatch(batch.id, { ...built, ...extra });
      else await createBatch(kumbung.id, { ...built, ...extra });
      toast.success(batch ? 'Data batch diperbarui' : 'Batch baru dimulai');
      onSaved?.();
      onClose();
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
          <DialogTitle className="text-xl">{batch ? `Ubah ${batchLabel(batch)}` : 'Mulai batch baru'}</DialogTitle>
          <DialogDescription className="text-sm">Langkah {step} dari 2 · {kumbung?.name}</DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            <FieldBlock label="Jumlah baglog masuk" htmlFor="batch-initial">
              <Input id="batch-initial" inputMode="numeric" value={form.baglogCountInitial} onChange={event => set({ baglogCountInitial: event.target.value.replace(/[^\d]/g, '') })} className="h-14 text-2xl font-bold" />
            </FieldBlock>
            {batch && (
              <FieldBlock label="Baglog yang masih aktif" hint="Baglog yang dibuang sebaiknya dicatat lewat “Laporkan masalah”." htmlFor="batch-active">
                <Input id="batch-active" inputMode="numeric" value={form.baglogCountActive} onChange={event => set({ baglogCountActive: event.target.value.replace(/[^\d]/g, '') })} className="h-12 text-lg" />
              </FieldBlock>
            )}
            <FieldBlock label="Tanggal baglog masuk" htmlFor="batch-date">
              <Input id="batch-date" type="date" value={form.startedDate} max={todayJakarta()} onChange={event => set({ startedDate: event.target.value })} className="h-12 text-base" />
            </FieldBlock>
            {!batch && (
              <FieldBlock label="Kondisi baglog saat masuk">
                <div className="grid gap-2">
                  {START_STAGES.map(stage => (
                    <ChoiceButton key={stage.id} selected={form.growthStage === stage.id} onClick={() => set({ growthStage: stage.id })}>{stage.label}</ChoiceButton>
                  ))}
                </div>
              </FieldBlock>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Semua isian di langkah ini boleh dilewati.</p>
            <FieldBlock label="Jenis jamur" htmlFor="batch-type">
              <Input id="batch-type" value={form.mushroomType} maxLength={60} onChange={event => set({ mushroomType: event.target.value })} className="h-12 text-base" />
            </FieldBlock>
            <FieldBlock label="Media baglog">
              <div className="grid grid-cols-2 gap-2">
                {SUBSTRATE_TYPES.map(type => (
                  <ChoiceButton key={type} selected={form.substrateType === type} onClick={() => set({ substrateType: type })}>{SUBSTRATE_LABELS[type]}</ChoiceButton>
                ))}
              </div>
            </FieldBlock>
            <FieldBlock label="Asal bibit / baglog" htmlFor="batch-source">
              <Input id="batch-source" value={form.spawnSource} maxLength={100} placeholder="mis. Pak Budi, Lawang" onChange={event => set({ spawnSource: event.target.value })} className="h-12 text-base" />
            </FieldBlock>
            <FieldBlock label="Catatan" htmlFor="batch-notes">
              <Input id="batch-notes" value={form.notes} maxLength={300} onChange={event => set({ notes: event.target.value })} className="h-12 text-base" />
            </FieldBlock>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === 1 ? (
            <>
              <Button variant="outline" className="h-12" onClick={onClose}>Batal</Button>
              <Button className="h-12 text-base" disabled={!stepOneValid} onClick={() => setStep(2)}>Lanjut<ArrowRight size={16} className="ml-2" /></Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="h-12" onClick={() => setStep(1)}><ArrowLeft size={16} className="mr-2" />Kembali</Button>
              <Button className="h-12 text-base" disabled={saving} onClick={submit}>
                {saving && <Loader2 size={16} className="mr-2 animate-spin" />}{batch ? 'Simpan perubahan' : 'Mulai batch'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
