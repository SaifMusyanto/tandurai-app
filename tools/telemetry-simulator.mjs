import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getDatabase, get, ref, update } from 'firebase/database';
import {
  buildTelemetryPayload,
  historyBucketStart,
  historyEntryId,
  jakartaDateKey,
} from '../apps/web/src/lib/telemetry.js';

function readEnvFile(path) {
  return Object.fromEntries(readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
}

const fileEnv = readEnvFile('apps/web/.env');
const email = process.env.TELEMETRY_EMAIL;
const password = process.env.TELEMETRY_PASSWORD;
if (!email || !password) {
  throw new Error('Atur TELEMETRY_EMAIL dan TELEMETRY_PASSWORD pada environment terminal. Jangan simpan password di source.');
}

const firebaseConfig = {
  apiKey: fileEnv.VITE_FIREBASE_API_KEY,
  authDomain: fileEnv.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: fileEnv.VITE_FIREBASE_DATABASE_URL,
  projectId: fileEnv.VITE_FIREBASE_PROJECT_ID,
  appId: fileEnv.VITE_FIREBASE_APP_ID,
};

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, decimals) => Number(value.toFixed(decimals));

const nextReading = (previous, center, maxStep, maxDistance, decimals) => {
  const current = Number.isFinite(Number(previous)) ? Number(previous) : center;
  const randomStep = (Math.random() * 2 - 1) * maxStep;
  const meanReversion = (center - current) * 0.12;
  return round(clamp(
    current + randomStep + meanReversion,
    center - maxDistance,
    center + maxDistance,
  ), decimals);
};

const farmId = process.env.TELEMETRY_FARM_ID || 'FARM-01';
const kumbungId = process.env.TELEMETRY_KUMBUNG_ID || 'FARM-01-K01';
const sensorId = process.env.TELEMETRY_SENSOR_ID || 'SNS-0101';
const normal = {
  temperature: numberFromEnv('TELEMETRY_TEMPERATURE', 27.4),
  humidity: numberFromEnv('TELEMETRY_HUMIDITY', 82.1),
  co2: numberFromEnv('TELEMETRY_CO2', 695),
  pressure: numberFromEnv('TELEMETRY_PRESSURE', 1008.2),
};

const timestamp = Date.now();
const app = initializeApp(firebaseConfig, `telemetry-simulator-${timestamp}`);
const auth = getAuth(app);
const db = getDatabase(app);

try {
  await signInWithEmailAndPassword(auth, email, password);
  const latestPath = `tumbara/monitoring/${kumbungId}/${sensorId}`;
  const latestSnapshot = await get(ref(db, latestPath));
  const previous = latestSnapshot.val() || {};
  const payload = buildTelemetryPayload({
    farmId,
    kumbungId,
    sensorId,
    timestamp,
    temperature: nextReading(previous.temperature, normal.temperature, 0.25, 1.2, 1),
    humidity: nextReading(previous.humidity, normal.humidity, 0.7, 3, 1),
    co2: nextReading(previous.co2, normal.co2, 15, 70, 0),
    pressure: nextReading(previous.pressure, normal.pressure, 0.3, 1.5, 1),
    fanStatus: false,
    fanSpeedPct: 0,
    mistingStatus: false,
  });
  const bucketStart = historyBucketStart(payload.timestamp);
  const entryId = historyEntryId(payload.sensorId, payload.timestamp);
  const historyPath = `tumbara/history/${payload.kumbungId}/${jakartaDateKey(payload.timestamp)}/${entryId}`;
  const historyExists = (await get(ref(db, historyPath))).exists();
  const updates = { [latestPath]: payload };
  if (!historyExists) updates[historyPath] = { ...payload, bucketStart };
  await update(ref(db), updates);
  console.log(JSON.stringify({
    ok: true,
    latestPath,
    historyPath: historyExists ? null : historyPath,
    historySkipped: historyExists,
    readings: {
      temperature: payload.temperature,
      humidity: payload.humidity,
      co2: payload.co2,
      pressure: payload.pressure,
    },
  }, null, 2));
} finally {
  await signOut(auth).catch(() => {});
  await deleteApp(app);
}
