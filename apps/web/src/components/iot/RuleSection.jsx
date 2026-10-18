import React, { useEffect, useState } from 'react';
import { Gauge, Loader2, Pencil, Plus, RefreshCcw, Trash2, Cpu } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DurationInput, { durationSeconds, splitDuration } from '@/components/iot/DurationInput';
import { useIot } from '@/contexts/IotContext';
import { METRIC_LABEL, METRIC_UNIT, MODE_LABEL, describeRule, formatDuration, nextMode } from '@/lib/iot';
import { PARAMETER_KEYS } from '@/lib/parameters';
import DataTable from '@/components/DataTable';

const isFiring = (rule, actuator) => actuator.state === 'on' && actuator.stateSource === 'auto' && actuator.stateTrigger?.rule === rule.id;

// Saran angka awal per parameter: [pemicu, normal] untuk kondisi "di bawah".
const SUGGESTED = { humidity: [85, 90], temperature: [24, 26], co2: [1000, 800], substrateMoisture: [60, 70] };

// Hanya parameter resmi (suhu, kelembapan, CO₂) yang bisa dipakai aturan.
const optionsOf = gateway => gateway.sensors.flatMap(sensor => sensor.metrics
  .filter(metric => PARAMETER_KEYS.includes(metric))
  .map(metric => ({ key: `${sensor.id}|${metric}`, sensor, metric })));

function suggestion(metric, operator) {
  const [low, high] = SUGGESTED[metric] || ['', ''];
  if (metric === 'co2') return operator === 'above' ? { threshold: '1000', value: '800' } : { threshold: '600', value: '800' };
  return operator === 'below' ? { threshold: String(low), value: String(high) } : { threshold: String(high), value: String(low) };
}

