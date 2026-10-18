import React, { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Pencil, Printer, SlidersHorizontal, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import DataTable from '@/components/DataTable';
import { api } from '@/lib/api';
import { saveBlob } from '@/lib/download';
import {
  RECAP_KINDS, TYPE_LABELS, batchLabel, describeRecapRow, formatDateTime, formatKg, todayJakarta,
} from '@/lib/operationsView';
import { cn } from '@/lib/utils';
import { ChoiceButton } from './controls';

const PRESETS = [
  { id: '7', label: '7 hari', range: () => [todayJakarta(-6), todayJakarta()] },
  { id: '30', label: '30 hari', range: () => [todayJakarta(-29), todayJakarta()] },
  { id: 'month', label: 'Bulan ini', range: () => [`${todayJakarta().slice(0, 8)}01`, todayJakarta()] },
  { id: 'custom', label: 'Atur sendiri', range: null },
];
const ALL = 'all';
const selectClass = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base';

const KIND_BADGE = {
  harvest: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  care: 'bg-sky-500/15 text-sky-800 dark:text-sky-300',
  problem: 'bg-amber-500/20 text-amber-800 dark:text-amber-300',
  batch: 'bg-violet-500/15 text-violet-800 dark:text-violet-300',
};

/**
 * Rekap kegiatan kumbung: filter (periode, kumbung, batch, jenis, pencatat), ringkasan, tabel
 * kronologis, export CSV (Excel) dan cetak/PDF. `filter`/`onFilterChange` disimpan di URL oleh halaman.
 */
export default function RecapPanel({ farm, kumbungs, batches, filter, onFilterChange, uid, isOwner, refreshKey, onVoid, onCorrect }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false); // HP: filter dilipat agar data langsung terlihat
  const set = changes => onFilterChange({ ...filter, ...changes });

  useEffect(() => {
    let active = true;
    api.members(farm.id).then(list => active && setMembers(list)).catch(() => active && setMembers([]));
    return () => { active = false; };
  }, [farm.id]);

  const params = useMemo(() => ({
    ...(filter.batch ? {} : { from: filter.from, to: filter.to }),
    kumbungId: filter.kumbung === ALL ? undefined : filter.kumbung,
    batchId: filter.batch || undefined,
    kinds: filter.kinds.length === RECAP_KINDS.length ? undefined : filter.kinds.join(','),
    actor: filter.actor || undefined,
  }), [filter]);

  useEffect(() => {
    if (!filter.kinds.length) { setData({ rows: [], summary: null }); return undefined; }
    let active = true;
    setLoading(true);
    api.recap(farm.id, params)
      .then(result => active && setData(result))
      .catch(error => { if (active) { toast.error(error.message); setData(null); } })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [farm.id, params, filter.kinds.length, refreshKey]);

  const kumbungName = id => kumbungs.find(item => item.id === id)?.name || id;
  const batchById = id => batches.find(item => item.id === id);
  const shownBatches = batches.filter(item => filter.kumbung === ALL || item.kumbungId === filter.kumbung);
  const preset = PRESETS.find(item => item.range && item.range().join() === [filter.from, filter.to].join())?.id || 'custom';
  const [customOpen, setCustomOpen] = useState(preset === 'custom');
  const summary = data?.summary;

  const periodText = filter.batch
    ? `Seluruh ${batchLabel(batchById(filter.batch)) || filter.batch}`
    : `${new Date(`${filter.from}T00:00:00+07:00`).toLocaleDateString('id-ID', { dateStyle: 'medium' })} – ${new Date(`${filter.to}T00:00:00+07:00`).toLocaleDateString('id-ID', { dateStyle: 'medium' })}`;
  const scopeText = `${filter.kumbung === ALL ? 'Semua kumbung' : kumbungName(filter.kumbung)}${filter.kinds.length < RECAP_KINDS.length ? ` · ${filter.kinds.map(kind => RECAP_KINDS.find(item => item.id === kind)?.label).join(', ')}` : ''}`;

  const exportCsv = async () => {
    setExporting(true);
    try {
      saveBlob(await api.recapCsv(farm.id, params));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setExporting(false);
    }
  };

  const cards = summary ? [
    ['Total panen', formatKg(summary.harvestKg), `${summary.harvestCount} kali panen`],
    ['Rata-rata per hari', formatKg(summary.avgKgPerDay), `${summary.harvestDays} hari ada panen`],
    ['Mutu', `A ${formatKg(summary.gradeKg.A)}`, `B ${formatKg(summary.gradeKg.B)} · campur ${formatKg(summary.gradeKg.mixed)}${summary.gradeKg.C ? ` · C ${formatKg(summary.gradeKg.C)}` : ''}`],
    ['Baglog dibuang', `${summary.baglogRemoved.toLocaleString('id-ID')} baglog`, `${summary.problemCount} laporan masalah`],
    ['Kegiatan harian', `${summary.careCount} catatan`, `${summary.batchEventCount} perubahan batch`],
  ] : [];

  const columns = [
    { key: 'time', header: 'Waktu', className: 'whitespace-nowrap text-sm', cell: row => formatDateTime(row.occurredAt) },
    {
      key: 'detail', header: 'Catatan', cell: row => (
        <div className="min-w-0">
          <Badge className={cn('mb-1 font-medium', KIND_BADGE[row.kind])} variant="secondary">{TYPE_LABELS[row.type]}</Badge>
          <p className="text-sm leading-snug">{describeRecapRow(row)}{row.corrected && <span className="text-xs text-muted-foreground"> (dikoreksi)</span>}</p>
          {row.notes && row.kind !== 'batch' && <p className="text-xs text-muted-foreground">“{row.notes}”</p>}
        </div>
      ),
    },
    { key: 'kumbung', header: 'Kumbung', hideOnMobile: true, className: 'text-sm', cell: row => row.kumbungName },
    { key: 'batch', header: 'Batch', hideOnMobile: true, className: 'text-sm', cell: row => (row.batchId ? batchLabel(batchById(row.batchId)) || row.batchId : '—') },
    { key: 'actor', header: 'Dicatat oleh', hideOnMobile: true, className: 'text-sm', cell: row => (row.recordedBy === uid ? 'Anda' : row.recordedByName) },
    {
      key: 'actions', header: <span className="sr-only">Aksi</span>, hideOnMobile: true, className: 'text-right whitespace-nowrap', cell: row => (
        <>
          {row.kind === 'harvest' && <Button size="sm" variant="ghost" className="h-10" onClick={() => onCorrect(row)}><Pencil size={14} className="mr-1" />Koreksi</Button>}
          {['care', 'note', 'problem'].includes(row.type) && (isOwner || row.recordedBy === uid) && (
            <Button size="sm" variant="ghost" className="h-10" onClick={() => onVoid(row)}><Undo2 size={14} className="mr-1" />Batalkan</Button>
          )}
        </>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="shadow-sm print:hidden">
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div className="min-w-0">
            <CardTitle className="text-lg">Filter rekap</CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground lg:hidden">{periodText} · {scopeText}</p>
          </div>
          <Button variant="outline" className="h-11 shrink-0 lg:hidden" onClick={() => setFiltersOpen(open => !open)} aria-expanded={filtersOpen}>
            <SlidersHorizontal size={15} className="mr-1" />{filtersOpen ? 'Tutup' : 'Ubah'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={cn('space-y-4', !filtersOpen && 'hidden lg:block')}>
          {!filter.batch && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Periode</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PRESETS.map(item => (
                  <ChoiceButton key={item.id} selected={item.id === 'custom' ? customOpen || preset === 'custom' : !customOpen && preset === item.id}
                    onClick={() => { if (item.range) { setCustomOpen(false); const [from, to] = item.range(); set({ from, to }); } else setCustomOpen(true); }}>
                    {item.label}
                  </ChoiceButton>
                ))}
              </div>
              {(customOpen || preset === 'custom') && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-sm">Dari<Input type="date" value={filter.from} max={filter.to} onChange={event => event.target.value && set({ from: event.target.value })} className="h-12 text-base" /></label>
                  <label className="space-y-1 text-sm">Sampai<Input type="date" value={filter.to} min={filter.from} max={todayJakarta()} onChange={event => event.target.value && set({ to: event.target.value })} className="h-12 text-base" /></label>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm font-semibold">Kumbung
              <select className={selectClass} value={filter.kumbung} onChange={event => set({ kumbung: event.target.value, batch: '' })}>
                <option value={ALL}>Semua kumbung</option>
                {kumbungs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-semibold">Batch
              <select className={selectClass} value={filter.batch} onChange={event => set({ batch: event.target.value })}>
                <option value="">Semua batch (sesuai periode)</option>
                {shownBatches.map(item => <option key={item.id} value={item.id}>{batchLabel(item)}{filter.kumbung === ALL ? ` · ${kumbungName(item.kumbungId)}` : ''}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-semibold">Dicatat oleh
              <select className={selectClass} value={filter.actor} onChange={event => set({ actor: event.target.value })}>
                <option value="">Semua orang</option>
                {members.map(member => <option key={member.uid} value={member.uid}>{member.uid === uid ? 'Anda' : member.username || member.email || member.uid}</option>)}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Jenis catatan</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RECAP_KINDS.map(kind => (
                <ChoiceButton key={kind.id} selected={filter.kinds.includes(kind.id)}
                  onClick={() => set({ kinds: filter.kinds.includes(kind.id) ? filter.kinds.filter(item => item !== kind.id) : [...filter.kinds, kind.id] })}>
                  {kind.label}
                </ChoiceButton>
              ))}
            </div>
          </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button className="h-12 flex-1 sm:flex-none" onClick={exportCsv} disabled={exporting || !filter.kinds.length}>
              {exporting ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Download size={16} className="mr-2" />}Unduh Excel (CSV)
            </Button>
            <Button variant="outline" className="h-12 flex-1 sm:flex-none" onClick={() => window.print()} disabled={!data?.rows?.length}>
              <Printer size={16} className="mr-2" />Cetak / PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Area cetak: hanya bagian ini yang tampil saat window.print() (lihat index.css). */}
      <div id="recap-print" className="space-y-4">
        <div className="hidden print:block">
          <h1 className="text-xl font-bold">Rekap Kegiatan Kumbung — {farm.name}</h1>
          <p className="text-sm">{periodText} · {scopeText}</p>
        </div>
        <p className="hidden text-sm text-muted-foreground lg:block print:hidden">{periodText} · {scopeText}</p>

        {cards.length > 0 && (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5 print:grid-cols-5">
            {cards.map(([label, value, sub]) => (
              <div key={label} className="rounded-xl border bg-card p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-bold leading-tight">{value}</p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>
        )}

        <Card className="shadow-sm print:hidden">
          <CardContent className="p-2 sm:p-4">
            <DataTable columns={columns} rows={data?.rows || []} loading={loading && !data} pageSize={20}
              emptyText={filter.kinds.length ? 'Tidak ada catatan pada filter ini.' : 'Pilih minimal satu jenis catatan.'} />
            {data?.truncated && <p className="mt-2 text-xs text-amber-700">Hanya 5.000 catatan terbaru yang ditampilkan; unduh CSV untuk data lengkap.</p>}
          </CardContent>
        </Card>

        {/* Tabel lengkap tanpa halaman untuk cetak */}
        <table className="hidden w-full border-collapse text-xs print:table">
          <thead><tr>{['Waktu', 'Kumbung', 'Jenis', 'Rincian', 'Catatan', 'Oleh'].map(head => <th key={head} className="border px-1 py-0.5 text-left">{head}</th>)}</tr></thead>
          <tbody>
            {[...(data?.rows || [])].reverse().map(row => (
              <tr key={row.id}>
                <td className="border px-1 py-0.5 whitespace-nowrap">{formatDateTime(row.occurredAt)}</td>
                <td className="border px-1 py-0.5">{row.kumbungName}</td>
                <td className="border px-1 py-0.5">{TYPE_LABELS[row.type]}</td>
                <td className="border px-1 py-0.5">{describeRecapRow(row)}</td>
                <td className="border px-1 py-0.5">{row.notes}</td>
                <td className="border px-1 py-0.5">{row.recordedByName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { ALL as ALL_KUMBUNGS };
