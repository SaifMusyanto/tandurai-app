import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth } from '../firebase';
import { api } from '@/lib/api';
import { readStoredSelection, resolveSelection, writeStoredSelection } from '@/lib/farmContext';
import { useIot } from '@/contexts/IotContext';
import { DEFAULT_RANGES, rangesFromOptimal } from '@/lib/parameters';
import { DEFAULT_ALERT_THRESHOLDS } from '@/lib/healthScore';

const FarmContext = createContext(undefined);

// Admin Tandurai: konsol admin secara bawaan; "buka dashboard farm" menyimpan farm klien yang
// sedang dilihat di sessionStorage (per tab) sampai admin kembali ke konsol.
const ADMIN_FARM_VIEW_KEY = 'tandurai.adminFarmView';
const readAdminFarmView = () => {
  try { return sessionStorage.getItem(ADMIN_FARM_VIEW_KEY) || null; } catch { return null; }
};

/** Nilai pilihan sensor untuk "semua sensor kumbung (rata-rata)" — bawaan saat kumbung dipilih. */
export const ALL_SENSORS = 'all';

/**
 * Konteks farm/kumbung/sensor untuk seluruh dashboard (data dari backend). Halaman membaca `target`
 * ({ kumbungId, sensorId }) alih-alih ID default; pilihan terakhir diingat per user.
 * Sensor = sensor gateway farm yang ditempatkan di kumbung (dari IotContext, realtime).
 * Harus berada di dalam IotProvider (memakai SSE bersama untuk event `changed`).
 */
