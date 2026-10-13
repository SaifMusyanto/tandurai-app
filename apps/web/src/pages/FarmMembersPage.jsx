import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Users, UserPlus, UserMinus, Loader2, Info, Crown, User } from 'lucide-react';
import { toast } from 'sonner';

import { auth } from '../firebase';
import { useFarmContext } from '@/contexts/FarmContext';
import { addFarmOperator, removeFarmOperator, subscribeFarmMembers } from '@/lib/deviceManagementService';
import AssignmentLogPanel from '@/components/AssignmentLogPanel';
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
      await addFarmOperator({ farmId: farm.id, email });
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
      await removeFarmOperator({ farmId: farm.id, uid: member.uid });
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

  useEffect(() => {
    if (!farm?.id) return undefined;
    setLoading(true);
    setError('');
    return subscribeFarmMembers(farm.id, list => {
      setMembers(list);
      setLoading(false);
    }, err => {
      setError(err.message);
      setLoading(false);
    });
  }, [farm?.id]);

  // Owner lama yang di-seed manual mungkin belum tercatat di farmMembers.
  const selfListed = members.some(member => member.uid === currentUser?.uid);
  const rows = !selfListed && farm && currentUser
    ? [{ uid: currentUser.uid, email: currentUser.email, role: farm.role, status: 'active', unlisted: true }, ...members]
    : members;

  return (
    <>
      <Helmet><title>Anggota Farm - Tandurai</title></Helmet>
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 pr-3 font-medium">Akun</th>
                      <th className="py-2 pr-3 font-medium">Role</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Bergabung</th>
                      {isOwner && <th className="py-2 font-medium text-right">Aksi</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(member => (
                      <tr key={member.uid} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <p className="font-medium flex items-center gap-1.5">
                            {member.role === 'owner' ? <Crown size={14} className="text-yellow-600" aria-hidden /> : <User size={14} className="text-muted-foreground" aria-hidden />}
                            {member.email || member.uid}
                            {member.uid === currentUser?.uid && <span className="text-xs text-muted-foreground">(Anda)</span>}
                          </p>
                          {member.unlisted && <p className="text-xs text-yellow-700 dark:text-yellow-400">Belum tercatat di daftar anggota; akses berasal dari role akun.</p>}
                        </td>
                        <td className="py-2 pr-3"><Badge variant="outline">{member.role}</Badge></td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline" className={member.status === 'active' ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-muted text-muted-foreground'}>
                            {member.status === 'active' ? 'Aktif' : member.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {member.createdAt ? new Date(member.createdAt).toLocaleDateString('id-ID', { dateStyle: 'medium' }) : '—'}
                        </td>
                        {isOwner && (
                          <td className="py-2 text-right">
                            {member.role === 'operator' && (
                              <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => setRemoveTarget(member)}>
                                <UserMinus size={14} className="mr-1" /> Cabut
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {farm && <AssignmentLogPanel key={`log-${farm.id}`} farmId={farm.id} />}
      </div>
    </>
  );
}
