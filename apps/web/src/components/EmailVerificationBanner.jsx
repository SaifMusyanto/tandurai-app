import React, { useState } from 'react';
import { MailWarning, Loader2 } from 'lucide-react';
import { sendEmailVerification } from 'firebase/auth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { auth } from '../firebase';
import { useFarmContext } from '@/contexts/FarmContext';

/**
 * Akun email/password yang belum memverifikasi email tidak bisa diundang sebagai operator.
 * Banner ini mengirim ulang link verifikasi (layanan email Firebase) dan memuat ulang status
 * setelah pengguna mengklik link tersebut. Akun Google selalu terverifikasi sehingga tidak tampil.
 */
export default function EmailVerificationBanner() {
  const { refreshProfile } = useFarmContext();
  const [verified, setVerified] = useState(() => auth.currentUser?.emailVerified !== false);
  const [busy, setBusy] = useState('');

  if (verified || !auth.currentUser?.email) return null;

  const resend = async () => {
    setBusy('send');
    try {
      await sendEmailVerification(auth.currentUser);
      toast.success(`Link verifikasi dikirim ke ${auth.currentUser.email}. Cek juga folder spam.`);
    } catch (error) {
      toast.error(error.code === 'auth/too-many-requests' ? 'Terlalu sering. Tunggu beberapa menit lalu coba lagi.' : error.message);
    } finally {
      setBusy('');
    }
  };

  const check = async () => {
    setBusy('check');
    try {
      await auth.currentUser.reload();
      if (!auth.currentUser.emailVerified) {
        toast.error('Email belum terverifikasi. Klik link di email terlebih dahulu.');
        return;
      }
      await auth.currentUser.getIdToken(true); // token baru membawa status terverifikasi ke backend
      await refreshProfile();
      setVerified(true);
      toast.success('Email terverifikasi.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-300">
      <MailWarning size={16} aria-hidden />
      <span className="flex-1 min-w-[12rem]">
        Email <b>{auth.currentUser.email}</b> belum terverifikasi. Klik link verifikasi di email agar akun ini bisa ditambahkan sebagai operator farm.
      </span>
      <Button size="sm" variant="outline" className="h-7 bg-background" onClick={resend} disabled={Boolean(busy)}>
        {busy === 'send' && <Loader2 size={12} className="mr-1 animate-spin" />}Kirim ulang
      </Button>
      <Button size="sm" className="h-7" onClick={check} disabled={Boolean(busy)}>
        {busy === 'check' && <Loader2 size={12} className="mr-1 animate-spin" />}Saya sudah verifikasi
      </Button>
    </div>
  );
}
