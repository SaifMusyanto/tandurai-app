import { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { auth, db } from '../firebase';
import { FIREBASE_PATHS } from '../lib/firebasePaths';
import { isOfficialBatchForecast, normalizeForecast } from '../lib/forecast';
import { loadForecastScope } from '../lib/forecastService';

const normalizeError = error => ({
  code: error?.code || 'unknown',
  message: error?.message || 'Perkiraan panen gagal dimuat',
});

export function useDashboardForecast() {
  const [scope, setScope] = useState({ kumbungs: [], batches: [] });
  const [forecasts, setForecasts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    let unsubscribers = [];

    loadForecastScope(db, auth.currentUser?.uid)
      .then(nextScope => {
        if (!active) return;
        setScope(nextScope);
        if (!nextScope.kumbungs.length) {
          setLoading(false);
          return;
        }

        unsubscribers = nextScope.kumbungs.map(kumbung => onValue(
          ref(db, FIREBASE_PATHS.latestForecast(kumbung.id)),
          snapshot => {
            if (!active) return;
            const normalized = snapshot.exists() ? normalizeForecast(snapshot.val()) : null;
            setForecasts(previous => ({
              ...previous,
              [kumbung.id]: isOfficialBatchForecast(normalized) ? normalized : null,
            }));
            setLoading(false);
          },
          nextError => {
            if (!active) return;
            setError(normalizeError(nextError));
            setLoading(false);
          },
        ));
      })
      .catch(nextError => {
        if (!active) return;
        setError(normalizeError(nextError));
        setLoading(false);
      });

    return () => {
      active = false;
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, []);

  const latest = useMemo(() => Object.entries(forecasts)
    .map(([kumbungId, forecast]) => forecast ? { kumbungId, forecast } : null)
    .filter(Boolean)
    .sort((a, b) => Number(b.forecast.generatedAt || 0) - Number(a.forecast.generatedAt || 0))[0] || null, [forecasts]);

  const kumbung = latest ? scope.kumbungs.find(item => item.id === latest.kumbungId) : null;
  const batch = latest ? scope.batches.find(item => item.id === latest.forecast.input?.batchId) : null;

  return { loading, error, forecast: latest?.forecast || null, kumbung, batch };
}