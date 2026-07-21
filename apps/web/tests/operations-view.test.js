import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPhase, phaseInfo, resolveHarvestLedger } from '../src/lib/operationsView.js';

test('phase guide advances one understandable step at a time', () => {
  assert.equal(phaseInfo('incubation').number, 2);
  assert.equal(nextPhase('incubation').id, 'fruiting');
  assert.equal(nextPhase('completed').id, 'completed');
});

test('latest harvest correction replaces display value without deleting audit event', () => {
  const events = [
    { id: 'original', harvestedAt: 10, weightKg: 5, createdAt: 10 },
    { id: 'fix-1', correctsEventId: 'original', harvestedAt: 10, weightKg: 6, createdAt: 20 },
    { id: 'fix-2', correctsEventId: 'original', harvestedAt: 10, weightKg: 7, createdAt: 30 },
  ];
  const ledger = resolveHarvestLedger(events);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].weightKg, 7);
  assert.equal(ledger[0].corrected, true);
  assert.equal(ledger[0].original.weightKg, 5);
});
