// Uji end-to-end domain (pengganti Firebase RTDB): akun, farm, anggota, kumbung, batch, panen,
// operasional, pengaturan, forecast + API worker. Jalankan: npm run test:e2e:domain -w apps/api
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKER_TOKEN, startStack, step } from './e2e-harness.mjs';

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'local_ai_worker');
const WORKER_PYTHON = join(WORKER_DIR, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

const stack = await startStack();
const { api } = stack;
const carolStream = stack.openStream('carol');
let exitCode = 0;
const DAY = 86400000;

try {
  // ═══ AKUN
  assert.equal((await api('GET', '/me', { user: null })).status, 401);
  const me = await api('GET', '/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.email, 'alice@dev.local');
  assert.deepEqual(me.body.farms, []);
  assert.equal((await api('PATCH', '/me', { body: { username: 'Alice' } })).body.username, 'Alice');
  assert.equal((await api('PATCH', '/me', { body: { username: '' } })).status, 400);
  const saved = await api('PUT', '/me/settings', { body: { language: 'id', alertTempWarnHigh: 30, telegramBotToken: 'rahasia' } });
  assert.deepEqual(saved.body, { language: 'id', alertTempWarnHigh: 30 });
  assert.deepEqual((await api('GET', '/me/settings')).body, { language: 'id', alertTempWarnHigh: 30 });
  assert.deepEqual((await api('GET', '/me/settings', { user: 'bob' })).body, {});
  step('akun: user tercatat otomatis dari token, profil & preferensi per user, field rahasia dibuang');

  // ═══ FARM & ANGGOTA
  const farm = await api('POST', '/farms', { body: { name: 'Farm Sidoarjo', location: 'Sidoarjo' } });
  assert.equal(farm.status, 201);
  assert.match(farm.body.id, /^FARM-[0-9A-F]{8}$/);
  assert.equal(farm.body.role, 'owner');
  const F = farm.body.id;
  assert.equal((await api('POST', '/farms', { body: { id: F, name: 'Dobel' } })).status, 409);
  assert.equal((await api('POST', '/farms', { body: { name: '' } })).status, 400);
  assert.equal((await api('GET', `/farms/${F}`, { user: 'bob' })).status, 404);
  assert.equal((await api('PATCH', `/farms/${F}`, { body: { location: 'Sidoarjo, Jatim' } })).body.location, 'Sidoarjo, Jatim');

  assert.equal((await api('POST', `/farms/${F}/members`, { body: { email: 'dave@dev.local' } })).body.error, 'user_not_found', 'user belum pernah login');
  await api('GET', '/me', { user: 'carol' });
  const added = await api('POST', `/farms/${F}/members`, { body: { email: 'CAROL@dev.local' } });
  assert.equal(added.status, 201);
  assert.equal(added.body.role, 'operator');
  await carolStream.waitEvent(e => e.event === 'changed' && e.data.entity === 'member', 'SSE anggota');
  assert.equal((await api('POST', `/farms/${F}/members`, { body: { email: 'alice@dev.local' } })).status, 400);
  assert.equal((await api('POST', `/farms/${F}/members`, { user: 'carol', body: { email: 'bob@dev.local' } })).status, 403);
  assert.equal((await api('PATCH', `/farms/${F}`, { user: 'carol', body: { name: 'X' } })).status, 403);
  const members = (await api('GET', `/farms/${F}/members`, { user: 'carol' })).body;
  assert.deepEqual(members.map(m => [m.email, m.role]), [['alice@dev.local', 'owner'], ['carol@dev.local', 'operator']]);
  assert.equal((await api('DELETE', `/farms/${F}/members/alice`)).status, 409, 'owner tidak bisa dicabut');
  assert.equal((await api('GET', '/farms', { user: 'carol' })).body[0].role, 'operator');
  step('farm & anggota: farm baru (pembuat = owner), operator lewat email terdaftar, hak owner/operator ditegakkan, farm lain 404');

  // ═══ KUMBUNG
  const k1 = await api('POST', `/farms/${F}/kumbungs`, { body: { name: 'Kumbung A', capacityBaglog: 1000, status: 'active' } });
  const k2 = await api('POST', `/farms/${F}/kumbungs`, { body: { name: 'Kumbung B', capacityBaglog: '250', status: 'maintenance' } });
  assert.deepEqual([k1.body.id, k2.body.id], [`${F}-K01`, `${F}-K02`]);
  assert.equal(k2.body.capacityBaglog, 250);
  const K = k1.body.id;
  assert.equal((await api('POST', `/farms/${F}/kumbungs`, { user: 'carol', body: { name: 'X', capacityBaglog: 1, status: 'active' } })).status, 403);
  assert.equal((await api('POST', `/farms/${F}/kumbungs`, { body: { name: 'X', capacityBaglog: 0, status: 'active' } })).status, 400);
  assert.equal((await api('POST', `/farms/${F}/kumbungs`, { body: { name: 'X', capacityBaglog: 5, status: 'rusak' } })).status, 400);
  assert.equal((await api('PATCH', `/kumbungs/${K}`, { body: { status: 'inactive' } })).body.status, 'inactive');
  assert.equal((await api('PATCH', `/kumbungs/${K}`, { body: { status: 'active' } })).body.name, 'Kumbung A');
  assert.equal((await api('PATCH', `/kumbungs/${K}`, { user: 'bob', body: { status: 'active' } })).status, 404);
  const profile = await api('PUT', `/kumbungs/${K}/harvest-profile`, { body: { mushroomType: 'Tiram', fruitingStartDate: '2026-10-01', standardDays: 14 } });
  assert.equal(profile.body.harvestProfile.standardDays, 14);
  assert.equal((await api('PUT', `/kumbungs/${K}/harvest-profile`, { body: { fruitingStartDate: 'kemarin', standardDays: 14 } })).status, 400);
  assert.equal((await api('GET', `/farms/${F}/kumbungs`, { user: 'carol' })).body.length, 2);
  step('kumbung: ID berurutan per farm, validasi kapasitas/status, ubah sebagian, profil estimasi panen, hanya owner');

  // ═══ BATCH & PANEN
  const startedAt = Date.now() - 20 * DAY;
  const batchBody = { startedAt, baglogCountInitial: 1000, baglogCountActive: 980, substrateType: 'serbuk-kayu', growthStage: 'incubation', contaminationPct: 2, status: 'active' };
  const batch = await api('POST', `/kumbungs/${K}/batches`, { user: 'carol', body: batchBody });
  assert.equal(batch.status, 201);
  assert.equal(batch.body.id, `${K}-B01`);
  assert.equal(batch.body.createdBy, 'carol');
  const B = batch.body.id;
  assert.equal((await api('POST', `/kumbungs/${K}/batches`, { body: { ...batchBody, baglogCountActive: 2000 } })).status, 400);
  assert.equal((await api('POST', `/kumbungs/${K}/batches`, { body: { ...batchBody, substrateType: 'pasir' } })).status, 400);
  assert.equal((await api('POST', `/kumbungs/${K}/batches`, { user: 'bob', body: batchBody })).status, 404);
  const advanced = await api('PATCH', `/batches/${B}`, { user: 'carol', body: { growthStage: 'harvesting' } });
  assert.equal(advanced.body.growthStage, 'harvesting');
  assert.equal(advanced.body.baglogCountActive, 980);

  const harvest = await api('POST', `/kumbungs/${K}/harvests`, { user: 'carol', body: { batchId: B, harvestedAt: Date.now() - DAY, weightKg: 12.5, grade: 'A', gradeAPct: 80, notes: 'panen pagi' } });
  assert.equal(harvest.status, 201);
  assert.equal(harvest.body.recordedBy, 'carol');
  assert.equal((await api('POST', `/kumbungs/${K}/harvests`, { body: { batchId: B, harvestedAt: startedAt - DAY, weightKg: 1, grade: 'A', gradeAPct: 1 } })).status, 400, 'sebelum batch mulai');
  assert.equal((await api('POST', `/kumbungs/${K}/harvests`, { body: { batchId: B, harvestedAt: Date.now() + DAY, weightKg: 1, grade: 'A', gradeAPct: 1 } })).status, 400, 'masa depan');
  assert.equal((await api('POST', `/kumbungs/${k2.body.id}/harvests`, { body: { batchId: B, harvestedAt: Date.now(), weightKg: 1, grade: 'A', gradeAPct: 1 } })).status, 400, 'batch kumbung lain');
  assert.equal((await api('POST', `/kumbungs/${K}/harvests`, { body: { batchId: B, harvestedAt: Date.now() - DAY, weightKg: 13, grade: 'A', gradeAPct: 80, correctsEventId: harvest.body.id } })).status, 400, 'koreksi tanpa alasan');
  const correction = await api('POST', `/kumbungs/${K}/harvests`, { body: { batchId: B, harvestedAt: Date.now() - DAY, weightKg: 13, grade: 'A', gradeAPct: 80, correctsEventId: harvest.body.id, correctionReason: 'Timbangan salah' } });
  assert.equal(correction.status, 201);
  assert.equal((await api('POST', `/kumbungs/${K}/harvests`, { body: { batchId: B, harvestedAt: Date.now() - DAY, weightKg: 1, grade: 'A', gradeAPct: 1, correctsEventId: correction.body.id, correctionReason: 'x' } })).status, 400, 'koreksi atas koreksi');

  const ops = (await api('GET', '/operations', { user: 'carol' })).body;
  assert.deepEqual(ops.roles, { [F]: 'operator' });
  assert.equal(ops.kumbungs.length, 2);
  assert.equal(ops.batches[0].id, B);
  assert.equal(ops.harvestAudit.length, 2);
  assert.ok(ops.harvestAudit.some(event => event.correctsEventId === harvest.body.id && event.correctionReason === 'Timbangan salah'));
  assert.deepEqual((await api('GET', '/operations', { user: 'bob' })).body.farms, []);
  step('batch & panen: ID berurutan per kumbung, validasi (baglog, substrat, waktu panen), operator boleh mencatat, koreksi append-only, data operasional agregat');

  // ═══ KEGIATAN KUMBUNG & REKAP
  const care = await api('POST', `/kumbungs/${K}/activities`, { user: 'carol', body: { type: 'care', items: ['misting', 'cleaning'], notes: 'pagi' } });
  assert.equal(care.status, 201);
  assert.equal(care.body.batchId, B, 'otomatis ke batch aktif');
  assert.equal((await api('POST', `/kumbungs/${K}/activities`, { body: { type: 'care', items: [] } })).status, 400, 'minimal satu kegiatan');
  assert.equal((await api('POST', `/kumbungs/${K}/activities`, { body: { type: 'care', items: ['misting'], quantity: 3 } })).status, 400, 'jumlah baglog hanya untuk kontaminasi');
  assert.equal((await api('POST', `/kumbungs/${K}/activities`, { body: { type: 'problem', items: ['contamination'], quantity: 5000 } })).status, 400, 'melebihi baglog aktif');
  assert.equal((await api('POST', `/kumbungs/${K}/activities`, { user: 'bob', body: { type: 'care', items: ['misting'] } })).status, 404, 'farm lain');
  const problem = await api('POST', `/kumbungs/${K}/activities`, { user: 'carol', body: { type: 'problem', items: ['contamination'], quantity: 30, notes: 'jamur hijau; rak 2' } });
  assert.equal(problem.body.quantity, 30);
  let batchNow = (await api('GET', '/operations')).body.batches.find(item => item.id === B);
  assert.deepEqual([batchNow.baglogCountActive, batchNow.contaminationPct], [950, 5], 'baglog aktif berkurang & kontaminasi dihitung');
  assert.equal((await api('POST', `/activities/${problem.body.id}/void`, { user: 'carol', body: {} })).status, 400, 'alasan wajib');
  const extra = await api('POST', `/kumbungs/${K}/activities`, { body: { type: 'problem', items: ['pest'] } });
  assert.equal((await api('POST', `/activities/${extra.body.id}/void`, { user: 'carol', body: { reason: 'x' } })).status, 403, 'operator tidak boleh batalkan catatan orang lain');
  const voided = await api('POST', `/activities/${problem.body.id}/void`, { body: { reason: 'Salah hitung' } });
  assert.equal(voided.body.voidReason, 'Salah hitung');
  batchNow = (await api('GET', '/operations')).body.batches.find(item => item.id === B);
  assert.deepEqual([batchNow.baglogCountActive, batchNow.contaminationPct], [980, 2], 'void mengembalikan baglog');
  assert.equal((await api('POST', `/activities/${problem.body.id}/void`, { body: { reason: 'lagi' } })).status, 409);
  await api('POST', `/kumbungs/${K}/activities`, { user: 'carol', body: { type: 'problem', items: ['contamination'], quantity: 10 } });

  // Ganti tahap tercatat otomatis; menutup batch hanya owner (batch terpisah di kumbung B).
  const recapBefore = (await api('GET', `/farms/${F}/recap?kumbungId=${K}`, { user: 'carol' })).body;
  assert.ok(recapBefore.rows.some(row => row.type === 'phase_change' && row.items.join('>') === 'incubation>harvesting'));
  assert.ok(recapBefore.rows.some(row => row.type === 'batch_start' && row.quantity === 1000));
  const B2 = (await api('POST', `/kumbungs/${k2.body.id}/batches`, { user: 'carol', body: { ...batchBody, mushroomType: 'tiram putih', spawnSource: 'Pak Budi' } })).body;
  assert.deepEqual([B2.mushroomType, B2.spawnSource, B2.endedAt], ['tiram putih', 'Pak Budi', null]);
  assert.equal((await api('PATCH', `/batches/${B2.id}`, { user: 'carol', body: { status: 'cancelled' } })).status, 403, 'operator tidak boleh menutup batch');
  const closed = await api('PATCH', `/batches/${B2.id}`, { body: { status: 'cancelled', closeNote: 'afkir banjir' } });
  assert.ok(closed.body.endedAt);
  const recapB2 = (await api('GET', `/farms/${F}/recap?batchId=${B2.id}&kinds=batch`)).body;
  assert.deepEqual(recapB2.rows.map(row => row.type), ['batch_end', 'batch_start']);
  assert.equal(recapB2.rows[0].notes, 'afkir banjir');

  const recap = (await api('GET', `/farms/${F}/recap?batchId=${B}`, { user: 'carol' })).body;
  assert.equal(recap.range.startAt, null, 'batch tanpa tanggal = seluruh batch');
  assert.equal(recap.summary.harvestKg, 13, 'nilai panen terkoreksi');
  assert.equal(recap.summary.baglogRemoved, 10, 'catatan dibatalkan tidak dihitung');
  assert.equal(recap.summary.careCount, 1);
  assert.equal(recap.rows.find(row => row.kind === 'harvest').corrected, true);
  const onlyHarvest = (await api('GET', `/farms/${F}/recap?kinds=harvest`)).body;
  assert.ok(onlyHarvest.rows.length && onlyHarvest.rows.every(row => row.kind === 'harvest'));
  assert.equal((await api('GET', `/farms/${F}/recap?from=2026-01-10&to=2026-01-01`)).status, 400);
  assert.equal((await api('GET', `/farms/${F}/recap?from=2025-01-01&to=2026-06-01`)).status, 400, 'maks 366 hari');
  assert.equal((await api('GET', `/farms/${F}/recap?kinds=hujan`)).status, 400);
  assert.deepEqual((await api('GET', `/farms/${F}/recap?actor=alice&kinds=care,problem`)).body.rows.map(row => row.items[0]), ['pest'], 'filter pencatat');
  assert.equal((await api('GET', `/farms/${F}/recap`, { user: 'bob' })).status, 404);

  const csv = await fetch(`${stack.base}/farms/${F}/recap.csv?batchId=${B}`, { headers: { Authorization: 'Bearer dev:carol' } });
  const csvBytes = new Uint8Array(await csv.arrayBuffer());
  const csvText = new TextDecoder().decode(csvBytes); // decoder membuang BOM
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /rekap-.*\.csv/);
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM untuk Excel');
  const csvLines = csvText.trim().split('\r\n');
  assert.equal(csvLines[0], 'Tanggal;Jam;Kumbung;Batch;Jenis;Rincian;Baglog;Berat (kg);Mutu;Catatan;Dicatat oleh');
  assert.ok(csvLines.some(line => line.includes(';Panen;Panen 13 kg (dikoreksi);;13;Bagus (A);')), 'baris panen, desimal & mutu');
  assert.ok(csvLines.some(line => line.includes('"jamur hijau; rak 2"')) === false, 'catatan dibatalkan tidak ikut');
  assert.equal((await fetch(`${stack.base}/farms/${F}/recap.csv`, { headers: { Authorization: 'Bearer dev:bob' } })).status, 404);
  step('kegiatan & rekap: catat harian/masalah, baglog dibuang mengurangi batch & void mengembalikan, jejak batch otomatis, tutup batch hanya owner, rekap + filter, CSV Excel');

  // ═══ FORECAST + API WORKER
  assert.equal((await api('GET', '/worker/forecast-requests', { user: null })).status, 401);
  assert.equal((await api('GET', '/worker/forecast-requests')).status, 401, 'token user tidak berlaku untuk API worker');
  const request = await api('POST', `/kumbungs/${K}/forecast-requests`, { user: 'carol', body: { batchId: B } });
  assert.equal(request.status, 201);
  assert.equal(request.body.status, 'pending');
  assert.equal(request.body.schemaVersion, 'ai-request-v1');
  assert.equal((await api('POST', `/kumbungs/${K}/forecast-requests`, { body: { batchId: 'tidak-ada' } })).status, 400);
  const pending = (await api('GET', '/worker/forecast-requests', { token: WORKER_TOKEN })).body;
  assert.equal(pending[K].batchId, B);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const inputs = (await api('GET', `/worker/kumbungs/${K}/feature-inputs?dates=${today}`, { token: WORKER_TOKEN })).body;
  assert.equal(inputs.batches[0].id, B);
  assert.equal(inputs.harvestEvents.length, 2);
  assert.ok(Array.isArray(inputs.telemetry));
  assert.equal((await api('PUT', `/worker/kumbungs/${K}/features/${today}`, { token: WORKER_TOKEN, body: { schemaVersion: 'ai-features-v1', temperature_mean_c: 27 } })).status, 204);
  await api('PATCH', `/worker/forecast-requests/${K}`, { token: WORKER_TOKEN, body: { status: 'processing' } });
  const forecastPayload = { generatedAt: Date.now(), input: { batchId: B, kumbungId: K }, prediction: { harvestKg: 40 }, schemaVersion: 'ai-forecast-v1' };
  assert.equal((await api('PUT', `/worker/kumbungs/${K}/forecasts/fc-1`, { token: WORKER_TOKEN, body: forecastPayload })).status, 204);
  await api('PATCH', `/worker/forecast-requests/${K}`, { token: WORKER_TOKEN, body: { status: 'completed', processedRequestedAt: request.body.requestedAt } });
  await carolStream.waitEvent(e => e.event === 'forecast' && e.data.forecast?.prediction?.harvestKg === 40, 'SSE forecast');
  const view = (await api('GET', `/kumbungs/${K}/forecast`, { user: 'carol' })).body;
  assert.equal(view.forecast.prediction.harvestKg, 40);
  assert.equal(view.history.length, 1);
  assert.equal(view.request.status, 'completed');
  assert.equal(view.request.requestedBy, 'carol', 'patch worker menggabungkan, bukan mengganti');
  assert.equal((await api('GET', `/kumbungs/${K}/forecast`, { user: 'bob' })).status, 404);
  assert.deepEqual((await api('GET', '/forecasts/latest', { user: 'carol' })).body.map(item => item.kumbungId), [K]);
  assert.equal((await api('PUT', '/worker/status', { token: WORKER_TOKEN, body: { status: 'idle', heartbeatAt: Date.now() } })).status, 204);
  assert.equal((await api('GET', '/system/worker-status')).body.status, 'idle');
  step('forecast: permintaan anggota farm, API worker bertoken (permintaan, input fitur, fitur harian, forecast atomik, heartbeat), SSE forecast');

  // Klien Python AI worker (DATA_SOURCE=api) terhadap backend sungguhan.
  if (existsSync(WORKER_PYTHON)) {
    const script = [
      'import json, sys',
      'from worker.config import WorkerConfig',
      'from worker.backend_client import create_client',
      'config = WorkerConfig.load()',
      'with create_client(config) as client:',
      '    requests = client.read_forecast_requests()',
      '    inputs = client.read_feature_inputs(sys.argv[1], [sys.argv[2]])',
      '    latest = client.read_latest_forecast(sys.argv[1])',
      '    client.write_heartbeat("healthy", "e2e", "python")',
      'print(json.dumps({"requests": list(requests), "batches": len(inputs["batches"]), "latest": latest["prediction"]}))',
    ].join('\n');
    // Async: backend berjalan di proses yang sama, jadi event loop tidak boleh diblokir.
    const { stdout: output } = await promisify(execFile)(WORKER_PYTHON, ['-c', script, K, today], {
      cwd: WORKER_DIR,
      env: { ...process.env, DATA_SOURCE: 'api', BACKEND_URL: stack.base, WORKER_TOKEN },
      encoding: 'utf8',
    });
    const parsed = JSON.parse(output.trim().split('\n').at(-1));
    assert.deepEqual(parsed, { requests: [K], batches: 1, latest: { harvestKg: 40 } });
    assert.equal((await api('GET', '/system/worker-status')).body.detail, 'python');
    step('AI worker Python (BackendClient, DATA_SOURCE=api) membaca & menulis lewat API backend');
  } else {
    console.log('… lewati uji AI worker Python (local_ai_worker/.venv tidak ada)');
  }

  // ═══ PENCABUTAN AKSES & ADMIN
  assert.equal((await api('DELETE', `/farms/${F}/members/carol`)).body.removed, true);
  await carolStream.waitEvent(e => e.event === 'changed' && e.data.entity === 'member' && e.data.action === 'remove', 'SSE pencabutan');
  assert.equal((await api('GET', `/farms/${F}/kumbungs`, { user: 'carol' })).status, 404);
  assert.equal((await api('POST', `/kumbungs/${K}/harvests`, { user: 'carol', body: { batchId: B, harvestedAt: Date.now(), weightKg: 1, grade: 'A', gradeAPct: 1 } })).status, 404);
  assert.equal((await api('GET', `/farms/${F}`, { user: 'admin-ops' })).body.role, 'owner', 'platformAdmin');
  const audit = (await api('GET', `/farms/${F}/audit`)).body.map(entry => entry.action);
  for (const action of ['farm_create', 'farm_update', 'operator_add', 'kumbung_create', 'kumbung_update', 'operator_remove']) assert.ok(audit.includes(action), `audit ${action}`);
  step('akses: operator yang dicabut langsung kehilangan akses (+ SSE), platformAdmin, audit farm lengkap');

  // ═══ REGISTRASI PERANGKAT (admin Tandurai)
  assert.equal((await api('POST', '/admin/devices', { body: { count: 1 } })).status, 403, 'user biasa ditolak');
  const created = await api('POST', '/admin/devices', { user: 'admin-ops', body: { count: 2, model: 'TDR-GW2' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.length, 2);
  assert.match(created.body[0].hwUid, /^TDR-[0-9A-F]{12}$/);
  assert.match(created.body[0].claimCode, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.ok(created.body[0].deviceSecret.length >= 20 && created.body[0].mqtt.host);
  assert.equal((await api('POST', '/admin/devices', { user: 'admin-ops', body: { count: 99 } })).status, 400);
  const registry = (await api('GET', '/admin/devices', { user: 'admin-ops' })).body;
  const listed = registry.devices.find(item => item.hwUid === created.body[0].hwUid);
  assert.equal(listed.model, 'TDR-GW2');
  assert.equal(listed.registeredAt, null, 'belum pernah tersambung');
  assert.equal(listed.deviceSecret, undefined, 'secret tidak pernah ditampilkan lagi');
  assert.equal((await api('GET', '/me', { user: 'admin-ops' })).body.deviceAdmin, true);
  step('registrasi perangkat: hanya admin, secret & kode klaim dikembalikan sekali, daftar perangkat dengan status');

  // ═══ KONSOL ADMIN
  for (const path of ['/admin/overview', '/admin/users', '/admin/farms', `/admin/farms/${F}`]) {
    assert.equal((await api('GET', path)).status, 403, `${path}: user biasa ditolak`);
  }
  const overview = (await api('GET', '/admin/overview', { user: 'admin-ops' })).body;
  assert.ok(overview.counts.users >= 3 && overview.counts.farms >= 1 && overview.counts.kumbungs >= 1);
  assert.equal(overview.counts.devices_unclaimed, 2, 'perangkat terdaftar belum diklaim');
  assert.equal(overview.health.database, true);
  assert.equal(overview.health.worker?.name, 'ai', 'heartbeat AI worker terbaca');
  const adminUsers = (await api('GET', '/admin/users', { user: 'admin-ops' })).body;
  assert.ok(adminUsers.find(item => item.uid === 'alice').farms.some(farm => farm.farmId === F && farm.role === 'owner'), 'farm & peran per akun');
  const adminFarms = (await api('GET', '/admin/farms', { user: 'admin-ops' })).body;
  const farmRow = adminFarms.find(item => item.id === F);
  assert.ok(farmRow.owners.includes('alice@dev.local') && farmRow.kumbungs >= 1 && farmRow.harvestKg30d > 0);
  const detail = (await api('GET', `/admin/farms/${F}`, { user: 'admin-ops' })).body;
  assert.ok(detail.members.some(member => member.uid === 'alice' && member.role === 'owner'));
  assert.ok(detail.kumbungs.some(item => item.id === K && item.batch));
  assert.equal((await api('GET', '/admin/farms/TIDAK-ADA', { user: 'admin-ops' })).status, 404);
  // Admin memantau realtime semua farm (bukan anggota) dan bisa membuka data farm klien.
  const adminStream = stack.openStream('admin-ops');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal((await api('POST', `/kumbungs/${K}/activities`, { body: { type: 'care', items: ['cleaning'] } })).status, 201);
  await adminStream.waitEvent(event => event.event === 'changed' && event.data.entity === 'activity' && event.data.farmId === F, 'event farm klien ke admin');
  adminStream.close();
  assert.equal((await api('GET', `/farms/${F}/recap`, { user: 'admin-ops' })).status, 200, 'admin membuka data farm klien');
  step('konsol admin: ringkasan sistem, pengguna & perannya, farm + detail, hanya admin, event realtime semua farm, akses farm klien');

  console.log('\nSemua skenario domain lulus.');
} catch (error) {
  exitCode = 1;
  console.error(`\n✖ ${error.stack || error.message}`);
} finally {
  carolStream.close();
  await stack.close();
  process.exit(exitCode);
}

