import { randomUUID } from 'node:crypto';
import { accessibleFarmIds, farmRole, requireFarm } from './access.js';
import { withTransaction } from './db.js';
import { audit } from './domain.js';
import { telemetryRow } from './forecast.js';
import { topicFor } from './mqtt.js';
import { normalizeClaimCode, verifySecret, HW_UID_PATTERN } from './secrets.js';
import {
  HttpError, LOCAL_ID, cleanReadings, deviceTime, parseCapabilities, validateActuatorConfig,
} from './validate.js';

const iso = value => (value ? new Date(value).toISOString() : null);
const ACTUATOR_LABEL = { sprayer: 'Sprayer', fan: 'Kipas', humidifier: 'Humidifier', pump: 'Pompa', light: 'Lampu', heater: 'Pemanas', other: 'Aktuator' };
const defaultSensorName = sensor => `Sensor ${sensor.id}`;
const defaultActuatorName = actuator => `${ACTUATOR_LABEL[actuator.type] || 'Aktuator'} ${actuator.id}`;
const CONTROL_VERSION = 3;

/**
 * Layanan IoT: memproses pesan MQTT perangkat dan aksi dashboard.
 * Gateway milik farm: anggota farm melihat & mengontrol, owner farm mengklaim/melepas/menempatkan.
 * ctx = { pool, hub, alerts, publish(topic, payload, opts), config, log }
 */
