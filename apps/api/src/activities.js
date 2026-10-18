import { randomUUID } from 'node:crypto';
import { withTransaction } from './db.js';
import { requireFarm } from './access.js';
import { activityInput, recapQuery } from './domainValidate.js';
import { HttpError } from './validate.js';

// Kegiatan kumbung: catatan harian petani, laporan masalah, dan jejak perubahan batch, plus
// rekap gabungan (kegiatan + panen) dan export CSV.

const ms = value => (value ? new Date(value).getTime() : null);

export const activityView = row => ({
  id: row.id, farmId: row.farm_id, kumbungId: row.kumbung_id, batchId: row.batch_id, type: row.type,
  occurredAt: ms(row.occurred_at), items: row.items || [], quantity: row.quantity, notes: row.notes,
  recordedBy: row.recorded_by, createdAt: ms(row.created_at),
  ...(row.voided_at ? { voidedAt: ms(row.voided_at), voidedBy: row.voided_by, voidReason: row.void_reason } : {}),
});

/** Tulis satu kegiatan (dipakai juga oleh domain untuk jejak batch otomatis) di dalam transaksi `db`. */
export async function logActivity(db, { farmId, kumbungId, batchId = null, type, occurredAt = Date.now(), items = [], quantity = null, notes = '', recordedBy }) {
  const { rows: [row] } = await db.query(
    `INSERT INTO kumbung_activities (id, farm_id, kumbung_id, batch_id, type, occurred_at, items, quantity, notes, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [randomUUID(), farmId, kumbungId, batchId, type, new Date(occurredAt), JSON.stringify(items), quantity, notes, recordedBy],
  );
  return row;
}

/** Kurangi/kembalikan baglog aktif batch dan hitung ulang persentase kontaminasi. */
async function adjustActiveBaglog(db, batch, delta) {
  const active = Math.min(batch.baglog_count_initial, Math.max(0, batch.baglog_count_active + delta));
  const pct = Math.round(((batch.baglog_count_initial - active) / batch.baglog_count_initial) * 1000) / 10;
  await db.query('UPDATE batches SET baglog_count_active = $2, contamination_pct = $3, updated_at = now() WHERE id = $1', [batch.id, active, pct]);
}

// ───────────────────────────── label untuk CSV (sama dengan apps/web/src/lib/operationsView.js)
const KIND_LABEL = { harvest: 'Panen', care: 'Kegiatan harian', note: 'Catatan', problem: 'Masalah', batch_start: 'Batch dimulai', phase_change: 'Ganti tahap', batch_end: 'Batch ditutup' };
const ITEM_LABEL = {
  misting: 'Pengkabutan/penyiraman', cleaning: 'Bersihkan kumbung', ventilation: 'Buka/tutup ventilasi', pest_check: 'Cek hama', other: 'Lainnya',
  contamination: 'Baglog kontaminasi', pest: 'Hama', no_growth: 'Jamur tidak tumbuh',
  inoculation: 'Inokulasi', incubation: 'Inkubasi', fruiting: 'Buka baglog', harvesting: 'Masa panen', completed: 'Selesai', cancelled: 'Afkir',
};
const GRADE_LABEL = { A: 'Bagus (A)', B: 'Sedang (B)', C: 'Rendah (C)', mixed: 'Campur' };

function describe(row) {
  if (row.kind === 'harvest') return `Panen ${row.weightKg} kg`;
  if (row.type === 'phase_change') return row.items.map(item => ITEM_LABEL[item] || item).join(' → ');
  if (row.type === 'batch_start') return `${row.quantity ?? '-'} baglog masuk`;
  return row.items.map(item => ITEM_LABEL[item] || item).join(', ');
}

const csvCell = value => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // cegah formula injection di Excel
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const jakarta = value => new Date(value + 7 * 3600 * 1000).toISOString();
const number = value => (value === null || value === undefined ? '' : String(value).replace('.', ','));

/** Ringkasan baris rekap (panen, mutu, baglog dibuang, jumlah kegiatan). */
export function summarize(rows, filter) {
  const harvests = rows.filter(row => row.kind === 'harvest');
  const totalKg = harvests.reduce((sum, row) => sum + row.weightKg, 0);
  const gradeKg = { A: 0, B: 0, C: 0, mixed: 0 };
  for (const row of harvests) gradeKg[row.grade] = (gradeKg[row.grade] || 0) + row.weightKg;
  const day = value => new Date(value + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const harvestDays = new Set(harvests.map(row => day(row.occurredAt))).size;
  const spanDays = filter.startMs !== null && filter.endMs !== null
    ? Math.round((filter.endMs - filter.startMs) / 86_400_000)
    : Math.max(1, harvestDays);
  const round = value => Math.round(value * 100) / 100;
  return {
    harvestKg: round(totalKg),
    harvestCount: harvests.length,
    harvestDays,
    avgKgPerDay: round(totalKg / Math.max(1, spanDays)),
    gradeKg: Object.fromEntries(Object.entries(gradeKg).map(([key, value]) => [key, round(value)])),
    baglogRemoved: rows.filter(row => row.type === 'problem').reduce((sum, row) => sum + (row.quantity || 0), 0),
    careCount: rows.filter(row => row.kind === 'care').length,
    problemCount: rows.filter(row => row.kind === 'problem').length,
    batchEventCount: rows.filter(row => row.kind === 'batch').length,
  };
}

export function createActivityService({ pool, hub }) {
  const changed = (farmId, entity, id, action) => hub.emitFarm(farmId, 'changed', { entity, farmId, id, action });

  async function createActivity(user, kumbungId, input) {
    const fields = activityInput(input);
    const result = await withTransaction(pool, async db => {
      const { rows: [kumbung] } = await db.query('SELECT * FROM kumbungs WHERE id = $1', [kumbungId]);
      if (!kumbung) throw new HttpError(404, 'not_found', 'Kumbung tidak ditemukan.');
      await requireFarm(db, user, kumbung.farm_id, { notFound: 'Kumbung tidak ditemukan.' });
      // Batch: yang dipilih (harus di kumbung ini) atau batch aktif terbaru.
      const { rows: [batch] } = fields.batchId
        ? await db.query('SELECT * FROM batches WHERE id = $1 AND kumbung_id = $2 FOR UPDATE', [fields.batchId, kumbungId])
        : await db.query("SELECT * FROM batches WHERE kumbung_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1 FOR UPDATE", [kumbungId]);
      if (fields.batchId && !batch) throw new HttpError(400, 'invalid_input', 'Batch tidak terhubung ke kumbung yang dipilih');
      if (fields.quantity) {
        if (!batch || batch.status !== 'active') throw new HttpError(400, 'invalid_input', 'Baglog dibuang hanya bisa dicatat pada batch yang sedang berjalan');
        if (fields.quantity > batch.baglog_count_active) throw new HttpError(400, 'invalid_input', `Baglog aktif batch ini tinggal ${batch.baglog_count_active}`);
        await adjustActiveBaglog(db, batch, -fields.quantity);
      }
      const row = await logActivity(db, { ...fields, farmId: kumbung.farm_id, kumbungId, batchId: batch?.id || null, recordedBy: user.uid });
      return { row, batchChanged: Boolean(fields.quantity) };
    });
    changed(result.row.farm_id, 'activity', result.row.id, 'create');
    if (result.batchChanged) changed(result.row.farm_id, 'batch', result.row.batch_id, 'update');
    return activityView(result.row);
  }

  /** Batalkan catatan petani (pencatat atau owner); baglog dibuang dikembalikan ke batch. */
  async function voidActivity(user, activityId, input) {
    const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
    if (!reason) throw new HttpError(400, 'invalid_input', 'Alasan pembatalan wajib diisi');
    const result = await withTransaction(pool, async db => {
      const { rows: [current] } = await db.query('SELECT * FROM kumbung_activities WHERE id = $1 FOR UPDATE', [activityId]);
      if (!current) throw new HttpError(404, 'not_found', 'Catatan tidak ditemukan.');
      const role = await requireFarm(db, user, current.farm_id, { notFound: 'Catatan tidak ditemukan.' });
      if (!['care', 'problem', 'note'].includes(current.type)) throw new HttpError(400, 'invalid_input', 'Jejak perubahan batch tidak dapat dibatalkan');
      if (current.voided_at) throw new HttpError(409, 'conflict', 'Catatan sudah dibatalkan');
      if (role !== 'owner' && current.recorded_by !== user.uid) throw new HttpError(403, 'forbidden', 'Hanya pencatat atau owner farm yang dapat membatalkan catatan ini.');
      let batchChanged = false;
      if (current.quantity && current.batch_id) {
        const { rows: [batch] } = await db.query('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [current.batch_id]);
        if (batch) { await adjustActiveBaglog(db, batch, current.quantity); batchChanged = true; }
      }
      const { rows: [row] } = await db.query(
        'UPDATE kumbung_activities SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1 RETURNING *',
        [activityId, user.uid, reason],
      );
      return { row, batchChanged };
    });
    changed(result.row.farm_id, 'activity', activityId, 'update');
    if (result.batchChanged) changed(result.row.farm_id, 'batch', result.row.batch_id, 'update');
    return activityView(result.row);
  }

  /** Baris rekap gabungan kegiatan + panen (nilai panen terkoreksi terbaru), terbaru dulu. */
  async function recapRows(farmId, filter, limit) {
    const params = [farmId];
    const add = value => { params.push(value); return `$${params.length}`; };
    const where = alias => {
      const parts = [`${alias}.farm_id = $1`];
      if (filter.startMs !== null) parts.push(`${alias === 'h' ? 'h.harvested_at' : 'a.occurred_at'} >= ${add(new Date(filter.startMs))}`);
      if (filter.endMs !== null) parts.push(`${alias === 'h' ? 'h.harvested_at' : 'a.occurred_at'} < ${add(new Date(filter.endMs))}`);
      if (filter.kumbungId) parts.push(`${alias}.kumbung_id = ${add(filter.kumbungId)}`);
      if (filter.batchId) parts.push(`${alias}.batch_id = ${add(filter.batchId)}`);
      if (filter.actor) parts.push(`${alias}.recorded_by = ${add(filter.actor)}`);
      return parts.join(' AND ');
    };
    const activityTypes = [
      ...(filter.kinds.includes('care') ? ['care', 'note'] : []),
      ...(filter.kinds.includes('problem') ? ['problem'] : []),
      ...(filter.kinds.includes('batch') ? ['batch_start', 'phase_change', 'batch_end'] : []),
    ];
    const queries = [];
    if (activityTypes.length) {
      queries.push(pool.query(
        `SELECT a.*, k.name AS kumbung_name, u.email, u.username FROM kumbung_activities a
         JOIN kumbungs k ON k.id = a.kumbung_id LEFT JOIN users u ON u.uid = a.recorded_by
         WHERE ${where('a')} AND a.voided_at IS NULL AND a.type = ANY(${add(activityTypes)})
         ORDER BY a.occurred_at DESC LIMIT ${limit}`, params.slice()));
      params.length = 1;
    }
    if (filter.kinds.includes('harvest')) {
      queries.push(pool.query(
        `SELECT h.id, h.farm_id, h.kumbung_id, h.batch_id, k.name AS kumbung_name, u.email, u.username,
           COALESCE(c.harvested_at, h.harvested_at) AS harvested_at, COALESCE(c.weight_kg, h.weight_kg) AS weight_kg,
           COALESCE(c.grade, h.grade) AS grade, COALESCE(c.notes, h.notes) AS notes, h.recorded_by, c.id IS NOT NULL AS corrected
         FROM harvest_events h
         JOIN kumbungs k ON k.id = h.kumbung_id LEFT JOIN users u ON u.uid = h.recorded_by
         LEFT JOIN LATERAL (SELECT * FROM harvest_events x WHERE x.corrects_event_id = h.id ORDER BY x.created_at DESC LIMIT 1) c ON true
         WHERE ${where('h')} AND h.corrects_event_id IS NULL
         ORDER BY h.harvested_at DESC LIMIT ${limit}`, params.slice()));
    }
    const results = await Promise.all(queries);
    const rows = [];
    for (const { rows: list } of results) {
      for (const row of list) {
        const base = {
          id: row.id, kumbungId: row.kumbung_id, kumbungName: row.kumbung_name, batchId: row.batch_id,
          notes: row.notes || '', recordedBy: row.recorded_by, recordedByName: row.username || row.email || row.recorded_by,
        };
        if (row.weight_kg !== undefined) {
          rows.push({ ...base, kind: 'harvest', type: 'harvest', occurredAt: ms(row.harvested_at), weightKg: row.weight_kg, grade: row.grade, corrected: row.corrected, items: [], quantity: null });
        } else {
          const kind = ['care', 'note'].includes(row.type) ? 'care' : row.type === 'problem' ? 'problem' : 'batch';
          rows.push({ ...base, kind, type: row.type, occurredAt: ms(row.occurred_at), items: row.items || [], quantity: row.quantity, weightKg: null, grade: null });
        }
      }
    }
    return rows.sort((a, b) => b.occurredAt - a.occurredAt).slice(0, limit);
  }

  /** Rekap farm sesuai filter: { range, summary, rows, truncated }. */
  async function recap(user, farmId, query) {
    await requireFarm(pool, user, farmId);
    const filter = recapQuery(query);
    const limit = 5000;
    const rows = await recapRows(farmId, filter, limit + 1);
    const truncated = rows.length > limit;
    const list = rows.slice(0, limit);
    return { range: { startAt: filter.startMs, endAt: filter.endMs }, summary: summarize(list, filter), rows: list, truncated };
  }

  /** CSV rekap (pemisah `;`, BOM UTF-8, desimal koma) agar langsung rapi di Excel Indonesia. */
  async function recapCsv(user, farmId, query) {
    await requireFarm(pool, user, farmId);
    const filter = recapQuery(query);
    const rows = (await recapRows(farmId, filter, 50_000)).reverse(); // kronologis
    const header = ['Tanggal', 'Jam', 'Kumbung', 'Batch', 'Jenis', 'Rincian', 'Baglog', 'Berat (kg)', 'Mutu', 'Catatan', 'Dicatat oleh'];
    const lines = [header, ...rows.map(row => {
      const local = jakarta(row.occurredAt);
      return [
        local.slice(0, 10), local.slice(11, 16), row.kumbungName, row.batchId || '',
        KIND_LABEL[row.type] || row.type, describe(row) + (row.corrected ? ' (dikoreksi)' : ''),
        row.quantity ?? '', number(row.weightKg), row.grade ? GRADE_LABEL[row.grade] || row.grade : '', row.notes, row.recordedByName || '',
      ];
    })];
    const day = value => (value === null ? 'awal' : jakarta(value).slice(0, 10));
    return {
      filename: `rekap-${farmId}-${day(filter.startMs)}_${filter.endMs === null ? 'akhir' : day(filter.endMs - 1)}.csv`,
      body: `﻿${lines.map(line => line.map(csvCell).join(';')).join('\r\n')}\r\n`,
    };
  }

  // `rows` tanpa cek akses: dipakai layanan laporan terjadwal (backend sendiri).
  return { createActivity, voidActivity, recap, recapCsv, rows: recapRows };
}
