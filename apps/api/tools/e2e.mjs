// Uji end-to-end backend MQTT: broker uji + backend + PostgreSQL (database *_test) + simulator gateway.
// Jalankan: npm run test:e2e -w apps/api
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mqtt from 'mqtt';
import { provisionDevice } from './factory-provision.mjs';
import { createMqttGateway } from './mqtt-gateway-sim.mjs';
import { sleep, startStack, step, waitFor } from './e2e-harness.mjs';

const timings = {};
const stack = await startStack();
const { api, backend, config, telegram } = stack;
const alice = stack.openStream('alice');
const carol = stack.openStream('carol');
const { waitEvent } = alice;

const stateDir = mkdtempSync(join(tmpdir(), 'mqtt-sim-'));
let sim = null;
let exitCode = 0;
try {
  // ═══ 0. FARM: alice owner FARM-01 + kumbung; carol operator; bob farm sendiri
  assert.equal((await api('POST', '/farms', { body: { id: 'FARM-01', name: 'Farm Uji', location: 'Sidoarjo' } })).status, 201);
  const kumbung = await api('POST', '/farms/FARM-01/kumbungs', { body: { name: 'Kumbung 1', capacityBaglog: 500, status: 'active' } });
  assert.equal(kumbung.body.id, 'FARM-01-K01');
  await api('GET', '/me', { user: 'carol' });
  assert.equal((await api('POST', '/farms/FARM-01/members', { body: { email: 'carol@dev.local' } })).status, 201);
  assert.equal((await api('POST', '/farms', { user: 'bob', body: { id: 'FARM-02', name: 'Farm Bob' } })).status, 201);
  await api('POST', '/farms/FARM-02/kumbungs', { user: 'bob', body: { name: 'Kumbung Bob', capacityBaglog: 10, status: 'active' } });

  // ═══ 1. PAIRING
  const device = await provisionDevice(backend.pool, { model: 'TDR-GW1' });
  sim = createMqttGateway({ url: config.mqttUrl, hwUid: device.hwUid, deviceSecret: device.deviceSecret, stateDir, telemetryIntervalSec: 1, log: () => {} }).start();

  assert.equal((await api('GET', '/gateways', { user: null })).status, 401);
  await waitFor(async () => (await api('GET', `/devices/${device.hwUid}/preview?claimCode=${device.claimCode}`)).status === 200, { label: 'registrasi perangkat' });
  assert.equal((await api('GET', `/devices/${device.hwUid}/preview?claimCode=AAAA-AAAA`)).status, 403);
  assert.equal((await api('GET', `/devices/TDR-TIDAKADA/preview?claimCode=${device.claimCode}`)).status, 403);
  const preview = await api('GET', `/devices/${device.hwUid}/preview?claimCode=${device.claimCode.toLowerCase()}`);
  assert.equal(preview.body.capabilities.sensors.length, 2);
  assert.equal(preview.body.capabilities.actuators.length, 2);

  assert.equal((await api('POST', '/gateways/claim', { user: 'carol', body: { hwUid: device.hwUid, claimCode: device.claimCode, farmId: 'FARM-01' } })).status, 403, 'operator tidak boleh klaim');
  assert.equal((await api('POST', '/gateways/claim', { body: { hwUid: device.hwUid, claimCode: device.claimCode, farmId: 'FARM-01', kumbungId: 'FARM-02-K01' } })).body.error, 'invalid_kumbung');
  assert.equal((await api('POST', '/gateways/claim', { body: { hwUid: device.hwUid, claimCode: device.claimCode, farmId: 'FARM-02' } })).status, 404, 'farm orang lain');
  const claimStarted = Date.now();
  const claim = await api('POST', '/gateways/claim', { body: {
    hwUid: device.hwUid, claimCode: device.claimCode, farmId: 'FARM-01', kumbungId: 'FARM-01-K01', name: 'Gateway Uji',
    sensors: { S1: { name: 'Sensor Depan' } }, actuators: { A2: { name: 'Kipas Utara', kumbungId: null } },
  } });
  assert.equal(claim.status, 201);
  assert.equal(claim.body.sensors.length, 2);
  assert.equal(claim.body.actuators.length, 2);
  assert.equal(claim.body.actuators[0].kumbungId, 'FARM-01-K01');
  assert.deepEqual(claim.body.sensors.map(s => s.name), ['Sensor Depan', 'Sensor S2'], 'nama dari form klaim / nama bawaan');
  assert.deepEqual(claim.body.actuators.map(a => [a.name, a.kumbungId]), [['Sprayer A1', 'FARM-01-K01'], ['Kipas Utara', null]]);
  assert.equal((await api('PATCH', `/actuators/${device.hwUid}-A2`, { body: { kumbungId: 'FARM-01-K01' } })).body.kumbungId, 'FARM-01-K01');
  await waitEvent(e => e.event === 'config' && e.data.status === 'applied' && !e.data.gateway.pendingSync, 'ACK config klaim');
  timings.configAckAfterClaimMs = Date.now() - claimStarted;
  const S1 = `${device.hwUid}-S1`;
  const A1 = `${device.hwUid}-A1`;
  const A2 = `${device.hwUid}-A2`;

  assert.equal((await api('POST', '/gateways/claim', { user: 'bob', body: { hwUid: device.hwUid, claimCode: device.claimCode, farmId: 'FARM-02' } })).body.error, 'already_claimed');
  assert.equal((await api('GET', `/gateways/${device.hwUid}`, { user: 'bob' })).status, 404);
  assert.equal((await api('POST', `/actuators/${A1}/commands`, { user: 'bob', body: { action: 'on', durationSec: 2 } })).status, 404);
  assert.equal((await api('GET', `/gateways/${device.hwUid}`, { user: 'carol' })).status, 200, 'operator farm melihat gateway');
  assert.equal((await api('PATCH', `/sensors/${S1}`, { user: 'carol', body: { name: 'x' } })).status, 403, 'operator tidak boleh menempatkan sensor');
  assert.equal((await api('PATCH', `/gateways/${device.hwUid}`, { body: { name: 'Gateway Kumbung A' } })).body.name, 'Gateway Kumbung A');
  assert.equal((await api('PATCH', `/gateways/${device.hwUid}`, { user: 'carol', body: { name: 'x' } })).status, 403, 'operator tidak boleh ganti nama gateway');
  step(`pairing: registrasi via MQTT, pratinjau & klaim ke farm (owner), kumbung divalidasi, operator melihat tetapi tidak bisa klaim/menempatkan, farm lain ditolak; ACK config ${timings.configAckAfterClaimMs} ms`);

  // Keamanan broker: secret salah ditolak; perangkat tidak bisa publish ke topic gateway lain.
  const wrong = mqtt.connect(config.mqttUrl, { clientId: device.hwUid + 'x', username: device.hwUid, password: 'salah', reconnectPeriod: 0 });
  const wrongResult = await new Promise(resolve => { wrong.once('connect', () => resolve('connected')); wrong.once('error', error => resolve(error.message)); });
  wrong.end(true);
  assert.notEqual(wrongResult, 'connected');
  const other = await provisionDevice(backend.pool);
  const intruder = mqtt.connect(config.mqttUrl, { clientId: other.hwUid, username: other.hwUid, password: other.deviceSecret, reconnectPeriod: 0 });
  await new Promise(resolve => intruder.once('connect', resolve));
  intruder.publish(`tandurai/gw/${device.hwUid}/ack`, JSON.stringify({ type: 'command', id: '00000000-0000-0000-0000-000000000000', status: 'success' }), { qos: 1 });
  intruder.publish(`tandurai/gw/${device.hwUid}/telemetry`, JSON.stringify({ readings: { S1: { temperature: 59 } } }), { qos: 0 });
  await sleep(300);
  intruder.end(true);
  step('broker: secret salah ditolak, publish ke topic gateway lain ditolak ACL');

  // ═══ 2. TELEMETRY
  await waitEvent(e => e.event === 'telemetry' && e.data.sensorId === S1, 'telemetry SSE');
  const gateways = await api('GET', '/gateways');
  const sensor = gateways.body[0].sensors.find(s => s.id === S1);
  assert.equal(sensor.status, 'active');
  assert.ok(sensor.lastValues.humidity > 0);
  assert.notEqual(sensor.lastValues.temperature, 59, 'telemetry penyusup tidak boleh tersimpan');
  assert.equal(gateways.body[0].online, true);
  await sleep(1500);
  const { rows: [historyCount] } = await backend.pool.query('SELECT count(*)::int AS n FROM telemetry_history WHERE sensor_id = $1', [S1]);
  assert.equal(historyCount.n, 1, 'telemetry 1 dtk hanya menghasilkan 1 baris per bucket 10 menit');
  await carol.waitEvent(e => e.event === 'telemetry' && e.data.sensorId === S1, 'telemetry SSE operator');
  const kumbungRows = await api('GET', `/kumbungs/FARM-01-K01/telemetry?sensorId=${S1}`);
  assert.equal(kumbungRows.status, 200);
  assert.ok(kumbungRows.body.length >= 1 && kumbungRows.body[0].sensorId === S1 && typeof kumbungRows.body[0].timestamp === 'number');
  assert.equal((await api('GET', '/kumbungs/FARM-01-K01/telemetry', { user: 'bob' })).status, 404);
  step('telemetry: latest tersimpan, SSE realtime ke semua anggota farm, histori 1 baris per bucket 10 menit, API telemetry kumbung');

  // ═══ 2b. ALERT backend + Telegram (pengirim tiruan)
  assert.equal((await api('PUT', '/farms/FARM-01/alert-settings', { user: 'carol', body: { cooldownMinutes: 5 } })).status, 403);
  const settings = await api('PUT', '/farms/FARM-01/alert-settings', { body: { telegramEnabled: true, telegramChatId: '123456', telegramBotToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ012' } });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.hasTelegramToken, true);
  assert.equal(settings.body.telegramBotToken, undefined, 'token tidak pernah dikirim ke client');
  assert.deepEqual(settings.body.optimal.humidity, { min: 80, max: 90 }, 'rentang optimal bawaan');
  const ranged = await api('PUT', '/farms/FARM-01/alert-settings', { body: { optimal: { humidity: { min: 85, max: 95 } } } });
  assert.deepEqual([ranged.body.optimal.humidity, ranged.body.optimalIsDefault], [{ min: 85, max: 95 }, false]);
  assert.equal((await api('PUT', '/farms/FARM-01/alert-settings', { body: { optimal: { co2: { max: 1800 } } } })).status, 400, 'optimal melewati ambang peringatan');
  assert.equal((await api('PUT', '/farms/FARM-01/alert-settings', { body: { optimal: null } })).body.optimalIsDefault, true);
  sim.setEnv({ humidity: 55 });
  const humidityAlert = await waitEvent(e => e.event === 'alert' && e.data.id === `${S1}_humidity_low` && e.data.status === 'active', 'alert kelembapan');
  assert.equal(humidityAlert.data.severity, 'critical');
  assert.equal(humidityAlert.data.kumbungId, 'FARM-01-K01');
  await waitFor(() => telegram.find(item => item.text.includes('Kelembapan') && item.chatId === '123456'), { label: 'notifikasi Telegram' });
  sim.setEnv({ humidity: 85 });
  await waitEvent(e => e.event === 'alert' && e.data.id === `${S1}_humidity_low` && e.data.status === 'resolved', 'alert selesai');
  const alertList = await api('GET', '/alerts?farmId=FARM-01', { user: 'carol' });
  assert.ok(alertList.body.some(alert => alert.id === `${S1}_humidity_low` && alert.status === 'resolved'));
  assert.deepEqual((await api('GET', '/alerts', { user: 'bob' })).body, []);
  step('alert: dievaluasi backend dari telemetry (ambang farm), aktif → selesai via SSE, Telegram terkirim (pengirim tiruan), token write-only, farm lain tidak melihat');

  // ═══ 3. COMMAND ON/OFF
  assert.equal((await api('POST', `/actuators/${A1}/commands`, { body: { action: 'on', durationSec: 999 } })).status, 400);
  const sent = Date.now();
  // Operator farm mengirim command; owner menerima statusnya lewat SSE.
  const command = await api('POST', `/actuators/${A1}/commands`, { user: 'carol', body: { action: 'on', durationSec: 2 } });
  assert.equal(command.status, 202);
  assert.equal(command.body.status, 'pending');
  const ack = await waitEvent(e => e.event === 'command' && e.data.id === command.body.id && e.data.status !== 'pending', 'ACK command');
  timings.commandAckMs = ack.at - sent;
  assert.equal(ack.data.status, 'success');
  assert.ok(timings.commandAckMs < 2000, `ACK command ${timings.commandAckMs} ms ≥ 2000 ms`);
  await waitEvent(e => e.event === 'actuator' && e.data.id === A1 && e.data.state === 'on', 'state ON');
  await waitEvent(e => e.event === 'actuator' && e.data.id === A1 && e.data.state === 'off' && e.at > sent + 1500, 'state OFF otomatis', 5000);
  const ackedAt = (await api('GET', `/commands/${command.body.id}`)).body.ackedAt;
  // Redelivery ID yang sama tidak dieksekusi ulang.
  const lastOn = sim.relay('A1').lastOnAt;
  await backend.mqtt.publishJson(`tandurai/gw/${device.hwUid}/cmd`, { id: command.body.id, actuator: 'A1', action: 'on', durationSec: 2, expiresAt: Date.now() + 5000 });
  await sleep(500);
  assert.equal(sim.relay('A1').lastOnAt, lastOn);
  assert.equal((await api('GET', `/commands/${command.body.id}`)).body.ackedAt, ackedAt);
  step(`command: Pending → Success setelah ACK (${timings.commandAckMs} ms), mati otomatis 2 dtk, duplikat ID tidak dieksekusi`);

  // ═══ 4. JADWAL (berulang & jam tertentu), OVERRIDE MANUAL, OTOMATIS BATAS BAWAH/ATAS
  const timerStarted = Date.now();
  const timer = await api('PUT', `/actuators/${A2}/config`, { body: { mode: 'timer', schedules: [{ type: 'every', intervalSec: 60, onSec: 2 }] } });
  assert.equal(timer.status, 200);
  assert.equal(timer.body.pendingSync, true);
  await waitEvent(e => e.event === 'config' && e.data.gateway.actuators.find(a => a.id === A2 && !a.pendingSync && a.mode === 'timer'), 'ACK config jadwal');
  timings.configAckMs = Date.now() - timerStarted;
  assert.ok(timings.configAckMs < 5000);
  await waitEvent(e => e.event === 'actuator' && e.data.id === A2 && e.data.state === 'on' && e.data.stateSource === 'timer', 'jadwal berulang menyalakan A2');
  await waitFor(() => sim.relay('A2').state === 'off', { label: 'A2 mati setelah jadwal', timeout: 5000 });
  // Override manual saat jadwal aktif (bukan ditolak).
  const override = await api('POST', `/actuators/${A2}/commands`, { user: 'carol', body: { action: 'on', durationSec: 2 } });
  await waitEvent(e => e.event === 'command' && e.data.id === override.body.id && e.data.status === 'success', 'override manual');
  assert.equal(sim.relay('A2').override, true);
  await waitFor(() => sim.relay('A2').state === 'off' && !sim.relay('A2').override, { label: 'override selesai', timeout: 5000 });

  // Jadwal "jam tertentu" pada menit WIB saat ini dan hari ini.
  const jakarta = () => new Date(Date.now() + 7 * 3600000);
  if (jakarta().getUTCSeconds() >= 50) await sleep((61 - jakarta().getUTCSeconds()) * 1000);
  const local = jakarta();
  const at = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
  const atConfig = await api('PUT', `/actuators/${A1}/config`, { body: { mode: 'timer', schedules: [
    { type: 'at', at, onSec: 2, days: [local.getUTCDay() || 7] },
    { type: 'at', at, onSec: 2, days: [((local.getUTCDay() || 7) % 7) + 1] },
  ] } });
  assert.equal(atConfig.status, 200);
  assert.equal(atConfig.body.schedules.length, 2);
  await waitEvent(e => e.event === 'actuator' && e.data.id === A1 && e.data.state === 'on' && e.data.stateSource === 'timer', 'jadwal jam tertentu menyalakan A1', 10000);
  await waitFor(() => sim.relay('A1').state === 'off', { label: 'A1 mati setelah jadwal jam', timeout: 5000 });

  assert.equal((await api('PUT', `/actuators/${A1}/config`, { body: { mode: 'auto', rules: [{ sensorId: S1, metric: 'light', operator: 'below', threshold: 70, stop: { type: 'value', value: 80 } }] } })).status, 400);
  sim.setEnv({ humidity: 70 });
  const auto = await api('PUT', `/actuators/${A1}/config`, { body: { mode: 'auto', rules: [
    { sensorId: S1, metric: 'humidity', operator: 'below', threshold: 75, stop: { type: 'value', value: 78 }, cooldownSec: 0 },
  ] } });
  assert.equal(auto.status, 200);
  assert.equal(auto.body.schedules.length, 2, 'jadwal tersimpan saat pindah ke otomatis');
  const ruleId = auto.body.rules[0].id;
  const autoOn = await waitEvent(e => e.event === 'actuator' && e.data.id === A1 && e.data.state === 'on' && e.data.stateSource === 'auto', 'di bawah angka pemicu → A1 menyala');
  assert.deepEqual(autoOn.data.stateTrigger, { rule: ruleId }, 'gateway melaporkan aturan pemicu');
  const autoOff = await waitEvent(e => e.event === 'actuator' && e.data.id === A1 && e.data.state === 'off' && e.data.stateSource === 'auto' && e.at > autoOn.at, 'kembali ke nilai normal → A1 mati', 20000);
  assert.ok(autoOff.at - autoOn.at < 15000);
  // Aturan dengan kondisi mati berupa durasi.
  sim.setEnv({ humidity: 70 });
  await api('PUT', `/actuators/${A1}/config`, { body: { mode: 'auto', rules: [
    { sensorId: S1, metric: 'humidity', operator: 'below', threshold: 75, stop: { type: 'duration', onSec: 2 }, cooldownSec: 600 },
  ] } });
  const durOn = await waitEvent(e => e.event === 'actuator' && e.data.id === A1 && e.data.state === 'on' && e.data.stateSource === 'auto' && e.at > autoOff.at, 'aturan durasi menyalakan A1');
  const durOff = await waitEvent(e => e.event === 'actuator' && e.data.id === A1 && e.data.state === 'off' && e.at > durOn.at, 'mati setelah durasi', 6000);
  assert.ok(durOff.at - durOn.at < 4000);
  const log = (await api('GET', '/kumbungs/FARM-01-K01/actuator-log?limit=100')).body;
  assert.ok(log.some(entry => entry.kind === 'state' && entry.actuatorId === A1 && entry.source === 'auto' && entry.trigger?.rule));
  assert.ok(log.some(entry => entry.kind === 'state' && entry.source === 'manual' && entry.actorUid === 'carol'), 'perintah manual tercatat dengan pelaku');
  assert.ok(log.some(entry => entry.kind === 'config' && entry.actorUid === 'alice'));
  assert.equal((await api('GET', '/kumbungs/FARM-01-K01/actuator-log', { user: 'bob' })).status, 404);
  const estop = await api('POST', `/actuators/${A1}/commands`, { body: { action: 'estop' } });
  await waitEvent(e => e.event === 'command' && e.data.id === estop.body.id && e.data.status === 'success', 'estop');
  assert.equal(sim.relay('A1').state, 'off');
  step(`kontrol: jadwal berulang & jam tertentu (per hari) dijalankan gateway, override manual saat jadwal aktif, aturan otomatis (mati saat normal / setelah durasi) dengan pemicu dilaporkan gateway, log aktuator, ACK config ${timings.configAckMs} ms`);

  // ═══ 5. OFFLINE & RECONNECT
  await api('PUT', `/actuators/${A1}/config`, { body: { mode: 'manual' } });
  await waitFor(async () => !(await api('GET', `/gateways/${device.hwUid}`)).body.pendingSync, { label: 'config manual diterapkan' });
  sim.dropNetwork();
  await waitEvent(e => e.event === 'gateway' && e.data.online === false, 'LWT offline');
  await waitEvent(e => e.event === 'alert' && e.data.sensor === 'device_offline' && e.data.status === 'active', 'alert gateway offline');
  const offlineLastOn = sim.relay('A1').lastOnAt;
  const offlineCommand = await api('POST', `/actuators/${A1}/commands`, { body: { action: 'on', durationSec: 5 } });
  assert.equal(offlineCommand.status, 202);
  assert.equal(offlineCommand.body.gatewayOnline, false);
  const expired = await waitEvent(e => e.event === 'command' && e.data.id === offlineCommand.body.id && e.data.status === 'expired', 'command kedaluwarsa saat offline', 10000);
  assert.equal(expired.data.reason, 'gateway_offline');
  const configWhileOffline = await api('PUT', `/actuators/${A2}/config`, { body: { mode: 'timer', schedules: [{ type: 'every', intervalSec: 120, onSec: 3 }] } });
  assert.equal(configWhileOffline.body.pendingSync, true);
  sim.reconnectNetwork();
  await waitEvent(e => e.event === 'gateway' && e.data.online === true && e.at > expired.at, 'online kembali');
  await waitEvent(e => e.event === 'alert' && e.data.sensor === 'device_offline' && e.data.status === 'resolved', 'alert offline selesai');
  await waitFor(async () => {
    const gateway = (await api('GET', `/gateways/${device.hwUid}`)).body;
    return !gateway.pendingSync && gateway.actuators.find(a => a.id === A2).schedules[0].intervalSec === 120;
  }, { label: 'sinkron config setelah reconnect' });
  await sleep(500);
  assert.equal(sim.relay('A1').lastOnAt, offlineLastOn, 'command kedaluwarsa tidak boleh dieksekusi setelah reconnect');
  assert.equal((await api('GET', `/commands/${offlineCommand.body.id}`)).body.status, 'expired');
  step('offline: LWT terdeteksi (+ alert perangkat offline), command → kedaluwarsa (gateway_offline) dan tidak dieksekusi saat reconnect, config tertunda tersinkron, alert selesai saat online');

  // ═══ 6. HISTORI
  const history = await api('GET', `/sensors/${S1}/history`);
  assert.equal(history.status, 200);
  assert.ok(history.body.length >= 1 && history.body[0].values.humidity !== undefined);
  assert.equal((await api('GET', `/sensors/${S1}/history`, { user: 'bob' })).status, 404);
  step('histori: API bucket 10 menit, hanya anggota farm');

  // ═══ 6b. EXPORT PARAMETER & LAPORAN
  const download = async (path, user = 'alice') => {
    const response = await fetch(`${stack.base}${path}`, { headers: { Authorization: `Bearer dev:${user}` } });
    return { status: response.status, type: response.headers.get('content-type'), bytes: new Uint8Array(await response.arrayBuffer()) };
  };
  const csvExport = await download(`/farms/FARM-01/telemetry-export?interval=10m&kumbungIds=FARM-01-K01&format=csv`);
  const csvRows = new TextDecoder().decode(csvExport.bytes).trim().split('\r\n');
  assert.match(csvRows[0], /^Tanggal;Jam;Kumbung;Sensor;Suhu \(°C\);Kelembapan \(%\);CO₂ \(ppm\)$/);
  assert.ok(csvRows.some(line => line.includes(';Sensor Depan;')), 'baris per sensor dengan nama sensor');
  const xlsxExport = await download('/farms/FARM-01/telemetry-export?interval=1d&groupBy=kumbung&format=xlsx');
  assert.match(xlsxExport.type, /spreadsheetml/);
  assert.deepEqual([...xlsxExport.bytes.slice(0, 2)], [0x50, 0x4B], 'file xlsx (zip)');
  assert.equal((await download('/farms/FARM-01/telemetry-export', 'bob')).status, 404);
  assert.equal((await download('/farms/FARM-01/telemetry-export?from=2024-01-01&to=2026-01-01')).status, 400, 'maks 366 hari');

  const farmReport = (await api('GET', '/farms/FARM-01/report?kumbungIds=FARM-01-K01', { user: 'carol' })).body;
  const k1 = farmReport.kumbungs[0];
  assert.equal(typeof k1.parameters.humidity.avg, 'number');
  assert.ok(k1.parameters.humidity.optimalPct >= 0 && k1.parameters.humidity.optimalPct <= 100);
  assert.ok(k1.alerts.critical >= 1, 'alert kelembapan kritis tercatat dalam periode');
  assert.ok(farmReport.daily.length >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(farmReport.daily[0].date));
  assert.equal((await download('/farms/FARM-01/report-file?format=xlsx')).bytes[0], 0x50);

  const scheduleBody = { name: 'Rekap mingguan', frequency: 'weekly', weekday: 1, sendHour: 7, sections: ['parameters', 'harvest', 'activities', 'alerts'] };
  assert.equal((await api('POST', '/farms/FARM-01/report-schedules', { user: 'carol', body: scheduleBody })).status, 403, 'hanya owner');
  assert.equal((await api('POST', '/farms/FARM-01/report-schedules', { body: { ...scheduleBody, sections: [] } })).status, 400);
  assert.equal((await api('POST', '/farms/FARM-01/report-schedules', { body: { ...scheduleBody, kumbungIds: ['FARM-99-K01'] } })).status, 400, 'kumbung farm lain');
  const schedule = await api('POST', '/farms/FARM-01/report-schedules', { body: scheduleBody });
  assert.equal(schedule.status, 201);
  assert.ok(schedule.body.nextRunAt > Date.now());
  assert.equal((await api('GET', '/farms/FARM-01/report-schedules', { user: 'carol' })).body.length, 1);
  const sentBefore = telegram.length;
  const sentNow = await api('POST', `/report-schedules/${schedule.body.id}/send`);
  assert.equal(sentNow.body.lastStatus, 'sent');
  assert.ok(telegram.slice(sentBefore).some(item => item.text?.includes('Laporan Mingguan') && item.text.includes('Kumbung')), 'ringkasan teks ke Telegram');
  assert.ok(telegram.slice(sentBefore).some(item => item.document?.endsWith('.xlsx') && item.size > 500), 'lampiran Excel');
  await backend.pool.query("UPDATE report_schedules SET next_run_at = now() - interval '1 minute' WHERE id = $1", [schedule.body.id]);
  const dueBefore = telegram.length;
  assert.equal(await backend.reports.runDue(), 1);
  assert.ok(telegram.length > dueBefore, 'jadwal yang jatuh tempo terkirim');
  const afterRun = (await api('GET', '/farms/FARM-01/report-schedules')).body[0];
  assert.ok(afterRun.nextRunAt > Date.now(), 'jadwal berikutnya dimajukan');
  assert.equal(await backend.reports.runDue(), 0, 'tidak terkirim dobel');
  assert.equal((await api('PATCH', `/report-schedules/${schedule.body.id}`, { body: { enabled: false } })).body.enabled, false);
  assert.equal((await api('DELETE', `/report-schedules/${schedule.body.id}`, { user: 'carol' })).status, 403);
  assert.equal((await api('DELETE', `/report-schedules/${schedule.body.id}`)).status, 204);
  step('export & laporan: CSV/Excel parameter (per sensor/kumbung, interval), laporan farm (parameter + % optimal, alert), jadwal laporan owner, kirim Telegram + Excel, sweeper tanpa dobel');

  // ═══ 7. LEPAS KLAIM & KLAIM ULANG
  assert.equal((await api('DELETE', `/gateways/${device.hwUid}`, { user: 'carol' })).status, 403, 'operator tidak boleh melepas gateway');
  assert.equal((await api('DELETE', `/gateways/${device.hwUid}`)).status, 204);
  assert.deepEqual((await api('GET', '/gateways')).body, []);
  assert.equal((await api('GET', '/alerts?farmId=FARM-01')).body.filter(alert => alert.gatewayId === device.hwUid).length, 0);
  const audit = (await api('GET', '/farms/FARM-01/audit')).body.map(entry => entry.action);
  for (const action of ['farm_create', 'kumbung_create', 'operator_add', 'gateway_claim', 'alert_settings_update', 'gateway_unclaim']) assert.ok(audit.includes(action), `audit ${action}`);
  const reclaim = await api('POST', '/gateways/claim', { user: 'bob', body: { hwUid: device.hwUid, claimCode: device.claimCode, farmId: 'FARM-02' } });
  assert.equal(reclaim.status, 201);
  const { rows: [leftover] } = await backend.pool.query('SELECT count(*)::int AS n FROM telemetry_history WHERE sensor_id = $1 AND ts < now() - interval \'2 seconds\'', [S1]);
  assert.equal(leftover.n, 0, 'histori pemilik lama tidak terlihat oleh pemilik baru');
  step('lepas klaim: hanya owner, data & alert farm lama dihapus, tercatat di audit, perangkat dapat diklaim farm lain');

  console.log(`\nSemua skenario lulus. Latensi (simulator lokal): ACK command ${timings.commandAckMs} ms, ACK config ${timings.configAckMs} ms.`);
} catch (error) {
  exitCode = 1;
  console.error(`\n✖ ${error.stack || error.message}`);
} finally {
  alice.close();
  carol.close();
  await sim?.stop().catch(() => {});
  await stack.close();
  rmSync(stateDir, { recursive: true, force: true });
  process.exit(exitCode);
}
