// Simulator gateway ESP32 via MQTT (pengganti firmware selama hardware belum siap).
// Perilaku mengikuti docs/KONTRAK_MQTT_GATEWAY.md: register, status/LWT, telemetry, command + ACK,
// config + ACK (disimpan seperti NVS), jadwal (jam tertentu/berulang) & aturan otomatis (nyala saat melewati
// angka; mati setelah durasi atau saat kembali normal) dijalankan lokal, override manual sementara,
// proteksi max ON, relay OFF saat boot.
//
//   node apps/api/tools/mqtt-gateway-sim.mjs --device device.json [--url mqtt://localhost:1883]
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mqtt from 'mqtt';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_DIR = join(HERE, '..', '.sim');
const STALE_SENSOR_MS = 180000;

// Setiap node sensor (SCD41) membaca suhu, kelembapan, dan CO₂. `offset` = beda posisi di kumbung
// (mis. S2 di sudut jauh dari sprayer: sedikit lebih hangat, lebih kering, CO₂ lebih tinggi).
export const DEFAULT_SENSORS = [
  { id: 'S1', type: 'scd41', metrics: ['temperature', 'humidity', 'co2'], offset: { temperature: 0, humidity: 0, co2: 0 } },
  { id: 'S2', type: 'scd41', metrics: ['temperature', 'humidity', 'co2'], offset: { temperature: 0.8, humidity: -3.5, co2: 70 } },
];
export const DEFAULT_ACTUATORS = [
  { id: 'A1', type: 'sprayer', maxRunSec: 120, minIntervalSec: 0 },
  { id: 'A2', type: 'fan', maxRunSec: 3600, minIntervalSec: 0 },
];

const toMinute = text => {
  const [h, m] = text.split(':').map(Number);
  return h * 60 + m;
};

/** Waktu lokal gateway dari config (`utcOffsetMin`, default WIB): menit dalam hari, hari ISO 1–7, kunci tanggal. */
function localClock(at, offsetMin = 420) {
  const local = new Date(at + offsetMin * 60000);
  return {
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
    day: local.getUTCDay() || 7,
    date: local.toISOString().slice(0, 10),
  };
}

const inWindow = (window, minute) => {
  if (!window) return true;
  const [start, end] = window.split('-').map(toMinute);
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
};

