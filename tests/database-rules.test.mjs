import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { get, ref, set, update } from 'firebase/database';
import {
  buildAddOperatorUpdates,
  buildAssignSensorUpdates,
  buildCreateGatewayUpdates,
  buildDeactivateSensorUpdates,
  buildDirectoryEntryUpdates,
  buildDisableGatewayUpdates,
  buildPairGatewayUpdates,
  buildReactivateGatewayUpdates,
  buildRemoveOperatorUpdates,
  buildUnpairGatewayUpdates,
} from '../apps/web/src/lib/deviceManagementPlan.js';
import { buildAlertRecord } from '../apps/web/src/lib/alerts.js';

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
const gateway = (farmId, overrides = {}) => ({
  farmId, name: 'Gateway', status: 'online', configVersion: 0, appliedConfigVersion: 0,
  createdBy: 'petaniOwner', createdAt: 1, updatedAt: 1, ...overrides,
});
const sensor = (overrides = {}) => ({
  id: 'SNS-0101', farmId: 'FARM-01', kumbungId: 'FARM-01-K01', gatewayId: 'GW-01', name: 'Sensor Utara',
  status: 'active', createdBy: 'petaniOwner', createdAt: 1, updatedAt: 1, ...overrides,
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
const historyRecord = (overrides = {}) => {
  const timestamp = Math.floor(Date.now() / 600000) * 600000;
  return telemetry({ timestamp, bucketStart: timestamp, ...overrides });
};

const seed = () => ({
  users: {
    petaniOwner: {
      profile: { username: 'Petani', email: 'petani@example.test', createdAt: 1 },
      access: { farms: { 'FARM-01': true }, farmRoles: { 'FARM-01': 'owner' } },
    },
    operatorA: {
      profile: { username: 'Operator A', email: 'operator@example.com', createdAt: 1 },
      access: { farms: { 'FARM-01': true }, farmRoles: { 'FARM-01': 'operator' } },
    },
    owner2: {
      profile: { username: 'Owner 2', email: 'owner2@example.com', createdAt: 1 },
      access: { farms: { 'FARM-02': true }, farmRoles: { 'FARM-02': 'owner' } },
    },
    candidateB: {
      profile: { username: 'Calon', email: 'calon.b@example.com', createdAt: 1 },
    },
    outsiderA: {
      profile: { username: 'Non-member', email: 'outsider@example.com', createdAt: 1 },
    },
  },
  userDirectory: {
    'calon,b@example,com': { uid: 'candidateB', updatedAt: 1 },
    'operator@example,com': { uid: 'operatorA', updatedAt: 1 },
  },
  tumbara: {
    farms: { 'FARM-01': farm('01'), 'FARM-02': farm('02') },
    kumbungs: {
      'FARM-01-K01': kumbung('FARM-01', 'Kumbung A'),
      'FARM-01-K02': kumbung('FARM-01', 'Kumbung B'),
      'FARM-02-K01': kumbung('FARM-02', 'Kumbung C', 'owner2'),
    },
    farmKumbungs: {
      'FARM-01': { 'FARM-01-K01': true, 'FARM-01-K02': true },
      'FARM-02': { 'FARM-02-K01': true },
    },
    farmMembers: {
      'FARM-01': {
        petaniOwner: { role: 'owner', status: 'active', createdAt: 1, updatedAt: 1 },
        operatorA: { role: 'operator', status: 'active', email: 'operator@example.com', invitedBy: 'petaniOwner', createdAt: 1, updatedAt: 1 },
      },
      'FARM-02': { owner2: { role: 'owner', status: 'active', createdAt: 1, updatedAt: 1 } },
    },
    baglogBatches: { 'FARM-01-K01-B01': batch() },
    kumbungBatches: { 'FARM-01-K01': { 'FARM-01-K01-B01': true } },
    gateways: {
      'GW-01': gateway('FARM-01', { id: 'GW-01', authUid: 'anonGw1', configVersion: 1, appliedConfigVersion: 1 }),
      'GW-02': gateway('FARM-01', { id: 'GW-02', status: 'pending' }),
      'GW-F2': gateway('FARM-02', { id: 'GW-F2', authUid: 'anonGwF2', createdBy: 'owner2' }),
    },
    farmGateways: { 'FARM-01': { 'GW-01': true, 'GW-02': true }, 'FARM-02': { 'GW-F2': true } },
    gatewayAuthUids: { anonGw1: 'GW-01', anonGwF2: 'GW-F2' },
    gatewayConfigs: {
      'GW-01': { farmId: 'FARM-01', configVersion: 1, updatedAt: 1, sensors: { 'SNS-0101': { kumbungId: 'FARM-01-K01', enabled: true } } },
      'GW-02': { farmId: 'FARM-01', configVersion: 0, updatedAt: 1 },
      'GW-F2': { farmId: 'FARM-02', configVersion: 0, updatedAt: 1 },
    },
    sensors: { 'SNS-0101': sensor() },
    kumbungSensors: { 'FARM-01-K01': { 'SNS-0101': true } },
    gatewaySensors: { 'GW-01': { 'SNS-0101': true } },
    aiForecasts: {
      'FARM-01-K01': { latest: { status: 'ok', forecastKg: 10 } },
      'FARM-02-K01': { latest: { status: 'ok', forecastKg: 20 } },
    },
  },
});

const anonymousToken = { firebase: { sign_in_provider: 'anonymous' } };
const ownerDb = () => testEnv.authenticatedContext('petaniOwner', { email: 'petani@example.test', email_verified: true }).database();
const operatorDb = () => testEnv.authenticatedContext('operatorA', { email: 'operator@example.com', email_verified: true }).database();
const outsiderDb = () => testEnv.authenticatedContext('outsiderA', { email: 'outsider@example.com', email_verified: true }).database();
const gatewayDb = (uid = 'anonGw1') => testEnv.authenticatedContext(uid, anonymousToken).database();
const adminRead = async path => {
  let value;
  await testEnv.withSecurityRulesDisabled(async context => {
    value = (await get(ref(context.database(), path))).val();
  });
  return value;
};
const adminWrite = async (path, value) => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), path), value);
  });
};

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    database: {
      rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await adminWrite('/', seed());
});

