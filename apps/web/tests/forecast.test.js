import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastViewState, formatForecastDate, historyValues, isOfficialBatchForecast, normalizeForecast } from '../src/lib/forecast.js';

test('normalize forecast clamps and orders quantiles', () => {
  const value = normalizeForecast({ generatedAt: 100, forecastKg: -2, p10Kg: 8, p50Kg: 3, p90Kg: -1 }, 100);
  assert.equal(value.forecastKg, 0);
  assert.deepEqual([value.p10Kg, value.p50Kg, value.p90Kg], [8, 8, 8]);
});

test('view states cover loading, access, empty, insufficient, stale and success', () => {
  assert.equal(forecastViewState({ loading: true }), 'loading');
  assert.equal(forecastViewState({ error: { code: 'PERMISSION_DENIED' } }), 'unauthorized');
  assert.equal(forecastViewState({ error: { code: 'network' } }), 'error');
  assert.equal(forecastViewState({}), 'empty');
  assert.equal(forecastViewState({ forecast: { status: 'insufficient_data' } }), 'insufficient');
  assert.equal(forecastViewState({ forecast: { status: 'ok', stale: true } }), 'stale');
  assert.equal(forecastViewState({ forecast: { status: 'demo', stale: false } }), 'success');
});

test('history is normalized and sorted newest first', () => {
  const values = historyValues({ a: { generatedAt: 100 }, b: { generatedAt: 300 } });
  assert.deepEqual(values.map(item => item.id), ['b', 'a']);
});

test('official dashboard forecast must come from trained batch worker output', () => {
  const official = { forecastType: 'batch_total', forecastMethod: 'trained-batch-model-v1', input: { batchId: 'B-01' } };
  assert.equal(isOfficialBatchForecast(official), true);
  assert.equal(isOfficialBatchForecast({ forecastType: 'batch_total', model: { forecastMethod: 'trained-batch-model-v1' }, input: { batchId: 'B-02' } }), true);
  assert.equal(isOfficialBatchForecast({ ...official, forecastMethod: 'browser-calculation' }), false);
  assert.equal(isOfficialBatchForecast({ ...official, forecastType: 'legacy_7_day' }), false);
});

test('harvest date formatter uses the shared Indonesian display format', () => {
  assert.match(formatForecastDate('2026-08-18'), /18 Agu 2026/);
});
