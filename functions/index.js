const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const SENSOR_REF = "tumbara/monitoring/sensor1";
const ALERTS_REF = "tumbara/alerts";
const HISTORY_REF = "tumbara/history";
const COOLDOWN_REF = "tumbara/notif_cooldown";
const SYSTEM_REF = "tumbara/system/sensor1";

const COOLDOWN_MS = 10 * 60 * 1000;
const OFFLINE_AFTER_MS = 30 * 1000;
const HISTORY_INTERVAL_MS = 60 * 1000;

const THRESHOLDS = {
  temperature: { warning: 30, critical: 33 },
  humidity: { warning: 70, critical: 60 },
  co2: { warning: 800, critical: 1200 },
};

const ALERT_DEFINITIONS = {
  temperature_high: { type: "Suhu Tinggi", device: "Sensor Suhu Kumbung", unit: "°C" },
  humidity_low: { type: "Kelembapan Rendah", device: "Sensor Kelembapan Kumbung", unit: "%" },
  co2_high: { type: "CO₂ Tinggi", device: "Sensor CO₂ Kumbung", unit: "ppm" },
  device_offline: { type: "Perangkat Offline", device: "ESP32 Sensor Kumbung", unit: "detik" },
};

function evaluateSensor(data) {
  const results = [];
  const toNumber = value => value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  const temperature = toNumber(data.temperature);
  const humidity = toNumber(data.humidity);
  const co2 = toNumber(data.co2);

  if (Number.isFinite(temperature)) {
    const severity = temperature > THRESHOLDS.temperature.critical
      ? "critical"
      : temperature > THRESHOLDS.temperature.warning ? "warning" : "normal";
    results.push({
      key: "temperature_high",
      severity,
      value: temperature,
      threshold: severity === "critical" ? THRESHOLDS.temperature.critical : THRESHOLDS.temperature.warning,
      message: severity === "normal"
        ? `Suhu kembali aman pada ${temperature}°C.`
        : `Suhu ${temperature}°C melewati batas ${severity === "critical" ? "kritis" : "peringatan"}.`,
    });
  }

  if (Number.isFinite(humidity)) {
    const severity = humidity < THRESHOLDS.humidity.critical
      ? "critical"
      : humidity < THRESHOLDS.humidity.warning ? "warning" : "normal";
    results.push({
      key: "humidity_low",
      severity,
      value: humidity,
      threshold: severity === "critical" ? THRESHOLDS.humidity.critical : THRESHOLDS.humidity.warning,
      message: severity === "normal"
        ? `Kelembapan kembali aman pada ${humidity}%.`
        : `Kelembapan ${humidity}% berada di bawah batas ${severity === "critical" ? "kritis" : "peringatan"}.`,
    });
  }

  if (Number.isFinite(co2)) {
    const severity = co2 > THRESHOLDS.co2.critical
      ? "critical"
      : co2 > THRESHOLDS.co2.warning ? "warning" : "normal";
    results.push({
      key: "co2_high",
      severity,
      value: co2,
      threshold: severity === "critical" ? THRESHOLDS.co2.critical : THRESHOLDS.co2.warning,
      message: severity === "normal"
        ? `Kadar CO₂ kembali aman pada ${co2} ppm.`
        : `Kadar CO₂ ${co2} ppm melewati batas ${severity === "critical" ? "kritis" : "peringatan"}.`,
    });
  }

  return results;
}

async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("Telegram dilewati: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID belum diatur.");
    return false;
  }

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML" }),
  });
  if (!response.ok) throw new Error(`Telegram API ${response.status}: ${await response.text()}`);
  return true;
}

function telegramMessage(alert, now) {
  const definition = ALERT_DEFINITIONS[alert.key];
  const emoji = alert.severity === "critical" ? "🔴" : "🟡";
  const time = new Date(now).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  return `${emoji} <b>[${alert.severity.toUpperCase()}] ${definition.type}</b>\n\n${alert.message}\n📍 Tandurai Smart Farm — Sidoarjo\n🕐 ${time}`;
}

