import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** { value, unit } ↔ detik. */
export const splitDuration = sec => (sec >= 60 && sec % 60 === 0 ? { value: String(sec / 60), unit: 'min' } : { value: String(sec), unit: 'sec' });
export const durationSeconds = ({ value, unit }) => Math.round(Number(value) * (unit === 'min' ? 60 : 1));

/** Input durasi dengan satuan detik/menit. `duration` = { value, unit }. */
export default function DurationInput({ id, label, duration, onChange, hint }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <div className="flex gap-1.5">
        <Input id={id} type="number" min={1} step="any" value={duration.value}
          onChange={event => onChange({ ...duration, value: event.target.value })} className="h-9 w-24" />
        <Select value={duration.unit} onValueChange={unit => onChange({ ...duration, unit })}>
          <SelectTrigger className="h-9 w-24" aria-label={`Satuan ${label}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sec">detik</SelectItem>
            <SelectItem value="min">menit</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
