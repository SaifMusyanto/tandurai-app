import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { CalendarClock, CheckCircle2, Download, Loader2, Pencil, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import TelegramStatus from '@/components/TelegramStatus';
import ReportPreview from '@/components/reports/ReportPreview';
import ReportScheduleDialog from '@/components/reports/ReportScheduleDialog';
import { SECTIONS, describeSchedule, formatDateTime } from '@/components/reports/reportOptions';
import { useFarmContext } from '@/contexts/FarmContext';
import { api } from '@/lib/api';
import { saveBlob } from '@/lib/download';
import { todayJakarta } from '@/lib/operationsView';
import { cn } from '@/lib/utils';

const firstOfMonth = (offsetMonths = 0) => {
  const [year, month] = todayJakarta().split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offsetMonths, 1));
  return date.toISOString().slice(0, 10);
};
const PERIODS = [
  { id: 'yesterday', label: 'Kemarin', range: () => [todayJakarta(-1), todayJakarta(-1)] },
  { id: '7', label: '7 hari', range: () => [todayJakarta(-6), todayJakarta()] },
  { id: '30', label: '30 hari', range: () => [todayJakarta(-29), todayJakarta()] },
  { id: 'lastMonth', label: 'Bulan lalu', range: () => [firstOfMonth(-1), new Date(Date.parse(`${firstOfMonth(0)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)] },
  { id: 'custom', label: 'Atur sendiri', range: null },
];

function Chip({ selected, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={cn('min-h-10 rounded-full border px-3 py-1.5 text-sm transition-colors', selected ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border hover:bg-muted')}>
      {children}
    </button>
  );
}

/** Daftar jadwal laporan otomatis (owner mengelola; anggota melihat). */
function ScheduleList({ farm, kumbungs, isOwner }) {
  const [schedules, setSchedules] = useState(null);
  const [dialog, setDialog] = useState(null); // { schedule|null }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => api.reportSchedules(farm.id).then(setSchedules).catch(error => { toast.error(error.message); setSchedules([]); }), [farm.id]);
  useEffect(() => { setSchedules(null); load(); }, [load]);

  const run = async (key, action, success) => {
    setBusy(key);
    try {
      const result = await action();
      if (success) toast[result?.lastStatus === 'failed' ? 'error' : 'success'](result?.lastStatus === 'failed' ? `Gagal: ${result.lastError}` : success);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };
  const kumbungText = ids => (!ids.length ? 'Semua kumbung' : ids.map(id => kumbungs.find(item => item.id === id)?.name || id).join(', '));

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg"><CalendarClock size={18} className="text-primary" />Laporan otomatis</CardTitle>
          <CardDescription>Dikirim ke Telegram farm sesuai jadwal: ringkasan teks + file Excel.</CardDescription>
        </div>
        {isOwner && <Button className="h-11" onClick={() => setDialog({ schedule: null })}><Plus size={16} className="mr-1" />Tambah jadwal</Button>}
      </CardHeader>
      <CardContent className="space-y-3">
        {schedules === null ? <p className="py-6 text-center text-sm text-muted-foreground">Memuat…</p>
          : !schedules.length ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Belum ada jadwal laporan.{isOwner ? ' Tambahkan jadwal agar rekap parameter dan kegiatan terkirim otomatis.' : ''}
            </p>
          ) : schedules.map(schedule => (
            <div key={schedule.id} className={cn('space-y-2 rounded-xl border p-4', !schedule.enabled && 'opacity-60')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{schedule.name}</p>
                  <p className="text-sm">{describeSchedule(schedule)}</p>
                  <p className="text-xs text-muted-foreground">{kumbungText(schedule.kumbungIds)} · {schedule.sections.map(id => SECTIONS.find(item => item.id === id)?.label).join(', ')}{schedule.attachExcel ? ' · + Excel' : ''}</p>
                </div>
                {isOwner && (
                  <Switch checked={schedule.enabled} aria-label={schedule.enabled ? 'Nonaktifkan jadwal' : 'Aktifkan jadwal'} disabled={busy === `toggle-${schedule.id}`}
                    onCheckedChange={value => run(`toggle-${schedule.id}`, () => api.updateReportSchedule(schedule.id, { enabled: value }))} />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Berikutnya: {schedule.enabled ? formatDateTime(schedule.nextRunAt) : 'nonaktif'}</span>
                {schedule.lastRunAt && (
                  <span className={cn('flex items-center gap-1', schedule.lastStatus === 'failed' ? 'text-red-600' : 'text-emerald-600')}>
                    {schedule.lastStatus === 'failed' ? <XCircle size={12} /> : <CheckCircle2 size={12} />}
                    Terakhir {formatDateTime(schedule.lastRunAt)}{schedule.lastStatus === 'failed' ? ` — ${schedule.lastError}` : ' terkirim'}
                  </span>
                )}
              </div>
              {isOwner && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="h-10" disabled={Boolean(busy)} onClick={() => run(`send-${schedule.id}`, () => api.sendReportSchedule(schedule.id), 'Laporan terkirim ke Telegram')}>
                    {busy === `send-${schedule.id}` ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Send size={14} className="mr-1" />}Kirim sekarang
                  </Button>
                  <Button size="sm" variant="ghost" className="h-10" onClick={() => setDialog({ schedule })}><Pencil size={14} className="mr-1" />Ubah</Button>
                  <Button size="sm" variant="ghost" className="h-10 text-red-600" onClick={() => setConfirmDelete(schedule)}><Trash2 size={14} className="mr-1" />Hapus</Button>
                </div>
              )}
            </div>
          ))}
      </CardContent>

      <ReportScheduleDialog open={Boolean(dialog)} schedule={dialog?.schedule || null} farm={farm} kumbungs={kumbungs} onClose={() => setDialog(null)} onSaved={load} />
      <Dialog open={Boolean(confirmDelete)} onOpenChange={value => !value && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Hapus jadwal laporan?</DialogTitle><DialogDescription>{confirmDelete?.name} tidak akan dikirim lagi.</DialogDescription></DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="h-11" onClick={() => setConfirmDelete(null)}>Batal</Button>
            <Button variant="destructive" className="h-11" disabled={Boolean(busy)}
              onClick={() => { const target = confirmDelete; setConfirmDelete(null); run(`delete-${target.id}`, () => api.deleteReportSchedule(target.id), 'Jadwal dihapus'); }}>
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Pusat laporan farm: jadwal laporan otomatis ke Telegram (parameter, panen, kegiatan, peringatan)
 * dan laporan sekarang dengan pratinjau serta unduh Excel/CSV.
 */
export default function ReportsPage() {
  const { farm, kumbungs, isOwner } = useFarmContext();
  const [period, setPeriod] = useState('7');
  const [[from, to], setRange] = useState(PERIODS[1].range());
  const [kumbungIds, setKumbungIds] = useState([]);
  const [sections, setSections] = useState(SECTIONS.map(item => item.id));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState('');

  const params = useMemo(() => ({ from, to, kumbungIds: kumbungIds.join(',') || undefined, sections: sections.join(',') }), [from, to, kumbungIds, sections]);

  useEffect(() => {
    if (!farm?.id || !sections.length) { setReport(null); return undefined; }
    let active = true;
    setLoading(true);
    api.report(farm.id, params)
      .then(result => active && setReport(result))
      .catch(error => { if (active) { toast.error(error.message); setReport(null); } })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [farm?.id, params, sections.length]);

  useEffect(() => { setKumbungIds([]); }, [farm?.id]);

  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter(item => item !== value) : [...list, value]);
  const choosePeriod = item => { setPeriod(item.id); if (item.range) setRange(item.range()); };
  const download = async format => {
    setDownloading(format);
    try {
      saveBlob(await api.reportFile(farm.id, { ...params, format }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDownloading('');
    }
  };

  if (!farm) return null;

  return (
    <>
      <Helmet><title>Laporan - Dashboard Tandurai</title></Helmet>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Laporan</h1>
          <p className="text-sm text-muted-foreground">Rekap parameter dan aktivitas semua kumbung {farm.name}: otomatis terjadwal atau unduh kapan saja.</p>
        </div>

        <TelegramStatus farm={farm} purpose="reports" />
        <ScheduleList farm={farm} kumbungs={kumbungs} isOwner={isOwner} />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Laporan sekarang</CardTitle>
            <CardDescription>Pilih periode, kumbung, dan isi laporan; pratinjau tampil di bawah.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Periode</p>
              <div className="flex flex-wrap gap-2">{PERIODS.map(item => <Chip key={item.id} selected={period === item.id} onClick={() => choosePeriod(item)}>{item.label}</Chip>)}</div>
              {period === 'custom' && (
                <div className="grid grid-cols-2 gap-2 sm:max-w-md">
                  <label className="space-y-1 text-sm">Dari<Input type="date" value={from} max={to} onChange={event => event.target.value && setRange([event.target.value, to])} className="h-11" /></label>
                  <label className="space-y-1 text-sm">Sampai<Input type="date" value={to} min={from} max={todayJakarta()} onChange={event => event.target.value && setRange([from, event.target.value])} className="h-11" /></label>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Kumbung</p>
              <div className="flex flex-wrap gap-2">
                <Chip selected={!kumbungIds.length} onClick={() => setKumbungIds([])}>Semua kumbung</Chip>
                {kumbungs.map(item => <Chip key={item.id} selected={kumbungIds.includes(item.id)} onClick={() => toggle(kumbungIds, setKumbungIds, item.id)}>{item.name || item.id}</Chip>)}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Isi laporan</p>
              <div className="flex flex-wrap gap-2">{SECTIONS.map(item => <Chip key={item.id} selected={sections.includes(item.id)} onClick={() => toggle(sections, setSections, item.id)}>{item.label}</Chip>)}</div>
            </div>
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button className="h-11 flex-1 sm:flex-none" onClick={() => download('xlsx')} disabled={Boolean(downloading) || !sections.length}>
                {downloading === 'xlsx' ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Download size={16} className="mr-2" />}Unduh Excel
              </Button>
              <Button variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => download('csv')} disabled={Boolean(downloading) || !sections.length}>
                {downloading === 'csv' ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Download size={16} className="mr-2" />}Unduh CSV (ringkasan)
              </Button>
            </div>
          </CardContent>
        </Card>

        {!sections.length ? <p className="text-center text-sm text-muted-foreground">Pilih minimal satu isi laporan.</p>
          : loading && !report ? <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground"><Loader2 className="animate-spin" />Menyusun laporan…</div>
            : report && (
              <div className={cn('space-y-2', loading && 'opacity-60')}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold">Pratinjau</h2>
                  <Badge variant="outline">{new Date(report.startAt).toLocaleDateString('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' })} – {new Date(report.endAt - 1).toLocaleDateString('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' })}</Badge>
                </div>
                <ReportPreview report={report} />
              </div>
            )}
      </div>
    </>
  );
}
