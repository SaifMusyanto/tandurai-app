// Perencana impor ekspor JSON Firebase RTDB → baris PostgreSQL backend (murni, tanpa I/O).
// Data yang tidak valid tidak diperbaiki diam-diam: dilewati dan dilaporkan di `anomalies`.
import { createHash } from 'node:crypto';
import {
  BATCH_STATUSES, GROWTH_STAGES, HARVEST_GRADES, KUMBUNG_STATUSES, SUBSTRATE_TYPES,
} from '../src/domainValidate.js';
import { METRIC_LIMITS } from '../src/validate.js';

const entries = value => Object.entries(value && typeof value === 'object' ? value : {});
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const num = value => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null);
const msOf = value => {
  const n = num(value);
  if (!n || n <= 0) return null;
  return n < 100000000000 ? n * 1000 : n;
};
const text = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const FARM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ENTITY_ID = /^[A-Za-z0-9_-]{1,120}$/;
const SECRET_KEY = /token|secret|password|credential/i;
const ALERT_SENSORS = new Set(['temperature_high', 'humidity_low', 'co2_high', 'device_offline']);
const BUCKET_MS = 10 * 60 * 1000;

/** ID gateway virtual penampung telemetry lama per farm (selalu valid sebagai hw_uid). */
export function legacyGatewayId(farmId) {
  const id = `LEGACY-${farmId}`;
  return id.length <= 64 ? id : `LEGACY-${createHash('sha256').update(farmId).digest('hex').slice(0, 16)}`;
}

