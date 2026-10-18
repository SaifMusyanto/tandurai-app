import express from 'express';
import { requireDeviceAdmin, requireUser, requireWorker } from './auth.js';
import { HttpError } from './validate.js';

const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

/** Batas percobaan klaim/pratinjau yang gagal per user (cegah tebak kode klaim). */
function createClaimLimiter({ max = 10, windowMs = 10 * 60 * 1000 } = {}) {
  const failures = new Map();
  return {
    check(uid) {
      const entry = failures.get(uid);
      if (entry && entry.resetAt > Date.now() && entry.count >= max) {
        throw new HttpError(429, 'too_many_attempts', 'Terlalu banyak percobaan klaim. Coba lagi dalam 10 menit.');
      }
    },
    fail(uid) {
      const now = Date.now();
      const entry = failures.get(uid);
      if (!entry || entry.resetAt <= now) failures.set(uid, { count: 1, resetAt: now + windowMs });
      else entry.count += 1;
    },
  };
}

export function createRouter({ iot, domain, activities, reports, admin, alerts, forecast, devices, hub, authenticate, health, workerToken }) {
  const router = express.Router();
  const auth = requireUser(authenticate, { onUser: domain.ensureUser });
  const limiter = createClaimLimiter();
  const json = fn => wrap(async (req, res) => res.json(await fn(req)));

  router.get('/health', wrap(async (req, res) => {
    const status = await health();
    res.status(status.ok ? 200 : 503).json(status);
  }));

  // Realtime dashboard (SSE). Token lewat query karena EventSource tidak dapat mengirim header.
  router.get('/stream', requireUser(authenticate, { allowQueryToken: true, onUser: domain.ensureUser }), (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ uid: req.user.uid })}\n\n`);
    const remove = hub.addClient(req.user.uid, res, { admin: Boolean(req.user.platformAdmin) });
    req.on('close', remove);
  });

  // ── akun
  router.get('/me', auth, json(req => domain.getMe(req.user)));
  router.patch('/me', auth, json(req => domain.updateMe(req.user, req.body)));
  router.get('/me/settings', auth, json(req => domain.getSettings(req.user)));
  router.put('/me/settings', auth, json(req => domain.putSettings(req.user, req.body)));

  // ── farm, anggota, audit
  router.get('/farms', auth, json(req => domain.listFarms(req.user)));
  router.post('/farms', auth, wrap(async (req, res) => res.status(201).json(await domain.createFarm(req.user, req.body))));
  router.get('/farms/:farmId', auth, json(req => domain.getFarm(req.user, req.params.farmId)));
  router.patch('/farms/:farmId', auth, json(req => domain.updateFarm(req.user, req.params.farmId, req.body)));
  router.get('/farms/:farmId/members', auth, json(req => domain.listMembers(req.user, req.params.farmId)));
  router.post('/farms/:farmId/members', auth, wrap(async (req, res) => res.status(201).json(await domain.addMember(req.user, req.params.farmId, req.body))));
  router.delete('/farms/:farmId/members/:uid', auth, json(req => domain.removeMember(req.user, req.params.farmId, req.params.uid)));
  router.get('/farms/:farmId/audit', auth, json(req => domain.listAudit(req.user, req.params.farmId, req.query.limit)));
  router.get('/farms/:farmId/alert-settings', auth, json(req => alerts.getSettings(req.user, req.params.farmId)));
  router.put('/farms/:farmId/alert-settings', auth, json(req => alerts.putSettings(req.user, req.params.farmId, req.body)));
  router.post('/farms/:farmId/alert-settings/test', auth, json(req => alerts.testTelegram(req.user, req.params.farmId)));

  // ── kumbung, batch, panen
  router.get('/farms/:farmId/kumbungs', auth, json(req => domain.listKumbungs(req.user, req.params.farmId)));
  router.post('/farms/:farmId/kumbungs', auth, wrap(async (req, res) => res.status(201).json(await domain.createKumbung(req.user, req.params.farmId, req.body))));
  router.patch('/kumbungs/:id', auth, json(req => domain.updateKumbung(req.user, req.params.id, req.body)));
  router.put('/kumbungs/:id/harvest-profile', auth, json(req => domain.putHarvestProfile(req.user, req.params.id, req.body)));
  router.post('/kumbungs/:id/batches', auth, wrap(async (req, res) => res.status(201).json(await domain.createBatch(req.user, req.params.id, req.body))));
  router.patch('/batches/:id', auth, json(req => domain.updateBatch(req.user, req.params.id, req.body)));
  router.post('/kumbungs/:id/harvests', auth, wrap(async (req, res) => res.status(201).json(await domain.createHarvest(req.user, req.params.id, req.body))));
  router.get('/operations', auth, json(req => domain.operations(req.user)));
  router.post('/kumbungs/:id/activities', auth, wrap(async (req, res) => res.status(201).json(await activities.createActivity(req.user, req.params.id, req.body))));
  router.post('/activities/:id/void', auth, json(req => activities.voidActivity(req.user, req.params.id, req.body)));
  router.get('/farms/:farmId/recap', auth, json(req => activities.recap(req.user, req.params.farmId, req.query)));
  // export data parameter & laporan farm
  const sendFile = ({ filename, body, contentType }, res) => res.set({ 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${filename}"` }).send(body);
  router.get('/farms/:farmId/telemetry-export', auth, wrap(async (req, res) => sendFile(await reports.telemetryExport(req.user, req.params.farmId, req.query), res)));
  router.get('/farms/:farmId/report', auth, json(req => reports.report(req.user, req.params.farmId, req.query)));
  router.get('/farms/:farmId/report-file', auth, wrap(async (req, res) => sendFile(await reports.reportFile(req.user, req.params.farmId, req.query), res)));
  router.get('/farms/:farmId/report-schedules', auth, json(req => reports.listSchedules(req.user, req.params.farmId)));
  router.post('/farms/:farmId/report-schedules', auth, wrap(async (req, res) => res.status(201).json(await reports.createSchedule(req.user, req.params.farmId, req.body))));
  router.patch('/report-schedules/:id', auth, json(req => reports.updateSchedule(req.user, req.params.id, req.body)));
  router.delete('/report-schedules/:id', auth, wrap(async (req, res) => { await reports.deleteSchedule(req.user, req.params.id); res.status(204).end(); }));
  router.post('/report-schedules/:id/send', auth, json(req => reports.sendNow(req.user, req.params.id)));
  router.get('/farms/:farmId/recap.csv', auth, wrap(async (req, res) => {
    const { filename, body } = await activities.recapCsv(req.user, req.params.farmId, req.query);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` }).send(body);
  }));
  router.get('/kumbungs/:id/telemetry', auth, json(req => iot.kumbungTelemetry(req.user, req.params.id, req.query)));
  router.get('/kumbungs/:id/actuator-log', auth, json(req => iot.kumbungActuatorLog(req.user, req.params.id, req.query.limit)));

  // ── alert & forecast
  router.get('/alerts', auth, json(req => alerts.listAlerts(req.user, req.query)));
  router.get('/kumbungs/:id/forecast', auth, json(req => forecast.getKumbungForecast(req.user, req.params.id)));
  router.post('/kumbungs/:id/forecast-requests', auth, wrap(async (req, res) => res.status(201).json(await forecast.requestForecast(req.user, req.params.id, req.body))));
  router.get('/forecasts/latest', auth, json(req => forecast.latestForecasts(req.user)));
  router.get('/system/worker-status', auth, json(() => forecast.workerStatus()));

  // ── Registrasi perangkat (admin Tandurai). Secret hanya dikembalikan sekali saat dibuat.
  // konsol admin Tandurai (pemantauan seluruh sistem)
  router.get('/admin/overview', auth, requireDeviceAdmin, json(() => admin.overview()));
  router.get('/admin/users', auth, requireDeviceAdmin, json(() => admin.users()));
  router.get('/admin/farms', auth, requireDeviceAdmin, json(() => admin.farms()));
  router.get('/admin/farms/:farmId', auth, requireDeviceAdmin, json(req => admin.farmDetail(req.params.farmId)));
  router.get('/admin/devices', auth, requireDeviceAdmin, json(async req => ({ broker: devices.broker(), devices: await devices.list(req.query.limit) })));
  router.post('/admin/devices', auth, requireDeviceAdmin, wrap(async (req, res) => res.status(201).json(await devices.provision(req.body))));

  // ── IoT
  router.get('/gateways', auth, json(req => iot.listGateways(req.user, req.query.farmId || null)));
  router.get('/gateways/:id', auth, json(req => iot.getGateway(req.user, req.params.id)));

  const claimAttempt = async (uid, action) => {
    limiter.check(uid);
    try {
      return await action();
    } catch (error) {
      if (error.code === 'invalid_claim') limiter.fail(uid);
      throw error;
    }
  };

  router.get('/devices/:hwUid/preview', auth, wrap(async (req, res) => {
    res.json(await claimAttempt(req.user.uid, () => iot.previewDevice(req.params.hwUid, req.query.claimCode)));
  }));
  router.post('/gateways/claim', auth, wrap(async (req, res) => {
    res.status(201).json(await claimAttempt(req.user.uid, () => iot.claimGateway(req.user, req.body)));
  }));
  router.patch('/gateways/:id', auth, json(req => iot.renameGateway(req.user, req.params.id, req.body)));
  router.delete('/gateways/:id', auth, wrap(async (req, res) => {
    await iot.unclaimGateway(req.user, req.params.id);
    res.status(204).end();
  }));

  router.patch('/sensors/:id', auth, json(req => iot.updateSensor(req.user, req.params.id, req.body)));
  router.get('/sensors/:id/history', auth, json(req => iot.sensorHistory(req.user, req.params.id, req.query.from, req.query.to)));
  router.patch('/actuators/:id', auth, json(req => iot.updateActuator(req.user, req.params.id, req.body)));
  router.put('/actuators/:id/config', auth, json(req => iot.updateActuatorConfig(req.user, req.params.id, req.body)));
  router.post('/actuators/:id/commands', auth, wrap(async (req, res) => {
    // 202: diterima dan diteruskan ke gateway; sukses hanya setelah ACK (lihat SSE/GET command).
    res.status(202).json(await iot.sendCommand(req.user, req.params.id, req.body));
  }));
  router.get('/actuators/:id/commands', auth, json(req => iot.listCommands(req.user, req.params.id, req.query.limit)));
  router.get('/commands/:id', auth, json(req => iot.getCommand(req.user, req.params.id)));

  // ── API internal AI worker lokal (Bearer WORKER_TOKEN)
  const worker = express.Router();
  worker.use(requireWorker(workerToken));
  worker.get('/forecast-requests', json(() => forecast.workerRequests()));
  worker.patch('/forecast-requests/:kumbungId', json(req => forecast.workerUpdateRequest(req.params.kumbungId, req.body)));
  worker.get('/kumbungs/:id/feature-inputs', json(req => forecast.workerFeatureInputs(req.params.id, String(req.query.dates || '').split(',').filter(Boolean))));
  worker.get('/kumbungs/:id/sensors/:sensorId/latest', json(req => forecast.workerReadSensor(req.params.id, req.params.sensorId)));
  worker.put('/kumbungs/:id/features/:dateKey', wrap(async (req, res) => {
    await forecast.workerWriteFeatures(req.params.id, req.params.dateKey, req.body);
    res.status(204).end();
  }));
  worker.put('/kumbungs/:id/forecasts/:forecastId', wrap(async (req, res) => {
    await forecast.workerWriteForecast(req.params.id, req.params.forecastId, req.body);
    res.status(204).end();
  }));
  worker.get('/kumbungs/:id/forecasts/latest', json(req => forecast.workerLatestForecast(req.params.id)));
  worker.put('/status', wrap(async (req, res) => {
    await forecast.workerHeartbeat(req.body);
    res.status(204).end();
  }));
  router.use('/worker', worker);

  return router;
}

export function errorHandler(log) {
  // eslint-disable-next-line no-unused-vars
  return (error, req, res, next) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.code, message: error.message });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json', message: 'Body bukan JSON valid.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'Body terlalu besar.' });
    log.error?.('[http]', error);
    return res.status(500).json({ error: 'internal', message: 'Terjadi kesalahan server.' });
  };
}
