// Simulator gateway ESP32 di komputer. Meniru firmware: hanya REST (Firebase Auth
// Anonymous + RTDB), tanpa Firebase SDK, Admin SDK, service account, atau server.
// Rancangan: docs/task/simulasi-gateway-esp32-firebase.md
//
//   npm run simulate:gateway provision GW-01                     # bentuk posisi, aman di PowerShell
//   node tools/gateway-simulator.mjs provision --gateway GW-01   # sign up anonim, tampilkan UID untuk pairing
//   node tools/gateway-simulator.mjs run --gateway GW-01 [--once] [--interval 10]
//   node tools/gateway-simulator.mjs status --gateway GW-01
//   npm run simulate:gateway backfill GW-01 48                    # data dummy: history 48 jam ke belakang
//   node tools/gateway-simulator.mjs reset --gateway GW-01       # hapus "NVS" (perlu pairing ulang)
//
// Mode emulator aktif otomatis bila FIREBASE_AUTH_EMULATOR_HOST dan
// FIREBASE_DATABASE_EMULATOR_HOST tersedia (mis. lewat `firebase emulators:exec`).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildTelemetryPayload,
  historyBucketStart,
  historyEntryId,
  jakartaDateKey,
} from '../apps/web/src/lib/telemetry.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STATE_DIR = join(ROOT, '.gateway-sim');
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const CONFIG_POLL_MS = 30 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const OUTBOX_LIMIT = 500;

export class PermissionDeniedError extends Error {}
export class NetworkError extends Error {}
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
}

export function resolveEndpoints(env = process.env) {
  const authHost = env.FIREBASE_AUTH_EMULATOR_HOST;
  const dbHost = env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (authHost || dbHost) {
    if (!authHost || !dbHost) {
      throw new Error('Mode emulator membutuhkan FIREBASE_AUTH_EMULATOR_HOST dan FIREBASE_DATABASE_EMULATOR_HOST.');
    }
    const projectId = env.GCLOUD_PROJECT || env.FIREBASE_PROJECT_ID || 'tandurai-ai';
    return {
      emulator: true,
      apiKey: 'emulator-api-key',
      authBase: `http://${authHost}/identitytoolkit.googleapis.com/v1`,
      tokenBase: `http://${authHost}/securetoken.googleapis.com/v1`,
      dbBase: `http://${dbHost}`,
      dbParams: { ns: env.FIREBASE_DATABASE_NAMESPACE || `${projectId}-default-rtdb` },
    };
  }
  const fileEnv = readEnvFile(join(ROOT, 'apps/web/.env'));
  const apiKey = env.FIREBASE_API_KEY || fileEnv.VITE_FIREBASE_API_KEY;
  const databaseUrl = env.FIREBASE_DATABASE_URL || fileEnv.VITE_FIREBASE_DATABASE_URL;
  if (!apiKey || !databaseUrl) {
    throw new Error('Atur FIREBASE_API_KEY dan FIREBASE_DATABASE_URL (atau apps/web/.env).');
  }
  return {
    emulator: false,
    apiKey,
    authBase: 'https://identitytoolkit.googleapis.com/v1',
    tokenBase: 'https://securetoken.googleapis.com/v1',
    dbBase: databaseUrl.replace(/\/+$/, ''),
    dbParams: {},
  };
}

