// Cek integrasi satu gateway: status di database + validasi live setiap pesan MQTT terhadap kontrak
// (docs/KONTRAK_MQTT_GATEWAY.md). Untuk tim hardware saat menyambungkan firmware.
//
//   npm run device:check -w apps/api -- --hw-uid TDR-XXXX [--seconds 120]
//
// Login ke broker memakai kredensial backend (MQTT_USERNAME/MQTT_PASSWORD) dengan clientId berbeda,
// hanya membaca topic perangkat tsb. Di Mosquitto (use_username_as_clientid) pakai user pemantau
// terpisah: --username tandurai-monitor --password ... agar sesi backend tidak terputus.
import mqtt from 'mqtt';
import { pathToFileURL } from 'node:url';
import { loadEnvFile, readConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { HW_UID_PATTERN } from '../src/secrets.js';
import { cleanReadings, METRIC_LIMITS, parseCapabilities } from '../src/validate.js';

const ok = text => console.log(`  ✔ ${text}`);
const bad = text => console.log(`  ✖ ${text}`);
const info = text => console.log(`  · ${text}`);

/** Validasi satu pesan perangkat; mengembalikan daftar masalah (kosong = sesuai kontrak). */
export function checkMessage(kind, payload, { sensors = [], now = Date.now() } = {}) {
  const issues = [];
  const notes = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { issues: ['payload bukan objek JSON'], notes };
  const clock = ts => {
    const value = Number(ts);
    if (!Number.isFinite(value)) issues.push('ts tidak ada / bukan angka epoch ms');
    else if (value < 1e12) issues.push(`ts ${value} terlihat dalam detik — kirim milidetik (epoch ms)`);
    else if (Math.abs(value - now) > 5 * 60 * 1000) issues.push(`ts selisih ${Math.round((value - now) / 1000)} dtk dari waktu server — sinkronkan SNTP`);
  };
  switch (kind) {
    case 'register': {
      const caps = parseCapabilities(payload);
      notes.push(`sensor diterima: ${caps.sensors.map(item => `${item.id}(${item.metrics.join('/')})`).join(', ') || '-'}`);
      notes.push(`aktuator diterima: ${caps.actuators.map(item => `${item.id}(${item.type}, maks ${item.maxRunSec}s)`).join(', ') || '-'}`);
      if (caps.rejected.length) issues.push(`entri ditolak: ${caps.rejected.join(', ')} — cek id [A-Za-z0-9_]≤16 unik, type aktuator (sprayer/fan/humidifier/pump/light/heater/other), maxRunSec 1–86400`);
      if (typeof payload.firmware !== 'string') issues.push('firmware (string versi) tidak ada');
      break;
    }
    case 'status':
      if (payload.online === false) notes.push('offline (LWT / disconnect)');
      else {
        if (payload.online !== true) issues.push('online harus true');
        if (!Number.isInteger(payload.configVersion)) issues.push('configVersion (integer, versi config di NVS) tidak ada');
        notes.push(`firmware ${payload.firmware ?? '?'} · configVersion ${payload.configVersion ?? '?'} · uptime ${payload.uptimeSec ?? '?'}s`);
      }
      break;
    case 'telemetry': {
      clock(payload.ts);
      const readings = payload.readings;
      if (!readings || typeof readings !== 'object') { issues.push('readings tidak ada'); break; }
      for (const [localId, values] of Object.entries(readings)) {
        const sensor = sensors.find(item => item.local_id === localId);
        if (!sensor) { issues.push(`sensor ${localId} tidak terdaftar (kirim di register dulu / gateway belum diklaim)`); continue; }
        const clean = cleanReadings(values, sensor.metrics);
        const dropped = Object.keys(values || {}).filter(metric => !(metric in clean));
        notes.push(`${localId}: ${Object.entries(clean).map(([metric, value]) => `${metric}=${value}`).join(' ') || '-'}`);
        if (dropped.length) issues.push(`${localId}: dibuang ${dropped.join(', ')} (bukan metrik sensor ini atau di luar rentang)`);
        for (const metric of sensor.metrics) if (!(metric in clean) && !dropped.includes(metric)) notes.push(`${localId}: ${metric} tidak dikirim`);
      }
      break;
    }
    case 'state':
      for (const [localId, item] of Object.entries(payload.actuators || {})) {
        if (!['on', 'off', 'fault'].includes(item?.state)) issues.push(`${localId}: state harus on/off/fault`);
        if (item?.state === 'on' && !Number.isFinite(Number(item.offAt))) issues.push(`${localId}: offAt (epoch ms) wajib saat on`);
        notes.push(`${localId}: ${item?.state} (${item?.source ?? '?'})${item?.trigger ? ` pemicu ${JSON.stringify(item.trigger)}` : ''}`);
      }
      if (!payload.actuators) issues.push('actuators tidak ada');
      break;
    case 'ack':
      if (payload.type === 'command') {
        if (typeof payload.id !== 'string') issues.push('id command tidak ada');
        if (!['success', 'failed', 'rejected', 'expired'].includes(payload.status)) issues.push('status harus success/failed/rejected/expired');
        notes.push(`command ${payload.id} → ${payload.status}${payload.reason ? ` (${payload.reason})` : ''}`);
      } else if (payload.type === 'config') {
        if (!Number.isInteger(payload.version)) issues.push('version (integer) tidak ada');
        if (!['applied', 'rejected'].includes(payload.status)) issues.push('status harus applied/rejected');
        notes.push(`config v${payload.version} → ${payload.status}`);
      } else issues.push('type harus command atau config');
      break;
    default:
      issues.push(`topic ${kind} tidak dikenal`);
  }
  return { issues, notes };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    options[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return options;
}

async function main() {
  loadEnvFile();
  const options = parseArgs(process.argv.slice(2));
  const hwUid = options['hw-uid'];
  if (!HW_UID_PATTERN.test(hwUid || '')) throw new Error('Pakai: npm run device:check -w apps/api -- --hw-uid <hwUid> [--seconds 120]');
  const config = readConfig();
  const pool = createPool(config.databaseUrl);
  const seconds = Number(options.seconds) || 120;

  console.log(`\n■ Database (${hwUid})`);
  const { rows: [device] } = await pool.query('SELECT model, created_at FROM devices WHERE hw_uid = $1', [hwUid]);
  if (!device) {
    bad('belum terdaftar di registry pabrik — jalankan: npm run factory -w apps/api');
    await pool.end();
    process.exitCode = 1;
    return;
  }
  ok(`terdaftar (model ${device.model})`);
  const { rows: [gateway] } = await pool.query('SELECT * FROM gateways WHERE id = $1', [hwUid]);
  if (!gateway?.registered_at) bad('belum pernah mengirim register — perangkat belum login ke broker/publish register');
  else {
    ok(`register terakhir ${gateway.registered_at.toISOString()} · firmware ${gateway.firmware ?? '?'}`);
    (gateway.online ? ok : bad)(`status ${gateway.online ? 'online' : 'offline'} · aktivitas terakhir ${gateway.last_seen_at?.toISOString() ?? '-'}`);
    if (gateway.claimed_by) ok(`diklaim ke farm ${gateway.farm_id} · config v${gateway.applied_config_version}/${gateway.config_version} diterapkan`);
    else info('belum diklaim — klaim dari dashboard (Devices → Tambah gateway) agar telemetry disimpan');
  }
  const { rows: sensors } = await pool.query('SELECT local_id, type, metrics, kumbung_id, last_values, last_ts FROM sensors WHERE gateway_id = $1 ORDER BY local_id', [hwUid]);
  for (const sensor of sensors) info(`sensor ${sensor.local_id} (${sensor.type}: ${sensor.metrics.join('/')}) kumbung ${sensor.kumbung_id ?? '-'} · terakhir ${sensor.last_ts?.toISOString() ?? '-'} ${JSON.stringify(sensor.last_values ?? {})}`);
  const { rows: actuators } = await pool.query('SELECT local_id, type, mode, state, max_run_sec FROM actuators WHERE gateway_id = $1 ORDER BY local_id', [hwUid]);
  for (const actuator of actuators) info(`aktuator ${actuator.local_id} (${actuator.type}, maks ${actuator.max_run_sec}s) mode ${actuator.mode} · ${actuator.state}`);

  console.log(`\n■ MQTT live ${seconds} dtk (${config.mqttUrl}) — nyalakan/restart gateway untuk melihat register`);
  const client = mqtt.connect(config.mqttUrl, {
    clientId: `tandurai-check-${process.pid}`,
    username: options.username || config.mqttUsername,
    password: options.password || config.mqttPassword,
    reconnectPeriod: 0,
  });
  const totals = { messages: 0, issues: 0 };
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  });
  client.subscribe(['register', 'status', 'telemetry', 'state', 'ack'].map(kind => `tandurai/gw/${hwUid}/${kind}`), { qos: 1 });
  client.on('message', (topic, buffer, packet) => {
    const kind = topic.split('/')[3];
    let payload;
    try { payload = JSON.parse(buffer.toString('utf8')); } catch { payload = null; }
    totals.messages += 1;
    console.log(`\n${new Date().toLocaleTimeString('id-ID')} ${kind}${packet.retain ? ' (retained)' : ''}`);
    if (payload === null) { bad('bukan JSON valid'); totals.issues += 1; return; }
    const { issues, notes } = checkMessage(kind, payload, { sensors });
    notes.forEach(info);
    issues.forEach(bad);
    if (!issues.length) ok('sesuai kontrak');
    totals.issues += issues.length;
  });
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  client.end(true);
  await pool.end();
  console.log(`\n■ Ringkasan: ${totals.messages} pesan, ${totals.issues} masalah${totals.messages ? '' : ' — tidak ada pesan: cek Wi-Fi, host/port broker, username = clientId = hwUid, device secret'}`);
  process.exitCode = totals.issues ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    console.error('[device-check] gagal:', error.message);
    process.exit(1);
  });
}