after(async () => {
  await testEnv?.cleanup();
});

// ---------------------------------------------------------------- akses manusia

test('anonymous user cannot read demo farm', async () => {
  const db = testEnv.unauthenticatedContext().database();
  await assertFails(get(ref(db, 'tumbara/farms/FARM-01')));
});

test('owner can read assigned farm but not another farm', async () => {
  await assertSucceeds(get(ref(ownerDb(), 'tumbara/farms/FARM-01')));
  await assertFails(get(ref(ownerDb(), 'tumbara/farms/FARM-02')));
});

test('assigned user can read own forecast but not cross-farm forecast', async () => {
  await assertSucceeds(get(ref(operatorDb(), 'tumbara/aiForecasts/FARM-01-K01/latest')));
  await assertFails(get(ref(operatorDb(), 'tumbara/aiForecasts/FARM-02-K01/latest')));
});

test('client cannot write AI forecast even when owner', async () => {
  await assertFails(set(ref(ownerDb(), 'tumbara/aiForecasts/FARM-01-K01/latest'), { status: 'ok', forecastKg: 999 }));
});

test('user cannot promote own role or farm access', async () => {
  await assertFails(set(ref(operatorDb(), 'users/operatorA/access/farmRoles/FARM-01'), 'owner'));
  await assertFails(set(ref(operatorDb(), 'users/operatorA/access/farms/FARM-02'), true));
});

test('new user can create a valid own profile only', async () => {
  const own = testEnv.authenticatedContext('newUser', { email: 'new@example.com' }).database();
  await assertSucceeds(set(ref(own, 'users/newUser/profile'), { username: 'New User', email: 'new@example.com', createdAt: Date.now() }));
  const other = testEnv.authenticatedContext('attacker', { email: 'attacker@example.com' }).database();
  await assertFails(set(ref(other, 'users/newUser/profile'), { username: 'Attacker', email: 'attacker@example.com', createdAt: Date.now() }));
});

test('owner dapat membuat kumbung; operator hanya membuat batch', async () => {
  await assertSucceeds(update(ref(ownerDb()), {
    'tumbara/kumbungs/FARM-01-K03': kumbung('FARM-01', 'Kumbung Baru'),
    'tumbara/farmKumbungs/FARM-01/FARM-01-K03': true,
  }));
  await assertFails(set(ref(operatorDb(), 'tumbara/kumbungs/FARM-01-K04'), kumbung('FARM-01', 'Terlarang', 'operatorA')));
  await assertSucceeds(update(ref(operatorDb()), {
    'tumbara/baglogBatches/FARM-01-K02-B01': batch({ kumbungId: 'FARM-01-K02', createdBy: 'operatorA' }),
    'tumbara/kumbungBatches/FARM-01-K02/FARM-01-K02-B01': true,
  }));
});

