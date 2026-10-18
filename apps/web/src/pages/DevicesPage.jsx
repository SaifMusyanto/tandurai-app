import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Cpu, Plus, Loader2, Radio, RefreshCw } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import AddGatewayDialog from '@/components/iot/AddGatewayDialog';
import GatewayCard from '@/components/iot/GatewayCard';
import { useFarmContext } from '@/contexts/FarmContext';
import { useIot } from '@/contexts/IotContext';

// Gateway IoT dikelola backend (apps/api) dan dimiliki farm: owner mengelola, operator melihat.
export default function DevicesPage() {
  const { farm, kumbungs, isOwner } = useFarmContext();
  const { gateways, loading, error, streamConnected, refresh } = useIot();
  const [addOpen, setAddOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  // Gateway milik farm terpilih (gateway selalu terikat ke satu farm sejak diklaim).
  const visible = gateways.filter(gateway => gateway.farmId === farm?.id);
  const online = visible.filter(gateway => gateway.online).length;

  return (
    <>
      <Helmet><title>Perangkat - Dashboard Tandurai</title></Helmet>
      <AddGatewayDialog open={addOpen} farm={farm} kumbungs={kumbungs} onClose={() => setAddOpen(false)} />

      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Gateway & Perangkat</h1>
            <p className="text-muted-foreground">Gateway ESP32 terhubung lewat MQTT; sensor dan aktuator muncul otomatis setelah klaim.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={streamConnected ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20'}>
              <Radio size={12} className="mr-1" />{streamConnected ? 'Realtime aktif' : 'Menyambung realtime…'}
            </Badge>
            <Button variant="outline" size="icon" onClick={refresh} aria-label="Muat ulang"><RefreshCw size={16} /></Button>
            {isOwner && <Button onClick={() => setAddOpen(true)}><Plus size={16} className="mr-2" /> Tambah gateway</Button>}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Loader2 className="animate-spin" size={20} /> Memuat gateway…</div>
        ) : error && !gateways.length ? (
          <Card><CardContent className="py-8 text-center text-red-600">Gagal memuat gateway: {error}</CardContent></Card>
        ) : !visible.length ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground space-y-2">
              <Cpu className="mx-auto" size={40} />
              <p>Belum ada gateway di {farm?.name || 'farm ini'}.</p>
              <p className="text-sm">{isOwner ? 'Klik “Tambah gateway”, lalu masukkan UID dan kode klaim dari label perangkat.' : 'Hanya owner farm yang dapat menambahkan gateway.'}</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex gap-4 text-sm">
              <span>Total: <b>{visible.length}</b></span>
              <span>Online: <b className="text-green-600">{online}</b></span>
              <span>Offline: <b className="text-red-600">{visible.length - online}</b></span>
            </div>
            <div className="space-y-4">
              {visible.map(gateway => <GatewayCard key={gateway.id} gateway={gateway} kumbungs={kumbungs} now={now} canManage={isOwner} />)}
            </div>
          </>
        )}
      </div>
    </>
  );
}