export function FarmProvider({ children }) {
  const uid = auth.currentUser?.uid;
  const { gateways, subscribe } = useIot();
  const [profile, setProfile] = useState(null);
  const [farms, setFarms] = useState([]);
  const [farmsLoading, setFarmsLoading] = useState(true);
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState({ farmId: null, kumbungs: [] });
  const [stored, setStored] = useState(() => (uid ? readStoredSelection(uid) : {}));
  const [adminFarmView, setAdminFarmView] = useState(readAdminFarmView);
  // Rentang optimal & ambang alert farm terpilih (Pengaturan → Notifikasi); bawaan bila gagal dimuat.
  const [farmSettings, setFarmSettings] = useState({ farmId: null, ranges: DEFAULT_RANGES, thresholds: DEFAULT_ALERT_THRESHOLDS });

  const loadMe = useCallback(async () => {
    try {
      const me = await api.me();
      setProfile(me);
      setFarms(me.farms);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setFarmsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!uid) return;
    setFarmsLoading(true);
    loadMe();
  }, [uid, loadMe]);

  const farmId = resolveSelection({ farms, stored }).farmId;

  const loadKumbungs = useCallback(async id => {
    try {
      setCatalog({ farmId: id, kumbungs: await api.kumbungs(id) });
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (farmId) loadKumbungs(farmId);
  }, [farmId, loadKumbungs]);

  const loadFarmSettings = useCallback(async id => {
    try {
      const settings = await api.alertSettings(id);
      setFarmSettings({ farmId: id, ranges: rangesFromOptimal(settings.optimal), thresholds: settings.thresholds || DEFAULT_ALERT_THRESHOLDS });
    } catch {
      setFarmSettings({ farmId: id, ranges: DEFAULT_RANGES, thresholds: DEFAULT_ALERT_THRESHOLDS });
    }
  }, []);

  useEffect(() => {
    if (farmId) loadFarmSettings(farmId);
  }, [farmId, loadFarmSettings]);

  // Perubahan dari pengguna lain / tab lain (SSE `changed`) dan sinkron ulang setelah reconnect.
  useEffect(() => {
    const offChanged = subscribe('changed', event => {
      if (['farm', 'member'].includes(event.entity)) loadMe();
      if (event.entity === 'kumbung' && event.farmId === farmId) loadKumbungs(farmId);
    });
    const offReady = subscribe('ready', () => {
      loadMe();
      if (farmId) loadKumbungs(farmId);
    });
    return () => { offChanged(); offReady(); };
  }, [subscribe, loadMe, loadKumbungs, farmId]);

  const catalogReady = catalog.farmId === farmId;
  const kumbungs = useMemo(() => (catalogReady ? catalog.kumbungs : []), [catalogReady, catalog.kumbungs]);
  const sensors = useMemo(() => gateways
    .filter(gateway => gateway.farmId === farmId)
    .flatMap(gateway => gateway.sensors
      .filter(sensor => sensor.kumbungId)
      .map(sensor => ({ ...sensor, farmId, gatewayName: gateway.name, gatewayOnline: gateway.online })))
    .sort((a, b) => a.id.localeCompare(b.id)), [gateways, farmId]);
  // Tanpa pilihan sensor (atau "all") → semua sensor kumbung dirata-rata.
  const selection = useMemo(() => {
    const resolved = resolveSelection({ farms, kumbungs, sensors, stored });
    const chosen = stored.sensorId && stored.sensorId !== ALL_SENSORS
      && sensors.some(item => item.id === stored.sensorId && item.kumbungId === resolved.kumbungId);
    return resolved.legacy || chosen ? resolved : { ...resolved, sensorId: null, allSensors: true };
  }, [farms, kumbungs, sensors, stored]);

  const update = useCallback(changes => {
    setStored(current => {
      const next = { ...current, ...changes };
      if (uid) writeStoredSelection(uid, next);
      return next;
    });
  }, [uid]);

  const enterFarmAsAdmin = useCallback(id => {
    try { sessionStorage.setItem(ADMIN_FARM_VIEW_KEY, id); } catch { /* tab privat: cukup state */ }
    setAdminFarmView(id);
    update({ farmId: id, kumbungId: null, sensorId: null });
  }, [update]);

  const exitFarmView = useCallback(() => {
    try { sessionStorage.removeItem(ADMIN_FARM_VIEW_KEY); } catch { /* abaikan */ }
    setAdminFarmView(null);
  }, []);

  const createFarm = useCallback(async input => {
    const farm = await api.createFarm(input);
    await loadMe();
    update({ farmId: farm.id, kumbungId: null, sensorId: null });
    return farm;
  }, [loadMe, update]);

  const value = useMemo(() => {
    const farm = farms.find(item => item.id === selection.farmId) || null;
    const kumbungSensors = sensors.filter(sensor => sensor.kumbungId === selection.kumbungId);
    const sensor = sensors.find(item => item.id === selection.sensorId) || null;
    return {
      loading: farmsLoading || (Boolean(selection.farmId) && !catalogReady),
      error,
      profile,
      farms,
      farm,
      role: farm?.role || null,
      isOwner: farm?.role === 'owner',
      kumbungs,
      kumbung: kumbungs.find(item => item.id === selection.kumbungId) || null,
      sensors,
      kumbungSensors,
      sensor,
      /** Sensor yang datanya ditampilkan: semua sensor kumbung (rata-rata) atau satu sensor pilihan. */
      scopeSensors: selection.allSensors ? kumbungSensors : sensor ? [sensor] : [],
      selection,
      /** Target telemetry untuk halaman; `sensorId: null` berarti kumbung belum punya sensor. */
      target: { kumbungId: selection.kumbungId, sensorId: selection.sensorId },
      setFarmId: id => update({ farmId: id, kumbungId: null, sensorId: null }),
      setKumbungId: id => update({ kumbungId: id, sensorId: null }),
      setSensorId: id => update({ sensorId: id || ALL_SENSORS }),
      /** Pilih kumbung sekaligus farm-nya (dipakai halaman yang menampilkan kumbung lintas farm). */
      selectKumbung: (nextFarmId, kumbungId) => update({ farmId: nextFarmId, kumbungId, sensorId: null }),
      createFarm,
      refreshProfile: loadMe,
      refreshKumbungs: () => (farmId ? loadKumbungs(farmId) : Promise.resolve()),
      /** Rentang optimal parameter farm: { temperature: [min, max], humidity, co2 }. */
      ranges: farmSettings.ranges,
      /** Ambang alert farm: { temperature: { warning, critical }, ... }. */
      thresholds: farmSettings.thresholds,
      refreshFarmSettings: () => (farmId ? loadFarmSettings(farmId) : Promise.resolve()),
      /** Admin Tandurai (ADMIN_EMAILS / platformAdmin). */
      isAdmin: Boolean(profile?.deviceAdmin),
      /** Admin sedang di konsol admin (bukan melihat farm klien). */
      adminConsole: Boolean(profile?.deviceAdmin) && !adminFarmView,
      enterFarmAsAdmin,
      exitFarmView,
    };
  }, [farms, farmsLoading, error, profile, kumbungs, sensors, selection, catalogReady, update, createFarm, loadMe, loadKumbungs, farmId, farmSettings, loadFarmSettings, adminFarmView, enterFarmAsAdmin, exitFarmView]);

  return <FarmContext.Provider value={value}>{children}</FarmContext.Provider>;
}

export function useFarmContext() {
  const context = useContext(FarmContext);
  if (context === undefined) throw new Error('useFarmContext harus dipakai di dalam FarmProvider');
  return context;
}
