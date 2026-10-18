import React from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Kontrol besar untuk petani: area sentuh ≥ 48 px, teks ≥ 14 px, status terpilih jelas (warna + centang).

/** Tombol pilihan (toggle) besar; `selected` memberi tanda centang. */
export function ChoiceButton({ selected, onClick, children, className, tone = 'emerald' }) {
  const tones = {
    emerald: 'border-emerald-600 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300',
    amber: 'border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex min-h-12 w-full items-center gap-2 rounded-xl border-2 px-3 py-2 text-left text-sm font-medium transition-colors',
        selected ? tones[tone] : 'border-border bg-background hover:bg-muted/60',
        className,
      )}
    >
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', selected ? 'border-transparent bg-current' : 'border-muted-foreground/40')}>
        {selected && <Check size={13} className="text-background" strokeWidth={3} />}
      </span>
      <span className="leading-snug">{children}</span>
    </button>
  );
}

/** Angka dengan tombol − / + besar (mis. jumlah baglog dibuang). */
export function Stepper({ value, onChange, min = 0, max = 1_000_000, step = 1, label }) {
  const number = Number(value) || 0;
  const set = next => onChange(String(Math.min(max, Math.max(min, next))));
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" className="h-12 w-12 shrink-0 text-lg" onClick={() => set(number - step)} disabled={number <= min} aria-label={`Kurangi ${label}`}>
        <Minus size={18} />
      </Button>
      <Input
        inputMode="numeric"
        value={value}
        onChange={event => onChange(event.target.value.replace(/[^\d]/g, ''))}
        className="h-12 text-center text-xl font-bold"
        aria-label={label}
      />
      <Button type="button" variant="outline" className="h-12 w-12 shrink-0 text-lg" onClick={() => set(number + step)} disabled={number >= max} aria-label={`Tambah ${label}`}>
        <Plus size={18} />
      </Button>
    </div>
  );
}

/** Label + isi form dengan teks bantuan opsional. */
export function FieldBlock({ label, hint, children, htmlFor }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Waktu "sekarang" (WIB) untuk input datetime-local, dan konversi baliknya. */
export const nowLocalInput = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16);
export const localInputToMs = value => Date.parse(`${value}:00+07:00`);