export function planImport(data = {}, { harvestProfileKumbungId = null } = {}) {
  const t = data.tumbara || {};
  const anomalies = [];
  const skipped = [];
  const anomaly = (type, detail = {}) => anomalies.push({ type, ...detail });

  // ── users
  const users = new Map();
  const user = uid => {
    if (!users.has(uid)) users.set(uid, { uid, email: null, emailVerified: false, username: null, settings: {}, createdAt: null });
    return users.get(uid);
  };
  for (const [uid, record] of entries(data.users)) {
    const item = user(uid);
    item.email = text(record?.profile?.email, 254)?.toLowerCase() || null;
    item.username = text(record?.profile?.username, 100);
    item.createdAt = msOf(record?.profile?.createdAt);
    item.settings = Object.fromEntries(entries(record?.settings).filter(([key]) => !SECRET_KEY.test(key)));
  }
  for (const [, entry] of entries(data.userDirectory)) {
    if (entry?.uid && text(entry.email, 254)) {
      const item = user(entry.uid);
      item.email = item.email || entry.email.toLowerCase();
      item.emailVerified = true; // userDirectory hanya menerima email terverifikasi
    }
  }

  // ── farms & anggota (users/{uid}/access = sumber hak; farmMembers = data tampilan)
  const farms = [];
  const farmIds = new Set();
  for (const [farmId, farm] of entries(t.farms)) {
    if (!FARM_ID.test(farmId) || !text(farm?.name, 100)) { anomaly('farm_tidak_valid', { farmId }); continue; }
    farmIds.add(farmId);
    farms.push({
      id: farmId, name: text(farm.name, 100), location: text(farm.location, 150) || 'Indonesia',
      status: farm.status === 'inactive' ? 'inactive' : 'active', createdAt: msOf(farm.createdAt), updatedAt: msOf(farm.updatedAt), createdBy: null,
    });
  }
  const members = new Map(); // `${farmId}|${uid}`
  for (const [uid, record] of entries(data.users)) {
    for (const [farmId, allowed] of entries(record?.access?.farms)) {
      if (allowed !== true) continue;
      if (!farmIds.has(farmId)) { anomaly('akses_farm_tidak_ada', { uid, farmId }); continue; }
      const role = record.access.farmRoles?.[farmId];
      if (role !== 'owner' && role !== 'operator') { anomaly('akses_tanpa_role', { uid, farmId }); continue; }
      members.set(`${farmId}|${uid}`, { farmId, uid, role, status: 'active', invitedBy: null, createdAt: null });
    }
  }
  for (const [farmId, list] of entries(t.farmMembers)) {
    for (const [uid, member] of entries(list)) {
      const key = `${farmId}|${uid}`;
      const existing = members.get(key);
      if (member?.email) user(uid).email ||= String(member.email).toLowerCase();
      if (existing) {
        existing.invitedBy = member?.invitedBy || null;
        existing.createdAt = msOf(member?.createdAt);
        if (member?.status === 'disabled') existing.status = 'disabled';
      } else if (farmIds.has(farmId) && member?.status === 'active') {
        anomaly('anggota_tanpa_akses', { farmId, uid }); // tidak diberi hak: akses yang berlaku hanya dari users/{uid}/access
      }
    }
  }
  for (const member of members.values()) user(member.uid);
  for (const farm of farms) {
    const owner = [...members.values()].find(member => member.farmId === farm.id && member.role === 'owner' && member.status === 'active');
    farm.createdBy = owner?.uid || null;
    if (!owner) anomaly('farm_tanpa_owner', { farmId: farm.id });
  }

  // ── kumbung, batch, panen
  const kumbungs = new Map();
  for (const [kumbungId, kumbung] of entries(t.kumbungs)) {
    const capacity = Math.round(num(kumbung?.capacityBaglog) ?? 0);
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(kumbungId) || !farmIds.has(kumbung?.farmId) || !text(kumbung?.name, 100)
      || capacity < 1 || capacity > 1_000_000) {
      anomaly('kumbung_tidak_valid', { kumbungId, farmId: kumbung?.farmId });
      continue;
    }
    kumbungs.set(kumbungId, {
      id: kumbungId, farmId: kumbung.farmId, name: text(kumbung.name, 100), capacityBaglog: capacity,
      status: KUMBUNG_STATUSES.includes(kumbung.status) ? kumbung.status : 'active',
      createdBy: kumbung.createdBy || null, createdAt: msOf(kumbung.createdAt), updatedAt: msOf(kumbung.updatedAt), harvestProfile: null,
    });
  }
  const harvestConfig = t.harvest?.config;
  if (harvestConfig && harvestProfileKumbungId && kumbungs.has(harvestProfileKumbungId)) {
    kumbungs.get(harvestProfileKumbungId).harvestProfile = {
      mushroomType: text(harvestConfig.mushroomType, 60) || 'Mushroom',
      fruitingStartDate: harvestConfig.fruitingStartDate || null,
      standardDays: num(harvestConfig.standardDays),
      updatedAt: msOf(harvestConfig.updatedAt),
    };
  } else if (harvestConfig) {
    skipped.push('tumbara/harvest/config (global) — pakai --harvest-profile-kumbung <kumbungId> untuk menyalin ke satu kumbung');
  }

  const batches = new Map();
  for (const [batchId, batch] of entries(t.baglogBatches)) {
    const kumbung = kumbungs.get(batch?.kumbungId);
    const initial = Math.round(num(batch?.baglogCountInitial) ?? 0);
    const active = Math.round(num(batch?.baglogCountActive) ?? -1);
    const contamination = num(batch?.contaminationPct);
    if (!ENTITY_ID.test(batchId) || !kumbung || !msOf(batch.startedAt) || initial < 1 || active < 0 || active > initial
      || !SUBSTRATE_TYPES.includes(batch.substrateType) || !GROWTH_STAGES.includes(batch.growthStage)
      || !BATCH_STATUSES.includes(batch.status) || contamination === null || contamination < 0 || contamination > 100) {
      anomaly('batch_tidak_valid', { batchId, kumbungId: batch?.kumbungId });
      continue;
    }
    if (batch.farmId && batch.farmId !== kumbung.farmId) anomaly('batch_farm_tidak_cocok', { batchId, farmId: batch.farmId, kumbungFarmId: kumbung.farmId });
    batches.set(batchId, {
      id: batchId, farmId: kumbung.farmId, kumbungId: kumbung.id, startedAt: msOf(batch.startedAt),
      baglogCountInitial: initial, baglogCountActive: active, substrateType: batch.substrateType,
      growthStage: batch.growthStage, contaminationPct: contamination, status: batch.status,
      createdBy: batch.createdBy || null, createdAt: msOf(batch.createdAt), updatedAt: msOf(batch.updatedAt),
    });
  }

  const harvestOriginals = [];
  const harvestCorrections = [];
  for (const [kumbungId, events] of entries(t.harvestEvents)) {
    for (const [eventId, event] of entries(events)) {
      const batch = batches.get(event?.batchId);
      const weight = num(event?.weightKg);
      const gradeA = num(event?.gradeAPct);
      if (!ENTITY_ID.test(eventId) || !kumbungs.has(kumbungId) || !batch || batch.kumbungId !== kumbungId || !msOf(event.harvestedAt)
        || weight === null || weight <= 0 || weight > 10000 || !HARVEST_GRADES.includes(event.grade) || gradeA === null || gradeA < 0 || gradeA > 100) {
        anomaly('panen_tidak_valid', { kumbungId, eventId });
        continue;
      }
      const row = {
        id: eventId, farmId: batch.farmId, kumbungId, batchId: batch.id, harvestedAt: msOf(event.harvestedAt),
        weightKg: weight, grade: event.grade, gradeAPct: gradeA, notes: typeof event.notes === 'string' ? event.notes.slice(0, 500) : '',
        recordedBy: event.recordedBy || null, createdAt: msOf(event.createdAt),
        correctsEventId: event.correctsEventId || null, correctionReason: event.correctsEventId ? (text(event.correctionReason, 300) || 'Koreksi (impor)') : null,
      };
      (row.correctsEventId ? harvestCorrections : harvestOriginals).push(row);
    }
  }
  const originalIds = new Set(harvestOriginals.map(row => row.id));
  const harvests = [...harvestOriginals, ...harvestCorrections.filter(row => {
    if (originalIds.has(row.correctsEventId)) return true;
    anomaly('koreksi_tanpa_asal', { eventId: row.id, correctsEventId: row.correctsEventId });
    return false;
  })];

  // ── audit, alert
  const audit = [];
  for (const [farmId, log] of entries(t.assignmentLog)) {
    if (!farmIds.has(farmId)) continue;
    for (const [, entry] of entries(log)) {
      if (!entry?.action || !entry.actorUid) continue;
      const { action, actorUid, createdAt, ...details } = entry;
      audit.push({ farmId, actorUid, action, details, createdAt: msOf(createdAt) });
    }
  }
  const alerts = [];
  for (const [farmId, list] of entries(t.alerts)) {
    if (!farmIds.has(farmId)) continue;
    for (const [alertId, alert] of entries(list)) {
      if (!ALERT_SENSORS.has(alert?.sensor) || !['critical', 'warning', 'normal'].includes(alert.severity)
        || !['active', 'resolved'].includes(alert.status) || !alert.sensorId) {
        anomaly('alert_tidak_valid', { farmId, alertId });
        continue;
      }
      alerts.push({
        id: alertId, farmId, kumbungId: alert.kumbungId || null, sensorId: alert.sensorId, sensor: alert.sensor,
        type: text(alert.type, 100) || alert.sensor, device: text(alert.device, 100) || '-', unit: text(alert.unit, 20) || '',
        severity: alert.severity, status: alert.status, message: text(alert.message, 500) || '',
        value: num(alert.value), threshold: num(alert.threshold), startedAt: msOf(alert.startedAt),
        updatedAt: msOf(alert.updatedAt) || Date.now(), resolvedAt: msOf(alert.resolvedAt), telegramSentAt: msOf(alert.telegramSentAt),
        source: text(alert.source, 40) || 'firebase-import',
      });
    }
  }

  // ── forecast AI
  const aiRequests = [];
  const forecasts = [];
  const forecastLatest = [];
  const features = [];
  for (const [kumbungId, request] of entries(t.aiRequests)) {
    if (kumbungs.has(kumbungId) && isObject(request)) aiRequests.push({ kumbungId, data: request });
  }
  for (const [kumbungId, record] of entries(t.aiForecasts)) {
    if (!kumbungs.has(kumbungId)) continue;
    for (const [forecastId, forecast] of entries(record?.history)) {
      if (isObject(forecast)) forecasts.push({ kumbungId, id: forecastId, generatedAt: msOf(forecast.generatedAt), data: forecast });
    }
    if (isObject(record?.latest)) {
      const match = forecasts.find(item => item.kumbungId === kumbungId && item.generatedAt && item.generatedAt === msOf(record.latest.generatedAt));
      const id = match?.id || 'latest-import';
      if (!match) forecasts.push({ kumbungId, id, generatedAt: msOf(record.latest.generatedAt), data: record.latest });
      forecastLatest.push({ kumbungId, forecastId: id, data: record.latest });
    }
  }
  for (const [kumbungId, days] of entries(t.aiFeaturesDaily)) {
    if (!kumbungs.has(kumbungId)) continue;
    for (const [dateKey, value] of entries(days)) if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && isObject(value)) features.push({ kumbungId, dateKey, data: value });
  }
  const workerStatus = isObject(t.aiWorker?.status) ? t.aiWorker.status : null;

  // ── telemetry lama → gateway virtual "LEGACY-{farmId}" per farm
  const sensors = new Map();
  const buckets = new Map(); // `${sensorId}|${bucket}` → row
  const touchSensor = (sensorId, kumbungId) => {
    if (!sensors.has(sensorId)) {
      const catalog = t.sensors?.[sensorId];
      sensors.set(sensorId, {
        id: sensorId, kumbungCounts: {}, catalogKumbungId: kumbungs.has(catalog?.kumbungId) ? catalog.kumbungId : null,
        name: text(catalog?.name, 100) || sensorId, type: text(catalog?.type, 32) || 'legacy', metrics: new Set(), lastTs: 0, lastValues: null,
      });
    }
    const sensor = sensors.get(sensorId);
    sensor.kumbungCounts[kumbungId] = (sensor.kumbungCounts[kumbungId] || 0) + 1;
    return sensor;
  };
  const readingValues = record => {
    const values = {};
    for (const [metric, [min, max]] of Object.entries(METRIC_LIMITS)) {
      const value = num(record?.[metric]);
      if (value !== null && value >= min && value <= max) values[metric] = value;
    }
    return values;
  };
  const addReading = (kumbungId, sensorId, record) => {
    const ts = msOf(record?.timestamp);
    const values = readingValues(record);
    if (!ts || !Object.keys(values).length || !ENTITY_ID.test(sensorId)) return;
    const sensor = touchSensor(sensorId, kumbungId);
    Object.keys(values).forEach(metric => sensor.metrics.add(metric));
    if (ts > sensor.lastTs) { sensor.lastTs = ts; sensor.lastValues = values; }
    const bucket = ts - (ts % BUCKET_MS);
    const key = `${sensorId}|${bucket}`;
    const current = buckets.get(key);
    if (!current || ts < current.ts) buckets.set(key, { sensorId, bucketStart: bucket, ts, values });
  };
  for (const [kumbungId, days] of entries(t.history)) {
    if (!kumbungs.has(kumbungId)) { anomaly('telemetry_kumbung_tidak_ada', { kumbungId }); continue; }
    for (const [, rows] of entries(days)) for (const [, row] of entries(rows)) addReading(kumbungId, row?.sensorId, row);
  }
  for (const [kumbungId, list] of entries(t.monitoring)) {
    if (kumbungId === 'sensor1') { skipped.push('tumbara/monitoring/sensor1 (sensor legacy tanpa kumbung)'); continue; }
    if (!kumbungs.has(kumbungId)) continue;
    for (const [sensorId, record] of entries(list)) addReading(kumbungId, sensorId, record);
  }
  const legacyGateways = new Map();
  const legacySensors = [];
  for (const sensor of sensors.values()) {
    const ranked = Object.entries(sensor.kumbungCounts).sort((a, b) => b[1] - a[1]);
    const kumbungId = sensor.catalogKumbungId || ranked[0][0];
    if (ranked.length > 1) anomaly('sensor_banyak_kumbung', { sensorId: sensor.id, kumbungs: ranked.map(([id]) => id), dipakai: kumbungId });
    const farmId = kumbungs.get(kumbungId).farmId;
    const owner = farms.find(farm => farm.id === farmId)?.createdBy;
    if (!owner) { anomaly('telemetry_farm_tanpa_owner', { sensorId: sensor.id, farmId }); continue; }
    const gatewayId = legacyGatewayId(farmId);
    legacyGateways.set(gatewayId, { id: gatewayId, farmId, claimedBy: owner });
    legacySensors.push({
      id: sensor.id, gatewayId, localId: sensor.id.slice(0, 64), type: sensor.type, metrics: [...sensor.metrics],
      name: sensor.name, kumbungId, lastValues: sensor.lastValues, lastTs: sensor.lastTs || null,
    });
  }
  const importedSensorIds = new Set(legacySensors.map(sensor => sensor.id));
  const telemetry = [...buckets.values()].filter(row => importedSensorIds.has(row.sensorId)).sort((a, b) => a.ts - b.ts);

  if (t.gateways || t.gatewaySensors || t.gatewayConfigs) {
    skipped.push('tumbara/gateways* (registry gateway RTDB) — gateway MQTT diklaim ulang lewat Devices; telemetry lamanya tetap diimpor');
  }
  if (t.config?.alerts) skipped.push('tumbara/config/alerts (global) — atur ulang ambang & Telegram per farm di Settings (token tidak diimpor)');

  return {
    users: [...users.values()], farms, members: [...members.values()], kumbungs: [...kumbungs.values()],
    batches: [...batches.values()], harvests, audit, alerts, aiRequests, forecasts, forecastLatest, features, workerStatus,
    legacyGateways: [...legacyGateways.values()], legacySensors, telemetry, anomalies, skipped,
  };
}

export function summarize(plan) {
  return Object.fromEntries(Object.entries(plan)
    .filter(([key]) => !['anomalies', 'skipped'].includes(key))
    .map(([key, value]) => [key, Array.isArray(value) ? value.length : value ? 1 : 0]));
}
