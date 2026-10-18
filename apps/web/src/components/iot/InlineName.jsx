import React, { useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Nama yang bisa diubah di tempat (pensil → input → simpan). `onSave(name)` mengembalikan promise. */
export default function InlineName({ value, onSave, canEdit = false, className = 'font-medium', label = 'nama' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        {value}
        {canEdit && (
          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" aria-label={`Ubah ${label}`}
            onClick={() => { setDraft(value); setEditing(true); }}>
            <Pencil size={12} />
          </Button>
        )}
      </span>
    );
  }

  const save = async event => {
    event.preventDefault();
    const name = draft.trim();
    if (!name || name === value) { setEditing(false); return; }
    setBusy(true);
    try {
      await onSave(name);
      setEditing(false);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="inline-flex items-center gap-1">
      <Input value={draft} onChange={event => setDraft(event.target.value)} maxLength={100} className="h-7 w-44 text-sm" autoFocus aria-label={label}
        onKeyDown={event => event.key === 'Escape' && setEditing(false)} />
      <Button type="submit" size="icon" variant="ghost" className="h-7 w-7" disabled={busy} aria-label="Simpan">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(false)} aria-label="Batal"><X size={13} /></Button>
    </form>
  );
}
