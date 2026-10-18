import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Muat apps/api/.env tanpa menimpa variabel yang sudah diset di environment. */
export function loadEnvFile(path = join(API_ROOT, '.env')) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const key = line.slice(0, line.indexOf('=')).trim();
    const value = line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const authMode = env.AUTH_MODE || 'firebase';
  if (production && authMode !== 'firebase') throw new Error('AUTH_MODE selain "firebase" dilarang di production.');
  return Object.freeze({
    production,
    port: int(env.PORT, 8787),
    databaseUrl: env.DATABASE_URL || 'postgres://postgres@localhost:5433/tandurai_iot',
    mqttUrl: env.MQTT_URL || 'mqtt://localhost:1883',
    mqttUsername: env.MQTT_USERNAME || 'tandurai-backend',
    mqttPassword: env.MQTT_PASSWORD || '',
    mqttClientId: env.MQTT_CLIENT_ID || 'tandurai-backend',
    firebaseProjectId: env.FIREBASE_PROJECT_ID || 'tandurai-ai',
    // "dev": header Authorization "Bearer dev:<uid>" — hanya untuk uji lokal/e2e.
    authMode,
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173').split(',').map(item => item.trim()).filter(Boolean),
    commandTtlSec: int(env.COMMAND_TTL_SEC, 30),
    offlineAfterSec: int(env.OFFLINE_AFTER_SEC, 180),
    historyBucketSec: int(env.HISTORY_BUCKET_SEC, 600),
    historyRetentionDays: int(env.HISTORY_RETENTION_DAYS, 180),
    telemetryIntervalSec: int(env.TELEMETRY_INTERVAL_SEC, 10),
    // Alamat broker yang diisi ke gateway (IP LAN laptop saat uji, IP/domain server saat produksi).
    mqttPublicHost: env.MQTT_PUBLIC_HOST || new URL(env.MQTT_URL || 'mqtt://localhost:1883').hostname,
    mqttPublicPort: int(env.MQTT_PUBLIC_PORT, Number(new URL(env.MQTT_URL || 'mqtt://localhost:1883').port || 1883)),
    mqttPublicTls: env.MQTT_PUBLIC_TLS === 'true',
    // Admin Tandurai (boleh mendaftarkan perangkat): daftar email terverifikasi, pisahkan koma.
    adminEmails: (env.ADMIN_EMAILS || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean),
    // Token API internal AI worker lokal (≥ 16 karakter); kosong = API worker nonaktif.
    workerToken: env.WORKER_TOKEN || '',
  });
}
