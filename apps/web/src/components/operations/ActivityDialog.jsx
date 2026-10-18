import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { CARE_OPTIONS, PROBLEM_OPTIONS, batchLabel } from '@/lib/operationsView';
import { ChoiceButton, FieldBlock, Stepper, localInputToMs, nowLocalInput } from './controls';

const COPY = {
  care: { title: 'Catat kegiatan', description: 'Pilih pekerjaan yang sudah dilakukan. Boleh lebih dari satu.', options: CARE_OPTIONS, tone: 'emerald', done: 'Kegiatan dicatat' },
  problem: { title: 'Laporkan masalah', description: 'Pilih masalah yang ditemukan di kumbung.', options: PROBLEM_OPTIONS, tone: 'amber', done: 'Masalah dilaporkan' },
};

/**
 * Catat kegiatan harian (mode "care") atau laporkan masalah (mode "problem") dengan sekali tekan.
 * Baglog kontaminasi: jumlah lewat stepper; backend mengurangi baglog aktif batch berjalan.
 */
export default function ActivityDialog({ open, mode = 'care', kumbung, batch, onClose, onSaved }) {
  const copy = COPY[mode];
  const [items, setItems] = useState([]);
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [time, setTime] = useState(nowLocalInput());
  const [editTime, setEditTime] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems([]); setQuantity('1'); setNotes(''); setTime(nowLocalInput()); setEditTime(false);
  }, [open, mode]);

  const toggle = id => setItems(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));
  const contamination = mode === 'problem' && items.includes('contamination');
  const maxBaglog = batch?.status === 'active' ? batch.baglogCountActive : 0;

  const submit = async () => {
    setSaving(true);
    try {
      await api.createActivity(kumbung.id, {
        type: mode, items, notes: notes.trim(),
        occurredAt: editTime ? localInputToMs(time) : undefined,
        ...(contamination ? { quantity: Number(quantity) || 0 } : {}),
      });
      toast.success(copy.done);
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
          <DialogTitle className="text-xl">{copy.title}</DialogTitle>
          <DialogDescription className="text-sm">{copy.description} {kumbung?.name}{batch?.status === 'active' ? ` · ${batchLabel(batch)}` : ''}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {copy.options.map(option => (
              <ChoiceButton key={option.id} selected={items.includes(option.id)} onClick={() => toggle(option.id)} tone={copy.tone}>
                {option.label}
              </ChoiceButton>
            ))}
          </div>

          {contamination && (
            <FieldBlock label="Berapa baglog yang dibuang?" hint={maxBaglog ? `Baglog aktif sekarang ${maxBaglog.toLocaleString('id-ID')}. Jumlah ini akan dikurangi otomatis.` : 'Belum ada batch berjalan; jumlah baglog tidak bisa dicatat.'}>
              <Stepper value={quantity} onChange={setQuantity} min={maxBaglog ? 1 : 0} max={maxBaglog || 0} label="jumlah baglog" />
            </FieldBlock>
          )}

          <FieldBlock label="Catatan (boleh kosong)" htmlFor="activity-notes">
            <Input id="activity-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={300} className="h-12 text-base"
              placeholder={mode === 'problem' ? 'mis. jamur hijau di rak 2' : 'mis. 3 kali pengkabutan'} />
          </FieldBlock>

          {editTime ? (
            <FieldBlock label="Waktu kegiatan" htmlFor="activity-time">
              <Input id="activity-time" type="datetime-local" value={time} onChange={event => setTime(event.target.value)} className="h-12 text-base" />
            </FieldBlock>
          ) : (
            <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditTime(true)}>
              Waktu: sekarang · ubah waktu
            </button>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-12" onClick={onClose}>Batal</Button>
          <Button className="h-12 text-base" onClick={submit} disabled={saving || !items.length || (contamination && !(Number(quantity) > 0 && Number(quantity) <= maxBaglog))}>
            {saving && <Loader2 size={16} className="mr-2 animate-spin" />}Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
