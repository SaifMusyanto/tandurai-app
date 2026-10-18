// Uji impor ekspor RTDB → PostgreSQL lalu verifikasi lewat API. Jalankan: npm run test:e2e:import -w apps/api
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyImport } from './import-rtdb.mjs';
import { planImport } from './rtdb-import-plan.mjs';
import { startStack, step } from './e2e-harness.mjs';

const fixture = JSON.parse(readFileSync(new URL('../test/fixtures/rtdb-export.json', import.meta.url), 'utf8'));
const stack = await startStack();
const { api, backend } = stack;
let exitCode = 0;

try {
  const plan = planImport(fixture, { harvestProfileKumbungId: 'FARM-01-K01' });
  const anomalyTypes = plan.anomalies.map(item => item.type).sort();
  assert.deepEqual(anomalyTypes, ['akses_tanpa_role', 'anggota_tanpa_akses', 'batch_tidak_valid', 'farm_tidak_valid', 'kumbung_tidak_valid', 'panen_tidak_valid']);
  assert.ok(plan.skipped.some(item => item.includes('config/alerts')), 'token Telegram global tidak diimpor');
  assert.equal(plan.telemetry.length, 3, '3 baris history (2 di bucket sama) + 1 latest → 3 bucket 10 menit');

  const first = await applyImport(backend.pool, plan);
  assert.equal(first.farms, 1);
  assert.equal(first.members, 2);
  assert.equal(first.harvests, 2);
  assert.equal(first.telemetry, 3);
  const second = await applyImport(backend.pool, planImport(fixture, { harvestProfileKumbungId: 'FARM-01-K01' }));
  for (const [key, value] of Object.entries(second)) if (key !== 'users') assert.equal(value, 0, `impor ulang ${key} harus 0 baris baru`);
  step('impor: data tidak valid dilaporkan sebagai anomali (tidak diimpor), rahasia tidak ikut, impor ulang idempoten');

  const me = (await api('GET', '/me', { user: 'owner1' })).body;
  assert.equal(me.email, 'owner1@dev.local', 'email login (token) menggantikan email ekspor');
  assert.deepEqual(me.farms.map(farm => [farm.id, farm.role]), [['FARM-01', 'owner']]);
  assert.deepEqual((await api('GET', '/me/settings', { user: 'owner1' })).body, { language: 'id', alertTempWarnHigh: 30 });
  const ops = (await api('GET', '/operations', { user: 'op1' })).body;
  assert.deepEqual(ops.roles, { 'FARM-01': 'operator' });
  assert.deepEqual(ops.kumbungs.map(k => [k.id, k.harvestProfile?.standardDays]), [['FARM-01-K01', 14]]);
  assert.deepEqual(ops.batches.map(b => b.id), ['FARM-01-K01-B01']);
  assert.ok(ops.harvestAudit.some(event => event.correctsEventId === '-Nh1' && event.correctionReason === 'Timbangan salah'));
  assert.equal((await api('GET', '/operations', { user: 'ghost' })).body.farms.length, 0, 'akses tanpa role tidak diberi hak');
  assert.equal((await api('GET', '/alerts?status=active', { user: 'op1' })).body[0].id, 'SNS-0101_humidity_low');
  const audit = (await api('GET', '/farms/FARM-01/audit', { user: 'owner1' })).body;
  assert.equal(audit[0].action, 'operator_add');
  assert.equal(audit[0].targetUid, 'op1');
  step('API: user, farm & role, kumbung + profil panen, batch, ledger koreksi panen, alert, audit terbaca seperti di RTDB');

  const gateways = (await api('GET', '/gateways', { user: 'op1' })).body;
  assert.equal(gateways.length, 1);
  assert.equal(gateways[0].id, 'LEGACY-FARM-01');
  assert.equal(gateways[0].sensors[0].id, 'SNS-0101');
  assert.equal(gateways[0].sensors[0].kumbungId, 'FARM-01-K01');
  const rows = (await api('GET', '/kumbungs/FARM-01-K01/telemetry?from=2025-10-09T00:00:00Z&to=2025-10-11T00:00:00Z', { user: 'op1' })).body;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].co2, 650);
  assert.equal(rows[1].co2, undefined, 'nilai di luar rentang dibuang');
  const forecast = (await api('GET', '/kumbungs/FARM-01-K01/forecast', { user: 'op1' })).body;
  assert.equal(forecast.forecast.prediction.harvestKg, 40);
  assert.equal(forecast.history.length, 1);
  assert.equal(forecast.request.status, 'completed');
  step('telemetry lama → gateway virtual LEGACY per farm (bucket 10 menit, nilai tidak valid dibuang), forecast & permintaan AI terbawa');

  console.log('\nSemua skenario impor lulus.');
} catch (error) {
  exitCode = 1;
  console.error(`\n✖ ${error.stack || error.message}`);
} finally {
  await stack.close();
  process.exit(exitCode);
}
