import { loadEnvFile, readConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

loadEnvFile();
const pool = createPool(readConfig().databaseUrl);
try {
  await migrate(pool);
  console.log('[migrate] selesai');
} finally {
  await pool.end();
}
