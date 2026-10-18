import React, { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import Sidebar from './Sidebar.jsx';
import TopNavbar from './TopNavbar.jsx';
import ContextBar from './ContextBar.jsx';
import EmailVerificationBanner from './EmailVerificationBanner.jsx';
import { Button } from '@/components/ui/button';
import { FarmProvider, useFarmContext } from '@/contexts/FarmContext';
import { IotProvider } from '@/contexts/IotContext';

// Tingkat filter konteks yang dibutuhkan tiap halaman. Farm dipilih di navbar (FarmSwitcher), jadi
// halaman tingkat 'farm' atau yang tidak tercantum tidak menampilkan filter atas; 'kumbung' =
// dropdown kumbung, 'sensor' = kumbung + sensor.
const CONTEXT_LEVELS = {
  '/': 'sensor',
  '/monitoring': 'sensor',
  '/automation': 'kumbung',
  '/operations': 'kumbung',
  '/devices': 'farm',
  '/farm-members': 'farm',
  '/alerts': 'farm',
  '/historical': 'farm',
  '/reports': 'farm',
  '/settings': 'farm',
};

/** Banner saat admin Tandurai membuka dashboard farm klien. */
function AdminFarmBanner() {
  const { farm, exitFarmView } = useFarmContext();
  const navigate = useNavigate();
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center">
      <ShieldCheck className="shrink-0 text-violet-600" size={18} />
      <p className="flex-1">
        <span className="font-semibold">Mode admin</span> · Anda melihat farm <span className="font-semibold">{farm?.name || '—'}</span> sebagai admin Tandurai.
        Perubahan tercatat atas nama Anda di audit farm.
      </p>
      <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => { exitFarmView(); navigate('/admin'); }}>
        Kembali ke Konsol Admin
      </Button>
    </div>
  );
}

/**
 * Isi layout + aturan akses: admin Tandurai langsung ke konsol admin (/admin) dan hanya melihat
 * farm klien lewat "Buka dashboard farm"; pengguna biasa tidak bisa membuka rute /admin.
 */
function LayoutBody() {
  const { pathname } = useLocation();
  const { profile, error, isAdmin, adminConsole, exitFarmView } = useFarmContext();
  const onAdminPath = pathname.startsWith('/admin');

  // Membuka rute /admin dari mode farm klien = kembali ke konsol.
  useEffect(() => {
    if (isAdmin && onAdminPath && !adminConsole) exitFarmView();
  }, [isAdmin, onAdminPath, adminConsole, exitFarmView]);

  if (!profile && !error) {
    return <div className="flex min-h-[50vh] items-center justify-center gap-2 text-muted-foreground"><Loader2 className="animate-spin" />Memuat akun…</div>;
  }
  if (adminConsole && !onAdminPath) return <Navigate to="/admin" replace />;
  if (profile && !isAdmin && onAdminPath) return <Navigate to="/" replace />;

  const level = onAdminPath ? null : CONTEXT_LEVELS[pathname] || null;
  return (
    <>
      <EmailVerificationBanner />
      {isAdmin && !adminConsole && !onAdminPath && <AdminFarmBanner />}
      {!onAdminPath && <ContextBar level={level} />}
      <Outlet />
    </>
  );
}

export default function DashboardLayout() {
  return (
    <IotProvider>
      <FarmProvider>
        <div className="min-h-screen bg-background">
          <Sidebar />
          <div className="lg:pl-64">
            <TopNavbar />
            <main className="p-4 lg:p-6">
              <LayoutBody />
            </main>
          </div>
        </div>
      </FarmProvider>
    </IotProvider>
  );
}
