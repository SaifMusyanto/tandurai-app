"use strict";

const DEFAULT_THRESHOLDS = Object.freeze({
  temperature: Object.freeze({ warning: 30, critical: 33 }),
  humidity: Object.freeze({ warning: 70, critical: 60 }),
  co2: Object.freeze({ warning: 800, critical: 1200 }),
});

const ALERT_DEFINITIONS = Object.freeze({
  temperature_high: Object.freeze({ type: "Suhu Tinggi", device: "Sensor Suhu Kumbung", unit: "°C" }),
  humidity_low: Object.freeze({ type: "Kelembapan Rendah", device: "Sensor Kelembapan Kumbung", unit: "%" }),
  co2_high: Object.freeze({ type: "CO₂ Tinggi", device: "Sensor CO₂ Kumbung", unit: "ppm" }),
  device_offline: Object.freeze({ type: "Perangkat Offline", device: "ESP32 Sensor Kumbung", unit: "detik" }),
});

function toNumber(value) {
  return value === null || value === undefined || value === "" ? Number.NaN : Number(value);
}

function evaluateSensor(data, thresholds = DEFAULT_THRESHOLDS) {
  const results = [];
  const temperature = toNumber(data?.temperature);
  const humidity = toNumber(data?.humidity);
  const co2 = toNumber(data?.co2);

  if (Number.isFinite(temperature)) {
    const severity = temperature > thresholds.temperature.critical
      ? "critical"
      : temperature > thresholds.temperature.warning ? "warning" : "normal";
    results.push({
      key: "temperature_high",
      severity,
      value: temperature,
      threshold: severity === "critical" ? thresholds.temperature.critical : thresholds.temperature.warning,
      message: severity === "normal"
        ? `Suhu kembali aman pada ${temperature}°C.`
        : `Suhu ${temperature}°C melewati batas ${severity === "critical" ? "kritis" : "peringatan"}.`,
    });
  }

  if (Number.isFinite(humidity)) {
    const severity = humidity < thresholds.humidity.critical
      ? "critical"
      : humidity < thresholds.humidity.warning ? "warning" : "normal";
    results.push({
      key: "humidity_low",
      severity,
      value: humidity,
      threshold: severity === "critical" ? thresholds.humidity.critical : thresholds.humidity.warning,
      message: severity === "normal"
        ? `Kelembapan kembali aman pada ${humidity}%.`
        : `Kelembapan ${humidity}% berada di bawah batas ${severity === "critical" ? "kritis" : "peringatan"}.`,
    });
  }

  if (Number.isFinite(co2)) {
    const severity = co2 > thresholds.co2.critical
      ? "critical"
      : co2 > thresholds.co2.warning ? "warning" : "normal";
    results.push({
      key: "co2_high",
      severity,
      value: co2,
      threshold: severity === "critical" ? thresholds.co2.critical : thresholds.co2.warning,
      message: severity === "normal"
        ? `Kadar CO₂ kembali aman pada ${co2} ppm.`
        : `Kadar CO₂ ${co2} ppm melewati batas ${severity === "critical" ? "kritis" : "peringatan"}.`,
    });
  }

  return results;
}

function createAlertTransition(result, previous = {}, now = Date.now(), lastSentAt = 0, cooldownMs = 600000) {
  const definition = ALERT_DEFINITIONS[result.key];
  if (!definition) throw new Error(`Definisi alert tidak ditemukan: ${result.key}`);

  const isActive = result.severity !== "normal";
  const wasActive = previous.status === "active";
  const severityChanged = previous.severity !== result.severity;
  const cooldownKey = `${result.key}_${result.severity}`;
  const shouldNotify = isActive && now - Number(lastSentAt || 0) >= cooldownMs;

  return {
    cooldownKey,
    shouldNotify,
    record: {
      id: result.key,
      sensor: result.key,
      type: definition.type,
      device: definition.device,
      unit: definition.unit,
      severity: result.severity,
      status: isActive ? "active" : "resolved",
      message: result.message,
      value: result.value,
      threshold: result.threshold,
      startedAt: isActive && (!wasActive || severityChanged) ? now : (previous.startedAt || null),
      updatedAt: now,
      resolvedAt: !isActive && wasActive ? now : (previous.resolvedAt || null),
      telegramSentAt: previous.telegramSentAt || null,
    },
  };
}

function telegramMessage(alert, now = Date.now(), location = "Tandurai Smart Farm — Sidoarjo") {
  const definition = ALERT_DEFINITIONS[alert.key];
  if (!definition) throw new Error(`Definisi alert tidak ditemukan: ${alert.key}`);
  const emoji = alert.severity === "critical" ? "🔴" : "🟡";
  const time = new Date(now).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${emoji} <b>[${alert.severity.toUpperCase()}] ${definition.type}</b>\n\n${alert.message}\n📍 ${location}\n🕐 ${time}`;
}

module.exports = {
  ALERT_DEFINITIONS,
  DEFAULT_THRESHOLDS,
  createAlertTransition,
  evaluateSensor,
  telegramMessage,
};
