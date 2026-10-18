import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATEWAY_OFFLINE_AFTER_MS,
  buildAssignSensorUpdates,
  buildAuditEntry,
  sensorAssignmentAction,
  buildCreateGatewayUpdates,
  emailDirectoryKey,
  gatewayConfigPending,
  gatewayConnectionState,
  sensorHealth,
} from '../apps/web/src/lib/deviceManagementPlan.js';
import { alertId, buildAlertRecord, hasAlertContext, sortAlerts } from '../apps/web/src/lib/alerts.js';
import { readStoredSelection, resolveSelection, writeStoredSelection } from '../apps/web/src/lib/farmContext.js';

const now = 1_800_000_000_000;

test('status koneksi gateway diturunkan dari status, authUid, dan lastSeenAt', () => {
  assert.equal(gatewayConnectionState({ status: 'inactive', authUid: 'u', lastSeenAt: now }, now), 'inactive');
  assert.equal(gatewayConnectionState({ status: 'pending' }, now), 'pending');
  assert.equal(gatewayConnectionState({ status: 'pending', authUid: 'u' }, now), 'paired');
  assert.equal(gatewayConnectionState({ status: 'online', authUid: 'u', lastSeenAt: now - GATEWAY_OFFLINE_AFTER_MS }, now), 'online');
  assert.equal(gatewayConnectionState({ status: 'online', authUid: 'u', lastSeenAt: now - GATEWAY_OFFLINE_AFTER_MS - 1 }, now), 'offline');
});

test('config pending bila appliedConfigVersion tertinggal', () => {
  assert.equal(gatewayConfigPending({ configVersion: 2, appliedConfigVersion: 1 }), true);
  assert.equal(gatewayConfigPending({ configVersion: 2, appliedConfigVersion: 2 }), false);
  assert.equal(gatewayConfigPending({ configVersion: 0 }), true);
});

test('key direktori email sama dengan transformasi Rules', () => {
  assert.equal(emailDirectoryKey(' Petani.Satu@Example.co.id '), 'petani,satu@example,co,id');
});

test('pembuatan gateway menulis registry, indeks farm, dan config awal per field', () => {
  const updates = buildCreateGatewayUpdates({ farmId: 'FARM-01', gatewayId: 'GW-01', name: ' Gateway ', ownerUid: 'owner', now });
  assert.equal(updates['tumbara/gateways/GW-01'].status, 'pending');
  assert.equal(updates['tumbara/gateways/GW-01'].name, 'Gateway');
  assert.equal(updates['tumbara/farmGateways/FARM-01/GW-01'], true);
  assert.equal(updates['tumbara/gatewayConfigs/GW-01/configVersion'], 0);
  assert.throws(() => buildCreateGatewayUpdates({ farmId: 'FARM-01', gatewayId: 'GW 01', name: 'x', ownerUid: 'owner' }));
});

test('pindah sensor membersihkan indeks lama dan menaikkan kedua versi config', () => {
  const { updates, configVersion } = buildAssignSensorUpdates({
    farmId: 'FARM-01', kumbungId: 'K2', sensorId: 'S1', gatewayId: 'GW-B', name: 'Sensor',
    ownerUid: 'owner', now,
    currentSensor: { farmId: 'FARM-01', kumbungId: 'K1', gatewayId: 'GW-A', createdBy: 'lama', createdAt: 1 },
    configVersions: { 'GW-A': 4, 'GW-B': 7 },
  });
  assert.equal(configVersion, 8);
  assert.equal(updates['tumbara/gatewayConfigs/GW-A/configVersion'], 5);
  assert.equal(updates['tumbara/gatewayConfigs/GW-A/sensors/S1'], null);
  assert.equal(updates['tumbara/kumbungSensors/K1/S1'], null);
  assert.equal(updates['tumbara/sensors/S1'].status, 'pending');
  assert.equal(updates['tumbara/sensors/S1'].createdBy, 'lama');
  assert.throws(() => buildAssignSensorUpdates({
    farmId: 'FARM-02', kumbungId: 'K2', sensorId: 'S1', gatewayId: 'GW-B', name: 'Sensor', ownerUid: 'owner',
    currentSensor: { farmId: 'FARM-01' }, configVersions: {},
  }), /lintas farm/);
});

test('record alert per sensor membawa konteks farm dan transisi aktif/pulih', () => {
  const context = { farmId: 'FARM-01', kumbungId: 'K1', sensorId: 'S1' };
  const active = buildAlertRecord({ context, alert: { key: 'co2_high', severity: 'critical', value: 1300, threshold: 1200, message: 'x' }, now });
  assert.equal(active.id, alertId('S1', 'co2_high'));
  assert.equal(active.farmId, 'FARM-01');
  assert.equal(active.status, 'active');
  assert.equal(active.startedAt, now);

  const resolved = buildAlertRecord({ context, alert: { key: 'co2_high', severity: 'normal', value: 700, threshold: 800, message: 'y' }, previous: active, now: now + 1000 });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolvedAt, now + 1000);
  assert.equal(resolved.startedAt, now);

  assert.equal(hasAlertContext({ farmId: 'FARM-01', kumbungId: 'K1' }), false);
  assert.deepEqual(sortAlerts([{ status: 'resolved', updatedAt: 9 }, { status: 'active', updatedAt: 1 }]).map(a => a.status), ['active', 'resolved']);
});

