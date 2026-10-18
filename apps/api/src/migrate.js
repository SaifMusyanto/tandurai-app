import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Terapkan file migrations/*.sql yang belum tercatat, berurutan, masing-masing dalam transaksi. */
export async function migrate(pool, log = console.log) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await pool.query('SELECT id FROM schema_migrations')).rows.map(row => row.id));
  const files = readdirSync(MIGRATIONS_DIR).filter(name => name.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`[migrate] ${file} diterapkan`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migrasi ${file} gagal: ${error.message}`);
    } finally {
      client.release();
    }
  }
}
