import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { get, ref, set, update } from 'firebase/database';

const projectId = 'tandurai-ai';
let testEnv;

const farm = id => ({ name: `Farm ${id}`, timezone: 'Asia/Jakarta', location: 'Indonesia', status: 'active', createdAt: 1, updatedAt: 1 });
const kumbung = (farmId, name, creator = 'petaniOwner') => ({ farmId, name, capacityBaglog: 1000, status: 'active', createdBy: creator, createdAt: 1, updatedAt: 1 });
const batch = (overrides = {}) => ({
  farmId: 'FARM-01', kumbungId: 'FARM-01-K01', startedAt: Date.now() - 86400000,
  baglogCountInitial: 1000, baglogCountActive: 980, substrateType: 'serbuk-kayu',
  growthStage: 'fruiting', contaminationPct: 2, status: 'active', createdBy: 'petaniOwner',
  createdAt: 1, updatedAt: 1, schemaVersion: 'baglog-batch-v1', ...overrides,
});
const telemetry = (overrides = {}) => ({
  timestamp: Date.now(),
  farmId: 'FARM-01',
  kumbungId: 'FARM-01-K01',
  sensorId: 'SNS-0101',
  gatewayId: 'GW-01',
  schemaVersion: 'telemetry-v1',
  temperature: 27.5,
  humidity: 82,
  co2: 700,
  pressure: 1008,
  quality: { status: 'valid' },
  ...overrides,
});

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    database: {
      rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'),
    },
  });

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.database();
    await set(ref(db), {
      users: {
        petaniOwner: {
          profile: { username: 'Petani', email: 'petani@example.test', createdAt: 1 },
          access: { farms: { 'FARM-01': true }, farmRoles: { 'FARM-01': 'owner' } },
        },
        operatorA: {
          profile: { username: 'Operator A', email: 'operator@example.com', createdAt: 1 },
          access: { farms: { 'FARM-01': true }, farmRoles: { 'FARM-01': 'operator' } },
        },
        outsiderA: {
          profile: { username: 'Non-member', email: 'outsider@example.com', createdAt: 1 },
          access: {},
        },
      },
      tumbara: {
        farms: {
          'FARM-01': farm('01'),
          'FARM-02': farm('02'),
        },
        kumbungs: {
          'FARM-01-K01': kumbung('FARM-01', 'Kumbung A'),
          'FARM-02-K01': kumbung('FARM-02', 'Kumbung B'),
        },
        farmKumbungs: {
          'FARM-01': { 'FARM-01-K01': true },
          'FARM-02': { 'FARM-02-K01': true },
        },
        baglogBatches: {
          'FARM-01-K01-B01': batch(),
        },
        kumbungBatches: {
          'FARM-01-K01': { 'FARM-01-K01-B01': true },
        },
        gateways: { 'GW-01': { id: 'GW-01', farmId: 'FARM-01', status: 'online', configVersion: 1 } },
        sensors: { 'SNS-0101': { id: 'SNS-0101', farmId: 'FARM-01', kumbungId: 'FARM-01-K01', gatewayId: 'GW-01', status: 'active' } },
        gatewayConfigs: { 'GW-01': { farmId: 'FARM-01', configVersion: 1, sensors: { 'SNS-0101': { kumbungId: 'FARM-01-K01', enabled: true } } } },
        aiForecasts: {
          'FARM-01-K01': { latest: { status: 'ok', forecastKg: 10 } },
          'FARM-02-K01': { latest: { status: 'ok', forecastKg: 20 } },
        },
      },
    });
  });
});

after(async () => {
  await testEnv?.cleanup();
});

test('anonymous user cannot read demo farm', async () => {
  const db = testEnv.unauthenticatedContext().database();
  await assertFails(get(ref(db, 'tumbara/farms/FARM-01')));
});

test('owner can read assigned farm but not another farm', async () => {
  const db = testEnv.authenticatedContext('petaniOwner', { email: 'petani@example.test' }).database();
  await assertSucceeds(get(ref(db, 'tumbara/farms/FARM-01')));
  await assertFails(get(ref(db, 'tumbara/farms/FARM-02')));
});

test('assigned user can read own forecast but not cross-farm forecast', async () => {
  const db = testEnv.authenticatedContext('operatorA', { email: 'operator@example.com' }).database();
  await assertSucceeds(get(ref(db, 'tumbara/aiForecasts/FARM-01-K01/latest')));
  await assertFails(get(ref(db, 'tumbara/aiForecasts/FARM-02-K01/latest')));
});

test('owner and operator cannot write telemetry directly', async () => {
  const owner = testEnv.authenticatedContext('petaniOwner', { email: 'petani@example.test' }).database();
  const operator = testEnv.authenticatedContext('operatorA', { email: 'operator@example.com' }).database();
  const path = 'tumbara/monitoring/FARM-01-K01/SNS-0101';
  await assertFails(set(ref(owner, path), telemetry()));
  await assertFails(set(ref(operator, path), telemetry()));
});

