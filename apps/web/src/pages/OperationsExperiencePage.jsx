import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import {
  AlertTriangle, ArrowRight, Building2, CalendarDays, Check, CheckCircle2, CircleHelp,
  Edit3, Leaf, Loader2, MapPin, PackagePlus, RefreshCw, Save, Scale, Sprout, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { auth, db } from '../firebase';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BATCH_STATUSES, GROWTH_STAGES, HARVEST_GRADES, KUMBUNG_STATUSES, SUBSTRATE_TYPES,
  buildBatchPayload, buildFarmPayload, buildHarvestPayload, buildKumbungPayload,
  nextBatchId, nextKumbungId,
} from '@/lib/operations';
import {
  createBatch, createHarvestEvent, createKumbung, loadOperations, saveBatch,
  saveFarm, saveKumbung,
} from '@/lib/operationsService';
import {
  GRADE_LABELS, PHASES, STATUS_LABELS, SUBSTRATE_LABELS, dateInputJakarta,
  datetimeInputJakarta, nextPhase, phaseInfo,
} from '@/lib/operationsView';

const fieldClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-sm';
const nowJakarta = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
const todayJakarta = () => nowJakarta().slice(0, 10);
const initialKumbung = { farmId: '', name: '', capacityBaglog: '1000', status: 'active' };
const initialBatch = {
  farmId: '', kumbungId: '', startedDate: todayJakarta(), baglogCountInitial: '1000',
  baglogCountActive: '1000', substrateType: 'serbuk-kayu', growthStage: 'inoculation',
  contaminationPct: '0', status: 'active',
};
const initialHarvest = {
  farmId: '', kumbungId: '', batchId: '', harvestedAt: nowJakarta(),
  weightKg: '', grade: 'A', gradeAPct: '100', notes: '', correctionReason: '',
};

function FormField({ label, hint, children }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}

