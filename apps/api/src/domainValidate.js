// Validasi input domain (farm, kumbung, batch, panen, pengaturan). Aturan sama dengan
// apps/web/src/lib/operations.js dan database.rules.json lama, kini ditegakkan di server.
import { HttpError } from './validate.js';

export const GROWTH_STAGES = Object.freeze(['inoculation', 'incubation', 'fruiting', 'harvesting', 'completed']);
export const BATCH_STATUSES = Object.freeze(['active', 'completed', 'cancelled']);
export const KUMBUNG_STATUSES = Object.freeze(['active', 'maintenance', 'inactive']);
export const HARVEST_GRADES = Object.freeze(['A', 'B', 'C', 'mixed']);
export const SUBSTRATE_TYPES = Object.freeze(['serbuk-kayu', 'jerami', 'tandan-kosong', 'campuran', 'lainnya']);
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const bad = (code, message) => new HttpError(400, code, message);

export function requiredText(value, label, max = 100) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw bad('invalid_input', `${label} wajib diisi`);
  if (text.length > max) throw bad('invalid_input', `${label} maksimal ${max} karakter`);
  return text;
}

export function boundedNumber(value, label, min, max) {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < min || numeric > max) {
    throw bad('invalid_input', `${label} harus antara ${min} dan ${max}`);
  }
  return numeric;
}

const oneOf = (value, list, label) => {
  if (!list.includes(value)) throw bad('invalid_input', `${label} tidak valid`);
  return value;
};

/** Timestamp ms (angka) atau string tanggal ISO. */
export function timestampInput(value, label) {
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1) || ms > Date.UTC(2100, 0, 1)) throw bad('invalid_input', `${label} tidak valid`);
  return ms;
}

/** ID kumbung/batch berikutnya: `{prefix}{NN}` (sama dengan nextKumbungId/nextBatchId di web). */
export function nextSequentialId(prefix, existingIds = []) {
  const next = Math.max(0, ...existingIds
    .filter(id => id.startsWith(prefix))
    .map(id => Number(id.slice(prefix.length)))
    .filter(Number.isFinite)) + 1;
  return `${prefix}${String(next).padStart(2, '0')}`;
}

export function farmInput(input, existing = null) {
  return {
    name: input?.name === undefined && existing ? existing.name : requiredText(input?.name, 'Nama farm'),
    location: input?.location === undefined && existing ? existing.location : requiredText(input?.location || 'Indonesia', 'Lokasi', 150),
    status: input?.status === undefined && existing ? existing.status : (input?.status === 'inactive' ? 'inactive' : 'active'),
  };
}

export function kumbungInput(input, existing = null) {
  const pick = (key, fn) => (input?.[key] === undefined && existing ? existing[key] : fn(input?.[key]));
  return {
    name: pick('name', value => requiredText(value, 'Nama kumbung')),
    capacityBaglog: pick('capacityBaglog', value => Math.round(boundedNumber(value, 'Kapasitas baglog', 1, 1_000_000))),
    status: pick('status', value => oneOf(value ?? 'active', KUMBUNG_STATUSES, 'Status kumbung')),
  };
}

