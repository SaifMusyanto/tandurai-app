import { randomBytes, randomUUID } from 'node:crypto';
import { withTransaction } from './db.js';
import { accessibleFarmIds, requireFarm } from './access.js';
import {
  ID_PATTERN, batchInput, farmInput, harvestInput, harvestProfileInput, kumbungInput,
  nextSequentialId, settingsInput,
} from './domainValidate.js';
import { HttpError } from './validate.js';
import { logActivity } from './activities.js';

const ms = value => (value ? new Date(value).getTime() : null);

export const farmView = (row, role) => ({
  id: row.id, name: row.name, timezone: row.timezone, location: row.location, status: row.status,
  createdBy: row.created_by, createdAt: ms(row.created_at), updatedAt: ms(row.updated_at), role: role ?? row.role ?? null,
});

export const kumbungView = row => ({
  id: row.id, farmId: row.farm_id, name: row.name, capacityBaglog: row.capacity_baglog, status: row.status,
  harvestProfile: row.harvest_profile || null, createdBy: row.created_by,
  createdAt: ms(row.created_at), updatedAt: ms(row.updated_at),
});

export const batchView = row => ({
  id: row.id, farmId: row.farm_id, kumbungId: row.kumbung_id, startedAt: ms(row.started_at),
  baglogCountInitial: row.baglog_count_initial, baglogCountActive: row.baglog_count_active,
  substrateType: row.substrate_type, growthStage: row.growth_stage, contaminationPct: row.contamination_pct,
  status: row.status, createdBy: row.created_by, createdAt: ms(row.created_at), updatedAt: ms(row.updated_at),
  mushroomType: row.mushroom_type ?? 'tiram', spawnSource: row.spawn_source ?? '', notes: row.notes ?? '', endedAt: ms(row.ended_at),
  schemaVersion: 'baglog-batch-v1',
});

export const harvestView = row => ({
  id: row.id, farmId: row.farm_id, kumbungId: row.kumbung_id, batchId: row.batch_id,
  harvestedAt: ms(row.harvested_at), weightKg: row.weight_kg, grade: row.grade, gradeAPct: row.grade_a_pct,
  notes: row.notes, recordedBy: row.recorded_by, createdAt: ms(row.created_at),
  ...(row.corrects_event_id ? { correctsEventId: row.corrects_event_id, correctionReason: row.correction_reason } : {}),
  schemaVersion: 'harvest-event-v1',
});

const memberView = row => ({
  uid: row.uid, email: row.email, username: row.username, role: row.role, status: row.status,
  invitedBy: row.invited_by, createdAt: ms(row.created_at), updatedAt: ms(row.updated_at),
});

const auditView = row => ({
  ...row.details, id: String(row.id), action: row.action, actorUid: row.actor_uid,
  actorEmail: row.actor_email || null, createdAt: ms(row.created_at),
});

export async function audit(db, farmId, actorUid, action, details = {}) {
  const clean = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  await db.query('INSERT INTO audit_log (farm_id, actor_uid, action, details) VALUES ($1, $2, $3, $4)', [farmId, actorUid, action, clean]);
}

/**
 * Layanan domain aplikasi: akun, farm, anggota, kumbung, batch, panen, audit.
 * ctx = { pool, hub }
 */
