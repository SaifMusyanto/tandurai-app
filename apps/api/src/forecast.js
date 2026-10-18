import { accessibleFarmIds, requireFarm } from './access.js';
import { batchView, harvestView } from './domain.js';
import { HttpError } from './validate.js';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const jakartaDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const objectInput = (value, label, max = 262144) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_input', `${label} harus berupa objek JSON.`);
  if (JSON.stringify(value).length > max) throw new HttpError(413, 'too_large', `${label} terlalu besar.`);
  return value;
};

/** Baris telemetry ternormalisasi (format sama dengan history RTDB lama). */
export const telemetryRow = (row, kumbungId) => ({
  ...row.values, timestamp: new Date(row.ts).getTime(), sensorId: row.sensor_id, kumbungId, schemaVersion: 'telemetry-v1',
});

/**
 * Forecast panen: permintaan dari dashboard, pemrosesan oleh AI worker lokal (Python) lewat
 * API internal bertoken. Bentuk data sama dengan aiRequests/aiForecasts RTDB lama.
 * ctx = { pool, hub }
 */
export function createForecastService({ pool, hub }) {
  async function kumbungFarm(kumbungId) {
    const { rows: [row] } = await pool.query('SELECT farm_id FROM kumbungs WHERE id = $1', [kumbungId]);
    if (!row) throw new HttpError(404, 'not_found', 'Kumbung tidak ditemukan.');
    return row.farm_id;
  }

  async function memberKumbung(user, kumbungId) {
    const farmId = await kumbungFarm(kumbungId);
    await requireFarm(pool, user, farmId, { notFound: 'Kumbung tidak ditemukan.' });
    return farmId;
  }

  async function readForecast(kumbungId, historyLimit = 20) {
    const { rows: [latest] } = await pool.query('SELECT data FROM ai_forecast_latest WHERE kumbung_id = $1', [kumbungId]);
    const { rows: history } = await pool.query(
      'SELECT id, data FROM ai_forecasts WHERE kumbung_id = $1 ORDER BY generated_at DESC NULLS LAST, created_at DESC LIMIT $2',
      [kumbungId, historyLimit],
    );
    const { rows: [request] } = await pool.query('SELECT data FROM ai_requests WHERE kumbung_id = $1', [kumbungId]);
    return { forecast: latest?.data || null, history: history.map(row => ({ ...row.data, id: row.id })), request: request?.data || null };
  }

  // ───────────────────────────── API user

  async function getKumbungForecast(user, kumbungId) {
    await memberKumbung(user, kumbungId);
    return readForecast(kumbungId);
  }

  async function requestForecast(user, kumbungId, input, now = Date.now()) {
    const farmId = await memberKumbung(user, kumbungId);
    const { rows: [batch] } = await pool.query(
      "SELECT id FROM batches WHERE id = $1 AND kumbung_id = $2 AND status = 'active'",
      [input?.batchId, kumbungId],
    );
    if (!batch) throw new HttpError(400, 'invalid_input', 'Pilih batch aktif di kumbung ini.');
    const payload = {
      requestedAt: now, requestedBy: user.uid, asOfDate: jakartaDate(now), batchId: batch.id,
      status: 'pending', mode: 'hybrid_synthetic_fill', schemaVersion: 'ai-request-v1',
    };
    await pool.query(
      `INSERT INTO ai_requests (kumbung_id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (kumbung_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [kumbungId, payload],
    );
    hub.emitFarm(farmId, 'forecast', { kumbungId, request: payload });
    return payload;
  }

  /** Forecast terbaru setiap kumbung yang dapat diakses (dashboard beranda). */
  async function latestForecasts(user) {
    const farmIds = await accessibleFarmIds(pool, user);
    const { rows } = await pool.query(
      `SELECT l.kumbung_id, l.data FROM ai_forecast_latest l JOIN kumbungs k ON k.id = l.kumbung_id
       WHERE k.farm_id = ANY($1)`,
      [farmIds],
    );
    return rows.map(row => ({ kumbungId: row.kumbung_id, forecast: row.data }));
  }

  async function workerStatus() {
    const { rows: [row] } = await pool.query("SELECT data FROM worker_status WHERE name = 'ai'");
    return row?.data || null;
  }

  // ───────────────────────────── API worker (token WORKER_TOKEN)

  async function workerRequests() {
    const { rows } = await pool.query('SELECT kumbung_id, data FROM ai_requests');
    return Object.fromEntries(rows.map(row => [row.kumbung_id, row.data]));
  }

  async function workerUpdateRequest(kumbungId, patch) {
    const farmId = await kumbungFarm(kumbungId);
    const { rows: [row] } = await pool.query(
      'UPDATE ai_requests SET data = data || $2, updated_at = now() WHERE kumbung_id = $1 RETURNING data',
      [kumbungId, objectInput(patch, 'Perubahan permintaan', 16384)],
    );
    if (!row) throw new HttpError(404, 'not_found', 'Permintaan forecast tidak ditemukan.');
    hub.emitFarm(farmId, 'forecast', { kumbungId, request: row.data });
    return row.data;
  }

  /** Input feature engineering: batch, telemetry (tanggal Jakarta), panen kumbung. */
  async function workerFeatureInputs(kumbungId, dateKeys = []) {
    await kumbungFarm(kumbungId);
    const keys = [...new Set(dateKeys)].filter(key => DATE_KEY.test(key)).sort();
    if (keys.length > 120) throw new HttpError(400, 'invalid_input', 'Maksimal 120 tanggal per permintaan.');
    const { rows: batches } = await pool.query('SELECT * FROM batches WHERE kumbung_id = $1', [kumbungId]);
    const { rows: harvests } = await pool.query('SELECT * FROM harvest_events WHERE kumbung_id = $1', [kumbungId]);
    let telemetry = [];
    if (keys.length) {
      const { rows } = await pool.query(
        `SELECT h.sensor_id, h.ts, h."values" FROM telemetry_history h JOIN sensors s ON s.id = h.sensor_id
         WHERE s.kumbung_id = $1 AND to_char(h.ts AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') = ANY($2)
         ORDER BY h.ts`,
        [kumbungId, keys],
      );
      telemetry = rows.map(row => telemetryRow(row, kumbungId));
    }
    return { batches: batches.map(batchView), telemetry, harvestEvents: harvests.map(harvestView) };
  }

  async function workerReadSensor(kumbungId, sensorId) {
    const { rows: [row] } = await pool.query(
      'SELECT id AS sensor_id, last_ts AS ts, last_values AS "values" FROM sensors WHERE id = $1 AND kumbung_id = $2 AND last_ts IS NOT NULL',
      [sensorId, kumbungId],
    );
    return row ? telemetryRow(row, kumbungId) : null;
  }

  async function workerWriteFeatures(kumbungId, dateKey, data) {
    await kumbungFarm(kumbungId);
    if (!DATE_KEY.test(dateKey)) throw new HttpError(400, 'invalid_input', 'Tanggal harus YYYY-MM-DD.');
    await pool.query(
      `INSERT INTO ai_features_daily (kumbung_id, date_key, data) VALUES ($1, $2, $3)
       ON CONFLICT (kumbung_id, date_key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [kumbungId, dateKey, objectInput(data, 'Fitur harian')],
    );
  }

  /** Simpan forecast ke histori dan sebagai terbaru secara atomik. */
  async function workerWriteForecast(kumbungId, forecastId, data) {
    const farmId = await kumbungFarm(kumbungId);
    if (typeof forecastId !== 'string' || !forecastId || forecastId.length > 200) throw new HttpError(400, 'invalid_input', 'ID forecast tidak valid.');
    const payload = objectInput(data, 'Forecast');
    const generated = Number(payload.generatedAt);
    const generatedAt = Number.isFinite(generated) ? new Date(generated) : new Date();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ai_forecasts (kumbung_id, id, generated_at, data) VALUES ($1, $2, $3, $4)
         ON CONFLICT (kumbung_id, id) DO UPDATE SET generated_at = EXCLUDED.generated_at, data = EXCLUDED.data`,
        [kumbungId, forecastId, generatedAt, payload],
      );
      await client.query(
        `INSERT INTO ai_forecast_latest (kumbung_id, forecast_id, data) VALUES ($1, $2, $3)
         ON CONFLICT (kumbung_id) DO UPDATE SET forecast_id = EXCLUDED.forecast_id, data = EXCLUDED.data, updated_at = now()`,
        [kumbungId, forecastId, payload],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    hub.emitFarm(farmId, 'forecast', { kumbungId, forecast: payload });
  }

  async function workerLatestForecast(kumbungId) {
    await kumbungFarm(kumbungId);
    return (await readForecast(kumbungId, 0)).forecast;
  }

  async function workerHeartbeat(data) {
    await pool.query(
      `INSERT INTO worker_status (name, data) VALUES ('ai', $1)
       ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [objectInput(data, 'Status worker', 4096)],
    );
  }

  return {
    getKumbungForecast, requestForecast, latestForecasts, workerStatus,
    workerRequests, workerUpdateRequest, workerFeatureInputs, workerReadSensor,
    workerWriteFeatures, workerWriteForecast, workerLatestForecast, workerHeartbeat,
  };
}
