// Harness uji end-to-end: broker uji + backend + PostgreSQL (database *_test, di-reset) + klien API/SSE.
import pg from 'pg';
import { readConfig } from '../src/config.js';
import { createBackend } from '../src/server.js';
import { startDevBroker } from './broker.mjs';

export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5433/tandurai_iot_test';
export const WORKER_TOKEN = 'e2e-worker-token-0123456789';
const BACKEND_PASS = 'e2e-backend-pass';
const quiet = { info() {}, warn() {}, error: (...args) => console.error(...args) };

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const step = message => console.log(`✔ ${message}`);

export async function waitFor(fn, { timeout = 8000, interval = 50, label = 'kondisi' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`Timeout menunggu ${label}`);
    await sleep(interval);
  }
}

export async function startStack(env = {}) {
  const url = new URL(TEST_DB);
  if (!/_test$/.test(url.pathname)) throw new Error('E2E hanya boleh memakai database *_test.');
  const admin = new pg.Client({ connectionString: TEST_DB });
  await admin.connect();
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await admin.end();

  const broker = await startDevBroker({ pool: new pg.Pool({ connectionString: TEST_DB }), port: 0, backendUsername: 'tandurai-backend', backendPassword: BACKEND_PASS, log: quiet });
  const config = readConfig({
    DATABASE_URL: TEST_DB, MQTT_URL: `mqtt://localhost:${broker.port}`, MQTT_PASSWORD: BACKEND_PASS,
    MQTT_CLIENT_ID: `tandurai-backend-e2e-${process.pid}-${Date.now()}`, AUTH_MODE: 'dev', COMMAND_TTL_SEC: '5',
    WORKER_TOKEN, ...env,
  });
  const telegram = [];
  const backend = await createBackend(config, {
    log: quiet,
    notifier: {
      send: async (target, text) => { telegram.push({ ...target, text }); },
      sendDocument: async (target, file) => { telegram.push({ ...target, document: file.filename, size: file.buffer.length, caption: file.caption }); },
    },
  });
  const port = await backend.listen(0);
  const base = `http://localhost:${port}/api`;
  await waitFor(() => backend.mqtt.isConnected(), { label: 'backend MQTT' });

  async function api(method, path, { user = 'alice', body, token } = {}) {
    const authorization = token ? `Bearer ${token}` : user ? `Bearer dev:${user}` : null;
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(authorization ? { Authorization: authorization } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  /** Buka SSE untuk `user`; event dikumpulkan di array `events`. */
  function openStream(user) {
    const events = [];
    const abort = new AbortController();
    (async () => {
      const response = await fetch(`${base}/stream?token=dev:${user}`, { signal: abort.signal });
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const event = frame.match(/^event: (.+)$/m)?.[1];
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data), at: Date.now() });
        }
      }
    })().catch(() => {});
    const waitEvent = (predicate, label, timeout = 8000) => waitFor(() => events.find(predicate), { timeout, label });
    return { events, waitEvent, close: () => abort.abort() };
  }

  return {
    config, backend, broker, api, openStream, telegram, base,
    async close() {
      await backend.close().catch(() => {});
      await broker.close().catch(() => {});
    },
  };
}
