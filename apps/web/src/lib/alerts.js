// Alert disimpan per farm: tumbara/alerts/{farmId}/{sensorId}_{jenis}.
// Penulis utama local alert worker (functions/local-alert-worker.js); browser anggota farm
// menulis sebagai fallback. Ambang default harus sama dengan functions/alert-core.js.

export const ALERT_META = Object.freeze({
  temperature_high: { type: 'Suhu Tinggi', device: 'Sensor Suhu Kumbung', unit: '°C' },
  humidity_low: { type: 'Kelembapan Rendah', device: 'Sensor Kelembapan Kumbung', unit: '%' },
  co2_high: { type: 'CO₂ Tinggi', device: 'Sensor CO₂ Kumbung', unit: 'ppm' },
  device_offline: { type: 'Perangkat Offline', device: 'Gateway / Sensor Kumbung', unit: 'detik' },
});

export const alertId = (sensorId, key) => `${sensorId}_${key}`;

const toNumber = value => value === null || value === undefined || value === '' ? Number.NaN : Number(value);

export function evaluateSensor(data) {
  const results = [];
  const temperature = toNumber(data?.temperature);
  const humidity = toNumber(data?.humidity);
  const co2 = toNumber(data?.co2);

  if (Number.isFinite(temperature)) {
    const severity = temperature > 33 ? 'critical' : temperature > 30 ? 'warning' : 'normal';
    results.push({
      key: 'temperature_high', severity, value: temperature,
      threshold: severity === 'critical' ? 33 : 30,
      message: severity === 'normal' ? `Suhu kembali aman pada ${temperature}°C.` : `Suhu ${temperature}°C melewati batas ${severity === 'critical' ? 'kritis' : 'peringatan'}.`,
    });
  }
  if (Number.isFinite(humidity)) {
    const severity = humidity < 60 ? 'critical' : humidity < 70 ? 'warning' : 'normal';
    results.push({
      key: 'humidity_low', severity, value: humidity,
      threshold: severity === 'critical' ? 60 : 70,
      message: severity === 'normal' ? `Kelembapan kembali aman pada ${humidity}%.` : `Kelembapan ${humidity}% berada di bawah batas ${severity === 'critical' ? 'kritis' : 'peringatan'}.`,
    });
  }
  if (Number.isFinite(co2)) {
    const severity = co2 > 1200 ? 'critical' : co2 > 800 ? 'warning' : 'normal';
    results.push({
      key: 'co2_high', severity, value: co2,
      threshold: severity === 'critical' ? 1200 : 800,
      message: severity === 'normal' ? `Kadar CO₂ kembali aman pada ${co2} ppm.` : `Kadar CO₂ ${co2} ppm melewati batas ${severity === 'critical' ? 'kritis' : 'peringatan'}.`,
    });
  }
  return results;
}

/** `context` = { farmId, kumbungId, sensorId } dari payload telemetry-v1. */
export function buildAlertRecord({ context, alert, previous = {}, now = Date.now(), source = 'client-fallback' }) {
  const active = alert.severity !== 'normal';
  const meta = ALERT_META[alert.key];
  if (!meta) throw new Error(`Jenis alert tidak dikenal: ${alert.key}`);
  return {
    id: alertId(context.sensorId, alert.key),
    farmId: context.farmId,
    kumbungId: context.kumbungId,
    sensorId: context.sensorId,
    sensor: alert.key,
    type: meta.type,
    device: meta.device,
    unit: meta.unit,
    severity: alert.severity,
    status: active ? 'active' : 'resolved',
    message: alert.message,
    value: alert.value,
    threshold: alert.threshold,
    startedAt: active && (previous.status !== 'active' || previous.severity !== alert.severity) ? now : (previous.startedAt || null),
    updatedAt: now,
    resolvedAt: !active && previous.status === 'active' ? now : (previous.resolvedAt || null),
    telegramSentAt: previous.telegramSentAt || null,
    source,
  };
}

export const hasAlertContext = context => Boolean(context?.farmId && context?.kumbungId && context?.sensorId);

export function sortAlerts(alerts) {
  return [...alerts].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
  });
}
