// Migrasi Fase 4: inventaris sensor, validasi relasi, dan pembersihan data legacy.
//
//   Dry-run dari ekspor RTDB (tanpa koneksi):
//     node tools/migrate-hierarchy.mjs --export <ekspor.json> [--out rencana.json]
//   Dry-run dari database live (Admin SDK, hanya baca):
//     node tools/migrate-hierarchy.mjs --live [--credentials functions/credentials/firebase-admin.json]
//   Terapkan (backup dulu ke migration-backups/, lalu multipath update, lalu verifikasi ulang):
//     node tools/migrate-hierarchy.mjs --live --apply
//
// Tidak mengangkat akun lama menjadi owner dan tidak menebak gateway sensor lama.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planMigration } from './migration-plan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) options[key] = true;
    else options[key] = argv[++i];
  }
  return options;
}

function readEnvValue(path, key) {
  if (!existsSync(path)) return undefined;
  const line = readFileSync(path, 'utf8').split(/\r?\n/).find(item => item.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf('=') + 1).trim() : undefined;
}

function openAdmin(options) {
  const require = createRequire(join(ROOT, 'functions', 'package.json'));
  const admin = require('firebase-admin');
  const credentialsPath = resolve(ROOT, options.credentials
    || process.env.FIREBASE_CREDENTIALS_PATH
    || 'functions/credentials/firebase-admin.json');
  if (!existsSync(credentialsPath)) throw new Error(`Service account tidak ditemukan: ${credentialsPath}`);
  const databaseURL = options['database-url']
    || process.env.FIREBASE_DATABASE_URL
    || readEnvValue(join(ROOT, 'apps/web/.env'), 'VITE_FIREBASE_DATABASE_URL');
  if (!databaseURL) throw new Error('Atur --database-url atau FIREBASE_DATABASE_URL.');
  const app = admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(readFileSync(credentialsPath, 'utf8'))),
    databaseURL,
  }, `migrate-hierarchy-${process.pid}`);
  return { app, db: admin.database(app), databaseURL };
}

function printReport(plan, source) {
  const updatePaths = Object.keys(plan.updates);
  console.log(`\nSumber: ${source}`);
  console.log(`\n== Inventaris sensor dari telemetry (${plan.inventory.length}) ==`);
  for (const item of plan.inventory) {
    const last = item.latest ? new Date(item.latest).toISOString() : '-';
    console.log(`- ${item.sensorId}: kumbung ${Object.keys(item.kumbungs).join(', ')} · ${item.historyRecords} history · terakhir ${last} · katalog: ${item.inCatalog ? 'ya' : 'BELUM'}`);
  }
  console.log(`\n== Anomali untuk ditinjau (${plan.anomalies.length}) ==`);
  for (const item of plan.anomalies) {
    const { type, ...detail } = item;
    console.log(`- ${type}: ${JSON.stringify(detail)}`);
  }
  for (const note of plan.notes) console.log(`- catatan: ${note}`);
  console.log(`\n== Rencana perubahan (${updatePaths.length} path) ==`);
  for (const path of updatePaths) {
    const value = plan.updates[path];
    console.log(`- ${value === null ? 'HAPUS ' : 'TULIS '} ${path}${value === null ? '' : ` = ${JSON.stringify(value)}`}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.export && !options.live) {
    console.log('Pemakaian: --export <ekspor.json> | --live [--apply] [--credentials <file>] [--database-url <url>] [--out <file>]');
    process.exitCode = 1;
    return;
  }
  if (options.apply && !options.live) throw new Error('--apply hanya dapat dipakai bersama --live.');

  let data;
  let admin = null;
  if (options.export) {
    data = JSON.parse(readFileSync(resolve(options.export), 'utf8'));
  } else {
    admin = openAdmin(options);
    data = (await admin.db.ref('/').once('value')).val() || {};
  }

  try {
    const plan = planMigration(data);
    printReport(plan, options.export ? `ekspor ${options.export}` : `live ${admin.databaseURL}`);
    if (options.out) {
      writeFileSync(resolve(options.out), JSON.stringify(plan, null, 2));
      console.log(`\nRencana disimpan ke ${options.out}`);
    }

    if (!options.apply) {
      console.log('\nDry-run: tidak ada yang ditulis. Tambahkan --live --apply untuk menerapkan.');
      return;
    }
    const paths = Object.keys(plan.updates);
    if (!paths.length) {
      console.log('\nTidak ada perubahan; database sudah sesuai.');
      return;
    }

    // Backup nilai lama setiap path sebelum menulis (untuk rollback manual).
    const backup = {};
    for (const path of paths) backup[path] = (await admin.db.ref(path).once('value')).val();
    mkdirSync(join(ROOT, 'migration-backups'), { recursive: true });
    const backupPath = join(ROOT, 'migration-backups', `hierarchy-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(backupPath, JSON.stringify({ databaseURL: admin.databaseURL, createdAt: Date.now(), values: backup }, null, 2));
    console.log(`\nBackup ${paths.length} path: ${backupPath}`);
    console.log('Rollback: terapkan isi "values" sebagai multipath update ke database yang sama.');

    await admin.db.ref().update(plan.updates);
    const after = planMigration((await admin.db.ref('/').once('value')).val() || {});
    const remaining = Object.keys(after.updates).length;
    console.log(`Diterapkan. Verifikasi ulang: ${remaining} perubahan tersisa${remaining ? ' (periksa!)' : ' (idempoten)'}.`);
    if (remaining) process.exitCode = 1;
  } finally {
    if (admin) await admin.app.delete();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
