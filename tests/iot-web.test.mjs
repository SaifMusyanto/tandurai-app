import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGatewayEvent, commandDisplay, mergeCommand, secondsUntilOff } from '../apps/web/src/lib/iot.js';

const gateways = () => [{
  id: 'G1', online: false, lastSeenAt: null,
  sensors: [{ id: 'G1-S1', status: 'pending', lastValues: null, lastTs: null }],
  actuators: [{ id: 'G1-A1', state: 'off', mode: 'manual' }],
}];

test('event SSE diterapkan ke gateway yang benar; gateway asing diabaikan', () => {
  let state = applyGatewayEvent(gateways(), 'gateway', { gatewayId: 'G1', online: true, lastSeenAt: '2026-10-15T00:00:00Z' });
  assert.equal(state[0].online, true);
  state = applyGatewayEvent(state, 'telemetry', { gatewayId: 'G1', sensorId: 'G1-S1', values: { humidity: 80 }, ts: '2026-10-15T00:00:10Z' });
  assert.deepEqual(state[0].sensors[0], { id: 'G1-S1', status: 'active', lastValues: { humidity: 80 }, lastTs: '2026-10-15T00:00:10Z', error: null });
  state = applyGatewayEvent(state, 'actuator', { gatewayId: 'G1', id: 'G1-A1', state: 'on', offAt: '2026-10-15T00:01:00Z' });
  assert.equal(state[0].actuators[0].state, 'on');
  assert.equal(state[0].actuators[0].mode, 'manual');
  const replaced = applyGatewayEvent(state, 'config', { gatewayId: 'G1', gateway: { id: 'G1', replaced: true } });
  assert.equal(replaced[0].replaced, true);
  assert.deepEqual(applyGatewayEvent(state, 'gateway', { gatewayId: 'G9', online: false }), state);
});

test('status command: sukses hanya setelah ACK; offline dibedakan dari gagal', () => {
  assert.equal(commandDisplay({ status: 'pending' }, true).kind, 'pending');
  assert.equal(commandDisplay({ status: 'pending' }, false).kind, 'offline');
  assert.equal(commandDisplay({ status: 'success' }, false).kind, 'success');
  assert.equal(commandDisplay({ status: 'expired', reason: 'gateway_offline' }, true).kind, 'offline');
  const rejected = commandDisplay({ status: 'rejected', reason: 'mode' }, true);
  assert.equal(rejected.kind, 'failed');
  assert.match(rejected.label, /mode/);
  assert.equal(commandDisplay(null, true), null);
});

test('command terbaru per aktuator tidak tertimpa event lama', () => {
  const newer = { id: 'c2', actuatorId: 'A1', createdAt: '2026-10-15T00:00:10Z', status: 'pending' };
  const older = { id: 'c1', actuatorId: 'A1', createdAt: '2026-10-15T00:00:00Z', status: 'expired' };
  let commands = mergeCommand({}, newer);
  commands = mergeCommand(commands, older);
  assert.equal(commands.A1.id, 'c2');
  commands = mergeCommand(commands, { ...newer, status: 'success' });
  assert.equal(commands.A1.status, 'success');
  // ACK (SSE) lebih dulu, respons HTTP `pending` menyusul: tetap success.
  commands = mergeCommand(commands, { ...newer, status: 'pending', gatewayOnline: true });
  assert.equal(commands.A1.status, 'success');
});

test('hitung mundur mati otomatis', () => {
  const now = Date.parse('2026-10-15T00:00:00Z');
  assert.equal(secondsUntilOff({ state: 'on', offAt: '2026-10-15T00:00:30Z' }, now), 30);
  assert.equal(secondsUntilOff({ state: 'off', offAt: '2026-10-15T00:00:30Z' }, now), null);
});

