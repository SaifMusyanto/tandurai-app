import { api } from './api';
import { historyValues, isOfficialBatchForecast, normalizeForecast } from './forecast';

/** Kumbung & batch semua farm user + role per farm (untuk hak meminta perhitungan). */
export async function loadForecastScope() {
  const { roles, farms, kumbungs, batches } = await api.operations();
  return { roles, farmIds: farms.map(farm => farm.id), kumbungs, batches };
}

export async function loadForecastForKumbung(kumbungId) {
  const { forecast, history, request } = await api.forecast(kumbungId);
  const latest = forecast ? normalizeForecast(forecast) : null;
  return {
    forecast: isOfficialBatchForecast(latest) ? latest : null,
    history: historyValues(Object.fromEntries(history.map(({ id, ...item }) => [id, item]))).filter(isOfficialBatchForecast),
    request: request || null,
  };
}

/** Minta AI worker lokal menghitung forecast batch aktif (diproses lewat API worker backend). */
export function requestForecast(kumbungId, batchId) {
  return api.requestForecast(kumbungId, batchId);
}