export function createMqttGateway({
  url = 'mqtt://localhost:1883',
  hwUid,
  deviceSecret,
  model = 'TDR-GW1',
  firmware = 'sim-mqtt/1.0.0',
  sensors = DEFAULT_SENSORS,
  actuators = DEFAULT_ACTUATORS,
  failingSensors = [],
  stateDir = DEFAULT_STATE_DIR,
  heartbeatSec = 60,
  telemetryIntervalSec = null, // null = ikuti config (default 10)
  now = () => Date.now(),
  log = message => console.log(`[${hwUid}] ${message}`),
}) {
  const topic = kind => `tandurai/gw/${hwUid}/${kind}`;
  // File NVS terpisah dari file identitas perangkat (`<hwUid>.json` dari factory sering disimpan di folder yang sama).
  const statePath = join(stateDir, `${hwUid}.nvs.json`);
  const hardware = new Map(actuators.map(item => [item.id, item]));
  const failing = new Set(failingSensors);

  // "NVS": config terakhir yang valid + ID command yang sudah diproses.
  const stored = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  let nvs = { config: stored.config ?? null, executed: Array.isArray(stored.executed) ? stored.executed : [] };
  const saveNvs = () => {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(`${statePath}.tmp`, JSON.stringify(nvs));
    renameSync(`${statePath}.tmp`, statePath);
  };

  // Relay selalu OFF saat boot (safe state).
  // override = dinyalakan manual saat jadwal/otomatis aktif; engine berhenti sampai relay mati.
  const relays = new Map(actuators.map(item => [item.id, { state: 'off', source: 'boot', since: now(), offAt: null, lastOnAt: 0, hold: false, override: false }]));
  const offTimers = new Map();
  const engine = new Map(); // localId → { nextAt: {scheduleId: ms}, fired: Set, resumeAt }
  const env = { temperature: 27.5, humidity: 80, co2: 650 };
  let client = null;
  const timers = [];
  let stopped = false;

  const configFor = localId => nvs.config?.actuators?.[localId] || null;
  const maxRun = localId => Math.min(configFor(localId)?.maxRunSec ?? Infinity, hardware.get(localId)?.maxRunSec ?? Infinity);

  function publish(kind, payload, options = { qos: 1 }) {
    if (!client?.connected) return false;
    client.publish(topic(kind), JSON.stringify(payload), options);
    return true;
  }

  const relayView = id => {
    const relay = relays.get(id);
    return { state: relay.state, mode: configFor(id)?.mode || 'manual', source: relay.source, since: relay.since, offAt: relay.offAt, override: relay.override, trigger: relay.trigger || null };
  };
  const publishState = ids => publish('state', { actuators: Object.fromEntries(ids.map(id => [id, relayView(id)])) });

  function setRelay(id, state, source, durationSec = 0, trigger = null) {
    const relay = relays.get(id);
    relay.trigger = state === 'on' ? trigger : null;
    clearTimeout(offTimers.get(id));
    offTimers.delete(id);
    relay.state = state;
    relay.source = source;
    relay.since = now();
    relay.offAt = null;
    if (state === 'on') {
      // Proteksi hardware: durasi selalu dibatasi max ON; mati otomatis tanpa memblokir loop.
      const seconds = Math.max(1, Math.min(durationSec, maxRun(id)));
      relay.lastOnAt = now();
      relay.offAt = now() + seconds * 1000;
      offTimers.set(id, setTimeout(() => {
        // Batas max ON tercapai (atau durasi manual habis): otomatis menunggu cooldown sebelum boleh nyala lagi.
        if (relay.source === 'auto') pauseEngine(id);
        setRelay(id, 'off', relay.source);
        publishState([id]);
      }, seconds * 1000));
    } else {
      relay.override = false;
    }
  }

  const engineState = id => {
    if (!engine.has(id)) engine.set(id, { nextAt: {}, fired: new Set(), resumeAt: 0 });
    return engine.get(id);
  };
  /** Tunda otomatis selama cooldown (setelah mati karena batas max ON atau dimatikan manual). */
  function pauseEngine(id) {
    const relay = relays.get(id);
    const rules = configFor(id)?.rules || [];
    const rule = rules.find(item => item.id === relay.trigger?.rule);
    // Jeda aturan yang menyalakan; setelah OFF manual pakai jeda terbesar agar tidak langsung menyala lagi.
    const cooldownSec = rule ? rule.cooldownSec : Math.max(0, ...rules.map(item => item.cooldownSec ?? 0));
    engineState(id).resumeAt = now() + (cooldownSec ?? 0) * 1000;
  }

  function remember(id) {
    nvs.executed = [...nvs.executed.filter(item => item !== id), id].slice(-100);
    saveNvs();
  }

  function handleCommand(payload) {
    const { id, actuator, action, durationSec, expiresAt } = payload || {};
    if (typeof id !== 'string') return;
    if (nvs.executed.includes(id)) return; // duplikat (QoS1 redelivery) — sudah diproses
    const ack = (status, reason = null) => {
      remember(id);
      const relay = relays.get(actuator);
      publish('ack', { type: 'command', id, status, reason, state: relay?.state, offAt: relay?.offAt });
      if (relay) publishState([actuator]);
      log(`command ${action} ${actuator}: ${status}${reason ? ` (${reason})` : ''}`);
    };
    if (!Number.isFinite(Number(expiresAt)) || now() > Number(expiresAt)) return ack('expired', 'expired');
    if (!relays.has(actuator)) return ack('rejected', 'unknown_actuator');
    const relay = relays.get(actuator);
    if (action === 'estop') {
      setRelay(actuator, 'off', 'estop');
      relay.hold = true;
      return ack('success');
    }
    // Perintah manual berlaku di mode apa pun (override sementara jadwal/otomatis).
    const automated = (configFor(actuator)?.mode || 'manual') !== 'manual';
    if (action === 'off') {
      setRelay(actuator, 'off', 'manual');
      if (automated) pauseEngine(actuator);
      return ack('success');
    }
    if (action === 'on') {
      const minInterval = (configFor(actuator)?.minIntervalSec ?? hardware.get(actuator).minIntervalSec) * 1000;
      if (relay.lastOnAt && now() - relay.lastOnAt < minInterval && relay.state !== 'on') return ack('rejected', 'interval');
      relay.hold = false;
      setRelay(actuator, 'on', 'manual', Number(durationSec) || 1);
      relay.override = automated;
      return ack('success');
    }
    return ack('rejected', 'invalid_action');
  }

  function handleConfig(payload) {
    const version = Number(payload?.version);
    if (!Number.isInteger(version)) return;
    const current = Number(nvs.config?.version ?? -1);
    if (version < current) return; // config lama (mis. retained usang) diabaikan
    const changed = version !== current;
    if (changed) {
      const previous = nvs.config;
      nvs.config = payload;
      saveNvs();
      // Mode/aktuator berubah → matikan dulu, reset engine (kecuali mode & parameter sama).
      for (const id of relays.keys()) {
        const before = JSON.stringify(previous?.actuators?.[id] || null);
        const after = JSON.stringify(payload.actuators?.[id] || null);
        if (before !== after) {
          if (relays.get(id).state === 'on') setRelay(id, 'off', 'config');
          relays.get(id).hold = false;
          engine.delete(id);
        }
      }
      restartTelemetry();
    }
    const items = {};
    for (const id of Object.keys(payload.actuators || {})) items[id] = hardware.has(id) ? { status: 'ok' } : { status: 'fault', error: 'unknown_channel' };
    for (const sensor of sensors) items[sensor.id] = failing.has(sensor.id) ? { status: 'not_found', error: 'Sensor tidak menjawab' } : { status: 'ok' };
    publish('ack', { type: 'config', version, status: 'applied', items });
    if (changed) publishState([...relays.keys()]);
    log(`config v${version} diterapkan`);
  }

  // ── engine lokal (berjalan walau MQTT terputus)
  function runSchedules(id, cfg, relay, at) {
    const state = engineState(id);
    const clock = localClock(at, nvs.config?.utcOffsetMin);
    for (const schedule of cfg.schedules || []) {
      if (Array.isArray(schedule.days) && !schedule.days.includes(clock.day)) continue;
      if (schedule.type === 'at') {
        const key = `${clock.date}|${schedule.id}`;
        if (clock.minute !== toMinute(schedule.at) || state.fired.has(key)) continue;
        state.fired.add(key);
        if (state.fired.size > 200) state.fired = new Set([...state.fired].slice(-100));
        if (relay.state === 'off') {
          setRelay(id, 'on', 'timer', schedule.onSec, { schedule: schedule.id });
          publishState([id]);
        }
      } else if (schedule.type === 'every') {
        if (!inWindow(schedule.window, clock.minute)) continue;
        if (at >= (state.nextAt[schedule.id] ?? at) && relay.state === 'off') {
          setRelay(id, 'on', 'timer', schedule.onSec, { schedule: schedule.id });
          state.nextAt[schedule.id] = at + schedule.intervalSec * 1000;
          publishState([id]);
        }
      }
    }
  }

  function runRules(id, cfg, relay, at) {
    const state = engineState(id);
    const rules = cfg.rules || [];
    // Aktuator sedang dinyalakan aturan: cek kondisi mati aturan tsb (durasi ditangani timer relay).
    if (relay.state === 'on' && relay.source === 'auto') {
      const active = rules.find(rule => rule.id === relay.trigger?.rule);
      const reading = active ? readingFor(active.sensor, active.metric) : null;
      if (!active || reading === null) {
        // Aturan dihapus atau sensor acuan hilang/usang: matikan demi keamanan.
        setRelay(id, 'off', 'protection');
        publishState([id]);
      } else if (active.stop.type === 'value'
        && (active.operator === 'below' ? reading >= active.stop.value : reading <= active.stop.value)) {
        pauseEngine(id);
        setRelay(id, 'off', 'auto');
        publishState([id]);
      }
      return;
    }
    if (relay.state !== 'off' || at < state.resumeAt) return;
    for (const rule of rules) {
      const reading = readingFor(rule.sensor, rule.metric);
      if (reading === null) continue;
      if (rule.operator === 'below' ? reading < rule.threshold : reading > rule.threshold) {
        const seconds = rule.stop.type === 'duration' ? rule.stop.onSec : maxRun(id);
        setRelay(id, 'on', 'auto', seconds, { rule: rule.id });
        publishState([id]);
        return;
      }
    }
  }

  function tick() {
    const at = now();
    for (const [id, relay] of relays) {
      const cfg = configFor(id);
      if (!cfg || cfg.mode === 'manual' || relay.hold || relay.override) continue;
      if (cfg.mode === 'timer') runSchedules(id, cfg, relay, at);
      else if (cfg.mode === 'auto') runRules(id, cfg, relay, at);
    }
    // Lingkungan tiruan: sprayer/humidifier menaikkan RH, fan menurunkan CO2.
    const on = type => actuators.some(item => item.type === type && relays.get(item.id).state === 'on');
    env.humidity = Math.min(98, Math.max(55, env.humidity + (on('sprayer') || on('humidifier') ? 0.8 : -0.15)));
    env.co2 = Math.min(3000, Math.max(420, env.co2 + (on('fan') ? -8 : 2)));
    env.temperature = Math.min(34, Math.max(22, env.temperature + (Math.random() - 0.5) * 0.05));
  }

  const lastReadings = {};
  function readingFor(sensorId, metric) {
    const entry = lastReadings[sensorId];
    if (!entry || now() - entry.ts > STALE_SENSOR_MS || entry.values[metric] === undefined) return null;
    return entry.values[metric];
  }

  function sampleAndPublish() {
    const ts = now();
    const readings = {};
    for (const sensor of sensors) {
      if (failing.has(sensor.id)) continue;
      const values = {};
      for (const metric of sensor.metrics) {
        // Nilai per sensor = kondisi kumbung + beda posisi + derau pembacaan kecil.
        const noise = (Math.random() - 0.5) * (metric === 'co2' ? 20 : 0.4);
        const value = (env[metric] ?? 0) + (sensor.offset?.[metric] ?? 0) + noise;
        values[metric] = Number(value.toFixed(metric === 'co2' ? 0 : 1));
      }
      readings[sensor.id] = values;
      lastReadings[sensor.id] = { ts, values }; // dipakai engine lokal walau offline
    }
    publish('telemetry', { ts, readings }, { qos: 0 });
  }

  let telemetryTimer = null;
  function restartTelemetry() {
    clearInterval(telemetryTimer);
    const seconds = telemetryIntervalSec ?? nvs.config?.telemetryIntervalSec ?? 10;
    telemetryTimer = setInterval(sampleAndPublish, Math.max(1, seconds) * 1000);
  }

  const statusPayload = () => ({ online: true, firmware, configVersion: nvs.config?.version ?? 0, uptimeSec: Math.round(process.uptime()) });

  function connect() {
    client = mqtt.connect(url, {
      clientId: hwUid,
      username: hwUid,
      password: deviceSecret,
      clean: false,
      reconnectPeriod: 1000,
      keepalive: 15,
      will: { topic: topic('status'), payload: JSON.stringify({ online: false }), qos: 1, retain: true },
    });
    client.on('connect', () => {
      log('tersambung ke broker');
      client.subscribe([topic('cmd'), topic('config')], { qos: 1 });
      publish('register', { model, firmware, sensors: sensors.map(({ id, type, metrics }) => ({ id, type, metrics })), actuators });
      publish('status', statusPayload(), { qos: 1, retain: true });
      publishState([...relays.keys()]);
      sampleAndPublish();
    });
    client.on('message', (messageTopic, buffer) => {
      let payload;
      try { payload = JSON.parse(buffer.toString('utf8')); } catch { return; }
      if (messageTopic === topic('cmd')) handleCommand(payload);
      else if (messageTopic === topic('config')) handleConfig(payload);
    });
    client.on('error', error => log(`mqtt error: ${error.message}`));
  }

  return {
    start() {
      stopped = false;
      connect();
      restartTelemetry();
      timers.push(setInterval(() => publish('status', statusPayload(), { qos: 1, retain: true }), heartbeatSec * 1000));
      timers.push(setInterval(tick, 1000));
      return this;
    },
    /** Putus jaringan mendadak (tanpa DISCONNECT) → broker mengirim LWT offline. Engine tetap jalan. */
    dropNetwork() {
      client.options.reconnectPeriod = 0;
      client.stream?.destroy();
      client.end(true);
      client = null;
    },
    reconnectNetwork() {
      if (!client) connect();
    },
    async stop() {
      stopped = true;
      timers.splice(0).forEach(clearInterval);
      clearInterval(telemetryTimer);
      offTimers.forEach(clearTimeout);
      await new Promise(resolve => (client ? client.end(false, {}, resolve) : resolve()));
    },
    relay: id => ({ ...relays.get(id) }),
    get configVersion() { return nvs.config?.version ?? 0; },
    get connected() { return Boolean(client?.connected) && !stopped; },
    sampleAndPublish,
    setEnv: values => Object.assign(env, values),
  };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    options[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const options = parseArgs(process.argv.slice(2));
  if (!options.device) {
    console.log('Pemakaian: node apps/api/tools/mqtt-gateway-sim.mjs --device <device.json dari factory> [--url mqtt://localhost:1883]');
    process.exit(1);
  }
  const device = JSON.parse(readFileSync(options.device, 'utf8'));
  const gateway = createMqttGateway({ url: options.url || 'mqtt://localhost:1883', hwUid: device.hwUid, deviceSecret: device.deviceSecret, model: device.model }).start();
  process.once('SIGINT', () => gateway.stop().finally(() => process.exit(0)));
}
