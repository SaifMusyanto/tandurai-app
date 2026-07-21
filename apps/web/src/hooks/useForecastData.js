import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { auth, db } from '../firebase';
import { isOfficialBatchForecast } from '../lib/forecast';
import { loadForecastForKumbung, loadForecastScope, requestForecast } from '../lib/forecastService';

const normalizeError = error => ({
  code: error?.code || 'unknown',
  message: error?.message || 'Forecast gagal dimuat',
});

const REQUEST_ROLES = new Set(['admin', 'manager', 'operator']);

export function useForecastData() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedKumbungId = useRef(searchParams.get('kumbung')).current;
  const requestedBatchId = useRef(searchParams.get('batch')).current;
  const [scope, setScope] = useState({ role: 'viewer', farmIds: [], kumbungs: [], batches: [] });
  const [selectedKumbungId, setSelectedKumbungId] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [forecast, setForecast] = useState(null);
  const [history, setHistory] = useState([]);
  const [calculation, setCalculation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const batches = useMemo(
    () => scope.batches
      .filter(batch => batch.kumbungId === selectedKumbungId && batch.status === 'active')
      .sort((a, b) => Number(b.startedAt) - Number(a.startedAt)),
    [scope.batches, selectedKumbungId],
  );

  useEffect(() => {
    let active = true;
    loadForecastScope(db, auth.currentUser?.uid)
      .then(nextScope => {
        if (!active) return;
        setScope(nextScope);
        setSelectedKumbungId(previous => previous || (
          nextScope.kumbungs.some(item => item.id === requestedKumbungId)
            ? requestedKumbungId
            : nextScope.kumbungs[0]?.id || ''
        ));
        if (!nextScope.kumbungs.length) setLoading(false);
      })
      .catch(nextError => {
        if (active) { setError(normalizeError(nextError)); setLoading(false); }
      });
    return () => { active = false; };
  }, [requestedKumbungId]);

  useEffect(() => {
    setSelectedBatchId(previous => {
      if (batches.some(batch => batch.id === previous)) return previous;
      if (batches.some(batch => batch.id === requestedBatchId)) return requestedBatchId;
      return batches[0]?.id || '';
    });
  }, [batches, requestedBatchId]);

  useEffect(() => {
    if (!selectedKumbungId) return;
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('kumbung', selectedKumbungId);
      if (selectedBatchId) next.set('batch', selectedBatchId);
      else next.delete('batch');
      return next;
    }, { replace: true });
  }, [selectedKumbungId, selectedBatchId, setSearchParams]);

  useEffect(() => {
    if (!selectedKumbungId || !selectedBatchId) {
      setForecast(null);
      setHistory([]);
      setCalculation(null);
      if (selectedKumbungId) setLoading(false);
      return undefined;
    }
    let active = true;
    let timer;
    let attempts = 0;
    let requestedAt = 0;

    const load = async () => {
      const result = await loadForecastForKumbung(db, selectedKumbungId);
      if (!active) return;
      const matchingForecast = result.forecast?.input?.batchId === selectedBatchId && isOfficialBatchForecast(result.forecast) ? result.forecast : null;
      setForecast(matchingForecast);
      setHistory(result.history.filter(item => item.input?.batchId === selectedBatchId && isOfficialBatchForecast(item)));
      setCalculation(result.request?.batchId === selectedBatchId ? result.request : null);
      setLoading(false);
      const completedThisRequest = Number(result.request?.processedRequestedAt || 0) >= requestedAt
        && result.request?.batchId === selectedBatchId
        && ['completed', 'insufficient_data', 'failed'].includes(result.request?.status);
      if (requestedAt && !completedThisRequest && attempts < 30) {
        attempts += 1;
        timer = setTimeout(load, 1500);
      }
    };

    const start = async () => {
      setLoading(true);
      setForecast(null);
      setError(null);
      try {
        if (REQUEST_ROLES.has(scope.role) && auth.currentUser?.uid) {
          const request = await requestForecast(db, selectedKumbungId, selectedBatchId, auth.currentUser.uid);
          requestedAt = request.requestedAt;
          setCalculation(request);
        }
        await load();
      } catch (nextError) {
        if (active) { setError(normalizeError(nextError)); setLoading(false); }
      }
    };
    start();
    return () => { active = false; clearTimeout(timer); };
  }, [selectedKumbungId, selectedBatchId, refreshKey, scope.role]);

  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  return {
    scope, batches, selectedKumbungId, setSelectedKumbungId,
    selectedBatchId, setSelectedBatchId, forecast, history,
    calculation, loading, error, refresh,
  };
}