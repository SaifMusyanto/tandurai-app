// Kirim update firmware (OTA) ke gateway lalu pantau hasilnya.
//
//   node apps/api/tools/ota.mjs --file tandurai-gw-0.4.1.bin --hw-uid TDR-XXXXXXXXXXXX[,TDR-…]
//   node apps/api/tools/ota.mjs --file tandurai-gw-0.4.1.bin --all          # semua gateway online versi lain
//
// File .bin diletakkan di FIRMWARE_DIR (bawaan apps/api/firmware; di Docker: deploy/firmware/), lalu
// disajikan publik di <base-url>/firmware/<file>. Versi dibaca otomatis dari isi file ("esp32-gw/x.y.z").
// Opsi: --version <v> (timpa), --base-url https://dashboard.tandurai.id/api (bawaan: CORS_ORIGINS pertama + /api),
//       --wait <detik> (bawaan 300), --dry-run, --skip-check (lewati cek URL dari server).
// Login MQTT memakai kredensial backend dengan clientId berbeda, jadi sesi backend tidak terputus.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import mqtt from 'mqtt';
import { loadEnvFile, readConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { HW_UID_PATTERN } from '../src/secrets.js';

const OTA_PARTITION_BYTES = 0x1E0000;   // app0/app1 skema "Minimal SPIFFS (1.9MB APP with OTA)"
const COMMAND_TTL_MS = 10 * 60 * 1000;
const FINAL = new Set(['done', 'failed', 'rejected', 'rolled_back']);

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    options[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return options;
}

const fail = message => { console.error(`✖ ${message}`); process.exit(1); };

async function main() {
  loadEnvFile();
  const config = readConfig();
  const options = parseArgs(process.argv.slice(2));
  if (!options.file || (!options['hw-uid'] && !options.all)) {
    fail('Pakai: --file <nama.bin> (--hw-uid TDR-…[,TDR-…] | --all) [--version v] [--base-url url] [--wait dtk] [--dry-run]');
  }

  const path = isAbsolute(options.file) || options.file.includes('/') ? options.file : join(config.firmwareDir, options.file);
  if (!existsSync(path)) fail(`File tidak ditemukan: ${path} (letakkan di ${config.firmwareDir})`);
  const file = basename(path);
  if (!/^[A-Za-z0-9._-]+\.bin$/.test(file)) fail('Nama file hanya huruf, angka, titik, minus, garis bawah, dan berakhiran .bin');
  if (!existsSync(join(config.firmwareDir, file))) fail(`File harus berada di ${config.firmwareDir} agar bisa diunduh gateway`);
  const binary = readFileSync(path);
  if (binary[0] !== 0xE9) fail('Bukan file aplikasi ESP32 (byte pertama bukan 0xE9). Pakai <sketch>.ino.bin, bukan .merged.bin');
  if (binary.length > OTA_PARTITION_BYTES) fail(`Ukuran ${binary.length} byte melebihi partisi OTA ${OTA_PARTITION_BYTES} byte`);
  const version = options.version || binary.toString('latin1').match(/esp32-gw\/[0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9.+-]*/)?.[0];
  if (!version) fail('Versi tidak terbaca dari file; isi --version');
  const sha256 = createHash('sha256').update(binary).digest('hex');
  const baseUrl = String(options['base-url'] || `${config.corsOrigins[0]}/api`).replace(/\/+$/, '');
  const url = `${baseUrl}/firmware/${file}`;
  console.log(`■ ${file} · ${version} · ${binary.length} byte · sha256 ${sha256.slice(0, 16)}…\n  ${url}`);

  if (!options['skip-check']) {
    const head = await fetch(url, { method: 'HEAD' }).catch(error => ({ ok: false, status: error.message }));
    if (!head.ok) fail(`URL tidak bisa diunduh (${head.status}). Cek --base-url / reverse proxy, atau --skip-check`);
    if (Number(head.headers.get('content-length')) !== binary.length) fail('Ukuran dari URL berbeda dengan file lokal (cache/proxy?)');
  }

  const pool = createPool(config.databaseUrl);
  const ids = options.all ? null : String(options['hw-uid']).split(',').map(item => item.trim().toUpperCase());
  if (ids && ids.some(id => !HW_UID_PATTERN.test(id))) fail('Format hwUid tidak valid');
  const { rows: targets } = await pool.query(
    ids
      ? 'SELECT id, firmware, online FROM gateways WHERE id = ANY($1) ORDER BY id'
      : `SELECT id, firmware, online FROM gateways WHERE online AND firmware LIKE 'esp32-gw/%' AND firmware <> $1 ORDER BY id`,
    [ids || version],
  );
  if (ids) for (const id of ids.filter(id => !targets.some(row => row.id === id))) console.log(`  ✖ ${id}: belum pernah tersambung ke server ini`);
  if (!targets.length) { await pool.end(); fail('Tidak ada gateway tujuan'); }
  for (const row of targets) console.log(`  · ${row.id} ${row.firmware || '-'} → ${version}${row.online ? '' : ' (OFFLINE: perintah kedaluwarsa 10 menit)'}`);
  if (options['dry-run']) { await pool.end(); return console.log('Dry run: tidak ada yang dikirim.'); }

  const client = mqtt.connect(config.mqttUrl, {
    clientId: `tandurai-ota-${process.pid}`, username: config.mqttUsername, password: config.mqttPassword, reconnectPeriod: 0,
  });
  await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
  for (const row of targets) {
    const id = randomUUID();
    const sentAt = new Date().toISOString();
    await pool.query('UPDATE gateways SET ota = $2 WHERE id = $1', [row.id, {
      id, version, fromVersion: row.firmware, url, status: 'sent', reason: null, sentAt, updatedAt: sentAt,
    }]);
    const command = { id, action: 'ota', url, sha256, size: binary.length, version, expiresAt: Date.now() + COMMAND_TTL_MS };
    await client.publishAsync(`tandurai/gw/${row.id}/cmd`, JSON.stringify(command), { qos: 1 });
  }
  await client.endAsync();
  console.log(`\n■ Terkirim ke ${targets.length} gateway. Memantau ${Number(options.wait) || 300} dtk (Ctrl+C aman; status tetap tercatat di dashboard).`);

  const deadline = Date.now() + (Number(options.wait) || 300) * 1000;
  const last = new Map();
  while (Date.now() < deadline) {
    const { rows } = await pool.query("SELECT id, firmware, ota FROM gateways WHERE id = ANY($1) AND ota->>'version' = $2", [targets.map(row => row.id), version]);
    for (const row of rows) {
      const key = `${row.ota.status}|${row.ota.reason ?? ''}`;
      if (last.get(row.id) === key) continue;
      last.set(row.id, key);
      const mark = row.ota.status === 'done' ? '✔' : FINAL.has(row.ota.status) ? '✖' : '…';
      console.log(`  ${mark} ${row.id}: ${row.ota.status}${row.ota.reason ? ` (${row.ota.reason})` : ''} · firmware ${row.firmware}`);
    }
    if (rows.length === targets.length && rows.every(row => FINAL.has(row.ota.status))) break;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  await pool.end();
}

main().catch(error => fail(error.message));
