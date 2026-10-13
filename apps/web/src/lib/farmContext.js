import { FIREBASE_PATHS } from './firebasePaths.js';

/**
 * Pemilihan konteks dashboard (farm → kumbung → sensor) dari data akses user dan katalog.
 * Pilihan tersimpan dipakai bila masih valid; jika tidak, jatuh ke opsi pertama yang tersedia.
 * Sensor default lama (`VITE_DEFAULT_*`) hanya dipakai sebagai fallback migrasi untuk kumbung
 * default yang belum punya sensor di katalog (`legacy: true`).
 */
export function resolveSelection({ farms = [], kumbungs = [], sensors = [], stored = {} }) {
  const farmId = farms.some(farm => farm.id === stored.farmId) ? stored.farmId : farms[0]?.id || null;
  const kumbungId = kumbungs.some(kumbung => kumbung.id === stored.kumbungId)
    ? stored.kumbungId
    : kumbungs[0]?.id || null;

  const inKumbung = sensors.filter(sensor => sensor.kumbungId === kumbungId);
  const usable = inKumbung.filter(sensor => sensor.status !== 'inactive');
  const storedSensor = usable.find(sensor => sensor.id === stored.sensorId);
  const preferred = storedSensor
    || usable.find(sensor => sensor.status === 'active')
    || usable[0]
    || null;

  if (preferred) return { farmId, kumbungId, sensorId: preferred.id, legacy: false };
  if (kumbungId && !inKumbung.length && kumbungId === FIREBASE_PATHS.defaultKumbungId) {
    return { farmId, kumbungId, sensorId: FIREBASE_PATHS.defaultSensorId, legacy: true };
  }
  return { farmId, kumbungId, sensorId: null, legacy: false };
}

export const contextStorageKey = uid => `tandurai-context:${uid}`;

export function readStoredSelection(uid, storage = globalThis.localStorage) {
  try {
    return JSON.parse(storage?.getItem(contextStorageKey(uid)) || '{}') || {};
  } catch {
    return {};
  }
}

export function writeStoredSelection(uid, selection, storage = globalThis.localStorage) {
  try {
    storage?.setItem(contextStorageKey(uid), JSON.stringify({
      farmId: selection.farmId || null,
      kumbungId: selection.kumbungId || null,
      sensorId: selection.sensorId || null,
    }));
  } catch {
    // Penyimpanan lokal opsional (mode privat/kuota penuh).
  }
}
