import React, { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '../firebase';
import { subscribeAssignmentLog } from '@/lib/deviceManagementService';

const shortId = value => (value && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value);

function describe(entry) {
  const sensor = entry.sensorId;
  const gateway = entry.gatewayId;
  switch (entry.action) {
    case 'operator_add': return `Menambahkan operator ${shortId(entry.targetUid)}`;
    case 'operator_remove': return `Mencabut operator ${shortId(entry.targetUid)}`;
    case 'gateway_create': return `Membuat gateway ${gateway}`;
    case 'gateway_pair': return `Memasangkan UID ${shortId(entry.targetUid)} ke ${gateway}`;
    case 'gateway_unpair': return `Melepas pairing ${gateway}`;
    case 'gateway_disable': return `Mencabut gateway ${gateway}`;
    case 'gateway_reactivate': return `Mengaktifkan ulang ${gateway}`;
    case 'sensor_assign': return `Menugaskan ${sensor} ke ${entry.toKumbungId} lewat ${entry.toGatewayId}`;
    case 'sensor_move': return `Memindahkan ${sensor}: ${entry.fromKumbungId}/${entry.fromGatewayId} → ${entry.toKumbungId}/${entry.toGatewayId}`;
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

  useEffect(() => {
    setLoading(true);
    setError('');
    return subscribeAssignmentLog(farmId, list => {
      setEntries(list);
      setLoading(false);
    }, err => {
      setError(err.message);
      setLoading(false);
    });
  }, [farmId]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><History size={18} /> Riwayat perubahan</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="animate-spin" size={18} /> Memuat riwayat…
          </div>
        ) : error ? (
          <p className="py-4 text-center text-red-600">Gagal memuat riwayat: {error}</p>
        ) : !entries.length ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Belum ada perubahan tercatat. Perubahan gateway, sensor, dan anggota akan muncul di sini.</p>
        ) : (
          <ol className="space-y-2">
            {entries.map(entry => (
              <li key={entry.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-b last:border-0 pb-2 text-sm">
                <span>{describe(entry)}{entry.configVersion !== undefined && <span className="text-xs text-muted-foreground"> · config v{entry.configVersion}</span>}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {entry.actorUid === uid ? 'Anda' : shortId(entry.actorUid)} · {new Date(entry.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
