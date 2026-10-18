import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Users, UserPlus, UserMinus, Loader2, Info, Crown, User } from 'lucide-react';
import { toast } from 'sonner';

import { auth } from '../firebase';
import { useFarmContext } from '@/contexts/FarmContext';
import { useIot } from '@/contexts/IotContext';
import { api } from '@/lib/api';
import AssignmentLogPanel from '@/components/AssignmentLogPanel';
import DataTable from '@/components/DataTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AddOperatorDialog({ open, farm, onClose }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = EMAIL_PATTERN.test(email.trim());

  useEffect(() => { if (open) setEmail(''); }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await api.addMember(farm.id, email.trim());
      toast.success(`${email.trim()} ditambahkan sebagai operator ${farm.name}.`);
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah operator</DialogTitle>
          <DialogDescription>
            Operator dapat melihat seluruh kumbung dan data {farm?.name}, serta menjalankan operasi harian.
            Operator tidak dapat mengelola anggota atau perangkat.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="operator-email">Email akun karyawan</Label>
            <Input id="operator-email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="karyawan@contoh.com" autoFocus />
          </div>
          <div className="flex gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <Info size={14} className="shrink-0 mt-0.5" aria-hidden />
            <p>Karyawan harus sudah punya akun Tandurai, sudah memverifikasi email, dan pernah login sekali agar emailnya terdaftar.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
            <Button type="submit" disabled={busy || !valid}>
              {busy ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <UserPlus size={15} className="mr-1.5" />}
              Tambahkan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveOperatorDialog({ member, farm, onClose }) {
  const [busy, setBusy] = useState(false);

  const run = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.removeMember(farm.id, member.uid);
      toast.success(`${member.email || member.uid} dicabut dari ${farm.name}.`);
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={Boolean(member)} onOpenChange={value => !value && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cabut {member?.email || member?.uid}?</AlertDialogTitle>
          <AlertDialogDescription>
            Akun ini langsung kehilangan akses ke {farm?.name} dan seluruh kumbungnya. Data yang pernah dicatat tetap tersimpan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
          <AlertDialogAction onClick={run} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white">
            {busy && <Loader2 size={15} className="mr-1.5 animate-spin" />}
            Cabut akses
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function FarmMembersPage() {
  const { farm, isOwner, loading: contextLoading } = useFarmContext();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const currentUser = auth.currentUser;
  const { subscribe } = useIot();
  const farmId = farm?.id;

  const load = useCallback(async () => {
    if (!farmId) return;
    try {
      setMembers(await api.members(farmId));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => {
    setLoading(true);
    setError('');
    load();
  }, [load]);

  // Perubahan anggota (oleh owner lain / dialog di halaman ini) datang lewat SSE `changed`.
  useEffect(() => subscribe('changed', event => {
    if (event.entity === 'member' && event.farmId === farmId) load();
  }), [subscribe, load, farmId]);

  const rows = members;

  return (
    <>
      <Helmet><title>Anggota Farm - Dashboard Tandurai</title></Helmet>
      <AddOperatorDialog open={addOpen} farm={farm} onClose={() => setAddOpen(false)} />
      <RemoveOperatorDialog member={removeTarget} farm={farm} onClose={() => setRemoveTarget(null)} />

      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Anggota Farm</h1>
            <p className="text-muted-foreground">
              Role berlaku untuk seluruh kumbung di {farm?.name || 'farm terpilih'}: owner mengelola anggota dan perangkat, operator menjalankan operasi harian.
            </p>
          </div>
          {isOwner && (
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus size={16} className="mr-2" /> Tambah operator
            </Button>
          )}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Users size={18} /> Daftar anggota</CardTitle>
          </CardHeader>
          <CardContent>
            {contextLoading || (farm && loading) ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="animate-spin" size={18} /> Memuat anggota…
              </div>
            ) : !farm ? (
              <p className="py-6 text-center text-muted-foreground">Pilih farm terlebih dahulu.</p>
            ) : error ? (
              <p className="py-6 text-center text-red-600">Gagal memuat anggota: {error}</p>
            ) : (
              <DataTable
                rows={rows}
                rowKey={member => member.uid}
                emptyText="Belum ada anggota."
                columns={[
                  {
                    key: 'account', header: 'Akun', cell: member => (
                      <>
                        <p className="font-medium flex items-center gap-1.5">
                          {member.role === 'owner' ? <Crown size={14} className="text-yellow-600" aria-hidden /> : <User size={14} className="text-muted-foreground" aria-hidden />}
                          {member.email || member.uid}
                          {member.uid === currentUser?.uid && <span className="text-xs text-muted-foreground">(Anda)</span>}
                        </p>
                        {member.username && member.email && <p className="text-xs text-muted-foreground">{member.username}</p>}
                      </>
                    ),
                  },
                  { key: 'role', header: 'Role', cell: member => <Badge variant="outline">{member.role}</Badge> },
                  {
                    key: 'status', hideOnMobile: true, header: 'Status', cell: member => (
                      <Badge variant="outline" className={member.status === 'active' ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-muted text-muted-foreground'}>
                        {member.status === 'active' ? 'Aktif' : member.status}
                      </Badge>
                    ),
                  },
                  { key: 'joined', hideOnMobile: true, header: 'Bergabung', className: 'text-xs text-muted-foreground', cell: member => (member.createdAt ? new Date(member.createdAt).toLocaleDateString('id-ID', { dateStyle: 'medium' }) : '—') },
                  ...(isOwner ? [{
                    key: 'actions', header: <span className="sr-only">Aksi</span>, className: 'text-right', cell: member => member.role === 'operator' && (
                      <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => setRemoveTarget(member)}>
                        <UserMinus size={14} className="mr-1" /> Cabut
                      </Button>
                    ),
                  }] : []),
                ]}
              />
            )}
          </CardContent>
        </Card>

        {farm && <AssignmentLogPanel key={`log-${farm.id}`} farmId={farm.id} />}
      </div>
    </>
  );
}
