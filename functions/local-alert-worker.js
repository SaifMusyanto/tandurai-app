"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const {
  DEFAULT_THRESHOLDS,
  createAlertTransition,
  evaluateSensor,
  telegramMessage,
} = require("./alert-core");
const { selectMonitoredSensors } = require("./sensor-targets");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const lines = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

function updateEnvValue(filePath, key, value) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const linePattern = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  const replacement = `${key}=${value}`;
  const updated = linePattern.test(current)
    ? current.replace(linePattern, replacement)
    : `${current.trimEnd()}${current.trim() ? "\n" : ""}${replacement}\n`;
  fs.writeFileSync(filePath, updated, { encoding: "utf8", mode: 0o600 });
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberFromEnv(name, fallback, minimum = Number.NEGATIVE_INFINITY) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} harus berupa angka minimal ${minimum}.`);
  }
  return value;
}

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} belum diatur.`);
  return value;
}

function resolveLocalPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(__dirname, value);
}

function printHelp() {
  console.log(`Tandurai local Telegram alert worker

Usage:
  node local-alert-worker.js                Pantau telemetry terus-menerus
  node local-alert-worker.js --once         Evaluasi telemetry terbaru lalu keluar
  node local-alert-worker.js --test-telegram  Kirim satu pesan uji Telegram
  node local-alert-worker.js --bind-telegram-chat <kode>  Ikat chat dari pesan setup
  node local-alert-worker.js --validate-config Validasi konfigurasi tanpa koneksi Firebase
  node local-alert-worker.js --env <path>    Gunakan file env tertentu
`);
}

const requestedEnvPath = optionValue("--env");
const envPath = requestedEnvPath ? path.resolve(process.cwd(), requestedEnvPath) : path.join(__dirname, ".env");
loadEnvFile(envPath);

function telegramConfig() {
  return {
    token: requireEnv("TELEGRAM_BOT_TOKEN"),
    chatId: requireEnv("TELEGRAM_CHAT_ID"),
    location: String(process.env.ALERT_LOCATION || "Tandurai Smart Farm — Sidoarjo").trim(),
  };
}

function workerConfig() {
  const databaseUrl = String(
    process.env.FIREBASE_DATABASE_URL
      || "https://tandurai-ai-default-rtdb.asia-southeast1.firebasedatabase.app",
  ).trim();
  const parsedUrl = new URL(databaseUrl);
  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith("firebasedatabase.app")) {
    throw new Error("FIREBASE_DATABASE_URL harus berupa URL HTTPS Firebase Realtime Database.");
  }

  const credentialSetting = String(
    process.env.FIREBASE_CREDENTIALS_PATH
      || process.env.GOOGLE_APPLICATION_CREDENTIALS
      || "credentials/firebase-admin.json",
  ).trim();
  const credentialsPath = resolveLocalPath(credentialSetting);
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`Service account tidak ditemukan: ${credentialsPath}`);
  }

  const thresholds = {
    temperature: {
      warning: numberFromEnv("TEMPERATURE_WARNING", DEFAULT_THRESHOLDS.temperature.warning),
      critical: numberFromEnv("TEMPERATURE_CRITICAL", DEFAULT_THRESHOLDS.temperature.critical),
    },
    humidity: {
      warning: numberFromEnv("HUMIDITY_WARNING", DEFAULT_THRESHOLDS.humidity.warning),
      critical: numberFromEnv("HUMIDITY_CRITICAL", DEFAULT_THRESHOLDS.humidity.critical),
    },
    co2: {
      warning: numberFromEnv("CO2_WARNING", DEFAULT_THRESHOLDS.co2.warning),
      critical: numberFromEnv("CO2_CRITICAL", DEFAULT_THRESHOLDS.co2.critical),
    },
  };
  if (thresholds.temperature.critical <= thresholds.temperature.warning) {
    throw new Error("TEMPERATURE_CRITICAL harus lebih besar dari TEMPERATURE_WARNING.");
  }
  if (thresholds.humidity.critical >= thresholds.humidity.warning) {
    throw new Error("HUMIDITY_CRITICAL harus lebih kecil dari HUMIDITY_WARNING.");
  }
  if (thresholds.co2.critical <= thresholds.co2.warning) {
    throw new Error("CO2_CRITICAL harus lebih besar dari CO2_WARNING.");
  }

  return {
    databaseUrl,
    credentialsPath,
    // Farm yang dipantau; bila kosong diambil dari farm milik DEFAULT_KUMBUNG_ID.
    farmId: String(process.env.ALERT_FARM_ID || "").trim() || null,
    // Sensor default hanya fallback bila farm belum punya sensor aktif di katalog.
    kumbungId: String(process.env.DEFAULT_KUMBUNG_ID || "FARM-01-K01").trim(),
    sensorId: String(process.env.DEFAULT_SENSOR_ID || "SNS-0101").trim(),
    monitorLegacy: String(process.env.MONITOR_LEGACY_SENSOR || "false").toLowerCase() === "true",
    cooldownMs: numberFromEnv("TELEGRAM_COOLDOWN_SECONDS", 600, 1) * 1000,
    offlineAfterMs: numberFromEnv("OFFLINE_AFTER_SECONDS", 30, 5) * 1000,
    thresholds,
  };
}

