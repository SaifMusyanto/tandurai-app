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

test('label batch, hari ke-N, dan kalimat rekap mudah dibaca petani', async () => {
  const { batchDay, batchLabel, batchNumber, describeRecapRow, todayJakarta } = await import('../src/lib/operationsView.js');
  const startedAt = Date.parse('2026-10-12T00:00:00+07:00');
  const batch = { id: 'FARM-01-K01-B03', startedAt };
  assert.equal(batchNumber(batch), 3);
  assert.equal(batchLabel(batch), 'Batch 3 · masuk 12 Okt');
  assert.equal(batchDay(batch, Date.parse('2026-10-12T23:30:00+07:00')), 1, 'hari masuk = hari ke-1');
  assert.equal(batchDay(batch, Date.parse('2026-10-18T06:00:00+07:00')), 7);
  assert.equal(todayJakarta(0, Date.parse('2026-10-18T23:30:00+07:00')), '2026-10-18', 'tanggal WIB, bukan UTC');
  assert.equal(describeRecapRow({ kind: 'problem', type: 'problem', items: ['contamination'], quantity: 12 }), 'Baglog kontaminasi / dibuang · 12 baglog');
  assert.equal(describeRecapRow({ kind: 'batch', type: 'phase_change', items: ['incubation', 'fruiting'] }), 'Inkubasi → Buka baglog');
  assert.equal(describeRecapRow({ kind: 'harvest', type: 'harvest', weightKg: 12.5, grade: 'A', items: [] }), '12,5 kg · Bagus (A)');
});
