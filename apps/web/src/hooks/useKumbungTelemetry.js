import { useEffect, useMemo, useState } from 'react';
import { useFarmContext } from '@/contexts/FarmContext';
import { latestFromSensor, readTelemetryHistory } from '@/lib/telemetryService';
import { mergeReadings, uniqueReadings } from '@/lib/parameters';

/**
 * Sumber tunggal data lingkungan kumbung terpilih, mengikuti pilihan sensor di konteks:
 * semua sensor kumbung (nilai dirata-rata) atau satu sensor. Hanya parameter resmi (suhu,
 * kelembapan, CO₂). Status online dievaluasi ulang tiap 30 detik.
 * → { values, timestamp, online, readings, sensorCount, allSensors }
 */
export function useKumbungTelemetry() {
  const { scopeSensors, selection } = useFarmContext();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  return useMemo(() => {
    const readings = scopeSensors.map(sensor => latestFromSensor(sensor, now)).filter(Boolean);
    const fresh = readings.filter(reading => !reading.quality.stale);
    // Nilai terbaru tiap sensor dirata-rata menjadi satu nilai kumbung.
    const [average = {}] = mergeReadings(readings, { bucketMs: Infinity });
    const { timestamp, sensors, ...values } = average;
    return {
      values,
      timestamp: readings.length ? Math.max(...readings.map(reading => reading.timestamp)) : null,
      online: fresh.length > 0 && scopeSensors.some(sensor => sensor.gatewayOnline),
      readings,
      sensorCount: scopeSensors.length,
      allSensors: Boolean(selection.allSensors),
    };
  }, [scopeSensors, selection.allSensors, now]);
}

/**
 * Histori kumbung terpilih dalam `rangeMs` (sampel 10 menit dari backend) + pembacaan live,
 * mengikuti pilihan sensor. Baris mentah per sensor disimpan terpisah lalu dirata-rata per waktu,
 * sehingga data live tidak merata-ratakan ulang hasil rata-rata. `rows` terurut lama → baru.
 */
export function useKumbungHistory({ rangeMs, maxPoints = 4000 }) {
  const { target, selection, scopeSensors, loading: contextLoading } = useFarmContext();
  const { kumbungId } = target;
  const sensorId = selection.allSensors ? null : selection.sensorId;
  const { readings } = useKumbungTelemetry();
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setRaw([]);
    setError('');
    if (!kumbungId) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const endAt = Date.now();
    // Per sensor sekitar 1 titik / 10 menit; batas dikali jumlah sensor agar semua sensor terbawa.
    readTelemetryHistory({ kumbungId, sensorId, startAt: endAt - rangeMs, endAt, maxPoints: maxPoints * Math.max(1, scopeSensors.length) })
      .then(history => active && setRaw(current => uniqueReadings([...history, ...current])))
      .catch(err => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
    // scopeSensors.length hanya memengaruhi batas jumlah titik.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kumbungId, sensorId, rangeMs, maxPoints]);

  useEffect(() => {
    if (readings.length) setRaw(current => uniqueReadings([...current, ...readings]));
  }, [readings]);

  const rows = useMemo(() => {
    const allowed = new Set(scopeSensors.map(sensor => sensor.id));
    return mergeReadings(raw.filter(row => !row.sensorId || allowed.has(row.sensorId))).slice(-maxPoints);
  }, [raw, scopeSensors, maxPoints]);

  return { rows, loading: loading || contextLoading, error, target };
}