/** Batch baru atau perubahan sebagian (`existing` = nilai saat ini dalam bentuk API). */
export function batchInput(input, existing = null) {
  const pick = (key, fn) => (input?.[key] === undefined && existing ? existing[key] : fn(input?.[key]));
  const startedAt = pick('startedAt', value => timestampInput(value, 'Tanggal mulai batch'));
  const baglogCountInitial = pick('baglogCountInitial', value => Math.round(boundedNumber(value, 'Jumlah baglog awal', 1, 1_000_000)));
  const baglogCountActive = pick('baglogCountActive', value => Math.round(boundedNumber(value, 'Baglog aktif', 0, 1_000_000)));
  if (baglogCountActive > baglogCountInitial) throw bad('invalid_input', `Baglog aktif harus antara 0 dan ${baglogCountInitial}`);
  return {
    startedAt,
    baglogCountInitial,
    baglogCountActive,
    substrateType: pick('substrateType', value => oneOf(value, SUBSTRATE_TYPES, 'Jenis substrat')),
    growthStage: pick('growthStage', value => oneOf(value, GROWTH_STAGES, 'Tahap pertumbuhan')),
    contaminationPct: pick('contaminationPct', value => boundedNumber(value, 'Kontaminasi', 0, 100)),
    status: pick('status', value => oneOf(value, BATCH_STATUSES, 'Status batch')),
    mushroomType: pick('mushroomType', value => optionalText(value, 'Jenis jamur', 60) || 'tiram'),
    spawnSource: pick('spawnSource', value => optionalText(value, 'Asal bibit', 100)),
    notes: pick('notes', value => optionalText(value, 'Catatan batch', 300)),
  };
}

const optionalText = (value, label, max) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw bad('invalid_input', `${label} tidak valid`);
  const text = value.trim();
  if (text.length > max) throw bad('invalid_input', `${label} maksimal ${max} karakter`);
  return text;
};

// ───────────────────────────── kegiatan kumbung

/** Pilihan kegiatan harian & jenis masalah (kode disimpan; label ada di frontend & CSV). */
export const CARE_ITEMS = Object.freeze(['misting', 'cleaning', 'ventilation', 'pest_check', 'other']);
export const PROBLEM_ITEMS = Object.freeze(['contamination', 'pest', 'no_growth', 'other']);
export const ACTIVITY_INPUT_TYPES = Object.freeze(['care', 'problem', 'note']);

/**
 * Catatan kegiatan dari petani. `quantity` = baglog dibuang, hanya untuk masalah kontaminasi.
 * Hasil: { type, items, quantity|null, occurredAt, notes, batchId|null }.
 */
export function activityInput(input, now = Date.now()) {
  const type = oneOf(input?.type, ACTIVITY_INPUT_TYPES, 'Jenis catatan');
  const allowed = type === 'care' ? CARE_ITEMS : type === 'problem' ? PROBLEM_ITEMS : [];
  const items = Array.isArray(input?.items) ? [...new Set(input.items)] : [];
  if (items.some(item => !allowed.includes(item))) throw bad('invalid_input', 'Pilihan kegiatan tidak valid');
  if (type !== 'note' && !items.length) throw bad('invalid_input', 'Pilih minimal satu kegiatan');
  const notes = optionalText(input?.notes, 'Catatan', 300);
  if (type === 'note' && !notes) throw bad('invalid_input', 'Catatan wajib diisi');
  let quantity = null;
  if (input?.quantity !== undefined && input?.quantity !== null && input?.quantity !== '' && Number(input.quantity) !== 0) {
    if (type !== 'problem' || !items.includes('contamination')) throw bad('invalid_input', 'Jumlah baglog hanya untuk laporan baglog kontaminasi');
    quantity = Math.round(boundedNumber(input.quantity, 'Jumlah baglog', 1, 1_000_000));
  }
  const occurredAt = input?.occurredAt === undefined || input?.occurredAt === null ? now : timestampInput(input.occurredAt, 'Waktu kegiatan');
  if (occurredAt > now + 5 * 60 * 1000) throw bad('invalid_input', 'Waktu kegiatan tidak boleh berada di masa depan');
  const batchId = input?.batchId ? String(input.batchId) : null;
  return { type, items, quantity, occurredAt, notes, batchId };
}

export const RECAP_KINDS = Object.freeze(['harvest', 'care', 'problem', 'batch']);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Tanggal "YYYY-MM-DD" (WIB) → awal hari dalam ms UTC. */
export const jakartaDayStart = date => Date.parse(`${date}T00:00:00+07:00`);

/**
 * Filter rekap: from/to tanggal WIB (inklusif, maks 366 hari; bawaan 30 hari terakhir), opsional
 * kumbungId, batchId, kinds (daftar dipisah koma), actor. Dengan batchId tanpa tanggal → seluruh batch.
 */
