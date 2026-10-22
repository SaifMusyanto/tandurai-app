import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Copy, Download, Eye, EyeOff, Loader2, Plus, RefreshCw, ShieldAlert, Unlink, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DataTable from '@/components/DataTable';
import { useFarmContext } from '@/contexts/FarmContext';
import { api } from '@/lib/api';
import { iotApi } from '@/lib/iotApi';

const copy = async (text, label) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} disalin.`);
  } catch {
    toast.error('Gagal menyalin. Salin manual.');
  }
};

const download = (filename, content, type) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

/** Isi yang dimasukkan ke halaman setup gateway (Wi-Fi diisi di lokasi). */
const setupJson = device => JSON.stringify({ hwUid: device.hwUid, deviceSecret: device.deviceSecret, model: device.model, mqtt: device.mqtt }, null, 2);

function Secret({ value }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs">
      {shown ? value : '••••••••••••'}
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShown(current => !current)} aria-label={shown ? 'Sembunyikan secret' : 'Tampilkan secret'}>
        {shown ? <EyeOff size={12} /> : <Eye size={12} />}
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(value, 'Device secret')} aria-label="Salin secret"><Copy size={12} /></Button>
    </span>
  );
}

/** Registrasi perangkat (admin Tandurai): buat identitas gateway baru dan lihat status semua perangkat. */
export default function AdminDevicesPage() {
  const { profile } = useFarmContext();
  const [count, setCount] = useState('1');
  const [model, setModel] = useState('TDR-GW1');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState([]);
  const [registry, setRegistry] = useState({ broker: null, devices: [] });
  const [loading, setLoading] = useState(true);
  const [unclaimTarget, setUnclaimTarget] = useState(null);
  const [unclaiming, setUnclaiming] = useState(false);

  const load = useCallback(async () => {
    try {
      setRegistry(await api.adminDevices());
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (profile?.deviceAdmin) load(); }, [profile?.deviceAdmin, load]);

  if (profile && !profile.deviceAdmin) {
    return (
      <Card><CardContent className="py-10 text-center text-muted-foreground space-y-2">
        <ShieldAlert className="mx-auto" size={36} />
        <p>Halaman ini hanya untuk admin Tandurai.</p>
        <p className="text-xs">Tambahkan email Anda ke <code>ADMIN_EMAILS</code> di <code>apps/api/.env</code>, restart backend, lalu login ulang.</p>
      </CardContent></Card>
    );
  }

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    try {
      const devices = await api.provisionDevices({ count: Number(count), model: model.trim() });
      setCreated(devices);
      toast.success(`${devices.length} perangkat terdaftar. Unduh file setup sekarang — secret tidak bisa dilihat lagi.`);
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  // Admin diperlakukan sebagai owner di semua farm, jadi endpoint lepas gateway yang sama dapat dipakai.
  const doUnclaim = async event => {
    event.preventDefault();
    setUnclaiming(true);
    try {
      await iotApi.unclaim(unclaimTarget.hwUid);
      toast.success(`${unclaimTarget.hwUid} dilepas dari ${unclaimTarget.farmName || unclaimTarget.farmId}.`);
      setUnclaimTarget(null);
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setUnclaiming(false);
    }
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const broker = registry.broker;

  return (
    <>
      <Helmet><title>Registrasi Perangkat - Dashboard Tandurai</title></Helmet>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Registrasi Perangkat</h1>
          <p className="text-muted-foreground">Buat identitas gateway baru (hwUid, device secret, kode klaim) untuk diisi tim hardware dan dicetak di label.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Daftarkan gateway baru</CardTitle>
            <CardDescription>
              Broker yang akan diisi ke gateway: <b>{broker ? `${broker.tls ? 'mqtts' : 'mqtt'}://${broker.host}:${broker.port}` : '…'}</b>
              {broker && ['localhost', '127.0.0.1'].includes(broker.host) && (
                <span className="block text-yellow-700 dark:text-yellow-400">Gateway tidak bisa memakai “localhost”. Isi MQTT_PUBLIC_HOST di apps/api/.env dengan IP LAN / domain server, lalu restart backend.</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="device-count" className="text-xs">Jumlah</Label>
                <Input id="device-count" type="number" min={1} max={50} value={count} onChange={event => setCount(event.target.value)} className="h-9 w-24" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="device-model" className="text-xs">Model</Label>
                <Input id="device-model" value={model} onChange={event => setModel(event.target.value)} className="h-9 w-40" maxLength={32} />
              </div>
              <Button type="submit" className="h-9" disabled={busy || !(Number(count) >= 1 && Number(count) <= 50)}>
                {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Plus size={14} className="mr-1" />}Daftarkan
              </Button>
            </form>
          </CardContent>
        </Card>

        {created.length > 0 && (
          <Card className="border-yellow-500/40">
            <CardHeader>
              <CardTitle className="text-lg">Perangkat baru — unduh sekarang</CardTitle>
              <CardDescription className="text-yellow-800 dark:text-yellow-300">
                Device secret hanya ditampilkan sekali. Berikan file setup ke tim hardware (rahasia), cetak label dari CSV (hanya hwUid + kode klaim).
              </CardDescription>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => download(`tandurai-setup-${stamp}.json`, JSON.stringify(created.map(item => JSON.parse(setupJson(item))), null, 2), 'application/json')}>
                  <Download size={14} className="mr-1" />File setup semua (.json)
                </Button>
                <Button size="sm" variant="outline" onClick={() => download(`tandurai-label-${stamp}.csv`, `hwUid,claimCode,model\n${created.map(item => `${item.hwUid},${item.claimCode},${item.model}`).join('\n')}\n`, 'text/csv')}>
                  <Download size={14} className="mr-1" />Label (.csv)
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable
                rows={created}
                rowKey={item => item.hwUid}
                columns={[
                  { key: 'hwUid', header: 'hwUid', className: 'font-mono text-xs', cell: item => <span className="inline-flex items-center gap-1">{item.hwUid}<Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(item.hwUid, 'hwUid')} aria-label="Salin hwUid"><Copy size={12} /></Button></span> },
                  { key: 'claimCode', header: 'Kode klaim (label)', className: 'font-mono text-xs font-semibold', cell: item => item.claimCode },
                  { key: 'secret', hideOnMobile: true, header: 'Device secret', cell: item => <Secret value={item.deviceSecret} /> },
                  {
                    key: 'actions', hideOnMobile: true, header: <span className="sr-only">Aksi</span>, className: 'text-right whitespace-nowrap', cell: item => (
                      <>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => copy(setupJson(item), 'Data setup')}><Copy size={12} className="mr-1" />Salin setup</Button>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => download(`${item.hwUid}.json`, setupJson(item), 'application/json')}><Download size={12} className="mr-1" />.json</Button>
                      </>
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Semua perangkat terdaftar</CardTitle>
              <CardDescription>Status dari broker: belum pernah tersambung → tersambung (melapor sensor & aktuator) → diklaim farm.</CardDescription>
            </div>
            <Button size="icon" variant="outline" onClick={load} aria-label="Muat ulang"><RefreshCw size={16} /></Button>
          </CardHeader>
          <CardContent>
            <DataTable
              loading={loading}
              rows={registry.devices}
              rowKey={item => item.hwUid}
              emptyText="Belum ada perangkat terdaftar."
              columns={[
                { key: 'hwUid', header: 'hwUid', className: 'font-mono text-xs', cell: item => item.hwUid },
                { key: 'model', hideOnMobile: true, header: 'Model', className: 'text-xs', cell: item => item.model },
                {
                  key: 'status', header: 'Koneksi', className: 'text-xs', cell: item => (!item.registeredAt
                    ? <Badge variant="outline" className="text-muted-foreground">Belum pernah tersambung</Badge>
                    : item.online
                      ? <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20"><Wifi size={11} className="mr-1" />Online</Badge>
                      : <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20"><WifiOff size={11} className="mr-1" />Offline</Badge>),
                },
                {
                  key: 'hardware', hideOnMobile: true, header: 'Dilaporkan gateway', className: 'text-xs', cell: item => (item.registeredAt
                    ? `${item.reportedSensors} sensor · ${item.reportedActuators} aktuator${item.firmware ? ` · fw ${item.firmware}` : ''}`
                    : '—'),
                },
                { key: 'farm', hideOnMobile: true, header: 'Diklaim', className: 'text-xs', cell: item => item.farmName || item.farmId || <span className="text-muted-foreground">Belum</span> },
                { key: 'created', hideOnMobile: true, header: 'Didaftarkan', className: 'text-xs text-muted-foreground whitespace-nowrap', cell: item => new Date(item.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) },
                {
                  key: 'actions', header: <span className="sr-only">Aksi</span>, className: 'text-right whitespace-nowrap', cell: item => (item.farmId
                    ? <Button size="sm" variant="ghost" className="h-7 text-red-600 hover:text-red-700" onClick={() => setUnclaimTarget(item)}><Unlink size={12} className="mr-1" />Lepas</Button>
                    : null),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={Boolean(unclaimTarget)} onOpenChange={value => !value && !unclaiming && setUnclaimTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lepas {unclaimTarget?.hwUid} dari {unclaimTarget?.farmName || unclaimTarget?.farmId}?</AlertDialogTitle>
            <AlertDialogDescription>
              Gateway berhenti menjalankan otomasi dan seluruh relay dimatikan. Data sensor, histori, dan riwayat perintah gateway ini dihapus dari farm tersebut.
              Tindakan ini tercatat atas nama Anda di audit farm. Perangkat dapat diklaim lagi dengan kode klaim yang sama.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unclaiming}>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doUnclaim} disabled={unclaiming} className="bg-red-600 hover:bg-red-700 text-white">
              {unclaiming && <Loader2 size={15} className="mr-1.5 animate-spin" />}Lepas gateway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