async function telegramRequest(method, payload, config) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`Jaringan Telegram gagal (${error.code || "network_error"}).`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    throw new Error(`Telegram API ${response.status}: ${body.description || "request gagal"}`);
  }
  return body.result;
}

async function sendTelegram(text, config) {
  return telegramRequest("sendMessage", {
    chat_id: config.chatId,
    text,
    parse_mode: "HTML",
  }, config);
}

async function testTelegram(config) {
  const bot = await telegramRequest("getMe", {}, config);
  const chat = await telegramRequest("getChat", { chat_id: config.chatId }, config);
  const message = await sendTelegram(
    `✅ <b>Tandurai local worker siap</b>\n\nKoneksi Telegram berhasil dari ${os.hostname()}.`,
    config,
  );
  console.log(JSON.stringify({
    ok: true,
    bot: `@${bot.username}`,
    chatType: chat.type,
    messageId: message.message_id,
  }, null, 2));
}

async function bindTelegramChat(config, setupCode, targetEnvPath) {
  const updates = await telegramRequest("getUpdates", { limit: 100, timeout: 0 }, config);
  const match = [...updates]
    .filter(update => update.message?.text === setupCode && update.message?.chat?.type === "private")
    .sort((left, right) => Number(right.update_id) - Number(left.update_id))[0];
  if (!match) {
    throw new Error(`Pesan setup "${setupCode}" belum ditemukan. Kirim ulang ke @Tanduraibot lalu coba lagi.`);
  }

  const chatId = String(match.message.chat.id);
  updateEnvValue(targetEnvPath, "TELEGRAM_CHAT_ID", chatId);
  const nextConfig = { ...config, chatId };
  const confirmation = await sendTelegram(
    "✅ <b>Telegram Tandurai terhubung</b>\n\nChat ini sekarang menjadi tujuan notifikasi sensor.",
    nextConfig,
  );
  console.log(JSON.stringify({
    ok: true,
    username: match.message.from?.username ? `@${match.message.from.username}` : null,
    name: [match.message.from?.first_name, match.message.from?.last_name].filter(Boolean).join(" "),
    messageId: confirmation.message_id,
    envUpdated: path.basename(targetEnvPath),
  }, null, 2));
}

function initializeFirebase(config) {
  const serviceAccount = JSON.parse(fs.readFileSync(config.credentialsPath, "utf8"));
  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: config.databaseUrl,
  }, `tandurai-local-alert-${process.pid}`);
}

