import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canPublish, canSubscribe } from '../src/brokerAcl.js';
import {
  formatClaimCode, generateClaimCode, hashSecret, normalizeClaimCode, verifySecret,
} from '../src/secrets.js';
import { cleanReadings, deviceTime, parseCapabilities, validateActuatorConfig } from '../src/validate.js';

test('hash rahasia: verifikasi benar/salah, kode klaim dinormalisasi', () => {
  const stored = hashSecret('rahasia-perangkat');
  assert.equal(verifySecret('rahasia-perangkat', stored), true);
  assert.equal(verifySecret('rahasia-lain', stored), false);
  assert.equal(verifySecret('x', 'bukan-format'), false);
  const code = generateClaimCode();
  assert.match(code, /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  assert.equal(normalizeClaimCode(formatClaimCode(code).toLowerCase()), code);
});

test('ACL broker: perangkat hanya topic miliknya, backend hanya cmd/config', () => {
  const device = { role: 'device', hwUid: 'TDR-1' };
  const backend = { role: 'backend' };
  assert.equal(canPublish(device, 'tandurai/gw/TDR-1/telemetry'), true);
  assert.equal(canPublish(device, 'tandurai/gw/TDR-2/telemetry'), false);
  assert.equal(canPublish(device, 'tandurai/gw/TDR-1/cmd'), false);
  assert.equal(canSubscribe(device, 'tandurai/gw/TDR-1/cmd'), true);
  assert.equal(canSubscribe(device, 'tandurai/gw/+/cmd'), false);
  assert.equal(canSubscribe(device, 'tandurai/gw/#'), false);
  assert.equal(canPublish(backend, 'tandurai/gw/TDR-1/cmd'), true);
  assert.equal(canPublish(backend, 'tandurai/gw/+/cmd'), false);
  assert.equal(canPublish(backend, 'tandurai/gw/TDR-1/telemetry'), false);
  assert.equal(canSubscribe(backend, 'tandurai/gw/+/ack'), true);
  assert.equal(canPublish(null, 'tandurai/gw/TDR-1/telemetry'), false);
});

test('capabilities: entri tidak valid dan ID ganda dibuang', () => {
  const caps = parseCapabilities({
    sensors: [{ id: 'S1', type: 'scd41', metrics: ['temperature', 'x'] }, { id: 'S1', type: 'dup' }, { id: 'bad id' }, 'S2'],
    actuators: [{ id: 'A1', type: 'sprayer', maxRunSec: 120 }, { id: 'A2', type: 'laser', maxRunSec: 10 }, { id: 'A3', type: 'fan', maxRunSec: 0 }],
  });
  // Parameter sensor selalu suhu, kelembapan, CO₂ — apa pun yang dikirim perangkat.
  assert.deepEqual(caps.sensors, [
    { id: 'S1', type: 'scd41', metrics: ['temperature', 'humidity', 'co2'] },
    { id: 'S2', type: 'env', metrics: ['temperature', 'humidity', 'co2'] },
  ]);
  assert.deepEqual(caps.actuators, [{ id: 'A1', type: 'sprayer', maxRunSec: 120, minIntervalSec: 0 }]);
  assert.deepEqual(caps.rejected, ['S1', 'bad id', 'A2', 'A3']);
});

test('telemetry: nilai di luar rentang dibuang; timestamp tidak wajar memakai waktu server', () => {
  assert.deepEqual(cleanReadings({ temperature: 27.5, humidity: 120, co2: '700' }, ['temperature', 'humidity', 'co2']), { temperature: 27.5, co2: 700 });
  const now = 1_800_000_000_000;
  assert.equal(deviceTime(now - 1000, now), now - 1000);
  assert.equal(deviceTime(now + 3600000, now), now);
  assert.equal(deviceTime('x', now), now);
});

test('config aktuator: jadwal ganda, batas bawah/atas, proteksi max ON', () => {
  const actuator = { max_run_sec: 120, schedules: [], auto: null };
  const sensors = [{ id: 'G-S1', localId: 'S1', metrics: ['humidity'] }];
  const timer = validateActuatorConfig({ mode: 'timer', schedules: [
    { id: 'pagi', type: 'at', at: '07:00', onSec: 60, days: [1, 3, 5] },
    { type: 'every', intervalSec: 3600, onSec: 120, window: '06:00-18:00', enabled: false },
  ] }, actuator, sensors);
  assert.deepEqual(timer.schedules[0], { id: 'pagi', type: 'at', enabled: true, days: [1, 3, 5], at: '07:00', onSec: 60 });
  assert.equal(timer.schedules[1].days.length, 7, 'default setiap hari');
  assert.match(timer.schedules[1].id, /^[0-9a-f]{8}$/, 'ID dibuat bila kosong');
  assert.throws(() => validateActuatorConfig({ mode: 'timer', schedules: [{ type: 'at', at: '07:00', onSec: 300 }] }, actuator, sensors), /lama nyala/);
  assert.throws(() => validateActuatorConfig({ mode: 'timer', schedules: [{ type: 'at', at: '25:00', onSec: 10 }] }, actuator, sensors), /HH:MM/);
  assert.throws(() => validateActuatorConfig({ mode: 'timer', schedules: [{ type: 'at', at: '07:00', onSec: 10, days: [] }] }, actuator, sensors), /hari/);
  assert.throws(() => validateActuatorConfig({ mode: 'timer', schedules: [{ type: 'at', at: '07:00', onSec: 10, enabled: false }] }, actuator, sensors), /minimal satu jadwal aktif/);
  const rule = (extra = {}) => ({ sensorId: 'G-S1', metric: 'humidity', operator: 'below', threshold: 85, stop: { type: 'value', value: 88 }, ...extra });
  assert.throws(() => validateActuatorConfig({ mode: 'auto', rules: [rule({ metric: 'co2' })] }, actuator, sensors), /tidak mengukur/);
  assert.throws(() => validateActuatorConfig({ mode: 'auto', rules: [rule({ stop: { type: 'value', value: 80 } })] }, actuator, sensors), /lebih besar/);
  assert.throws(() => validateActuatorConfig({ mode: 'auto', rules: [rule({ stop: { type: 'duration', onSec: 999 } })] }, actuator, sensors), /lama nyala/);
  assert.throws(() => validateActuatorConfig({ mode: 'auto', rules: [rule({ enabled: false })] }, actuator, sensors), /minimal satu aturan aktif/);
  const rules = validateActuatorConfig({ mode: 'auto', rules: [rule(), rule({ operator: 'above', threshold: 95, stop: { type: 'duration', onSec: 30 } })] }, actuator, sensors).rules;
  assert.equal(rules[0].sensorLocalId, 'S1');
  assert.equal(rules[0].cooldownSec, 60);
  assert.deepEqual(rules[1].stop, { type: 'duration', onSec: 30 });
  // Pindah mode tanpa mengirim jadwal/aturan mempertahankan yang tersimpan.
  const kept = validateActuatorConfig({ mode: 'manual' }, { ...actuator, schedules: timer.schedules, rules }, sensors);
  assert.equal(kept.schedules.length, 2);
  assert.equal(kept.rules.length, 2);
});

test('validasi domain: batch, panen, ambang alert, preferensi', async () => {
  const { batchInput, harvestInput, nextSequentialId, settingsInput, thresholdsInput } = await import('../src/domainValidate.js');
  assert.equal(nextSequentialId('F-K', ['F-K01', 'F-K09', 'X-K99']), 'F-K10');
  const batch = batchInput({ startedAt: Date.UTC(2026, 0, 1), baglogCountInitial: 10, baglogCountActive: 5, substrateType: 'jerami', growthStage: 'fruiting', contaminationPct: 0, status: 'active' });
  assert.equal(batch.baglogCountActive, 5);
  assert.throws(() => batchInput({ ...batch, baglogCountActive: 11 }), /Baglog aktif/);
  assert.equal(batchInput({ growthStage: 'completed' }, batch).baglogCountInitial, 10, 'perubahan sebagian mempertahankan nilai lama');
  const now = Date.UTC(2026, 1, 1);
  assert.throws(() => harvestInput({ harvestedAt: now + 3600000, weightKg: 1, grade: 'A', gradeAPct: 1 }, batch, now), /masa depan/);
  assert.throws(() => harvestInput({ harvestedAt: now, weightKg: 1, grade: 'A', gradeAPct: 1, correctsEventId: 'h1' }, batch, now), /Alasan koreksi/);
  assert.throws(() => thresholdsInput({ humidity: { warning: 50, critical: 60 } }), /kelembapan/);
  assert.equal(thresholdsInput({ temperature: { warning: 28 } }).temperature.critical, 33);
  assert.deepEqual(settingsInput({ language: 'id', telegramBotToken: 'x', apiSecret: 'y' }), { language: 'id' });
});

test('evaluasi alert sama dengan alert-core lama', async () => {
  const { evaluateReadings } = await import('../src/alerts.js');
  const byKey = values => Object.fromEntries(evaluateReadings(values).map(result => [result.key, result.severity]));
  assert.deepEqual(byKey({ temperature: 34, humidity: 65, co2: 700 }), { temperature_high: 'critical', humidity_low: 'warning', co2_high: 'normal' });
  assert.deepEqual(byKey({ temperature: 30, humidity: 70, co2: 800 }), { temperature_high: 'normal', humidity_low: 'normal', co2_high: 'normal' });
  assert.deepEqual(byKey({ humidity: 59.9 }), { humidity_low: 'critical' });
});

test('rentang optimal farm: validasi & konsistensi dengan ambang alert', async () => {
  const { DEFAULT_OPTIMAL, DEFAULT_THRESHOLDS, optimalInput, checkOptimalAgainstThresholds } = await import('../src/domainValidate.js');
  assert.doesNotThrow(() => checkOptimalAgainstThresholds(DEFAULT_OPTIMAL, DEFAULT_THRESHOLDS), 'bawaan harus konsisten');
  assert.deepEqual(optimalInput({ humidity: { min: 85 } }).humidity, { min: 85, max: 90 });
  assert.throws(() => optimalInput({ temperature: { min: 30, max: 25 } }), /batas bawah/);
  assert.throws(() => optimalInput({ co2: { max: 20000 } }));
  assert.throws(() => checkOptimalAgainstThresholds(optimalInput({ co2: { max: 1600 } }), DEFAULT_THRESHOLDS), /CO₂/);
});

test('cek perangkat: kesalahan firmware umum terdeteksi', async () => {
  const { checkMessage } = await import('../tools/device-check.mjs');
  const now = Date.UTC(2026, 9, 16);
  const sensors = [{ local_id: 'S1', metrics: ['temperature', 'humidity', 'co2'] }];
  assert.deepEqual(checkMessage('telemetry', { ts: now, readings: { S1: { temperature: 27, humidity: 80, co2: 700 } } }, { sensors, now }).issues, []);
  assert.match(checkMessage('telemetry', { ts: Math.floor(now / 1000), readings: {} }, { sensors, now }).issues[0], /detik/);
  assert.match(checkMessage('telemetry', { ts: now, readings: { S1: { humidity: 140 } } }, { sensors, now }).issues[0], /dibuang humidity/);
  assert.match(checkMessage('telemetry', { ts: now, readings: { S9: { humidity: 80 } } }, { sensors, now }).issues[0], /S9 tidak terdaftar/);
  assert.match(checkMessage('state', { actuators: { A1: { state: 'on', source: 'manual' } } }).issues[0], /offAt/);
  assert.match(checkMessage('register', { firmware: '1.0', sensors: [{ id: 'S-1' }], actuators: [] }).issues[0], /ditolak: S-1/);
  assert.match(checkMessage('status', { online: true }).issues[0], /configVersion/);
});

test('kegiatan kumbung & filter rekap: validasi input petani', async () => {
  const { activityInput, recapQuery, jakartaDayStart } = await import('../src/domainValidate.js');
  const now = Date.UTC(2026, 9, 18, 5); // 18 Okt 2026 12:00 WIB
  assert.deepEqual(activityInput({ type: 'care', items: ['misting', 'misting'] }, now), { type: 'care', items: ['misting'], quantity: null, occurredAt: now, notes: '', batchId: null });
  assert.equal(activityInput({ type: 'problem', items: ['contamination'], quantity: '12' }, now).quantity, 12);
  assert.throws(() => activityInput({ type: 'care', items: ['contamination'] }, now), /tidak valid/);
  assert.throws(() => activityInput({ type: 'note' }, now), /Catatan wajib/);
  assert.throws(() => activityInput({ type: 'problem', items: ['pest'], quantity: 3 }, now), /kontaminasi/);
  assert.throws(() => activityInput({ type: 'care', items: ['misting'], occurredAt: now + 3600_000 }, now), /masa depan/);

  const recap = recapQuery({}, now);
  assert.equal(recap.endMs - recap.startMs, 30 * 86_400_000, 'bawaan 30 hari termasuk hari ini');
  assert.equal(recap.startMs, jakartaDayStart('2026-09-19'));
  assert.deepEqual(recapQuery({ batchId: 'B1' }, now).startMs, null);
  assert.deepEqual(recapQuery({ kinds: 'harvest,care' }, now).kinds, ['harvest', 'care']);
  assert.throws(() => recapQuery({ from: '2026-13-01' }, now));
});

test('laporan terjadwal: waktu kirim berikutnya & periode laporan (WIB)', async () => {
  const { nextRunAt, reportPeriod, scheduleInput, dayStartWib } = await import('../src/reports.js');
  const at = text => Date.parse(`${text}+07:00`);
  // Sabtu 18 Okt 2026 12:00 WIB
  const now = at('2026-10-18T12:00:00');
  assert.equal(nextRunAt({ frequency: 'daily', sendHour: 7 }, now), at('2026-10-19T07:00:00'));
  assert.equal(nextRunAt({ frequency: 'daily', sendHour: 13 }, now), at('2026-10-18T13:00:00'));
  assert.equal(nextRunAt({ frequency: 'weekly', sendHour: 7, weekday: 1 }, now), at('2026-10-19T07:00:00'), 'Senin berikutnya');
  assert.equal(nextRunAt({ frequency: 'weekly', sendHour: 7, weekday: 6 }, now), at('2026-10-24T07:00:00'), 'hari ini sudah lewat → minggu depan');
  assert.equal(nextRunAt({ frequency: 'monthly', sendHour: 7, monthDay: 1 }, now), at('2026-11-01T07:00:00'));
  assert.equal(nextRunAt({ frequency: 'monthly', sendHour: 7, monthDay: 1 }, at('2026-12-15T08:00:00')), at('2027-01-01T07:00:00'), 'lintas tahun');
  assert.deepEqual(reportPeriod('daily', now), { startMs: dayStartWib('2026-10-17'), endMs: dayStartWib('2026-10-18') });
  assert.deepEqual(reportPeriod('weekly', now), { startMs: dayStartWib('2026-10-11'), endMs: dayStartWib('2026-10-18') });
  assert.deepEqual(reportPeriod('monthly', now), { startMs: dayStartWib('2026-09-01'), endMs: dayStartWib('2026-10-01') });
  assert.equal(scheduleInput({ name: 'x', frequency: 'daily', sections: ['harvest'], weekday: 3 }).weekday, null, 'hari hanya untuk mingguan');
  assert.throws(() => scheduleInput({ name: 'x', frequency: 'hourly', sections: ['harvest'] }), /Frekuensi/);
  assert.throws(() => scheduleInput({ name: 'x', frequency: 'monthly', monthDay: 31, sections: ['harvest'] }), /Tanggal kirim/);
});

test('xlsx & csv export: file zip valid dan CSV aman untuk Excel', async () => {
  const { inflateRawSync } = await import('node:zlib');
  const { buildXlsx, buildCsv } = await import('../src/xlsx.js');
  const file = buildXlsx([{ name: 'Data', rows: [['Nama', 'Nilai'], ['Suhu <A>', 26.5]] }]);
  // Baca entri ZIP langsung dari header lokal.
  const entries = {};
  for (let offset = 0; file.readUInt32LE(offset) === 0x04034B50;) {
    const size = file.readUInt32LE(offset + 18);
    const nameLength = file.readUInt16LE(offset + 26);
    const name = file.subarray(offset + 30, offset + 30 + nameLength).toString();
    entries[name] = inflateRawSync(file.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size)).toString();
    offset += 30 + nameLength + size;
  }
  assert.ok(entries['[Content_Types].xml'] && entries['xl/workbook.xml'].includes('name="Data"'));
  assert.match(entries['xl/worksheets/sheet1.xml'], /<c r="B2"><v>26.5<\/v><\/c>/);
  assert.match(entries['xl/worksheets/sheet1.xml'], /Suhu &lt;A&gt;/);
  assert.equal(buildCsv([['a', 1.5], ['=SUM(A1)', 'x;y']]), '\uFEFFa;1,5\r\n\'=SUM(A1);"x;y"\r\n');
});
