import React, { useEffect, useState } from 'react';
import { AlertTriangle, ClipboardCheck, Loader2, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { TYPE_LABELS, describeRecapRow } from '@/lib/operationsView';
import { cn } from '@/lib/utils';
import { FieldBlock } from './controls';

const ACTIONS = [
  { id: 'harvest', label: 'Catat Panen', icon: Scale, className: 'bg-emerald-600 text-white hover:bg-emerald-700' },
  { id: 'care', label: 'Catat Kegiatan', icon: ClipboardCheck, className: 'bg-sky-600 text-white hover:bg-sky-700' },
  { id: 'problem', label: 'Lapor Masalah', icon: AlertTriangle, className: 'bg-amber-500 text-white hover:bg-amber-600' },
];

/**
 * Tiga aksi utama petani. Layar lebar: tiga tombol besar di halaman. HP/tablet: bar tetap di bawah
 * layar agar bisa ditekan dengan ibu jari (halaman perlu padding bawah, lihat `QUICK_BAR_SPACE`).
 * `desktop=false` menyembunyikan tombol besar di layar lebar (bar HP tetap tampil).
 */
export default function QuickActions({ onAction, disabled, desktop = true }) {
  return (
    <>
      <div className={desktop ? 'hidden gap-3 lg:grid lg:grid-cols-3' : 'hidden'}>
        {ACTIONS.map(({ id, label, icon: Icon, className }) => (
          <Button key={id} onClick={() => onAction(id)} disabled={disabled} className={cn('h-14 text-base font-semibold', className)}>
            <Icon size={20} className="mr-2" />{label}
          </Button>
        ))}
      </div>
      <nav aria-label="Aksi cepat"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 gap-2 border-t bg-background/95 px-3 pt-2 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)' }}>
        {ACTIONS.map(({ id, label, icon: Icon, className }) => (
          <button key={id} type="button" onClick={() => onAction(id)} disabled={disabled}
            className={cn('flex h-16 flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold leading-tight disabled:opacity-50', className)}>
            <Icon size={22} />{label}
          </button>
        ))}
      </nav>
    </>
  );
}

/** Ruang kosong di bawah halaman agar konten terakhir tidak tertutup bar aksi HP. */
export const QUICK_BAR_SPACE = 'pb-28 lg:pb-8';

/** Batalkan catatan kegiatan/masalah dengan alasan (riwayat tetap tersimpan). */
export function VoidDialog({ row, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setReason(''); }, [row]);
  if (!row) return null;

  const submit = async () => {
    setSaving(true);
    try {
      await api.voidActivity(row.id, reason.trim());
      toast.success(row.quantity ? `Catatan dibatalkan; ${row.quantity} baglog dikembalikan` : 'Catatan dibatalkan');
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
          <DialogTitle className="text-xl">Batalkan catatan?</DialogTitle>
          <DialogDescription className="text-sm">{TYPE_LABELS[row.type]}: {describeRecapRow(row)}</DialogDescription>
        </DialogHeader>
        <FieldBlock label="Alasan" hint="Catatan tidak dihapus, hanya ditandai batal." htmlFor="void-reason">
          <Input id="void-reason" value={reason} maxLength={300} autoFocus onChange={event => setReason(event.target.value)} className="h-12 text-base" placeholder="mis. salah input" />
        </FieldBlock>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-12" onClick={onClose}>Kembali</Button>
          <Button variant="destructive" className="h-12 text-base" onClick={submit} disabled={saving || !reason.trim()}>
            {saving && <Loader2 size={16} className="mr-2 animate-spin" />}Batalkan catatan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