test('harvest events append-only dan koreksi harus menunjuk event valid', async () => {
  const harvestRef = ref(operatorDb(), 'tumbara/harvestEvents/FARM-01-K01/harvest-1');
  const harvest = {
    farmId: 'FARM-01', kumbungId: 'FARM-01-K01', batchId: 'FARM-01-K01-B01', harvestedAt: Date.now(),
    weightKg: 10, grade: 'A', gradeAPct: 100, notes: '', recordedBy: 'operatorA', createdAt: Date.now(),
    schemaVersion: 'harvest-event-v1',
  };
  await assertSucceeds(set(harvestRef, harvest));
  await assertFails(set(harvestRef, { ...harvest, weightKg: 999 }));
  const correction = { ...harvest, weightKg: 12, notes: 'Timbang ulang', correctsEventId: 'harvest-1', correctionReason: 'Salah membaca timbangan' };
  await assertSucceeds(set(ref(operatorDb(), 'tumbara/harvestEvents/FARM-01-K01/harvest-correction-1'), correction));
  await assertFails(set(ref(operatorDb(), 'tumbara/harvestEvents/FARM-01-K01/harvest-correction-2'), { ...correction, correctsEventId: 'tidak-ada' }));
});

test('panen menolak batch lintas kumbung dan berat nol', async () => {
  await assertFails(set(ref(operatorDb(), 'tumbara/harvestEvents/FARM-01-K02/invalid-harvest'), {
    farmId: 'FARM-01', kumbungId: 'FARM-01-K02', batchId: 'FARM-01-K01-B01',
    harvestedAt: Date.now(), weightKg: 0, grade: 'A', gradeAPct: 100,
    recordedBy: 'operatorA', createdAt: Date.now(), schemaVersion: 'harvest-event-v1',
  }));
});

test('operator dapat meminta perhitungan forecast, non-member ditolak', async () => {
  const request = {
    requestedAt: Date.now(), requestedBy: 'operatorA', asOfDate: '2026-07-15', batchId: 'FARM-01-K01-B01',
    status: 'pending', mode: 'hybrid_synthetic_fill', schemaVersion: 'ai-request-v1',
  };
  await assertSucceeds(set(ref(operatorDb(), 'tumbara/aiRequests/FARM-01-K01'), request));
  await assertFails(get(ref(outsiderDb(), 'tumbara/aiRequests/FARM-01-K01')));
  await assertFails(set(ref(operatorDb(), 'tumbara/aiRequests/FARM-01-K01'), { ...request, batchId: 'FARM-02-K01-B01' }));
  await assertFails(set(ref(outsiderDb(), 'tumbara/aiRequests/FARM-01-K01'), { ...request, requestedBy: 'outsiderA' }));
});

test('akses baca legacy tetap hidup: anggota farm membaca latest, history lama, dan sensor1', async () => {
  const legacy = historyRecord();
  delete legacy.gatewayId; // record sebelum gateway-only tidak punya gatewayId
  await adminWrite('tumbara/history/FARM-01-K01/2026-07-15/legacy-1', legacy);
  await adminWrite('tumbara/monitoring/FARM-01-K01/SNS-0101', telemetry());
  await adminWrite('tumbara/monitoring/sensor1', { temperature: 27 });
  for (const db of [ownerDb(), operatorDb()]) {
    await assertSucceeds(get(ref(db, 'tumbara/monitoring/FARM-01-K01/SNS-0101')));
    await assertSucceeds(get(ref(db, 'tumbara/history/FARM-01-K01/2026-07-15')));
    await assertSucceeds(get(ref(db, 'tumbara/monitoring/sensor1')));
    await assertSucceeds(get(ref(db, 'tumbara/kumbungSensors/FARM-01-K01')));
    await assertSucceeds(get(ref(db, 'tumbara/sensors/SNS-0101')));
    await assertSucceeds(get(ref(db, 'tumbara/gateways/GW-01')));
    await assertSucceeds(get(ref(db, 'tumbara/farmMembers/FARM-01')));
  }
  await assertFails(get(ref(outsiderDb(), 'tumbara/monitoring/FARM-01-K01/SNS-0101')));
  await assertFails(get(ref(outsiderDb(), 'tumbara/history/FARM-01-K01/2026-07-15')));
  await assertFails(get(ref(outsiderDb(), 'tumbara/sensors/SNS-0101')));
  await assertFails(get(ref(outsiderDb(), 'tumbara/farmMembers/FARM-01')));
});

// ---------------------------------------------------------------- direktori & operator

