import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Building2, CalendarDays, Leaf, Loader2, PackagePlus, Save, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { auth, db } from '../firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  BATCH_STATUSES,
  GROWTH_STAGES,
  HARVEST_GRADES,
  KUMBUNG_STATUSES,
  SUBSTRATE_TYPES,
  buildBatchPayload,
  buildFarmPayload,
  buildHarvestPayload,
  buildKumbungPayload,
  nextBatchId,
  nextKumbungId,
} from '@/lib/operations';
import {
  createBatch,
  createHarvestEvent,
  createKumbung,
  loadOperations,
  saveFarm,
  updateBatchLifecycle,
} from '@/lib/operationsService';

const fieldClass = 'w-full h-10 rounded-md border border-input bg-background px-3 text-sm';
const jakartaNowInput = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
const todayJakarta = () => jakartaNowInput().slice(0, 10);

const initialKumbung = { farmId: '', name: '', capacityBaglog: '1000', status: 'active' };
const initialBatch = {
  farmId: '', kumbungId: '', startedDate: todayJakarta(), baglogCountInitial: '1000',
  baglogCountActive: '1000', substrateType: 'serbuk-kayu', growthStage: 'inoculation',
  contaminationPct: '0', status: 'active',
};
const initialHarvest = {
  farmId: '', kumbungId: '', batchId: '', harvestedAt: jakartaNowInput(),
  weightKg: '', grade: 'A', gradeAPct: '100', notes: '',
};

