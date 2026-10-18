// Broker MQTT Tandurai (Aedes). Dipakai untuk produksi skala kecil–menengah, pengembangan, dan uji.
// Auth langsung ke PostgreSQL (tabel devices): perangkat yang baru didaftarkan dengan tool pabrik
// bisa langsung tersambung — tidak ada file password broker yang perlu diperbarui manual.
//   - Perangkat: username = clientId = hwUid, password = device secret (hash scrypt di DB).
//   - Backend  : MQTT_USERNAME / MQTT_PASSWORD (apps/api/.env).
//   - ACL      : src/brokerAcl.js (perangkat hanya topic miliknya).
//
//   npm run broker -w apps/api
// Env opsional: MQTT_BROKER_PORT (default port MQTT_URL / 1883), MQTT_TLS_PORT (default 8883),
//               MQTT_TLS_CERT + MQTT_TLS_KEY (path PEM; bila diisi, listener TLS ikut dibuka).
import { createServer } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Aedes from 'aedes';
import { loadEnvFile, readConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { verifySecret } from '../src/secrets.js';
import { canPublish, canSubscribe } from '../src/brokerAcl.js';

const sameText = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

export async function startBroker({ pool, port = 1883, tls = null, tlsPort = 8883, backendUsername, backendPassword, log = console }) {
  const broker = Aedes({
    authenticate(client, username, password, done) {
      const secret = password ? password.toString('utf8') : '';
      if (username === backendUsername) {
        const ok = !backendPassword || sameText(secret, backendPassword);
        if (ok) client.identity = { role: 'backend' };
        else log.warn?.('[broker] backend ditolak: MQTT_PASSWORD salah');
        return done(null, ok);
      }
      // Alasan penolakan dicatat agar tim hardware cepat menemukan salah konfigurasi.
      if (!username) {
        log.warn?.(`[broker] ditolak clientId=${client.id}: username kosong (isi username = hwUid)`);
        return done(null, false);
      }
      if (client.id !== username) {
        log.warn?.(`[broker] ditolak ${username}: clientId "${client.id}" harus sama dengan username (hwUid)`);
        return done(null, false);
      }
      pool.query('SELECT secret_hash FROM devices WHERE hw_uid = $1', [username])
        .then(({ rows }) => {
          if (!rows[0]) log.warn?.(`[broker] ditolak ${username}: hwUid belum didaftarkan (jalankan tool pabrik)`);
          const ok = Boolean(rows[0]) && verifySecret(secret, rows[0].secret_hash);
          if (rows[0] && !ok) log.warn?.(`[broker] ditolak ${username}: device secret salah`);
          if (ok) client.identity = { role: 'device', hwUid: username };
          done(null, ok);
        })
        .catch(error => {
          log.error?.(`[broker] gagal cek ${username} ke database: ${error.message}`);
          done(null, false);
        });
    },
    authorizePublish(client, packet, done) {
      // Will message (LWT) dikirim setelah klien terputus; identitas diturunkan dari clientId.
      const identity = client?.identity || (packet.clientId ? { role: 'device', hwUid: packet.clientId } : null);
      const ok = canPublish(identity, packet.topic);
      if (!ok && identity?.role === 'device') log.warn?.(`[broker] ${identity.hwUid} publish ditolak ACL: ${packet.topic}`);
      done(ok ? null : new Error('publish ditolak ACL'));
    },
    authorizeSubscribe(client, subscription, done) {
      const ok = canSubscribe(client?.identity, subscription.topic);
      if (!ok && client?.identity?.role === 'device') log.warn?.(`[broker] ${client.identity.hwUid} subscribe ditolak ACL: ${subscription.topic}`);
      done(null, ok ? subscription : null);
    },
  });
  broker.on('client', client => {
    if (client.identity?.role === 'device') log.info?.(`[broker] + ${client.identity.hwUid} tersambung`);
  });
  broker.on('clientDisconnect', client => {
    if (client.identity?.role === 'device') log.info?.(`[broker] - ${client.identity.hwUid} terputus`);
  });

  const servers = [createServer(broker.handle)];
  await new Promise((resolve, reject) => servers[0].once('error', reject).listen(port, resolve));
  if (tls) {
    servers.push(createTlsServer(tls, broker.handle));
    await new Promise((resolve, reject) => servers[1].once('error', reject).listen(tlsPort, resolve));
  }
  return {
    port: servers[0].address().port,
    tlsPort: servers[1]?.address().port ?? null,
    broker,
    close: () => new Promise(resolve => broker.close(() => Promise.all(servers.map(server => new Promise(done => server.close(() => done())))).then(() => resolve()))),
  };
}

/** Nama lama (dipakai uji e2e). */
export const startDevBroker = startBroker;

async function main() {
  loadEnvFile();
  const config = readConfig();
  const pool = createPool(config.databaseUrl);
  const port = Number(process.env.MQTT_BROKER_PORT || new URL(config.mqttUrl).port || 1883);
  const tls = process.env.MQTT_TLS_CERT && process.env.MQTT_TLS_KEY
    ? { cert: readFileSync(process.env.MQTT_TLS_CERT), key: readFileSync(process.env.MQTT_TLS_KEY) }
    : null;
  const broker = await startBroker({
    pool, port, tls, tlsPort: Number(process.env.MQTT_TLS_PORT || 8883),
    backendUsername: config.mqttUsername, backendPassword: config.mqttPassword,
  });
  if (!config.mqttPassword) console.warn('[broker] PERINGATAN: MQTT_PASSWORD kosong — siapa pun bisa login sebagai backend. Isi di apps/api/.env.');
  console.log(`[broker] MQTT Tandurai di port ${broker.port}${broker.tlsPort ? ` dan TLS ${broker.tlsPort}` : ' (tanpa TLS)'}`);
  const stop = () => broker.close().then(() => pool.end()).finally(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    console.error('[broker] gagal start:', error.message);
    process.exit(1);
  });
}
