import { api } from './api';
import { normalizeTelemetry } from './telemetry';

/**
 * Telemetry dari backend. Histori = sampel 10 menit per sensor (`GET /kumbungs/:id/telemetry`);
 * nilai terbaru datang realtime dari sensor gateway di IotContext (lihat `latestFromSensor`).
 */

/** History kumbung dalam rentang waktu (ms); `sensorId` opsional menyaring satu sensor. Terurut lama → baru. */
export async function readTelemetryHistory({ kumbungId, sensorId, startAt, endAt, maxPoints = 1200 }) {
  if (!kumbungId) throw new Error('kumbungId wajib diisi');
  const rows = await api.kumbungTelemetry(kumbungId, {
    sensorId,
    from: new Date(startAt).toISOString(),
    to: new Date(endAt).toISOString(),
    maxPoints,
  });
  return rows.map(row => normalizeTelemetry(row)).filter(row => row.timestamp > 0);
}

/** Telemetry ternormalisasi dari sensor gateway (IotContext); null bila belum pernah mengirim. */
export function latestFromSensor(sensor, now = Date.now()) {
  if (!sensor?.lastValues || !sensor.lastTs) return null;
  return normalizeTelemetry({
    ...sensor.lastValues,
    timestamp: Date.parse(sensor.lastTs),
    sensorId: sensor.id,
    kumbungId: sensor.kumbungId || null,
    farmId: sensor.farmId || null,
    schemaVersion: 'telemetry-v1',
  }, now);
}