export function recapQuery(query, now = Date.now()) {
  const text = key => (typeof query?.[key] === 'string' && query[key].trim() ? query[key].trim() : null);
  const date = key => {
    const value = text(key);
    if (value === null) return null;
    if (!DATE_ONLY.test(value) || !Number.isFinite(jakartaDayStart(value))) throw bad('invalid_input', `Tanggal ${key} tidak valid`);
    return value;
  };
  const batchId = text('batchId');
  const todayStart = jakartaDayStart(new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10));
  let from = date('from');
  let to = date('to');
  let startMs = from ? jakartaDayStart(from) : (batchId && !to ? null : todayStart - 29 * DAY_MS);
  let endMs = to ? jakartaDayStart(to) + DAY_MS : (batchId && !from ? null : todayStart + DAY_MS);
  if (startMs !== null && endMs !== null) {
    if (startMs >= endMs) throw bad('invalid_input', 'Tanggal awal harus sebelum tanggal akhir');
    if (endMs - startMs > 366 * DAY_MS) throw bad('invalid_input', 'Rentang rekap maksimal 366 hari');
  }
  const kinds = text('kinds') ? [...new Set(text('kinds').split(','))] : [...RECAP_KINDS];
  if (kinds.some(kind => !RECAP_KINDS.includes(kind))) throw bad('invalid_input', 'Jenis kegiatan tidak valid');
  return { startMs, endMs, kumbungId: text('kumbungId'), batchId, kinds, actor: text('actor') };
}

export function harvestInput(input, batch, now = Date.now()) {
  const harvestedAt = timestampInput(input?.harvestedAt, 'Waktu panen');
  if (harvestedAt < batch.startedAt) throw bad('invalid_input', 'Waktu panen tidak boleh sebelum batch dimulai');
  if (harvestedAt > now + 5 * 60 * 1000) throw bad('invalid_input', 'Waktu panen tidak boleh berada di masa depan');
  const correctsEventId = input?.correctsEventId ? String(input.correctsEventId) : null;
  const correctionReason = correctsEventId ? requiredText(input?.correctionReason, 'Alasan koreksi', 300) : null;
  return {
    harvestedAt,
    weightKg: boundedNumber(input?.weightKg, 'Berat panen', 0.01, 10_000),
    grade: oneOf(input?.grade, HARVEST_GRADES, 'Grade panen'),
    gradeAPct: boundedNumber(input?.gradeAPct, 'Persentase grade A', 0, 100),
    notes: typeof input?.notes === 'string' ? input.notes.trim().slice(0, 500) : '',
    correctsEventId,
    correctionReason,
  };
}

export function harvestProfileInput(input) {
  const date = typeof input?.fruitingStartDate === 'string' ? input.fruitingStartDate : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) throw bad('invalid_input', 'Tanggal mulai fruiting tidak valid');
  return {
    mushroomType: (typeof input?.mushroomType === 'string' && input.mushroomType.trim() ? input.mushroomType.trim() : 'Mushroom').slice(0, 60),
    fruitingStartDate: date,
    standardDays: Math.round(boundedNumber(input?.standardDays, 'Durasi SOP', 1, 365)),
  };
}

// Ambang alert bawaan; harus berada di luar rentang optimal bawaan (DEFAULT_OPTIMAL).
export const DEFAULT_THRESHOLDS = Object.freeze({
  temperature: Object.freeze({ warning: 30, critical: 33 }),
  humidity: Object.freeze({ warning: 70, critical: 60 }),
  co2: Object.freeze({ warning: 1500, critical: 2500 }),
});

/**
 * Rentang optimal fase pembentukan tubuh buah jamur tiram putih (Pleurotus ostreatus) di kumbung
 * tropis, dari rentang yang paling konsisten di literatur: suhu 22–28 °C, kelembapan udara
 * 80–90 %, CO₂ ≤ 1000 ppm (di atasnya tangkai memanjang & tudung kecil). Bisa diubah per farm.
 */
