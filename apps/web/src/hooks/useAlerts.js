import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { sortAlerts } from '@/lib/alerts';
import { useIot } from '@/contexts/IotContext';

/**
 * Alert seluruh farm user dari backend (dievaluasi server dari telemetry), diperbarui realtime
 * lewat event SSE `alert`. Terurut: aktif dulu, lalu terbaru.
 */
export function useAlerts() {
  const { subscribe } = useIot();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setAlerts(sortAlerts(await api.alerts()));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const offAlert = subscribe('alert', alert => {
      setAlerts(current => sortAlerts([...current.filter(item => item.id !== alert.id), alert]));
    });
    const offReady = subscribe('ready', load);
    const offChanged = subscribe('changed', event => {
      if (['member', 'farm', 'gateway'].includes(event.entity)) load();
    });
    return () => { offAlert(); offReady(); offChanged(); };
  }, [load, subscribe]);

  return { alerts, loading, error, reload: load };
}
