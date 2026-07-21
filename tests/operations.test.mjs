import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBatchPayload,
  buildHarvestPayload,
  jakartaInputToTimestamp,
  nextBatchId,
  nextKumbungId,
} from '../apps/web/src/lib/operations.js';

const actor = 'uid-operator';
const kumbung = { farmId: 'FARM-01' };

test('generator ID tidak menabrak urutan yang ada', () => {
  assert.equal(nextKumbungId('FARM-01', ['FARM-01-K01', 'FARM-01-K03']), 'FARM-01-K04');
  assert.equal(nextBatchId('FARM-01-K01', ['FARM-01-K01-B01']), 'FARM-01-K01-B02');
});

test('input tanggal dikonversi dari Asia/Jakarta ke UTC', () => {
  assert.equal(jakartaInputToTimestamp('2026-07-15'), Date.parse('2026-07-14T17:00:00Z'));
  assert.equal(jakartaInputToTimestamp('2026-07-15T08:30'), Date.parse('2026-07-15T01:30:00Z'));
});

test('batch memvalidasi jumlah baglog dan kontaminasi', () => {
  assert.throws(() => buildBatchPayload({
    farmId: 'FARM-01', kumbungId: 'FARM-01-K01', startedDate: '2026-07-01',
    baglogCountInitial: 100, baglogCountActive: 101, substrateType: 'serbuk-kayu',
    growthStage: 'fruiting', contaminationPct: 0, status: 'active',
  }, kumbung, actor), /Baglog aktif/);
});

test('panen wajib terkait batch dan tidak boleh sebelum batch dimulai', () => {
  const batch = { farmId: 'FARM-01', kumbungId: 'FARM-01-K01', startedAt: Date.parse('2026-07-10T00:00:00Z') };
  assert.throws(() => buildHarvestPayload({
    farmId: 'FARM-01', kumbungId: 'FARM-01-K01', batchId: 'B01',
    harvestedAt: '2026-07-01T08:00', weightKg: 10, grade: 'A', gradeAPct: 100,
  }, batch, actor, Date.parse('2026-07-20T00:00:00Z')), /sebelum batch/);
});
