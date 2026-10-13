import { useEffect, useState } from 'react';
import { db } from '../firebase';
import { readTelemetryHistory, subscribeLatestTelemetry } from '@/lib/telemetryService';
import { useFarmContext } from '@/contexts/FarmContext';

/**
 * History telemetry sensor terpilih (konteks farm/kumbung) dalam rentang `rangeMs`, ditambah
 * pembacaan live terbaru tanpa duplikat. `rows` terurut lama → baru.
 */
export function useSensorHistory({ rangeMs, maxPoints = 1200 }) {
  const { target, loading: contextLoading } = useFarmContext();
  const { kumbungId, sensorId } = target;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setRows([]);
    setError('');
    if (!kumbungId || !sensorId) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const endAt = Date.now();
    readTelemetryHistory(db, { kumbungId, sensorId, startAt: endAt - rangeMs, endAt, maxPoints })
      .then(history => {
        if (!active) return;
        setRows(current => mergeRows(history, current, maxPoints));
      })
      .catch(err => active && setError(err.message))
      .finally(() => active && setLoading(false));

    const unsubscribe = subscribeLatestTelemetry(db, telemetry => {
      if (!active || !telemetry?.timestamp) return;
      setRows(current => mergeRows(current, [telemetry], maxPoints));
    }, err => active && setError(err.message), { kumbungId, sensorId });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [kumbungId, sensorId, rangeMs, maxPoints]);

  return { rows, loading: loading || contextLoading, error, target };
}

function mergeRows(base, extra, maxPoints) {
  const byTimestamp = new Map(base.map(row => [row.timestamp, row]));
  extra.forEach(row => byTimestamp.set(row.timestamp, row));
  return [...byTimestamp.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-maxPoints);
}