function PhaseGuide({ stage }) {
  const current = phaseInfo(stage);
  return (
    <div className="grid gap-2 md:grid-cols-5">
      {PHASES.map(phase => {
        const done = phase.number < current.number;
        const active = phase.id === current.id;
        return (
          <div key={phase.id} className={`relative rounded-xl border p-3 ${active ? 'border-emerald-500 bg-emerald-500/10 shadow-sm' : done ? 'border-emerald-500/30 bg-emerald-500/5' : 'bg-muted/30'}`}>
            <div className="flex items-center gap-2">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${active || done ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'}`}>{done ? <Check size={15} /> : phase.number}</span>
              <p className="text-sm font-semibold leading-tight">{phase.short}</p>
            </div>
            {active && <Badge className="mt-3 bg-emerald-600">Sedang berjalan</Badge>}
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ value }) {
  const good = value === 'active' || value === 'completed';
  return <Badge variant={good ? 'secondary' : 'outline'}>{STATUS_LABELS[value] || value}</Badge>;
}

export default function OperationsExperiencePage() {
  const [data, setData] = useState({ role: 'viewer', farms: [], kumbungs: [], batches: [], harvestEvents: [], harvestAudit: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [selectedFarmId, setSelectedFarmId] = useState('');
  const [selectedKumbungId, setSelectedKumbungId] = useState('');
  const [dialog, setDialog] = useState(null);
  const [editing, setEditing] = useState(null);
  const [farmForm, setFarmForm] = useState({ name: '', location: 'Indonesia', status: 'active' });
  const [kumbungForm, setKumbungForm] = useState(initialKumbung);
  const [batchForm, setBatchForm] = useState(initialBatch);
  const [harvestForm, setHarvestForm] = useState(initialHarvest);

  const refresh = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setLoading(true);
    try {
      const result = await loadOperations(db, uid);
      setData(result);
      setSelectedFarmId(previous => result.farms.some(item => item.id === previous) ? previous : result.farms[0]?.id || '');
    } catch (error) {
      toast.error(error.message || 'Data kumbung belum dapat dimuat');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const canManage = data.role === 'manager' || data.role === 'admin';
  const canHarvest = canManage || data.role === 'operator';
  const selectedFarm = data.farms.find(item => item.id === selectedFarmId);
  const farmKumbungs = useMemo(() => data.kumbungs.filter(item => item.farmId === selectedFarmId), [data.kumbungs, selectedFarmId]);
  const selectedKumbung = farmKumbungs.find(item => item.id === selectedKumbungId);
  const kumbungBatches = useMemo(
    () => data.batches.filter(item => item.kumbungId === selectedKumbungId).sort((a, b) => Number(b.startedAt) - Number(a.startedAt)),
    [data.batches, selectedKumbungId],
  );
  const activeBatch = kumbungBatches.find(item => item.status === 'active');
  const kumbungHarvests = data.harvestEvents.filter(item => item.kumbungId === selectedKumbungId);
  const currentPhase = activeBatch ? phaseInfo(activeBatch.growthStage) : null;

  useEffect(() => {
    setSelectedKumbungId(previous => farmKumbungs.some(item => item.id === previous) ? previous : farmKumbungs[0]?.id || '');
  }, [farmKumbungs]);

  useEffect(() => {
    if (!selectedFarm || !selectedKumbungId) return;
    setHarvestForm(previous => ({ ...initialHarvest, farmId: selectedFarm.id, kumbungId: selectedKumbungId, batchId: activeBatch?.id || '', harvestedAt: nowJakarta() }));
  }, [selectedFarm, selectedKumbungId, activeBatch?.id]);

  const runSave = async (key, action, success, close = true) => {
    setSaving(key);
    try {
      await action();
      toast.success(success);
      if (close) setDialog(null);
      await refresh();
    } catch (error) {
      toast.error(error.message || 'Data belum berhasil disimpan');
    } finally {
      setSaving('');
    }
  };

  const openFarm = () => {
    setFarmForm({ name: selectedFarm?.name || '', location: selectedFarm?.location || 'Indonesia', status: selectedFarm?.status || 'active' });
    setDialog('farm');
  };
  const openKumbung = item => {
    setEditing(item || null);
    setKumbungForm(item ? { farmId: item.farmId, name: item.name, capacityBaglog: String(item.capacityBaglog), status: item.status } : { ...initialKumbung, farmId: selectedFarmId });
    setDialog('kumbung');
  };
  const openBatch = item => {
    setEditing(item || null);
    setBatchForm(item ? {
      farmId: item.farmId, kumbungId: item.kumbungId, startedDate: dateInputJakarta(item.startedAt),
      baglogCountInitial: String(item.baglogCountInitial), baglogCountActive: String(item.baglogCountActive),
      substrateType: item.substrateType, growthStage: item.growthStage,
      contaminationPct: String(item.contaminationPct), status: item.status,
    } : { ...initialBatch, farmId: selectedFarmId, kumbungId: selectedKumbungId });
    setDialog('batch');
  };
  const openCorrection = event => {
    setEditing(event);
    setHarvestForm({
      farmId: event.farmId, kumbungId: event.kumbungId, batchId: event.batchId,
      harvestedAt: datetimeInputJakarta(event.harvestedAt), weightKg: String(event.weightKg),
      grade: event.grade, gradeAPct: String(event.gradeAPct), notes: event.notes || '', correctionReason: '',
    });
    setDialog('correction');
  };

  const submitFarm = () => runSave('farm', () => saveFarm(db, selectedFarm.id, buildFarmPayload(farmForm, selectedFarm)), 'Data farm sudah diperbarui');
  const submitKumbung = () => runSave('kumbung', async () => {
    const built = buildKumbungPayload(kumbungForm, auth.currentUser.uid);
    if (editing) await saveKumbung(db, editing.id, { ...built, createdAt: editing.createdAt, createdBy: editing.createdBy, updatedAt: Date.now() });
    else {
      const id = nextKumbungId(selectedFarmId, data.kumbungs.map(item => item.id));
      await createKumbung(db, id, built);
      setSelectedKumbungId(id);
    }
  }, editing ? 'Kumbung sudah diperbarui' : 'Kumbung baru sudah dibuat');
  const submitBatch = () => runSave('batch', async () => {
    const kumbung = data.kumbungs.find(item => item.id === batchForm.kumbungId);
    const built = buildBatchPayload(batchForm, kumbung, auth.currentUser.uid);
    if (editing) await saveBatch(db, editing.id, { ...built, createdAt: editing.createdAt, createdBy: editing.createdBy, updatedAt: Date.now() });
    else await createBatch(db, nextBatchId(batchForm.kumbungId, data.batches.map(item => item.id)), built);
  }, editing ? 'Data batch sudah diperbarui' : 'Batch baru sudah dimulai');
  const advanceBatch = batch => runSave(`advance-${batch.id}`, async () => {
    const next = nextPhase(batch.growthStage);
    await saveBatch(db, batch.id, { ...batch, growthStage: next.id, status: next.id === 'completed' ? 'completed' : batch.status, updatedAt: Date.now() });
  }, `Tahap dilanjutkan ke “${nextPhase(batch.growthStage).title}”`, false);
  const cancelBatch = batch => runSave(`cancel-${batch.id}`, () => saveBatch(db, batch.id, { ...batch, status: 'cancelled', updatedAt: Date.now() }), 'Batch sudah dibatalkan', false);
  const submitHarvest = () => runSave('harvest', async () => {
    const batch = data.batches.find(item => item.id === harvestForm.batchId);
    await createHarvestEvent(db, harvestForm.kumbungId, buildHarvestPayload(harvestForm, batch, auth.currentUser.uid));
    setHarvestForm(previous => ({ ...initialHarvest, farmId: previous.farmId, kumbungId: previous.kumbungId, batchId: previous.batchId, harvestedAt: nowJakarta() }));
  }, 'Hasil panen sudah dicatat', false);
  const submitCorrection = () => runSave('correction', async () => {
    if (!harvestForm.correctionReason.trim()) throw new Error('Alasan koreksi wajib diisi');
    const batch = data.batches.find(item => item.id === harvestForm.batchId);
    const payload = buildHarvestPayload(harvestForm, batch, auth.currentUser.uid);
    await createHarvestEvent(db, harvestForm.kumbungId, {
      ...payload, correctsEventId: editing.id, correctionReason: harvestForm.correctionReason.trim().slice(0, 300),
    });
  }, 'Koreksi panen sudah disimpan dengan jejak perubahan');

  if (loading && !data.farms.length) return <div className="min-h-[60vh] flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="animate-spin" /> Memuat data kumbung...</div>;

  return (
    <>
      <Helmet><title>Operasional Kumbung — Tandurai</title></Helmet>
      <div className="mx-auto max-w-[1600px] space-y-6 pb-8">
        <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div><Badge variant="outline" className="mb-2">Panduan kerja harian</Badge><h1 className="text-2xl font-black sm:text-3xl">Operasional Kumbung</h1><p className="mt-1 text-sm text-muted-foreground">Pilih kumbung, lihat tahap budidaya, lalu kerjakan tindakan yang disarankan.</p></div>
            <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[620px]">
              <FormField label="Pilih farm"><select className={fieldClass} value={selectedFarmId} onChange={event => setSelectedFarmId(event.target.value)}>{data.farms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField>
              <FormField label="Pilih kumbung"><select className={fieldClass} value={selectedKumbungId} onChange={event => setSelectedKumbungId(event.target.value)}>{farmKumbungs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField>
            </div>
          </div>
        </div>

        {!selectedKumbung && <Alert><CircleHelp /><AlertTitle>Belum ada kumbung</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>Buat kumbung pertama agar pencatatan budidaya dapat dimulai.</span>{canManage && <Button size="sm" onClick={() => openKumbung(null)}><PackagePlus size={16} className="mr-2" />Buat kumbung</Button>}</AlertDescription></Alert>}

        {selectedKumbung && <Tabs defaultValue="today" className="space-y-5">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 lg:grid-cols-4">
            <TabsTrigger value="today" className="min-h-10">Hari Ini</TabsTrigger>
            <TabsTrigger value="batches" className="min-h-10">Siklus Baglog</TabsTrigger>
            <TabsTrigger value="harvest" className="min-h-10">Catatan Panen</TabsTrigger>
            <TabsTrigger value="settings" className="min-h-10">Farm & Kumbung</TabsTrigger>
          </TabsList>

          <TabsContent value="today" className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Kumbung', selectedKumbung.name], ['Kapasitas', `${Number(selectedKumbung.capacityBaglog).toLocaleString('id-ID')} baglog`],
                ['Batch berjalan', activeBatch?.id || 'Belum ada'], ['Tahap saat ini', currentPhase?.short || 'Belum dimulai'],
              ].map(([label, value]) => <Card key={label} className="shadow-sm"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-bold">{value}</p></CardContent></Card>)}
            </div>
            {activeBatch ? <Card className="border-emerald-500/30 shadow-sm">
              <CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle className="flex items-center gap-2"><Sprout className="text-emerald-600" />Tahap {currentPhase.number}: {currentPhase.title}</CardTitle><p className="mt-2 text-sm text-muted-foreground">{currentPhase.description}</p></div><StatusBadge value={activeBatch.status} /></div></CardHeader>
              <CardContent className="space-y-5"><PhaseGuide stage={activeBatch.growthStage} /><div className="rounded-xl bg-muted/50 p-4"><p className="font-semibold">Tindakan berikutnya</p><p className="mt-1 text-sm text-muted-foreground">{activeBatch.growthStage === 'completed' ? 'Siklus sudah selesai. Siapkan kumbung untuk batch baru.' : `Jika pekerjaan tahap ini sudah selesai, lanjutkan ke “${nextPhase(activeBatch.growthStage).title}”.`}</p>{canManage && activeBatch.growthStage !== 'completed' && <Button className="mt-4" disabled={saving === `advance-${activeBatch.id}`} onClick={() => advanceBatch(activeBatch)}>Sudah selesai, lanjut tahap <ArrowRight size={16} className="ml-2" /></Button>}</div></CardContent>
            </Card> : <Alert><Leaf /><AlertTitle>Belum ada batch yang berjalan</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>Mulai batch baglog agar tahap budidaya dapat dipantau.</span>{canManage && <Button size="sm" onClick={() => openBatch(null)}><PackagePlus size={16} className="mr-2" />Mulai batch</Button>}</AlertDescription></Alert>}
          </TabsContent>

          <TabsContent value="batches" className="space-y-4">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Siklus Baglog</h2><p className="text-sm text-muted-foreground">Satu batch mewakili satu kelompok baglog yang dimulai bersamaan.</p></div>{canManage && <Button onClick={() => openBatch(null)}><PackagePlus size={16} className="mr-2" />Mulai batch baru</Button>}</div>
            {kumbungBatches.length === 0 ? <Card><CardContent className="p-8 text-center text-muted-foreground">Belum ada batch pada kumbung ini.</CardContent></Card> : <div className="space-y-3">{kumbungBatches.map(batch => <Card key={batch.id} className="shadow-sm"><CardContent className="p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-center"><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{batch.id}</p><StatusBadge value={batch.status} /><Badge variant="outline">{phaseInfo(batch.growthStage).short}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{batch.baglogCountActive}/{batch.baglogCountInitial} baglog aktif · {SUBSTRATE_LABELS[batch.substrateType]} · kontaminasi {batch.contaminationPct}%</p></div>{canManage && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openBatch(batch)}><Edit3 size={15} className="mr-2" />Edit</Button>{batch.status === 'active' && <Button size="sm" variant="destructive" disabled={saving === `cancel-${batch.id}`} onClick={() => cancelBatch(batch)}><XCircle size={15} className="mr-2" />Batalkan</Button>}</div>}</div></CardContent></Card>)}</div>}
          </TabsContent>

          <TabsContent value="harvest" className="space-y-5">
            <Card className="shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><Scale size={19} />Catat hasil panen hari ini</CardTitle><p className="text-sm text-muted-foreground">Isi berat dari timbangan. Catatan yang salah dapat dikoreksi tanpa menghapus riwayat.</p></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><FormField label="Batch yang dipanen"><select className={fieldClass} value={harvestForm.batchId} onChange={event => setHarvestForm({ ...harvestForm, batchId: event.target.value })}><option value="">Pilih batch</option>{kumbungBatches.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></FormField><FormField label="Waktu panen"><Input type="datetime-local" value={harvestForm.harvestedAt} onChange={event => setHarvestForm({ ...harvestForm, harvestedAt: event.target.value })} /></FormField><FormField label="Berat panen" hint="Masukkan angka yang terlihat di timbangan."><div className="relative"><Input className="pr-12" type="number" min="0.01" step="0.01" value={harvestForm.weightKg} onChange={event => setHarvestForm({ ...harvestForm, weightKg: event.target.value })} /><span className="absolute right-3 top-2.5 text-sm text-muted-foreground">kg</span></div></FormField><FormField label="Kualitas panen"><select className={fieldClass} value={harvestForm.grade} onChange={event => setHarvestForm({ ...harvestForm, grade: event.target.value })}>{HARVEST_GRADES.map(value => <option key={value} value={value}>{GRADE_LABELS[value]}</option>)}</select></FormField><FormField label="Bagian kualitas A" hint="Perkiraan persentase hasil kualitas terbaik."><div className="relative"><Input className="pr-10" type="number" min="0" max="100" value={harvestForm.gradeAPct} onChange={event => setHarvestForm({ ...harvestForm, gradeAPct: event.target.value })} /><span className="absolute right-3 top-2.5 text-sm text-muted-foreground">%</span></div></FormField><div className="sm:col-span-2 xl:col-span-3"><FormField label="Catatan tambahan (boleh kosong)"><Input maxLength="500" value={harvestForm.notes} onChange={event => setHarvestForm({ ...harvestForm, notes: event.target.value })} /></FormField></div></div><Button size="lg" disabled={!canHarvest || !harvestForm.batchId || saving === 'harvest'} onClick={submitHarvest}><Save size={17} className="mr-2" />Simpan hasil panen</Button></CardContent></Card>
            <Card className="shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays size={19} />Riwayat panen</CardTitle></CardHeader><CardContent>{kumbungHarvests.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada panen yang dicatat.</p> : <div className="space-y-2">{kumbungHarvests.map(event => <div key={event.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center"><Scale className="text-emerald-600" /><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{event.weightKg} kg</p><Badge variant="outline">Grade {event.grade}</Badge>{event.corrected && <Badge variant="secondary">Sudah dikoreksi</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{new Date(event.harvestedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} · {event.batchId}</p></div>{canHarvest && <Button size="sm" variant="outline" onClick={() => openCorrection(event)}><Edit3 size={15} className="mr-2" />Koreksi</Button>}</div>)}</div>}</CardContent></Card>
          </TabsContent>

          <TabsContent value="settings" className="space-y-5">
            <Alert><AlertTriangle /><AlertTitle>Data tidak dihapus permanen</AlertTitle><AlertDescription>Gunakan status “Tidak aktif” atau “Dibatalkan” agar riwayat panen dan perhitungan tetap aman.</AlertDescription></Alert>
            <Card className="shadow-sm"><CardHeader><div className="flex items-center justify-between"><div><CardTitle className="flex items-center gap-2"><MapPin size={19} />{selectedFarm?.name}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{selectedFarm?.location}</p></div>{canManage && <Button variant="outline" onClick={openFarm}><Edit3 size={15} className="mr-2" />Edit farm</Button>}</div></CardHeader></Card>
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Daftar Kumbung</h2><p className="text-sm text-muted-foreground">Edit nama, kapasitas, atau status kumbung.</p></div>{canManage && <Button onClick={() => openKumbung(null)}><PackagePlus size={16} className="mr-2" />Tambah kumbung</Button>}</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{farmKumbungs.map(item => <Card key={item.id} className={item.id === selectedKumbungId ? 'border-emerald-500/40 shadow-sm' : 'shadow-sm'}><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.id} · {Number(item.capacityBaglog).toLocaleString('id-ID')} baglog</p></div><StatusBadge value={item.status} /></div>{canManage && <Button className="mt-4 w-full" size="sm" variant="outline" onClick={() => openKumbung(item)}><Edit3 size={15} className="mr-2" />Edit kumbung</Button>}</CardContent></Card>)}</div>
          </TabsContent>
        </Tabs>}
      </div>

      <Dialog open={dialog === 'farm'} onOpenChange={open => !open && setDialog(null)}><DialogContent><DialogHeader><DialogTitle>Edit data farm</DialogTitle><DialogDescription>Perbarui nama, lokasi, atau status farm.</DialogDescription></DialogHeader><div className="grid gap-4"><FormField label="Nama farm"><Input value={farmForm.name} onChange={event => setFarmForm({ ...farmForm, name: event.target.value })} /></FormField><FormField label="Lokasi"><Input value={farmForm.location} onChange={event => setFarmForm({ ...farmForm, location: event.target.value })} /></FormField><FormField label="Status"><select className={fieldClass} value={farmForm.status} onChange={event => setFarmForm({ ...farmForm, status: event.target.value })}><option value="active">Aktif</option><option value="inactive">Tidak aktif</option></select></FormField></div><DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Batal</Button><Button disabled={saving === 'farm'} onClick={submitFarm}>Simpan perubahan</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={dialog === 'kumbung'} onOpenChange={open => !open && setDialog(null)}><DialogContent><DialogHeader><DialogTitle>{editing ? 'Edit kumbung' : 'Tambah kumbung baru'}</DialogTitle><DialogDescription>Isi nama yang mudah dikenali oleh pekerja di lapangan.</DialogDescription></DialogHeader><div className="grid gap-4"><FormField label="Nama kumbung" hint="Contoh: Kumbung Timur"><Input value={kumbungForm.name} onChange={event => setKumbungForm({ ...kumbungForm, name: event.target.value })} /></FormField><FormField label="Kapasitas maksimal baglog"><Input type="number" min="1" value={kumbungForm.capacityBaglog} onChange={event => setKumbungForm({ ...kumbungForm, capacityBaglog: event.target.value })} /></FormField><FormField label="Status"><select className={fieldClass} value={kumbungForm.status} onChange={event => setKumbungForm({ ...kumbungForm, status: event.target.value })}>{KUMBUNG_STATUSES.map(value => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></FormField></div><DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Batal</Button><Button disabled={saving === 'kumbung'} onClick={submitKumbung}>{editing ? 'Simpan perubahan' : 'Buat kumbung'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={dialog === 'batch'} onOpenChange={open => !open && setDialog(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editing ? 'Edit data batch' : 'Mulai batch baglog baru'}</DialogTitle><DialogDescription>Data ini dipakai untuk memantau tahap budidaya dan memperkirakan hasil panen.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><FormField label="Tanggal mulai"><Input type="date" value={batchForm.startedDate} disabled={Boolean(editing)} onChange={event => setBatchForm({ ...batchForm, startedDate: event.target.value })} /></FormField><FormField label="Jenis bahan baglog"><select className={fieldClass} value={batchForm.substrateType} onChange={event => setBatchForm({ ...batchForm, substrateType: event.target.value })}>{SUBSTRATE_TYPES.map(value => <option key={value} value={value}>{SUBSTRATE_LABELS[value]}</option>)}</select></FormField><FormField label="Jumlah baglog saat mulai"><Input type="number" min="1" value={batchForm.baglogCountInitial} onChange={event => setBatchForm({ ...batchForm, baglogCountInitial: event.target.value })} /></FormField><FormField label="Baglog yang masih aktif"><Input type="number" min="0" value={batchForm.baglogCountActive} onChange={event => setBatchForm({ ...batchForm, baglogCountActive: event.target.value })} /></FormField><FormField label="Tahap budidaya"><select className={fieldClass} value={batchForm.growthStage} onChange={event => setBatchForm({ ...batchForm, growthStage: event.target.value })}>{GROWTH_STAGES.map(value => <option key={value} value={value}>{phaseInfo(value).title}</option>)}</select></FormField><FormField label="Baglog terkontaminasi" hint="Isi perkiraan persen baglog yang berjamur liar atau rusak."><div className="relative"><Input className="pr-10" type="number" min="0" max="100" value={batchForm.contaminationPct} onChange={event => setBatchForm({ ...batchForm, contaminationPct: event.target.value })} /><span className="absolute right-3 top-2.5 text-sm text-muted-foreground">%</span></div></FormField><FormField label="Status batch"><select className={fieldClass} value={batchForm.status} onChange={event => setBatchForm({ ...batchForm, status: event.target.value })}>{BATCH_STATUSES.map(value => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></FormField></div><DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Batal</Button><Button disabled={saving === 'batch'} onClick={submitBatch}>{editing ? 'Simpan perubahan' : 'Mulai batch'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={dialog === 'correction'} onOpenChange={open => !open && setDialog(null)}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Koreksi catatan panen</DialogTitle><DialogDescription>Catatan lama tidak dihapus. Perubahan ini disimpan sebagai koreksi agar riwayat tetap jelas.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><FormField label="Waktu panen"><Input type="datetime-local" value={harvestForm.harvestedAt} onChange={event => setHarvestForm({ ...harvestForm, harvestedAt: event.target.value })} /></FormField><FormField label="Berat yang benar"><Input type="number" min="0.01" step="0.01" value={harvestForm.weightKg} onChange={event => setHarvestForm({ ...harvestForm, weightKg: event.target.value })} /></FormField><FormField label="Kualitas"><select className={fieldClass} value={harvestForm.grade} onChange={event => setHarvestForm({ ...harvestForm, grade: event.target.value })}>{HARVEST_GRADES.map(value => <option key={value} value={value}>{GRADE_LABELS[value]}</option>)}</select></FormField><FormField label="Bagian kualitas A (%)"><Input type="number" min="0" max="100" value={harvestForm.gradeAPct} onChange={event => setHarvestForm({ ...harvestForm, gradeAPct: event.target.value })} /></FormField><div className="sm:col-span-2"><FormField label="Alasan koreksi" hint="Contoh: salah membaca timbangan"><Input maxLength="300" value={harvestForm.correctionReason} onChange={event => setHarvestForm({ ...harvestForm, correctionReason: event.target.value })} /></FormField></div></div><DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Batal</Button><Button disabled={saving === 'correction'} onClick={submitCorrection}>Simpan koreksi</Button></DialogFooter></DialogContent></Dialog>
    </>
  );
}
