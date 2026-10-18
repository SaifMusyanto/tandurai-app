import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { auth } from '../firebase';
import { isOfficialBatchForecast } from '../lib/forecast';
import { loadForecastForKumbung, loadForecastScope, requestForecast } from '../lib/forecastService';
import { useFarmContext } from '@/contexts/FarmContext';

const normalizeError = error => ({
  code: error?.code || 'unknown',
  message: error?.message || 'Forecast gagal dimuat',
});

// Backend mengizinkan anggota farm (owner/operator) meminta perhitungan.
const REQUEST_ROLES = new Set(['owner', 'operator']);

export function useForecastData() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedKumbungId = useRef(searchParams.get('kumbung')).current;
  const requestedBatchId = useRef(searchParams.get('batch')).current;
  const [scope, setScope] = useState({ role: 'viewer', roles: {}, farmIds: [], kumbungs: [], batches: [] });
  const [selectedKumbungId, setSelectedKumbungId] = useState('');
  const { selection, selectKumbung } = useFarmContext();
  const contextKumbungId = selection.kumbungId;
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [forecast, setForecast] = useState(null);
  const [history, setHistory] = useState([]);
  const [calculation, setCalculation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const selectedFarmId = scope.kumbungs.find(item => item.id === selectedKumbungId)?.farmId;
  const requestRole = scope.roles?.[selectedFarmId] || null;

  const batches = useMemo(
    () => scope.batches
      .filter(batch => batch.kumbungId === selectedKumbungId && batch.status === 'active')
      .sort((a, b) => Number(b.startedAt) - Number(a.startedAt)),
    [scope.batches, selectedKumbungId],
  );

  useEffect(() => {
    let active = true;
    loadForecastScope()
      .then(nextScope => {
        if (!active) return;
        setScope(nextScope);
        // Deep link ?kumbung= didahulukan, lalu kumbung konteks, lalu kumbung pertama.
        const deepLinked = nextScope.kumbungs.find(item => item.id === requestedKumbungId);
        if (deepLinked) selectKumbung(deepLinked.farmId, deepLinked.id);
        setSelectedKumbungId(previous => previous || deepLinked?.id || nextScope.kumbungs[0]?.id || '');
        if (!nextScope.kumbungs.length) setLoading(false);
      })
      .catch(nextError => {
        if (active) { setError(normalizeError(nextError)); setLoading(false); }
      });
    return () => { active = false; };
    // selectKumbung stabil per user; cukup dijalankan saat parameter awal berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedKumbungId]);

  // Konteks dashboard → halaman forecast.
  useEffect(() => {
    if (contextKumbungId && scope.kumbungs.some(item => item.id === contextKumbungId)) {
      setSelectedKumbungId(contextKumbungId);
    }
  }, [contextKumbungId, scope.kumbungs]);

  // Halaman forecast → konteks dashboard (kumbung bisa dari farm lain).
  const chooseKumbung = useCallback(kumbungId => {
    setSelectedKumbungId(kumbungId);
    const farmId = scope.kumbungs.find(item => item.id === kumbungId)?.farmId;
    if (farmId) selectKumbung(farmId, kumbungId);
  }, [scope.kumbungs, selectKumbung]);

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
      const result = await loadForecastForKumbung(selectedKumbungId);
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
        if (REQUEST_ROLES.has(requestRole) && auth.currentUser?.uid) {
          const request = await requestForecast(selectedKumbungId, selectedBatchId);
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
  }, [selectedKumbungId, selectedBatchId, refreshKey, requestRole]);

  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  return {
    scope, batches, selectedKumbungId, setSelectedKumbungId: chooseKumbung,
    selectedBatchId, setSelectedBatchId, forecast, history,
    calculation, loading, error, refresh,
  };
}