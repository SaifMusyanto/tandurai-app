// import.meta.env hanya tersedia di Vite; test Node mengimpor modul ini tanpa env.
const env = import.meta.env ?? {};
const defaultKumbungId = env.VITE_DEFAULT_KUMBUNG_ID || 'FARM-01-K01';
const defaultSensorId = env.VITE_DEFAULT_SENSOR_ID || 'SNS-0101';

export const FIREBASE_PATHS = Object.freeze({
  defaultKumbungId,
  defaultSensorId,
  legacySensor: env.VITE_LEGACY_SENSOR_PATH || 'tumbara/monitoring/sensor1',
  farm: farmId => `tumbara/farms/${farmId}`,
  farmMembers: farmId => `tumbara/farmMembers/${farmId}`,
  farmMember: (farmId, uid) => `tumbara/farmMembers/${farmId}/${uid}`,
  farmAccess: (uid, farmId) => `users/${uid}/access/farms/${farmId}`,
  farmRole: (uid, farmId) => `users/${uid}/access/farmRoles/${farmId}`,
  userDirectoryEntry: emailKey => `userDirectory/${emailKey}`,
  gateways: 'tumbara/gateways',
  gateway: gatewayId => `tumbara/gateways/${gatewayId}`,
  gatewayAuthUid: authUid => `tumbara/gatewayAuthUids/${authUid}`,
  gatewayConfig: gatewayId => `tumbara/gatewayConfigs/${gatewayId}`,
  gatewaySensors: gatewayId => `tumbara/gatewaySensors/${gatewayId}`,
  sensorCatalog: 'tumbara/sensors',
  sensorRecord: sensorId => `tumbara/sensors/${sensorId}`,
  kumbungSensors: kumbungId => `tumbara/kumbungSensors/${kumbungId}`,
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
