import pg from 'pg';

// timestamptz dikembalikan sebagai Date; bigint/int8 tidak dipakai di skema.
export function createPool(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30000 });
  pool.on('error', error => console.error('[db] koneksi idle error:', error.message));
  return pool;
}

/** Jalankan `fn(client)` dalam satu transaksi; rollback otomatis bila error. */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
