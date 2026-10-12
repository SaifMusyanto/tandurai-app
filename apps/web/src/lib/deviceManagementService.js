import { get, ref, update } from 'firebase/database';
import { auth, db } from '../firebase';
import { FIREBASE_PATHS } from './firebasePaths';
import {
  buildAddOperatorUpdates,
  buildAssignSensorUpdates,
  buildCreateGatewayUpdates,
  buildDeactivateSensorUpdates,
  buildDirectoryEntryUpdates,
  buildDisableGatewayUpdates,
  buildPairGatewayUpdates,
  buildRemoveOperatorUpdates,
  buildUnpairGatewayUpdates,
  emailDirectoryKey,
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
  const updates = buildAddOperatorUpdates({ farmId, ownerUid, operatorUid, email, existingMember });
  await update(ref(db), updates).catch(error => explainDenied(error, 'Hanya owner farm yang dapat menambahkan operator.'));
  return { uid: operatorUid, role: 'operator', status: 'active' };
}

export async function removeFarmOperator({ farmId, uid }) {
  const existingMember = await readValue(FIREBASE_PATHS.farmMember(farmId, uid));
  if (!existingMember) return { uid, removed: false };
  await update(ref(db), buildRemoveOperatorUpdates({ farmId, uid, existingMember }))
    .catch(error => explainDenied(error, 'Hanya owner farm yang dapat mencabut operator.'));
  return { uid, removed: true };
}

export async function createGateway({ farmId, gatewayId, name }) {
  const ownerUid = currentUid();
  const existing = await readValue(FIREBASE_PATHS.gateway(gatewayId))
    .catch(error => explainDenied(error, 'ID gateway sudah digunakan.'));
  if (existing) throw new Error('ID gateway sudah digunakan.');
  await update(ref(db), buildCreateGatewayUpdates({ farmId, gatewayId, name, ownerUid }))
    .catch(error => explainDenied(error, 'Gateway tidak dapat dibuat. Pastikan Anda owner farm dan ID belum dipakai.'));
  return { gatewayId, status: 'pending' };
}

export async function pairGateway({ gatewayId, authUid }) {
  await update(ref(db), buildPairGatewayUpdates({ gatewayId, authUid }))
    .catch(error => explainDenied(error, 'Pairing ditolak. Gateway harus berstatus pending, belum terpasang, dan UID belum dipakai.'));
  return { gatewayId, authUid };
}

export async function unpairGateway({ gatewayId }) {
  const authUid = await readValue(`${FIREBASE_PATHS.gateway(gatewayId)}/authUid`);
  await update(ref(db), buildUnpairGatewayUpdates({ gatewayId, authUid }));
  return { gatewayId, status: 'pending' };
}

export async function disableGateway({ gatewayId }) {
  const ownerUid = currentUid();
  const authUid = await readValue(`${FIREBASE_PATHS.gateway(gatewayId)}/authUid`);
  await update(ref(db), buildDisableGatewayUpdates({ gatewayId, authUid, ownerUid }));
  return { gatewayId, status: 'inactive' };
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
  await update(ref(db), updates)
    .catch(error => explainDenied(error, 'Penugasan sensor ditolak. Periksa kumbung/gateway pada farm yang sama, lalu coba lagi.'));
  return { farmId, kumbungId, sensorId, gatewayId, configVersion, status: 'pending' };
}

export async function deactivateSensor({ sensorId }) {
  const currentSensor = await readValue(FIREBASE_PATHS.sensorRecord(sensorId));
  const configVersion = currentSensor?.gatewayId
    ? await readValue(`${FIREBASE_PATHS.gatewayConfig(currentSensor.gatewayId)}/configVersion`)
    : null;
  await update(ref(db), buildDeactivateSensorUpdates({ currentSensor: { ...currentSensor, id: sensorId }, configVersion }));
  return { sensorId, status: 'inactive' };
}