function FormField({ label, children }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

export default function OperationsPage() {
  const [data, setData] = useState({ role: 'viewer', farms: [], kumbungs: [], batches: [], harvestEvents: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [selectedFarmId, setSelectedFarmId] = useState('');
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
      const farmId = selectedFarmId || result.farms[0]?.id || '';
      setSelectedFarmId(farmId);
    } catch (error) {
      toast.error(error.message || 'Gagal memuat data operasional');
    } finally {
      setLoading(false);
    }
  }, [selectedFarmId]);

  useEffect(() => { refresh(); }, [refresh]);

  const canManage = data.role === 'manager' || data.role === 'admin';
  const canHarvest = canManage || data.role === 'operator';
  const selectedFarm = data.farms.find(farm => farm.id === selectedFarmId);
  const farmKumbungs = useMemo(
    () => data.kumbungs.filter(kumbung => kumbung.farmId === selectedFarmId),
    [data.kumbungs, selectedFarmId],
  );
  const activeBatches = data.batches.filter(batch => batch.status === 'active');

  useEffect(() => {
    if (!selectedFarm) return;
    setFarmForm({ name: selectedFarm.name || '', location: selectedFarm.location || 'Indonesia', status: selectedFarm.status || 'active' });
    setKumbungForm(previous => ({ ...previous, farmId: selectedFarm.id }));
    setBatchForm(previous => ({ ...previous, farmId: selectedFarm.id, kumbungId: farmKumbungs[0]?.id || '' }));
    setHarvestForm(previous => ({ ...previous, farmId: selectedFarm.id, kumbungId: farmKumbungs[0]?.id || '', batchId: '' }));
  }, [selectedFarm, farmKumbungs]);

  const runSave = async (key, action, success) => {
    setSaving(key);
    try {
      await action();
      toast.success(success);
      await refresh();
    } catch (error) {
      toast.error(error.message || 'Data gagal disimpan');
    } finally {
      setSaving('');
    }
  };

  const handleFarm = () => runSave('farm', async () => {
    if (!canManage || !selectedFarm) throw new Error('Role tidak memiliki izin mengubah farm');
    await saveFarm(db, selectedFarm.id, buildFarmPayload(farmForm, selectedFarm));
  }, 'Data farm berhasil disimpan');

  const handleKumbung = () => runSave('kumbung', async () => {
    if (!canManage) throw new Error('Hanya manager/admin yang dapat membuat kumbung');
    const id = nextKumbungId(kumbungForm.farmId, data.kumbungs.map(item => item.id));
    await createKumbung(db, id, buildKumbungPayload(kumbungForm, auth.currentUser.uid));
    setKumbungForm(previous => ({ ...initialKumbung, farmId: previous.farmId }));
  }, 'Kumbung baru berhasil dibuat');

  const handleBatch = () => runSave('batch', async () => {
    if (!canManage) throw new Error('Hanya manager/admin yang dapat membuat batch');
    const kumbung = data.kumbungs.find(item => item.id === batchForm.kumbungId);
    const id = nextBatchId(batchForm.kumbungId, data.batches.map(item => item.id));
    await createBatch(db, id, buildBatchPayload(batchForm, kumbung, auth.currentUser.uid));
    setBatchForm(previous => ({ ...initialBatch, farmId: previous.farmId, kumbungId: previous.kumbungId }));
  }, 'Batch baglog berhasil dibuat');

  const advanceBatch = batch => runSave(`advance-${batch.id}`, async () => {
    const index = GROWTH_STAGES.indexOf(batch.growthStage);
    const nextStage = GROWTH_STAGES[Math.min(index + 1, GROWTH_STAGES.length - 1)];
    const status = nextStage === 'completed' ? 'completed' : batch.status;
    await updateBatchLifecycle(db, batch.id, batch, { growthStage: nextStage, status });
  }, 'Lifecycle batch diperbarui');

  const handleHarvest = () => runSave('harvest', async () => {
    if (!canHarvest) throw new Error('Role tidak memiliki izin mencatat panen');
    const batch = data.batches.find(item => item.id === harvestForm.batchId);
    const payload = buildHarvestPayload(harvestForm, batch, auth.currentUser.uid);
    await createHarvestEvent(db, harvestForm.kumbungId, payload);
    setHarvestForm(previous => ({ ...initialHarvest, farmId: previous.farmId, kumbungId: previous.kumbungId }));
  }, 'Panen tersimpan sebagai event append-only');

  if (loading && !data.farms.length) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <>
      <Helmet><title>Operasional Kumbung — Tandurai</title></Helmet>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Operasional Kumbung</h1>
            <p className="text-sm text-muted-foreground">Master lokasi, lifecycle baglog, dan pencatatan panen untuk sumber fitur AI.</p>
          </div>
          <Badge variant="outline" className="w-fit capitalize">Role: {data.role}</Badge>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ['Farm', data.farms.length], ['Kumbung', data.kumbungs.length],
            ['Batch aktif', activeBatches.length], ['Event panen', data.harvestEvents.length],
          ].map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-black">{value}</p></CardContent></Card>)}
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Building2 size={19} /> Farm dan Kumbung</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <FormField label="Farm aktif">
              <select className={fieldClass} value={selectedFarmId} onChange={event => setSelectedFarmId(event.target.value)}>
                {data.farms.map(farm => <option key={farm.id} value={farm.id}>{farm.id} — {farm.name}</option>)}
              </select>
            </FormField>
            <div className="grid md:grid-cols-3 gap-4">
              <FormField label="Nama farm"><Input value={farmForm.name} onChange={event => setFarmForm({ ...farmForm, name: event.target.value })} /></FormField>
              <FormField label="Lokasi"><Input value={farmForm.location} onChange={event => setFarmForm({ ...farmForm, location: event.target.value })} /></FormField>
              <FormField label="Status"><select className={fieldClass} value={farmForm.status} onChange={event => setFarmForm({ ...farmForm, status: event.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></FormField>
            </div>
            <Button disabled={!canManage || saving === 'farm'} onClick={handleFarm}><Save size={16} className="mr-2" /> Simpan Farm</Button>

            <div className="border-t pt-5 grid md:grid-cols-4 gap-4">
              <FormField label="Nama kumbung"><Input value={kumbungForm.name} onChange={event => setKumbungForm({ ...kumbungForm, name: event.target.value })} /></FormField>
              <FormField label="Kapasitas baglog"><Input type="number" min="1" value={kumbungForm.capacityBaglog} onChange={event => setKumbungForm({ ...kumbungForm, capacityBaglog: event.target.value })} /></FormField>
              <FormField label="Status"><select className={fieldClass} value={kumbungForm.status} onChange={event => setKumbungForm({ ...kumbungForm, status: event.target.value })}>{KUMBUNG_STATUSES.map(value => <option key={value}>{value}</option>)}</select></FormField>
              <div className="flex items-end"><Button className="w-full" disabled={!canManage || saving === 'kumbung'} onClick={handleKumbung}><PackagePlus size={16} className="mr-2" /> Tambah Kumbung</Button></div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {farmKumbungs.map(kumbung => <div key={kumbung.id} className="rounded-lg border p-3"><p className="font-bold">{kumbung.name}</p><p className="text-xs text-muted-foreground">{kumbung.id} · kapasitas {Number(kumbung.capacityBaglog || 0).toLocaleString('id-ID')} baglog</p><Badge variant="secondary" className="mt-2 capitalize">{kumbung.status}</Badge></div>)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Leaf size={19} /> Batch Baglog</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <FormField label="Kumbung"><select className={fieldClass} value={batchForm.kumbungId} onChange={event => setBatchForm({ ...batchForm, kumbungId: event.target.value })}><option value="">Pilih kumbung</option>{farmKumbungs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField>
              <FormField label="Tanggal mulai"><Input type="date" value={batchForm.startedDate} onChange={event => setBatchForm({ ...batchForm, startedDate: event.target.value })} /></FormField>
              <FormField label="Baglog awal"><Input type="number" value={batchForm.baglogCountInitial} onChange={event => setBatchForm({ ...batchForm, baglogCountInitial: event.target.value })} /></FormField>
              <FormField label="Baglog aktif"><Input type="number" value={batchForm.baglogCountActive} onChange={event => setBatchForm({ ...batchForm, baglogCountActive: event.target.value })} /></FormField>
              <FormField label="Substrat"><select className={fieldClass} value={batchForm.substrateType} onChange={event => setBatchForm({ ...batchForm, substrateType: event.target.value })}>{SUBSTRATE_TYPES.map(value => <option key={value}>{value}</option>)}</select></FormField>
              <FormField label="Growth stage"><select className={fieldClass} value={batchForm.growthStage} onChange={event => setBatchForm({ ...batchForm, growthStage: event.target.value })}>{GROWTH_STAGES.map(value => <option key={value}>{value}</option>)}</select></FormField>
              <FormField label="Kontaminasi (%)"><Input type="number" min="0" max="100" step="0.1" value={batchForm.contaminationPct} onChange={event => setBatchForm({ ...batchForm, contaminationPct: event.target.value })} /></FormField>
              <FormField label="Status"><select className={fieldClass} value={batchForm.status} onChange={event => setBatchForm({ ...batchForm, status: event.target.value })}>{BATCH_STATUSES.map(value => <option key={value}>{value}</option>)}</select></FormField>
            </div>
            <Button disabled={!canManage || !batchForm.kumbungId || saving === 'batch'} onClick={handleBatch}><PackagePlus size={16} className="mr-2" /> Buat Batch</Button>
            <div className="space-y-2">
              {data.batches.map(batch => <div key={batch.id} className="rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center gap-3"><div className="flex-1"><p className="font-bold">{batch.id}</p><p className="text-xs text-muted-foreground">{batch.growthStage} · {batch.baglogCountActive}/{batch.baglogCountInitial} aktif · kontaminasi {batch.contaminationPct}%</p></div><Badge className="w-fit capitalize" variant={batch.status === 'active' ? 'default' : 'secondary'}>{batch.status}</Badge>{canManage && batch.status === 'active' && <Button size="sm" variant="outline" disabled={saving === `advance-${batch.id}`} onClick={() => advanceBatch(batch)}>Tahap Berikutnya</Button>}</div>)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Scale size={19} /> Catat Panen</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <FormField label="Kumbung"><select className={fieldClass} value={harvestForm.kumbungId} onChange={event => setHarvestForm({ ...harvestForm, kumbungId: event.target.value, batchId: '' })}><option value="">Pilih kumbung</option>{farmKumbungs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField>
              <FormField label="Batch"><select className={fieldClass} value={harvestForm.batchId} onChange={event => setHarvestForm({ ...harvestForm, batchId: event.target.value })}><option value="">Pilih batch</option>{activeBatches.filter(item => item.kumbungId === harvestForm.kumbungId).map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></FormField>
              <FormField label="Waktu panen"><Input type="datetime-local" value={harvestForm.harvestedAt} onChange={event => setHarvestForm({ ...harvestForm, harvestedAt: event.target.value })} /></FormField>
              <FormField label="Berat (kg)"><Input type="number" min="0.01" step="0.01" value={harvestForm.weightKg} onChange={event => setHarvestForm({ ...harvestForm, weightKg: event.target.value })} /></FormField>
              <FormField label="Grade"><select className={fieldClass} value={harvestForm.grade} onChange={event => setHarvestForm({ ...harvestForm, grade: event.target.value })}>{HARVEST_GRADES.map(value => <option key={value}>{value}</option>)}</select></FormField>
              <FormField label="Grade A (%)"><Input type="number" min="0" max="100" step="0.1" value={harvestForm.gradeAPct} onChange={event => setHarvestForm({ ...harvestForm, gradeAPct: event.target.value })} /></FormField>
              <div className="sm:col-span-2"><FormField label="Catatan"><Input maxLength="500" value={harvestForm.notes} onChange={event => setHarvestForm({ ...harvestForm, notes: event.target.value })} /></FormField></div>
            </div>
            <Button disabled={!canHarvest || !harvestForm.batchId || saving === 'harvest'} onClick={handleHarvest}><Save size={16} className="mr-2" /> Simpan Event Panen</Button>
            <div className="space-y-2">
              {data.harvestEvents.slice(0, 10).map(event => <div key={event.id} className="rounded-lg border p-3 flex items-center gap-3"><CalendarDays size={18} className="text-primary" /><div className="flex-1"><p className="font-semibold">{event.weightKg} kg · Grade {event.grade}</p><p className="text-xs text-muted-foreground">{event.batchId} · {new Date(event.harvestedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</p></div><Badge variant="outline">A {event.gradeAPct}%</Badge></div>)}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
