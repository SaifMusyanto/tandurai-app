import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../firebase';
import { IOT_EVENTS, applyGatewayEvent, mergeCommand } from '@/lib/iot';
import { streamUrl } from '@/lib/api';
import { iotApi } from '@/lib/iotApi';

const IotContext = createContext(undefined);

// Event SSE domain (bukan state gateway) yang diteruskan ke pelanggan lewat `subscribe`.
const BUS_EVENTS = ['alert', 'forecast', 'changed', 'actuator_event'];

/**
 * Data IoT dari backend: gateway farm user + sensor + aktuator, diperbarui realtime lewat SSE.
 * Satu koneksi SSE untuk seluruh dashboard; reconnect memakai token Firebase terbaru dan memuat ulang data.
 * Event domain (`alert`, `forecast`, `changed`, dan `ready` saat tersambung ulang) dibagikan lewat
 * `subscribe(event, handler)` agar halaman lain tidak membuka koneksi SSE sendiri.
 */
export function IotProvider({ children }) {
  const uid = auth.currentUser?.uid;
  const [gateways, setGateways] = useState([]);
  const [commands, setCommands] = useState({}); // actuatorId → command terakhir
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [streamConnected, setStreamConnected] = useState(false);
  const sourceRef = useRef(null);
  const listenersRef = useRef(new Map()); // event → Set<handler>

  const publish = useCallback((event, data) => {
    for (const handler of listenersRef.current.get(event) || []) handler(data);
  }, []);

  const subscribe = useCallback((event, handler) => {
    if (!listenersRef.current.has(event)) listenersRef.current.set(event, new Set());
    listenersRef.current.get(event).add(handler);
    return () => listenersRef.current.get(event)?.delete(handler);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setGateways(await iotApi.listGateways());
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;
    let retryTimer = null;

    const connect = async () => {
      if (cancelled) return;
      let url;
      try {
        url = await streamUrl();
      } catch {
        retryTimer = setTimeout(connect, 5000);
        return;
      }
      const source = new EventSource(url);
      sourceRef.current = source;
      source.addEventListener('ready', () => {
        setStreamConnected(true);
        refresh(); // sinkron ulang setelah (re)connect agar event yang terlewat tidak hilang
        publish('ready', null);
      });
      for (const name of BUS_EVENTS) {
        source.addEventListener(name, message => {
          const data = JSON.parse(message.data);
          // Gateway diklaim/dilepas/dipindah atau akses farm berubah: muat ulang daftar gateway.
          if (name === 'changed' && ['gateway', 'member', 'farm'].includes(data.entity)) refresh();
          publish(name, data);
        });
      }
      for (const name of IOT_EVENTS) {
        source.addEventListener(name, message => {
          const data = JSON.parse(message.data);
          if (name === 'command') setCommands(current => mergeCommand(current, data));
          else setGateways(current => applyGatewayEvent(current, name, data));
        });
      }
      source.onerror = () => {
        // Token bisa kedaluwarsa (1 jam): tutup lalu buka ulang dengan token baru.
        setStreamConnected(false);
        source.close();
        if (!cancelled) retryTimer = setTimeout(connect, 3000);
      };
    };

    setLoading(true);
    refresh();
    connect();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      sourceRef.current?.close();
      setStreamConnected(false);
    };
  }, [uid, refresh, publish]);

  const sendCommand = useCallback(async (actuatorId, action, durationSec) => {
    const command = await iotApi.sendCommand(actuatorId, action === 'on' ? { action, durationSec } : { action });
    setCommands(current => mergeCommand(current, command));
    return command;
  }, []);

  const saveConfig = useCallback(async (actuatorId, input) => {
    const actuator = await iotApi.saveConfig(actuatorId, input);
    setGateways(current => applyGatewayEvent(current, 'actuator', actuator));
    return actuator;
  }, []);

  const claim = useCallback(async input => {
    const gateway = await iotApi.claim(input);
    setGateways(current => [...current.filter(item => item.id !== gateway.id), gateway]);
    return gateway;
  }, []);

  const unclaim = useCallback(async gatewayId => {
    await iotApi.unclaim(gatewayId);
    setGateways(current => current.filter(item => item.id !== gatewayId));
  }, []);

  const renameGateway = useCallback(async (gatewayId, name) => {
    const gateway = await iotApi.renameGateway(gatewayId, name);
    setGateways(current => current.map(item => (item.id === gateway.id ? gateway : item)));
    return gateway;
  }, []);

  const updateSensor = useCallback(async (sensorId, input) => {
    const sensor = await iotApi.updateSensor(sensorId, input);
    setGateways(current => current.map(gateway => (gateway.id === sensor.gatewayId
      ? { ...gateway, sensors: gateway.sensors.map(item => (item.id === sensor.id ? sensor : item)) }
      : gateway)));
    return sensor;
  }, []);

  const updateActuator = useCallback(async (actuatorId, input) => {
    const actuator = await iotApi.updateActuator(actuatorId, input);
    setGateways(current => applyGatewayEvent(current, 'actuator', actuator));
    return actuator;
  }, []);

  const value = useMemo(() => ({
    gateways,
    commands,
    loading,
    error,
    streamConnected,
    refresh,
    preview: iotApi.preview,
    claim,
    unclaim,
    sendCommand,
    saveConfig,
    updateSensor,
    updateActuator,
    renameGateway,
    history: iotApi.history,
    subscribe,
  }), [gateways, commands, loading, error, streamConnected, refresh, claim, unclaim, sendCommand, saveConfig, updateSensor, updateActuator, renameGateway, subscribe]);

  return <IotContext.Provider value={value}>{children}</IotContext.Provider>;
}

export function useIot() {
  const context = useContext(IotContext);
  if (context === undefined) throw new Error('useIot harus dipakai di dalam IotProvider');
  return context;
}
