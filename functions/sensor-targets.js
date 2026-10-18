"use strict";

/**
 * Sensor yang dipantau worker alert untuk satu farm: semua sensor katalog `active` di farm itu.
 * Bila farm belum punya sensor aktif di katalog, pakai sensor default lama (fallback migrasi).
 */
function selectMonitoredSensors(catalog, farmId, fallback) {
  const targets = Object.entries(catalog || {})
    .filter(([, sensor]) => sensor && sensor.farmId === farmId && sensor.status === "active" && sensor.kumbungId)
    .map(([sensorId, sensor]) => ({ sensorId, kumbungId: sensor.kumbungId }))
    .sort((a, b) => a.sensorId.localeCompare(b.sensorId));
  if (targets.length || !fallback?.sensorId || !fallback?.kumbungId) return targets;
  return [{ sensorId: fallback.sensorId, kumbungId: fallback.kumbungId, legacy: true }];
}

module.exports = { selectMonitoredSensors };