export function createIotService(ctx) {
  const { pool, hub, alerts, config, log } = ctx;

  // ───────────────────────────── serialisasi untuk API/SSE

  function sensorView(row) {
    return {
      id: row.id, gatewayId: row.gateway_id, localId: row.local_id, type: row.type, metrics: row.metrics,
      name: row.name, kumbungId: row.kumbung_id, status: row.status, error: row.error,
      lastValues: row.last_values, lastTs: iso(row.last_ts),
    };
  }

  function actuatorView(row) {
    return {
      id: row.id, gatewayId: row.gateway_id, localId: row.local_id, type: row.type, name: row.name,
      kumbungId: row.kumbung_id, maxRunSec: row.max_run_sec, minIntervalSec: row.min_interval_sec,
      mode: row.mode, schedules: row.schedules || [], rules: row.rules || [],
      configVersion: row.config_version, appliedVersion: row.applied_version,
      pendingSync: row.applied_version < row.config_version,
      status: row.status, error: row.error,
      state: row.state, stateSource: row.state_source, stateSince: iso(row.state_since), offAt: iso(row.off_at),
      stateTrigger: row.state_trigger || null,
    };
  }

  const actuatorEventView = row => ({
    id: String(row.id), actuatorId: row.actuator_id, gatewayId: row.gateway_id, kind: row.kind, state: row.state,
    source: row.source, trigger: row.trigger, actorUid: row.actor_uid, actorEmail: row.actor_email || null,
    detail: row.detail, createdAt: iso(row.created_at),
  });

  async function logActuatorEvent(db, actuator, event) {
    const { rows: [row] } = await db.query(
      `INSERT INTO actuator_events (actuator_id, gateway_id, kind, state, source, trigger, actor_uid, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [actuator.id, actuator.gateway_id, event.kind, event.state ?? null, event.source ?? null, event.trigger ?? null, event.actorUid ?? null, event.detail ?? {}],
    );
    hub.emitGateway(actuator.gateway_id, 'actuator_event', actuatorEventView(row));
  }

  function gatewayView(row, sensors = [], actuators = []) {
    return {
      id: row.id, name: row.name, farmId: row.farm_id, model: row.model, firmware: row.firmware,
      online: row.online, lastSeenAt: iso(row.last_seen_at), claimedAt: iso(row.claimed_at),
      configVersion: row.config_version, appliedConfigVersion: row.applied_config_version,
      pendingSync: row.applied_config_version < row.config_version,
      sensors: sensors.map(sensorView), actuators: actuators.map(actuatorView),
    };
  }

  const commandView = row => ({
    id: row.id, gatewayId: row.gateway_id, actuatorId: row.actuator_id, action: row.action,
    durationSec: row.duration_sec, requestedBy: row.requested_by, createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at), status: row.status, reason: row.reason, ackedAt: iso(row.acked_at),
  });

  // ───────────────────────────── config gateway (versi terbaru, retained)

  async function buildConfig(db, gatewayId, version) {
    const { rows } = await db.query('SELECT * FROM actuators WHERE gateway_id = $1 ORDER BY local_id', [gatewayId]);
    const actuators = {};
    for (const row of rows) {
      // Hanya jadwal aktif yang dikirim; gateway tidak perlu tahu jadwal yang dimatikan.
      actuators[row.local_id] = {
        mode: row.mode,
        maxRunSec: row.max_run_sec,
        minIntervalSec: row.min_interval_sec,
        schedules: row.mode === 'timer'
          ? (row.schedules || []).filter(item => item.enabled).map(({ enabled, ...item }) => item)
          : null,
        rules: row.mode === 'auto'
          ? (row.rules || []).filter(item => item.enabled).map(item => ({
            id: item.id, sensor: item.sensorLocalId, metric: item.metric, operator: item.operator,
            threshold: item.threshold, stop: item.stop, cooldownSec: item.cooldownSec,
          }))
          : null,
      };
    }
    // Jam lokal farm (Asia/Jakarta, tanpa DST) untuk jadwal "jam tertentu" & rentang jam di gateway.
    // controlVersion: format kontrol (3 = jadwal + aturan otomatis); dipakai untuk memperbarui config lama.
    return { version, controlVersion: CONTROL_VERSION, telemetryIntervalSec: config.telemetryIntervalSec, utcOffsetMin: 420, actuators };
  }

  /** Naikkan versi config gateway (dalam transaksi `db`) dan simpan payload terbaru. */
  async function bumpConfig(db, gatewayId, actuatorIds = []) {
    const { rows: [gateway] } = await db.query(
      'UPDATE gateways SET config_version = config_version + 1 WHERE id = $1 RETURNING config_version',
      [gatewayId],
    );
    const version = gateway.config_version;
    if (actuatorIds.length) {
      await db.query('UPDATE actuators SET config_version = $2 WHERE id = ANY($1)', [actuatorIds, version]);
    }
    const payload = await buildConfig(db, gatewayId, version);
    await db.query('UPDATE gateways SET config = $2 WHERE id = $1', [gatewayId, payload]);
    return payload;
  }

  const publishConfig = (gatewayId, payload) =>
    ctx.publish(topicFor(gatewayId, 'config'), payload, { qos: 1, retain: true });

  // ───────────────────────────── pesan perangkat

  /** Aktivitas valid dari perangkat: perbarui last_seen, kirim event bila sebelumnya offline. */
  async function touch(gatewayId) {
    const { rows } = await pool.query(
      `WITH prev AS (SELECT online FROM gateways WHERE id = $1)
       UPDATE gateways g SET last_seen_at = now(), online = true FROM prev WHERE g.id = $1
       RETURNING prev.online AS was_online, g.claimed_by, g.farm_id`,
      [gatewayId],
    );
    const gateway = rows[0] || null;
    if (gateway && !gateway.was_online) await markOnline(gatewayId, gateway.farm_id);
    return gateway;
  }

  async function markOnline(gatewayId, farmId) {
    hub.emitGateway(gatewayId, 'gateway', { online: true, lastSeenAt: new Date().toISOString() });
    await alerts.onGatewayOnline(gatewayId, farmId);
  }

  async function handleRegister(hwUid, payload) {
    const device = (await pool.query('SELECT hw_uid FROM devices WHERE hw_uid = $1', [hwUid])).rows[0];
    if (!device) return log.warn?.(`[register] ${hwUid} tidak ada di registry pabrik`);
    const caps = parseCapabilities(payload);
    if (caps.rejected.length) log.warn?.(`[register] ${hwUid} entri ditolak: ${caps.rejected.join(', ')}`);
    const firmware = typeof payload?.firmware === 'string' ? payload.firmware.slice(0, 64) : null;
    const model = typeof payload?.model === 'string' ? payload.model.slice(0, 64) : null;

    const published = await withTransaction(pool, async db => {
      const { rows: [gateway] } = await db.query(
        `INSERT INTO gateways (id, model, firmware, capabilities, registered_at, online, last_seen_at)
         VALUES ($1, $2, $3, $4, now(), true, now())
         ON CONFLICT (id) DO UPDATE SET model = EXCLUDED.model, firmware = EXCLUDED.firmware,
           capabilities = EXCLUDED.capabilities, registered_at = now(), online = true, last_seen_at = now()
         RETURNING *`,
        [hwUid, model, firmware, { sensors: caps.sensors, actuators: caps.actuators }],
      );
      if (!gateway.claimed_by) return null;
      // Jenis & parameter sensor mengikuti laporan perangkat terbaru (mis. firmware diperbarui).
      for (const sensor of caps.sensors) {
        await db.query(
          'UPDATE sensors SET type = $3, metrics = $4 WHERE gateway_id = $1 AND local_id = $2 AND (type <> $3 OR metrics <> $4)',
          [hwUid, sensor.id, sensor.type, sensor.metrics],
        );
      }
      // Gateway sudah diklaim: tambahkan sensor/aktuator baru dari capabilities (yang lama dipertahankan).
      const added = await insertCatalog(db, gateway, caps, null);
      return added.actuatorIds.length ? bumpConfig(db, hwUid, added.actuatorIds) : null;
    });
    if (published) await publishConfig(hwUid, published);
    hub.emitGateway(hwUid, 'gateway', { online: true, registered: true });
  }

  /**
   * Buat sensor/aktuator dari laporan gateway. `labels` (opsional, saat klaim):
   * { sensors: { S1: { name, kumbungId } }, actuators: { A1: { name, kumbungId } } } — kumbung sudah divalidasi.
   */
  async function insertCatalog(db, gateway, caps, kumbungId, labels = {}) {
    const sensorIds = [];
    const actuatorIds = [];
    for (const sensor of caps.sensors) {
      const id = `${gateway.id}-${sensor.id}`;
      const label = labels.sensors?.[sensor.id] || {};
      const { rowCount } = await db.query(
        `INSERT INTO sensors (id, gateway_id, local_id, type, metrics, name, kumbung_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [id, gateway.id, sensor.id, sensor.type, sensor.metrics, label.name || defaultSensorName(sensor), label.kumbungId === undefined ? kumbungId : label.kumbungId],
      );
      if (rowCount) sensorIds.push(id);
    }
    for (const actuator of caps.actuators) {
      const id = `${gateway.id}-${actuator.id}`;
      const label = labels.actuators?.[actuator.id] || {};
      const { rowCount } = await db.query(
        `INSERT INTO actuators (id, gateway_id, local_id, type, name, kumbung_id, max_run_sec, min_interval_sec)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [id, gateway.id, actuator.id, actuator.type, label.name || defaultActuatorName(actuator), label.kumbungId === undefined ? kumbungId : label.kumbungId, actuator.maxRunSec, actuator.minIntervalSec],
      );
      if (rowCount) actuatorIds.push(id);
    }
    return { sensorIds, actuatorIds };
  }

  /** Nama & kumbung per sensor/aktuator dari form klaim (kumbung harus di farm yang sama). */
  async function claimLabels(db, input, farmId) {
    const result = { sensors: {}, actuators: {} };
    for (const kind of ['sensors', 'actuators']) {
      for (const [localId, item] of Object.entries(input?.[kind] && typeof input[kind] === 'object' ? input[kind] : {})) {
        if (!LOCAL_ID.test(localId)) continue;
        const name = typeof item?.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 100) : null;
        const label = name ? { name } : {};
        if (item?.kumbungId !== undefined) label.kumbungId = await kumbungInFarm(db, item.kumbungId, farmId);
        result[kind][localId] = label;
      }
    }
    return result;
  }

  async function handleStatus(hwUid, payload) {
    if (payload?.online === false) {
      const { rows } = await pool.query(
        'UPDATE gateways SET online = false WHERE id = $1 AND online RETURNING id, farm_id, last_seen_at', [hwUid],
      );
      if (rows.length) {
        hub.emitGateway(hwUid, 'gateway', { online: false });
        await alerts.onGatewayOffline(hwUid, rows[0].farm_id, rows[0].last_seen_at);
      }
      return;
    }
    const before = (await pool.query('SELECT online, claimed_by, farm_id, config_version, config FROM gateways WHERE id = $1', [hwUid])).rows[0];
    if (!before) return;
    const firmware = typeof payload?.firmware === 'string' ? payload.firmware.slice(0, 64) : null;
    await pool.query(
      'UPDATE gateways SET online = true, last_seen_at = now(), firmware = COALESCE($2, firmware) WHERE id = $1',
      [hwUid, firmware],
    );
    if (!before.online) await markOnline(hwUid, before.farm_id);
    // Reconnect dengan config lama: kirim ulang versi terbaru (config juga retained di broker).
    const reported = Number(payload?.configVersion);
    if (before.claimed_by && Number.isInteger(reported) && reported < before.config_version && before.config?.version) {
      await publishConfig(hwUid, before.config);
    }
  }

  async function handleTelemetry(hwUid, payload) {
    const gateway = await touch(hwUid);
    if (!gateway?.claimed_by) return; // perangkat belum diklaim: data tidak disimpan
    const ts = deviceTime(payload?.ts);
    const bucketMs = config.historyBucketSec * 1000;
    const bucket = new Date(ts - (ts % bucketMs));
    const { rows: sensors } = await pool.query('SELECT id, local_id, metrics, kumbung_id FROM sensors WHERE gateway_id = $1', [hwUid]);
    for (const sensor of sensors) {
      const values = cleanReadings(payload?.readings?.[sensor.local_id], sensor.metrics);
      if (!Object.keys(values).length) continue;
      const { rowCount: latest } = await pool.query(
        `UPDATE sensors SET last_values = $2, last_ts = $3, status = 'active', error = NULL
         WHERE id = $1 AND (last_ts IS NULL OR last_ts <= $3)`,
        [sensor.id, values, new Date(ts)],
      );
      await pool.query(
        `INSERT INTO telemetry_history (sensor_id, bucket_start, ts, "values") VALUES ($1, $2, $3, $4)
         ON CONFLICT (sensor_id, bucket_start) DO NOTHING`,
        [sensor.id, bucket, new Date(ts), values],
      );
      hub.emitGateway(hwUid, 'telemetry', { sensorId: sensor.id, kumbungId: sensor.kumbung_id, values, ts: new Date(ts).toISOString() });
      // Alert hanya dari pembacaan terbaru (data tertunda/terlambat tidak memicu alert).
      if (latest) await alerts.onTelemetry({ farmId: gateway.farm_id, kumbungId: sensor.kumbung_id, gatewayId: hwUid, sensorId: sensor.id }, values);
    }
  }

  /** Pemicu nyala dari gateway: { rule: id } atau { schedule: id }; selain itu null. */
  const cleanTrigger = trigger => {
    for (const key of ['rule', 'schedule']) {
      if (typeof trigger?.[key] === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(trigger[key])) return { [key]: trigger[key] };
    }
    return null;
  };

  /**
   * Terapkan status relay dari gateway; setiap perubahan nyala/mati (atau sumbernya) dicatat ke log
   * aktuator. `actorUid` = pengguna yang memberi perintah manual (dari ACK command).
   */
  async function applyActuatorState(hwUid, localId, item, actorUid = null) {
    const state = ['on', 'off', 'fault'].includes(item?.state) ? item.state : null;
    if (!state) return null;
    const source = typeof item.source === 'string' ? item.source.slice(0, 16) : null;
    const since = item.since ? new Date(deviceTime(item.since)) : new Date();
    const offAt = state === 'on' && item.offAt ? new Date(Number(item.offAt)) : null;
    const trigger = state === 'on' ? cleanTrigger(item.trigger) : null;
    const row = await withTransaction(pool, async db => {
      const { rows: [previous] } = await db.query(
        'SELECT state, state_source FROM actuators WHERE gateway_id = $1 AND local_id = $2 FOR UPDATE',
        [hwUid, localId],
      );
      if (!previous) return null;
      const { rows: [updated] } = await db.query(
        `UPDATE actuators SET state = $3, state_source = $4, state_since = $5, off_at = $6, state_trigger = $7
         WHERE gateway_id = $1 AND local_id = $2 RETURNING *`,
        [hwUid, localId, state, source, since, offAt && Number.isFinite(offAt.getTime()) ? offAt : null, trigger],
      );
      if (previous.state !== state || (state === 'on' && previous.state_source !== source)) {
        await logActuatorEvent(db, updated, { kind: 'state', state, source, trigger, actorUid });
      }
      return updated;
    });
    if (row) hub.emitGateway(hwUid, 'actuator', actuatorView(row));
    return row;
  }

  async function handleState(hwUid, payload) {
    const gateway = await touch(hwUid);
    if (!gateway?.claimed_by) return;
    for (const [localId, item] of Object.entries(payload?.actuators || {})) await applyActuatorState(hwUid, localId, item);
  }

  async function handleAck(hwUid, payload) {
    const gateway = await touch(hwUid);
    if (!gateway?.claimed_by) return;
    if (payload?.type === 'command') return handleCommandAck(hwUid, payload);
    if (payload?.type === 'config') return handleConfigAck(hwUid, payload);
    return undefined;
  }

  async function handleCommandAck(hwUid, payload) {
    const status = ['success', 'failed', 'rejected', 'expired'].includes(payload?.status) ? payload.status : null;
    if (!status || typeof payload.id !== 'string') return;
    // Hanya command milik gateway ini; ACK ganda untuk status final yang sama diabaikan.
    // ACK terlambat setelah backend menandai "expired" tetap dicatat agar status sesuai kondisi relay.
    const { rows } = await pool.query(
      `UPDATE commands SET status = $3, reason = $4, acked_at = now()
       WHERE id::text = $1 AND gateway_id = $2 AND (status = 'pending' OR (status = 'expired' AND acked_at IS NULL))
       RETURNING *`,
      [payload.id, hwUid, status, typeof payload.reason === 'string' ? payload.reason.slice(0, 120) : null],
    );
    if (!rows[0]) return;
    const command = rows[0];
    hub.emitGateway(hwUid, 'command', commandView(command));
    if (payload.state) {
      const localId = (await pool.query('SELECT local_id FROM actuators WHERE id = $1', [command.actuator_id])).rows[0]?.local_id;
      if (localId) {
        await applyActuatorState(hwUid, localId, {
          state: payload.state, source: command.action === 'estop' ? 'estop' : 'manual', offAt: payload.offAt,
        }, command.requested_by);
      }
    }
  }

  async function handleConfigAck(hwUid, payload) {
    const version = Number(payload?.version);
    if (!Number.isInteger(version)) return;
    const items = payload.items && typeof payload.items === 'object' ? payload.items : {};
    await withTransaction(pool, async db => {
      if (payload.status === 'applied') {
        await db.query(
          `UPDATE gateways SET applied_config_version = GREATEST(applied_config_version, $2)
           WHERE id = $1 AND $2 <= config_version`,
          [hwUid, version],
        );
      }
      for (const [localId, item] of Object.entries(items)) {
        const ok = item?.status === 'ok';
        const error = ok ? null : String(item?.error || item?.status || 'error').slice(0, 200);
        // Versi di masa depan (lebih besar dari config backend) diabaikan.
        await db.query(
          `UPDATE actuators SET applied_version = CASE WHEN $4 THEN GREATEST(applied_version, $3) ELSE applied_version END,
             status = CASE WHEN $4 THEN 'active' ELSE 'error' END, error = $5
           WHERE gateway_id = $1 AND local_id = $2
             AND $3 <= (SELECT config_version FROM gateways WHERE id = $1)`,
          [hwUid, localId, version, ok, error],
        );
        await db.query(
          `UPDATE sensors SET status = CASE WHEN $3 THEN 'active' ELSE 'error' END, error = $4
           WHERE gateway_id = $1 AND local_id = $2`,
          [hwUid, localId, ok, error],
        );
      }
    });
    const { rows: [gateway] } = await pool.query('SELECT * FROM gateways WHERE id = $1', [hwUid]);
    const { rows: actuators } = await pool.query('SELECT * FROM actuators WHERE gateway_id = $1 ORDER BY local_id', [hwUid]);
    const { rows: sensors } = await pool.query('SELECT * FROM sensors WHERE gateway_id = $1 ORDER BY local_id', [hwUid]);
    hub.emitGateway(hwUid, 'config', {
      version, status: payload.status === 'applied' ? 'applied' : 'rejected',
      reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 200) : null,
      gateway: gatewayView(gateway, sensors, actuators),
    });
  }

  async function onDeviceMessage(hwUid, kind, payload) {
    if (!HW_UID_PATTERN.test(hwUid)) return undefined;
    switch (kind) {
      case 'register': return handleRegister(hwUid, payload);
      case 'status': return handleStatus(hwUid, payload);
      case 'telemetry': return handleTelemetry(hwUid, payload);
      case 'state': return handleState(hwUid, payload);
      case 'ack': return handleAck(hwUid, payload);
      default: return undefined;
    }
  }

  // ───────────────────────────── aksi dashboard

  /**
   * Gateway terklaim yang dapat diakses user lewat keanggotaan farm. `owner: true` mewajibkan
   * owner farm (403 untuk operator); bukan anggota → 404.
   */
  async function gatewayAccess(db, user, gatewayId, { owner = false, lock = false } = {}) {
    const { rows } = await db.query(`SELECT * FROM gateways WHERE id = $1 AND claimed_by IS NOT NULL${lock ? ' FOR UPDATE' : ''}`, [gatewayId]);
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Gateway tidak ditemukan.');
    await requireFarm(db, user, rows[0].farm_id, { owner, notFound: 'Gateway tidak ditemukan.' });
    return rows[0];
  }

  async function gatewayViews(gateways) {
    if (!gateways.length) return [];
    const ids = gateways.map(row => row.id);
    const { rows: sensors } = await pool.query('SELECT * FROM sensors WHERE gateway_id = ANY($1) ORDER BY local_id', [ids]);
    const { rows: actuators } = await pool.query('SELECT * FROM actuators WHERE gateway_id = ANY($1) ORDER BY local_id', [ids]);
    return gateways.map(row => gatewayView(
      row,
      sensors.filter(sensor => sensor.gateway_id === row.id),
      actuators.filter(actuator => actuator.gateway_id === row.id),
    ));
  }

  async function listGateways(user, farmId = null) {
    let farmIds = await accessibleFarmIds(pool, user);
    if (farmId) farmIds = farmIds.filter(id => id === farmId);
    const { rows } = await pool.query('SELECT * FROM gateways WHERE farm_id = ANY($1) ORDER BY claimed_at', [farmIds]);
    return gatewayViews(rows);
  }

  async function getGateway(user, gatewayId) {
    return (await gatewayViews([await gatewayAccess(pool, user, gatewayId)]))[0];
  }

  async function verifyClaim(db, hwUid, claimCode, lock = false) {
    if (!HW_UID_PATTERN.test(hwUid || '')) throw new HttpError(400, 'invalid_uid', 'UID gateway tidak valid.');
    const device = (await db.query('SELECT * FROM devices WHERE hw_uid = $1', [hwUid])).rows[0];
    // Pesan sama untuk UID tidak dikenal dan kode salah agar UID tidak bisa dienumerasi.
    if (!device || !verifySecret(normalizeClaimCode(claimCode), device.claim_hash)) {
      throw new HttpError(403, 'invalid_claim', 'UID atau kode klaim tidak cocok.');
    }
    const gateway = (await db.query(`SELECT * FROM gateways WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [hwUid])).rows[0];
    if (!gateway?.registered_at) throw new HttpError(409, 'not_registered', 'Perangkat belum pernah terhubung. Nyalakan gateway dan pastikan Wi-Fi tersambung.');
    if (gateway.claimed_by) throw new HttpError(409, 'already_claimed', 'Perangkat sudah terpasang di farm lain. Owner farm tersebut harus melepasnya terlebih dahulu.');
    return gateway;
  }

  async function previewDevice(hwUid, claimCode) {
    const gateway = await verifyClaim(pool, hwUid, claimCode);
    return {
      id: gateway.id, model: gateway.model, firmware: gateway.firmware, online: gateway.online,
      lastSeenAt: iso(gateway.last_seen_at), capabilities: gateway.capabilities,
    };
  }

  /** Kumbung tujuan harus berada di farm yang sama (null = belum ditempatkan). */
  async function kumbungInFarm(db, kumbungId, farmId) {
    if (kumbungId === null || kumbungId === undefined || kumbungId === '') return null;
    const { rows } = await db.query('SELECT id FROM kumbungs WHERE id = $1 AND farm_id = $2', [String(kumbungId), farmId]);
    if (!rows[0]) throw new HttpError(400, 'invalid_kumbung', 'Kumbung harus berada di farm yang sama dengan gateway.');
    return rows[0].id;
  }

  async function claimGateway(user, input) {
    const name = typeof input?.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 100) : input?.hwUid;
    const farmId = typeof input?.farmId === 'string' ? input.farmId : '';
    if (!farmId) throw new HttpError(400, 'invalid_input', 'Pilih farm tujuan gateway.');
    // Kode klaim diverifikasi dulu agar kegagalan tebakan selalu tercatat oleh pembatas percobaan.
    await verifyClaim(pool, input?.hwUid, input?.claimCode);
    const payload = await withTransaction(pool, async db => {
      await requireFarm(db, user, farmId, { owner: true });
      const gateway = await verifyClaim(db, input?.hwUid, input?.claimCode, true);
      const kumbungId = await kumbungInFarm(db, input?.kumbungId, farmId);
      await db.query(
        `UPDATE gateways SET claimed_by = $2, farm_id = $3, name = $4, claimed_at = now(),
           applied_config_version = config_version WHERE id = $1`,
        [gateway.id, user.uid, farmId, name],
      );
      const caps = parseCapabilities(gateway.capabilities);
      const { actuatorIds } = await insertCatalog(db, gateway, caps, kumbungId, await claimLabels(db, input, farmId));
      await audit(db, farmId, user.uid, 'gateway_claim', { gatewayId: gateway.id, toKumbungId: kumbungId });
      return bumpConfig(db, gateway.id, actuatorIds);
    });
    hub.setGatewayFarm(input.hwUid, farmId);
    hub.emitFarm(farmId, 'changed', { entity: 'gateway', farmId, id: input.hwUid, action: 'claim' });
    await publishConfig(input.hwUid, payload);
    return getGateway(user, input.hwUid);
  }

  /** Ganti nama gateway (owner farm). */
  async function renameGateway(user, gatewayId, input) {
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 100) throw new HttpError(400, 'invalid_input', 'Nama gateway 1–100 karakter.');
    const gateway = await gatewayAccess(pool, user, gatewayId, { owner: true });
    await pool.query('UPDATE gateways SET name = $2 WHERE id = $1', [gatewayId, name]);
    hub.emitFarm(gateway.farm_id, 'changed', { entity: 'gateway', farmId: gateway.farm_id, id: gatewayId, action: 'update' });
    return getGateway(user, gatewayId);
  }

  async function unclaimGateway(user, gatewayId) {
    const { payload, farmId } = await withTransaction(pool, async db => {
      const gateway = await gatewayAccess(db, user, gatewayId, { owner: true, lock: true });
      // Data farm lama dihapus agar tidak terlihat oleh pengklaim berikutnya.
      await db.query('DELETE FROM commands WHERE gateway_id = $1', [gatewayId]);
      await db.query('DELETE FROM alerts WHERE gateway_id = $1', [gatewayId]);
      await db.query('DELETE FROM sensors WHERE gateway_id = $1', [gatewayId]);
      await db.query('DELETE FROM actuators WHERE gateway_id = $1', [gatewayId]);
      await db.query(
        'UPDATE gateways SET claimed_by = NULL, farm_id = NULL, name = NULL, claimed_at = NULL WHERE id = $1',
        [gatewayId],
      );
      await audit(db, gateway.farm_id, user.uid, 'gateway_unclaim', { gatewayId });
      return { payload: await bumpConfig(db, gatewayId), farmId: gateway.farm_id }; // config kosong: otomasi berhenti
    });
    hub.emitFarm(farmId, 'changed', { entity: 'gateway', farmId, id: gatewayId, action: 'unclaim' });
    hub.setGatewayFarm(gatewayId, null);
    await publishConfig(gatewayId, payload);
  }

  async function updateEntity(user, table, id, input) {
    const { view, farmId, gatewayId } = await withTransaction(pool, async db => {
      const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows[0]) throw new HttpError(404, 'not_found', 'Data tidak ditemukan.');
      const gateway = await gatewayAccess(db, user, rows[0].gateway_id, { owner: true });
      const current = rows[0];
      const name = typeof input?.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 100) : current.name;
      const kumbungId = input?.kumbungId === undefined ? current.kumbung_id : await kumbungInFarm(db, input.kumbungId, gateway.farm_id);
      const { rows: [updated] } = await db.query(
        `UPDATE ${table} SET name = $2, kumbung_id = $3 WHERE id = $1 RETURNING *`,
        [id, name, kumbungId],
      );
      if (kumbungId !== current.kumbung_id) {
        await audit(db, gateway.farm_id, user.uid, table === 'sensors' ? 'sensor_move' : 'actuator_move', {
          [table === 'sensors' ? 'sensorId' : 'actuatorId']: id, gatewayId: gateway.id,
          fromKumbungId: current.kumbung_id, toKumbungId: kumbungId,
        });
      }
      return { view: table === 'sensors' ? sensorView(updated) : actuatorView(updated), farmId: gateway.farm_id, gatewayId: gateway.id };
    });
    hub.emitFarm(farmId, 'changed', { entity: 'gateway', farmId, id: gatewayId, action: 'update' });
    return view;
  }

  async function memberActuator(db, user, actuatorId, lock = false) {
    const { rows } = await db.query(
      `SELECT a.*, g.online AS gateway_online, g.farm_id FROM actuators a JOIN gateways g ON g.id = a.gateway_id
       WHERE a.id = $1 AND g.claimed_by IS NOT NULL${lock ? ' FOR UPDATE OF a' : ''}`,
      [actuatorId],
    );
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Aktuator tidak ditemukan.');
    await requireFarm(db, user, rows[0].farm_id, { notFound: 'Aktuator tidak ditemukan.' });
    return rows[0];
  }

  async function sendCommand(user, actuatorId, input) {
    const actuator = await memberActuator(pool, user, actuatorId);
    const action = input?.action;
    if (!['on', 'off', 'estop'].includes(action)) throw new HttpError(400, 'invalid_action', 'Aksi harus on, off, atau estop.');
    let durationSec = null;
    if (action === 'on') {
      durationSec = Number(input.durationSec);
      if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > actuator.max_run_sec) {
        throw new HttpError(400, 'invalid_duration', `Durasi ON 1–${actuator.max_run_sec} detik.`);
      }
    }
    // Perintah manual berlaku di semua mode: saat jadwal/otomatis aktif menjadi override sementara
    // (gateway melanjutkan jadwal/otomatis setelah aktuator mati).
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + config.commandTtlSec * 1000);
    const { rows: [command] } = await pool.query(
      `INSERT INTO commands (id, gateway_id, actuator_id, action, duration_sec, requested_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, actuator.gateway_id, actuator.id, action, durationSec, user.uid, expiresAt],
    );
    hub.emitGateway(actuator.gateway_id, 'command', commandView(command));
    try {
      // QoS1, tidak retained: perangkat yang offline menerima saat reconnect lalu menolak bila kedaluwarsa.
      await ctx.publish(topicFor(actuator.gateway_id, 'cmd'), {
        id, actuator: actuator.local_id, action, durationSec, expiresAt: expiresAt.getTime(),
      }, { qos: 1, retain: false });
    } catch (error) {
      const { rows: [failed] } = await pool.query(
        `UPDATE commands SET status = 'failed', reason = 'broker_unavailable' WHERE id = $1 AND status = 'pending' RETURNING *`,
        [id],
      );
      if (failed) hub.emitGateway(actuator.gateway_id, 'command', commandView(failed));
      throw new HttpError(503, 'broker_unavailable', `Broker MQTT tidak tersedia: ${error.message}`);
    }
    return { ...commandView(command), gatewayOnline: actuator.gateway_online };
  }

  async function getCommand(user, commandId) {
    const { rows } = await pool.query(
      `SELECT c.*, g.farm_id FROM commands c JOIN gateways g ON g.id = c.gateway_id WHERE c.id::text = $1`,
      [commandId],
    );
    if (!rows[0] || !(await farmRole(pool, user, rows[0].farm_id))) throw new HttpError(404, 'not_found', 'Command tidak ditemukan.');
    return commandView(rows[0]);
  }

  async function listCommands(user, actuatorId, limit = 20) {
    await memberActuator(pool, user, actuatorId);
    const { rows } = await pool.query(
      'SELECT * FROM commands WHERE actuator_id = $1 ORDER BY created_at DESC LIMIT $2',
      [actuatorId, Math.min(Math.max(Number(limit) || 20, 1), 100)],
    );
    return rows.map(commandView);
  }

  async function updateActuatorConfig(user, actuatorId, input) {
    const result = await withTransaction(pool, async db => {
      const actuator = await memberActuator(db, user, actuatorId, true);
      const { rows: sensorRows } = await db.query('SELECT id, local_id, metrics FROM sensors WHERE gateway_id = $1', [actuator.gateway_id]);
      const sensors = sensorRows.map(row => ({ id: row.id, localId: row.local_id, metrics: row.metrics }));
      const { mode, schedules, rules } = validateActuatorConfig(input, actuator, sensors);
      await db.query('UPDATE actuators SET mode = $2, schedules = $3, rules = $4 WHERE id = $1', [actuator.id, mode, JSON.stringify(schedules), JSON.stringify(rules)]);
      const payload = await bumpConfig(db, actuator.gateway_id, [actuator.id]);
      await logActuatorEvent(db, actuator, {
        kind: 'config', actorUid: user.uid,
        detail: { mode, schedules: schedules.filter(item => item.enabled).length, rules: rules.filter(item => item.enabled).length, version: payload.version },
      });
      return { gatewayId: actuator.gateway_id, payload };
    });
    await publishConfig(result.gatewayId, result.payload);
    const { rows: [row] } = await pool.query('SELECT * FROM actuators WHERE id = $1', [actuatorId]);
    const view = actuatorView(row);
    hub.emitGateway(result.gatewayId, 'actuator', view);
    return view;
  }

  const timeRange = (from, to, defaultMs) => {
    const end = Number.isFinite(Date.parse(to)) ? new Date(to) : Number.isFinite(Number(to)) && to !== '' && to !== undefined ? new Date(Number(to)) : new Date();
    const startRaw = Number.isFinite(Date.parse(from)) ? new Date(from) : Number.isFinite(Number(from)) && from !== '' && from !== undefined ? new Date(Number(from)) : null;
    return { start: startRaw || new Date(end.getTime() - defaultMs), end };
  };

  async function sensorHistory(user, sensorId, from, to) {
    const { rows: [sensor] } = await pool.query(
      'SELECT s.id, g.farm_id FROM sensors s JOIN gateways g ON g.id = s.gateway_id WHERE s.id = $1 AND g.claimed_by IS NOT NULL',
      [sensorId],
    );
    if (!sensor || !(await farmRole(pool, user, sensor.farm_id))) throw new HttpError(404, 'not_found', 'Sensor tidak ditemukan.');
    const { start, end } = timeRange(from, to, 86400000);
    const { rows } = await pool.query(
      `SELECT bucket_start, ts, "values" FROM telemetry_history
       WHERE sensor_id = $1 AND bucket_start BETWEEN $2 AND $3 ORDER BY bucket_start LIMIT 5000`,
      [sensorId, start, end],
    );
    return rows.map(row => ({ bucketStart: iso(row.bucket_start), ts: iso(row.ts), values: row.values }));
  }

  /**
   * Telemetry kumbung dalam format baris RTDB lama ({ timestamp, sensorId, temperature, ... }),
   * terurut lama → baru; `sensorId` opsional menyaring satu sensor.
   */
  async function kumbungTelemetry(user, kumbungId, { sensorId, from, to, maxPoints } = {}) {
    const { rows: [kumbung] } = await pool.query('SELECT farm_id FROM kumbungs WHERE id = $1', [kumbungId]);
    if (!kumbung || !(await farmRole(pool, user, kumbung.farm_id))) throw new HttpError(404, 'not_found', 'Kumbung tidak ditemukan.');
    const { start, end } = timeRange(from, to, 86400000);
    if (end - start > 400 * 86400000) throw new HttpError(400, 'invalid_range', 'Rentang maksimal 400 hari.');
    const limit = Math.min(Math.max(Number(maxPoints) || 1200, 1), 20000);
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT h.sensor_id, h.ts, h."values" FROM telemetry_history h JOIN sensors s ON s.id = h.sensor_id
         WHERE s.kumbung_id = $1 AND ($2::text IS NULL OR h.sensor_id = $2) AND h.ts BETWEEN $3 AND $4
         ORDER BY h.ts DESC LIMIT $5
       ) recent ORDER BY ts`,
      [kumbungId, sensorId || null, start, end, limit],
    );
    return rows.map(row => telemetryRow(row, kumbungId));
  }

  // ───────────────────────────── sweeper (dalam proses, tanpa scheduler cloud)

  async function expireCommands() {
    const { rows } = await pool.query(
      `UPDATE commands c SET status = 'expired',
         reason = CASE WHEN g.online THEN 'no_ack' ELSE 'gateway_offline' END
       FROM gateways g
       WHERE g.id = c.gateway_id AND c.status = 'pending' AND c.expires_at < now()
       RETURNING c.*`,
    );
    for (const row of rows) hub.emitGateway(row.gateway_id, 'command', commandView(row));
    return rows.length;
  }

  async function markStaleOffline() {
    const { rows } = await pool.query(
      `UPDATE gateways SET online = false
       WHERE online AND (last_seen_at IS NULL OR last_seen_at < now() - make_interval(secs => $1))
       RETURNING id, farm_id, last_seen_at`,
      [config.offlineAfterSec],
    );
    for (const row of rows) {
      hub.emitGateway(row.id, 'gateway', { online: false });
      await alerts.onGatewayOffline(row.id, row.farm_id, row.last_seen_at);
    }
    return rows.length;
  }

  async function pruneHistory() {
    const { rowCount } = await pool.query(
      'DELETE FROM telemetry_history WHERE bucket_start < now() - make_interval(days => $1)',
      [config.historyRetentionDays],
    );
    await pool.query('DELETE FROM actuator_events WHERE created_at < now() - make_interval(days => $1)', [config.historyRetentionDays]);
    return rowCount;
  }

  /** Log nyala/mati & perubahan pengaturan aktuator di kumbung (terbaru dulu). */
  async function kumbungActuatorLog(user, kumbungId, limit = 50) {
    const { rows: [kumbung] } = await pool.query('SELECT farm_id FROM kumbungs WHERE id = $1', [kumbungId]);
    if (!kumbung || !(await farmRole(pool, user, kumbung.farm_id))) throw new HttpError(404, 'not_found', 'Kumbung tidak ditemukan.');
    const { rows } = await pool.query(
      `SELECT e.*, u.email AS actor_email FROM actuator_events e
       JOIN actuators a ON a.id = e.actuator_id LEFT JOIN users u ON u.uid = e.actor_uid
       WHERE a.kumbung_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT $2`,
      [kumbungId, Math.min(Math.max(Number(limit) || 50, 1), 200)],
    );
    return rows.map(actuatorEventView);
  }

  /**
   * Gateway yang config tersimpannya masih format kontrol lama (`controlVersion` berbeda)
   * dibangun ulang dan dikirim, agar jadwal/otomatis hasil migrasi langsung berlaku di perangkat.
   */
  async function refreshOutdatedConfigs() {
    const { rows } = await pool.query(
      `SELECT id FROM gateways WHERE claimed_by IS NOT NULL AND model IS DISTINCT FROM 'legacy-firebase'
         AND (config->>'controlVersion') IS DISTINCT FROM $1`,
      [String(CONTROL_VERSION)],
    );
    for (const { id } of rows) {
      const payload = await withTransaction(pool, async db => {
        const { rows: actuators } = await db.query('SELECT id FROM actuators WHERE gateway_id = $1', [id]);
        return bumpConfig(db, id, actuators.map(row => row.id));
      });
      await publishConfig(id, payload);
      log.info?.(`[config] ${id} diperbarui ke format kontrol v${CONTROL_VERSION} (config v${payload.version})`);
    }
    return rows.length;
  }

  /** Muat peta routing SSE: gateway → farm, farm → anggota aktif. */
  async function loadRouting() {
    const { rows: gateways } = await pool.query('SELECT id, farm_id FROM gateways WHERE farm_id IS NOT NULL');
    for (const row of gateways) hub.setGatewayFarm(row.id, row.farm_id);
    const { rows: members } = await pool.query("SELECT farm_id, array_agg(uid) AS uids FROM farm_members WHERE status = 'active' GROUP BY farm_id");
    for (const row of members) hub.setFarmMembers(row.farm_id, row.uids);
  }

  return {
    onDeviceMessage,
    listGateways, getGateway, previewDevice, claimGateway, unclaimGateway, renameGateway,
    updateSensor: (user, id, input) => updateEntity(user, 'sensors', id, input),
    updateActuator: (user, id, input) => updateEntity(user, 'actuators', id, input),
    sendCommand, getCommand, listCommands, updateActuatorConfig, sensorHistory, kumbungTelemetry, kumbungActuatorLog,
    expireCommands, markStaleOffline, pruneHistory, loadRouting, refreshOutdatedConfigs,
  };
}