export const DEFAULT_OPTIMAL = Object.freeze({
  temperature: Object.freeze({ min: 22, max: 28 }),
  humidity: Object.freeze({ min: 80, max: 90 }),
  co2: Object.freeze({ min: 400, max: 1000 }),
});

const OPTIMAL_BOUNDS = { temperature: [0, 50, 'Suhu'], humidity: [0, 100, 'Kelembapan'], co2: [0, 10000, 'CO₂'] };

/** Rentang optimal farm: min < max per parameter; field yang tidak dikirim memakai nilai sekarang. */
export function optimalInput(input, current = DEFAULT_OPTIMAL) {
  const result = {};
  for (const [metric, [low, high, label]] of Object.entries(OPTIMAL_BOUNDS)) {
    const read = level => {
      const value = input?.[metric]?.[level];
      return value === undefined ? current[metric][level] : boundedNumber(value, `Rentang optimal ${label} ${level}`, low, high);
    };
    result[metric] = { min: read('min'), max: read('max') };
    if (result[metric].min >= result[metric].max) throw bad('invalid_input', `Rentang optimal ${label}: batas bawah harus di bawah batas atas`);
  }
  return result;
}

/** Ambang alert tidak boleh jatuh di dalam rentang optimal (kondisi "optimal" sekaligus "peringatan"). */
export function checkOptimalAgainstThresholds(optimal, thresholds) {
  if (thresholds.temperature.warning < optimal.temperature.max) throw bad('invalid_input', 'Ambang peringatan suhu harus ≥ batas atas suhu optimal');
  if (thresholds.co2.warning < optimal.co2.max) throw bad('invalid_input', 'Ambang peringatan CO₂ harus ≥ batas atas CO₂ optimal');
  if (thresholds.humidity.warning > optimal.humidity.min) throw bad('invalid_input', 'Ambang peringatan kelembapan harus ≤ batas bawah kelembapan optimal');
}

/** Ambang alert farm: suhu & CO₂ "tinggi" (warning < critical), kelembapan "rendah" (critical < warning). */
export function thresholdsInput(input, current = DEFAULT_THRESHOLDS) {
  const read = (metric, level, min, max) => {
    const value = input?.[metric]?.[level];
    return value === undefined ? current[metric][level] : boundedNumber(value, `Ambang ${metric} ${level}`, min, max);
  };
  const thresholds = {
    temperature: { warning: read('temperature', 'warning', -10, 60), critical: read('temperature', 'critical', -10, 60) },
    humidity: { warning: read('humidity', 'warning', 0, 100), critical: read('humidity', 'critical', 0, 100) },
    co2: { warning: read('co2', 'warning', 0, 10000), critical: read('co2', 'critical', 0, 10000) },
  };
  if (thresholds.temperature.warning >= thresholds.temperature.critical) throw bad('invalid_input', 'Ambang suhu peringatan harus di bawah ambang kritis');
  if (thresholds.co2.warning >= thresholds.co2.critical) throw bad('invalid_input', 'Ambang CO₂ peringatan harus di bawah ambang kritis');
  if (thresholds.humidity.critical >= thresholds.humidity.warning) throw bad('invalid_input', 'Ambang kelembapan kritis harus di bawah ambang peringatan');
  return thresholds;
}

const SECRET_KEY = /token|secret|password|credential/i;

/** Preferensi UI user: objek JSON datar ≤ 16 KB, tanpa field rahasia. */
export function settingsInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('invalid_input', 'Pengaturan harus berupa objek');
  const clean = Object.fromEntries(Object.entries(input).filter(([key]) => !SECRET_KEY.test(key)));
  if (JSON.stringify(clean).length > 16384) throw bad('invalid_input', 'Pengaturan terlalu besar');
  return clean;
}