test('teks jadwal, hari, aturan otomatis, pemicu, dan aturan mode', async () => {
  const { daysLabel, describeSchedule, describeRule, describeTrigger, nextMode, formatDuration } = await import('../apps/web/src/lib/iot.js');
  assert.equal(daysLabel([1, 2, 3, 4, 5, 6, 7]), 'Setiap hari');
  assert.equal(daysLabel([5, 4, 3, 2, 1]), 'Senin–Jumat');
  assert.equal(daysLabel([1, 3]), 'Sen, Rab');
  assert.equal(formatDuration(5400), '1 jam 30 menit');
  assert.equal(describeSchedule({ type: 'at', at: '07:00', onSec: 300 }), 'Pukul 07:00, nyala 5 menit');
  assert.equal(describeSchedule({ type: 'every', intervalSec: 3600, onSec: 600, window: '06:00-18:00' }), 'Tiap 1 jam (06:00–18:00), nyala 10 menit');
  const rule = { id: 'r1', metric: 'humidity', operator: 'below', threshold: 85, stop: { type: 'value', value: 88 } };
  assert.equal(describeRule(rule), 'Nyala saat kelembapan < 85 %, mati saat kembali ≥ 88 %.');
  assert.equal(describeRule({ metric: 'co2', operator: 'above', threshold: 1000, stop: { type: 'duration', onSec: 120 } }), 'Nyala saat co₂ > 1000 ppm, mati setelah 2 menit.');
  assert.equal(describeTrigger({ state: 'on', stateSource: 'auto', stateTrigger: { rule: 'r1' }, rules: [rule] }), 'otomatis — Nyala saat kelembapan < 85 %, mati saat kembali ≥ 88 %');
  assert.equal(describeTrigger({ state: 'off', stateSource: 'auto' }), '');
  const on = { enabled: true };
  assert.equal(nextMode({ mode: 'auto', schedules: [], rules: [on] }, { schedules: [on], activate: 'timer' }), 'timer');
  assert.equal(nextMode({ mode: 'auto', schedules: [], rules: [on] }, { schedules: [on] }), 'auto', 'ubah jadwal tidak mematikan otomatis');
  assert.equal(nextMode({ mode: 'timer', schedules: [on], rules: [on] }, { schedules: [{ enabled: false }] }), 'auto', 'jadwal habis → aturan');
  assert.equal(nextMode({ mode: 'auto', schedules: [], rules: [on] }, { rules: [] }), 'manual');
  assert.equal(nextMode({ mode: 'manual', schedules: [], rules: [] }, { rules: [on], activate: 'auto' }), 'auto');
});

test('ACK config sebelum respons simpan: Pending Sync tidak macet', () => {
  const base = [{ id: 'G1', sensors: [], actuators: [{ id: 'A1', configVersion: 4, appliedVersion: 4, pendingSync: false }] }];
  // ACK v5 (SSE config) lebih dulu…
  let state = applyGatewayEvent(base, 'config', { gatewayId: 'G1', gateway: { id: 'G1', sensors: [], actuators: [{ id: 'A1', configVersion: 5, appliedVersion: 5, pendingSync: false }] } });
  // …lalu respons PUT config v5 yang masih pending.
  state = applyGatewayEvent(state, 'actuator', { gatewayId: 'G1', id: 'A1', configVersion: 5, appliedVersion: 4, pendingSync: true });
  assert.equal(state[0].actuators[0].pendingSync, false);
  assert.equal(state[0].actuators[0].appliedVersion, 5);
});

test('parameter satu sumber: gabung sensor per waktu, hanya suhu/kelembapan/CO₂', async () => {
  const { PARAMETER_KEYS, mergeReadings, latestValues, formatParameter, parameterStatus } = await import('../apps/web/src/lib/parameters.js');
  assert.deepEqual(PARAMETER_KEYS, ['temperature', 'humidity', 'co2']);
  const merged = mergeReadings([
    { timestamp: 120000, temperature: 27, humidity: 80, pressure: 1010, sensorId: 'S1' },
    { timestamp: 120000, co2: 900, sensorId: 'S2' },
    { timestamp: 60000, co2: 850 },
  ]);
  assert.deepEqual(merged, [{ timestamp: 60000, co2: 850, sensors: 0 }, { timestamp: 120000, temperature: 27, humidity: 80, co2: 900, sensors: 2 }]);
  // Dua sensor membaca parameter yang sama pada waktu yang sama → rata-rata, bukan saling menimpa.
  const averaged = mergeReadings([
    { timestamp: 1000, sensorId: 'S1', temperature: 27, humidity: 84, co2: 800 },
    { timestamp: 1500, sensorId: 'S2', temperature: 28, humidity: 80, co2: 870 },
  ]);
  assert.deepEqual(averaged, [{ timestamp: 1000, sensors: 2, temperature: 27.5, humidity: 82, co2: 835 }]);
  assert.deepEqual(latestValues([{ timestamp: 1, co2: 850, humidity: 70 }, { timestamp: 2, temperature: 27 }]), { temperature: 27, humidity: 70, co2: 850 });
  assert.equal(formatParameter('co2', 912.4), '912 ppm');
  assert.equal(formatParameter('humidity', undefined), '—');
  assert.equal(parameterStatus('temperature', 31), 'warning');
});
