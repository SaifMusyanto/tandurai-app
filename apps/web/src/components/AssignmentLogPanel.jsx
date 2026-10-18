import React, { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import DataTable from '@/components/DataTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '../firebase';
import { api } from '@/lib/api';
import { useIot } from '@/contexts/IotContext';

const shortId = value => (value && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value);

function describe(entry) {
  const sensor = entry.sensorId;
  const gateway = entry.gatewayId;
  switch (entry.action) {
    case 'farm_create': return `Membuat farm ${entry.name || ''}`.trim();
    case 'farm_update': return 'Mengubah data farm';
    case 'kumbung_create': return `Membuat kumbung ${entry.name || entry.kumbungId}`;
    case 'kumbung_update': return `Mengubah kumbung ${entry.name || entry.kumbungId}`;
    case 'gateway_claim': return `Menambahkan gateway ${gateway}${entry.toKumbungId ? ` ke ${entry.toKumbungId}` : ''}`;
    case 'gateway_unclaim': return `Melepas gateway ${gateway}`;
    case 'actuator_move': return `Memindahkan aktuator ${entry.actuatorId}: ${entry.fromKumbungId || '—'} → ${entry.toKumbungId || '—'}`;
    case 'alert_settings_update': return 'Mengubah pengaturan alert farm';
    case 'operator_add': return `Menambahkan operator ${entry.email || shortId(entry.targetUid)}`;
    case 'operator_remove': return `Mencabut operator ${shortId(entry.targetUid)}`;
    case 'gateway_create': return `Membuat gateway ${gateway}`;
    case 'gateway_pair': return `Memasangkan UID ${shortId(entry.targetUid)} ke ${gateway}`;
    case 'gateway_unpair': return `Melepas pairing ${gateway}`;
    case 'gateway_disable': return `Mencabut gateway ${gateway}`;
    case 'gateway_reactivate': return `Mengaktifkan ulang ${gateway}`;
    case 'sensor_assign': return `Menugaskan ${sensor} ke ${entry.toKumbungId} lewat ${entry.toGatewayId}`;
    case 'sensor_move': return entry.fromGatewayId || entry.toGatewayId
      ? `Memindahkan ${sensor}: ${entry.fromKumbungId}/${entry.fromGatewayId} → ${entry.toKumbungId}/${entry.toGatewayId}`
      : `Memindahkan sensor ${sensor}: ${entry.fromKumbungId || '—'} → ${entry.toKumbungId || '—'}`;
    case 'sensor_update': return `Mengubah data ${sensor}`;
    case 'sensor_deactivate': return `Menonaktifkan ${sensor}${entry.fromKumbungId ? ` di ${entry.fromKumbungId}` : ''}`;
    default: return entry.action;
  }
}

/** Riwayat perubahan anggota/perangkat farm (siapa, kapan, dari mana ke mana, versi config). */
export default function AssignmentLogPanel({ farmId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const uid = auth.currentUser?.uid;
  const { subscribe } = useIot();

  const load = useCallback(async () => {
    try {
      setEntries(await api.audit(farmId, 200));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => {
    setLoading(true);
    setError('');
    load();
  }, [load]);

  // Setiap perubahan farm (SSE `changed`) dapat menambah riwayat → muat ulang.
  useEffect(() => subscribe('changed', event => {
    if (event.farmId === farmId) load();
  }), [subscribe, load, farmId]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><History size={18} /> Riwayat perubahan</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="py-4 text-center text-red-600">Gagal memuat riwayat: {error}</p>
        ) : (
          <DataTable
            rows={entries}
            loading={loading}
            emptyText="Belum ada perubahan tercatat. Perubahan farm, kumbung, gateway, dan anggota akan muncul di sini."
            columns={[
              {
                key: 'change', header: 'Perubahan', cell: entry => (
                  <>
                    {describe(entry)}
                    {entry.configVersion !== undefined && <span className="text-xs text-muted-foreground"> · config v{entry.configVersion}</span>}
                  </>
                ),
              },
              { key: 'actor', hideOnMobile: true, header: 'Oleh', className: 'text-xs text-muted-foreground', cell: entry => (entry.actorUid === uid ? 'Anda' : entry.actorEmail || shortId(entry.actorUid)) },
              { key: 'time', header: 'Waktu', className: 'text-xs text-muted-foreground whitespace-nowrap', cell: entry => new Date(entry.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