function RuleDialog({ open, items, editing, onClose }) {
  const { saveConfig } = useIot();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      const { rule, actuator } = editing;
      setForm({
        actuatorId: actuator.id, key: `${rule.sensorId}|${rule.metric}`, operator: rule.operator, threshold: String(rule.threshold),
        stopType: rule.stop.type, onDuration: splitDuration(rule.stop.onSec ?? 120), value: String(rule.stop.value ?? ''),
        cooldown: String(Math.round(rule.cooldownSec / 60)),
      });
    } else {
      const first = items[0];
      const option = first ? (optionsOf(first.gateway).find(item => item.metric === (first.actuator.type === 'fan' ? 'co2' : 'humidity')) || optionsOf(first.gateway)[0]) : null;
      const operator = first?.actuator.type === 'fan' ? 'above' : 'below';
      const hint = suggestion(option?.metric, operator);
      setForm({
        actuatorId: first?.actuator.id || '', key: option?.key || '', operator, threshold: hint.threshold,
        stopType: 'value', onDuration: { value: '2', unit: 'min' }, value: hint.value, cooldown: '1',
      });
    }
    // Isi form hanya saat dialog dibuka/target berganti. Daftar aktuator berubah tiap detik
    // (hitung mundur, telemetry); mengikutinya akan mereset isian yang sedang diedit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  if (!form) return null;
  const target = items.find(item => item.actuator.id === form.actuatorId);
  const options = target ? optionsOf(target.gateway) : [];
  const option = options.find(item => item.key === form.key);
  const unit = option ? METRIC_UNIT[option.metric] || '' : '';
  const set = changes => setForm(current => ({ ...current, ...changes }));

  const draft = option ? {
    ...(editing ? { id: editing.rule.id, enabled: editing.rule.enabled } : { enabled: true }),
    sensorId: option.sensor.id, metric: option.metric, operator: form.operator, threshold: Number(form.threshold),
    stop: form.stopType === 'duration' ? { type: 'duration', onSec: durationSeconds(form.onDuration) } : { type: 'value', value: Number(form.value) },
    cooldownSec: Math.round(Number(form.cooldown) * 60),
  } : null;

  const submit = async event => {
    event.preventDefault();
    if (!target || !draft) return;
    const { actuator } = target;
    const rules = editing
      ? actuator.rules.map(item => (item.id === editing.rule.id ? draft : item))
      : [...(actuator.rules || []), draft];
    setBusy(true);
    setError('');
    try {
      await saveConfig(actuator.id, { mode: nextMode(actuator, { rules, activate: editing ? null : 'auto' }), rules });
      toast.success(`Aturan ${actuator.name} disimpan dan dikirim ke gateway.`);
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
          <DialogTitle>{editing ? 'Ubah aturan otomatis' : 'Tambah aturan otomatis'}</DialogTitle>
          <DialogDescription>Aturan disimpan di memori gateway (NVS) dan dijalankan langsung oleh gateway — tanpa menunggu internet atau server.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-1">
            <Label className="text-xs">1. Aktuator</Label>
            <Select value={form.actuatorId} disabled={Boolean(editing)} onValueChange={actuatorId => {
              const next = items.find(item => item.actuator.id === actuatorId);
              const nextOption = next ? optionsOf(next.gateway)[0] : null;
              set({ actuatorId, key: nextOption?.key || '' });
            }}>
              <SelectTrigger className="h-9" aria-label="Aktuator"><SelectValue placeholder="Pilih aktuator" /></SelectTrigger>
              <SelectContent>{items.map(({ actuator }) => <SelectItem key={actuator.id} value={actuator.id}>{actuator.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-2 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium">2. Nyalakan ketika</legend>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <div className="space-y-1">
                <Label className="text-xs">Parameter</Label>
                <Select value={form.key} onValueChange={key => {
                  const metric = options.find(item => item.key === key)?.metric;
                  set({ key, ...(() => { const hint = suggestion(metric, form.operator); return { threshold: hint.threshold, value: hint.value }; })() });
                }}>
                  <SelectTrigger className="h-9" aria-label="Parameter"><SelectValue placeholder="Pilih sensor" /></SelectTrigger>
                  <SelectContent>{options.map(item => <SelectItem key={item.key} value={item.key}>{METRIC_LABEL[item.metric] || item.metric} · {item.sensor.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Kondisi</Label>
                <Select value={form.operator} onValueChange={operator => set({ operator, ...suggestion(option?.metric, operator) })}>
                  <SelectTrigger className="h-9 w-32" aria-label="Kondisi"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="below">di bawah</SelectItem>
                    <SelectItem value="above">di atas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-threshold" className="text-xs">Angka {unit && `(${unit})`}</Label>
                <Input id="rule-threshold" type="number" step="any" value={form.threshold} onChange={event => set({ threshold: event.target.value })} className="h-9 w-28" required />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium">3. Matikan ketika</legend>
            <RadioGroup value={form.stopType} onValueChange={stopType => set({ stopType })} className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="value" id="stop-value" />
                  <Label htmlFor="stop-value" className="text-sm font-normal">Kembali normal: {METRIC_LABEL[option?.metric]?.toLowerCase() || 'nilai'} {form.operator === 'below' ? '≥' : '≤'}</Label>
                </div>
                <Input type="number" step="any" value={form.value} onChange={event => set({ value: event.target.value })} disabled={form.stopType !== 'value'}
                  className="h-9 w-28" aria-label="Nilai normal" />
                <span className="text-xs text-muted-foreground">{unit}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="duration" id="stop-duration" />
                  <Label htmlFor="stop-duration" className="text-sm font-normal">Setelah durasi</Label>
                </div>
                {form.stopType === 'duration' && (
                  <DurationInput id="rule-duration" label="Lama nyala" duration={form.onDuration} onChange={onDuration => set({ onDuration })} />
                )}
              </div>
            </RadioGroup>
            <p className="text-[11px] text-muted-foreground">Demi keamanan, aktuator tetap mati paling lama setelah {target ? formatDuration(target.actuator.maxRunSec) : 'batas maksimalnya'}.</p>
          </fieldset>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="rule-cooldown" className="text-xs">Jeda sebelum boleh menyala lagi (menit)</Label>
              <Input id="rule-cooldown" type="number" min={0} value={form.cooldown} onChange={event => set({ cooldown: event.target.value })} className="h-9 w-24" />
            </div>
          </div>

          {draft && Number.isFinite(draft.threshold) && <p className="text-xs rounded-md bg-muted px-3 py-2">Ringkasan: {describeRule(draft)}</p>}
          {target?.actuator.mode === 'timer' && !editing && (
            <p className="text-xs rounded-md bg-yellow-500/10 text-yellow-800 dark:text-yellow-300 px-3 py-2">
              {target.actuator.name} sedang mengikuti Jadwal. Menyimpan aturan ini memindahkannya ke mode Otomatis (jadwal tetap tersimpan tapi tertahan).
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
            <Button type="submit" disabled={busy || !draft}>{busy && <Loader2 size={14} className="mr-1.5 animate-spin" />}Simpan aturan</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Bagian 3 — aturan otomatis: tambah, ubah, aktif/nonaktif, hapus. */
export default function RuleSection({ items }) {
  const { saveConfig } = useIot();
  const [dialog, setDialog] = useState({ open: false, editing: null });
  const [busy, setBusy] = useState('');

  const rows = items.flatMap(({ actuator, gateway }) => (actuator.rules || []).map(rule => ({ rule, actuator, gateway })));
  const usable = items.filter(({ gateway }) => optionsOf(gateway).length);

  const update = async (key, actuator, rules, message, activate = null) => {
    setBusy(key);
    try {
      await saveConfig(actuator.id, { mode: nextMode(actuator, { rules, activate }), rules });
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
            <CardTitle className="text-lg flex items-center gap-2"><Gauge size={20} className="text-primary" />Otomatis</CardTitle>
            <CardDescription className="flex items-center gap-1"><Cpu size={12} />Aturan dijalankan gateway dari memorinya sendiri, jadi aktuator merespons tanpa jeda internet.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setDialog({ open: true, editing: null })} disabled={!usable.length}><Plus size={14} className="mr-1" />Tambah aturan</Button>
        </div>
      </CardHeader>
      <CardContent>
        <DataTable
          rows={rows}
          rowKey={({ rule, actuator }) => `${actuator.id}-${rule.id}`}
          rowClassName={({ rule, actuator }) => (isFiring(rule, actuator) ? 'bg-green-500/5' : undefined)}
          emptyText="Belum ada aturan. Klik “Tambah aturan”, pilih aktuator, lalu atur kapan menyala dan kapan mati."
          columns={[
            {
              key: 'enabled', header: 'Aktif', cell: ({ rule, actuator }) => (
                <Switch checked={rule.enabled} disabled={Boolean(busy)} aria-label="Aktifkan aturan"
                  onCheckedChange={enabled => update(`${actuator.id}-${rule.id}`, actuator, actuator.rules.map(item => (item.id === rule.id ? { ...item, enabled } : item)),
                    enabled ? 'Aturan diaktifkan.' : 'Aturan dinonaktifkan.', enabled ? 'auto' : null)} />
              ),
            },
            {
              key: 'rule', header: 'Aturan', cell: ({ rule }) => (
                <>
                  <p className="font-medium">{describeRule(rule)}</p>
                  <p className="text-[11px] text-muted-foreground">Jeda {formatDuration(rule.cooldownSec)} sebelum boleh menyala lagi</p>
                </>
              ),
            },
            { key: 'actuator', hideOnMobile: true, header: 'Aktuator', cell: ({ actuator }) => actuator.name },
            {
              key: 'status', hideOnMobile: true, header: 'Status', className: 'text-xs', cell: ({ rule, actuator, gateway }) => (
                isFiring(rule, actuator) ? <Badge className="bg-green-600 hover:bg-green-600"><span className="mr-1 h-1.5 w-1.5 rounded-full bg-white animate-pulse" />Sedang menyalakan</Badge>
                  : !rule.enabled ? <span className="text-muted-foreground">Nonaktif</span>
                    : actuator.mode !== 'auto' ? <span className="text-yellow-700 dark:text-yellow-400">Tertahan ({MODE_LABEL[actuator.mode]} aktif)</span>
                      : actuator.pendingSync ? <span className="text-yellow-700 dark:text-yellow-400 flex items-center gap-1"><RefreshCcw size={11} className="animate-spin" />{gateway.online ? 'mengirim ke gateway…' : 'menunggu gateway online'}</span>
                        : <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">Siaga</Badge>
              ),
            },
            {
              key: 'actions', header: <span className="sr-only">Aksi</span>, className: 'text-right whitespace-nowrap', cell: ({ rule, actuator }) => {
                const key = `${actuator.id}-${rule.id}`;
                return (
                  <>
                    <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Ubah aturan" onClick={() => setDialog({ open: true, editing: { rule, actuator } })}><Pencil size={14} /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-600" aria-label="Hapus aturan" disabled={Boolean(busy)}
                      onClick={() => update(key, actuator, actuator.rules.filter(item => item.id !== rule.id), 'Aturan dihapus.')}>
                      {busy === key ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </Button>
                  </>
                );
              },
            },
          ]}
        />
      </CardContent>
      <RuleDialog open={dialog.open} editing={dialog.editing} items={usable} onClose={() => setDialog({ open: false, editing: null })} />
    </Card>
  );
}
