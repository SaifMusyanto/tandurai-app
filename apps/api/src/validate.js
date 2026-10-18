// Validasi payload perangkat (MQTT) dan input dashboard (REST). Sengaja eksplisit tanpa library.
import { randomBytes } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const LOCAL_ID = /^[A-Za-z0-9_]{1,16}$/;
export const METRIC_LIMITS = Object.freeze({
  temperature: [-10, 60],
  humidity: [0, 100],
  co2: [0, 10000],
  pressure: [800, 1200],
  airflow: [0, 50],
  substrateMoisture: [0, 100],
  light: [0, 200000],
});
/** Setiap sensor Tandurai membaca tepat tiga parameter ini (tidak kurang, tidak lebih). */
export const SENSOR_METRICS = Object.freeze(['temperature', 'humidity', 'co2']);
export const ACTUATOR_TYPES = new Set(['sprayer', 'fan', 'humidifier', 'pump', 'light', 'heater', 'other']);
const WINDOW = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;

/**
 * Daftar sensor/aktuator dari pesan `register`. Entri tidak valid dibuang (dilaporkan di `rejected`).
 * Sensor cukup `{ "id": "S1" }` (atau string "S1"); parameternya selalu SENSOR_METRICS, `metrics`
 * yang dikirim perangkat diabaikan. `type` sensor opsional (default "env").
 */
export function parseCapabilities(payload) {
  const sensors = [];
  const actuators = [];
  const rejected = [];
  const seen = new Set();
  for (const raw of Array.isArray(payload?.sensors) ? payload.sensors.slice(0, 32) : []) {
    const item = typeof raw === 'string' ? { id: raw } : raw;
    if (!LOCAL_ID.test(item?.id || '') || seen.has(item.id)) {
      rejected.push(item?.id ?? null);
      continue;
    }
    seen.add(item.id);
    sensors.push({ id: item.id, type: text(item.type, 32) ? item.type.trim() : 'env', metrics: [...SENSOR_METRICS] });
  }
  for (const item of Array.isArray(payload?.actuators) ? payload.actuators.slice(0, 16) : []) {
    const maxRunSec = Number(item?.maxRunSec);
    const minIntervalSec = Number(item?.minIntervalSec ?? 0);
    if (!LOCAL_ID.test(item?.id || '') || seen.has(item.id) || !ACTUATOR_TYPES.has(item.type)
      || !isInt(maxRunSec, 1, 86400) || !isInt(minIntervalSec, 0, 86400)) {
      rejected.push(item?.id ?? null);
      continue;
    }
    seen.add(item.id);
    actuators.push({ id: item.id, type: item.type, maxRunSec, minIntervalSec });
  }
  return { sensors, actuators, rejected };
}

/** Nilai sensor yang dikenal dan dalam rentang; lainnya dibuang. */
export function cleanReadings(values, allowedMetrics) {
  const clean = {};
  for (const metric of allowedMetrics) {
    const value = Number(values?.[metric]);
    const [min, max] = METRIC_LIMITS[metric] || [];
    if (values?.[metric] !== null && values?.[metric] !== undefined && Number.isFinite(value) && value >= min && value <= max) {
      clean[metric] = value;
    }
  }
  return clean;
}

/** Timestamp perangkat (ms) dipakai bila wajar; selain itu waktu server. */
export function deviceTime(ts, now = Date.now()) {
  const value = Number(ts);
  return Number.isFinite(value) && value > now - 7 * 86400000 && value <= now + 300000 ? value : now;
}

const SCHEDULE_ID = /^[A-Za-z0-9_-]{1,16}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_SCHEDULES = 12;
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/** Satu jadwal: `at` (jam tertentu) atau `every` (berulang dalam rentang jam), hari ISO 1=Senin…7=Minggu. */
function validateSchedule(item, index, maxRun) {
  const label = `Jadwal ${index + 1}`;
  const bad = message => new HttpError(400, 'invalid_schedule', `${label}: ${message}`);
  if (!item || typeof item !== 'object') throw bad('format tidak valid.');
  const id = SCHEDULE_ID.test(item.id || '') ? item.id : randomBytes(4).toString('hex');
  const days = item.days === undefined ? ALL_DAYS : item.days;
  if (!Array.isArray(days) || !days.length || days.some(day => !isInt(day, 1, 7)) || new Set(days).size !== days.length) {
    throw bad('pilih minimal satu hari.');
  }
  const base = { id, type: item.type, enabled: item.enabled !== false, days: [...days].sort((a, b) => a - b) };
  if (item.type === 'at') {
    if (!TIME.test(item.at || '')) throw bad('jam harus HH:MM.');
    if (!isInt(item.onSec, 1, maxRun)) throw bad(`lama nyala 1–${maxRun} detik.`);
    return { ...base, at: item.at, onSec: item.onSec };
  }
  if (item.type === 'every') {
    if (!isInt(item.intervalSec, 60, 86400)) throw bad('interval 1 menit – 24 jam.');
    if (!isInt(item.onSec, 1, Math.min(maxRun, item.intervalSec - 1))) {
      throw bad(`lama nyala 1–${Math.min(maxRun, item.intervalSec - 1)} detik (≤ batas aktuator dan < interval).`);
    }
    const window = item.window === undefined || item.window === null || item.window === '' ? null : item.window;
    if (window !== null && !WINDOW.test(window)) throw bad('rentang jam harus HH:MM-HH:MM.');
    return { ...base, intervalSec: item.intervalSec, onSec: item.onSec, window };
  }
  throw bad('jenis harus "at" (jam tertentu) atau "every" (berulang).');
}

