import { api } from './api';
import { resolveHarvestLedger } from './operationsView';

// Data operasional lewat backend. Payload dari builder di operations.js dikirim apa adanya;
// backend memvalidasi ulang dan mengisi createdBy/createdAt/ID sendiri.

/** Farm, kumbung, batch, dan ledger panen semua farm user; `roles` = role per farm. */
export async function loadOperations() {
  const result = await api.operations();
  return { ...result, harvestEvents: resolveHarvestLedger(result.harvestAudit) };
}

export function saveFarm(farmId, payload) {
  return api.updateFarm(farmId, { name: payload.name, location: payload.location, status: payload.status });
}

/** Buat kumbung; ID (`{farmId}-Knn`) ditentukan backend. Mengembalikan kumbung baru. */
export function createKumbung(farmId, payload) {
  return api.createKumbung(farmId, payload);
}

export function saveKumbung(kumbungId, payload) {
  return api.updateKumbung(kumbungId, { name: payload.name, capacityBaglog: payload.capacityBaglog, status: payload.status });
}

/** Mulai batch; ID (`{kumbungId}-Bnn`) ditentukan backend. */
export function createBatch(kumbungId, payload) {
  return api.createBatch(kumbungId, payload);
}

const BATCH_FIELDS = ['startedAt', 'baglogCountInitial', 'baglogCountActive', 'substrateType', 'growthStage', 'contaminationPct', 'status', 'mushroomType', 'spawnSource', 'notes', 'closeNote'];

export function saveBatch(batchId, payload) {
  return api.updateBatch(batchId, Object.fromEntries(BATCH_FIELDS.filter(key => payload[key] !== undefined).map(key => [key, payload[key]])));
}

/** Catat panen (append-only); koreksi = payload dengan `correctsEventId` + `correctionReason`. */
export async function createHarvestEvent(kumbungId, payload) {
  return (await api.createHarvest(kumbungId, payload)).id;
}
