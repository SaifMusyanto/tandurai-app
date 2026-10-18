import express from 'express';
import { pathToFileURL } from 'node:url';
import { createAlertService, telegramNotifier } from './alerts.js';
import { createAuthenticator } from './auth.js';
import { loadEnvFile, readConfig } from './config.js';
import { createPool } from './db.js';
import { createDeviceRegistry } from './devices.js';
import { createDomainService } from './domain.js';
import { createActivityService } from './activities.js';
import { createReportService } from './reports.js';
import { createAdminService } from './admin.js';
import { createEventHub } from './events.js';
import { createForecastService } from './forecast.js';
import { createIotService } from './iot.js';
import { migrate } from './migrate.js';
import { createMqttBridge } from './mqtt.js';
import { createRouter, errorHandler } from './routes.js';

/**
 * Bangun backend lengkap (HTTP + satu MQTT client + sweeper). Dipakai server produksi dan uji e2e.
 * `notifier` (opsional) menggantikan pengirim Telegram, mis. untuk uji.
 */
export async function createBackend(config, { log = console, authenticate, notifier } = {}) {
  const pool = createPool(config.databaseUrl);
  await migrate(pool, message => log.info?.(message));
  const hub = createEventHub();
  const domain = createDomainService({ pool, hub });
  const telegram = notifier || telegramNotifier();
  const alerts = createAlertService({ pool, hub, log, notifier: telegram });
  const activities = createActivityService({ pool, hub });
  const reports = createReportService({ pool, activities, notifier: telegram, log });
  const forecast = createForecastService({ pool, hub });

  let mqttBridge = null;
  const iot = createIotService({
    pool,
    hub,
    alerts,
    config,
    log,
    publish: (topic, payload, options) => mqttBridge.publishJson(topic, payload, options),
  });
  await iot.loadRouting();
  mqttBridge = createMqttBridge(config, iot.onDeviceMessage, log);
  // Publikasi tertahan di antrean client MQTT sampai broker tersambung.
  iot.refreshOutdatedConfigs().catch(error => log.error?.('[config] gagal memperbarui config lama:', error.message));

  const health = async () => {
    const db = await pool.query('SELECT 1').then(() => true, () => false);
    return { ok: db && mqttBridge.isConnected(), db, mqtt: mqttBridge.isConnected(), sseClients: hub.clientCount() };
  };

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' });
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  });
  app.use('/api/worker', express.json({ limit: '2mb' })); // forecast & fitur dari AI worker
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', createRouter({
    iot,
    domain,
    activities,
    reports,
    alerts,
    forecast,
    devices: createDeviceRegistry({ pool, config }),
    hub,
    workerToken: config.workerToken,
    authenticate: authenticate || createAuthenticator(config),
    health,
    admin: createAdminService({ pool, health, config }),
  }));
  app.use(errorHandler(log));

  // Sweeper dalam proses: kedaluwarsa command (2 dtk), gateway offline (15 dtk), retensi histori (harian).
  const run = (name, task) => () => task().catch(error => log.error?.(`[sweep:${name}]`, error.message));
  const timers = [
    setInterval(run('expire', iot.expireCommands), 2000),
    setInterval(run('offline', iot.markStaleOffline), 15000),
    setInterval(run('retention', iot.pruneHistory), 24 * 3600 * 1000),
    setInterval(run('reports', reports.runDue), 60 * 1000), // laporan terjadwal (Telegram)
  ];
  run('retention', iot.pruneHistory)();

  let server = null;
  return {
    app,
    iot,
    domain,
    reports,
    hub,
    pool,
    mqtt: mqttBridge,
    listen: (port = config.port) => new Promise(resolve => {
      server = app.listen(port, () => resolve(server.address().port));
    }),
    async close() {
      timers.forEach(clearInterval);
      hub.close();
      await new Promise(resolve => (server ? server.close(() => resolve()) : resolve()));
      await mqttBridge.close();
      await pool.end();
    },
  };
}

async function main() {
  loadEnvFile();
  const config = readConfig();
  const backend = await createBackend(config);
  const port = await backend.listen();
  console.log(`[api] mendengarkan di http://localhost:${port} (auth: ${config.authMode})`);
  const shutdown = signal => {
    console.log(`[api] berhenti (${signal})`);
    backend.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    console.error('[api] gagal start:', error.message);
    process.exit(1);
  });
}
