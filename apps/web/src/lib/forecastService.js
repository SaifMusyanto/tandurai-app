import { get, limitToLast, orderByChild, query, ref, set } from 'firebase/database';
import { FIREBASE_PATHS } from './firebasePaths';
import { historyValues, isOfficialBatchForecast, normalizeForecast } from './forecast';

const readByIds = async (db, pathBuilder, ids) => {
  const snapshots = await Promise.all(ids.map(id => get(ref(db, pathBuilder(id)))));
  return snapshots.map((snapshot, index) => snapshot.exists() ? { id: ids[index], ...snapshot.val() } : null).filter(Boolean);
};

export async function loadForecastScope(db, uid) {
  const accessSnapshot = await get(ref(db, 'users/' + uid + '/access'));
  const access = accessSnapshot.val() || {};
  const farmIds = Object.entries(access.farms || {}).filter(([, allowed]) => allowed === true).map(([id]) => id);
  const farmMaps = await Promise.all(farmIds.map(farmId => get(ref(db, FIREBASE_PATHS.farmKumbungs(farmId)))));
  const kumbungIds = [...new Set(farmMaps.flatMap(snapshot => Object.keys(snapshot.val() || {})))];
  const kumbungs = await readByIds(db, FIREBASE_PATHS.kumbung, kumbungIds);
  const batchMaps = await Promise.all(kumbungIds.map(kumbungId => get(ref(db, FIREBASE_PATHS.kumbungBatches(kumbungId)))));
  const batchIds = [...new Set(batchMaps.flatMap(snapshot => Object.keys(snapshot.val() || {})))];
  const batches = (await readByIds(db, FIREBASE_PATHS.batch, batchIds))
    .sort((a, b) => Number(b.startedAt) - Number(a.startedAt));
  return { role: access.role || 'viewer', farmIds, kumbungs, batches };
}

export async function loadForecastForKumbung(db, kumbungId) {
  const [latestSnapshot, historySnapshot, requestSnapshot] = await Promise.all([
    get(ref(db, FIREBASE_PATHS.latestForecast(kumbungId))),
    get(query(ref(db, FIREBASE_PATHS.forecastHistory(kumbungId)), orderByChild('generatedAt'), limitToLast(20))),
    get(ref(db, FIREBASE_PATHS.forecastRequest(kumbungId))),
  ]);
  const forecast = latestSnapshot.exists() ? normalizeForecast(latestSnapshot.val()) : null;
  return {
    forecast: isOfficialBatchForecast(forecast) ? forecast : null,
    history: historyValues(historySnapshot.val()).filter(isOfficialBatchForecast),
    request: requestSnapshot.exists() ? requestSnapshot.val() : null,
  };
}

export async function requestForecast(db, kumbungId, batchId, uid, now = Date.now()) {
  const asOfDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now));
  const payload = {
    requestedAt: now,
    requestedBy: uid,
    asOfDate,
    batchId,
    status: 'pending',
    mode: 'hybrid_synthetic_fill',
    schemaVersion: 'ai-request-v1',
  };
  await set(ref(db, FIREBASE_PATHS.forecastRequest(kumbungId)), payload);
  return payload;
}