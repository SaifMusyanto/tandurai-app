import mqtt from 'mqtt';

export const TOPIC_PREFIX = 'tandurai/gw';
export const topicFor = (hwUid, kind) => `${TOPIC_PREFIX}/${hwUid}/${kind}`;

const INBOUND = ['register', 'status', 'telemetry', 'state', 'ack'];

/**
 * Satu MQTT client persisten untuk seluruh backend (session tidak bersih, auto-reconnect).
 * `onMessage(hwUid, kind, payload)` dipanggil untuk pesan perangkat yang JSON-nya valid.
 */
export function createMqttBridge(config, onMessage, log = console) {
  const client = mqtt.connect(config.mqttUrl, {
    clientId: config.mqttClientId,
    username: config.mqttUsername,
    password: config.mqttPassword || undefined,
    clean: false,            // QoS1 yang masuk saat backend restart tetap diantar
    reconnectPeriod: 2000,
    connectTimeout: 10000,
    keepalive: 30,
  });

  client.on('connect', () => {
    log.info?.('[mqtt] tersambung');
    client.subscribe(INBOUND.map(kind => `${TOPIC_PREFIX}/+/${kind}`), { qos: 1 }, error => {
      if (error) log.error?.('[mqtt] subscribe gagal:', error.message);
    });
  });
  client.on('reconnect', () => log.info?.('[mqtt] menyambung ulang…'));
  client.on('error', error => log.error?.('[mqtt] error:', error.message));

  const inFlight = new Set(); // handler yang sedang berjalan; ditunggu saat shutdown
  const chains = new Map();   // hwUid → promise terakhir
  let closing = false;

  client.on('message', (topic, buffer) => {
    if (closing) return;
    const [root, scope, hwUid, kind, ...rest] = topic.split('/');
    if (`${root}/${scope}` !== TOPIC_PREFIX || !hwUid || !INBOUND.includes(kind) || rest.length) return;
    let payload;
    try {
      payload = buffer.length ? JSON.parse(buffer.toString('utf8')) : null;
    } catch {
      log.warn?.(`[mqtt] payload bukan JSON di ${topic}`);
      return;
    }
    // Pesan satu gateway diproses berurutan (urutan ack/state terjaga); antar gateway paralel.
    const previous = chains.get(hwUid) || Promise.resolve();
    const task = previous
      .then(() => onMessage(hwUid, kind, payload))
      .catch(error => log.error?.(`[mqtt] gagal memproses ${topic}:`, error.message))
      .finally(() => {
        inFlight.delete(task);
        if (chains.get(hwUid) === task) chains.delete(hwUid);
      });
    chains.set(hwUid, task);
    inFlight.add(task);
  });

  /** Publish JSON; resolve setelah broker menerima (PUBACK untuk QoS1). */
  function publishJson(topic, payload, { qos = 1, retain = false } = {}) {
    return new Promise((resolve, reject) => {
      client.publish(topic, JSON.stringify(payload), { qos, retain }, error => (error ? reject(error) : resolve()));
    });
  }

  return {
    client,
    publishJson,
    isConnected: () => client.connected,
    async close() {
      closing = true;
      await new Promise(resolve => client.end(false, {}, resolve));
      await Promise.allSettled([...inFlight]);
    },
  };
}
