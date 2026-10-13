import { get, limitToLast, onValue, orderByChild, query, ref, update } from 'firebase/database';
import { auth, db } from '../firebase';
import { FIREBASE_PATHS } from './firebasePaths';
import {
  buildAddOperatorUpdates,
  buildAuditEntry,
  buildAssignSensorUpdates,
  buildCreateGatewayUpdates,
  buildDeactivateSensorUpdates,
  buildDirectoryEntryUpdates,
  buildDisableGatewayUpdates,
  buildPairGatewayUpdates,
  buildReactivateGatewayUpdates,
  buildRemoveOperatorUpdates,
  buildUnpairGatewayUpdates,
  emailDirectoryKey,
  sensorAssignmentAction,
} from './deviceManagementPlan';

// Semua operasi berjalan langsung dari aplikasi owner ke RTDB (tanpa server).
// database.rules.json memvalidasi role owner dan konsistensi seluruh path.

function currentUid() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Login diperlukan.');
  return uid;
}

async function readValue(path) {
  const snapshot = await get(ref(db, path));
  return snapshot.val();
}

function explainDenied(error, message) {
  if (error?.code === 'PERMISSION_DENIED' || /permission/i.test(error?.message || '')) {
    throw new Error(message);
  }
  throw error;
}

/** Farm yang dapat diakses user beserta role (`owner`/`operator`), terurut nama. */
export async function loadDeviceFarms(uid) {
  const access = await readValue(`users/${uid}/access`) || {};
  const farmIds = Object.keys(access.farms || {});
  const farms = await Promise.all(farmIds.map(async farmId => {
    const farm = await readValue(FIREBASE_PATHS.farm(farmId)).catch(() => null);
    return { id: farmId, name: farm?.name || farmId, role: access.farmRoles?.[farmId] || 'operator' };
  }));
  return farms.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Subscribe gateway milik farm melalui indeks `farmGateways`. `onChange` menerima daftar
 * gateway (dengan `sensorCount` dan laporan `ack` per sensor) setiap kali registry, assignment,
 * atau laporan gateway berubah.
 */
export function subscribeFarmGateways(farmId, onChange, onError = () => {}) {
  const listeners = new Map();
  const gateways = new Map();
  const sensorCounts = new Map();
  const acks = new Map();
  let indexLoaded = false;
  const emit = () => {
    if (!indexLoaded) return;
    onChange([...gateways.entries()]
      .filter(([, gateway]) => gateway)
      .map(([id, gateway]) => ({ ...gateway, id, sensorCount: sensorCounts.get(id) || 0, ack: acks.get(id) || null }))
      .sort((a, b) => a.id.localeCompare(b.id)));
  };

  const stopIndex = onValue(ref(db, FIREBASE_PATHS.farmGateways(farmId)), snapshot => {
    const ids = new Set(Object.keys(snapshot.val() || {}));
    for (const [id, stop] of listeners) {
      if (ids.has(id)) continue;
      stop();
      listeners.delete(id);
      gateways.delete(id);
      sensorCounts.delete(id);
      acks.delete(id);
    }
    for (const id of ids) {
      if (listeners.has(id)) continue;
      gateways.set(id, null);
      const stopGateway = onValue(ref(db, FIREBASE_PATHS.gateway(id)), gatewaySnapshot => {
        gateways.set(id, gatewaySnapshot.val());
        emit();
      }, onError);
      const stopSensors = onValue(ref(db, FIREBASE_PATHS.gatewaySensors(id)), sensorSnapshot => {
        sensorCounts.set(id, Object.keys(sensorSnapshot.val() || {}).length);
        emit();
      }, onError);
      const stopAck = onValue(ref(db, FIREBASE_PATHS.gatewayAck(id)), ackSnapshot => {
        acks.set(id, ackSnapshot.val());
        emit();
      }, error => {
        // Laporan ack hanya informasi tambahan; gagal baca (mis. Rules lama) tidak boleh
        // menggagalkan daftar gateway.
        console.warn(`Laporan ack ${id} tidak dapat dibaca:`, error.message);
        acks.set(id, null);
        emit();
      });
      listeners.set(id, () => { stopGateway(); stopSensors(); stopAck(); });
    }
    indexLoaded = true;
    emit();
  }, onError);

  return () => {
    stopIndex();
    for (const stop of listeners.values()) stop();
    listeners.clear();
  };
}

/**
 * Subscribe kumbung farm beserta sensor terdaftar di tiap kumbung (via `farmKumbungs` →
 * `kumbungSensors` → `sensors`). `onChange` menerima `{ kumbungs, sensors }`, keduanya terurut ID.
 */
export function subscribeFarmSensors(farmId, onChange, onError = () => {}) {
  const kumbungs = new Map();
  const kumbungListeners = new Map();
  const sensorIdsByKumbung = new Map();
  const sensors = new Map();
  const sensorListeners = new Map();
  let indexLoaded = false;

  const emit = () => {
    if (!indexLoaded) return;
    onChange({
      kumbungs: [...kumbungs.entries()]
        .filter(([, kumbung]) => kumbung)
        .map(([id, kumbung]) => ({ ...kumbung, id }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      sensors: [...sensors.entries()]
        .filter(([, sensor]) => sensor)
        .map(([id, sensor]) => ({ ...sensor, id }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  };

  const syncSensorListeners = () => {
    const wanted = new Set([...sensorIdsByKumbung.values()].flatMap(ids => [...ids]));
    for (const [id, stop] of sensorListeners) {
      if (wanted.has(id)) continue;
      stop();
      sensorListeners.delete(id);
      sensors.delete(id);
    }
    for (const id of wanted) {
      if (sensorListeners.has(id)) continue;
      sensors.set(id, null);
      sensorListeners.set(id, onValue(ref(db, FIREBASE_PATHS.sensorRecord(id)), snapshot => {
        sensors.set(id, snapshot.val());
        emit();
      }, onError));
    }
    emit();
  };

  const stopIndex = onValue(ref(db, FIREBASE_PATHS.farmKumbungs(farmId)), snapshot => {
    const ids = new Set(Object.keys(snapshot.val() || {}));
    for (const [id, stop] of kumbungListeners) {
      if (ids.has(id)) continue;
      stop();
      kumbungListeners.delete(id);
      kumbungs.delete(id);
      sensorIdsByKumbung.delete(id);
    }
    for (const id of ids) {
      if (kumbungListeners.has(id)) continue;
      kumbungs.set(id, null);
      const stopKumbung = onValue(ref(db, FIREBASE_PATHS.kumbung(id)), kumbungSnapshot => {
        kumbungs.set(id, kumbungSnapshot.val());
        emit();
      }, onError);
      const stopIndexSensors = onValue(ref(db, FIREBASE_PATHS.kumbungSensors(id)), sensorSnapshot => {
        sensorIdsByKumbung.set(id, new Set(Object.keys(sensorSnapshot.val() || {})));
        syncSensorListeners();
      }, onError);
      kumbungListeners.set(id, () => { stopKumbung(); stopIndexSensors(); });
    }
    indexLoaded = true;
    syncSensorListeners();
  }, onError);

  return () => {
    stopIndex();
    for (const stop of kumbungListeners.values()) stop();
    for (const stop of sensorListeners.values()) stop();
    kumbungListeners.clear();
    sensorListeners.clear();
  };
}

/** Daftarkan email terverifikasi user agar owner dapat menambahkannya sebagai operator. */
export async function publishUserDirectoryEntry(user) {
  if (!user?.emailVerified || !user.email) return false;
  await update(ref(db), buildDirectoryEntryUpdates({ uid: user.uid, email: user.email }));
  return true;
}

export async function addFarmOperator({ farmId, email }) {
  const ownerUid = currentUid();
  const directory = await readValue(FIREBASE_PATHS.userDirectoryEntry(emailDirectoryKey(email)));
  const operatorUid = directory?.uid;
  const existingMember = operatorUid ? await readValue(FIREBASE_PATHS.farmMember(farmId, operatorUid)) : null;
  const updates = {
    ...buildAddOperatorUpdates({ farmId, ownerUid, operatorUid, email, existingMember }),
    ...buildAuditEntry({ farmId, actorUid: ownerUid, action: 'operator_add', details: { targetUid: operatorUid } }),
  };
  await update(ref(db), updates).catch(error => explainDenied(error, 'Hanya owner farm yang dapat menambahkan operator.'));
  return { uid: operatorUid, role: 'operator', status: 'active' };
}

export async function removeFarmOperator({ farmId, uid }) {
  const ownerUid = currentUid();
  const existingMember = await readValue(FIREBASE_PATHS.farmMember(farmId, uid));
  if (!existingMember) return { uid, removed: false };
  await update(ref(db), {
    ...buildRemoveOperatorUpdates({ farmId, uid, existingMember }),
    ...buildAuditEntry({ farmId, actorUid: ownerUid, action: 'operator_remove', details: { targetUid: uid } }),
  }).catch(error => explainDenied(error, 'Hanya owner farm yang dapat mencabut operator.'));
  return { uid, removed: true };
}

export async function createGateway({ farmId, gatewayId, name }) {
  const ownerUid = currentUid();
  const existing = await readValue(FIREBASE_PATHS.gateway(gatewayId))
    .catch(error => explainDenied(error, 'ID gateway sudah digunakan.'));
  if (existing) throw new Error('ID gateway sudah digunakan.');
  await update(ref(db), {
    ...buildCreateGatewayUpdates({ farmId, gatewayId, name, ownerUid }),
    ...buildAuditEntry({ farmId, actorUid: ownerUid, action: 'gateway_create', details: { gatewayId } }),
  }).catch(error => explainDenied(error, 'Gateway tidak dapat dibuat. Pastikan Anda owner farm dan ID belum dipakai.'));
  return { gatewayId, status: 'pending' };
}

async function readGateway(gatewayId) {
  const gateway = await readValue(FIREBASE_PATHS.gateway(gatewayId));
  if (!gateway) throw new Error('Gateway tidak ditemukan.');
  return gateway;
}

export async function pairGateway({ gatewayId, authUid }) {
  const ownerUid = currentUid();
  const gateway = await readGateway(gatewayId);
  await update(ref(db), {
    ...buildPairGatewayUpdates({ gatewayId, authUid }),
    ...buildAuditEntry({ farmId: gateway.farmId, actorUid: ownerUid, action: 'gateway_pair', details: { gatewayId, targetUid: authUid } }),
  }).catch(error => explainDenied(error, 'Pairing ditolak. Gateway harus berstatus pending, belum terpasang, dan UID belum dipakai.'));
  return { gatewayId, authUid };
}

export async function unpairGateway({ gatewayId }) {
  const ownerUid = currentUid();
  const gateway = await readGateway(gatewayId);
  await update(ref(db), {
    ...buildUnpairGatewayUpdates({ gatewayId, authUid: gateway.authUid }),
    ...buildAuditEntry({ farmId: gateway.farmId, actorUid: ownerUid, action: 'gateway_unpair', details: { gatewayId, targetUid: gateway.authUid } }),
  });
  return { gatewayId, status: 'pending' };
}

export async function disableGateway({ gatewayId }) {
  const ownerUid = currentUid();
  const gateway = await readGateway(gatewayId);
  await update(ref(db), {
    ...buildDisableGatewayUpdates({ gatewayId, authUid: gateway.authUid, ownerUid }),
    ...buildAuditEntry({ farmId: gateway.farmId, actorUid: ownerUid, action: 'gateway_disable', details: { gatewayId, targetUid: gateway.authUid } }),
  });
  return { gatewayId, status: 'inactive' };
}

export async function reactivateGateway({ gatewayId }) {
  const ownerUid = currentUid();
  const gateway = await readGateway(gatewayId);
  await update(ref(db), {
    ...buildReactivateGatewayUpdates({ gatewayId }),
    ...buildAuditEntry({ farmId: gateway.farmId, actorUid: ownerUid, action: 'gateway_reactivate', details: { gatewayId } }),
  });
  return { gatewayId, status: 'pending' };
}

export async function assignSensor({ farmId, kumbungId, sensorId, gatewayId, name, hardwareAddress, type }) {
  const ownerUid = currentUid();
  const currentSensor = await readValue(FIREBASE_PATHS.sensorRecord(sensorId))
    .catch(error => explainDenied(error, 'ID sensor sudah digunakan farm lain.'));
  const gatewayIds = [...new Set([gatewayId, currentSensor?.gatewayId].filter(Boolean))];
  const versions = await Promise.all(
    gatewayIds.map(id => readValue(`${FIREBASE_PATHS.gatewayConfig(id)}/configVersion`)),
  );
  const configVersions = Object.fromEntries(gatewayIds.map((id, index) => [id, versions[index]]));
  const { updates, configVersion } = buildAssignSensorUpdates({
    farmId, kumbungId, sensorId, gatewayId, name, hardwareAddress, type,
    ownerUid, currentSensor, configVersions,
  });
  const audit = buildAuditEntry({
    farmId,
    actorUid: ownerUid,
    action: sensorAssignmentAction(currentSensor, { kumbungId, gatewayId }),
    details: {
      sensorId,
      gatewayId,
      fromKumbungId: currentSensor?.kumbungId,
      toKumbungId: kumbungId,
      fromGatewayId: currentSensor?.gatewayId,
      toGatewayId: gatewayId,
      configVersion,
    },
  });
  await update(ref(db), { ...updates, ...audit })
    .catch(error => explainDenied(error, 'Penugasan sensor ditolak. Periksa kumbung/gateway pada farm yang sama, lalu coba lagi.'));
  return { farmId, kumbungId, sensorId, gatewayId, configVersion, status: 'pending' };
}

export async function deactivateSensor({ sensorId }) {
  const ownerUid = currentUid();
  const currentSensor = await readValue(FIREBASE_PATHS.sensorRecord(sensorId));
  const configVersion = currentSensor?.gatewayId
    ? await readValue(`${FIREBASE_PATHS.gatewayConfig(currentSensor.gatewayId)}/configVersion`)
    : null;
  await update(ref(db), {
    ...buildDeactivateSensorUpdates({ currentSensor: { ...currentSensor, id: sensorId }, configVersion }),
    ...buildAuditEntry({
      farmId: currentSensor.farmId,
      actorUid: ownerUid,
      action: 'sensor_deactivate',
      details: { sensorId, gatewayId: currentSensor.gatewayId, fromKumbungId: currentSensor.kumbungId, configVersion: (Number(configVersion) || 0) + 1 },
    }),
  });
  return { sensorId, status: 'inactive' };
}

/** Riwayat perubahan terbaru farm (append-only), terbaru di depan. */
export function subscribeAssignmentLog(farmId, onChange, onError = () => {}, limit = 30) {
  return onValue(
    query(ref(db, FIREBASE_PATHS.assignmentLog(farmId)), orderByChild('createdAt'), limitToLast(limit)),
    snapshot => onChange(Object.entries(snapshot.val() || {})
      .map(([id, entry]) => ({ ...entry, id }))
      .sort((a, b) => b.createdAt - a.createdAt)),
    onError,
  );
}

/** Anggota farm (`tumbara/farmMembers/{farmId}`), owner dulu lalu email. */
export function subscribeFarmMembers(farmId, onChange, onError = () => {}) {
  return onValue(ref(db, FIREBASE_PATHS.farmMembers(farmId)), snapshot => {
    onChange(Object.entries(snapshot.val() || {})
      .map(([uid, member]) => ({ ...member, uid }))
      .sort((a, b) => (a.role === b.role ? String(a.email || a.uid).localeCompare(String(b.email || b.uid)) : a.role === 'owner' ? -1 : 1)));
  }, onError);
}