export const MAX_RULES = 8;

/**
 * Satu aturan otomatis: nyala saat `metric` sensor `below`/`above` `threshold`; mati setelah
 * `stop.onSec` (durasi) atau saat nilai kembali ke `stop.value` (normal). `cooldownSec` = jeda
 * sebelum aturan boleh menyala lagi.
 */
function validateRule(item, index, maxRun, sensors) {
  const bad = message => new HttpError(400, 'invalid_rule', `Aturan ${index + 1}: ${message}`);
  if (!item || typeof item !== 'object') throw bad('format tidak valid.');
  const id = SCHEDULE_ID.test(item.id || '') ? item.id : randomBytes(4).toString('hex');
  const sensor = sensors.find(entry => entry.id === item.sensorId);
  if (!sensor) throw bad('sensor acuan harus berada di gateway yang sama.');
  if (!sensor.metrics.includes(item.metric)) throw bad(`sensor tidak mengukur ${item.metric}.`);
  if (!['below', 'above'].includes(item.operator)) throw bad('kondisi harus "di bawah" atau "di atas".');
  const [min, max] = METRIC_LIMITS[item.metric];
  const inRange = value => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  if (!inRange(item.threshold)) throw bad(`angka pemicu harus ${min}–${max}.`);
  let stop;
  if (item.stop?.type === 'duration') {
    if (!isInt(item.stop.onSec, 1, maxRun)) throw bad(`lama nyala 1–${maxRun} detik.`);
    stop = { type: 'duration', onSec: item.stop.onSec };
  } else if (item.stop?.type === 'value') {
    if (!inRange(item.stop.value)) throw bad(`nilai normal harus ${min}–${max}.`);
    if (item.operator === 'below' ? item.stop.value <= item.threshold : item.stop.value >= item.threshold) {
      throw bad(item.operator === 'below' ? 'nilai normal harus lebih besar dari angka pemicu.' : 'nilai normal harus lebih kecil dari angka pemicu.');
    }
    stop = { type: 'value', value: item.stop.value };
  } else {
    throw bad('kondisi mati harus durasi atau nilai normal.');
  }
  const cooldownSec = item.cooldownSec === undefined ? 60 : item.cooldownSec;
  if (!isInt(cooldownSec, 0, 86400)) throw bad('jeda 0–86400 detik.');
  return {
    id, enabled: item.enabled !== false, sensorId: sensor.id, sensorLocalId: sensor.localId, metric: item.metric,
    operator: item.operator, threshold: item.threshold, stop, cooldownSec,
  };
}

/**
 * Validasi config aktuator dari dashboard. `sensors` = sensor di gateway yang sama
 * ([{ id, localId, metrics }]). Mengembalikan { mode, schedules, rules } yang dinormalisasi.
 * Field yang tidak dikirim mempertahankan nilai tersimpan (pindah mode tidak menghapus jadwal/aturan).
 */
export function validateActuatorConfig(input, actuator, sensors) {
  const mode = input?.mode;
  if (!['manual', 'timer', 'auto'].includes(mode)) throw new HttpError(400, 'invalid_mode', 'Mode harus manual, timer, atau auto.');
  const maxRun = actuator.max_run_sec;
  let schedules = Array.isArray(actuator.schedules) ? actuator.schedules : [];
  let rules = Array.isArray(actuator.rules) ? actuator.rules : [];

  if (input.schedules !== undefined) {
    if (!Array.isArray(input.schedules) || input.schedules.length > MAX_SCHEDULES) {
      throw new HttpError(400, 'invalid_schedule', `Maksimal ${MAX_SCHEDULES} jadwal per aktuator.`);
    }
    schedules = input.schedules.map((item, index) => validateSchedule(item, index, maxRun));
    if (new Set(schedules.map(item => item.id)).size !== schedules.length) throw new HttpError(400, 'invalid_schedule', 'ID jadwal ganda.');
  }

  if (input.rules !== undefined) {
    if (!Array.isArray(input.rules) || input.rules.length > MAX_RULES) {
      throw new HttpError(400, 'invalid_rule', `Maksimal ${MAX_RULES} aturan per aktuator.`);
    }
    rules = input.rules.map((item, index) => validateRule(item, index, maxRun, sensors));
    if (new Set(rules.map(item => item.id)).size !== rules.length) throw new HttpError(400, 'invalid_rule', 'ID aturan ganda.');
  }

  if (mode === 'timer' && !schedules.some(item => item.enabled)) throw new HttpError(400, 'invalid_schedule', 'Mode jadwal membutuhkan minimal satu jadwal aktif.');
  if (mode === 'auto' && !rules.some(item => item.enabled)) throw new HttpError(400, 'invalid_rule', 'Mode otomatis membutuhkan minimal satu aturan aktif.');
  return { mode, schedules, rules };
}
