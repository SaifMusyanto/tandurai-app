import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth } from '../firebase';
import { loadDeviceFarms, subscribeFarmSensors } from '@/lib/deviceManagementService';
import { readStoredSelection, resolveSelection, writeStoredSelection } from '@/lib/farmContext';

const FarmContext = createContext(undefined);

/**
 * Konteks farm/kumbung/sensor untuk seluruh dashboard. Halaman membaca `target`
 * ({ kumbungId, sensorId }) alih-alih ID default; pilihan terakhir diingat per user.
 */
export function FarmProvider({ children }) {
  const uid = auth.currentUser?.uid;
  const [farms, setFarms] = useState([]);
  const [farmsLoading, setFarmsLoading] = useState(true);
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState({ farmId: null, kumbungs: [], sensors: [] });
  const [stored, setStored] = useState(() => (uid ? readStoredSelection(uid) : {}));

  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;
    setFarmsLoading(true);
    loadDeviceFarms(uid)
      .then(result => { if (!cancelled) { setFarms(result); setError(''); } })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setFarmsLoading(false); });
    return () => { cancelled = true; };
  }, [uid]);

  const farmId = resolveSelection({ farms, stored }).farmId;

  useEffect(() => {
    if (!farmId) return undefined;
    return subscribeFarmSensors(farmId, next => setCatalog({ farmId, ...next }), err => setError(err.message));
  }, [farmId]);

  const catalogReady = catalog.farmId === farmId;
  const kumbungs = useMemo(() => (catalogReady ? catalog.kumbungs : []), [catalogReady, catalog.kumbungs]);
  const sensors = useMemo(() => (catalogReady ? catalog.sensors : []), [catalogReady, catalog.sensors]);
  const selection = useMemo(
    () => resolveSelection({ farms, kumbungs, sensors, stored }),
    [farms, kumbungs, sensors, stored],
  );

  const update = useCallback(changes => {
    setStored(current => {
      const next = { ...current, ...changes };
      if (uid) writeStoredSelection(uid, next);
      return next;
    });
  }, [uid]);

  const value = useMemo(() => {
    const farm = farms.find(item => item.id === selection.farmId) || null;
    return {
      loading: farmsLoading || (Boolean(selection.farmId) && !catalogReady),
      error,
      farms,
      farm,
      role: farm?.role || null,
      isOwner: farm?.role === 'owner',
      kumbungs,
      kumbung: kumbungs.find(item => item.id === selection.kumbungId) || null,
      sensors,
      kumbungSensors: sensors.filter(sensor => sensor.kumbungId === selection.kumbungId),
      sensor: sensors.find(item => item.id === selection.sensorId) || null,
      selection,
      /** Target telemetry untuk halaman; `sensorId: null` berarti kumbung belum punya sensor. */
      target: { kumbungId: selection.kumbungId, sensorId: selection.sensorId },
      setFarmId: id => update({ farmId: id, kumbungId: null, sensorId: null }),
      setKumbungId: id => update({ kumbungId: id, sensorId: null }),
      setSensorId: id => update({ sensorId: id }),
    };
  }, [farms, farmsLoading, error, kumbungs, sensors, selection, catalogReady, update]);

  return <FarmContext.Provider value={value}>{children}</FarmContext.Provider>;
}

export function useFarmContext() {
  const context = useContext(FarmContext);
  if (context === undefined) throw new Error('useFarmContext harus dipakai di dalam FarmProvider');
  return context;
}
