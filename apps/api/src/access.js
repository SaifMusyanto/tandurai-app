import { HttpError } from './validate.js';

/**
 * Otorisasi per farm (pengganti database.rules.json). Anggota aktif mendapat role `owner` atau
 * `operator`; platformAdmin diperlakukan sebagai owner di semua farm. Farm yang tidak dapat
 * diakses dilaporkan 404 agar keberadaannya tidak bocor.
 */
export async function farmRole(db, user, farmId) {
  if (typeof farmId !== 'string' || !farmId) return null;
  if (user.platformAdmin) {
    const { rows } = await db.query('SELECT 1 FROM farms WHERE id = $1', [farmId]);
    return rows.length ? 'owner' : null;
  }
  const { rows } = await db.query(
    "SELECT role FROM farm_members WHERE farm_id = $1 AND uid = $2 AND status = 'active'",
    [farmId, user.uid],
  );
  return rows[0]?.role || null;
}

/** Pastikan user anggota farm (dan owner bila `owner: true`). Mengembalikan role. */
export async function requireFarm(db, user, farmId, { owner = false, notFound = 'Farm tidak ditemukan.' } = {}) {
  const role = await farmRole(db, user, farmId);
  if (!role) throw new HttpError(404, 'not_found', notFound);
  if (owner && role !== 'owner') throw new HttpError(403, 'forbidden', 'Hanya owner farm yang dapat melakukan ini.');
  return role;
}

/** ID farm yang dapat diakses user (semua farm untuk platformAdmin). */
export async function accessibleFarmIds(db, user) {
  const { rows } = user.platformAdmin
    ? await db.query('SELECT id AS farm_id FROM farms')
    : await db.query("SELECT farm_id FROM farm_members WHERE uid = $1 AND status = 'active'", [user.uid]);
  return rows.map(row => row.farm_id);
}