async function updateAlertStates(results, now) {
  const database = admin.database();
  const [alertsSnapshot, cooldownSnapshot] = await Promise.all([
    database.ref(ALERTS_REF).once("value"),
    database.ref(COOLDOWN_REF).once("value"),
  ]);
  const existingAlerts = alertsSnapshot.val() || {};
  const cooldowns = cooldownSnapshot.val() || {};
  const updates = {};
  const cooldownUpdates = {};
  const telegramQueue = [];

  for (const result of results) {
    const definition = ALERT_DEFINITIONS[result.key];
    const previous = existingAlerts[result.key] || {};
    const isActive = result.severity !== "normal";
    const wasActive = previous.status === "active";
    const severityChanged = previous.severity !== result.severity;

    updates[result.key] = {
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
    };

    if (isActive && TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
      const cooldownKey = `${result.key}_${result.severity}`;
      const lastSent = cooldowns[cooldownKey] || 0;
      if (now - lastSent >= COOLDOWN_MS) {
        telegramQueue.push(result);
        cooldownUpdates[cooldownKey] = now;
        updates[result.key].telegramSentAt = now;
      }
    }
  }

  await database.ref(ALERTS_REF).update(updates);
  if (Object.keys(cooldownUpdates).length) await database.ref(COOLDOWN_REF).update(cooldownUpdates);

  for (const alert of telegramQueue) {
    try {
      await sendTelegram(telegramMessage(alert, now));
    } catch (error) {
      console.error(`[TELEGRAM ERROR] ${alert.key}`, error);
    }
  }
}

async function setDeviceConnectivity(isOffline, now, secondsOffline = 0) {
  const alertRef = admin.database().ref(`${ALERTS_REF}/device_offline`);
  const snapshot = await alertRef.once("value");
  const previous = snapshot.val() || {};

  if (!isOffline) {
    await alertRef.set({
      id: "device_offline",
      sensor: "device_offline",
      type: ALERT_DEFINITIONS.device_offline.type,
      device: ALERT_DEFINITIONS.device_offline.device,
      unit: "detik",
      severity: "normal",
      status: "resolved",
      message: "Perangkat kembali online dan mengirim data sensor.",
      value: 0,
      threshold: 30,
      startedAt: previous.startedAt || null,
      updatedAt: now,
      resolvedAt: previous.status === "active" ? now : (previous.resolvedAt || null),
      telegramSentAt: previous.telegramSentAt || null,
    });
    return;
  }

  await updateAlertStates([{
    key: "device_offline",
    severity: "critical",
    value: secondsOffline,
    threshold: 30,
    message: `ESP32 tidak mengirim pembaruan selama ${secondsOffline} detik.`,
  }], now);
}

async function saveHistorySnapshot(data, now) {
  const database = admin.database();
  const throttleRef = database.ref(`${SYSTEM_REF}/historyLastSavedAt`);
  const transaction = await throttleRef.transaction((lastSavedAt) => {
    if (!lastSavedAt || now - Number(lastSavedAt) >= HISTORY_INTERVAL_MS) return now;
    return undefined;
  });

  if (!transaction.committed) return false;

  const snapshot = { timestamp: now };
  for (const key of ["temperature", "humidity", "co2", "pressure"]) {
    const value = data[key];
    const numeric = value === null || value === undefined || value === "" ? Number.NaN : Number(value);
    if (Number.isFinite(numeric)) snapshot[key] = numeric;
  }

  if (Object.keys(snapshot).length === 1) return false;
  await database.ref(HISTORY_REF).push(snapshot);
  return true;
}

exports.monitoringSensorAlert = functions.database
  .ref(SENSOR_REF)
  .onWrite(async (change) => {
    const data = change.after.val();
    if (!data) return null;

    const now = Date.now();
    await admin.database().ref(SYSTEM_REF).update({ lastSeen: now, status: "online" });
    await saveHistorySnapshot(data, now);
    await setDeviceConnectivity(false, now);
    await updateAlertStates(evaluateSensor(data), now);
    return null;
  });

exports.monitoringDeviceOffline = functions.pubsub
  .schedule("every 1 minutes")
  .timeZone("Asia/Jakarta")
  .onRun(async () => {
    const now = Date.now();
    const snapshot = await admin.database().ref(`${SYSTEM_REF}/lastSeen`).once("value");
    const lastSeen = Number(snapshot.val()) || 0;
    const elapsed = now - lastSeen;

    if (lastSeen > 0 && elapsed > OFFLINE_AFTER_MS) {
      await admin.database().ref(SYSTEM_REF).update({ status: "offline" });
      await setDeviceConnectivity(true, now, Math.floor(elapsed / 1000));
    }
    return null;
  });

exports.resetCooldownMidnight = functions.pubsub
  .schedule("0 0 * * *")
  .timeZone("Asia/Jakarta")
  .onRun(async () => {
    await admin.database().ref(COOLDOWN_REF).remove();
    return null;
  });

const deviceManagement = require('./device-management').createDeviceManagement(functions, admin);
Object.assign(exports, deviceManagement);