/** Sensor tiruan; ganti dengan adapter bus nyata setelah protokol hardware diputuskan. */
export function createMockSensorAdapter({ failing = [] } = {}) {
  const failingSet = new Set(failing);
  const profiles = [
    { temperature: [27.5, 28.0], humidity: [81, 83], co2: [650, 700] },
    { temperature: [28.0, 28.5], humidity: [79, 82], co2: [680, 730] },
  ];
  const between = ([min, max], decimals) => Number((min + Math.random() * (max - min)).toFixed(decimals));
  const profileFor = sensorId => profiles[[...sensorId].reduce((sum, c) => sum + c.charCodeAt(0), 0) % profiles.length];
  return {
    probe: ({ sensorId }) => !failingSet.has(sensorId),
    read: ({ sensorId }, at = Date.now()) => {
      if (failingSet.has(sensorId)) return null;
      const profile = profileFor(sensorId);
      // Pola harian (WIB): siang lebih hangat dan kering, malam lebih lembap.
      const hour = (new Date(at).getUTCHours() + 7) % 24;
      const daily = Math.sin(((hour - 8) / 24) * 2 * Math.PI);
      return {
        temperature: Number((between(profile.temperature, 2) + daily * 1.2).toFixed(1)),
        humidity: Number(Math.min(100, between(profile.humidity, 2) - daily * 3).toFixed(1)),
        co2: Math.round(between(profile.co2, 0) + daily * 25),
        pressure: between([1007, 1009], 1),
      };
    },
  };
}

