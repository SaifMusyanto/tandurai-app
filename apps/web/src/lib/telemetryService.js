import {
  get,
  limitToLast,
  onValue,
  orderByChild,
  query,
  ref,
  startAt,
  endAt,
} from 'firebase/database';
import { FIREBASE_PATHS } from './firebasePaths';
import { jakartaDateKeysBetween, normalizeTelemetry } from './telemetry';

const mapHistorySnapshot = snapshot => Object.values(snapshot.val() || {})
  .map(row => normalizeTelemetry(row))
  .filter(row => row.timestamp > 0);

/**
 * Subscribe latest telemetry satu sensor. Tanpa `options` memakai sensor default + fallback
 * legacy `sensor1` (kompatibilitas migrasi). Dengan target eksplisit dari konteks farm, legacy
 * tidak dipakai; `sensorId: null` berarti kumbung belum punya sensor dan `onData(null)` dipanggil.
 */
export function subscribeLatestTelemetry(db, onData, onError, options = {}) {
  const explicit = 'kumbungId' in options || 'sensorId' in options;
  if (explicit && (!options.kumbungId || !options.sensorId)) {
    onData(null, { source: 'none' });
    return () => {};
  }
  const kumbungId = options.kumbungId || FIREBASE_PATHS.defaultKumbungId;
  const sensorId = options.sensorId || FIREBASE_PATHS.defaultSensorId;
  const includeLegacy = options.includeLegacy ?? !explicit;
  let primaryRaw = null;
  let legacyRaw = null;

  const emit = () => {
    const raw = primaryRaw || legacyRaw;
    const source = primaryRaw ? 'telemetry-v1' : legacyRaw ? 'legacy-sensor1' : 'none';
    onData(raw ? normalizeTelemetry(raw) : null, { source });
  };

  const unsubscribePrimary = onValue(
    ref(db, FIREBASE_PATHS.sensor(kumbungId, sensorId)),
    snapshot => {
      primaryRaw = snapshot.exists() ? snapshot.val() : null;
      emit();
    },
    onError,
  );

  const unsubscribeLegacy = includeLegacy ? onValue(
    ref(db, FIREBASE_PATHS.legacySensor),
    snapshot => {
      legacyRaw = snapshot.exists() ? snapshot.val() : null;
      emit();
    },
    onError,
  ) : () => {};

  const staleTimer = setInterval(emit, 30 * 1000);
  return () => {
    clearInterval(staleTimer);
    unsubscribePrimary();
    unsubscribeLegacy();
  };
}

/**
 * Subscribe latest telemetry beberapa sensor dalam satu kumbung. `onData` menerima objek
 * `{ [sensorId]: telemetryTernormalisasi | null }`; status stale dievaluasi ulang tiap 30 detik.
 */
export function subscribeKumbungTelemetry(db, kumbungId, sensorIds, onData, onError) {
  const raw = new Map(sensorIds.map(id => [id, null]));
  const emit = () => onData(Object.fromEntries([...raw.entries()]
    .map(([id, value]) => [id, value ? normalizeTelemetry(value) : null])));
  const unsubscribes = sensorIds.map(sensorId => onValue(
    ref(db, FIREBASE_PATHS.sensor(kumbungId, sensorId)),
    snapshot => {
      raw.set(sensorId, snapshot.exists() ? snapshot.val() : null);
      emit();
    },
    onError,
  ));
  if (!sensorIds.length) emit();
  const staleTimer = setInterval(emit, 30 * 1000);
  return () => {
    clearInterval(staleTimer);
    unsubscribes.forEach(unsubscribe => unsubscribe());
  };
}

/** History kumbung dalam rentang waktu; `sensorId` opsional menyaring satu sensor. */
export async function readTelemetryHistory(db, { kumbungId, sensorId, startAt: rangeStart, endAt: rangeEnd, maxPoints = 1200 }) {
  if (!kumbungId) throw new Error('kumbungId wajib diisi');
  const dayKeys = jakartaDateKeysBetween(rangeStart, rangeEnd);
  const perDayLimit = Math.max(1, Math.ceil(maxPoints / Math.max(dayKeys.length, 1)));

  const snapshots = await Promise.all(dayKeys.map(dateKey => get(query(
    ref(db, FIREBASE_PATHS.historyDay(kumbungId, dateKey)),
    orderByChild('timestamp'),
    startAt(rangeStart),
    endAt(rangeEnd),
    limitToLast(perDayLimit),
  ))));

  const unique = new Map();
  snapshots.flatMap(mapHistorySnapshot)
    .filter(row => !sensorId || row.sensorId === sensorId)
    .forEach(row => {
      unique.set(`${row.sensorId || 'unknown'}_${row.timestamp}`, row);
    });
  return [...unique.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-maxPoints);
}