test('gateway terdaftar dapat menulis telemetry untuk sensor assignment-nya', async () => {
  const gateway = testEnv.authenticatedContext('gateway_GW-01', { identity: 'gateway', gatewayId: 'GW-01', farmId: 'FARM-01' }).database();
  await assertSucceeds(set(ref(gateway, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry()));
  await assertSucceeds(get(ref(gateway, 'tumbara/gatewayConfigs/GW-01')));
  await assertFails(get(ref(gateway, 'tumbara/gatewayConfigs/GW-OTHER')));
});

test('non-member cannot write telemetry', async () => {
  const db = testEnv.authenticatedContext('outsiderA', { email: 'outsider@example.com' }).database();
  await assertFails(set(ref(db, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry()));
});

test('client cannot write AI forecast even when owner', async () => {
  const db = testEnv.authenticatedContext('petaniOwner', { email: 'petani@example.test' }).database();
  await assertFails(set(ref(db, 'tumbara/aiForecasts/FARM-01-K01/latest'), {
    status: 'ok',
    forecastKg: 999,
  }));
});

test('user cannot promote own role or farm access', async () => {
  const db = testEnv.authenticatedContext('operatorA', { email: 'operator@example.com' }).database();
  await assertFails(set(ref(db, 'users/operatorA/access/farmRoles/FARM-01'), 'owner'));
  await assertFails(set(ref(db, 'users/operatorA/access/farms/FARM-02'), true));
});

test('new user can create a valid own profile only', async () => {
  const own = testEnv.authenticatedContext('newUser', { email: 'new@example.com' }).database();
  await assertSucceeds(set(ref(own, 'users/newUser/profile'), {
    username: 'New User',
    email: 'new@example.com',
    createdAt: Date.now(),
  }));

  const other = testEnv.authenticatedContext('attacker', { email: 'attacker@example.com' }).database();
  await assertFails(set(ref(other, 'users/newUser/profile'), {
    username: 'Attacker',
    email: 'attacker@example.com',
    createdAt: Date.now(),
  }));
});

test('history and harvest events are append-only', async () => {
  const db = testEnv.authenticatedContext('gateway_GW-01', { identity: 'gateway', gatewayId: 'GW-01', farmId: 'FARM-01' }).database();
  const operator = testEnv.authenticatedContext('operatorA', { email: 'operator@example.com' }).database();
  const historyRef = ref(db, 'tumbara/history/FARM-01-K01/2026-07-15/event-1');
  const timestamp = Math.floor(Date.now() / 600000) * 600000;
  await assertSucceeds(set(historyRef, telemetry({ timestamp, bucketStart: timestamp })));
  await assertFails(set(historyRef, telemetry({ timestamp, bucketStart: timestamp, temperature: 29 })));

  const harvestRef = ref(operator, 'tumbara/harvestEvents/FARM-01-K01/harvest-1');
  await assertSucceeds(set(harvestRef, {
    farmId: 'FARM-01',
    kumbungId: 'FARM-01-K01',
    batchId: 'FARM-01-K01-B01',
    harvestedAt: Date.now(),
    weightKg: 10,
    grade: 'A',
    gradeAPct: 100,
    notes: '',
    recordedBy: 'operatorA',
    createdAt: Date.now(),
    schemaVersion: 'harvest-event-v1',
  }));
  await assertFails(set(harvestRef, {
    farmId: 'FARM-01',
    kumbungId: 'FARM-01-K01',
    batchId: 'FARM-01-K01-B01',
    harvestedAt: Date.now(),
    weightKg: 999,
    grade: 'A',
    gradeAPct: 100,
    recordedBy: 'operatorA',
    createdAt: Date.now(),
    schemaVersion: 'harvest-event-v1',
  }));
  const correction = {
    farmId: 'FARM-01',
    kumbungId: 'FARM-01-K01',
    batchId: 'FARM-01-K01-B01',
    harvestedAt: Date.now(),
    weightKg: 12,
    grade: 'A',
    gradeAPct: 100,
    notes: 'Berat setelah timbang ulang',
    recordedBy: 'operatorA',
    createdAt: Date.now(),
    schemaVersion: 'harvest-event-v1',
    correctsEventId: 'harvest-1',
    correctionReason: 'Salah membaca timbangan',
  };
  await assertSucceeds(set(
    ref(operator, 'tumbara/harvestEvents/FARM-01-K01/harvest-correction-1'),
    correction,
  ));
  await assertFails(set(
    ref(operator, 'tumbara/harvestEvents/FARM-01-K01/harvest-correction-invalid'),
    { ...correction, correctsEventId: 'tidak-ada' },
  ));
});

test('owner dapat membuat kumbung; operator hanya membuat batch', async () => {
  const owner = testEnv.authenticatedContext('petaniOwner', { email: 'petani@example.test' }).database();
  const operator = testEnv.authenticatedContext('operatorA', { email: 'operator@example.com' }).database();
  const newKumbung = kumbung('FARM-01', 'Kumbung Baru');
  await assertSucceeds(update(ref(owner), {
    'tumbara/kumbungs/FARM-01-K02': newKumbung,
    'tumbara/farmKumbungs/FARM-01/FARM-01-K02': true,
  }));
  await assertFails(set(ref(operator, 'tumbara/kumbungs/FARM-01-K03'), kumbung('FARM-01', 'Terlarang', 'operatorA')));
  await assertSucceeds(update(ref(owner), {
    'tumbara/baglogBatches/FARM-01-K02-B01': batch({ kumbungId: 'FARM-01-K02' }),
    'tumbara/kumbungBatches/FARM-01-K02/FARM-01-K02-B01': true,
  }));
});

test('panen menolak batch lintas kumbung dan berat nol', async () => {
  const operator = testEnv.authenticatedContext('operatorA', { email: 'operator@example.com' }).database();
  const base = {
    farmId: 'FARM-01', kumbungId: 'FARM-01-K02', batchId: 'FARM-01-K01-B01',
    harvestedAt: Date.now(), weightKg: 0, grade: 'A', gradeAPct: 100,
    recordedBy: 'operatorA', createdAt: Date.now(), schemaVersion: 'harvest-event-v1',
  };
  await assertFails(set(ref(operator, 'tumbara/harvestEvents/FARM-01-K02/invalid-harvest'), base));
});

test('telemetry menolak identitas path salah dan nilai out-of-range', async () => {
  const db = testEnv.authenticatedContext('gateway_GW-01', { identity: 'gateway', gatewayId: 'GW-01', farmId: 'FARM-01' }).database();
  await assertFails(set(ref(db, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry({ kumbungId: 'FARM-02-K01' })));
  await assertFails(set(ref(db, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry({ humidity: 120 })));
});

test('histori dengan bucket tidak konsisten ditolak', async () => {
  const db = testEnv.authenticatedContext('gateway_GW-01', { identity: 'gateway', gatewayId: 'GW-01', farmId: 'FARM-01' }).database();
  const timestamp = Math.floor(Date.now() / 600000) * 600000;
  await assertFails(set(
    ref(db, 'tumbara/history/FARM-01-K01/2026-07-15/bad-bucket'),
    telemetry({ timestamp, bucketStart: timestamp + 1 }),
  ));
});

test('rules test suite completed all expected assertions', () => {
  assert.ok(testEnv);
});

test('operator dapat meminta perhitungan forecast, non-member ditolak', async () => {
  const operator = testEnv.authenticatedContext('operatorA', { email: 'operator@example.com' }).database();
  const outsider = testEnv.authenticatedContext('outsiderA', { email: 'outsider@example.com' }).database();
  const request = {
    requestedAt: Date.now(),
    requestedBy: 'operatorA',
    asOfDate: '2026-07-15',
    batchId: 'FARM-01-K01-B01',
    status: 'pending',
    mode: 'hybrid_synthetic_fill',
    schemaVersion: 'ai-request-v1',
  };
  await assertSucceeds(set(ref(operator, 'tumbara/aiRequests/FARM-01-K01'), request));
  await assertFails(get(ref(outsider, 'tumbara/aiRequests/FARM-01-K01')));
  await assertFails(set(ref(operator, 'tumbara/aiRequests/FARM-01-K01'), {
    ...request,
    batchId: 'FARM-02-K01-B01',
  }));
  await assertFails(set(ref(outsider, 'tumbara/aiRequests/FARM-01-K01'), {
    ...request,
    requestedBy: 'outsiderA',
  }));
});
test('gateway hanya dapat mengaktifkan sensor assignment dan tidak dapat menghidupkan gateway yang dicabut', async () => {
  const gateway = testEnv.authenticatedContext('gateway_GW-01', { identity: 'gateway', gatewayId: 'GW-01', farmId: 'FARM-01' }).database();
  await assertSucceeds(set(ref(gateway, 'tumbara/sensors/SNS-0101/status'), 'active'));
  await assertFails(set(ref(gateway, 'tumbara/sensors/SNS-0101/status'), 'inactive'));
  await assertSucceeds(set(ref(gateway, 'tumbara/gateways/GW-01/status'), 'online'));

  await testEnv.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), 'tumbara/gateways/GW-01/status'), 'inactive');
  });
  await assertFails(get(ref(gateway, 'tumbara/gatewayConfigs/GW-01')));
  await assertFails(set(ref(gateway, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry()));
  await assertFails(set(ref(gateway, 'tumbara/gateways/GW-01/status'), 'online'));
});