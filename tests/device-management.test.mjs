import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATEWAY_OFFLINE_AFTER_MS,
  buildAssignSensorUpdates,
  buildCreateGatewayUpdates,
  emailDirectoryKey,
  gatewayConfigPending,
  gatewayConnectionState,
} from '../apps/web/src/lib/deviceManagementPlan.js';
import { alertId, buildAlertRecord, hasAlertContext, sortAlerts } from '../apps/web/src/lib/alerts.js';

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
