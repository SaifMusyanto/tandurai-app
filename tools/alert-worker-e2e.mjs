// Uji worker alert lokal multi-sensor pada RTDB Emulator (tanpa Firebase live, tanpa Telegram nyata).
// Jalankan: npm run test:alert-worker
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!host) throw new Error('Jalankan lewat npm run test:alert-worker (butuh RTDB Emulator).');

// Namespace khusus uji: tidak ada di produksi, jadi salah konfigurasi pun tidak menyentuh data live.
const NAMESPACE = 'worker-test-default-rtdb';
const DATABASE_URL = `https://${NAMESPACE}.asia-southeast1.firebasedatabase.app`;
const credentials = resolve(ROOT, process.env.FIREBASE_CREDENTIALS_PATH || 'functions/credentials/firebase-admin.json');
if (!existsSync(credentials)) {
  console.log('Lewati: service account lokal tidak ada (dibutuhkan Admin SDK walau memakai emulator).');
  process.exit(0);
}

async function db(method, path, body) {
  const response = await fetch(`http://${host}/${path}.json?ns=${NAMESPACE}`, {
    method,
    headers: { Authorization: 'Bearer owner', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response.json();
}

const now = Date.now();
const reading = (sensorId, kumbungId, overrides = {}) => ({
  timestamp: now - 2000, farmId: 'FARM-W', kumbungId, sensorId, gatewayId: 'GW-W',
  schemaVersion: 'telemetry-v1', temperature: 27, humidity: 82, co2: 650, quality: { status: 'valid' }, ...overrides,
});

await db('PUT', '', {
  tumbara: {
    farms: { 'FARM-W': { name: 'Farm Worker' } },
    kumbungs: { 'FARM-W-K1': { farmId: 'FARM-W' }, 'FARM-W-K2': { farmId: 'FARM-W' } },
    sensors: {
      'SNS-HOT': { farmId: 'FARM-W', kumbungId: 'FARM-W-K1', gatewayId: 'GW-W', status: 'active' },
      'SNS-OK': { farmId: 'FARM-W', kumbungId: 'FARM-W-K2', gatewayId: 'GW-W', status: 'active' },
      'SNS-OLD': { farmId: 'FARM-W', kumbungId: 'FARM-W-K2', gatewayId: 'GW-W', status: 'active' },
      'SNS-PENDING': { farmId: 'FARM-W', kumbungId: 'FARM-W-K1', gatewayId: 'GW-W', status: 'pending' },
      'SNS-OTHER': { farmId: 'FARM-X', kumbungId: 'FARM-X-K1', gatewayId: 'GW-X', status: 'active' },
    },
    monitoring: {
      'FARM-W-K1': { 'SNS-HOT': reading('SNS-HOT', 'FARM-W-K1', { temperature: 31.5 }), 'SNS-PENDING': reading('SNS-PENDING', 'FARM-W-K1', { temperature: 40 }) },
      'FARM-W-K2': {
        'SNS-OK': reading('SNS-OK', 'FARM-W-K2'),
        'SNS-OLD': reading('SNS-OLD', 'FARM-W-K2', { timestamp: now - 10 * 60 * 1000 }),
      },
      'FARM-X-K1': { 'SNS-OTHER': reading('SNS-OTHER', 'FARM-X-K1', { temperature: 40 }) },
    },
  },
});

const dir = mkdtempSync(join(tmpdir(), 'alert-worker-'));
const envPath = join(dir, 'worker.env');
writeFileSync(envPath, [
  'TELEGRAM_BOT_TOKEN=000000:uji-tidak-valid',
  'TELEGRAM_CHAT_ID=0',
  `FIREBASE_DATABASE_URL=${DATABASE_URL}`,
  `FIREBASE_CREDENTIALS_PATH=${credentials}`,
  'ALERT_FARM_ID=FARM-W',
  'DEFAULT_KUMBUNG_ID=FARM-W-K1',
  'DEFAULT_SENSOR_ID=SNS-TIDAK-ADA',
  'OFFLINE_AFTER_SECONDS=60',
].join('\n'));

try {
  execFileSync(process.execPath, [join(ROOT, 'functions/local-alert-worker.js'), '--once', '--env', envPath], {
    env: { ...process.env, FIREBASE_DATABASE_EMULATOR_HOST: host },
    stdio: 'pipe',
  });
  const alerts = await db('GET', 'tumbara/alerts/FARM-W') || {};
  assert.equal(alerts['SNS-HOT_temperature_high']?.status, 'active');
  assert.equal(alerts['SNS-HOT_temperature_high']?.severity, 'warning');
  assert.equal(alerts['SNS-HOT_temperature_high']?.kumbungId, 'FARM-W-K1');
  assert.equal(alerts['SNS-OK_temperature_high']?.status, 'resolved');
  assert.equal(alerts['SNS-OLD_device_offline']?.status, 'active');
  assert.equal(alerts['SNS-OLD_device_offline']?.severity, 'critical');
  assert.equal(alerts['SNS-OLD_temperature_high'], undefined); // data usang tidak dievaluasi ulang
  assert.ok(!Object.keys(alerts).some(id => id.startsWith('SNS-PENDING') || id.startsWith('SNS-OTHER')));
  assert.equal(await db('GET', 'tumbara/alerts/FARM-X'), null);
  const status = await db('GET', 'tumbara/system/localAlertWorker');
  assert.deepEqual([...status.sensorPaths].sort(), [
    'tumbara/monitoring/FARM-W-K1/SNS-HOT',
    'tumbara/monitoring/FARM-W-K2/SNS-OK',
    'tumbara/monitoring/FARM-W-K2/SNS-OLD',
  ]);
  console.log('✔ worker memantau 3 sensor aktif FARM-W (pending dan farm lain diabaikan)');
  console.log('✔ alert per sensor: SNS-HOT suhu warning, SNS-OK normal, SNS-OLD offline critical');
  console.log('\nUji worker alert multi-sensor lulus.');
} catch (error) {
  if (error.stdout || error.stderr) console.error(String(error.stdout || ''), String(error.stderr || ''));
  throw error;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
