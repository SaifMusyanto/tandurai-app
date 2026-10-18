export const FORECAST_STALE_AFTER_MS = 36 * 60 * 60 * 1000;
export const OFFICIAL_FORECAST_TYPE = 'batch_total';
// v3 = model batch dari histori kondisi sepanjang batch (300–500 kg/1000 baglog aktif).
export const OFFICIAL_FORECAST_METHODS = Object.freeze(['trained-batch-model-v3-condition-history', 'trained-batch-model-v1']);
export const OFFICIAL_FORECAST_METHOD = OFFICIAL_FORECAST_METHODS[0];

const finiteOrNull = value => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export function normalizeForecast(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const generatedAt = finiteOrNull(raw.generatedAt);
  const p10Kg = Math.max(0, finiteOrNull(raw.p10Kg) ?? 0);
  const p50Kg = Math.max(p10Kg, finiteOrNull(raw.p50Kg) ?? p10Kg);
  const p90Kg = Math.max(p50Kg, finiteOrNull(raw.p90Kg) ?? p50Kg);
  return {
    ...raw,
    generatedAt,
    forecastKg: Math.max(0, finiteOrNull(raw.forecastKg) ?? 0),
    p10Kg,
    p50Kg,
    p90Kg,
    supplyCommitmentKg: Math.max(0, finiteOrNull(raw.supplyCommitmentKg) ?? 0),
    forecastType: raw.forecastType || 'legacy_7_day',
    forecastMethod: raw.forecastMethod || raw.model?.forecastMethod || null,
    horizonDays: finiteOrNull(raw.horizonDays),
    stale: !generatedAt || now - generatedAt > FORECAST_STALE_AFTER_MS,
  };
}

export function isOfficialBatchForecast(forecast) {
  return Boolean(
    forecast
    && forecast.forecastType === OFFICIAL_FORECAST_TYPE
    && OFFICIAL_FORECAST_METHODS.includes(forecast.forecastMethod || forecast.model?.forecastMethod)
    && forecast.input?.batchId,
  );
}

export function forecastViewState({ loading, error, forecast }) {
  if (loading) return 'loading';
  if (error?.code === 'PERMISSION_DENIED' || error?.code === 'permission-denied') return 'unauthorized';
  if (error) return 'error';
  if (!forecast) return 'empty';
  if (forecast.status === 'insufficient_data') return 'insufficient';
  if (forecast.stale) return 'stale';
  return 'success';
}

export const formatKg = value => `${Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })} kg`;

export const formatJakarta = timestamp => timestamp
  ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(timestamp))
  : '—';

export const formatForecastDate = value => value
  ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' })
    .format(new Date(`${value}T00:00:00+07:00`))
  : '—';

export const historyValues = raw => Object.entries(raw || {})
  .map(([id, value]) => ({ id, ...normalizeForecast(value) }))
  .filter(item => item.generatedAt)
  .sort((a, b) => b.generatedAt - a.generatedAt);