test('kesehatan sensor dari laporan ack gateway', () => {
  const sensor = { id: 'S1', status: 'active' };
  assert.equal(sensorHealth({ ...sensor, status: 'inactive' }, null, now).state, 'inactive');
  assert.equal(sensorHealth(sensor, null, now).state, 'unknown');
  assert.equal(sensorHealth(sensor, { sensors: { S1: { state: 'ok', lastReadAt: now - 1000 } } }, now).state, 'ok');
  assert.equal(sensorHealth(sensor, { sensors: { S1: { state: 'ok', lastReadAt: now - GATEWAY_OFFLINE_AFTER_MS - 1 } } }, now).state, 'stale');
  const broken = sensorHealth(sensor, { sensors: { S1: { state: 'not_found', error: 'tidak menjawab' } } }, now);
  assert.equal(broken.state, 'not_found');
  assert.equal(broken.error, 'tidak menjawab');
});

test('konteks dashboard memakai pilihan tersimpan yang valid dan jatuh ke opsi pertama', () => {
  const farms = [{ id: 'F1' }, { id: 'F2' }];
  const kumbungs = [{ id: 'K1' }, { id: 'K2' }];
  const sensors = [
    { id: 'S1', kumbungId: 'K1', status: 'pending' },
    { id: 'S2', kumbungId: 'K1', status: 'active' },
    { id: 'S3', kumbungId: 'K2', status: 'inactive' },
  ];
  assert.deepEqual(resolveSelection({ farms, kumbungs, sensors, stored: {} }), { farmId: 'F1', kumbungId: 'K1', sensorId: 'S2', legacy: false });
  assert.equal(resolveSelection({ farms, kumbungs, sensors, stored: { sensorId: 'S1' } }).sensorId, 'S1');
  assert.equal(resolveSelection({ farms, kumbungs, sensors, stored: { farmId: 'F9', kumbungId: 'K2' } }).farmId, 'F1');
  assert.deepEqual(resolveSelection({ farms, kumbungs, sensors, stored: { kumbungId: 'K2' } }), { farmId: 'F1', kumbungId: 'K2', sensorId: null, legacy: false });
  const legacy = resolveSelection({ farms, kumbungs: [{ id: 'FARM-01-K01' }], sensors: [], stored: {} });
  assert.deepEqual(legacy, { farmId: 'F1', kumbungId: 'FARM-01-K01', sensorId: 'SNS-0101', legacy: true });
  assert.deepEqual(resolveSelection({}), { farmId: null, kumbungId: null, sensorId: null, legacy: false });
});

test('pilihan konteks disimpan per user dan tahan terhadap storage rusak', () => {
  const store = new Map();
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  writeStoredSelection('u1', { farmId: 'F1', kumbungId: 'K1', sensorId: 'S1', legacy: true }, storage);
  assert.deepEqual(readStoredSelection('u1', storage), { farmId: 'F1', kumbungId: 'K1', sensorId: 'S1' });
  assert.deepEqual(readStoredSelection('u2', storage), {});
  store.set('tandurai-context:u3', '{rusak');
  assert.deepEqual(readStoredSelection('u3', storage), {});
});

test('entri audit hanya membawa field yang diisi dan menolak aksi asing', () => {
  const updates = buildAuditEntry({ farmId: 'F1', actorUid: 'owner', action: 'sensor_move', details: { sensorId: 'S1', fromKumbungId: 'K1', toKumbungId: '', configVersion: 0 }, now, logId: 'L1' });
  assert.deepEqual(updates, { 'tumbara/assignmentLog/F1/L1': { action: 'sensor_move', actorUid: 'owner', createdAt: now, sensorId: 'S1', fromKumbungId: 'K1', configVersion: 0 } });
  assert.throws(() => buildAuditEntry({ farmId: 'F1', actorUid: 'owner', action: 'hapus' }));
  assert.equal(sensorAssignmentAction(null, { kumbungId: 'K1', gatewayId: 'G1' }), 'sensor_assign');
  assert.equal(sensorAssignmentAction({ kumbungId: 'K1', gatewayId: 'G1', status: 'active' }, { kumbungId: 'K2', gatewayId: 'G1' }), 'sensor_move');
  assert.equal(sensorAssignmentAction({ kumbungId: 'K1', gatewayId: 'G1', status: 'active' }, { kumbungId: 'K1', gatewayId: 'G1' }), 'sensor_update');
  assert.equal(sensorAssignmentAction({ kumbungId: 'K1', gatewayId: 'G1', status: 'inactive' }, { kumbungId: 'K1', gatewayId: 'G1' }), 'sensor_assign');
});

test('role per farm hanya dari farmRoles, bukan role global lama', async () => {
  const { farmRoleOf, farmRolesOf } = await import('../apps/web/src/lib/access.js');
  const access = { farms: { F1: true, F2: true, F3: false }, farmRoles: { F1: 'owner', F3: 'owner', F4: 'operator' }, role: 'manager' };
  assert.equal(farmRoleOf(access, 'F1'), 'owner');
  assert.equal(farmRoleOf(access, 'F2'), null);
  assert.equal(farmRoleOf(access, 'F3'), null);
  assert.equal(farmRoleOf(access, 'F4'), null);
  assert.equal(farmRoleOf(undefined, 'F1'), null);
  assert.deepEqual(farmRolesOf(access), { F1: 'owner' });
});
