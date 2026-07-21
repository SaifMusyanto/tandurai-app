export const GROWTH_STAGES = Object.freeze(['inoculation', 'incubation', 'fruiting', 'harvesting', 'completed']);
export const BATCH_STATUSES = Object.freeze(['active', 'completed', 'cancelled']);
export const KUMBUNG_STATUSES = Object.freeze(['active', 'maintenance', 'inactive']);
export const HARVEST_GRADES = Object.freeze(['A', 'B', 'C', 'mixed']);
export const SUBSTRATE_TYPES = Object.freeze(['serbuk-kayu', 'jerami', 'tandan-kosong', 'campuran', 'lainnya']);

const requiredText = (value, label, max = 100) => {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} wajib diisi`);
  if (text.length > max) throw new Error(`${label} maksimal ${max} karakter`);
  return text;
};

const boundedNumber = (value, label, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    throw new Error(`${label} harus antara ${min} dan ${max}`);
  }
  return numeric;
};

export function jakartaInputToTimestamp(value) {
  if (!value) throw new Error('Tanggal/waktu wajib diisi');
  const timestamp = Date.parse(`${value}${value.includes('T') ? ':00' : 'T00:00:00'}+07:00`);
  if (!Number.isFinite(timestamp)) throw new Error('Tanggal/waktu tidak valid');
  return timestamp;
}

export function nextKumbungId(farmId, existingIds = []) {
  const prefix = `${farmId}-K`;
  const next = Math.max(0, ...existingIds
    .filter(id => id.startsWith(prefix))
    .map(id => Number(id.slice(prefix.length)))
    .filter(Number.isFinite)) + 1;
  return `${prefix}${String(next).padStart(2, '0')}`;
}

export function nextBatchId(kumbungId, existingIds = []) {
  const prefix = `${kumbungId}-B`;
  const next = Math.max(0, ...existingIds
    .filter(id => id.startsWith(prefix))
    .map(id => Number(id.slice(prefix.length)))
    .filter(Number.isFinite)) + 1;
  return `${prefix}${String(next).padStart(2, '0')}`;
}

export function buildFarmPayload(input, existing = {}, now = Date.now()) {
  return {
    ...existing,
    name: requiredText(input.name, 'Nama farm'),
    timezone: 'Asia/Jakarta',
    location: requiredText(input.location || 'Indonesia', 'Lokasi', 150),
    status: input.status === 'inactive' ? 'inactive' : 'active',
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

export function buildKumbungPayload(input, actorUid, now = Date.now()) {
  if (!KUMBUNG_STATUSES.includes(input.status)) throw new Error('Status kumbung tidak valid');
  return {
    farmId: requiredText(input.farmId, 'Farm'),
    name: requiredText(input.name, 'Nama kumbung'),
    capacityBaglog: Math.round(boundedNumber(input.capacityBaglog, 'Kapasitas baglog', 1, 1_000_000)),
    status: input.status,
    createdBy: requiredText(actorUid, 'Operator'),
    createdAt: now,
    updatedAt: now,
  };
}

export function buildBatchPayload(input, kumbung, actorUid, now = Date.now()) {
  if (!kumbung || kumbung.farmId !== input.farmId) throw new Error('Batch dan kumbung harus berada pada farm yang sama');
  if (!GROWTH_STAGES.includes(input.growthStage)) throw new Error('Tahap pertumbuhan tidak valid');
  if (!BATCH_STATUSES.includes(input.status)) throw new Error('Status batch tidak valid');
  if (!SUBSTRATE_TYPES.includes(input.substrateType)) throw new Error('Jenis substrat tidak valid');
  const initial = Math.round(boundedNumber(input.baglogCountInitial, 'Jumlah baglog awal', 1, 1_000_000));
  const active = Math.round(boundedNumber(input.baglogCountActive, 'Baglog aktif', 0, initial));
  return {
    farmId: input.farmId,
    kumbungId: input.kumbungId,
    startedAt: jakartaInputToTimestamp(input.startedDate),
    baglogCountInitial: initial,
    baglogCountActive: active,
    substrateType: input.substrateType,
    growthStage: input.growthStage,
    contaminationPct: boundedNumber(input.contaminationPct, 'Kontaminasi', 0, 100),
    status: input.status,
    createdBy: requiredText(actorUid, 'Operator'),
    createdAt: now,
    updatedAt: now,
    schemaVersion: 'baglog-batch-v1',
  };
}

export function buildHarvestPayload(input, batch, actorUid, now = Date.now()) {
  if (!batch || batch.kumbungId !== input.kumbungId || batch.farmId !== input.farmId) {
    throw new Error('Batch tidak terhubung ke kumbung/farm yang dipilih');
  }
  if (!HARVEST_GRADES.includes(input.grade)) throw new Error('Grade panen tidak valid');
  const harvestedAt = jakartaInputToTimestamp(input.harvestedAt);
  if (harvestedAt < batch.startedAt) throw new Error('Waktu panen tidak boleh sebelum batch dimulai');
  if (harvestedAt > now + 5 * 60 * 1000) throw new Error('Waktu panen tidak boleh berada di masa depan');
  return {
    farmId: input.farmId,
    kumbungId: input.kumbungId,
    batchId: input.batchId,
    harvestedAt,
    weightKg: boundedNumber(input.weightKg, 'Berat panen', 0.01, 10_000),
    grade: input.grade,
    gradeAPct: boundedNumber(input.gradeAPct, 'Persentase grade A', 0, 100),
    notes: String(input.notes || '').trim().slice(0, 500),
    recordedBy: requiredText(actorUid, 'Operator'),
    createdAt: now,
    schemaVersion: 'harvest-event-v1',
  };
}
