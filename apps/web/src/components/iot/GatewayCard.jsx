import React, { useState } from 'react';
import { Cpu, Wifi, WifiOff, Unlink, Loader2, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIot } from '@/contexts/IotContext';
import InlineName from '@/components/iot/InlineName';
import { MODE_LABEL, relativeTime, secondsUntilOff } from '@/lib/iot';
import { PARAMETERS, PARAMETER_KEYS, formatParameter } from '@/lib/parameters';
import DataTable from '@/components/DataTable';

const STALE_MS = 180000;
const NO_KUMBUNG = '__none__';

const SENSOR_STATUS = {
  pending: { label: 'Menunggu data', className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  active: { label: 'Aktif', className: 'bg-green-500/10 text-green-600 border-green-500/20' },
  error: { label: 'Bermasalah', className: 'bg-red-500/10 text-red-600 border-red-500/20' },
};
const STATE_STYLE = {
  on: 'bg-green-500/10 text-green-600 border-green-500/20',
  off: 'bg-muted text-muted-foreground border-border',
  fault: 'bg-red-500/10 text-red-600 border-red-500/20',
  unknown: 'bg-muted text-muted-foreground border-border',
};

function KumbungSelect({ value, kumbungs, onChange, label, disabled }) {
  return (
    <Select value={value || NO_KUMBUNG} onValueChange={next => onChange(next === NO_KUMBUNG ? null : next)} disabled={disabled}>
      <SelectTrigger className="h-8 w-40 text-xs" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_KUMBUNG}>Belum ditempatkan</SelectItem>
        {kumbungs.map(kumbung => <SelectItem key={kumbung.id} value={kumbung.id}>{kumbung.name || kumbung.id}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * Kartu gateway dari backend MQTT: status koneksi, versi config, sensor (realtime), aktuator.
 * `canManage` (owner farm): penempatan kumbung dan lepas gateway; operator hanya melihat.
 */
export default function GatewayCard({ gateway, kumbungs, now, canManage = false }) {
  const { unclaim, updateSensor, updateActuator, renameGateway } = useIot();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const place = (update, id, label) => async kumbungId => {
    try {
      await update(id, { kumbungId });
      toast.success(`${label} dipindah.`);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const doUnclaim = async event => {
    event.preventDefault();
    setBusy(true);
    try {
      await unclaim(gateway.id);
      toast.success(`${gateway.name} dilepas.`);
      setConfirm(false);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center"><Cpu size={20} className="text-primary" /></div>
            <div className="min-w-0">
              <CardTitle className="text-base">
                <InlineName value={gateway.name} canEdit={canManage} className="font-semibold" label="nama gateway"
                  onSave={async name => { await renameGateway(gateway.id, name); toast.success('Nama gateway disimpan.'); }} />
              </CardTitle>
              <p className="text-xs text-muted-foreground font-mono">{gateway.id} · {gateway.model || '—'} · fw {gateway.firmware || '—'}</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <Badge variant="outline" className={gateway.online ? STATE_STYLE.on : 'bg-red-500/10 text-red-600 border-red-500/20'}>
                  {gateway.online ? <Wifi size={12} className="mr-1" /> : <WifiOff size={12} className="mr-1" />}
                  {gateway.online ? 'Online' : 'Offline'}
                </Badge>
                <Badge variant="outline" className="text-xs">Aktivitas {relativeTime(gateway.lastSeenAt, now)}</Badge>
                <Badge variant="outline" className={gateway.pendingSync ? 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20' : 'text-xs'}>
                  {gateway.pendingSync ? <><RefreshCcw size={12} className="mr-1" />Pending sync v{gateway.configVersion}</> : `Config v${gateway.appliedConfigVersion} diterapkan`}
                </Badge>
              </div>
            </div>
          </div>
          {canManage && (
            <Button size="sm" variant="outline" className="text-red-500 hover:text-red-600 shrink-0" onClick={() => setConfirm(true)}>
              <Unlink size={14} className="mr-1" /> Lepas
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <p className="text-sm font-semibold mb-1">Sensor ({gateway.sensors.length})</p>
          <DataTable
            rows={gateway.sensors}
            emptyText="Gateway belum melaporkan sensor."
            columns={[
              {
                key: 'sensor', header: 'Sensor', cell: sensor => (
                  <>
                    <InlineName value={sensor.name} canEdit={canManage} label={`nama ${sensor.localId}`}
                      onSave={async name => { await updateSensor(sensor.id, { name }); toast.success('Nama sensor disimpan.'); }} />
                    <p className="text-xs text-muted-foreground font-mono">{sensor.id}</p>
                  </>
                ),
              },
              { key: 'kumbung', hideOnMobile: true, header: 'Kumbung', cell: sensor => <KumbungSelect value={sensor.kumbungId} kumbungs={kumbungs} label={`Kumbung ${sensor.name}`} onChange={place(updateSensor, sensor.id, sensor.name)} disabled={!canManage} /> },
              {
                key: 'status', header: 'Status', cell: sensor => {
                  const status = SENSOR_STATUS[sensor.status] || SENSOR_STATUS.pending;
                  return (
                    <>
                      <Badge variant="outline" className={status.className}>{status.label}</Badge>
                      {sensor.error && <p className="text-xs text-red-600 mt-1">{sensor.error}</p>}
                    </>
                  );
                },
              },
              {
                key: 'values', hideOnMobile: true, header: 'Nilai terakhir', className: 'text-xs', cell: sensor => {
                  if (!sensor.lastValues) return <span className="text-muted-foreground">Belum ada data</span>;
                  const stale = sensor.lastTs && now - Date.parse(sensor.lastTs) > STALE_MS;
                  return (
                    <>
                      <p className="font-medium">{PARAMETER_KEYS.filter(key => key in sensor.lastValues).map(key => `${PARAMETERS[key].label} ${formatParameter(key, sensor.lastValues[key])}`).join(' · ') || '—'}</p>
                      <p className={stale ? 'text-orange-600' : 'text-muted-foreground'}>{relativeTime(sensor.lastTs, now)}{stale ? ' (usang)' : ''}</p>
                    </>
                  );
                },
              },
            ]}
          />
        </div>

        <div className="overflow-x-auto">
          <p className="text-sm font-semibold mb-1">Aktuator ({gateway.actuators.length}) <span className="text-xs font-normal text-muted-foreground">— kontrol di halaman Automation</span></p>
          <DataTable
            rows={gateway.actuators}
            emptyText="Gateway belum melaporkan aktuator."
            columns={[
              {
                key: 'actuator', header: 'Aktuator', cell: actuator => (
                  <>
                    <InlineName value={actuator.name} canEdit={canManage} label={`nama ${actuator.localId}`}
                      onSave={async name => { await updateActuator(actuator.id, { name }); toast.success('Nama aktuator disimpan.'); }} />
                    <p className="text-xs text-muted-foreground font-mono">{actuator.id} · maks {actuator.maxRunSec} dtk</p>
                  </>
                ),
              },
              { key: 'kumbung', hideOnMobile: true, header: 'Kumbung', cell: actuator => <KumbungSelect value={actuator.kumbungId} kumbungs={kumbungs} label={`Kumbung ${actuator.name}`} onChange={place(updateActuator, actuator.id, actuator.name)} disabled={!canManage} /> },
              {
                key: 'mode', hideOnMobile: true, header: 'Mode', className: 'text-xs', cell: actuator => (
                  <>
                    {MODE_LABEL[actuator.mode]}
                    {actuator.pendingSync && <p className="text-yellow-700">Pending sync</p>}
                    {actuator.error && <p className="text-red-600">{actuator.error}</p>}
                  </>
                ),
              },
              {
                key: 'state', header: 'Status aktual', className: 'text-xs', cell: actuator => {
                  const remaining = secondsUntilOff(actuator, now);
                  return (
                    <>
                      <Badge variant="outline" className={STATE_STYLE[actuator.state] || STATE_STYLE.unknown}>{actuator.state.toUpperCase()}</Badge>
                      {actuator.stateSource && <span className="ml-1 text-muted-foreground">{actuator.stateSource}</span>}
                      {remaining !== null && <p className="text-muted-foreground">mati dalam {remaining} dtk</p>}
                    </>
                  );
                },
              },
            ]}
          />
        </div>
      </CardContent>

      <AlertDialog open={confirm} onOpenChange={value => !value && !busy && setConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lepas {gateway.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Gateway berhenti menjalankan otomasi dan seluruh relay dimatikan. Data sensor, histori, dan riwayat perintah gateway ini dihapus dari akun Anda.
              Perangkat dapat diklaim lagi dengan kode klaim yang sama.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doUnclaim} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white">
              {busy && <Loader2 size={15} className="mr-1.5 animate-spin" />}Lepas gateway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
