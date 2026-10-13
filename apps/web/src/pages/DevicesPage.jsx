import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import {
  Cpu,
  Wifi,
  WifiOff,
  Plus,
  Link2,
  Unlink,
  Ban,
  RotateCcw,
  Loader2,
  Clock,
  Settings2,
  Radio,
  LifeBuoy,
} from 'lucide-react';
import { toast } from 'sonner';

import { auth } from '../firebase';
import FarmSensorsPanel from '@/components/FarmSensorsPanel';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  GATEWAY_OFFLINE_AFTER_MS,
  gatewayConfigPending,
  gatewayConnectionState,
} from '@/lib/deviceManagementPlan';
import {
  createGateway,
  disableGateway,
  loadDeviceFarms,
  pairGateway,
  reactivateGateway,
  subscribeFarmGateways,
  unpairGateway,
} from '@/lib/deviceManagementService';

const STATE_CONFIG = {
  online: { label: 'Online', icon: Wifi, className: 'bg-green-500/10 text-green-600 border-green-500/20' },
  offline: { label: 'Offline', icon: WifiOff, className: 'bg-red-500/10 text-red-600 border-red-500/20' },
  paired: { label: 'Terpasang, menunggu heartbeat', icon: Radio, className: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  pending: { label: 'Menunggu pairing', icon: Link2, className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  inactive: { label: 'Dicabut', icon: Ban, className: 'bg-muted text-muted-foreground border-border' },
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,96}$/;

const timeAgo = (timestamp, now) => {
  const time = Number(timestamp);
  if (!time) return 'Belum pernah';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return `${seconds} detik lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
};

const shortUid = uid => (uid && uid.length > 12 ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : uid);

/* ─── Dialog: tambah gateway ─────────────────────────────────────────── */
function CreateGatewayDialog({ open, farm, onClose }) {
  const [gatewayId, setGatewayId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const idValid = ID_PATTERN.test(gatewayId);

  useEffect(() => {
    if (open) { setGatewayId(''); setName(''); }
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    if (!idValid || !name.trim()) return;
    setBusy(true);
    try {
      await createGateway({ farmId: farm.id, gatewayId, name });
      toast.success(`Gateway ${gatewayId} dibuat. Lanjutkan dengan memasangkan UID perangkat.`);
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
          <DialogTitle>Tambah gateway</DialogTitle>
          <DialogDescription>
            Gateway terikat ke farm <span className="font-medium text-foreground">{farm?.name}</span> dan dibuat berstatus menunggu pairing.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="gateway-id">ID gateway</Label>
            <Input id="gateway-id" value={gatewayId} onChange={e => setGatewayId(e.target.value.trim())} placeholder="GW-01" autoFocus />
            <p className="text-xs text-muted-foreground">Huruf, angka, “-” atau “_”. ID tidak dapat diubah dan disetel ke ESP32 saat commissioning.</p>
            {gatewayId && !idValid && <p className="text-xs text-red-600">Format ID tidak valid.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gateway-name">Nama</Label>
            <Input id="gateway-name" value={name} onChange={e => setName(e.target.value)} placeholder="Gateway Kumbung Utara" maxLength={100} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
            <Button type="submit" disabled={busy || !idValid || !name.trim()}>
              {busy ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Plus size={15} className="mr-1.5" />}
              Buat gateway
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Dialog: pasangkan UID ──────────────────────────────────────────── */
function PairGatewayDialog({ gateway, onClose }) {
  const [authUid, setAuthUid] = useState('');
  const [busy, setBusy] = useState(false);
  const uidValid = ID_PATTERN.test(authUid);

  useEffect(() => {
    if (gateway) setAuthUid('');
  }, [gateway]);

  const submit = async (event) => {
    event.preventDefault();
    if (!uidValid) return;
    setBusy(true);
    try {
      await pairGateway({ gatewayId: gateway.id, authUid });
      toast.success(`UID dipasangkan ke ${gateway.id}. Gateway akan online setelah heartbeat berikutnya.`);
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(gateway)} onOpenChange={value => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pasangkan UID perangkat</DialogTitle>
          <DialogDescription>
            Masukkan UID Firebase yang ditampilkan ESP32 <span className="font-medium text-foreground">{gateway?.id}</span> lewat serial console saat provisioning pertama.
            Pastikan Anda sedang memegang perangkat fisik yang benar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="gateway-uid">UID perangkat</Label>
            <Input id="gateway-uid" value={authUid} onChange={e => setAuthUid(e.target.value.trim())} placeholder="mis. Xk3f9…" autoFocus className="font-mono" />
            {authUid && !uidValid && <p className="text-xs text-red-600">Format UID tidak valid.</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
            <Button type="submit" disabled={busy || !uidValid}>
              {busy ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Link2 size={15} className="mr-1.5" />}
              Pasangkan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Dialog konfirmasi: lepas pairing / cabut / aktifkan ulang ─────── */
const CONFIRM_COPY = {
  unpair: {
    title: 'Lepas pairing?',
    description: 'UID perangkat saat ini langsung kehilangan akses. Gunakan bila ESP32 diganti atau penyimpanannya (NVS) terhapus; gateway kembali menunggu pairing.',
    action: 'Lepas pairing',
    run: gateway => unpairGateway({ gatewayId: gateway.id }),
    done: id => `Pairing ${id} dilepas.`,
  },
  disable: {
    title: 'Cabut gateway?',
    description: 'Gateway ditandai dicabut dan UID-nya dihapus. Perangkat tidak dapat membaca config atau mengirim telemetry, dan tidak dapat mengaktifkan dirinya sendiri. Riwayat telemetry tetap tersimpan.',
    action: 'Cabut gateway',
    run: gateway => disableGateway({ gatewayId: gateway.id }),
    done: id => `${id} dicabut.`,
  },
  reactivate: {
    title: 'Aktifkan ulang gateway?',
    description: 'Gateway kembali berstatus menunggu pairing. Perangkat harus menjalankan provisioning ulang lalu UID barunya dipasangkan.',
    action: 'Aktifkan ulang',
    run: gateway => reactivateGateway({ gatewayId: gateway.id }),
    done: id => `${id} kembali menunggu pairing.`,
  },
};

function ConfirmDialog({ confirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const copy = confirm ? CONFIRM_COPY[confirm.type] : null;

  const run = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await copy.run(confirm.gateway);
      toast.success(copy.done(confirm.gateway.id));
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={Boolean(confirm)} onOpenChange={value => !value && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy?.title} {confirm?.gateway.id}</AlertDialogTitle>
          <AlertDialogDescription>{copy?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
          <AlertDialogAction
            onClick={run}
            disabled={busy}
            className={confirm?.type === 'reactivate' ? '' : 'bg-red-600 hover:bg-red-700 text-white'}
          >
            {busy && <Loader2 size={15} className="mr-1.5 animate-spin" />}
            {copy?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ─── Kartu gateway ──────────────────────────────────────────────────── */
function GatewayCard({ gateway, state, isOwner, now, onPair, onConfirm }) {
  const config = STATE_CONFIG[state];
  const StateIcon = config.icon;
  const configPending = state !== 'inactive' && gatewayConfigPending(gateway);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
            <Cpu size={20} className="text-primary" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base leading-snug line-clamp-1">{gateway.name || gateway.id}</CardTitle>
            <p className="text-xs text-muted-foreground font-mono">{gateway.id}</p>
            <Badge variant="outline" className={`mt-1.5 w-fit ${config.className}`}>
              <StateIcon size={12} className="mr-1" />
              {config.label}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 flex flex-col flex-1 pt-0 text-sm">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <div>
            <dt className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={12} /> Heartbeat</dt>
            <dd className="font-medium">{timeAgo(gateway.lastSeenAt, now)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Sensor</dt>
            <dd className="font-medium">{gateway.sensorCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground flex items-center gap-1"><Settings2 size={12} /> Config</dt>
            <dd className="font-medium">
              v{gateway.appliedConfigVersion ?? 0} / v{gateway.configVersion ?? 0}
              {configPending && <span className="ml-1 text-xs text-yellow-600">(belum diterapkan)</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Firmware</dt>
            <dd className="font-medium truncate" title={gateway.firmwareVersion}>{gateway.firmwareVersion || '—'}</dd>
          </div>
          {isOwner && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">UID perangkat</dt>
              <dd className="font-mono text-xs" title={gateway.authUid}>{shortUid(gateway.authUid) || 'Belum dipasangkan'}</dd>
            </div>
          )}
        </dl>

        {isOwner && (
          <div className="flex gap-2 mt-auto pt-2 flex-wrap">
            {state === 'pending' && (
              <Button size="sm" className="flex-1" onClick={() => onPair(gateway)}>
                <Link2 size={14} className="mr-1" /> Pasangkan UID
              </Button>
            )}
            {['paired', 'online', 'offline'].includes(state) && (
              <Button size="sm" variant="outline" className="flex-1" onClick={() => onConfirm('unpair', gateway)}>
                <Unlink size={14} className="mr-1" /> Lepas pairing
              </Button>
            )}
            {state === 'inactive' ? (
              <Button size="sm" variant="outline" className="flex-1" onClick={() => onConfirm('reactivate', gateway)}>
                <RotateCcw size={14} className="mr-1" /> Aktifkan ulang
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="flex-1 text-red-500 hover:text-red-600 hover:border-red-300" onClick={() => onConfirm('disable', gateway)}>
                <Ban size={14} className="mr-1" /> Cabut
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Panduan pemulihan ──────────────────────────────────────────────── */
function RecoveryGuide() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><LifeBuoy size={18} /> Pemasangan & pemulihan gateway</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 text-sm text-muted-foreground">
        <ol className="list-decimal pl-5 space-y-1">
          <li><span className="text-foreground font-medium">Tambah gateway</span> dengan ID unik; status menunggu pairing.</li>
          <li>Setel ID gateway ke ESP32 lalu nyalakan. Perangkat login anonim ke Firebase dan menampilkan UID di serial console.</li>
          <li><span className="text-foreground font-medium">Pasangkan UID</span> setelah memastikan perangkat fisiknya benar.</li>
          <li>Gateway membaca config, mengirim heartbeat, lalu tampil online. Offline bila tidak ada heartbeat lebih dari {GATEWAY_OFFLINE_AFTER_MS / 60000} menit.</li>
        </ol>
        <ul className="list-disc pl-5 space-y-1">
          <li><span className="text-foreground font-medium">ESP32 diganti atau memori terhapus:</span> lepas pairing, jalankan provisioning ulang di perangkat, lalu pasangkan UID baru.</li>
          <li><span className="text-foreground font-medium">Perangkat hilang/dicurigai bocor:</span> cabut gateway. Akses langsung diputus dan tidak dapat dipulihkan oleh perangkat.</li>
          <li><span className="text-foreground font-medium">Config belum diterapkan:</span> periksa sensor yang tidak menjawab di perangkat; versi diakui hanya bila semua sensor aktif terbaca.</li>
        </ul>
      </CardContent>
    </Card>
  );
}

/* ─── Halaman utama ──────────────────────────────────────────────────── */
export default function DevicesPage() {
  const uid = auth.currentUser?.uid;
  const [farms, setFarms] = useState([]);
  const [farmId, setFarmId] = useState('');
  const [farmsLoading, setFarmsLoading] = useState(true);
  const [farmsError, setFarmsError] = useState('');
  const [gateways, setGateways] = useState([]);
  const [gatewaysLoading, setGatewaysLoading] = useState(false);
  const [gatewaysError, setGatewaysError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [createOpen, setCreateOpen] = useState(false);
  const [pairTarget, setPairTarget] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const farm = farms.find(item => item.id === farmId) || null;
  const isOwner = farm?.role === 'owner';

  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;
    setFarmsLoading(true);
    loadDeviceFarms(uid)
      .then(result => {
        if (cancelled) return;
        setFarms(result);
        setFarmId(current => current || result[0]?.id || '');
        setFarmsError('');
      })
      .catch(error => !cancelled && setFarmsError(error.message))
      .finally(() => !cancelled && setFarmsLoading(false));
    return () => { cancelled = true; };
  }, [uid]);

  useEffect(() => {
    if (!farmId) return undefined;
    setGatewaysLoading(true);
    setGatewaysError('');
    return subscribeFarmGateways(farmId, list => {
      setGateways(list);
      setGatewaysLoading(false);
    }, error => {
      setGatewaysError(error.message);
      setGatewaysLoading(false);
    });
  }, [farmId]);

  // Status online/offline bergantung waktu; segarkan tampilan tiap 15 detik.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  const withState = useMemo(
    () => gateways.map(gateway => ({ gateway, state: gatewayConnectionState(gateway, now) })),
    [gateways, now],
  );
  const counts = withState.reduce((acc, { state }) => ({ ...acc, [state]: (acc[state] || 0) + 1 }), {});

  return (
    <>
      <Helmet><title>Devices - TUMBARA</title></Helmet>

      <CreateGatewayDialog open={createOpen} farm={farm} onClose={() => setCreateOpen(false)} />
      <PairGatewayDialog gateway={pairTarget} onClose={() => setPairTarget(null)} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />

      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Gateway Perangkat</h1>
            <p className="text-muted-foreground">Daftarkan gateway ESP32, pasangkan perangkat, dan tugaskan sensor per kumbung</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {farms.length > 0 && (
              <Select value={farmId} onValueChange={setFarmId}>
                <SelectTrigger className="w-56" aria-label="Pilih farm">
                  <SelectValue placeholder="Pilih farm" />
                </SelectTrigger>
                <SelectContent>
                  {farms.map(item => (
                    <SelectItem key={item.id} value={item.id}>{item.name} · {item.role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isOwner && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus size={16} className="mr-2" /> Tambah gateway
              </Button>
            )}
          </div>
        </div>

        {farmsLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="animate-spin" size={20} /> Memuat farm…
          </div>
        ) : farmsError ? (
          <Card><CardContent className="py-8 text-center text-red-600">Gagal memuat farm: {farmsError}</CardContent></Card>
        ) : farms.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Akun Anda belum menjadi anggota farm mana pun.</CardContent></Card>
        ) : (
          <>
            <div className="flex items-center gap-4 flex-wrap text-sm">
              <div>Total: <span className="font-bold ml-1">{gateways.length}</span></div>
              <div>Online: <span className="font-bold text-green-600 ml-1">{counts.online || 0}</span></div>
              <div>Offline: <span className="font-bold text-red-600 ml-1">{counts.offline || 0}</span></div>
              <div>Menunggu pairing: <span className="font-bold text-yellow-600 ml-1">{(counts.pending || 0) + (counts.paired || 0)}</span></div>
              {!isOwner && <Badge variant="outline">Hanya baca (operator)</Badge>}
            </div>

            {gatewaysLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="animate-spin" size={20} /> Memuat gateway…
              </div>
            ) : gatewaysError ? (
              <Card><CardContent className="py-8 text-center text-red-600">Gagal memuat gateway: {gatewaysError}</CardContent></Card>
            ) : gateways.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground space-y-2">
                  <Cpu className="mx-auto" size={40} />
                  <p>Belum ada gateway di farm ini.</p>
                  {isOwner && <p className="text-sm">Klik “Tambah gateway” untuk mendaftarkan ESP32 pertama.</p>}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
                {withState.map(({ gateway, state }, index) => (
                  <motion.div
                    key={gateway.id}
                    className="h-full"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.04 }}
                  >
                    <GatewayCard
                      gateway={gateway}
                      state={state}
                      isOwner={isOwner}
                      now={now}
                      onPair={setPairTarget}
                      onConfirm={(type, target) => setConfirm({ type, gateway: target })}
                    />
                  </motion.div>
                ))}
              </div>
            )}

            {farm && !gatewaysLoading && !gatewaysError && (
              <FarmSensorsPanel key={farm.id} farm={farm} isOwner={isOwner} gateways={gateways} />
            )}

            {isOwner && <RecoveryGuide />}
          </>
        )}
      </div>
    </>
  );
}
