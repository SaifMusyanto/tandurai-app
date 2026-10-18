import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Info, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import DataTable from '@/components/DataTable';
import { useFarmContext } from '@/contexts/FarmContext';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ROLE_LABELS, STAGE_LABELS, formatDate, timeAgo } from './adminFormat';

const dayCount = startedAt => Math.max(1, Math.floor((Date.now() - startedAt) / 86_400_000) + 1);

/** Detail farm klien: kumbung (batch + kondisi terakhir), gateway, anggota. */
function FarmDetailDialog({ farmId, onClose, onOpenFarm }) {
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    if (!farmId) return undefined;
    let active = true;
    setDetail(null);
    api.adminFarm(farmId).then(result => active && setDetail(result)).catch(error => { toast.error(error.message); onClose(); });
    return () => { active = false; };
  }, [farmId, onClose]);

  return (
    <Dialog open={Boolean(farmId)} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{detail?.farm.name || 'Memuat…'}</DialogTitle>
          <DialogDescription>{detail ? `${detail.farm.location} · dibuat ${formatDate(detail.farm.createdAt)} · ${detail.farm.id}` : ''}</DialogDescription>
        </DialogHeader>
        {!detail ? <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground"><Loader2 className="animate-spin" />Memuat detail…</div> : (
          <div className="space-y-5 text-sm">
            <section className="space-y-2">
              <h3 className="font-semibold">Kumbung ({detail.kumbungs.length})</h3>
              {!detail.kumbungs.length && <p className="text-muted-foreground">Belum ada kumbung.</p>}
              {detail.kumbungs.map(item => (
                <div key={item.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{item.name} <span className="text-xs text-muted-foreground">· {item.capacityBaglog.toLocaleString('id-ID')} baglog · {item.sensors} sensor</span></p>
                    {item.alertsActive > 0 && <Badge variant="outline" className="border-red-500/30 text-red-600">{item.alertsActive} alert aktif</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {item.batch ? `Batch berjalan · hari ke-${dayCount(item.batch.startedAt)} · ${STAGE_LABELS[item.batch.growthStage] || item.batch.growthStage} · ${item.batch.baglogCountActive.toLocaleString('id-ID')} baglog aktif` : 'Tidak ada batch berjalan'}
                  </p>
                  <p className="text-xs">
                    {item.latest ? `Kondisi terakhir: ${item.latest.temperature ?? '—'} °C · ${item.latest.humidity ?? '—'} % · ${item.latest.co2 ?? '—'} ppm (${timeAgo(item.latest.at)})` : 'Belum ada data sensor dalam 1 jam terakhir'}
                  </p>
                </div>
              ))}
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">Gateway ({detail.gateways.length})</h3>
              {!detail.gateways.length && <p className="text-muted-foreground">Belum ada gateway diklaim.</p>}
              <ul className="divide-y rounded-lg border">
                {detail.gateways.map(gateway => (
                  <li key={gateway.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0"><span className="font-medium">{gateway.name}</span> <span className="text-xs text-muted-foreground">· {gateway.sensors} sensor · {gateway.actuators} aktuator{gateway.firmware ? ` · ${gateway.firmware}` : ''}</span></span>
                    <Badge variant="outline" className={gateway.online ? 'border-emerald-500/30 text-emerald-600' : 'text-muted-foreground'}>{gateway.online ? 'online' : `offline · ${timeAgo(gateway.lastSeenAt)}`}</Badge>
                  </li>
                ))}
              </ul>
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">Anggota ({detail.members.length})</h3>
              <ul className="divide-y rounded-lg border">
                {detail.members.map(member => (
                  <li key={member.uid} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 truncate">{member.username || member.email || member.uid}{member.username && member.email ? <span className="text-xs text-muted-foreground"> · {member.email}</span> : null}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{ROLE_LABELS[member.role]}{member.status !== 'active' ? ' (nonaktif)' : ''} · aktif {timeAgo(member.lastSeenAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-10" onClick={onClose}>Tutup</Button>
          <Button className="h-10" disabled={!detail} onClick={() => onOpenFarm(farmId)}>Buka dashboard farm<ArrowRight size={15} className="ml-1" /></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Konsol admin: semua farm klien dengan statistik dan akses ke dashboard farm. */
export default function AdminFarmsPage() {
  const { enterFarmAsAdmin } = useFarmContext();
  const navigate = useNavigate();
  const [farms, setFarms] = useState(null);
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState(null);

  useEffect(() => {
    api.adminFarms().then(setFarms).catch(error => { toast.error(error.message); setFarms([]); });
  }, []);

  const openFarm = farmId => { enterFarmAsAdmin(farmId); navigate('/'); };
  const closeDetail = useCallback(() => setDetailId(null), []);
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (farms || []).filter(farm => !term || [farm.name, farm.id, farm.owners, farm.location].some(value => String(value).toLowerCase().includes(term)));
  }, [farms, search]);

  const columns = [
    {
      key: 'farm', header: 'Farm', cell: farm => (
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{farm.name}</p>
          <p className="text-xs text-muted-foreground">{farm.owners || 'tanpa owner'}</p>
          {farm.status !== 'active' && <Badge variant="outline" className="mt-1 text-[10px]">nonaktif</Badge>}
        </div>
      ),
    },
    {
      key: 'alerts', header: 'Alert', className: 'whitespace-nowrap', cell: farm => (farm.alertsCritical || farm.alertsWarning
        ? <span className={cn('text-sm font-semibold', farm.alertsCritical ? 'text-red-600' : 'text-amber-600')}>{farm.alertsCritical} kritis{farm.alertsWarning ? ` · ${farm.alertsWarning}` : ''}</span>
        : <span className="text-sm text-emerald-600">aman</span>),
    },
    { key: 'kumbungs', header: 'Kumbung', hideOnMobile: true, cell: farm => `${farm.kumbungs} (${farm.batchesActive} batch)` },
    {
      key: 'gateways', header: 'Gateway', hideOnMobile: true, cell: farm => (
        <span className={farm.gatewaysOnline < farm.gateways ? 'text-amber-600' : undefined}>{farm.gatewaysOnline}/{farm.gateways} online · {farm.sensors} sensor</span>
      ),
    },
    { key: 'members', header: 'Anggota', hideOnMobile: true, cell: farm => farm.members },
    { key: 'lastData', header: 'Data terakhir', hideOnMobile: true, className: 'whitespace-nowrap text-sm', cell: farm => timeAgo(farm.lastDataAt) },
    { key: 'harvest', header: 'Panen 30 hari', hideOnMobile: true, className: 'whitespace-nowrap', cell: farm => `${farm.harvestKg30d.toLocaleString('id-ID')} kg` },
    {
      key: 'actions', header: <span className="sr-only">Aksi</span>, hideOnMobile: true, className: 'text-right whitespace-nowrap', cell: farm => (
        <>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setDetailId(farm.id)}><Info size={14} className="mr-1" />Detail</Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => openFarm(farm.id)}>Buka<ArrowRight size={14} className="ml-1" /></Button>
        </>
      ),
    },
  ];

  return (
    <>
      <Helmet><title>Farm & Klien - Konsol Admin</title></Helmet>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Farm & Klien</h1>
          <p className="text-sm text-muted-foreground">Semua farm yang memakai Tandurai. Buka dashboard farm untuk melihat dan membantu klien.</p>
        </div>
        <Card>
          <CardContent className="space-y-3 p-3 sm:p-5">
            <div className="relative sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari nama farm, owner, lokasi" className="h-10 pl-9" />
            </div>
            <DataTable columns={columns} rows={rows} loading={farms === null} pageSize={15}
              rowClassName={farm => (farm.alertsCritical ? 'bg-red-500/5' : undefined)}
              emptyText={search ? 'Tidak ada farm yang cocok.' : 'Belum ada farm.'} />
          </CardContent>
        </Card>
      </div>
      <FarmDetailDialog farmId={detailId} onClose={closeDetail} onOpenFarm={openFarm} />
    </>
  );
}
