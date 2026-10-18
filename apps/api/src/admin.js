import { HttpError } from './validate.js';

// Konsol admin Tandurai: ringkasan seluruh sistem (pengguna, farm, kumbung, perangkat, alert,
// kesehatan layanan) untuk memantau klien. Hanya dipanggil setelah requireDeviceAdmin.

const ms = value => (value ? new Date(value).getTime() : null);
const num = value => Number(value || 0);
const STALE_SENSOR_MIN = 30; // sensor dianggap tidak mengirim data setelah 30 menit

export function createAdminService({ pool, health, config }) {
  const adminEmails = new Set(config.adminEmails || []);

  /** Angka utama, kesehatan layanan, dan daftar yang perlu perhatian. */
  async function overview() {
    const [{ rows: [counts] }, { rows: workers }, { rows: critical }, { rows: offline }, { rows: stale }, { rows: newest }] = await Promise.all([
      pool.query(`SELECT
        (SELECT count(*) FROM users) AS users,
        (SELECT count(*) FROM users WHERE last_seen_at > now() - interval '7 days') AS users_active_7d,
        (SELECT count(*) FROM farms WHERE status = 'active') AS farms,
        (SELECT count(*) FROM kumbungs WHERE status <> 'inactive') AS kumbungs,
        (SELECT count(*) FROM gateways WHERE farm_id IS NOT NULL) AS gateways,
        (SELECT count(*) FROM gateways WHERE farm_id IS NOT NULL AND online) AS gateways_online,
        (SELECT count(*) FROM devices d LEFT JOIN gateways g ON g.id = d.hw_uid WHERE g.farm_id IS NULL) AS devices_unclaimed,
        (SELECT count(*) FROM sensors s JOIN gateways g ON g.id = s.gateway_id WHERE g.farm_id IS NOT NULL) AS sensors,
        (SELECT count(*) FROM sensors s JOIN gateways g ON g.id = s.gateway_id
           WHERE g.farm_id IS NOT NULL AND s.last_ts > now() - make_interval(mins => ${STALE_SENSOR_MIN})) AS sensors_live,
        (SELECT count(*) FROM alerts WHERE status = 'active' AND severity = 'critical') AS alerts_critical,
        (SELECT count(*) FROM alerts WHERE status = 'active' AND severity = 'warning') AS alerts_warning,
        (SELECT count(*) FROM batches WHERE status = 'active') AS batches_active,
        (SELECT COALESCE(sum(COALESCE(c.weight_kg, h.weight_kg)), 0) FROM harvest_events h
           LEFT JOIN LATERAL (SELECT weight_kg FROM harvest_events x WHERE x.corrects_event_id = h.id ORDER BY x.created_at DESC LIMIT 1) c ON true
           WHERE h.corrects_event_id IS NULL AND h.harvested_at > now() - interval '30 days') AS harvest_kg_30d`),
      pool.query('SELECT name, data, updated_at FROM worker_status ORDER BY updated_at DESC'),
      pool.query(`SELECT a.*, f.name AS farm_name, k.name AS kumbung_name FROM alerts a
        JOIN farms f ON f.id = a.farm_id LEFT JOIN kumbungs k ON k.id = a.kumbung_id
        WHERE a.status = 'active' AND a.severity = 'critical' ORDER BY a.updated_at DESC LIMIT 20`),
      pool.query(`SELECT g.id, g.name, g.last_seen_at, f.id AS farm_id, f.name AS farm_name FROM gateways g
        JOIN farms f ON f.id = g.farm_id WHERE NOT g.online ORDER BY g.last_seen_at DESC NULLS LAST LIMIT 20`),
      pool.query(`SELECT s.id, s.name, s.last_ts, k.name AS kumbung_name, f.id AS farm_id, f.name AS farm_name FROM sensors s
        JOIN gateways g ON g.id = s.gateway_id JOIN farms f ON f.id = g.farm_id LEFT JOIN kumbungs k ON k.id = s.kumbung_id
        WHERE g.online AND s.kumbung_id IS NOT NULL AND (s.last_ts IS NULL OR s.last_ts < now() - make_interval(mins => ${STALE_SENSOR_MIN}))
        ORDER BY s.last_ts NULLS FIRST LIMIT 20`),
      pool.query('SELECT uid, email, username, created_at FROM users ORDER BY created_at DESC LIMIT 5'),
    ]);
    const service = await health();
    const worker = workers[0] || null;
    return {
      counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, key === 'harvest_kg_30d' ? Math.round(Number(value) * 100) / 100 : num(value)])),
      health: {
        api: true,
        database: Boolean(service.db),
        mqtt: Boolean(service.mqtt),
        realtimeClients: service.sseClients,
        worker: worker ? { name: worker.name, status: worker.data?.status || null, detail: worker.data?.detail || null, updatedAt: ms(worker.updated_at) } : null,
      },
      attention: {
        criticalAlerts: critical.map(row => ({
          id: row.id, farmId: row.farm_id, farmName: row.farm_name, kumbungName: row.kumbung_name, type: row.type,
          message: row.message, updatedAt: ms(row.updated_at),
        })),
        offlineGateways: offline.map(row => ({ id: row.id, name: row.name || row.id, farmId: row.farm_id, farmName: row.farm_name, lastSeenAt: ms(row.last_seen_at) })),
        staleSensors: stale.map(row => ({ id: row.id, name: row.name, kumbungName: row.kumbung_name, farmId: row.farm_id, farmName: row.farm_name, lastAt: ms(row.last_ts) })),
      },
      newestUsers: newest.map(row => ({ uid: row.uid, email: row.email, username: row.username, createdAt: ms(row.created_at) })),
      generatedAt: Date.now(),
    };
  }

  /** Semua akun beserta farm & perannya. */
  async function users() {
    const { rows } = await pool.query(`SELECT u.uid, u.email, u.email_verified, u.username, u.created_at, u.last_seen_at,
        COALESCE(json_agg(json_build_object('farmId', f.id, 'farmName', f.name, 'role', m.role, 'status', m.status)
          ORDER BY f.name) FILTER (WHERE f.id IS NOT NULL), '[]') AS farms
      FROM users u LEFT JOIN farm_members m ON m.uid = u.uid LEFT JOIN farms f ON f.id = m.farm_id
      GROUP BY u.uid ORDER BY u.last_seen_at DESC NULLS LAST`);
    return rows.map(row => ({
      uid: row.uid, email: row.email, username: row.username, emailVerified: row.email_verified,
      isAdmin: Boolean(row.email && row.email_verified && adminEmails.has(row.email.toLowerCase())),
      farms: row.farms, createdAt: ms(row.created_at), lastSeenAt: ms(row.last_seen_at),
    }));
  }

  /** Semua farm dengan statistik ringkas. */
  async function farms() {
    const { rows } = await pool.query(`SELECT f.id, f.name, f.location, f.status, f.created_at,
        (SELECT string_agg(COALESCE(u.email, u.uid), ', ') FROM farm_members m JOIN users u ON u.uid = m.uid
           WHERE m.farm_id = f.id AND m.role = 'owner' AND m.status = 'active') AS owners,
        (SELECT count(*) FROM farm_members m WHERE m.farm_id = f.id AND m.status = 'active') AS members,
        (SELECT count(*) FROM kumbungs k WHERE k.farm_id = f.id AND k.status <> 'inactive') AS kumbungs,
        (SELECT count(*) FROM gateways g WHERE g.farm_id = f.id) AS gateways,
        (SELECT count(*) FROM gateways g WHERE g.farm_id = f.id AND g.online) AS gateways_online,
        (SELECT count(*) FROM sensors s JOIN gateways g ON g.id = s.gateway_id WHERE g.farm_id = f.id) AS sensors,
        (SELECT max(s.last_ts) FROM sensors s JOIN gateways g ON g.id = s.gateway_id WHERE g.farm_id = f.id) AS last_data_at,
        (SELECT count(*) FROM alerts a WHERE a.farm_id = f.id AND a.status = 'active' AND a.severity = 'critical') AS alerts_critical,
        (SELECT count(*) FROM alerts a WHERE a.farm_id = f.id AND a.status = 'active' AND a.severity = 'warning') AS alerts_warning,
        (SELECT count(*) FROM batches b WHERE b.farm_id = f.id AND b.status = 'active') AS batches_active,
        (SELECT COALESCE(sum(h.weight_kg), 0) FROM harvest_events h WHERE h.farm_id = f.id AND h.corrects_event_id IS NULL
           AND h.harvested_at > now() - interval '30 days') AS harvest_kg_30d
      FROM farms f ORDER BY f.name, f.id`);
    return rows.map(row => ({
      id: row.id, name: row.name, location: row.location, status: row.status, createdAt: ms(row.created_at),
      owners: row.owners || '', members: num(row.members), kumbungs: num(row.kumbungs),
      gateways: num(row.gateways), gatewaysOnline: num(row.gateways_online), sensors: num(row.sensors),
      lastDataAt: ms(row.last_data_at), alertsCritical: num(row.alerts_critical), alertsWarning: num(row.alerts_warning),
      batchesActive: num(row.batches_active), harvestKg30d: Math.round(Number(row.harvest_kg_30d) * 100) / 100,
    }));
  }

  /** Detail satu farm: anggota, kumbung (batch berjalan + kondisi terakhir), gateway. */
  async function farmDetail(farmId) {
    const { rows: [farm] } = await pool.query('SELECT * FROM farms WHERE id = $1', [farmId]);
    if (!farm) throw new HttpError(404, 'not_found', 'Farm tidak ditemukan.');
    const [{ rows: members }, { rows: kumbungs }, { rows: gateways }] = await Promise.all([
      pool.query(`SELECT m.uid, m.role, m.status, u.email, u.username, u.last_seen_at FROM farm_members m
        JOIN users u ON u.uid = m.uid WHERE m.farm_id = $1 ORDER BY m.role, u.email`, [farmId]),
      pool.query(`SELECT k.id, k.name, k.status, k.capacity_baglog,
          b.id AS batch_id, b.started_at, b.growth_stage, b.baglog_count_active,
          (SELECT count(*) FROM sensors s WHERE s.kumbung_id = k.id) AS sensors,
          (SELECT json_build_object(
             'temperature', avg((s.last_values->>'temperature')::float8),
             'humidity', avg((s.last_values->>'humidity')::float8),
             'co2', avg((s.last_values->>'co2')::float8), 'at', max(s.last_ts))
           FROM sensors s WHERE s.kumbung_id = k.id AND s.last_ts > now() - interval '1 hour') AS latest,
          (SELECT count(*) FROM alerts a WHERE a.kumbung_id = k.id AND a.status = 'active') AS alerts_active
        FROM kumbungs k
        LEFT JOIN LATERAL (SELECT * FROM batches x WHERE x.kumbung_id = k.id AND x.status = 'active' ORDER BY x.started_at DESC LIMIT 1) b ON true
        WHERE k.farm_id = $1 ORDER BY k.name`, [farmId]),
      pool.query(`SELECT g.id, g.name, g.online, g.last_seen_at, g.firmware,
          (SELECT count(*) FROM sensors s WHERE s.gateway_id = g.id) AS sensors,
          (SELECT count(*) FROM actuators a WHERE a.gateway_id = g.id) AS actuators
        FROM gateways g WHERE g.farm_id = $1 ORDER BY g.name`, [farmId]),
    ]);
    const round = (value, digits) => (value == null ? null : Number(Number(value).toFixed(digits)));
    return {
      farm: { id: farm.id, name: farm.name, location: farm.location, status: farm.status, createdAt: ms(farm.created_at) },
      members: members.map(row => ({ uid: row.uid, email: row.email, username: row.username, role: row.role, status: row.status, lastSeenAt: ms(row.last_seen_at) })),
      kumbungs: kumbungs.map(row => ({
        id: row.id, name: row.name, status: row.status, capacityBaglog: row.capacity_baglog, sensors: num(row.sensors), alertsActive: num(row.alerts_active),
        batch: row.batch_id ? { id: row.batch_id, startedAt: ms(row.started_at), growthStage: row.growth_stage, baglogCountActive: row.baglog_count_active } : null,
        latest: row.latest?.at ? { temperature: round(row.latest.temperature, 1), humidity: round(row.latest.humidity, 1), co2: round(row.latest.co2, 0), at: ms(row.latest.at) } : null,
      })),
      gateways: gateways.map(row => ({ id: row.id, name: row.name || row.id, online: row.online, lastSeenAt: ms(row.last_seen_at), firmware: row.firmware, sensors: num(row.sensors), actuators: num(row.actuators) })),
    };
  }

  return { overview, users, farms, farmDetail };
}
