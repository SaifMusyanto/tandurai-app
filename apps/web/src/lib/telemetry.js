export const TELEMETRY_SCHEMA_VERSION = 'telemetry-v1';
export const TELEMETRY_HISTORY_INTERVAL_MS = 10 * 60 * 1000;
export const TELEMETRY_STALE_AFTER_MS = 15 * 60 * 1000;

export const SENSOR_LIMITS = Object.freeze({
  temperature: { min: -10, max: 60 },
  humidity: { min: 0, max: 100 },
  co2: { min: 0, max: 10000 },
  pressure: { min: 800, max: 1200 },
  airflow: { min: 0, max: 50 },
  substrateMoisture: { min: 0, max: 100 },
  light: { min: 0, max: 200000 },
});

export const normalizeTimestamp = value => {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  return timestamp < 100000000000 ? timestamp * 1000 : timestamp;
};

const numericOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export function assessTelemetry(raw = {}, now = Date.now()) {
  const timestamp = normalizeTimestamp(raw.timestamp);
  const missingSensors = [];
  const invalidSensors = [];
  const values = {};

  for (const [key, limits] of Object.entries(SENSOR_LIMITS)) {
    const value = numericOrNull(raw[key]);
    values[key] = value;
    if (value === null) missingSensors.push(key);
    else if (value < limits.min || value > limits.max) invalidSensors.push(key);
  }

  const stale = !timestamp || now - timestamp > TELEMETRY_STALE_AFTER_MS;
  const status = invalidSensors.length
    ? 'invalid'
    : stale || missingSensors.length
      ? 'degraded'
      : 'valid';

  return { timestamp, values, status, stale, missingSensors, invalidSensors };
}

export function normalizeTelemetry(raw = {}, now = Date.now()) {
  const assessment = assessTelemetry(raw, now);
  return {
    ...raw,
    ...assessment.values,
    timestamp: assessment.timestamp,
    farmId: raw.farmId || null,
    kumbungId: raw.kumbungId || null,
    sensorId: raw.sensorId || null,
    schemaVersion: raw.schemaVersion || null,
    quality: {
      status: assessment.status,
      stale: assessment.stale,
      missingSensors: assessment.missingSensors,
      invalidSensors: assessment.invalidSensors,
    },
  };
}

export function historyBucketStart(timestamp, intervalMs = TELEMETRY_HISTORY_INTERVAL_MS) {
  const normalized = normalizeTimestamp(timestamp);
  return normalized ? Math.floor(normalized / intervalMs) * intervalMs : 0;
}

export function historyEntryId(sensorId, timestamp, intervalMs = TELEMETRY_HISTORY_INTERVAL_MS) {
  const bucket = historyBucketStart(timestamp, intervalMs);
  if (!sensorId || !bucket) throw new Error('sensorId dan timestamp valid wajib diisi');
  return `${sensorId}_${bucket}`;
}

export function jakartaDateKey(timestamp) {
  const normalized = normalizeTimestamp(timestamp);
  if (!normalized) throw new Error('timestamp valid wajib diisi');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(normalized));
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function jakartaDateKeysBetween(startAt, endAt) {
  const start = normalizeTimestamp(startAt);
  const end = normalizeTimestamp(endAt);
  if (!start || !end || start > end) return [];

  const keys = new Set();
  for (let cursor = start; cursor <= end + 24 * 60 * 60 * 1000; cursor += 24 * 60 * 60 * 1000) {
    keys.add(jakartaDateKey(Math.min(cursor, end)));
    if (cursor >= end) break;
  }
  return [...keys].sort();
}

export function buildTelemetryPayload({ farmId, kumbungId, sensorId, timestamp = Date.now(), ...raw }) {
  const normalizedTimestamp = normalizeTimestamp(timestamp);
  if (!farmId || !kumbungId || !sensorId || !normalizedTimestamp) {
    throw new Error('farmId, kumbungId, sensorId, dan timestamp valid wajib diisi');
  }

  const assessment = assessTelemetry({ ...raw, timestamp: normalizedTimestamp }, normalizedTimestamp);
  const payload = {
    timestamp: normalizedTimestamp,
    farmId,
    kumbungId,
    sensorId,
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    fanStatus: Boolean(raw.fanStatus),
    fanSpeedPct: Math.min(100, Math.max(0, numericOrNull(raw.fanSpeedPct) ?? 0)),
    mistingStatus: Boolean(raw.mistingStatus),
    quality: {
      status: assessment.invalidSensors.length ? 'invalid' : assessment.missingSensors.length ? 'degraded' : 'valid',
      invalidSensors: assessment.invalidSensors,
      missingSensors: assessment.missingSensors,
    },
  };

  for (const [key, value] of Object.entries(assessment.values)) {
    if (value !== null) payload[key] = value;
  }
  return payload;
}
