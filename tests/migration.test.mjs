import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyUpdatesToObject, planMigration } from '../tools/migration-plan.mjs';

const now = 1_800_000_000_000;
const record = (overrides = {}) => ({ timestamp: now - 1000, farmId: 'FARM-01', kumbungId: 'FARM-01-K01', sensorId: 'SNS-0101', ...overrides });

const fixture = () => ({
  users: {
    petani: {
      profile: { email: 'Petani@Example.com' },
      access: { farms: { 'FARM-01': true }, farmRoles: { 'FARM-01': 'owner' }, role: 'manager' },
    },
    lama: { profile: { email: 'lama@example.com' }, access: { farms: { 'FARM-01': true }, role: 'manager' } },
    kosong: { profile: { email: 'kosong@example.com' } },
  },
  tumbara: {
    farms: { 'FARM-01': { name: 'Demo' } },
    kumbungs: {
      'FARM-01-K01': { farmId: 'FARM-01' },
      'FARM-01-K02': { farmId: 'FARM-01' },
      'FARM-01-K03': { farmId: 'FARM-99' },
    },
    farmKumbungs: { 'FARM-01': { 'FARM-01-K01': true, 'FARM-01-K02': true, 'FARM-01-K09': true } },
    monitoring: {
      sensor1: { timestamp: now, temperature: 27 },
      'FARM-01-K01': { 'SNS-0101': record(), 'SNS-0102': record({ sensorId: 'SNS-0102', gatewayId: 'GW-02' }) },
    },
    history: {
      'FARM-01-K01': { '2026-07-30': { a: record({ timestamp: now - 5000 }), b: record({ timestamp: now - 4000 }) } },
      'K-HILANG': { '2026-07-30': { c: record({ kumbungId: 'K-HILANG', sensorId: 'SNS-0999' }) } },
      '-NpushKeyLama': { timestamp: now - 9000, temperature: 26 },
    },
    gateways: { 'GW-02': { farmId: 'FARM-01', status: 'online' } },
    sensors: { 'SNS-0102': { farmId: 'FARM-01', kumbungId: 'FARM-01-K01', gatewayId: 'GW-02', status: 'active' } },
    alerts: {
      temperature_high: { severity: 'warning', status: 'resolved' },
      'FARM-01': { 'SNS-0101_co2_high': { severity: 'normal' } },
    },
    notif_cooldown: { temperature_high_warning: 1785141090529, 'FARM-01': { 'SNS-0101_co2_high_warning': 1 } },
  },
});

test('rencana migrasi melaporkan anomali tanpa memperbaikinya diam-diam', () => {
  const plan = planMigration(fixture(), { now });
  const types = plan.anomalies.map(item => item.type);
  assert.ok(types.includes('kumbung_farm_tidak_ada'));
  assert.ok(types.includes('indeks_kumbung_tidak_ada'));
  assert.ok(types.includes('telemetry_tanpa_kumbung'));
  assert.ok(types.includes('akses_farm_tanpa_role'));
  const uncataloged = plan.anomalies.filter(item => item.type === 'sensor_tanpa_katalog').map(item => item.sensorId).sort();
  assert.deepEqual(uncataloged, ['SNS-0101', 'SNS-0999']);
  // Tidak ada penulisan katalog sensor lama (gateway tidak ditebak) atau kumbung yang tidak cocok.
  assert.ok(!Object.keys(plan.updates).some(path => path.startsWith('tumbara/sensors/')));
  assert.ok(!Object.keys(plan.updates).some(path => path.startsWith('tumbara/farmKumbungs/')));
  assert.ok(plan.notes.some(note => note.includes('history legacy')));
  assert.ok(plan.notes.some(note => note.includes('tumbara/monitoring/sensor1')));
});

test('inventaris sensor menggabungkan monitoring dan history per sensor', () => {
  const plan = planMigration(fixture(), { now });
  const sns0101 = plan.inventory.find(item => item.sensorId === 'SNS-0101');
  assert.deepEqual(sns0101.kumbungs, { 'FARM-01-K01': 3 });
  assert.equal(sns0101.historyRecords, 2);
  assert.equal(sns0101.inMonitoring, true);
  assert.equal(sns0101.inCatalog, false);
  assert.equal(plan.inventory.find(item => item.sensorId === 'SNS-0102').inCatalog, true);
});

test('rencana menulis indeks terverifikasi, farmMembers dari farmRoles, dan membersihkan legacy', () => {
  const { updates } = planMigration(fixture(), { now });
  assert.equal(updates['tumbara/farmGateways/FARM-01/GW-02'], true);
  assert.equal(updates['tumbara/kumbungSensors/FARM-01-K01/SNS-0102'], true);
  assert.equal(updates['tumbara/gatewaySensors/GW-02/SNS-0102'], true);
  assert.deepEqual(updates['tumbara/farmMembers/FARM-01/petani'], {
    role: 'owner', status: 'active', email: 'petani@example.com', invitedBy: 'migration', createdAt: now, updatedAt: now,
  });
  // Akun dengan role lama saja tidak diangkat menjadi owner/anggota.
  assert.equal(updates['tumbara/farmMembers/FARM-01/lama'], undefined);
  assert.equal(updates['users/petani/access/role'], null);
  assert.equal(updates['users/lama/access/role'], null);
  assert.equal(updates['tumbara/alerts/temperature_high'], null);
  assert.equal(updates['tumbara/notif_cooldown/temperature_high_warning'], null);
  assert.equal(updates['tumbara/alerts/FARM-01'], undefined);
  assert.equal(updates['tumbara/notif_cooldown/FARM-01'], undefined);
});

test('migrasi idempoten: setelah diterapkan tidak ada perubahan tersisa dan telemetry utuh', () => {
  const data = fixture();
  const first = planMigration(data, { now });
  const migrated = applyUpdatesToObject(data, first.updates);
  assert.deepEqual(planMigration(migrated, { now }).updates, {});
  assert.deepEqual(migrated.tumbara.history, data.tumbara.history);
  assert.deepEqual(migrated.tumbara.monitoring, data.tumbara.monitoring);
  assert.deepEqual(migrated.tumbara.alerts['FARM-01'], data.tumbara.alerts['FARM-01']);
});
