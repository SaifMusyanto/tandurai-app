import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { ChoiceButton, FieldBlock } from '@/components/operations/controls';
import { FREQUENCIES, SECTIONS, WEEKDAYS, describeSchedule, hourLabel } from './reportOptions';

const selectClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-base';
const initialForm = schedule => (schedule ? {
  name: schedule.name, frequency: schedule.frequency, sendHour: schedule.sendHour, weekday: schedule.weekday || 1, monthDay: schedule.monthDay || 1,
  kumbungIds: schedule.kumbungIds, sections: schedule.sections, attachExcel: schedule.attachExcel,
} : { name: 'Laporan mingguan', frequency: 'weekly', sendHour: 7, weekday: 1, monthDay: 1, kumbungIds: [], sections: SECTIONS.map(item => item.id), attachExcel: true });

/** Tambah / ubah jadwal laporan otomatis ke Telegram farm (owner). */
export default function ReportScheduleDialog({ open, schedule, farm, kumbungs, onClose, onSaved }) {
  const [form, setForm] = useState(initialForm(schedule));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(initialForm(schedule)); }, [open, schedule]);
  const set = changes => setForm(current => ({ ...current, ...changes }));
  const toggle = (key, value) => set({ [key]: form[key].includes(value) ? form[key].filter(item => item !== value) : [...form[key], value] });

  const submit = async () => {
    setSaving(true);
    try {
      const input = { ...form, name: form.name.trim() };
      if (schedule) await api.updateReportSchedule(schedule.id, input);
      else await api.createReportSchedule(farm.id, input);
      toast.success(schedule ? 'Jadwal laporan diperbarui' : 'Jadwal laporan dibuat');
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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{schedule ? 'Ubah jadwal laporan' : 'Jadwal laporan baru'}</DialogTitle>
          <DialogDescription>Laporan dikirim otomatis ke Telegram farm {farm?.name}. {describeSchedule(form)}.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FieldBlock label="Nama laporan" htmlFor="report-name">
            <Input id="report-name" value={form.name} maxLength={100} onChange={event => set({ name: event.target.value })} className="h-11 text-base" />
          </FieldBlock>

          <FieldBlock label="Seberapa sering?">
            <div className="grid grid-cols-3 gap-2">
              {FREQUENCIES.map(item => (
                <ChoiceButton key={item.id} selected={form.frequency === item.id} onClick={() => set({ frequency: item.id })}>
                  <span>{item.label}</span><span className="block text-xs font-normal text-muted-foreground">{item.period}</span>
                </ChoiceButton>
              ))}
            </div>
          </FieldBlock>

          <div className="grid grid-cols-2 gap-3">
            {form.frequency === 'weekly' && (
              <FieldBlock label="Hari kirim" htmlFor="report-weekday">
                <select id="report-weekday" className={selectClass} value={form.weekday} onChange={event => set({ weekday: Number(event.target.value) })}>
                  {WEEKDAYS.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}
                </select>
              </FieldBlock>
            )}
            {form.frequency === 'monthly' && (
              <FieldBlock label="Tanggal kirim" htmlFor="report-day">
                <select id="report-day" className={selectClass} value={form.monthDay} onChange={event => set({ monthDay: Number(event.target.value) })}>
                  {Array.from({ length: 28 }, (_, index) => <option key={index + 1} value={index + 1}>Tanggal {index + 1}</option>)}
                </select>
              </FieldBlock>
            )}
            <FieldBlock label="Jam kirim (WIB)" htmlFor="report-hour">
              <select id="report-hour" className={selectClass} value={form.sendHour} onChange={event => set({ sendHour: Number(event.target.value) })}>
                {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
              </select>
            </FieldBlock>
          </div>

          <FieldBlock label="Kumbung" hint="Tanpa pilihan = semua kumbung aktif, termasuk kumbung baru.">
            <div className="flex flex-wrap gap-2">
              <ChoiceButton selected={!form.kumbungIds.length} onClick={() => set({ kumbungIds: [] })} className="w-auto">Semua kumbung</ChoiceButton>
              {kumbungs.map(item => (
                <ChoiceButton key={item.id} selected={form.kumbungIds.includes(item.id)} onClick={() => toggle('kumbungIds', item.id)} className="w-auto">{item.name || item.id}</ChoiceButton>
              ))}
            </div>
          </FieldBlock>

          <FieldBlock label="Isi laporan">
            <div className="grid gap-2 sm:grid-cols-2">
              {SECTIONS.map(item => (
                <ChoiceButton key={item.id} selected={form.sections.includes(item.id)} onClick={() => toggle('sections', item.id)}>
                  <span>{item.label}</span><span className="block text-xs font-normal text-muted-foreground">{item.hint}</span>
                </ChoiceButton>
              ))}
            </div>
          </FieldBlock>

          <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <span className="text-sm"><span className="font-medium">Lampirkan file Excel</span><span className="block text-xs text-muted-foreground">Data lengkap: ringkasan, parameter harian, kegiatan & panen</span></span>
            <Switch checked={form.attachExcel} onCheckedChange={value => set({ attachExcel: value })} />
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11" onClick={onClose}>Batal</Button>
          <Button className="h-11" onClick={submit} disabled={saving || !form.name.trim() || !form.sections.length}>
            {saving && <Loader2 size={16} className="mr-2 animate-spin" />}{schedule ? 'Simpan' : 'Buat jadwal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