test('user terverifikasi hanya dapat mendaftarkan email miliknya ke direktori', async () => {
  const verified = testEnv.authenticatedContext('newUser', { email: 'New.User@Example.com', email_verified: true }).database();
  await assertSucceeds(update(ref(verified), buildDirectoryEntryUpdates({ uid: 'newUser', email: 'New.User@Example.com' })));
  await assertFails(update(ref(verified), buildDirectoryEntryUpdates({ uid: 'newUser', email: 'orang.lain@example.com' })));
  await assertFails(set(ref(verified, 'userDirectory/new,user@example,com'), { uid: 'someoneElse', updatedAt: 1 }));

  const unverified = testEnv.authenticatedContext('lazyUser', { email: 'lazy@example.com', email_verified: false }).database();
  await assertFails(update(ref(unverified), buildDirectoryEntryUpdates({ uid: 'lazyUser', email: 'lazy@example.com' })));
  await assertFails(get(ref(verified, 'userDirectory')));
});

test('owner menambahkan operator dari direktori email secara atomik', async () => {
  const updates = buildAddOperatorUpdates({ farmId: 'FARM-01', ownerUid: 'petaniOwner', operatorUid: 'candidateB', email: 'Calon.B@example.com', now: 5 });
  await assertFails(update(ref(operatorDb()), updates));
  await assertSucceeds(update(ref(ownerDb()), updates));
  assert.equal(await adminRead('users/candidateB/access/farmRoles/FARM-01'), 'operator');
  assert.equal(await adminRead('tumbara/farmMembers/FARM-01/candidateB/role'), 'operator');
});

test('penambahan operator menolak UID yang tidak cocok dengan email, update parsial, dan owner farm lain', async () => {
  await assertFails(update(ref(ownerDb()), buildAddOperatorUpdates({ farmId: 'FARM-01', ownerUid: 'petaniOwner', operatorUid: 'outsiderA', email: 'calon.b@example.com' })));
  await assertFails(set(ref(ownerDb(), 'users/candidateB/access/farms/FARM-01'), true));
  const owner2 = testEnv.authenticatedContext('owner2', { email: 'owner2@example.com', email_verified: true }).database();
  await assertFails(update(ref(owner2), buildAddOperatorUpdates({ farmId: 'FARM-01', ownerUid: 'owner2', operatorUid: 'candidateB', email: 'calon.b@example.com' })));
});

test('owner mencabut operator; owner tidak dapat dicabut atau diturunkan', async () => {
  await assertFails(set(ref(ownerDb(), 'tumbara/farmMembers/FARM-01/operatorA'), null));
  await assertSucceeds(update(ref(ownerDb()), buildRemoveOperatorUpdates({ farmId: 'FARM-01', uid: 'operatorA' })));
  assert.equal(await adminRead('users/operatorA/access/farms/FARM-01'), null);

  await adminWrite('users/owner2/access/farms/FARM-01', true);
  await adminWrite('users/owner2/access/farmRoles/FARM-01', 'owner');
  await adminWrite('tumbara/farmMembers/FARM-01/owner2', { role: 'owner', status: 'active', createdAt: 1, updatedAt: 1 });
  await assertFails(update(ref(ownerDb()), buildRemoveOperatorUpdates({ farmId: 'FARM-01', uid: 'owner2' })));
});

// ---------------------------------------------------------------- gateway & pairing

test('owner membuat gateway pending; ID duplikat dan operator ditolak', async () => {
  const create = id => buildCreateGatewayUpdates({ farmId: 'FARM-01', gatewayId: id, name: 'Gateway Baru', ownerUid: 'petaniOwner' });
  await assertSucceeds(update(ref(ownerDb()), create('GW-NEW')));
  assert.equal(await adminRead('tumbara/gateways/GW-NEW/status'), 'pending');
  await assertFails(update(ref(ownerDb()), create('GW-NEW')));
  await assertFails(update(ref(ownerDb()), create('GW-F2')));
  await assertFails(update(ref(operatorDb()), buildCreateGatewayUpdates({ farmId: 'FARM-01', gatewayId: 'GW-OP', name: 'X', ownerUid: 'operatorA' })));
  await assertSucceeds(get(ref(ownerDb(), 'tumbara/gateways/GW-BELUM-ADA')));
  await assertFails(get(ref(ownerDb(), 'tumbara/gateways/GW-F2')));
});