function createWorker(app, config, telegram) {
  const database = admin.database(app);
  const workerRef = database.ref("tumbara/system/localAlertWorker");
  const startedAt = Date.now();
  // sensorId -> { sensorId, kumbungId, path, reference, callback, lastTelemetryAt, offlineActive, legacy }
  const targets = new Map();
  const extraSubscriptions = [];
  let catalogReference = null;
  let catalogCallback = null;
  let queue = Promise.resolve();
  let timer = null;
  let stopping = false;
  let farmId = null; // alert disimpan per farm: tumbara/alerts/{farmId}/{sensorId}_{jenis}

  async function resolveFarmId() {
    if (farmId) return farmId;
    if (config.farmId) {
      farmId = config.farmId;
      return farmId;
    }
    const snapshot = await database.ref(`tumbara/kumbungs/${config.kumbungId}/farmId`).once("value");
    if (typeof snapshot.val() !== "string") {
      throw new Error(`Kumbung ${config.kumbungId} tidak ditemukan atau tidak memiliki farmId. Atur ALERT_FARM_ID.`);
    }
    farmId = snapshot.val();
    return farmId;
  }

  async function writeWorkerStatus(status, detail = null) {
    await workerRef.set({
      status,
      detail,
      hostname: os.hostname(),
      pid: process.pid,
      farmId,
      sensorPaths: [...targets.values()].map(target => target.path),
      heartbeatAt: Date.now(),
      schemaVersion: "local-alert-worker-v2",
    });
  }

  async function updateAlertStates(target, results, now) {
    if (!results.length) return;
    const farm = await resolveFarmId();
    const alertsPath = `tumbara/alerts/${farm}`;
    const cooldownPath = `tumbara/notif_cooldown/${farm}`;
    const [alertsSnapshot, cooldownSnapshot] = await Promise.all([
      database.ref(alertsPath).once("value"),
      database.ref(cooldownPath).once("value"),
    ]);
    const existingAlerts = alertsSnapshot.val() || {};
    const cooldowns = cooldownSnapshot.val() || {};
    const updates = {};

    for (const result of results) {
      const alertId = `${target.sensorId}_${result.key}`;
      const transition = createAlertTransition(
        result,
        existingAlerts[alertId] || {},
        now,
        cooldowns[`${target.sensorId}_${result.key}_${result.severity}`] || 0,
        config.cooldownMs,
      );

      if (transition.shouldNotify) {
        try {
          const location = `${telegram.location} · ${target.kumbungId} / ${target.sensorId}`;
          await sendTelegram(telegramMessage(result, now, location), telegram);
          transition.record.telegramSentAt = now;
          updates[`${cooldownPath}/${target.sensorId}_${transition.cooldownKey}`] = now;
          console.log(`[telegram] ${target.sensorId} ${result.key} ${result.severity} terkirim`);
        } catch (error) {
          console.error(`[telegram] ${target.sensorId} ${result.key} gagal: ${error.message}`);
        }
      }
      updates[`${alertsPath}/${alertId}`] = {
        ...transition.record,
        id: alertId,
        farmId: farm,
        kumbungId: target.kumbungId,
        sensorId: target.sensorId,
        source: "local-worker",
      };
    }

    await database.ref().update(updates);
  }

  function offlineResult(target, secondsOffline) {
    return {
      key: "device_offline",
      severity: "critical",
      value: secondsOffline,
      threshold: config.offlineAfterMs / 1000,
      message: `Sensor ${target.sensorId} (${target.kumbungId}) tidak mengirim pembaruan selama ${secondsOffline} detik.`,
    };
  }

  async function setConnectivity(target, isOffline, now, secondsOffline = 0) {
    if (isOffline) {
      target.offlineActive = true;
      await updateAlertStates(target, [offlineResult(target, secondsOffline)], now);
      return;
    }
    const wasOffline = target.offlineActive;
    target.offlineActive = false;
    // Catat pemulihan (dan status awal) tanpa menulis ulang setiap kali telemetry masuk.
    if (wasOffline || !target.connectivityRecorded) {
      target.connectivityRecorded = true;
      await updateAlertStates(target, [{
        key: "device_offline",
        severity: "normal",
        value: 0,
        threshold: config.offlineAfterMs / 1000,
        message: `Sensor ${target.sensorId} kembali online dan mengirim data.`,
      }], now);
    }
  }

  async function processTelemetry(target, data, sourcePath) {
    if (!data || typeof data !== "object" || !targets.has(target.sensorId)) return;
    const now = Date.now();
    const sensorTimestamp = Number(data.timestamp);
    target.lastTelemetryAt = Number.isFinite(sensorTimestamp) && sensorTimestamp > 0
      ? Math.min(now, sensorTimestamp)
      : now;
    if (now - target.lastTelemetryAt >= config.offlineAfterMs) return; // data lama; ditangani checkOffline
    await setConnectivity(target, false, now);
    await updateAlertStates(target, evaluateSensor(data, config.thresholds), now);
    await writeWorkerStatus("online", `Telemetry diproses dari ${sourcePath}`);
    console.log(`[telemetry] ${sourcePath} diproses pada ${new Date(now).toISOString()}`);
  }

  async function checkOffline() {
    const now = Date.now();
    const offline = [];
    for (const target of targets.values()) {
      const elapsed = now - (target.lastTelemetryAt || startedAt);
      if (elapsed < config.offlineAfterMs) continue;
      await setConnectivity(target, true, now, Math.floor(elapsed / 1000));
      offline.push(target.sensorId);
    }
    if (offline.length) await writeWorkerStatus("sensor_offline", `Tanpa telemetry: ${offline.join(", ")}`);
  }

  function enqueue(task) {
    queue = queue.then(task).catch(async (error) => {
      console.error(`[worker] ${error.stack || error.message}`);
      await writeWorkerStatus("error", error.message).catch(() => {});
    });
    return queue;
  }

  function listen(pathValue, onData) {
    const reference = database.ref(pathValue);
    const callback = snapshot => enqueue(() => onData(snapshot.val()));
    reference.on("value", callback, error => enqueue(async () => {
      throw new Error(`Listener ${pathValue} gagal: ${error.message}`);
    }));
    return { reference, callback };
  }

  function unwatch(sensorId) {
    const target = targets.get(sensorId);
    if (!target) return;
    target.reference?.off("value", target.callback);
    targets.delete(sensorId);
    console.log(`[worker] berhenti memantau ${target.path}`);
  }

  function watch({ sensorId, kumbungId, legacy = false }, live) {
    const path = `tumbara/monitoring/${kumbungId}/${sensorId}`;
    const existing = targets.get(sensorId);
    if (existing?.path === path) return existing;
    if (existing) unwatch(sensorId);
    const target = { sensorId, kumbungId, path, legacy, lastTelemetryAt: 0, offlineActive: false, connectivityRecorded: false };
    targets.set(sensorId, target);
    if (live) Object.assign(target, listen(path, data => processTelemetry(target, data, path)));
    console.log(`[worker] memantau ${path}${legacy ? " (sensor default lama)" : ""}`);
    return target;
  }

  function syncTargets(catalog, live) {
    const wanted = selectMonitoredSensors(catalog, farmId, { sensorId: config.sensorId, kumbungId: config.kumbungId });
    const wantedIds = new Set(wanted.map(item => item.sensorId));
    for (const sensorId of [...targets.keys()]) if (!wantedIds.has(sensorId)) unwatch(sensorId);
    for (const item of wanted) watch(item, live);
    return wanted;
  }

  async function runOnce() {
    await resolveFarmId();
    await writeWorkerStatus("starting", "Mode sekali jalan");
    const catalog = (await database.ref("tumbara/sensors").once("value")).val() || {};
    const wanted = syncTargets(catalog, false);
    if (!wanted.length) throw new Error(`Farm ${farmId} belum punya sensor aktif di katalog.`);
    for (const target of targets.values()) {
      const snapshot = await database.ref(target.path).once("value");
      if (snapshot.exists()) await processTelemetry(target, snapshot.val(), target.path);
      else console.log(`[telemetry] ${target.path} belum ada data`);
    }
    await checkOffline();
    await writeWorkerStatus("stopped", "Mode sekali jalan selesai");
  }

  async function start() {
    await resolveFarmId();
    await writeWorkerStatus("starting", "Memulai listener katalog sensor");
    // Katalog sensor dipantau realtime: sensor baru langsung dipantau, sensor nonaktif/pindah dilepas.
    ({ reference: catalogReference, callback: catalogCallback } = listen("tumbara/sensors", catalog => {
      syncTargets(catalog || {}, true);
    }));
    if (config.monitorLegacy) {
      const legacyTarget = { sensorId: config.sensorId, kumbungId: config.kumbungId };
      extraSubscriptions.push(listen("tumbara/monitoring/sensor1", data => {
        const target = targets.get(legacyTarget.sensorId);
        return target ? processTelemetry(target, data, "tumbara/monitoring/sensor1") : undefined;
      }));
    }
    const intervalMs = Math.max(5000, Math.min(10000, Math.floor(config.offlineAfterMs / 2)));
    timer = setInterval(() => enqueue(checkOffline), intervalMs);
    console.log(`[worker] aktif; farm=${farmId}; offline=${config.offlineAfterMs / 1000}s; cooldown=${config.cooldownMs / 1000}s`);
  }

  async function stop(signal = "stop") {
    if (stopping) return;
    stopping = true;
    if (timer) clearInterval(timer);
    catalogReference?.off("value", catalogCallback);
    for (const { reference, callback } of extraSubscriptions) reference.off("value", callback);
    for (const target of targets.values()) target.reference?.off("value", target.callback);
    await queue;
    // Status akhir tetap mencantumkan sensor yang dipantau sebelum berhenti.
    await writeWorkerStatus("stopped", `Dihentikan oleh ${signal}`).catch(() => {});
    targets.clear();
    await app.delete();
    console.log(`[worker] berhenti (${signal})`);
  }

  return { runOnce, start, stop };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const telegram = telegramConfig();
  const setupCode = optionValue("--bind-telegram-chat");
  if (setupCode) {
    await bindTelegramChat(telegram, setupCode, envPath);
    return;
  }
  if (process.argv.includes("--test-telegram")) {
    await testTelegram(telegram);
    return;
  }

  const config = workerConfig();
  if (process.argv.includes("--validate-config")) {
    console.log(JSON.stringify({
      ok: true,
      databaseHost: new URL(config.databaseUrl).hostname,
      credentialsConfigured: true,
      farmId: config.farmId || `(dari kumbung ${config.kumbungId})`,
      mode: "semua sensor aktif di katalog farm",
      fallbackSensorPath: `tumbara/monitoring/${config.kumbungId}/${config.sensorId}`,
      cooldownSeconds: config.cooldownMs / 1000,
      offlineAfterSeconds: config.offlineAfterMs / 1000,
      thresholds: config.thresholds,
    }, null, 2));
    return;
  }

  const app = initializeFirebase(config);
  const worker = createWorker(app, config, telegram);

  if (process.argv.includes("--once")) {
    try {
      await worker.runOnce();
    } finally {
      await worker.stop("once");
    }
    return;
  }

  await worker.start();
  process.once("SIGINT", () => worker.stop("SIGINT").then(() => process.exit(0)));
  process.once("SIGTERM", () => worker.stop("SIGTERM").then(() => process.exit(0)));
}

main().catch(error => {
  console.error(`[fatal] ${error.message}`);
  process.exitCode = 1;
});
