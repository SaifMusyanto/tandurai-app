import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { isOfficialBatchForecast, normalizeForecast } from '../lib/forecast';
import { loadForecastScope } from '../lib/forecastService';
import { useIot } from '@/contexts/IotContext';

const normalizeError = error => ({
  code: error?.code || 'unknown',
  message: error?.message || 'Perkiraan panen gagal dimuat',
});

const official = raw => {
  const normalized = raw ? normalizeForecast(raw) : null;
  return isOfficialBatchForecast(normalized) ? normalized : null;
};

/** Forecast terbaru lintas kumbung user (backend), diperbarui lewat event SSE `forecast`. */
export function useDashboardForecast() {
  const { subscribe } = useIot();
  const [scope, setScope] = useState({ kumbungs: [], batches: [] });
  const [forecasts, setForecasts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [nextScope, latest] = await Promise.all([loadForecastScope(), api.latestForecasts()]);
      setScope(nextScope);
      setForecasts(Object.fromEntries(latest.map(item => [item.kumbungId, official(item.forecast)])));
      setError(null);
    } catch (nextError) {
      setError(normalizeError(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const offForecast = subscribe('forecast', event => {
      if (event.forecast) setForecasts(previous => ({ ...previous, [event.kumbungId]: official(event.forecast) }));
    });
    const offReady = subscribe('ready', load);
    return () => { offForecast(); offReady(); };
  }, [load, subscribe]);

  const latest = useMemo(() => Object.entries(forecasts)
    .map(([kumbungId, forecast]) => forecast ? { kumbungId, forecast } : null)
    .filter(Boolean)
    .sort((a, b) => Number(b.forecast.generatedAt || 0) - Number(a.forecast.generatedAt || 0))[0] || null, [forecasts]);

  const kumbung = latest ? scope.kumbungs.find(item => item.id === latest.kumbungId) : null;
  const batch = latest ? scope.batches.find(item => item.id === latest.forecast.input?.batchId) : null;

  return { loading, error, forecast: latest?.forecast || null, kumbung, batch };
}
