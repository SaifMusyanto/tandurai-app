// Isi histori telemetry SIMULASI untuk sensor gateway (uji tampilan grafik). Setiap baris diberi
// penanda "simulated": true dan tidak menimpa data asli (ON CONFLICT DO NOTHING).
//   node tools/seed-history.mjs --gateway TDR-XXXX [--days 7]
//   node tools/seed-history.mjs --gateway TDR-XXXX --remove      # hapus hanya baris simulasi
import pg from 'pg';
import { loadEnvFile } from '../src/config.js';

const arg = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const gatewayId = arg('--gateway');
if (!gatewayId) throw new Error('Pakai: node tools/seed-history.mjs --gateway <hwUid> [--days 7] [--remove]');
const days = Math.min(Math.max(Number(arg('--days') || 7), 1), 60);
const BUCKET_MS = 10 * 60 * 1000;

// Pola harian sederhana (WIB): suhu naik siang hari, kelembapan sebaliknya, CO₂ naik malam hari.
// Beda posisi per sensor (indeks urut sensor gateway) agar tiap sensor punya nilai sendiri.
const OFFSETS = [{ temperature: 0, humidity: 0, co2: 0 }, { temperature: 0.8, humidity: -3.5, co2: 70 }, { temperature: -0.5, humidity: 2, co2: -40 }];

function reading(metric, ts, offset = {}) {
  const hour = (new Date(ts).getUTCHours() + 7 + new Date(ts).getUTCMinutes() / 60) % 24;
  const day = Math.sin(((hour - 8) / 24) * 2 * Math.PI); // puncak ±14:00
  const noise = (Math.random() - 0.5);
  const shift = offset[metric] ?? 0;
  switch (metric) {
    case 'temperature': return Number((26 + 2.5 * day + noise * 0.6 + shift).toFixed(1));
    case 'humidity': return Number(Math.min(98, 84 - 7 * day + noise * 2 + shift).toFixed(1));
    case 'co2': return Math.round(800 - 250 * day + noise * 80 + shift);
    case 'pressure': return Number((1009 + noise).toFixed(1));
    default: return null;
  }
}

loadEnvFile();
const pool = new pg.Pool({ connectionString: arg('--database-url') || process.env.DATABASE_URL || 'postgres://postgres@localhost:5433/tandurai_iot' });
try {
  const { rows: sensors } = await pool.query('SELECT id, metrics FROM sensors WHERE gateway_id = $1 ORDER BY local_id', [gatewayId]);
  if (!sensors.length) throw new Error(`Gateway ${gatewayId} belum diklaim atau tidak punya sensor.`);
  if (process.argv.includes('--remove')) {
    const { rowCount } = await pool.query(
      `DELETE FROM telemetry_history WHERE sensor_id = ANY($1) AND "values" ? 'simulated'`,
      [sensors.map(sensor => sensor.id)],
    );
    console.log(`Dihapus ${rowCount} baris histori simulasi.`);
  } else {
    const end = Date.now() - (Date.now() % BUCKET_MS);
    let inserted = 0;
    for (const [index, sensor] of sensors.entries()) {
      const ids = [];
      const buckets = [];
      const values = [];
      for (let ts = end - days * 86400000; ts < end; ts += BUCKET_MS) {
        const row = { simulated: true };
        for (const metric of sensor.metrics) {
          const value = reading(metric, ts, OFFSETS[index % OFFSETS.length]);
          if (value !== null) row[metric] = value;
        }
        ids.push(sensor.id);
        buckets.push(new Date(ts));
        values.push(JSON.stringify(row));
      }
      inserted += (await pool.query(
        `INSERT INTO telemetry_history (sensor_id, bucket_start, ts, "values")
         SELECT s, b, b, v FROM unnest($1::text[], $2::timestamptz[], $3::jsonb[]) AS x(s, b, v)
         ON CONFLICT DO NOTHING`,
        [ids, buckets, values],
      )).rowCount;
    }
    console.log(`Ditambahkan ${inserted} baris histori simulasi (${days} hari, ${sensors.length} sensor). Data asli tidak ditimpa.`);
  }
} finally {
  await pool.end();
}