export function createGatewaySimulator({
  gatewayId,
  endpoints = resolveEndpoints(),
  stateDir = DEFAULT_STATE_DIR,
  firmwareVersion = 'esp32-gateway-sim/0.3.0',
  adapter = createMockSensorAdapter(),
  log = message => console.log(`[${gatewayId}] ${message}`),
  now = () => Date.now(),
  fetchImpl = (...args) => fetch(...args),
}) {
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(gatewayId || '')) throw new Error('gatewayId tidak valid.');
  const statePath = join(stateDir, `${gatewayId}.json`);

  // "NVS": UID dan refresh token. ID token hanya di RAM. Token tidak pernah dicetak.
  let nvs = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  let idToken = null;
  let idTokenExpiresAt = 0;
  let paired = false;
  let config = null;
  let appliedConfigVersion = null;
  let lastConfigPollAt = 0;
  let lastHeartbeatAt = 0;
  let ackPending = false;
  let activeSensorIds = new Set(); // sensor enabled + status active setelah config diterapkan
  // Kontrak ack per sensor (tumbara/gatewayAcks/{gatewayId}): ok | not_found | read_error.
  let sensorStates = {};
  let reportDirty = false;
  const outbox = [];

  function saveNvs(next) {
    mkdirSync(stateDir, { recursive: true });
    const tmp = `${statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2));
    renameSync(tmp, statePath); // atomik: refresh token lama tidak hilang bila proses mati
    nvs = next;
  }

  async function request(url, options) {
    try {
      return await fetchImpl(url, options);
    } catch (error) {
      throw new NetworkError(`Jaringan gagal: ${error.message}`);
    }
  }

  async function postJson(url, body, contentType = 'application/json') {
    const response = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: contentType === 'application/json' ? JSON.stringify(body) : new URLSearchParams(body).toString(),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new HttpError(response.status, json?.error?.message || `HTTP ${response.status}`);
    return json;
  }

  async function provision() {
    if (nvs?.refreshToken) {
      log(`Sudah ter-provision. UID: ${nvs.uid}`);
      return nvs.uid;
    }
    const result = await postJson(`${endpoints.authBase}/accounts:signUp?key=${endpoints.apiKey}`, { returnSecureToken: true });
    saveNvs({ gatewayId, uid: result.localId, refreshToken: result.refreshToken, provisionedAt: now() });
    idToken = result.idToken;
    idTokenExpiresAt = now() + Number(result.expiresIn) * 1000;
    log(`Anonymous Auth berhasil. Pasangkan UID ini ke ${gatewayId} dari aplikasi owner: ${result.localId}`);
    return result.localId;
  }

  async function refreshIdToken() {
    if (!nvs?.refreshToken) throw new Error('Belum ter-provision. Jalankan perintah provision.');
    const result = await postJson(
      `${endpoints.tokenBase}/token?key=${endpoints.apiKey}`,
      { grant_type: 'refresh_token', refresh_token: nvs.refreshToken },
      'application/x-www-form-urlencoded',
    );
    if (result.user_id && result.user_id !== nvs.uid) throw new Error('UID dari refresh token tidak cocok dengan NVS.');
    if (result.refresh_token !== nvs.refreshToken) saveNvs({ ...nvs, refreshToken: result.refresh_token });
    idToken = result.id_token;
    idTokenExpiresAt = now() + Number(result.expires_in) * 1000;
  }

  async function ensureToken() {
    if (!idToken || idTokenExpiresAt - now() < TOKEN_REFRESH_MARGIN_MS) await refreshIdToken();
  }

  async function rtdb(method, path, body, retried = false) {
    await ensureToken();
    const params = new URLSearchParams({ ...endpoints.dbParams, auth: idToken });
    const response = await request(`${endpoints.dbBase}/${path}.json?${params}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401) {
      // RTDB REST memakai 401 untuk token kedaluwarsa dan permission denied: refresh sekali.
      if (!retried) {
        idToken = null;
        return rtdb(method, path, body, true);
      }
      throw new PermissionDeniedError(`${method} ${path} ditolak Rules`);
    }
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new HttpError(response.status, json?.error || `HTTP ${response.status}`);
    return json;
  }

  async function isPaired() {
    return (await rtdb('GET', `tumbara/gatewayAuthUids/${nvs.uid}`)) === gatewayId;
  }

  function validateConfig(next, gateway) {
    if (!next || typeof next.farmId !== 'string') throw new Error('Config tanpa farmId.');
    if (next.farmId !== gateway?.farmId) throw new Error('farmId config tidak cocok dengan registry gateway.');
    if (!Number.isInteger(next.configVersion) || next.configVersion < 0) throw new Error('configVersion tidak valid.');
    if (config && next.configVersion < config.configVersion) throw new Error('configVersion mundur; config diabaikan.');
    for (const [sensorId, entry] of Object.entries(next.sensors || {})) {
      if (typeof entry?.kumbungId !== 'string' || typeof entry.enabled !== 'boolean') {
        throw new Error(`Assignment sensor ${sensorId} tidak lengkap.`);
      }
    }
    return next;
  }

  async function pollConfig() {
    const [next, gateway] = await Promise.all([
      rtdb('GET', `tumbara/gatewayConfigs/${gatewayId}`),
      rtdb('GET', `tumbara/gateways/${gatewayId}`),
    ]);
    lastConfigPollAt = now();
    config = validateConfig(next, gateway);
    appliedConfigVersion ??= gateway.appliedConfigVersion ?? null;
    return config;
  }

  function enabledSensors() {
    return Object.entries(config?.sensors || {})
      .filter(([, entry]) => entry.enabled)
      .map(([sensorId, entry]) => ({ sensorId, ...entry }));
  }

  function setSensorState(sensorId, next) {
    const previous = sensorStates[sensorId];
    if (previous?.state !== next.state || (previous?.error ?? null) !== (next.error ?? null)) reportDirty = true;
    sensorStates[sensorId] = { ...previous, ...next };
  }

  /** Terapkan config idempoten: probe setiap sensor, aktifkan yang menjawab, catat ack per sensor. */
  async function applyConfig() {
    const nextStates = {};
    const nextActive = new Set();
    for (const sensor of enabledSensors()) {
      const base = { hardwareAddress: sensor.hardwareAddress || null, lastReadAt: sensorStates[sensor.sensorId]?.lastReadAt || null };
      if (!adapter.probe(sensor)) {
        nextStates[sensor.sensorId] = { ...base, state: 'not_found', error: 'Sensor tidak menjawab saat probe' };
        continue;
      }
      nextStates[sensor.sensorId] = { ...base, state: 'ok', error: null };
      const status = await rtdb('GET', `tumbara/sensors/${sensor.sensorId}/status`);
      if (status === 'pending') await rtdb('PUT', `tumbara/sensors/${sensor.sensorId}/status`, 'active');
      if (status === 'pending' || status === 'active') nextActive.add(sensor.sensorId);
    }
    sensorStates = nextStates; // sensor yang dilepas dari config hilang dari laporan
    activeSensorIds = nextActive;
    reportDirty = true;
    const failures = Object.entries(nextStates).filter(([, entry]) => entry.state !== 'ok').map(([id]) => id);
    if (failures.length) {
      // Versi penuh hanya diakui bila semua sensor menjawab; detail ada di laporan ack per sensor.
      log(`Config v${config.configVersion} belum diakui penuh; sensor bermasalah: ${failures.join(', ')}`);
      return false;
    }
    appliedConfigVersion = config.configVersion;
    ackPending = true;
    log(`Config v${config.configVersion} diterapkan (${nextActive.size} sensor aktif).`);
    return true;
  }

  async function heartbeat() {
    const body = { status: 'online', lastSeenAt: now(), firmwareVersion };
    if (appliedConfigVersion !== null) body.appliedConfigVersion = appliedConfigVersion;
    await rtdb('PATCH', `tumbara/gateways/${gatewayId}`, body);
    lastHeartbeatAt = now();
    ackPending = false;
  }

  async function writeReport() {
    const sensors = Object.fromEntries(Object.entries(sensorStates).map(([sensorId, entry]) => [
      sensorId,
      Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== null && value !== undefined)),
    ]));
    await rtdb('PUT', `tumbara/gatewayAcks/${gatewayId}`, {
      configVersion: config.configVersion,
      reportedAt: now(),
      ...(Object.keys(sensors).length ? { sensors } : {}),
    });
    reportDirty = false;
  }

  /** Baca sensor lokal (tanpa jaringan); history masuk outbox sebelum upload. */
  function readSensors() {
    const readings = [];
    for (const sensor of enabledSensors()) {
      if (!activeSensorIds.has(sensor.sensorId)) continue;
      const reading = adapter.read(sensor);
      if (!reading) {
        setSensorState(sensor.sensorId, { state: 'read_error', error: 'Pembacaan gagal' });
        log(`Sensor ${sensor.sensorId} tidak terbaca; latest tidak diperbarui.`);
        continue;
      }
      const timestamp = now();
      setSensorState(sensor.sensorId, { state: 'ok', error: null, lastReadAt: timestamp });
      const payload = {
        ...buildTelemetryPayload({ farmId: config.farmId, kumbungId: sensor.kumbungId, sensorId: sensor.sensorId, timestamp, ...reading }),
        gatewayId,
      };
      const path = `tumbara/history/${sensor.kumbungId}/${jakartaDateKey(timestamp)}/${historyEntryId(sensor.sensorId, timestamp)}`;
      if (outbox.length >= OUTBOX_LIMIT) outbox.shift();
      outbox.push({ path, record: { ...payload, bucketStart: historyBucketStart(timestamp) } });
      readings.push({ sensor, payload });
    }
    return readings;
  }

  async function uploadLatest(readings) {
    const uploaded = [];
    for (const { sensor, payload } of readings) {
      try {
        await rtdb('PUT', `tumbara/monitoring/${sensor.kumbungId}/${sensor.sensorId}`, payload);
        uploaded.push(sensor.sensorId);
      } catch (error) {
        if (!(error instanceof PermissionDeniedError)) throw error;
        // Assignment berubah sejak config terakhir: muat ulang config pada siklus berikutnya.
        log(`Latest ${sensor.sensorId} ditolak; assignment kemungkinan berubah.`);
        lastConfigPollAt = 0;
      }
    }
    return uploaded;
  }

  async function flushOutbox() {
    let dropped = 0;
    while (outbox.length) {
      const { path, record } = outbox[0];
      try {
        // Respons PUT bisa hilang: cek dulu apakah record (key deterministik) sudah tersimpan.
        const existing = await rtdb('GET', path);
        if (!existing) await rtdb('PUT', path, record);
      } catch (error) {
        if (!(error instanceof PermissionDeniedError)) throw error;
        // Record antrean untuk sensor yang sudah dipindah/nonaktif ditolak Rules: buang agar
        // antrean tidak macet. Assignment baru berlaku untuk pembacaan berikutnya saja.
        dropped += 1;
        lastConfigPollAt = 0;
      }
      outbox.shift();
    }
    if (dropped) log(`${dropped} record antrean dibuang karena ditolak Rules (assignment berubah).`);
    return dropped;
  }

  /**
   * Data dummy untuk demo: isi history sensor aktif `hours` jam ke belakang, satu record per
   * bucket 10 menit, lewat jalur gateway yang sama (divalidasi Rules). Record yang sudah ada dilewati.
   */
  async function backfill({ hours = 48, concurrency = 8 } = {}) {
    if (!nvs?.refreshToken) throw new Error('Belum ter-provision. Jalankan perintah provision.');
    await ensureToken();
    if (!(await isPaired())) throw new Error(`UID ${nvs.uid} belum dipasangkan ke ${gatewayId}.`);
    await pollConfig();
    await applyConfig();
    const bucketMs = 10 * 60 * 1000;
    const endBucket = historyBucketStart(now()) - bucketMs;
    const startBucket = endBucket - Math.round(hours * 60) * 60 * 1000;
    const jobs = [];
    for (const sensor of enabledSensors()) {
      if (!activeSensorIds.has(sensor.sensorId)) continue;
      for (let bucket = startBucket + bucketMs; bucket <= endBucket; bucket += bucketMs) {
        const timestamp = bucket + Math.floor(Math.random() * (bucketMs - 1000));
        const reading = adapter.read(sensor, timestamp);
        if (!reading) continue;
        const payload = {
          ...buildTelemetryPayload({ farmId: config.farmId, kumbungId: sensor.kumbungId, sensorId: sensor.sensorId, timestamp, ...reading }),
          gatewayId,
          bucketStart: bucket,
        };
        jobs.push({ path: `tumbara/history/${sensor.kumbungId}/${jakartaDateKey(timestamp)}/${historyEntryId(sensor.sensorId, timestamp)}`, payload });
      }
    }
    let written = 0;
    let skipped = 0;
    for (let index = 0; index < jobs.length; index += concurrency) {
      await Promise.all(jobs.slice(index, index + concurrency).map(async ({ path, payload }) => {
        if (await rtdb('GET', path)) { skipped += 1; return; }
        await rtdb('PUT', path, payload);
        written += 1;
      }));
    }
    log(`Backfill ${hours} jam: ${written} record ditulis, ${skipped} sudah ada (${activeSensorIds.size} sensor).`);
    return { written, skipped, sensors: [...activeSensorIds] };
  }

  async function deniedResult(error) {
    paired = await isPaired().catch(() => false);
    if (!paired) return { state: 'unpaired', uid: nvs.uid };
    log('Akses ditolak: gateway dicabut, inactive, atau assignment tidak cocok. Hubungi owner.');
    return { state: 'denied', reason: error.message };
  }

  /**
   * Satu iterasi loop firmware. Sensor tetap dibaca saat jaringan putus; history disimpan di
   * outbox dan dikirim ulang (idempoten) setelah tersambung. Mengembalikan ringkasan untuk log/test.
   */
  async function cycle() {
    if (!nvs?.refreshToken) return { state: 'unprovisioned' };
    let offline = false;
    try {
      await ensureToken();
      const configDue = !config || now() - lastConfigPollAt >= CONFIG_POLL_MS;
      if (!paired || configDue) {
        paired = await isPaired();
        if (!paired) {
          log(`Menunggu owner memasangkan UID ${nvs.uid} ke ${gatewayId}.`);
          return { state: 'unpaired', uid: nvs.uid };
        }
      }
      const previousVersion = config?.configVersion;
      if (configDue) await pollConfig();
      if (config.configVersion !== previousVersion || appliedConfigVersion !== config.configVersion) await applyConfig();
      if (ackPending || now() - lastHeartbeatAt >= HEARTBEAT_MS) {
        await heartbeat();
        reportDirty = true; // segarkan lastReadAt di laporan seiring heartbeat
      }
    } catch (error) {
      if (error instanceof NetworkError && config) offline = true;
      else if (error instanceof PermissionDeniedError) return deniedResult(error);
      else throw error;
    }

    const readings = config ? readSensors() : [];
    let uploaded = [];
    let dropped = 0;
    if (!offline) {
      try {
        uploaded = await uploadLatest(readings);
        // Semua upload ditolak: periksa apakah gateway masih terpasang (dicabut/dilepas owner).
        if (readings.length && !uploaded.length) return deniedResult(new PermissionDeniedError('Semua upload latest ditolak Rules'));
        dropped = await flushOutbox();
        if (reportDirty) await writeReport();
      } catch (error) {
        if (error instanceof NetworkError) offline = true;
        else if (error instanceof PermissionDeniedError) return deniedResult(error);
        else throw error;
      }
    }
    if (offline) log(`Jaringan putus; ${outbox.length} record history menunggu di antrean.`);
    return {
      state: offline ? 'offline' : 'online',
      configVersion: config?.configVersion ?? null,
      appliedConfigVersion,
      uploaded,
      dropped,
      outbox: outbox.length,
      sensors: sensorStates,
    };
  }

  async function run({ intervalMs = 10000, once = false } = {}) {
    let backoffMs = 1000;
    for (;;) {
      try {
        const result = await cycle();
        if (once) return result;
        backoffMs = 1000;
        const wait = result.state === 'online' ? intervalMs : Math.max(intervalMs, 30000);
        await new Promise(resolveWait => setTimeout(resolveWait, wait));
      } catch (error) {
        if (once) throw error;
        const jitter = Math.random() * backoffMs * 0.3;
        log(`Error: ${error.message}. Coba lagi dalam ${Math.round((backoffMs + jitter) / 1000)} detik.`);
        await new Promise(resolveWait => setTimeout(resolveWait, backoffMs + jitter));
        backoffMs = Math.min(backoffMs * 2, 60000);
      }
    }
  }

  async function status() {
    if (!nvs?.refreshToken) return { state: 'unprovisioned' };
    return { state: (await isPaired()) ? 'paired' : 'unpaired', uid: nvs.uid };
  }

  function reset() {
    rmSync(statePath, { force: true });
    nvs = null;
    idToken = null;
    log('NVS dihapus. Minta owner melepas UID lama, lalu provision ulang.');
  }

  return {
    provision,
    cycle,
    run,
    status,
    backfill,
    reset,
    get uid() { return nvs?.uid ?? null; },
    get outboxSize() { return outbox.length; },
    get outboxPaths() { return outbox.map(item => item.path); },
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, positional: [] };
  for (let i = 0; i < rest.length; i += 1) {
    if (!rest[i].startsWith('--')) {
      options.positional.push(rest[i]);
      continue;
    }
    const key = rest[i].replace(/^--/, '');
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) options[key] = true;
    else options[key] = rest[++i];
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  // PowerShell membuang `--` sehingga npm menelan flag `--gateway`; ID boleh diberikan sebagai argumen posisi.
  const [positionalGateway, ...positionalFlags] = options.positional;
  const gatewayId = options.gateway || positionalGateway || process.env.GATEWAY_ID;
  if (positionalFlags.includes('once')) options.once = true;
  const simulator = createGatewaySimulator({
    gatewayId,
    adapter: createMockSensorAdapter({ failing: (options.fail || process.env.SIM_FAIL_SENSORS || '').split(',').filter(Boolean) }),
  });
  switch (options.command) {
    case 'provision':
      await simulator.provision();
      break;
    case 'run':
      console.log(JSON.stringify(await simulator.run({ once: Boolean(options.once), intervalMs: Number(options.interval || 10) * 1000 }), null, 2));
      break;
    case 'backfill':
      console.log(JSON.stringify(await simulator.backfill({ hours: Number(options.hours || positionalFlags[0] || 48) }), null, 2));
      break;
    case 'status':
      console.log(JSON.stringify(await simulator.status(), null, 2));
      break;
    case 'reset':
      simulator.reset();
      break;
    default:
      console.log('Perintah: provision | run [--once|once] [--interval detik] | backfill [jam] | status | reset   (ID: --gateway <ID> atau argumen posisi)');
      process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
