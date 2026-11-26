// Uji end-to-end diagnostik gateway + update firmware (OTA): broker uji + backend + PostgreSQL (*_test),
// gateway tiruan yang benar-benar mengunduh firmware dan mencocokkan SHA-256, dan tool ota.mjs.
// Jalankan: npm run test:e2e:ota -w apps/api
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';
import { provisionDevice } from './factory-provision.mjs';
import { BACKEND_PASS, TEST_DB, startStack, step, waitFor } from './e2e-harness.mjs';

const firmwareDir = mkdtempSync(join(tmpdir(), 'tdr-fw-'));
const NEW_VERSION = 'esp32-gw/0.9.9';
const binary = Buffer.concat([Buffer.from([0xE9, 0x05, 0x02, 0x20]), Buffer.from(`\0${NEW_VERSION}\0`), Buffer.alloc(40000, 7)]);
writeFileSync(join(firmwareDir, 'tdr-test.bin'), binary);
writeFileSync(join(firmwareDir, 'catatan.txt'), 'bukan firmware');

const stack = await startStack({ FIRMWARE_DIR: firmwareDir });
const { backend, config, base } = stack;
const gatewayRow = async hwUid => (await backend.pool.query('SELECT * FROM gateways WHERE id = $1', [hwUid])).rows[0];
let device = null;
let exitCode = 0;
try {
  // ═══ 1. Endpoint firmware publik: hanya *.bin dari FIRMWARE_DIR
  const download = await fetch(`${base}/firmware/tdr-test.bin`);
  assert.equal(download.status, 200);
  assert.equal(Number(download.headers.get('content-length')), binary.length);
  assert.ok(Buffer.from(await download.arrayBuffer()).equals(binary));
  for (const path of ['catatan.txt', '..%2Fpackage.json', 'tidak-ada.bin']) {
    assert.equal((await fetch(`${base}/firmware/${path}`)).status, 404, path);
  }
  step('endpoint /api/firmware menyajikan .bin saja');

  // ═══ 2. Gateway tiruan: register + status dengan diagnostik
  const provisioned = await provisionDevice(backend.pool, { model: 'TDR-GW1' });
  const hwUid = provisioned.hwUid;
  device = mqtt.connect(config.mqttUrl, { clientId: hwUid, username: hwUid, password: provisioned.deviceSecret, reconnectPeriod: 0 });
  await new Promise((resolve, reject) => { device.once('connect', resolve); device.once('error', reject); });
  const topic = kind => `tandurai/gw/${hwUid}/${kind}`;
  const publish = (kind, payload) => device.publishAsync(topic(kind), JSON.stringify(payload), { qos: 1 });
  let firmware = 'esp32-gw/0.4.0';
  const status = (uptimeSec, diag = {}) => publish('status', {
    online: true, firmware, configVersion: 0, uptimeSec,
    diag: { resetReason: 'power_on', wifiDrops: 0, mqttDrops: 0, wifiReason: 0, freeHeap: 150000, minFreeHeap: 90000, ...diag },
  });
  await publish('register', { model: 'TDR-GW1', firmware, sensors: [{ id: 'S1' }], actuators: [{ id: 'A1', type: 'sprayer', maxRunSec: 120, minIntervalSec: 0 }] });
  await waitFor(async () => Boolean(await gatewayRow(hwUid)), { label: 'register' });

  await status(100, { resetReason: 'brownout', wifiDrops: 2, extra: 'dibuang' });
  await waitFor(async () => (await gatewayRow(hwUid)).diagnostics?.resetReason === 'brownout', { label: 'diagnostik tersimpan' });
  let row = await gatewayRow(hwUid);
  assert.deepEqual(row.diagnostics, { uptimeSec: 100, resetReason: 'brownout', wifiDrops: 2, mqttDrops: 0, wifiReason: 0, freeHeap: 150000, minFreeHeap: 90000 });
  assert.equal(row.restart_count, 0);
  await status(160);
  await waitFor(async () => (await gatewayRow(hwUid)).diagnostics?.uptimeSec === 160, { label: 'heartbeat' });
  assert.equal((await gatewayRow(hwUid)).restart_count, 0, 'uptime maju bukan restart');
  await status(5, { resetReason: 'task_wdt' });
  await waitFor(async () => (await gatewayRow(hwUid)).diagnostics?.uptimeSec === 5, { label: 'status setelah restart' });
  row = await gatewayRow(hwUid);
  assert.equal(row.restart_count, 1, 'uptime mundur = restart');
  assert.equal(row.diagnostics.resetReason, 'task_wdt');
  step('diagnostik status + deteksi restart');

  // ═══ 3. OTA lewat tool: gateway tiruan mengunduh, cek SHA-256, ACK started, lalu melapor versi baru
  let received = null;
  device.on('message', async (messageTopic, buffer) => {
    if (messageTopic !== topic('cmd')) return;
    const command = JSON.parse(buffer);
    if (command.action !== 'ota') return;
    received = command;
    const file = Buffer.from(await (await fetch(command.url)).arrayBuffer());
    const ok = file.length === command.size && createHash('sha256').update(file).digest('hex') === command.sha256;
    await publish('ack', { type: 'ota', id: command.id, status: ok ? 'started' : 'rejected', reason: ok ? null : 'sha256', version: command.version });
    if (!ok) return;
    setTimeout(async () => { firmware = command.version; await status(3, { resetReason: 'software' }); }, 300);
  });
  await device.subscribeAsync(topic('cmd'), { qos: 1 });

  const tool = fileURLToPath(new URL('./ota.mjs', import.meta.url));
  const output = await new Promise((resolve, reject) => execFile(process.execPath, [tool, '--file', 'tdr-test.bin', '--hw-uid', hwUid, '--base-url', base, '--wait', '20'], {
    env: { ...process.env, DATABASE_URL: TEST_DB, MQTT_URL: config.mqttUrl, MQTT_PASSWORD: BACKEND_PASS, FIRMWARE_DIR: firmwareDir },
  }, (error, stdout, stderr) => (error ? reject(new Error(`${error.message}\n${stdout}\n${stderr}`)) : resolve(stdout))));
  assert.match(output, new RegExp(NEW_VERSION.replace(/[./]/g, '\\$&')), 'versi dibaca otomatis dari file');
  assert.match(output, /✔ .*done/, 'tool melaporkan selesai');
  assert.equal(received.sha256, createHash('sha256').update(binary).digest('hex'));
  assert.equal(received.url, `${base}/firmware/tdr-test.bin`);
  assert.ok(received.expiresAt > Date.now(), 'perintah punya kedaluwarsa');
  row = await gatewayRow(hwUid);
  assert.equal(row.ota.status, 'done');
  assert.equal(row.ota.fromVersion, 'esp32-gw/0.4.0');
  assert.equal(row.firmware, NEW_VERSION);
  step('OTA: tool → gateway unduh + SHA-256 cocok → versi baru → done');

  // ═══ 4. Gagal & rollback tercatat
  const sentAt = new Date(Date.now() - 60000).toISOString();
  await backend.pool.query('UPDATE gateways SET ota = $2 WHERE id = $1', [hwUid, { id: 'ota-gagal', version: 'esp32-gw/1.0.0', status: 'sent', sentAt }]);
  await publish('ack', { type: 'ota', id: 'ota-lain', status: 'failed', reason: 'connect' });
  await publish('ack', { type: 'ota', id: 'ota-gagal', status: 'failed', reason: 'sha256_mismatch' });
  await waitFor(async () => (await gatewayRow(hwUid)).ota.status === 'failed', { label: 'ACK failed' });
  assert.equal((await gatewayRow(hwUid)).ota.reason, 'sha256_mismatch', 'ACK id lain diabaikan');

  await backend.pool.query('UPDATE gateways SET ota = $2 WHERE id = $1', [hwUid, { id: 'ota-rb', version: 'esp32-gw/1.0.0', status: 'started', sentAt }]);
  await status(4, { resetReason: 'task_wdt' });
  await waitFor(async () => (await gatewayRow(hwUid)).ota.status === 'rolled_back', { label: 'rollback' });
  assert.equal((await gatewayRow(hwUid)).ota.reason, `kembali ke ${NEW_VERSION}`);
  step('OTA gagal (ACK) dan rollback (restart dengan versi lama) tercatat');
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  device?.end(true);
  await stack.close();
  rmSync(firmwareDir, { recursive: true, force: true });
}
process.exit(exitCode);
