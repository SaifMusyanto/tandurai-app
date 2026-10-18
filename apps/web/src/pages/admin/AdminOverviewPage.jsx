import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Building2, CheckCircle2, Cpu, Leaf, Loader2, Radio, RefreshCw, Scale, Users, Warehouse, WifiOff, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFarmContext } from '@/contexts/FarmContext';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { timeAgo } from './adminFormat';

const WORKER_STALE_MS = 10 * 60 * 1000;

function Kpi({ icon: Icon, label, value, sub, tone }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon size={14} />{label}</p>
        <p className={cn('mt-1 text-2xl font-bold', tone)}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function HealthRow({ label, ok, detail }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm">{label}</span>
      <span className={cn('flex items-center gap-1 text-sm font-medium', ok ? 'text-emerald-600' : 'text-red-600')}>
        {ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{detail}
      </span>
    </li>
  );
}

/** Daftar "perlu perhatian" dengan tombol membuka dashboard farm terkait. */
function AttentionList({ title, icon: Icon, items, render, empty, onOpen }) {
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="flex items-center gap-2 text-base"><Icon size={16} />{title} <span className="font-normal text-muted-foreground">({items.length})</span></CardTitle></CardHeader>
      <CardContent>
        {!items.length ? <p className="py-3 text-sm text-muted-foreground">{empty}</p> : (
          <ul className="divide-y">
            {items.map(item => (
              <li key={item.id} className="flex items-start justify-between gap-2 py-2.5">
                <div className="min-w-0 text-sm">{render(item)}</div>
                <Button size="sm" variant="ghost" className="h-9 shrink-0" onClick={() => onOpen(item.farmId)}>Buka<ArrowRight size={14} className="ml-1" /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Konsol admin: ringkasan seluruh sistem Tandurai. */
export default function AdminOverviewPage() {
  const { enterFarmAsAdmin } = useFarmContext();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.adminOverview());
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const openFarm = farmId => { enterFarmAsAdmin(farmId); navigate('/'); };

  if (!data) {
    return <div className="flex min-h-[50vh] items-center justify-center gap-2 text-muted-foreground"><Loader2 className="animate-spin" />Memuat ringkasan sistem…</div>;
  }
  const { counts, health, attention } = data;
  const workerFresh = health.worker?.updatedAt && Date.now() - health.worker.updatedAt < WORKER_STALE_MS;

  return (
    <>
      <Helmet><title>Konsol Admin - Dashboard Tandurai</title></Helmet>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Ringkasan Sistem</h1>
            <p className="text-sm text-muted-foreground">Semua farm klien Tandurai · diperbarui {timeAgo(data.generatedAt)} (otomatis tiap menit)</p>
          </div>
          <Button variant="outline" className="h-10" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={cn('mr-2', loading && 'animate-spin')} />Muat ulang
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi icon={Users} label="Pengguna" value={counts.users} sub={`${counts.users_active_7d} aktif 7 hari terakhir`} />
          <Kpi icon={Building2} label="Farm aktif" value={counts.farms} sub={`${counts.kumbungs} kumbung`} />
          <Kpi icon={Cpu} label="Gateway online" value={`${counts.gateways_online}/${counts.gateways}`} sub={`${counts.devices_unclaimed} perangkat belum diklaim`} tone={counts.gateways_online < counts.gateways ? 'text-amber-600' : undefined} />
          <Kpi icon={Radio} label="Sensor mengirim data" value={`${counts.sensors_live}/${counts.sensors}`} sub="30 menit terakhir" tone={counts.sensors_live < counts.sensors ? 'text-amber-600' : undefined} />
          <Kpi icon={AlertTriangle} label="Alert kritis aktif" value={counts.alerts_critical} sub={`${counts.alerts_warning} peringatan`} tone={counts.alerts_critical ? 'text-red-600' : 'text-emerald-600'} />
          <Kpi icon={Leaf} label="Batch berjalan" value={counts.batches_active} />
          <Kpi icon={Scale} label="Panen 30 hari" value={`${Number(counts.harvest_kg_30d).toLocaleString('id-ID')} kg`} sub="semua farm" />
          <Kpi icon={Warehouse} label="Kumbung aktif" value={counts.kumbungs} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-base">Kesehatan layanan</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y">
                <HealthRow label="Backend API" ok={health.api} detail="berjalan" />
                <HealthRow label="Database" ok={health.database} detail={health.database ? 'tersambung' : 'gagal'} />
                <HealthRow label="Broker MQTT" ok={health.mqtt} detail={health.mqtt ? 'tersambung' : 'terputus'} />
                <HealthRow label="AI worker" ok={Boolean(workerFresh)} detail={health.worker ? `aktif ${timeAgo(health.worker.updatedAt)}` : 'belum pernah aktif'} />
                <li className="flex items-center justify-between gap-3 py-2"><span className="text-sm">Koneksi realtime</span><Badge variant="outline">{health.realtimeClients} sesi</Badge></li>
              </ul>
            </CardContent>
          </Card>
          <div className="lg:col-span-2">
            <AttentionList
              title="Alert kritis" icon={AlertTriangle} items={attention.criticalAlerts} onOpen={openFarm}
              empty="Tidak ada alert kritis. Semua kumbung aman."
              render={item => (
                <>
                  <p className="font-semibold text-red-600">{item.type}</p>
                  <p className="text-xs text-muted-foreground">{item.farmName}{item.kumbungName ? ` · ${item.kumbungName}` : ''} · {timeAgo(item.updatedAt)}</p>
                  <p className="text-xs">{item.message}</p>
                </>
              )}
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <AttentionList
            title="Gateway offline" icon={WifiOff} items={attention.offlineGateways} onOpen={openFarm}
            empty="Semua gateway online."
            render={item => (
              <>
                <p className="font-semibold">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.farmName} · terakhir terlihat {timeAgo(item.lastSeenAt)}</p>
              </>
            )}
          />
          <AttentionList
            title="Sensor tidak mengirim data" icon={Radio} items={attention.staleSensors} onOpen={openFarm}
            empty="Semua sensor di gateway online mengirim data."
            render={item => (
              <>
                <p className="font-semibold">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.farmName}{item.kumbungName ? ` · ${item.kumbungName}` : ''} · data terakhir {timeAgo(item.lastAt)}</p>
              </>
            )}
          />
        </div>

        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-base">Pengguna terbaru</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.newestUsers.map(user => (
                <li key={user.uid} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{user.username || user.email || user.uid}{user.username && user.email ? <span className="text-muted-foreground"> · {user.email}</span> : null}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(user.createdAt)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