export function createDomainService({ pool, hub }) {
  const changed = (farmId, entity, id, action) => hub.emitFarm(farmId, 'changed', { entity, farmId, id, action });

  // ───────────────────────────── akun

  const seen = new Map(); // uid → { key, at } — hindari tulis users di setiap request
  async function ensureUser(user) {
    const key = `${user.email}|${user.emailVerified}`;
    const cached = seen.get(user.uid);
    if (cached && cached.key === key && Date.now() - cached.at < 5 * 60 * 1000) return;
    await pool.query(
      `INSERT INTO users (uid, email, email_verified, username) VALUES ($1, $2, $3, $4)
       ON CONFLICT (uid) DO UPDATE SET email = EXCLUDED.email, email_verified = EXCLUDED.email_verified,
         username = COALESCE(users.username, EXCLUDED.username), last_seen_at = now()`,
      [user.uid, user.email, Boolean(user.emailVerified), user.name ? String(user.name).slice(0, 100) : null],
    );
    seen.set(user.uid, { key, at: Date.now() });
  }

  async function listFarms(user) {
    const { rows } = user.platformAdmin
      ? await pool.query("SELECT f.*, 'owner' AS role FROM farms f ORDER BY f.name, f.id")
      : await pool.query(
        `SELECT f.*, m.role FROM farms f JOIN farm_members m ON m.farm_id = f.id
         WHERE m.uid = $1 AND m.status = 'active' ORDER BY f.name, f.id`,
        [user.uid],
      );
    return rows.map(row => farmView(row));
  }

  async function getMe(user) {
    const { rows: [row] } = await pool.query('SELECT * FROM users WHERE uid = $1', [user.uid]);
    return {
      uid: user.uid, email: row?.email ?? user.email, emailVerified: Boolean(row?.email_verified),
      username: row?.username || null, platformAdmin: Boolean(user.platformAdmin), deviceAdmin: Boolean(user.deviceAdmin),
      createdAt: ms(row?.created_at), farms: await listFarms(user),
    };
  }

  async function updateMe(user, input) {
    const username = typeof input?.username === 'string' ? input.username.trim() : '';
    if (!username || username.length > 100) throw new HttpError(400, 'invalid_input', 'Nama 1–100 karakter.');
    await pool.query('UPDATE users SET username = $2, updated_at = now() WHERE uid = $1', [user.uid, username]);
    return getMe(user);
  }

  async function getSettings(user) {
    const { rows: [row] } = await pool.query('SELECT settings FROM users WHERE uid = $1', [user.uid]);
    return row?.settings || {};
  }

  async function putSettings(user, input) {
    const settings = settingsInput(input);
    await pool.query('UPDATE users SET settings = $2, updated_at = now() WHERE uid = $1', [user.uid, settings]);
    return settings;
  }

  // ───────────────────────────── farm

  async function getFarm(user, farmId) {
    const role = await requireFarm(pool, user, farmId);
    const { rows: [row] } = await pool.query('SELECT * FROM farms WHERE id = $1', [farmId]);
    return farmView(row, role);
  }

  async function createFarm(user, input) {
    const fields = farmInput(input);
    let id = input?.id;
    if (id !== undefined && (typeof id !== 'string' || !ID_PATTERN.test(id))) {
      throw new HttpError(400, 'invalid_input', 'ID farm hanya huruf, angka, - dan _ (maks. 64).');
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = id || `FARM-${randomBytes(4).toString('hex').toUpperCase()}`;
      try {
        await withTransaction(pool, async db => {
          await db.query(
            'INSERT INTO farms (id, name, location, status, created_by) VALUES ($1, $2, $3, $4, $5)',
            [candidate, fields.name, fields.location, fields.status, user.uid],
          );
          await db.query("INSERT INTO farm_members (farm_id, uid, role, invited_by) VALUES ($1, $2, 'owner', $2)", [candidate, user.uid]);
          await audit(db, candidate, user.uid, 'farm_create', { name: fields.name });
        });
        hub.addFarmMember(candidate, user.uid);
        return getFarm(user, candidate);
      } catch (error) {
        if (error.code !== '23505') throw error;
        if (id) throw new HttpError(409, 'conflict', 'ID farm sudah digunakan.');
      }
    }
    throw new HttpError(503, 'id_exhausted', 'Gagal membuat ID farm, coba lagi.');
  }

  async function updateFarm(user, farmId, input) {
    await withTransaction(pool, async db => {
      await requireFarm(db, user, farmId, { owner: true });
      const { rows: [row] } = await db.query('SELECT * FROM farms WHERE id = $1 FOR UPDATE', [farmId]);
      const fields = farmInput(input, row);
      await db.query(
        'UPDATE farms SET name = $2, location = $3, status = $4, updated_at = now() WHERE id = $1',
        [farmId, fields.name, fields.location, fields.status],
      );
      await audit(db, farmId, user.uid, 'farm_update', { name: fields.name, status: fields.status });
    });
    changed(farmId, 'farm', farmId, 'update');
    return getFarm(user, farmId);
  }

  // ───────────────────────────── anggota

  async function listMembers(user, farmId) {
    await requireFarm(pool, user, farmId);
    const { rows } = await pool.query(
      `SELECT m.*, u.email, u.username FROM farm_members m JOIN users u ON u.uid = m.uid
       WHERE m.farm_id = $1 ORDER BY (m.role = 'owner') DESC, lower(coalesce(u.email, m.uid))`,
      [farmId],
    );
    return rows.map(memberView);
  }

  async function addMember(user, farmId, input) {
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpError(400, 'invalid_input', 'Email tidak valid.');
    const member = await withTransaction(pool, async db => {
      await requireFarm(db, user, farmId, { owner: true });
      const { rows: [target] } = await db.query(
        `SELECT uid, email_verified FROM users WHERE lower(email) = $1
         ORDER BY email_verified DESC, last_seen_at DESC LIMIT 1`,
        [email],
      );
      if (!target) {
        throw new HttpError(404, 'user_not_found', 'Email belum terdaftar. Minta pengguna login sekali ke Tandurai (dengan Google atau email).');
      }
      if (!target.email_verified) {
        throw new HttpError(409, 'email_not_verified', 'Email ini belum terverifikasi. Minta pengguna klik link verifikasi di emailnya (atau login dengan Google), lalu login ulang ke Tandurai.');
      }
      if (target.uid === user.uid) throw new HttpError(400, 'invalid_input', 'Anda sudah menjadi anggota farm ini.');
      const { rows: [existing] } = await db.query('SELECT role FROM farm_members WHERE farm_id = $1 AND uid = $2 FOR UPDATE', [farmId, target.uid]);
      if (existing?.role === 'owner') throw new HttpError(409, 'conflict', 'Pengguna tersebut adalah owner farm ini.');
      await db.query(
        `INSERT INTO farm_members (farm_id, uid, role, status, invited_by) VALUES ($1, $2, 'operator', 'active', $3)
         ON CONFLICT (farm_id, uid) DO UPDATE SET status = 'active', invited_by = $3, updated_at = now()`,
        [farmId, target.uid, user.uid],
      );
      await audit(db, farmId, user.uid, 'operator_add', { targetUid: target.uid, email });
      return target.uid;
    });
    hub.addFarmMember(farmId, member);
    changed(farmId, 'member', member, 'add');
    return (await listMembers(user, farmId)).find(item => item.uid === member);
  }

  async function removeMember(user, farmId, uid) {
    const removed = await withTransaction(pool, async db => {
      await requireFarm(db, user, farmId, { owner: true });
      const { rows: [existing] } = await db.query('SELECT role FROM farm_members WHERE farm_id = $1 AND uid = $2 FOR UPDATE', [farmId, uid]);
      if (!existing) return false;
      if (existing.role === 'owner') throw new HttpError(409, 'conflict', 'Owner farm tidak dapat dicabut.');
      await db.query('DELETE FROM farm_members WHERE farm_id = $1 AND uid = $2', [farmId, uid]);
      await audit(db, farmId, user.uid, 'operator_remove', { targetUid: uid });
      return true;
    });
    if (removed) {
      changed(farmId, 'member', uid, 'remove');
      hub.removeFarmMember(farmId, uid);
      hub.sendToUser(uid, 'changed', { entity: 'member', farmId, id: uid, action: 'remove' });
    }
    return { uid, removed };
  }

  async function listAudit(user, farmId, limit = 30) {
    await requireFarm(pool, user, farmId);
    const { rows } = await pool.query(
      `SELECT a.*, u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.uid = a.actor_uid
       WHERE a.farm_id = $1 ORDER BY a.created_at DESC, a.id DESC LIMIT $2`,
      [farmId, Math.min(Math.max(Number(limit) || 30, 1), 200)],
    );
    return rows.map(auditView);
  }

  // ───────────────────────────── kumbung

  async function kumbungWithRole(db, user, kumbungId, options = {}) {
    const { rows: [row] } = await db.query(`SELECT * FROM kumbungs WHERE id = $1${options.lock ? ' FOR UPDATE' : ''}`, [kumbungId]);
    if (!row) throw new HttpError(404, 'not_found', 'Kumbung tidak ditemukan.');
    const role = await requireFarm(db, user, row.farm_id, { owner: options.owner, notFound: 'Kumbung tidak ditemukan.' });
    return { row, role };
  }

  async function listKumbungs(user, farmId) {
    await requireFarm(pool, user, farmId);
    const { rows } = await pool.query('SELECT * FROM kumbungs WHERE farm_id = $1 ORDER BY id', [farmId]);
    return rows.map(kumbungView);
  }

  async function createKumbung(user, farmId, input) {
    const fields = kumbungInput(input);
    const row = await withTransaction(pool, async db => {
      await requireFarm(db, user, farmId, { owner: true });
      await db.query('SELECT id FROM farms WHERE id = $1 FOR UPDATE', [farmId]);
      const { rows: existing } = await db.query('SELECT id FROM kumbungs WHERE starts_with(id, $1)', [`${farmId}-K`]);
      const id = nextSequentialId(`${farmId}-K`, existing.map(item => item.id));
      const { rows: [created] } = await db.query(
        `INSERT INTO kumbungs (id, farm_id, name, capacity_baglog, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [id, farmId, fields.name, fields.capacityBaglog, fields.status, user.uid],
      );
      await audit(db, farmId, user.uid, 'kumbung_create', { kumbungId: id, name: fields.name });
      return created;
    });
    changed(farmId, 'kumbung', row.id, 'create');
    return kumbungView(row);
  }

  async function updateKumbung(user, kumbungId, input) {
    const row = await withTransaction(pool, async db => {
      const { row: current } = await kumbungWithRole(db, user, kumbungId, { owner: true, lock: true });
      const fields = kumbungInput(input, kumbungView(current));
      const { rows: [updated] } = await db.query(
        'UPDATE kumbungs SET name = $2, capacity_baglog = $3, status = $4, updated_at = now() WHERE id = $1 RETURNING *',
        [kumbungId, fields.name, fields.capacityBaglog, fields.status],
      );
      await audit(db, current.farm_id, user.uid, 'kumbung_update', { kumbungId, name: fields.name, status: fields.status });
      return updated;
    });
    changed(row.farm_id, 'kumbung', kumbungId, 'update');
    return kumbungView(row);
  }

  async function putHarvestProfile(user, kumbungId, input) {
    const profile = { ...harvestProfileInput(input), updatedAt: Date.now() };
    const { row } = await kumbungWithRole(pool, user, kumbungId, { owner: true });
    const { rows: [updated] } = await pool.query(
      'UPDATE kumbungs SET harvest_profile = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [kumbungId, profile],
    );
    changed(row.farm_id, 'kumbung', kumbungId, 'update');
    return kumbungView(updated);
  }

  // ───────────────────────────── batch & panen

  async function createBatch(user, kumbungId, input) {
    const fields = batchInput(input);
    const row = await withTransaction(pool, async db => {
      const { row: kumbung } = await kumbungWithRole(db, user, kumbungId, { lock: true });
      const { rows: existing } = await db.query('SELECT id FROM batches WHERE kumbung_id = $1', [kumbungId]);
      const id = nextSequentialId(`${kumbungId}-B`, existing.map(item => item.id));
      const { rows: [created] } = await db.query(
        `INSERT INTO batches (id, farm_id, kumbung_id, started_at, baglog_count_initial, baglog_count_active,
           substrate_type, growth_stage, contamination_pct, status, created_by, mushroom_type, spawn_source, notes, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
        [id, kumbung.farm_id, kumbungId, new Date(fields.startedAt), fields.baglogCountInitial, fields.baglogCountActive,
          fields.substrateType, fields.growthStage, fields.contaminationPct, fields.status, user.uid,
          fields.mushroomType, fields.spawnSource, fields.notes, fields.status === 'active' ? null : new Date()],
      );
      // Jejak otomatis untuk rekap kegiatan kumbung.
      await logActivity(db, {
        farmId: kumbung.farm_id, kumbungId, batchId: id, type: 'batch_start', occurredAt: fields.startedAt,
        items: [fields.growthStage], quantity: fields.baglogCountInitial, notes: fields.notes, recordedBy: user.uid,
      });
      return created;
    });
    changed(row.farm_id, 'batch', row.id, 'create');
    return batchView(row);
  }

  async function updateBatch(user, batchId, input) {
    const row = await withTransaction(pool, async db => {
      const { rows: [current] } = await db.query('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [batchId]);
      if (!current) throw new HttpError(404, 'not_found', 'Batch tidak ditemukan.');
      const role = await requireFarm(db, user, current.farm_id, { notFound: 'Batch tidak ditemukan.' });
      const fields = batchInput(input, batchView(current));
      const closing = current.status === 'active' && fields.status !== 'active';
      // Operator boleh mulai batch & ganti tahap; menutup (selesai/afkir) hanya owner.
      if (closing && role !== 'owner') throw new HttpError(403, 'forbidden', 'Hanya owner farm yang dapat menutup batch.');
      const endedAt = fields.status === 'active' ? null : current.ended_at || new Date();
      const { rows: [updated] } = await db.query(
        `UPDATE batches SET started_at = $2, baglog_count_initial = $3, baglog_count_active = $4, substrate_type = $5,
           growth_stage = $6, contamination_pct = $7, status = $8, mushroom_type = $9, spawn_source = $10, notes = $11,
           ended_at = $12, updated_at = now() WHERE id = $1 RETURNING *`,
        [batchId, new Date(fields.startedAt), fields.baglogCountInitial, fields.baglogCountActive, fields.substrateType,
          fields.growthStage, fields.contaminationPct, fields.status, fields.mushroomType, fields.spawnSource, fields.notes, endedAt],
      );
      const trail = { farmId: current.farm_id, kumbungId: current.kumbung_id, batchId, recordedBy: user.uid };
      if (fields.growthStage !== current.growth_stage) {
        await logActivity(db, { ...trail, type: 'phase_change', items: [current.growth_stage, fields.growthStage] });
      }
      if (closing) {
        await logActivity(db, { ...trail, type: 'batch_end', items: [fields.status], quantity: fields.baglogCountActive, notes: typeof input?.closeNote === 'string' ? input.closeNote.trim().slice(0, 300) : '' });
      }
      return updated;
    });
    changed(row.farm_id, 'batch', batchId, 'update');
    return batchView(row);
  }

  async function createHarvest(user, kumbungId, input) {
    const row = await withTransaction(pool, async db => {
      const { row: kumbung } = await kumbungWithRole(db, user, kumbungId);
      const { rows: [batch] } = await db.query('SELECT * FROM batches WHERE id = $1 AND kumbung_id = $2', [input?.batchId, kumbungId]);
      if (!batch) throw new HttpError(400, 'invalid_input', 'Batch tidak terhubung ke kumbung yang dipilih');
      const fields = harvestInput(input, batchView(batch));
      if (fields.correctsEventId) {
        const { rows: [original] } = await db.query(
          'SELECT id FROM harvest_events WHERE id = $1 AND kumbung_id = $2 AND corrects_event_id IS NULL',
          [fields.correctsEventId, kumbungId],
        );
        if (!original) throw new HttpError(400, 'invalid_input', 'Catatan panen yang dikoreksi tidak ditemukan');
      }
      const { rows: [created] } = await db.query(
        `INSERT INTO harvest_events (id, farm_id, kumbung_id, batch_id, harvested_at, weight_kg, grade, grade_a_pct, notes,
           recorded_by, corrects_event_id, correction_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [randomUUID(), kumbung.farm_id, kumbungId, batch.id, new Date(fields.harvestedAt), fields.weightKg, fields.grade,
          fields.gradeAPct, fields.notes, user.uid, fields.correctsEventId, fields.correctionReason],
      );
      return created;
    });
    changed(row.farm_id, 'harvest', row.id, 'create');
    return harvestView(row);
  }

  /** Data halaman operasional untuk semua farm user (pengganti loadOperations RTDB). */
  async function operations(user) {
    const farmIds = await accessibleFarmIds(pool, user);
    const farms = (await listFarms(user)).filter(farm => farmIds.includes(farm.id));
    const { rows: kumbungs } = await pool.query('SELECT * FROM kumbungs WHERE farm_id = ANY($1) ORDER BY id', [farmIds]);
    const { rows: batches } = await pool.query('SELECT * FROM batches WHERE farm_id = ANY($1) ORDER BY started_at DESC', [farmIds]);
    // 100 catatan panen terbaru per kumbung (sama dengan limitToLast(100) di RTDB).
    const { rows: harvests } = await pool.query(
      `SELECT * FROM (
         SELECT h.*, row_number() OVER (PARTITION BY h.kumbung_id ORDER BY h.harvested_at DESC) AS n
         FROM harvest_events h WHERE h.farm_id = ANY($1)
       ) ranked WHERE n <= 100 ORDER BY harvested_at DESC`,
      [farmIds],
    );
    return {
      roles: Object.fromEntries(farms.map(farm => [farm.id, farm.role])),
      farms,
      kumbungs: kumbungs.map(kumbungView),
      batches: batches.map(batchView),
      harvestAudit: harvests.map(harvestView),
    };
  }

  return {
    ensureUser, getMe, updateMe, getSettings, putSettings,
    listFarms, getFarm, createFarm, updateFarm,
    listMembers, addMember, removeMember, listAudit,
    listKumbungs, createKumbung, updateKumbung, putHarvestProfile,
    createBatch, updateBatch, createHarvest, operations,
  };
}
