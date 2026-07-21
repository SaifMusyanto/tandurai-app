import { get, limitToLast, orderByChild, push, query, ref, set, update } from 'firebase/database';
import { FIREBASE_PATHS } from './firebasePaths';
import { resolveHarvestLedger } from './operationsView';

const values = snapshot => Object.entries(snapshot.val() || {}).map(([id, data]) => ({ id, ...data }));

async function readByIds(db, pathBuilder, ids) {
  const snapshots = await Promise.all(ids.map(id => get(ref(db, pathBuilder(id)))));
  return snapshots.map((snapshot, index) => snapshot.exists() ? { id: ids[index], ...snapshot.val() } : null).filter(Boolean);
}

export async function loadOperations(db, uid) {
  const accessSnapshot = await get(ref(db, `users/${uid}/access`));
  const access = accessSnapshot.val() || {};
  const farmIds = Object.keys(access.farms || {});
  const farms = await readByIds(db, FIREBASE_PATHS.farm, farmIds);

  const farmMaps = await Promise.all(farmIds.map(farmId => get(ref(db, FIREBASE_PATHS.farmKumbungs(farmId)))));
  const kumbungIds = [...new Set(farmMaps.flatMap(snapshot => Object.keys(snapshot.val() || {})))];
  const kumbungs = await readByIds(db, FIREBASE_PATHS.kumbung, kumbungIds);

  const batchMaps = await Promise.all(kumbungIds.map(kumbungId => get(ref(db, FIREBASE_PATHS.kumbungBatches(kumbungId)))));
  const batchIds = [...new Set(batchMaps.flatMap(snapshot => Object.keys(snapshot.val() || {})))];
  const batches = await readByIds(db, FIREBASE_PATHS.batch, batchIds);

  const harvestSnapshots = await Promise.all(kumbungIds.map(kumbungId => get(query(
    ref(db, FIREBASE_PATHS.harvestEvents(kumbungId)),
    orderByChild('harvestedAt'),
    limitToLast(100),
  ))));
  const harvestAudit = harvestSnapshots.flatMap(values)
    .sort((a, b) => Number(b.harvestedAt) - Number(a.harvestedAt));
  const harvestEvents = resolveHarvestLedger(harvestAudit);
  return { role: access.role || 'viewer', farms, kumbungs, batches, harvestEvents, harvestAudit };
}

export function saveFarm(db, farmId, payload) {
  return set(ref(db, FIREBASE_PATHS.farm(farmId)), payload);
}

export function createKumbung(db, kumbungId, payload) {
  return update(ref(db), {
    [FIREBASE_PATHS.kumbung(kumbungId)]: payload,
    [FIREBASE_PATHS.farmKumbung(payload.farmId, kumbungId)]: true,
  });
}

export function saveKumbung(db, kumbungId, payload) {
  return set(ref(db, FIREBASE_PATHS.kumbung(kumbungId)), payload);
}

export function createBatch(db, batchId, payload) {
  return update(ref(db), {
    [FIREBASE_PATHS.batch(batchId)]: payload,
    [FIREBASE_PATHS.kumbungBatch(payload.kumbungId, batchId)]: true,
  });
}

export function saveBatch(db, batchId, payload) {
  const databasePayload = { ...payload };
  delete databasePayload.id;
  return set(ref(db, FIREBASE_PATHS.batch(batchId)), databasePayload);
}

export function updateBatchLifecycle(db, batchId, current, changes, now = Date.now()) {
  return set(ref(db, FIREBASE_PATHS.batch(batchId)), { ...current, ...changes, updatedAt: now });
}

export async function createHarvestEvent(db, kumbungId, payload) {
  const eventRef = push(ref(db, FIREBASE_PATHS.harvestEvents(kumbungId)));
  await set(eventRef, payload);
  return eventRef.key;
}
