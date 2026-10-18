// Farm Health Score: seberapa dekat kondisi kumbung dengan rentang optimal, memakai sumber yang
// sama dengan bagian lain dashboard — rentang optimal dari lib/parameters dan ambang alert farm
// (Pengaturan → Notifikasi) — sehingga skor tidak bertentangan dengan status KPI maupun alert.
import { DEFAULT_RANGES, PARAMETERS, PARAMETER_KEYS } from '@/lib/parameters';

/** Sama dengan DEFAULT_THRESHOLDS backend (apps/api/src/domainValidate.js). */
export const DEFAULT_ALERT_THRESHOLDS = Object.freeze({
  temperature: { warning: 30, critical: 33 },
  humidity: { warning: 70, critical: 60 },
  co2: { warning: 1500, critical: 2500 },
});

// Bobot dampak ke hasil panen jamur: suhu paling berisiko (miselium/tubuh buah rusak permanen),
// lalu kelembapan (tubuh buah kering/kerdil), lalu CO₂ (tangkai panjang, tudung kecil).
export const HEALTH_WEIGHTS = Object.freeze({ temperature: 0.4, humidity: 0.35, co2: 0.25 });

// Skor di titik ambang: optimal 100, ambang peringatan 70, ambang kritis 30, jauh di luar 0.
const AT_WARNING = 70;
const AT_CRITICAL = 30;
// Skor total tidak boleh melebihi skor parameter terburuk + 20: satu parameter kritis tidak boleh
// tertutupi dua parameter lain yang bagus.
const WORST_MARGIN = 20;

const lerp = (value, fromValue, toValue, fromScore, toScore) => {
  if (toValue === fromValue) return toScore;
  const ratio = Math.min(1, Math.max(0, (value - fromValue) / (toValue - fromValue)));
  return fromScore + (toScore - fromScore) * ratio;
};

/** Skor satu sisi (menjauh dari batas optimal `edge`) melewati ambang peringatan & kritis. */
function sideScore(distance, warningDistance, criticalDistance) {
  const warn = Math.max(0, warningDistance);
  const crit = Math.max(warn, criticalDistance);
  if (distance <= warn) return lerp(distance, 0, warn, 100, AT_WARNING);
  if (distance <= crit) return lerp(distance, warn, crit, AT_WARNING, AT_CRITICAL);
  return lerp(distance, crit, crit + Math.max(crit - warn, 1), AT_CRITICAL, 0);
}

/**
 * Skor 0–100 satu parameter, atau null bila tidak ada data.
 * Sisi yang punya ambang alert (suhu & CO₂ tinggi, kelembapan rendah) memakai ambang farm; sisi
 * lainnya memakai jarak bawaan. CO₂ di bawah rentang optimal tidak merugikan jamur → tetap 100.
 */
export function parameterScore(key, value, thresholds = DEFAULT_ALERT_THRESHOLDS, ranges = DEFAULT_RANGES) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const [low, high] = ranges[key] || DEFAULT_RANGES[key];
  if (value >= low && value <= high) return 100;
  const { warning, critical } = thresholds[key] || DEFAULT_ALERT_THRESHOLDS[key];

  let score;
  if (key === 'temperature') {
    score = value > high ? sideScore(value - high, warning - high, critical - high) : sideScore(low - value, 3, 6);
  } else if (key === 'humidity') {
    score = value < low ? sideScore(low - value, low - warning, low - critical) : sideScore(value - high, 5, 10);
  } else {
    score = value < low ? 100 : sideScore(value - high, warning - high, critical - high);
  }
  return Math.round(score);
}

/** Rata-rata tiap parameter dari deret gabungan (mergeReadings) — meredam lonjakan sesaat. */
export function averageValues(points) {
  const values = {};
  for (const key of PARAMETER_KEYS) {
    const list = points.map(point => point[key]).filter(value => typeof value === 'number' && Number.isFinite(value));
    if (list.length) values[key] = Number((list.reduce((sum, value) => sum + value, 0) / list.length).toFixed(PARAMETERS[key].decimals));
  }
  return values;
}

/**
 * values: { temperature, humidity, co2 } (sebaiknya rata-rata beberapa menit terakhir, bukan satu
 * pembacaan). Parameter tanpa data tidak dihitung dan bobotnya dibagi ke parameter lain.
 * Hasil: { overall|null, parts: [{ key, value, score }] }.
 */
export function farmHealthScore(values, thresholds = DEFAULT_ALERT_THRESHOLDS, ranges = DEFAULT_RANGES) {
  const parts = PARAMETER_KEYS.map(key => ({ key, value: values?.[key] ?? null, score: parameterScore(key, values?.[key], thresholds, ranges) }));
  const scored = parts.filter(part => part.score !== null);
  if (!scored.length) return { overall: null, parts };
  const weight = scored.reduce((sum, part) => sum + HEALTH_WEIGHTS[part.key], 0);
  const weighted = scored.reduce((sum, part) => sum + part.score * HEALTH_WEIGHTS[part.key], 0) / weight;
  const worst = Math.min(...scored.map(part => part.score));
  return { overall: Math.round(Math.min(weighted, worst + WORST_MARGIN)), parts };
}
