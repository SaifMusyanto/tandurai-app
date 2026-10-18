// Perencanaan migrasi Fase 4 (murni, tanpa Firebase): inventaris sensor dari telemetry, validasi
// relasi farm/kumbung/gateway/sensor, dan pembersihan data legacy. Menghasilkan multipath update
// yang idempoten; anomali yang butuh keputusan manusia hanya dilaporkan, tidak diperbaiki diam-diam.

const ALERT_TYPES = new Set(['temperature_high', 'humidity_low', 'co2_high', 'device_offline']);
const COOLDOWN_KEY = /_(critical|warning|normal)$/;

const entries = value => Object.entries(value && typeof value === 'object' ? value : {});
const isTelemetryRecord = value => value && typeof value === 'object' && Number.isFinite(Number(value.timestamp));

export function planMigration(data = {}, { now = Date.now() } = {}) {
  const t = data.tumbara || {};
  const users = data.users || {};
  const updates = {};
  const anomalies = [];
  const notes = [];
  const anomaly = (type, detail) => anomalies.push({ type, ...detail });

  // 1. Relasi farm ↔ kumbung (laporan saja).
  for (const [kumbungId, kumbung] of entries(t.kumbungs)) {
    if (!kumbung?.farmId) anomaly('kumbung_tanpa_farm', { kumbungId });
    else if (!t.farms?.[kumbung.farmId]) anomaly('kumbung_farm_tidak_ada', { kumbungId, farmId: kumbung.farmId });
    else if (t.farmKumbungs?.[kumbung.farmId]?.[kumbungId] !== true) anomaly('indeks_farmKumbungs_hilang', { kumbungId, farmId: kumbung.farmId });
  }
  for (const [farmId, map] of entries(t.farmKumbungs)) {
    for (const kumbungId of Object.keys(map || {})) {
      const kumbung = t.kumbungs?.[kumbungId];
      if (!kumbung) anomaly('indeks_kumbung_tidak_ada', { farmId, kumbungId });
      else if (kumbung.farmId !== farmId) anomaly('indeks_farm_tidak_cocok', { farmId, kumbungId, kumbungFarmId: kumbung.farmId });
    }
  }

  // 2. Inventaris sensor dari monitoring + history.
  const inventory = {};
  const seen = (sensorId, kumbungId, record, source) => {
    const item = inventory[sensorId] ||= { sensorId, kumbungs: {}, gateways: [], latest: 0, first: Infinity, historyRecords: 0, inMonitoring: false };
    item.kumbungs[kumbungId] = (item.kumbungs[kumbungId] || 0) + 1;
    const timestamp = Number(record.timestamp);
    item.latest = Math.max(item.latest, timestamp);
    item.first = Math.min(item.first, timestamp);
    if (record.gatewayId && !item.gateways.includes(record.gatewayId)) item.gateways.push(record.gatewayId);
    if (source === 'history') item.historyRecords += 1;
    else item.inMonitoring = true;
  };
  for (const [kumbungId, sensors] of entries(t.monitoring)) {
    if (isTelemetryRecord(sensors)) {
      notes.push(`Path legacy tumbara/monitoring/${kumbungId} berisi satu record langsung; tidak dimigrasikan.`);
      continue;
    }
    if (!t.kumbungs?.[kumbungId]) anomaly('telemetry_tanpa_kumbung', { kumbungId, source: 'monitoring' });
    for (const [sensorId, record] of entries(sensors)) if (isTelemetryRecord(record)) seen(sensorId, kumbungId, record, 'monitoring');
  }
  let legacyHistory = 0;
  for (const [kumbungId, days] of entries(t.history)) {
    // Cloud Functions lama menyimpan history dengan push key langsung di tumbara/history.
    if (isTelemetryRecord(days)) { legacyHistory += 1; continue; }
    const known = Boolean(t.kumbungs?.[kumbungId]);
    let reported = false;
    for (const [, records] of entries(days)) {
      for (const [, record] of entries(records)) {
        if (!isTelemetryRecord(record)) continue;
        if (!known && !reported) { anomaly('telemetry_tanpa_kumbung', { kumbungId, source: 'history' }); reported = true; }
        seen(record.sensorId || 'tanpa-sensorId', kumbungId, record, 'history');
      }
    }
  }
  if (legacyHistory) notes.push(`${legacyHistory} record history legacy (push key langsung di tumbara/history) dibiarkan tanpa perubahan.`);
  for (const item of Object.values(inventory)) {
    if (item.first === Infinity) item.first = null;
    const catalog = t.sensors?.[item.sensorId];
    item.inCatalog = Boolean(catalog);
    if (!catalog) {
      anomaly('sensor_tanpa_katalog', {
        sensorId: item.sensorId,
        kumbungIds: Object.keys(item.kumbungs),
        gatewayIds: item.gateways,
        action: 'Tugaskan lewat /devices (gateway tidak ditebak dari data lama).',
      });
    }
  }

  // 3. Indeks relasi yang terverifikasi dari katalog.
  for (const [gatewayId, gateway] of entries(t.gateways)) {
    if (!gateway?.farmId || !t.farms?.[gateway.farmId]) { anomaly('gateway_farm_tidak_valid', { gatewayId, farmId: gateway?.farmId || null }); continue; }
    if (t.farmGateways?.[gateway.farmId]?.[gatewayId] !== true) updates[`tumbara/farmGateways/${gateway.farmId}/${gatewayId}`] = true;
  }
  for (const [sensorId, sensor] of entries(t.sensors)) {
    const kumbung = t.kumbungs?.[sensor?.kumbungId];
    const gateway = t.gateways?.[sensor?.gatewayId];
    if (!kumbung || !gateway || kumbung.farmId !== sensor.farmId || gateway.farmId !== sensor.farmId) {
      anomaly('katalog_sensor_tidak_konsisten', { sensorId, farmId: sensor?.farmId, kumbungId: sensor?.kumbungId, gatewayId: sensor?.gatewayId });
      continue;
    }
    if (t.kumbungSensors?.[sensor.kumbungId]?.[sensorId] !== true) updates[`tumbara/kumbungSensors/${sensor.kumbungId}/${sensorId}`] = true;
    if (t.gatewaySensors?.[sensor.gatewayId]?.[sensorId] !== true) updates[`tumbara/gatewaySensors/${sensor.gatewayId}/${sensorId}`] = true;
  }

  // 4. Keanggotaan: farmMembers dari farmRoles yang sudah ditetapkan (bukan dari role lama).
  for (const [uid, user] of entries(users)) {
    const access = user?.access || {};
    for (const [farmId, role] of entries(access.farmRoles)) {
      if (access.farms?.[farmId] !== true || (role !== 'owner' && role !== 'operator')) {
        anomaly('farmRoles_tanpa_akses', { uid, farmId, role });
        continue;
      }
      if (!t.farms?.[farmId]) { anomaly('farmRoles_farm_tidak_ada', { uid, farmId }); continue; }
      if (t.farmMembers?.[farmId]?.[uid]) continue;
      updates[`tumbara/farmMembers/${farmId}/${uid}`] = {
        role,
        status: 'active',
        ...(user.profile?.email ? { email: String(user.profile.email).toLowerCase() } : {}),
        invitedBy: 'migration',
        createdAt: now,
        updatedAt: now,
      };
    }
    for (const farmId of Object.keys(access.farms || {})) {
      if (!access.farmRoles?.[farmId]) {
        anomaly('akses_farm_tanpa_role', { uid, farmId, legacyRole: access.role || null, action: 'Tetapkan farmRoles owner/operator di Console bila akun ini masih dipakai.' });
      }
    }
    // Role global lama tidak lagi dipakai Rules maupun web.
    if (access.role !== undefined) updates[`users/${uid}/access/role`] = null;
  }

  // 5. Struktur alert/cooldown datar lama (sebelum alert per farm).
  for (const [key, value] of entries(t.alerts)) {
    if (ALERT_TYPES.has(key) && value && typeof value === 'object' && 'severity' in value) updates[`tumbara/alerts/${key}`] = null;
  }
  for (const [key, value] of entries(t.notif_cooldown)) {
    if (COOLDOWN_KEY.test(key) && typeof value === 'number') updates[`tumbara/notif_cooldown/${key}`] = null;
  }

  return {
    generatedAt: now,
    updates,
    anomalies,
    notes,
    inventory: Object.values(inventory).sort((a, b) => a.sensorId.localeCompare(b.sensorId)),
  };
}

/** Terapkan multipath update ke salinan objek (untuk uji idempotensi dan pratinjau). */
export function applyUpdatesToObject(data, updates) {
  const copy = structuredClone(data);
  for (const [path, value] of Object.entries(updates)) {
    const parts = path.split('/');
    const last = parts.pop();
    let node = copy;
    for (const part of parts) {
      if (value === null && (node[part] === undefined || node[part] === null)) { node = null; break; }
      node[part] ??= {};
      node = node[part];
    }
    if (!node) continue;
    if (value === null) delete node[last];
    else node[last] = value;
  }
  return copy;
}
