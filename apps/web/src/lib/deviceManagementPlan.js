import { FIREBASE_PATHS as P } from './firebasePaths.js';

/**
 * Pembangun multipath update untuk manajemen anggota farm, gateway, dan sensor.
 * Murni (tanpa Firebase SDK) agar dipakai bersama oleh service web dan test Rules.
 * Integritas lintas path dijamin oleh database.rules.json, bukan oleh modul ini.
 */

const SAFE_ID = /^[A-Za-z0-9_-]{1,96}$/;

export function requireId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`${label} tidak valid.`);
  }
  return value;
}

export function requireText(value, label, maxLength = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${label} wajib diisi (maksimal ${maxLength} karakter).`);
  }
  return value.trim();
}

export function normalizeEmail(email) {
  return requireText(email, 'Email', 254).toLowerCase();
}

/** Key RTDB untuk email; harus identik dengan `email.toLowerCase().replace('.', ',')` di Rules. */
export function emailDirectoryKey(email) {
  return normalizeEmail(email).replaceAll('.', ',');
}

export function buildDirectoryEntryUpdates({ uid, email, now = Date.now() }) {
  return { [P.userDirectoryEntry(emailDirectoryKey(email))]: { uid, updatedAt: now } };
}

export function buildAddOperatorUpdates({ farmId, ownerUid, operatorUid, email, existingMember, now = Date.now() }) {
  requireId(farmId, 'farmId');
  if (!operatorUid) throw new Error('Akun karyawan belum terdaftar atau emailnya belum diverifikasi.');
  if (operatorUid === ownerUid) throw new Error('Owner sudah memiliki akses ke farm ini.');
  if (existingMember?.role === 'owner') throw new Error('Keanggotaan owner tidak dapat diubah menjadi operator.');
  return {
    [P.farmMember(farmId, operatorUid)]: {
      role: 'operator',
      status: 'active',
      email: normalizeEmail(email),
      invitedBy: ownerUid,
      createdAt: existingMember?.createdAt || now,
      updatedAt: now,
    },
    [P.farmAccess(operatorUid, farmId)]: true,
    [P.farmRole(operatorUid, farmId)]: 'operator',
  };
}

export function buildRemoveOperatorUpdates({ farmId, uid, existingMember }) {
  if (existingMember?.role === 'owner') throw new Error('Owner tidak dapat dicabut melalui pengelolaan karyawan.');
  return {
    [P.farmMember(farmId, uid)]: null,
    [P.farmAccess(uid, farmId)]: null,
    [P.farmRole(uid, farmId)]: null,
  };
}

export function buildCreateGatewayUpdates({ farmId, gatewayId, name, ownerUid, now = Date.now() }) {
  requireId(farmId, 'farmId');
  requireId(gatewayId, 'ID gateway');
  const config = P.gatewayConfig(gatewayId);
  return {
    [P.gateway(gatewayId)]: {
      id: gatewayId,
      farmId,
      name: requireText(name, 'Nama gateway'),
      status: 'pending',
      configVersion: 0,
      appliedConfigVersion: 0,
      createdBy: ownerUid,
      createdAt: now,
      updatedAt: now,
    },
    // Ditulis per field: Rules menolak farmId bila config (gateway) sudah ada → ID duplikat gagal.
    [`${config}/farmId`]: farmId,
    [`${config}/configVersion`]: 0,
    [`${config}/updatedAt`]: now,
  };
}

/** UID berasal dari Anonymous Auth ESP32 dan ditampilkan lewat kanal commissioning lokal. */
export function buildPairGatewayUpdates({ gatewayId, authUid, now = Date.now() }) {
  requireId(gatewayId, 'ID gateway');
  requireId(authUid, 'UID perangkat');
  return {
    [`${P.gateway(gatewayId)}/authUid`]: authUid,
    [`${P.gateway(gatewayId)}/updatedAt`]: now,
    [P.gatewayAuthUid(authUid)]: gatewayId,
  };
}

/** Lepas UID lama (mis. NVS ESP32 terhapus); gateway kembali `pending` untuk dipasangkan ulang. */
export function buildUnpairGatewayUpdates({ gatewayId, authUid, now = Date.now() }) {
  const updates = {
    [`${P.gateway(gatewayId)}/authUid`]: null,
    [`${P.gateway(gatewayId)}/status`]: 'pending',
    [`${P.gateway(gatewayId)}/updatedAt`]: now,
  };
  if (authUid) updates[P.gatewayAuthUid(authUid)] = null;
  return updates;
}

export function buildDisableGatewayUpdates({ gatewayId, authUid, ownerUid, now = Date.now() }) {
  const updates = {
    [`${P.gateway(gatewayId)}/authUid`]: null,
    [`${P.gateway(gatewayId)}/status`]: 'inactive',
    [`${P.gateway(gatewayId)}/disabledBy`]: ownerUid,
    [`${P.gateway(gatewayId)}/disabledAt`]: now,
    [`${P.gateway(gatewayId)}/updatedAt`]: now,
  };
  if (authUid) updates[P.gatewayAuthUid(authUid)] = null;
  return updates;
}

function bumpConfig(updates, gatewayId, currentVersion, now) {
  const version = (Number(currentVersion) || 0) + 1;
  updates[`${P.gatewayConfig(gatewayId)}/configVersion`] = version;
  updates[`${P.gatewayConfig(gatewayId)}/updatedAt`] = now;
  updates[`${P.gateway(gatewayId)}/configVersion`] = version;
  updates[`${P.gateway(gatewayId)}/updatedAt`] = now;
  return version;
}

/**
 * Tambah, ubah, atau pindahkan sensor. `configVersions` berisi versi config terkini
 * dari gateway tujuan dan gateway lama (bila berpindah). Rules menolak bila versi
 * berubah sejak dibaca (concurrency optimistik).
 */
export function buildAssignSensorUpdates({
  farmId, kumbungId, sensorId, gatewayId, name, hardwareAddress, type,
  ownerUid, currentSensor, configVersions, now = Date.now(),
}) {
  requireId(farmId, 'farmId');
  requireId(kumbungId, 'kumbungId');
  requireId(sensorId, 'ID sensor');
  requireId(gatewayId, 'ID gateway');
  const sensorName = requireText(name, 'Nama sensor');
  if (currentSensor && currentSensor.farmId !== farmId) {
    throw new Error('Sensor tidak dapat dipindahkan lintas farm.');
  }
  const address = typeof hardwareAddress === 'string' ? hardwareAddress.trim() : '';
  const sensorType = typeof type === 'string' ? type.trim() : '';
  const updates = {};

  const oldGatewayId = currentSensor?.gatewayId;
  const oldKumbungId = currentSensor?.kumbungId;
  if (oldGatewayId && oldGatewayId !== gatewayId) {
    updates[`${P.gatewaySensors(oldGatewayId)}/${sensorId}`] = null;
    updates[`${P.gatewayConfig(oldGatewayId)}/sensors/${sensorId}`] = null;
    bumpConfig(updates, oldGatewayId, configVersions?.[oldGatewayId], now);
  }
  if (oldKumbungId && oldKumbungId !== kumbungId) {
    updates[`${P.kumbungSensors(oldKumbungId)}/${sensorId}`] = null;
  }

  updates[P.sensorRecord(sensorId)] = {
    id: sensorId,
    farmId,
    kumbungId,
    gatewayId,
    name: sensorName,
    ...(address ? { hardwareAddress: address } : {}),
    ...(sensorType ? { type: sensorType } : {}),
    // Status `active` hanya diberikan oleh gateway setelah sensor dikenali.
    status: 'pending',
    createdBy: currentSensor?.createdBy || ownerUid,
    createdAt: currentSensor?.createdAt || now,
    updatedAt: now,
  };
  updates[`${P.kumbungSensors(kumbungId)}/${sensorId}`] = true;
  updates[`${P.gatewaySensors(gatewayId)}/${sensorId}`] = true;
  updates[`${P.gatewayConfig(gatewayId)}/sensors/${sensorId}`] = {
    kumbungId,
    ...(address ? { hardwareAddress: address } : {}),
    enabled: true,
  };
  const configVersion = bumpConfig(updates, gatewayId, configVersions?.[gatewayId], now);
  return { updates, configVersion };
}

/** Nonaktifkan sensor (soft delete): katalog/riwayat tetap, gateway berhenti membaca. */
export function buildDeactivateSensorUpdates({ currentSensor, configVersion, now = Date.now() }) {
  if (!currentSensor?.gatewayId) throw new Error('Sensor tidak ditemukan.');
  const { id, gatewayId, kumbungId, hardwareAddress } = currentSensor;
  const updates = {
    [`${P.sensorRecord(id)}/status`]: 'inactive',
    [`${P.sensorRecord(id)}/updatedAt`]: now,
    [`${P.gatewayConfig(gatewayId)}/sensors/${id}`]: {
      kumbungId,
      ...(hardwareAddress ? { hardwareAddress } : {}),
      enabled: false,
    },
  };
  bumpConfig(updates, gatewayId, configVersion, now);
  return updates;
}
