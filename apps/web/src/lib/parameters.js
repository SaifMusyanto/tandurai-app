// Satu sumber definisi parameter lingkungan kumbung yang dipakai seluruh dashboard.
// Hanya parameter yang diukur sensor Tandurai: suhu, kelembapan, CO₂.
// `optimal` = rekomendasi bawaan untuk fruiting jamur tiram putih (sama dengan DEFAULT_OPTIMAL
// backend). Rentang yang berlaku per farm diatur di Pengaturan → Notifikasi dan dibaca dari
// FarmContext (`ranges`); fungsi di bawah menerima `ranges` opsional.

export const PARAMETERS = Object.freeze({
  temperature: Object.freeze({ key: 'temperature', label: 'Suhu', unit: '°C', color: '#f97316', optimal: [22, 28], decimals: 1 }),
  humidity: Object.freeze({ key: 'humidity', label: 'Kelembapan', unit: '%', color: '#3b82f6', optimal: [80, 90], decimals: 1 }),
  co2: Object.freeze({ key: 'co2', label: 'CO₂', unit: 'ppm', color: '#8b5cf6', optimal: [400, 1000], decimals: 0 }),
});

export const PARAMETER_KEYS = Object.freeze(Object.keys(PARAMETERS));

/** Rentang optimal bawaan: { temperature: [min, max], ... }. */
export const DEFAULT_RANGES = Object.freeze(Object.fromEntries(Object.entries(PARAMETERS).map(([key, item]) => [key, item.optimal])));

/** Rentang optimal farm dari backend ({ temperature: { min, max } }) → bentuk `ranges`. */
export function rangesFromOptimal(optimal) {
  return Object.fromEntries(Object.keys(PARAMETERS).map(key => {
    const item = optimal?.[key];
    return [key, Number.isFinite(item?.min) && Number.isFinite(item?.max) ? [item.min, item.max] : DEFAULT_RANGES[key]];
  }));
}

/** 'optimal' | 'warning' | 'no-data' terhadap rentang optimal parameter (farm atau bawaan). */
export function parameterStatus(key, value, ranges = DEFAULT_RANGES) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'no-data';
  const [min, max] = ranges[key] || DEFAULT_RANGES[key];
  return value < min || value > max ? 'warning' : 'optimal';
}

/** Nilai berformat dengan satuan, atau '—' bila kosong. */
export function formatParameter(key, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const { unit, decimals } = PARAMETERS[key];
  return `${Number(value.toFixed(decimals))}${unit === '%' || unit === '°C' ? '' : ' '}${unit}`;
}

/**
 * Gabungkan baris telemetry beberapa sensor kumbung menjadi satu deret: nilai tiap parameter pada
 * waktu yang sama (dalam `bucketMs`, default 1 menit) dirata-ratakan antar sensor. Masukan harus
 * baris mentah per sensor (jangan menggabungkan hasil yang sudah dirata-rata).
 * Hasil terurut lama → baru: [{ timestamp, temperature?, humidity?, co2?, sensors }].
 */
export function mergeReadings(rows, { bucketMs = 60 * 1000 } = {}) {
  const groups = new Map();
  for (const row of rows) {
    if (!row?.timestamp) continue;
    const key = Math.floor(row.timestamp / bucketMs);
    const group = groups.get(key) || { timestamp: row.timestamp, sums: {}, counts: {}, sensors: new Set() };
    group.timestamp = Math.min(group.timestamp, row.timestamp);
    if (row.sensorId) group.sensors.add(row.sensorId);
    for (const metric of PARAMETER_KEYS) {
      if (typeof row[metric] === 'number' && Number.isFinite(row[metric])) {
        group.sums[metric] = (group.sums[metric] || 0) + row[metric];
        group.counts[metric] = (group.counts[metric] || 0) + 1;
      }
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(group => {
      const point = { timestamp: group.timestamp, sensors: group.sensors.size };
      for (const metric of Object.keys(group.sums)) {
        point[metric] = Number((group.sums[metric] / group.counts[metric]).toFixed(PARAMETERS[metric].decimals));
      }
      return point;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Baris mentah per sensor tanpa duplikat (kunci sensor + timestamp), terurut lama → baru. */
export function uniqueReadings(rows) {
  const byKey = new Map();
  for (const row of rows) if (row?.timestamp) byKey.set(`${row.sensorId || ''}|${row.timestamp}`, row);
  return [...byKey.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/** Nilai terakhir tiap parameter dari deret gabungan (parameter bisa berasal dari baris berbeda). */
export function latestValues(points) {
  const values = {};
  for (const key of PARAMETER_KEYS) {
    for (let index = points.length - 1; index >= 0; index -= 1) {
      if (typeof points[index][key] === 'number') { values[key] = points[index][key]; break; }
    }
  }
  return values;
}
