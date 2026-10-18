import React, { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Pencil, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DurationInput, { durationSeconds, splitDuration } from '@/components/iot/DurationInput';
import DataTable from '@/components/DataTable';
import { useIot } from '@/contexts/IotContext';
import { DAY_SHORT, MODE_LABEL, daysLabel, describeSchedule, formatDuration, nextMode } from '@/lib/iot';

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const emptyForm = actuatorId => ({
  actuatorId, type: 'at', at: '07:00', every: '60', start: '', end: '', on: { value: '5', unit: 'min' }, days: ALL_DAYS,
});

/** Simpan daftar jadwal baru satu aktuator; mode menyesuaikan (lihat modeAfterSchedules). */
function useSaveSchedules() {
  const { saveConfig } = useIot();
  return (actuator, schedules, activate = false) => saveConfig(actuator.id, { mode: nextMode(actuator, { schedules, activate: activate ? 'timer' : null }), schedules });
}

function ScheduleDialog({ open, items, editing, onClose }) {
  const saveSchedules = useSaveSchedules();
  const [form, setForm] = useState(emptyForm(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      const { schedule, actuator } = editing;
      const [start = '', end = ''] = schedule.window?.split('-') || [];
      setForm({
        actuatorId: actuator.id, type: schedule.type, at: schedule.at || '07:00',
        every: String(Math.round((schedule.intervalSec || 3600) / 60)), start, end,
        on: splitDuration(schedule.onSec), days: schedule.days || ALL_DAYS,
      });
    } else {
      setForm(emptyForm(items[0]?.actuator.id || ''));
    }
    // Isi form hanya saat dialog dibuka/target berganti. Daftar aktuator berubah tiap detik
    // (hitung mundur, telemetry); mengikutinya akan mereset isian yang sedang diedit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const target = items.find(item => item.actuator.id === form.actuatorId);
  const set = changes => setForm(current => ({ ...current, ...changes }));
  const toggleDay = day => set({ days: form.days.includes(day) ? form.days.filter(item => item !== day) : [...form.days, day] });

  const submit = async event => {
    event.preventDefault();
    if (!target) return;
    if ((form.start && !form.end) || (!form.start && form.end)) {
      setError('Isi jam mulai dan selesai, atau kosongkan keduanya.');
      return;
    }
    const schedule = {
      ...(editing ? { id: editing.schedule.id } : {}),
      type: form.type,
      enabled: editing ? editing.schedule.enabled : true,
      days: [...form.days].sort((a, b) => a - b),
      onSec: durationSeconds(form.on),
      ...(form.type === 'at'
        ? { at: form.at }
        : { intervalSec: Math.round(Number(form.every) * 60), window: form.start && form.end ? `${form.start}-${form.end}` : null }),
    };
    const { actuator } = target;
    const schedules = editing
      ? actuator.schedules.map(item => (item.id === editing.schedule.id ? schedule : item))
      : [...actuator.schedules, schedule];
    setBusy(true);
    setError('');
    try {
      await saveSchedules(actuator, schedules, !editing);
      toast.success(`Jadwal ${actuator.name} disimpan dan dikirim ke gateway.`);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={value => !value && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Ubah jadwal' : 'Tambah jadwal'}</DialogTitle>
          <DialogDescription>Jadwal dijalankan gateway, tetap berjalan walau internet terputus.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Aktuator</Label>
              <Select value={form.actuatorId} onValueChange={actuatorId => set({ actuatorId })} disabled={Boolean(editing)}>
                <SelectTrigger className="h-9" aria-label="Aktuator"><SelectValue placeholder="Pilih aktuator" /></SelectTrigger>
                <SelectContent>{items.map(({ actuator }) => <SelectItem key={actuator.id} value={actuator.id}>{actuator.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Jenis jadwal</Label>
              <Select value={form.type} onValueChange={type => set({ type })}>
                <SelectTrigger className="h-9" aria-label="Jenis jadwal"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="at">Pada jam tertentu</SelectItem>
                  <SelectItem value="every">Berulang tiap beberapa menit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.type === 'at' ? (
            <div className="flex flex-wrap items-start gap-3">
              <div className="space-y-1">
                <Label htmlFor="schedule-at" className="text-xs">Jam</Label>
                <Input id="schedule-at" type="time" value={form.at} onChange={event => set({ at: event.target.value })} className="h-9 w-32" required />
              </div>
              <DurationInput id="schedule-on" label="Nyala selama" duration={form.on} onChange={on => set({ on })} hint={target ? `maks ${formatDuration(target.actuator.maxRunSec)}` : ''} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="space-y-1">
                  <Label htmlFor="schedule-every" className="text-xs">Setiap (menit)</Label>
                  <Input id="schedule-every" type="number" min={1} value={form.every} onChange={event => set({ every: event.target.value })} className="h-9 w-24" required />
                </div>
                <DurationInput id="schedule-on" label="Nyala selama" duration={form.on} onChange={on => set({ on })} hint={target ? `maks ${formatDuration(target.actuator.maxRunSec)}` : ''} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="schedule-start" className="text-xs">Hanya antara jam (opsional)</Label>
                <div className="flex items-center gap-1.5">
                  <Input id="schedule-start" type="time" value={form.start} onChange={event => set({ start: event.target.value })} className="h-9 w-32" aria-label="Jam mulai" />
                  <span className="text-xs">–</span>
                  <Input type="time" value={form.end} onChange={event => set({ end: event.target.value })} className="h-9 w-32" aria-label="Jam selesai" />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Hari</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_DAYS.map(day => (
                <Button key={day} type="button" size="sm" variant={form.days.includes(day) ? 'default' : 'outline'} className="h-8 w-11 px-0"
                  aria-pressed={form.days.includes(day)} onClick={() => toggleDay(day)}>{DAY_SHORT[day]}</Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{form.days.length ? daysLabel(form.days) : 'Pilih minimal satu hari.'}</p>
          </div>

          {target?.actuator.mode === 'auto' && !editing && (
            <p className="text-xs rounded-md bg-yellow-500/10 text-yellow-800 dark:text-yellow-300 px-3 py-2">
              {target.actuator.name} sedang mengikuti aturan Otomatis. Menyimpan jadwal ini memindahkannya ke mode Jadwal (aturan tetap tersimpan tapi tertahan).
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
            <Button type="submit" disabled={busy || !target || !form.days.length}>
              {busy && <Loader2 size={14} className="mr-1.5 animate-spin" />}Simpan jadwal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Bagian 2 — daftar jadwal semua aktuator kumbung; tambah, ubah, aktif/nonaktif, hapus. */
export default function ScheduleSection({ items }) {
  const saveSchedules = useSaveSchedules();
  const [dialog, setDialog] = useState({ open: false, editing: null });
  const [busy, setBusy] = useState('');

  const rows = items.flatMap(({ actuator, gateway }) => (actuator.schedules || []).map(schedule => ({ schedule, actuator, gateway })))
    .sort((a, b) => (a.schedule.at || '99').localeCompare(b.schedule.at || '99') || a.actuator.name.localeCompare(b.actuator.name));

  const update = async (key, actuator, schedules, message, activate = false) => {
    setBusy(key);
    try {
      await saveSchedules(actuator, schedules, activate);
      toast.success(message);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2"><CalendarClock size={20} className="text-primary" />Jadwal</CardTitle>
            <CardDescription>Nyalakan aktuator pada jam tertentu atau berulang. Satu aktuator boleh punya beberapa jadwal.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setDialog({ open: true, editing: null })} disabled={!items.length}><Plus size={14} className="mr-1" />Tambah jadwal</Button>
        </div>
      </CardHeader>
      <CardContent>
        <DataTable
          rows={rows}
          rowKey={({ schedule, actuator }) => `${actuator.id}-${schedule.id}`}
          emptyText="Belum ada jadwal. Klik “Tambah jadwal”, pilih aktuator, lalu atur jam dan lama nyala."
          columns={[
            {
              key: 'enabled', header: 'Aktif', cell: ({ schedule, actuator }) => (
                <Switch checked={schedule.enabled} disabled={Boolean(busy)} aria-label={`Aktifkan jadwal ${describeSchedule(schedule)}`}
                  onCheckedChange={enabled => update(`${actuator.id}-${schedule.id}`, actuator, actuator.schedules.map(item => (item.id === schedule.id ? { ...item, enabled } : item)),
                    enabled ? 'Jadwal diaktifkan.' : 'Jadwal dinonaktifkan.', enabled)} />
              ),
            },
            { key: 'schedule', header: 'Jadwal', className: 'font-medium', cell: ({ schedule }) => describeSchedule(schedule) },
            { key: 'actuator', hideOnMobile: true, header: 'Aktuator', cell: ({ actuator }) => actuator.name },
            { key: 'days', hideOnMobile: true, header: 'Hari', className: 'text-xs', cell: ({ schedule }) => daysLabel(schedule.days) },
            {
              key: 'status', hideOnMobile: true, header: 'Status', className: 'text-xs', cell: ({ schedule, actuator, gateway }) => (
                actuator.state === 'on' && actuator.stateSource === 'timer' && actuator.stateTrigger?.schedule === schedule.id
                  ? <Badge className="bg-green-600 hover:bg-green-600"><span className="mr-1 h-1.5 w-1.5 rounded-full bg-white animate-pulse" />Sedang menyalakan</Badge>
                  : !schedule.enabled ? <span className="text-muted-foreground">Nonaktif</span>
                    : actuator.mode !== 'timer' ? <span className="text-yellow-700 dark:text-yellow-400">Tertahan ({MODE_LABEL[actuator.mode]} aktif)</span>
                      : actuator.pendingSync ? <span className="text-yellow-700 dark:text-yellow-400 flex items-center gap-1"><RefreshCcw size={11} className="animate-spin" />{gateway.online ? 'mengirim ke gateway…' : 'menunggu gateway online'}</span>
                        : <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">Berjalan</Badge>
              ),
            },
            {
              key: 'actions', header: <span className="sr-only">Aksi</span>, className: 'text-right whitespace-nowrap', cell: ({ schedule, actuator }) => {
                const key = `${actuator.id}-${schedule.id}`;
                return (
                  <>
                    <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Ubah jadwal" onClick={() => setDialog({ open: true, editing: { schedule, actuator } })}><Pencil size={14} /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-600" aria-label="Hapus jadwal" disabled={Boolean(busy)}
                      onClick={() => update(key, actuator, actuator.schedules.filter(item => item.id !== schedule.id), 'Jadwal dihapus.')}>
                      {busy === key ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </Button>
                  </>
                );
              },
            },
          ]}
        />
      </CardContent>
      <ScheduleDialog open={dialog.open} editing={dialog.editing} items={items} onClose={() => setDialog({ open: false, editing: null })} />
    </Card>
  );
}
