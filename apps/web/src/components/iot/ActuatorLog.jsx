import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Power, PowerOff, Settings2 } from 'lucide-react';
import DataTable from '@/components/DataTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { iotApi } from '@/lib/iotApi';
import { useIot } from '@/contexts/IotContext';
import { MODE_LABEL, describeRule, describeSchedule } from '@/lib/iot';

const OFF_REASON = {
  manual: 'dimatikan manual / durasi manual habis',
  auto: 'aturan otomatis selesai',
  timer: 'jadwal selesai',
  estop: 'dimatikan darurat',
  protection: 'pengaman (sensor tidak terbaca atau aturan berubah)',
  config: 'pengaturan berubah',
  boot: 'gateway menyala ulang',
  button: 'tombol fisik',
};

function describeEvent(event, actuator) {
  const name = actuator?.name || event.actuatorId;
  const actor = event.actorEmail || (event.actorUid ? event.actorUid.slice(0, 8) : null);
  if (event.kind === 'config') {
    const { mode, schedules = 0, rules = 0 } = event.detail || {};
    const count = mode === 'timer' ? ` · ${schedules} jadwal aktif` : mode === 'auto' ? ` · ${rules} aturan aktif` : '';
    return { icon: Settings2, tone: 'text-muted-foreground', text: `Pengaturan ${name} diubah: mode ${MODE_LABEL[mode] || mode}${count}`, actor };
  }
  if (event.state === 'on') {
    let reason = event.source === 'manual' ? 'manual' : event.source;
    if (event.source === 'auto') {
      const rule = actuator?.rules?.find(item => item.id === event.trigger?.rule);
      reason = rule ? `otomatis — ${describeRule(rule).replace(/\.$/, '')}` : 'otomatis';
    } else if (event.source === 'timer') {
      const schedule = actuator?.schedules?.find(item => item.id === event.trigger?.schedule);
      reason = schedule ? `jadwal — ${describeSchedule(schedule)}` : 'jadwal';
    }
    return { icon: Power, tone: 'text-green-600', text: `${name} menyala · ${reason}`, actor: event.source === 'manual' ? actor : null };
  }
  if (event.state === 'fault') return { icon: PowerOff, tone: 'text-red-600', text: `${name} gangguan perangkat`, actor: null };
  return { icon: PowerOff, tone: 'text-foreground', text: `${name} mati · ${OFF_REASON[event.source] || event.source || ''}`, actor: event.source === 'manual' ? actor : null };
}

/** Log nyala/mati & perubahan pengaturan aktuator di kumbung (realtime lewat SSE `actuator_event`). */
export default function ActuatorLog({ kumbungId }) {
  const { gateways, subscribe } = useIot();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const actuators = useMemo(() => new Map(gateways.flatMap(gateway => gateway.actuators).map(item => [item.id, item])), [gateways]);

  const load = useCallback(async () => {
    if (!kumbungId) return;
    try {
      setEvents(await iotApi.actuatorLog(kumbungId, 200));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [kumbungId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    const offEvent = subscribe('actuator_event', event => {
      if (actuators.get(event.actuatorId)?.kumbungId !== kumbungId) return;
      setEvents(current => (current.some(item => item.id === event.id) ? current : [event, ...current].slice(0, 100)));
    });
    const offReady = subscribe('ready', load);
    return () => { offEvent(); offReady(); };
  }, [subscribe, load, actuators, kumbungId]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2"><History size={20} className="text-primary" />Log aktuator</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="py-4 text-center text-sm text-red-600">Gagal memuat log: {error}</p>
        ) : (
          <DataTable
            rows={events}
            loading={loading}
            emptyText="Belum ada aktivitas aktuator di kumbung ini."
            columns={[
              {
                key: 'event', header: 'Kejadian', cell: event => {
                  const view = describeEvent(event, actuators.get(event.actuatorId));
                  const Icon = view.icon;
                  return (
                    <span className="flex items-start gap-2">
                      <Icon size={15} className={`mt-0.5 shrink-0 ${view.tone}`} aria-hidden />
                      <span className={view.tone === 'text-green-600' ? 'font-medium' : ''}>{view.text}</span>
                    </span>
                  );
                },
              },
              { key: 'actor', hideOnMobile: true, header: 'Oleh', className: 'text-xs text-muted-foreground', cell: event => describeEvent(event, actuators.get(event.actuatorId)).actor || '—' },
              { key: 'time', header: 'Waktu', className: 'text-xs text-muted-foreground whitespace-nowrap', cell: event => new Date(event.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' }) },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
