import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TELEMETRY_HISTORY_INTERVAL_MS,
  assessTelemetry,
  buildTelemetryPayload,
  historyBucketStart,
  historyEntryId,
  jakartaDateKey,
  jakartaDateKeysBetween,
  normalizeTimestamp,
} from '../apps/web/src/lib/telemetry.js';

const complete = {
  temperature: 27.5, humidity: 82, co2: 700, pressure: 1008,
  airflow: 1.2, substrateMoisture: 65, light: 300,
};

test('timestamp detik dinormalisasi ke millisecond UTC', () => {
  assert.equal(normalizeTimestamp(1_784_077_200), 1_784_077_200_000);
});

test('tanggal memakai Asia/Jakarta di batas pergantian hari', () => {
  assert.equal(jakartaDateKey(Date.parse('2026-07-14T17:00:00.000Z')), '2026-07-15');
  assert.deepEqual(
    jakartaDateKeysBetween(Date.parse('2026-07-14T16:59:00Z'), Date.parse('2026-07-14T17:01:00Z')),
    ['2026-07-14', '2026-07-15'],
  );
});

test('bucket histori 10 menit deterministik dan idempotent', () => {
  const timestamp = Date.parse('2026-07-15T01:07:30Z');
  const bucket = historyBucketStart(timestamp);
  assert.equal(bucket % TELEMETRY_HISTORY_INTERVAL_MS, 0);
  assert.equal(historyEntryId('SNS-0101', timestamp), historyEntryId('SNS-0101', timestamp + 60_000));
});

test('sensor stale, hilang, dan out-of-range ditandai', () => {
  const now = Date.parse('2026-07-15T02:00:00Z');
  const result = assessTelemetry({
    ...complete,
    timestamp: now - 16 * 60 * 1000,
    humidity: 120,
    light: null,
  }, now);
  assert.equal(result.stale, true);
  assert.equal(result.status, 'invalid');
  assert.deepEqual(result.invalidSensors, ['humidity']);
  assert.deepEqual(result.missingSensors, ['light']);
});

test('payload konsisten dan tidak mengubah missing value menjadi nol palsu', () => {
  const payload = buildTelemetryPayload({
    farmId: 'FARM-01', kumbungId: 'FARM-01-K01', sensorId: 'SNS-0101',
    timestamp: Date.parse('2026-07-15T01:00:00Z'), ...complete, airflow: null,
  });
  assert.equal(payload.schemaVersion, 'telemetry-v1');
  assert.equal('airflow' in payload, false);
  assert.ok(payload.quality.missingSensors.includes('airflow'));
});
