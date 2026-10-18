import React, { useEffect, useState } from 'react';
import { Loader2, MapPin, PackagePlus, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { auth } from '../../firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { KUMBUNG_STATUSES, buildFarmPayload, buildKumbungPayload } from '@/lib/operations';
import { createKumbung, saveFarm, saveKumbung } from '@/lib/operationsService';
import { STATUS_LABELS } from '@/lib/operationsView';
import { FieldBlock } from './controls';

const selectClass = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base';

function FarmDialog({ farm, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', location: '', status: 'active' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (farm) setForm({ name: farm.name || '', location: farm.location || 'Indonesia', status: farm.status || 'active' }); }, [farm]);
  if (!farm) return null;
  const submit = async () => {
    setSaving(true);
    try {
      await saveFarm(farm.id, buildFarmPayload(form, farm));
      toast.success('Data farm diperbarui');
      onSaved?.(); onClose();
    } catch (error) { toast.error(error.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={value => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Ubah data farm</DialogTitle><DialogDescription>Nama, lokasi, atau status farm.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <FieldBlock label="Nama farm" htmlFor="farm-name"><Input id="farm-name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="h-12 text-base" /></FieldBlock>
          <FieldBlock label="Lokasi" htmlFor="farm-location"><Input id="farm-location" value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} className="h-12 text-base" /></FieldBlock>
          <FieldBlock label="Status" htmlFor="farm-status">
            <select id="farm-status" className={selectClass} value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option value="active">Aktif</option><option value="inactive">Tidak aktif</option></select>
          </FieldBlock>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-12" onClick={onClose}>Batal</Button>
          <Button className="h-12" onClick={submit} disabled={saving}>{saving && <Loader2 size={16} className="mr-2 animate-spin" />}Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KumbungDialog({ state, farmId, onClose, onSaved }) {
  const editing = state?.kumbung;
  const [form, setForm] = useState({ name: '', capacityBaglog: '1000', status: 'active' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (state) setForm(editing ? { name: editing.name, capacityBaglog: String(editing.capacityBaglog), status: editing.status } : { name: '', capacityBaglog: '1000', status: 'active' });
  }, [state, editing]);
  if (!state) return null;
  const submit = async () => {
    setSaving(true);
    try {
      const built = buildKumbungPayload({ ...form, farmId }, auth.currentUser.uid);
      const saved = editing ? await saveKumbung(editing.id, built) : await createKumbung(farmId, built);
      toast.success(editing ? 'Kumbung diperbarui' : 'Kumbung baru dibuat');
      onSaved?.(editing ? null : saved); onClose();
    } catch (error) { toast.error(error.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={value => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{editing ? 'Ubah kumbung' : 'Tambah kumbung'}</DialogTitle><DialogDescription>Pakai nama yang mudah dikenali pekerja di lapangan.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <FieldBlock label="Nama kumbung" hint="Contoh: Kumbung Timur" htmlFor="kumbung-name"><Input id="kumbung-name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="h-12 text-base" /></FieldBlock>
          <FieldBlock label="Kapasitas maksimal baglog" htmlFor="kumbung-capacity"><Input id="kumbung-capacity" inputMode="numeric" value={form.capacityBaglog} onChange={event => setForm({ ...form, capacityBaglog: event.target.value.replace(/[^\d]/g, '') })} className="h-12 text-base" /></FieldBlock>
          <FieldBlock label="Status" htmlFor="kumbung-status">
            <select id="kumbung-status" className={selectClass} value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>
              {KUMBUNG_STATUSES.map(value => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
            </select>
          </FieldBlock>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-12" onClick={onClose}>Batal</Button>
          <Button className="h-12" onClick={submit} disabled={saving}>{saving && <Loader2 size={16} className="mr-2 animate-spin" />}{editing ? 'Simpan' : 'Buat kumbung'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Data farm & daftar kumbung (owner). Data tidak dihapus; pakai status Tidak aktif. */
export default function FarmKumbungSettings({ farm, kumbungs, selectedKumbungId, onSaved, onKumbungCreated }) {
  const [farmDialog, setFarmDialog] = useState(null);
  const [kumbungDialog, setKumbungDialog] = useState(null);

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg"><MapPin size={18} />{farm.name}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{farm.location}</p>
          </div>
          <Button variant="outline" className="h-11 shrink-0" onClick={() => setFarmDialog(farm)}><Pencil size={15} className="mr-1" />Ubah</Button>
        </CardHeader>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Daftar kumbung</h2>
          <p className="text-sm text-muted-foreground">Kumbung tidak dihapus agar riwayat tetap aman; pakai status “Tidak aktif”.</p>
        </div>
        <Button className="h-12" onClick={() => setKumbungDialog({ kumbung: null })}><PackagePlus size={18} className="mr-2" />Tambah kumbung</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {kumbungs.map(item => (
          <Card key={item.id} className={item.id === selectedKumbungId ? 'border-emerald-500/40 shadow-sm' : 'shadow-sm'}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{item.name}</p>
                  <p className="text-sm text-muted-foreground">{Number(item.capacityBaglog).toLocaleString('id-ID')} baglog</p>
                </div>
                <Badge variant={item.status === 'active' ? 'secondary' : 'outline'}>{STATUS_LABELS[item.status] || item.status}</Badge>
              </div>
              <Button variant="outline" className="h-11 w-full" onClick={() => setKumbungDialog({ kumbung: item })}><Pencil size={15} className="mr-1" />Ubah kumbung</Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <FarmDialog farm={farmDialog} onClose={() => setFarmDialog(null)} onSaved={onSaved} />
      <KumbungDialog state={kumbungDialog} farmId={farm.id} onClose={() => setKumbungDialog(null)}
        onSaved={created => { onSaved?.(); if (created) onKumbungCreated?.(created); }} />
    </div>
  );
}
