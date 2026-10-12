"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  createAlertTransition,
  evaluateSensor,
  telegramMessage,
} = require("../alert-core");

test("nilai tepat pada threshold masih dianggap normal", () => {
  const results = evaluateSensor({ temperature: 30, humidity: 70, co2: 800 });
  assert.deepEqual(results.map(result => result.severity), ["normal", "normal", "normal"]);
});

test("warning dan critical dievaluasi sesuai arah parameternya", () => {
  const warning = evaluateSensor({ temperature: 31, humidity: 65, co2: 900 });
  assert.deepEqual(warning.map(result => result.severity), ["warning", "warning", "warning"]);

  const critical = evaluateSensor({ temperature: 34, humidity: 55, co2: 1300 });
  assert.deepEqual(critical.map(result => result.severity), ["critical", "critical", "critical"]);
});

test("sensor hilang tidak diubah menjadi nilai nol palsu", () => {
  const results = evaluateSensor({ humidity: null, co2: "", temperature: 31 });
  assert.equal(results.length, 1);
  assert.equal(results[0].key, "temperature_high");
});

test("aktivasi baru membuat startedAt dan dapat mengirim Telegram", () => {
  const now = 1_000_000;
  const result = evaluateSensor({ temperature: 31 })[0];
  const transition = createAlertTransition(result, {}, now, 0, 600_000);

  assert.equal(transition.record.status, "active");
  assert.equal(transition.record.startedAt, now);
  assert.equal(transition.shouldNotify, true);
  assert.equal(transition.cooldownKey, "temperature_high_warning");
});

test("alert aktif tidak mengirim ulang selama cooldown", () => {
  const now = 1_000_000;
  const result = evaluateSensor({ co2: 900 })[0];
  const previous = { status: "active", severity: "warning", startedAt: 100 };
  const transition = createAlertTransition(result, previous, now, now - 1000, 600_000);

  assert.equal(transition.record.startedAt, 100);
  assert.equal(transition.shouldNotify, false);
});

test("perubahan warning ke critical memakai cooldown terpisah", () => {
  const now = 1_000_000;
  const result = evaluateSensor({ humidity: 55 })[0];
  const previous = { status: "active", severity: "warning", startedAt: 100 };
  const transition = createAlertTransition(result, previous, now, 0, 600_000);

  assert.equal(transition.record.severity, "critical");
  assert.equal(transition.record.startedAt, now);
  assert.equal(transition.shouldNotify, true);
  assert.equal(transition.cooldownKey, "humidity_low_critical");
});

test("pemulihan mengubah alert menjadi resolved tanpa Telegram", () => {
  const now = 1_000_000;
  const result = evaluateSensor({ temperature: 28 })[0];
  const previous = { status: "active", severity: "warning", startedAt: 100 };
  const transition = createAlertTransition(result, previous, now, 0, 600_000);

  assert.equal(transition.record.status, "resolved");
  assert.equal(transition.record.resolvedAt, now);
  assert.equal(transition.shouldNotify, false);
});

test("pesan Telegram menyertakan severity, nilai, dan lokasi", () => {
  const alert = evaluateSensor({ co2: 1300 })[0];
  const message = telegramMessage(alert, Date.UTC(2026, 6, 26, 12, 0, 0), "Kumbung Uji");

  assert.match(message, /CRITICAL/);
  assert.match(message, /1300 ppm/);
  assert.match(message, /Kumbung Uji/);
});

test("konfigurasi CLI menghasilkan object threshold yang lengkap", () => {
  const functionsRoot = path.resolve(__dirname, "..");
  const result = spawnSync(process.execPath, [
    path.join(functionsRoot, "local-alert-worker.js"),
    "--validate-config",
  ], {
    cwd: functionsRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_CHAT_ID: "1",
      FIREBASE_CREDENTIALS_PATH: "test/alert-core.test.js",
      FIREBASE_DATABASE_URL: "https://tandurai-ai-default-rtdb.asia-southeast1.firebasedatabase.app",
      TEMPERATURE_WARNING: "30",
      TEMPERATURE_CRITICAL: "33",
      HUMIDITY_WARNING: "70",
      HUMIDITY_CRITICAL: "60",
      CO2_WARNING: "800",
      CO2_CRITICAL: "1200",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.deepEqual(config.thresholds, {
    temperature: { warning: 30, critical: 33 },
    humidity: { warning: 70, critical: 60 },
    co2: { warning: 800, critical: 1200 },
  });
});
