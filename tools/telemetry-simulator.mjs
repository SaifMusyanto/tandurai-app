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

const timestamp = Date.now();
const payload = buildTelemetryPayload({
  farmId: process.env.TELEMETRY_FARM_ID || 'FARM-01',
  kumbungId: process.env.TELEMETRY_KUMBUNG_ID || 'FARM-01-K01',
  sensorId: process.env.TELEMETRY_SENSOR_ID || 'SNS-0101',
  timestamp,
  temperature: Number(process.env.TELEMETRY_TEMPERATURE || 27.4),
  humidity: Number(process.env.TELEMETRY_HUMIDITY || 82.1),
  co2: Number(process.env.TELEMETRY_CO2 || 695),
  pressure: Number(process.env.TELEMETRY_PRESSURE || 1008.2),
  fanStatus: false,
  fanSpeedPct: 0,
  mistingStatus: false,
});

const app = initializeApp(firebaseConfig, `telemetry-simulator-${timestamp}`);
const auth = getAuth(app);
const db = getDatabase(app);

try {
  await signInWithEmailAndPassword(auth, email, password);
  const latestPath = `tumbara/monitoring/${payload.kumbungId}/${payload.sensorId}`;
  const bucketStart = historyBucketStart(payload.timestamp);
  const entryId = historyEntryId(payload.sensorId, payload.timestamp);
  const historyPath = `tumbara/history/${payload.kumbungId}/${jakartaDateKey(payload.timestamp)}/${entryId}`;
  const historyExists = (await get(ref(db, historyPath))).exists();
  const updates = { [latestPath]: payload };
  if (!historyExists) updates[historyPath] = { ...payload, bucketStart };
  await update(ref(db), updates);
  console.log(JSON.stringify({ ok: true, latestPath, historyPath: historyExists ? null : historyPath, historySkipped: historyExists }, null, 2));
} finally {
  await signOut(auth).catch(() => {});
  await deleteApp(app);
}
