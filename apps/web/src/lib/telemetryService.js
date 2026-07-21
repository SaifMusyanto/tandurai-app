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

export function subscribeLatestTelemetry(db, onData, onError, options = {}) {
  const kumbungId = options.kumbungId || FIREBASE_PATHS.defaultKumbungId;
  const sensorId = options.sensorId || FIREBASE_PATHS.defaultSensorId;
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

  const unsubscribeLegacy = onValue(
    ref(db, FIREBASE_PATHS.legacySensor),
    snapshot => {
      legacyRaw = snapshot.exists() ? snapshot.val() : null;
      emit();
    },
    onError,
  );

  const staleTimer = setInterval(emit, 30 * 1000);
  return () => {
    clearInterval(staleTimer);
    unsubscribePrimary();
    unsubscribeLegacy();
  };
}

export async function readTelemetryHistory(db, { kumbungId, startAt: rangeStart, endAt: rangeEnd, maxPoints = 1200 }) {
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
  snapshots.flatMap(mapHistorySnapshot).forEach(row => {
    unique.set(`${row.sensorId || 'unknown'}_${row.timestamp}`, row);
  });
  return [...unique.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-maxPoints);
}
