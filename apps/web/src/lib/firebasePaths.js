const defaultKumbungId = import.meta.env.VITE_DEFAULT_KUMBUNG_ID || 'FARM-01-K01';
const defaultSensorId = import.meta.env.VITE_DEFAULT_SENSOR_ID || 'SNS-0101';

export const FIREBASE_PATHS = Object.freeze({
  defaultKumbungId,
  defaultSensorId,
  legacySensor: import.meta.env.VITE_LEGACY_SENSOR_PATH || 'tumbara/monitoring/sensor1',
  farm: farmId => `tumbara/farms/${farmId}`,
  kumbung: kumbungId => `tumbara/kumbungs/${kumbungId}`,
  farmKumbungs: farmId => `tumbara/farmKumbungs/${farmId}`,
  farmKumbung: (farmId, kumbungId) => `tumbara/farmKumbungs/${farmId}/${kumbungId}`,
  batch: batchId => `tumbara/baglogBatches/${batchId}`,
  kumbungBatches: kumbungId => `tumbara/kumbungBatches/${kumbungId}`,
  kumbungBatch: (kumbungId, batchId) => `tumbara/kumbungBatches/${kumbungId}/${batchId}`,
  sensor: (kumbungId = defaultKumbungId, sensorId = defaultSensorId) =>
    `tumbara/monitoring/${kumbungId}/${sensorId}`,
  historyDay: (kumbungId, date) => `tumbara/history/${kumbungId}/${date}`,
  dailyTelemetry: (kumbungId, date) => `tumbara/dailyTelemetry/${kumbungId}/${date}`,
  harvestEvents: kumbungId => `tumbara/harvestEvents/${kumbungId}`,
  dailyFeature: (kumbungId, date) => `tumbara/aiFeaturesDaily/${kumbungId}/${date}`,
  latestForecast: kumbungId => `tumbara/aiForecasts/${kumbungId}/latest`,
  forecastHistory: kumbungId => `tumbara/aiForecasts/${kumbungId}/history`,
  workerStatus: 'tumbara/aiWorker/status',
  forecastRequest: kumbungId => 'tumbara/aiRequests/' + kumbungId,
});