test('UID anonim yang belum dipasangkan tidak dapat membaca config atau menulis telemetry', async () => {
  const unpaired = gatewayDb('anonBaru');
  await assertFails(get(ref(unpaired, 'tumbara/gatewayConfigs/GW-02')));
  await assertFails(get(ref(unpaired, 'tumbara/gateways/GW-02')));
  await assertFails(set(ref(unpaired, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry({ gatewayId: 'GW-02' })));
  await assertFails(set(ref(unpaired, 'tumbara/gatewayAuthUids/anonBaru'), 'GW-02'));
  await assertFails(set(ref(unpaired, 'tumbara/gateways/GW-02/authUid'), 'anonBaru'));
});

test('hanya owner farm yang dapat memasangkan UID ke gateway pending', async () => {
  const pair = buildPairGatewayUpdates({ gatewayId: 'GW-02', authUid: 'anonBaru' });
  await assertFails(update(ref(operatorDb()), pair));
  await assertFails(update(ref(ownerDb()), buildPairGatewayUpdates({ gatewayId: 'GW-02', authUid: 'operatorA' })));
  await assertFails(update(ref(ownerDb()), buildPairGatewayUpdates({ gatewayId: 'GW-01', authUid: 'anonBaru' })));
  await assertFails(update(ref(ownerDb()), buildPairGatewayUpdates({ gatewayId: 'GW-02', authUid: 'anonGwF2' })));
  await assertFails(set(ref(ownerDb(), 'tumbara/gatewayAuthUids/anonBaru'), 'GW-02'));
  await assertSucceeds(update(ref(ownerDb()), pair));

  const paired = gatewayDb('anonBaru');
  await assertSucceeds(get(ref(paired, 'tumbara/gatewayConfigs/GW-02')));
  await assertSucceeds(get(ref(paired, 'tumbara/gatewayAuthUids/anonBaru')));
  await assertSucceeds(update(ref(paired, 'tumbara/gateways/GW-02'), { status: 'online', lastSeenAt: Date.now(), firmwareVersion: 'sim/0.1.0', appliedConfigVersion: 0 }));
});

test('owner melepas pairing; UID lama kehilangan akses dan gateway dapat dipasangkan ulang', async () => {
  await assertSucceeds(update(ref(ownerDb()), buildUnpairGatewayUpdates({ gatewayId: 'GW-01', authUid: 'anonGw1' })));
  await assertFails(get(ref(gatewayDb(), 'tumbara/gatewayConfigs/GW-01')));
  await assertSucceeds(update(ref(ownerDb()), buildPairGatewayUpdates({ gatewayId: 'GW-01', authUid: 'anonPengganti' })));
  await assertSucceeds(get(ref(gatewayDb('anonPengganti'), 'tumbara/gatewayConfigs/GW-01')));
});

test('mapping UID yang menggantung tanpa gateway.authUid tidak memberi akses', async () => {
  await adminWrite('tumbara/gatewayAuthUids/anonLama', 'GW-01');
  await assertFails(get(ref(gatewayDb('anonLama'), 'tumbara/gatewayConfigs/GW-01')));
  await assertFails(set(ref(gatewayDb('anonLama'), 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry()));
});

test('gateway terpasang hanya membaca config dan katalog miliknya', async () => {
  const gw = gatewayDb();
  await assertSucceeds(get(ref(gw, 'tumbara/gatewayConfigs/GW-01')));
  await assertSucceeds(get(ref(gw, 'tumbara/gateways/GW-01')));
  await assertSucceeds(get(ref(gw, 'tumbara/sensors/SNS-0101')));
  await assertSucceeds(get(ref(gw, 'tumbara/gatewaySensors/GW-01')));
  await assertFails(get(ref(gw, 'tumbara/gatewayConfigs/GW-02')));
  await assertFails(get(ref(gw, 'tumbara/gatewayConfigs/GW-F2')));
  await assertFails(get(ref(gw, 'tumbara/gateways/GW-F2')));
  await assertFails(get(ref(gw, 'tumbara/farms/FARM-01')));
  await assertFails(set(ref(gw, 'tumbara/gateways/GW-01/configVersion'), 99));
  await assertFails(set(ref(gw, 'tumbara/gateways/GW-01/farmId'), 'FARM-02'));
  await assertFails(set(ref(gw, 'tumbara/gateways/GW-01/appliedConfigVersion'), 5));
});

test('owner mencabut gateway: status inactive dan seluruh akses gateway ditolak', async () => {
  await assertSucceeds(update(ref(ownerDb()), buildDisableGatewayUpdates({ gatewayId: 'GW-01', authUid: 'anonGw1', ownerUid: 'petaniOwner' })));
  const gw = gatewayDb();
  await assertFails(get(ref(gw, 'tumbara/gatewayConfigs/GW-01')));
  await assertFails(set(ref(gw, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry()));
  await assertFails(set(ref(gw, 'tumbara/gateways/GW-01/status'), 'online'));
});

test('gateway inactive ditolak meskipun mapping UID masih ada', async () => {
  await adminWrite('tumbara/gateways/GW-01/status', 'inactive');
  const gw = gatewayDb();
  await assertFails(get(ref(gw, 'tumbara/gatewayConfigs/GW-01')));
  await assertFails(set(ref(gw, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry()));
  await assertFails(set(ref(gw, 'tumbara/gateways/GW-01/status'), 'online'));
});

// ---------------------------------------------------------------- telemetry

test('owner dan operator tidak dapat menulis telemetry', async () => {
  const path = 'tumbara/monitoring/FARM-01-K01/SNS-0101';
  await assertFails(set(ref(ownerDb(), path), telemetry()));
  await assertFails(set(ref(operatorDb(), path), telemetry()));
  await assertFails(set(ref(outsiderDb(), path), telemetry()));
  await assertFails(set(ref(operatorDb(), 'tumbara/history/FARM-01-K01/2026-07-15/x'), historyRecord()));
});

test('gateway menulis latest dan history untuk sensor assignment-nya', async () => {
  const gw = gatewayDb();
  await assertSucceeds(set(ref(gw, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry()));
  const record = historyRecord();
  const historyPath = `tumbara/history/FARM-01-K01/2026-07-15/SNS-0101_${record.timestamp}`;
  await assertSucceeds(get(ref(gw, historyPath)));
  await assertSucceeds(set(ref(gw, historyPath), record));
  await assertSucceeds(get(ref(gw, historyPath)));
  await assertFails(set(ref(gw, historyPath), { ...record, temperature: 29 }));
});

test('telemetry menolak gateway lain, farm lain, path salah, dan nilai out-of-range', async () => {
  const gw = gatewayDb();
  await assertFails(set(ref(gw, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry({ gatewayId: 'GW-02' })));
  await assertFails(set(ref(gw, 'tumbara/monitoring/FARM-01-K02/SNS-0101'), telemetry({ kumbungId: 'FARM-01-K02' })));
  await assertFails(set(ref(gw, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry({ kumbungId: 'FARM-02-K01' })));
  await assertFails(set(ref(gw, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry({ humidity: 120 })));
  await assertFails(set(ref(gw, 'tumbara/monitoring/FARM-01-K01/SNS-TIDAK-ADA'), telemetry({ sensorId: 'SNS-TIDAK-ADA' })));

  const gwFarm2 = gatewayDb('anonGwF2');
  await assertFails(set(ref(gwFarm2, 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry({ gatewayId: 'GW-F2' })));
  await assertFails(set(ref(gwFarm2, 'tumbara/history/FARM-01-K01/2026-07-15/x'), historyRecord({ gatewayId: 'GW-F2' })));
  await assertFails(get(ref(gwFarm2, 'tumbara/history/FARM-01-K01/2026-07-15/x')));
});

test('history: bucket tidak konsisten ditolak dan gateway tidak membaca record gateway lain', async () => {
  const gw = gatewayDb();
  const record = historyRecord();
  await assertFails(set(ref(gw, 'tumbara/history/FARM-01-K01/2026-07-15/bad-bucket'), { ...record, bucketStart: record.bucketStart + 1 }));
  await adminWrite('tumbara/history/FARM-01-K01/2026-07-15/legacy', { ...record, gatewayId: 'GW-LAMA' });
  await assertFails(get(ref(gw, 'tumbara/history/FARM-01-K01/2026-07-15/legacy')));
  await assertFails(get(ref(gw, 'tumbara/history/FARM-01-K01/2026-07-15')));
});

test('sensor pending atau inactive tidak dapat menerima telemetry', async () => {
  await adminWrite('tumbara/sensors/SNS-0101/status', 'pending');
  await assertFails(set(ref(gatewayDb(), 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry()));
});

// ---------------------------------------------------------------- sensor assignment

const assign = (overrides = {}, currentSensor = null, configVersions = { 'GW-01': 1, 'GW-02': 0 }) =>
  buildAssignSensorUpdates({
    farmId: 'FARM-01', kumbungId: 'FARM-01-K02', sensorId: 'SNS-0102', gatewayId: 'GW-01',
    name: 'Sensor Selatan', hardwareAddress: 'bus:2', ownerUid: 'petaniOwner',
    currentSensor, configVersions, ...overrides,
  }).updates;

test('owner menambah sensor di kumbung lain lewat gateway yang sama; config version naik', async () => {
  await assertFails(update(ref(operatorDb()), assign()));
  await assertSucceeds(update(ref(ownerDb()), assign()));
  assert.equal(await adminRead('tumbara/gatewayConfigs/GW-01/configVersion'), 2);
  assert.equal(await adminRead('tumbara/gateways/GW-01/configVersion'), 2);
  assert.equal(await adminRead('tumbara/sensors/SNS-0102/status'), 'pending');
  await assertSucceeds(get(ref(gatewayDb(), 'tumbara/sensors/SNS-0102')));
});

test('penugasan sensor menolak versi basi, kumbung/gateway lintas farm, dan update tidak lengkap', async () => {
  await assertFails(update(ref(ownerDb()), assign({}, null, { 'GW-01': 0 })));
  await assertFails(update(ref(ownerDb()), assign({ kumbungId: 'FARM-02-K01' })));
  await assertFails(update(ref(ownerDb()), assign({ gatewayId: 'GW-F2' }, null, { 'GW-F2': 0 })));
  const partial = assign();
  delete partial['tumbara/kumbungSensors/FARM-01-K02/SNS-0102'];
  await assertFails(update(ref(ownerDb()), partial));
  const noBump = assign();
  delete noBump['tumbara/gatewayConfigs/GW-01/configVersion'];
  delete noBump['tumbara/gateways/GW-01/configVersion'];
  await assertFails(update(ref(ownerDb()), noBump));
  const forcedActive = assign();
  forcedActive['tumbara/sensors/SNS-0102'] = { ...forcedActive['tumbara/sensors/SNS-0102'], status: 'active' };
  await assertFails(update(ref(ownerDb()), forcedActive));
  const owner2 = testEnv.authenticatedContext('owner2', { email: 'owner2@example.com', email_verified: true }).database();
  await assertFails(update(ref(owner2), assign({ farmId: 'FARM-02', kumbungId: 'FARM-02-K01', sensorId: 'SNS-0101', gatewayId: 'GW-F2' }, null, { 'GW-F2': 0 })));
});

test('memindahkan sensor ke gateway dan kumbung lain menaikkan versi kedua config', async () => {
  const current = await adminRead('tumbara/sensors/SNS-0101');
  const updates = assign({ sensorId: 'SNS-0101', gatewayId: 'GW-02', kumbungId: 'FARM-01-K02', name: 'Sensor Utara' }, current);
  await assertSucceeds(update(ref(ownerDb()), updates));
  assert.equal(await adminRead('tumbara/gatewayConfigs/GW-01/configVersion'), 2);
  assert.equal(await adminRead('tumbara/gatewayConfigs/GW-01/sensors/SNS-0101'), null);
  assert.equal(await adminRead('tumbara/gatewayConfigs/GW-02/configVersion'), 1);
  assert.equal(await adminRead('tumbara/kumbungSensors/FARM-01-K01/SNS-0101'), null);
  await assertFails(set(ref(gatewayDb(), 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry()));
});

test('gateway hanya dapat mengaktifkan sensor assignment-nya', async () => {
  await assertSucceeds(update(ref(ownerDb()), assign()));
  await assertFails(set(ref(gatewayDb('anonGwF2'), 'tumbara/sensors/SNS-0102/status'), 'active'));
  await assertFails(set(ref(ownerDb(), 'tumbara/sensors/SNS-0102/status'), 'active'));
  await assertSucceeds(set(ref(gatewayDb(), 'tumbara/sensors/SNS-0102/status'), 'active'));
  await assertFails(set(ref(gatewayDb(), 'tumbara/sensors/SNS-0102/status'), 'inactive'));
});

test('owner menonaktifkan sensor; gateway tidak dapat mengaktifkannya kembali', async () => {
  const current = { ...(await adminRead('tumbara/sensors/SNS-0101')), id: 'SNS-0101' };
  await assertSucceeds(update(ref(ownerDb()), buildDeactivateSensorUpdates({ currentSensor: current, configVersion: 1 })));
  assert.equal(await adminRead('tumbara/gatewayConfigs/GW-01/sensors/SNS-0101/enabled'), false);
  await assertFails(set(ref(gatewayDb(), 'tumbara/sensors/SNS-0101/status'), 'active'));
  await assertFails(set(ref(gatewayDb(), 'tumbara/monitoring/FARM-01-K01/SNS-0101'), telemetry()));
});

// ---------------------------------------------------------------- Fase 2: indeks gateway & aktivasi ulang

test('indeks farmGateways dibaca anggota farm dan ditulis owner untuk gateway farm-nya', async () => {
  await assertSucceeds(get(ref(operatorDb(), 'tumbara/farmGateways/FARM-01')));
  await assertFails(get(ref(outsiderDb(), 'tumbara/farmGateways/FARM-01')));
  await assertFails(get(ref(operatorDb(), 'tumbara/farmGateways/FARM-02')));
  await assertFails(set(ref(ownerDb(), 'tumbara/farmGateways/FARM-01/GW-F2'), true));
  await assertFails(set(ref(operatorDb(), 'tumbara/farmGateways/FARM-01/GW-02'), true));
  await assertFails(set(ref(ownerDb(), 'tumbara/farmGateways/FARM-01/GW-01'), null));
  await assertSucceeds(update(ref(ownerDb()), buildCreateGatewayUpdates({ farmId: 'FARM-01', gatewayId: 'GW-IDX', name: 'Index', ownerUid: 'petaniOwner' })));
  assert.equal(await adminRead('tumbara/farmGateways/FARM-01/GW-IDX'), true);
});

test('owner mengaktifkan ulang gateway yang dicabut lalu memasangkan UID baru', async () => {
  await assertSucceeds(update(ref(ownerDb()), buildDisableGatewayUpdates({ gatewayId: 'GW-01', authUid: 'anonGw1', ownerUid: 'petaniOwner' })));
  await assertFails(update(ref(ownerDb()), buildPairGatewayUpdates({ gatewayId: 'GW-01', authUid: 'anonBaru' })));
  await assertFails(update(ref(operatorDb()), buildReactivateGatewayUpdates({ gatewayId: 'GW-01' })));
  await assertSucceeds(update(ref(ownerDb()), buildReactivateGatewayUpdates({ gatewayId: 'GW-01' })));
  assert.equal(await adminRead('tumbara/gateways/GW-01/status'), 'pending');
  await assertSucceeds(update(ref(ownerDb()), buildPairGatewayUpdates({ gatewayId: 'GW-01', authUid: 'anonBaru' })));
  await assertSucceeds(get(ref(gatewayDb('anonBaru'), 'tumbara/gatewayConfigs/GW-01')));
  await assertFails(get(ref(gatewayDb(), 'tumbara/gatewayConfigs/GW-01')));
});

// ---------------------------------------------------------------- alert per farm

const alertRecord = (overrides = {}, alert = { key: 'temperature_high', severity: 'warning', value: 31, threshold: 30, message: 'Suhu tinggi' }) =>
  ({ ...buildAlertRecord({ context: { farmId: 'FARM-01', kumbungId: 'FARM-01-K01', sensorId: 'SNS-0101' }, alert, now: Date.now() }), ...overrides });

test('alert per farm: anggota membaca dan menulis fallback hanya untuk farm-nya', async () => {
  const path = 'tumbara/alerts/FARM-01/SNS-0101_temperature_high';
  await assertSucceeds(set(ref(operatorDb(), path), alertRecord()));
  await assertSucceeds(get(ref(ownerDb(), 'tumbara/alerts/FARM-01')));
  await assertFails(get(ref(outsiderDb(), 'tumbara/alerts/FARM-01')));
  await assertFails(get(ref(operatorDb(), 'tumbara/alerts/FARM-02')));
  await assertFails(get(ref(operatorDb(), 'tumbara/alerts')));
  await assertFails(set(ref(outsiderDb(), path), alertRecord()));
  await assertFails(set(ref(operatorDb(), path), null));
  await assertFails(set(ref(gatewayDb(), path), alertRecord()));
});

test('alert menolak farm/kumbung tidak cocok, ID tidak sesuai, dan nilai enum asing', async () => {
  await assertFails(set(ref(operatorDb(), 'tumbara/alerts/FARM-01/SNS-0101_temperature_high'), alertRecord({ kumbungId: 'FARM-02-K01' })));
  await assertFails(set(ref(operatorDb(), 'tumbara/alerts/FARM-01/SNS-0101_temperature_high'), alertRecord({ farmId: 'FARM-02' })));
  await assertFails(set(ref(operatorDb(), 'tumbara/alerts/FARM-01/salah'), alertRecord()));
  await assertFails(set(ref(operatorDb(), 'tumbara/alerts/FARM-01/SNS-0101_temperature_high'), alertRecord({ severity: 'panik' })));
  await assertFails(set(ref(operatorDb(), 'tumbara/alerts/FARM-01/SNS-0101_temperature_high'), alertRecord({ status: 'dibaca' })));
});
