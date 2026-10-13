import { get, onValue, ref, set } from 'firebase/database';
import { FIREBASE_PATHS } from './firebasePaths';
import { alertId, buildAlertRecord, hasAlertContext, sortAlerts } from './alerts';

/**
 * Subscribe alert seluruh farm yang dapat diakses user. Mengembalikan fungsi unsubscribe.
 * `onChange` menerima daftar alert (terurut, aktif dulu) dengan field `farmId`.
 */
export function subscribeFarmAlerts(db, uid, onChange, onError = () => {}) {
  const farmListeners = new Map();
  const alertsByFarm = new Map();
  const emit = () => onChange(sortAlerts([...alertsByFarm.values()].flat()));

  const stopAccess = onValue(ref(db, `users/${uid}/access/farms`), snapshot => {
    const farmIds = new Set(Object.keys(snapshot.val() || {}));
    for (const [farmId, unsubscribe] of farmListeners) {
      if (farmIds.has(farmId)) continue;
      unsubscribe();
      farmListeners.delete(farmId);
      alertsByFarm.delete(farmId);
    }
    for (const farmId of farmIds) {
      if (farmListeners.has(farmId)) continue;
      farmListeners.set(farmId, onValue(ref(db, FIREBASE_PATHS.farmAlerts(farmId)), farmSnapshot => {
        alertsByFarm.set(farmId, Object.entries(farmSnapshot.val() || {})
          .map(([id, alert]) => ({ ...alert, id, farmId })));
        emit();
      }, onError));
    }
    if (!farmIds.size) emit();
  }, onError);

  return () => {
    stopAccess();
    for (const unsubscribe of farmListeners.values()) unsubscribe();
    farmListeners.clear();
  };
}

/** Fallback browser: simpan transisi alert untuk sensor dengan konteks farm/kumbung/sensor. */
export async function syncFarmAlert(db, context, alert, now = Date.now()) {
  if (!hasAlertContext(context)) return;
  const alertRef = ref(db, FIREBASE_PATHS.farmAlert(context.farmId, alertId(context.sensorId, alert.key)));
  const previous = (await get(alertRef)).val() || {};
  await set(alertRef, buildAlertRecord({ context, alert, previous, now }));
}
