import { randomBytes } from 'node:crypto';
import {
  HW_UID_PATTERN, formatClaimCode, generateClaimCode, generateDeviceSecret, hashSecret,
} from './secrets.js';
import { HttpError } from './validate.js';

/**
 * Daftarkan satu perangkat di registry pabrik. Hanya hash secret & kode klaim yang disimpan;
 * nilai aslinya dikembalikan sekali untuk diisi ke gateway (secret) dan dicetak di label (kode klaim).
 */
export async function provisionDevice(pool, { hwUid, model = 'TDR-GW1' } = {}) {
  const id = hwUid || `TDR-${randomBytes(6).toString('hex').toUpperCase()}`;
  if (!HW_UID_PATTERN.test(id)) throw new HttpError(400, 'invalid_input', 'hwUid hanya huruf, angka, "-" atau "_" (4–64 karakter).');
  const deviceSecret = generateDeviceSecret();
  const claimCode = generateClaimCode();
  await pool.query(
    'INSERT INTO devices (hw_uid, secret_hash, claim_hash, model) VALUES ($1, $2, $3, $4)',
    [id, hashSecret(deviceSecret), hashSecret(claimCode), model],
  );
  return { hwUid: id, deviceSecret, claimCode: formatClaimCode(claimCode), model };
}

/** Alamat broker yang dipakai perangkat (bisa berbeda dari alamat yang dipakai backend). */
export const publicBroker = config => ({ host: config.mqttPublicHost, port: config.mqttPublicPort, tls: config.mqttPublicTls });

/**
 * Registry perangkat untuk admin Tandurai (halaman Registrasi Perangkat).
 * ctx = { pool, config }
 */
export function createDeviceRegistry({ pool, config }) {
  async function provision(input) {
    const count = Number(input?.count ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 50) throw new HttpError(400, 'invalid_input', 'Jumlah perangkat 1–50 per sekali daftar.');
    const model = typeof input?.model === 'string' && input.model.trim() ? input.model.trim().slice(0, 32) : 'TDR-GW1';
    const mqtt = publicBroker(config);
    const devices = [];
    for (let index = 0; index < count; index += 1) devices.push({ ...(await provisionDevice(pool, { model })), mqtt });
    return devices;
  }

  async function list(limit = 200) {
    const { rows } = await pool.query(
      `SELECT d.hw_uid, d.model, d.created_at, g.registered_at, g.online, g.last_seen_at, g.firmware,
              g.farm_id, f.name AS farm_name, g.claimed_at,
              (SELECT count(*)::int FROM sensors s WHERE s.gateway_id = d.hw_uid) AS sensor_count,
              (SELECT count(*)::int FROM actuators a WHERE a.gateway_id = d.hw_uid) AS actuator_count,
              COALESCE(jsonb_array_length(g.capabilities->'sensors'), 0) AS reported_sensors,
              COALESCE(jsonb_array_length(g.capabilities->'actuators'), 0) AS reported_actuators
       FROM devices d LEFT JOIN gateways g ON g.id = d.hw_uid LEFT JOIN farms f ON f.id = g.farm_id
       WHERE d.model IS DISTINCT FROM 'legacy-firebase'
       ORDER BY d.created_at DESC LIMIT $1`,
      [Math.min(Math.max(Number(limit) || 200, 1), 1000)],
    );
    const iso = value => (value ? new Date(value).toISOString() : null);
    return rows.map(row => ({
      hwUid: row.hw_uid, model: row.model, createdAt: iso(row.created_at), registeredAt: iso(row.registered_at),
      online: Boolean(row.online), lastSeenAt: iso(row.last_seen_at), firmware: row.firmware,
      farmId: row.farm_id, farmName: row.farm_name, claimedAt: iso(row.claimed_at),
      reportedSensors: row.reported_sensors, reportedActuators: row.reported_actuators,
      sensorCount: row.sensor_count, actuatorCount: row.actuator_count,
    }));
  }

  return { provision, list, broker: () => publicBroker(config) };
}
