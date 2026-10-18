// Impor ekspor JSON Firebase RTDB ke PostgreSQL backend.
//   firebase database:get / --project <alias> > rtdb-export.json
//   node tools/import-rtdb.mjs --file rtdb-export.json            # dry-run: hanya laporan
//   node tools/import-rtdb.mjs --file rtdb-export.json --apply    # tulis (idempoten, tidak menimpa data backend)
// Opsi: --database-url <url>, --harvest-profile-kumbung <kumbungId>
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadEnvFile } from '../src/config.js';
import { migrate } from '../src/migrate.js';
import { hashSecret } from '../src/secrets.js';
import { planImport, summarize } from './rtdb-import-plan.mjs';

const date = ms => (ms ? new Date(ms) : null);

async function insertMany(db, rows, sql, toParams) {
  let inserted = 0;
  for (const row of rows) inserted += (await db.query(sql, toParams(row))).rowCount;
  return inserted;
}

/** Terapkan rencana impor dalam satu transaksi. Baris yang sudah ada dibiarkan (ON CONFLICT DO NOTHING). */
export async function applyImport(pool, plan) {
  const client = await pool.connect();
  const counts = {};
  try {
    await client.query('BEGIN');
    counts.users = await insertMany(client, plan.users,
      `INSERT INTO users (uid, email, email_verified, username, settings, created_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))
       ON CONFLICT (uid) DO UPDATE SET email = COALESCE(users.email, EXCLUDED.email),
         username = COALESCE(users.username, EXCLUDED.username),
         settings = CASE WHEN users.settings = '{}'::jsonb THEN EXCLUDED.settings ELSE users.settings END`,
      row => [row.uid, row.email, row.emailVerified, row.username, row.settings, date(row.createdAt)]);
    counts.farms = await insertMany(client, plan.farms,
      `INSERT INTO farms (id, name, location, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()), COALESCE($7, now())) ON CONFLICT DO NOTHING`,
      row => [row.id, row.name, row.location, row.status, row.createdBy, date(row.createdAt), date(row.updatedAt)]);
    counts.members = await insertMany(client, plan.members,
      `INSERT INTO farm_members (farm_id, uid, role, status, invited_by, created_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, now())) ON CONFLICT DO NOTHING`,
      row => [row.farmId, row.uid, row.role, row.status, row.invitedBy, date(row.createdAt)]);
    counts.kumbungs = await insertMany(client, plan.kumbungs,
      `INSERT INTO kumbungs (id, farm_id, name, capacity_baglog, status, harvest_profile, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()), COALESCE($9, now())) ON CONFLICT DO NOTHING`,
      row => [row.id, row.farmId, row.name, row.capacityBaglog, row.status, row.harvestProfile, row.createdBy, date(row.createdAt), date(row.updatedAt)]);
    counts.batches = await insertMany(client, plan.batches,
      `INSERT INTO batches (id, farm_id, kumbung_id, started_at, baglog_count_initial, baglog_count_active, substrate_type,
         growth_stage, contamination_pct, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, now()), COALESCE($13, now())) ON CONFLICT DO NOTHING`,
      row => [row.id, row.farmId, row.kumbungId, date(row.startedAt), row.baglogCountInitial, row.baglogCountActive, row.substrateType,
        row.growthStage, row.contaminationPct, row.status, row.createdBy, date(row.createdAt), date(row.updatedAt)]);
    counts.harvests = await insertMany(client, plan.harvests,
      `INSERT INTO harvest_events (id, farm_id, kumbung_id, batch_id, harvested_at, weight_kg, grade, grade_a_pct, notes,
         recorded_by, created_at, corrects_event_id, correction_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, now()), $12, $13) ON CONFLICT DO NOTHING`,
      row => [row.id, row.farmId, row.kumbungId, row.batchId, date(row.harvestedAt), row.weightKg, row.grade, row.gradeAPct, row.notes,
        row.recordedBy, date(row.createdAt), row.correctsEventId, row.correctionReason]);
    // Audit lama tidak punya ID stabil: hanya diimpor ke farm yang belum punya riwayat (aman diulang).
    const { rows: farmsWithAudit } = await client.query('SELECT DISTINCT farm_id FROM audit_log');
    const skipAudit = new Set(farmsWithAudit.map(row => row.farm_id));
    counts.audit = await insertMany(client, plan.audit.filter(row => !skipAudit.has(row.farmId)),
      'INSERT INTO audit_log (farm_id, actor_uid, action, details, created_at) VALUES ($1, $2, $3, $4, COALESCE($5, now()))',
      row => [row.farmId, row.actorUid, row.action, row.details, date(row.createdAt)]);
    counts.alerts = await insertMany(client, plan.alerts,
      `INSERT INTO alerts (id, farm_id, kumbung_id, sensor_id, sensor, type, device, unit, severity, status, message, value,
         threshold, started_at, updated_at, resolved_at, telegram_sent_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) ON CONFLICT DO NOTHING`,
      row => [row.id, row.farmId, row.kumbungId, row.sensorId, row.sensor, row.type, row.device, row.unit, row.severity, row.status,
        row.message, row.value, row.threshold, date(row.startedAt), date(row.updatedAt), date(row.resolvedAt), date(row.telegramSentAt), row.source]);
    counts.aiRequests = await insertMany(client, plan.aiRequests,
      'INSERT INTO ai_requests (kumbung_id, data) VALUES ($1, $2) ON CONFLICT DO NOTHING', row => [row.kumbungId, row.data]);
    counts.forecasts = await insertMany(client, plan.forecasts,
      'INSERT INTO ai_forecasts (kumbung_id, id, generated_at, data) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      row => [row.kumbungId, row.id, date(row.generatedAt), row.data]);
    counts.forecastLatest = await insertMany(client, plan.forecastLatest,
      'INSERT INTO ai_forecast_latest (kumbung_id, forecast_id, data) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      row => [row.kumbungId, row.forecastId, row.data]);
    counts.features = await insertMany(client, plan.features,
      'INSERT INTO ai_features_daily (kumbung_id, date_key, data) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      row => [row.kumbungId, row.dateKey, row.data]);
    if (plan.workerStatus) {
      counts.workerStatus = (await client.query("INSERT INTO worker_status (name, data) VALUES ('ai', $1) ON CONFLICT DO NOTHING", [plan.workerStatus])).rowCount;
    }
    // Gateway virtual: secret & kode klaim acak yang tidak disimpan → tidak bisa login ke broker maupun diklaim.
    for (const gateway of plan.legacyGateways) {
      await client.query(
        "INSERT INTO devices (hw_uid, secret_hash, claim_hash, model) VALUES ($1, $2, $3, 'legacy-firebase') ON CONFLICT DO NOTHING",
        [gateway.id, hashSecret(randomBytes(32).toString('hex')), hashSecret(randomBytes(32).toString('hex'))],
      );
    }
    counts.legacyGateways = await insertMany(client, plan.legacyGateways,
      `INSERT INTO gateways (id, claimed_by, farm_id, name, model, registered_at, claimed_at, online)
       VALUES ($1, $2, $3, 'Data lama (Firebase)', 'legacy-firebase', now(), now(), false) ON CONFLICT DO NOTHING`,
      row => [row.id, row.claimedBy, row.farmId]);
    counts.legacySensors = await insertMany(client, plan.legacySensors,
      `INSERT INTO sensors (id, gateway_id, local_id, type, metrics, name, kumbung_id, status, last_values, last_ts)
       SELECT $1, $2, $3, $4, $5, $6, $7, 'active', $8, $9
       WHERE EXISTS (SELECT 1 FROM gateways WHERE id = $2 AND farm_id = (SELECT farm_id FROM kumbungs WHERE id = $7))
       ON CONFLICT DO NOTHING`,
      row => [row.id, row.gatewayId, row.localId, row.type, row.metrics, row.name, row.kumbungId, row.lastValues, date(row.lastTs)]);
    counts.telemetry = 0;
    for (let index = 0; index < plan.telemetry.length; index += 5000) {
      const chunk = plan.telemetry.slice(index, index + 5000);
      counts.telemetry += (await client.query(
        `INSERT INTO telemetry_history (sensor_id, bucket_start, ts, "values")
         SELECT s, b, t, v FROM unnest($1::text[], $2::timestamptz[], $3::timestamptz[], $4::jsonb[]) AS x(s, b, t, v)
         WHERE EXISTS (SELECT 1 FROM sensors WHERE id = s)
         ON CONFLICT DO NOTHING`,
        [chunk.map(row => row.sensorId), chunk.map(row => new Date(row.bucketStart)), chunk.map(row => new Date(row.ts)), chunk.map(row => JSON.stringify(row.values))],
      )).rowCount;
    }
    await client.query('COMMIT');
    return counts;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main(argv) {
  const arg = name => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const file = arg('--file');
  if (!file) throw new Error('Pakai: node tools/import-rtdb.mjs --file <ekspor.json> [--apply] [--database-url url] [--harvest-profile-kumbung id]');
  const plan = planImport(JSON.parse(readFileSync(file, 'utf8')), { harvestProfileKumbungId: arg('--harvest-profile-kumbung') || null });
  console.log('Rencana impor:', summarize(plan));
  if (plan.skipped.length) console.log('Dilewati:\n - ' + plan.skipped.join('\n - '));
  if (plan.anomalies.length) console.log(`Anomali (${plan.anomalies.length}, tidak diimpor/perlu dicek):`, plan.anomalies.slice(0, 50));
  if (!argv.includes('--apply')) {
    console.log('\nDry-run: tidak ada yang ditulis. Tambahkan --apply untuk mengimpor.');
    return;
  }
  loadEnvFile();
  const pool = new pg.Pool({ connectionString: arg('--database-url') || process.env.DATABASE_URL || 'postgres://postgres@localhost:5433/tandurai_iot' });
  try {
    await migrate(pool, console.log);
    console.log('Diimpor (baris baru):', await applyImport(pool, plan));
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).catch(error => {
    console.error('[import] gagal:', error.message);
    process.exit(1);
  });
}
