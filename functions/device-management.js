
const SAFE_ID = /^[A-Za-z0-9_-]{1,96}$/;

function requiredId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`${label} tidak valid.`);
  }
  return value;
}

function requiredText(value, label, maxLength = 100) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${label} wajib diisi (maksimal ${maxLength} karakter).`);
  }
  return value.trim();
}

function createDeviceManagement(functions, admin) {
  const database = () => admin.database();

  async function requireFarmOwner(context, farmId) {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login diperlukan.");
    const uid = context.auth.uid;
    const [membership, role] = await Promise.all([
      database().ref(`users/${uid}/access/farms/${farmId}`).once("value"),
      database().ref(`users/${uid}/access/farmRoles/${farmId}`).once("value"),
    ]);
    if (membership.val() !== true || role.val() !== "owner") {
      throw new functions.https.HttpsError("permission-denied", "Hanya owner farm yang dapat melakukan tindakan ini.");
    }
    return uid;
  }

  const addFarmOperator = functions.https.onCall(async (data, context) => {
    let farmId;
    let email;
    try {
      farmId = requiredId(data?.farmId, "farmId");
      email = requiredText(data?.email, "Email", 254).toLowerCase();
    } catch (error) {
      throw new functions.https.HttpsError("invalid-argument", error.message);
    }
    const ownerUid = await requireFarmOwner(context, farmId);

    let employee;
    try {
      employee = await admin.auth().getUserByEmail(email);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        throw new functions.https.HttpsError("not-found", "Akun karyawan belum terdaftar. Minta karyawan membuat akun terlebih dahulu.");
      }
      throw error;
    }
    if (!employee.emailVerified) {
      throw new functions.https.HttpsError("failed-precondition", "Email akun karyawan harus diverifikasi terlebih dahulu.");
    }
    if (employee.uid === ownerUid) {
      throw new functions.https.HttpsError("already-exists", "Owner sudah memiliki akses ke farm ini.");
    }

    const memberRef = database().ref(`tumbara/farmMembers/${farmId}/${employee.uid}`);
    const existing = await memberRef.once("value");
    if (existing.child("role").val() === "owner") {
      throw new functions.https.HttpsError("failed-precondition", "Keanggotaan owner tidak dapat diubah menjadi operator.");
    }

    const now = Date.now();
    const updates = {
      [`tumbara/farmMembers/${farmId}/${employee.uid}`]: {
        role: "operator",
        status: "active",
        email,
        invitedBy: ownerUid,
        createdAt: existing.child("createdAt").val() || now,
        updatedAt: now,
      },
      [`users/${employee.uid}/access/farms/${farmId}`]: true,
      [`users/${employee.uid}/access/farmRoles/${farmId}`]: "operator",
    };
    await database().ref().update(updates);
    return { uid: employee.uid, email, role: "operator", status: "active" };
  });

  const removeFarmOperator = functions.https.onCall(async (data, context) => {
    let farmId;
    let employeeUid;
    try {
      farmId = requiredId(data?.farmId, "farmId");
      employeeUid = requiredId(data?.uid, "uid");
    } catch (error) {
      throw new functions.https.HttpsError("invalid-argument", error.message);
    }
    await requireFarmOwner(context, farmId);
    const memberRef = database().ref(`tumbara/farmMembers/${farmId}/${employeeUid}`);
    const member = await memberRef.once("value");
    if (!member.exists()) return { uid: employeeUid, removed: false };
    if (member.child("role").val() === "owner") {
      throw new functions.https.HttpsError("failed-precondition", "Owner tidak dapat dicabut melalui pengelolaan karyawan.");
    }
    await database().ref().update({
      [`tumbara/farmMembers/${farmId}/${employeeUid}`]: null,
      [`users/${employeeUid}/access/farms/${farmId}`]: null,
      [`users/${employeeUid}/access/farmRoles/${farmId}`]: null,
    });
    return { uid: employeeUid, removed: true };
  });

  const createGateway = functions.https.onCall(async (data, context) => {
    let farmId;
    let gatewayId;
    let name;
    try {
      farmId = requiredId(data?.farmId, "farmId");
      gatewayId = requiredId(data?.gatewayId, "gatewayId");
      name = requiredText(data?.name, "Nama gateway");
    } catch (error) {
      throw new functions.https.HttpsError("invalid-argument", error.message);
    }
    const ownerUid = await requireFarmOwner(context, farmId);
    const [farm, gateway] = await Promise.all([
      database().ref(`tumbara/farms/${farmId}`).once("value"),
      database().ref(`tumbara/gateways/${gatewayId}`).once("value"),
    ]);
    if (!farm.exists()) throw new functions.https.HttpsError("not-found", "Farm tidak ditemukan.");
    if (gateway.exists()) throw new functions.https.HttpsError("already-exists", "ID gateway sudah digunakan.");

    const deviceUid = `gateway_${gatewayId}`;
    try {
      await admin.auth().getUser(deviceUid);
      throw new functions.https.HttpsError("already-exists", "UID gateway sudah digunakan akun lain.");
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;
      if (error.code !== "auth/user-not-found") throw error;
    }

    const now = Date.now();
    const initialConfig = { farmId, configVersion: 0, updatedAt: now, sensors: {} };
    try {
      await database().ref().update({
        [`tumbara/gateways/${gatewayId}`]: {
          id: gatewayId,
          farmId,
          name,
          authUid: deviceUid,
          status: "pending",
          configVersion: 0,
          appliedConfigVersion: 0,
          createdBy: ownerUid,
          createdAt: now,
          updatedAt: now,
        },
        [`tumbara/gatewayConfigs/${gatewayId}`]: initialConfig,
      });
      const customToken = await admin.auth().createCustomToken(deviceUid, {
        identity: "gateway",
        gatewayId,
        farmId,
      });
      return { gatewayId, authUid: deviceUid, customToken, expiresInSeconds: 3600 };
    } catch (error) {
      await database().ref().update({
        [`tumbara/gateways/${gatewayId}`]: null,
        [`tumbara/gatewayConfigs/${gatewayId}`]: null,
      });
      throw error;
    }
  });

  const disableGateway = functions.https.onCall(async (data, context) => {
    let farmId;
    let gatewayId;
    try {
      farmId = requiredId(data?.farmId, "farmId");
      gatewayId = requiredId(data?.gatewayId, "gatewayId");
    } catch (error) {
      throw new functions.https.HttpsError("invalid-argument", error.message);
    }
    const ownerUid = await requireFarmOwner(context, farmId);
    const gatewayRef = database().ref(`tumbara/gateways/${gatewayId}`);
    const gateway = await gatewayRef.once("value");
    if (!gateway.exists() || gateway.child("farmId").val() !== farmId) {
      throw new functions.https.HttpsError("not-found", "Gateway tidak ditemukan pada farm ini.");
    }
    await gatewayRef.update({ status: "inactive", disabledBy: ownerUid, disabledAt: Date.now(), updatedAt: Date.now() });
    return { gatewayId, status: "inactive" };
  });
  const assignSensor = functions.https.onCall(async (data, context) => {
    let farmId;
    let kumbungId;
    let sensorId;
    let gatewayId;
    let name;
    try {
      farmId = requiredId(data?.farmId, "farmId");
      kumbungId = requiredId(data?.kumbungId, "kumbungId");
      sensorId = requiredId(data?.sensorId, "sensorId");
      gatewayId = requiredId(data?.gatewayId, "gatewayId");
      name = requiredText(data?.name, "Nama sensor");
    } catch (error) {
      throw new functions.https.HttpsError("invalid-argument", error.message);
    }
    const ownerUid = await requireFarmOwner(context, farmId);
    const [kumbungSnapshot, gatewaySnapshot, sensorSnapshot, configSnapshot] = await Promise.all([
      database().ref(`tumbara/kumbungs/${kumbungId}`).once("value"),
      database().ref(`tumbara/gateways/${gatewayId}`).once("value"),
      database().ref(`tumbara/sensors/${sensorId}`).once("value"),
      database().ref(`tumbara/gatewayConfigs/${gatewayId}`).once("value"),
    ]);
    if (kumbungSnapshot.child("farmId").val() !== farmId) {
      throw new functions.https.HttpsError("failed-precondition", "Kumbung tidak berada di farm terpilih.");
    }
    if (gatewaySnapshot.child("farmId").val() !== farmId || gatewaySnapshot.child("status").val() === "inactive") {
      throw new functions.https.HttpsError("failed-precondition", "Gateway tidak aktif atau bukan milik farm ini.");
    }
    const currentSensor = sensorSnapshot.val();
    if (currentSensor && currentSensor.farmId !== farmId) {
      throw new functions.https.HttpsError("failed-precondition", "Sensor tidak dapat dipindahkan lintas farm.");
    }
    if (!configSnapshot.exists()) throw new functions.https.HttpsError("failed-precondition", "Konfigurasi gateway belum tersedia.");

    const now = Date.now();
    const oldGatewayId = currentSensor?.gatewayId;
    const oldKumbungId = currentSensor?.kumbungId;
    const updates = {};
    if (oldGatewayId && oldGatewayId !== gatewayId) {
      const oldConfigSnapshot = await database().ref(`tumbara/gatewayConfigs/${oldGatewayId}`).once("value");
      const oldVersion = Number(oldConfigSnapshot.child("configVersion").val()) || 0;
      updates[`tumbara/gatewaySensors/${oldGatewayId}/${sensorId}`] = null;
      updates[`tumbara/gatewayConfigs/${oldGatewayId}/sensors/${sensorId}`] = null;
      updates[`tumbara/gatewayConfigs/${oldGatewayId}/configVersion`] = oldVersion + 1;
      updates[`tumbara/gatewayConfigs/${oldGatewayId}/updatedAt`] = now;
      updates[`tumbara/gateways/${oldGatewayId}/configVersion`] = oldVersion + 1;
      updates[`tumbara/gateways/${oldGatewayId}/updatedAt`] = now;
    }
    if (oldKumbungId && oldKumbungId !== kumbungId) {
      updates[`tumbara/kumbungSensors/${oldKumbungId}/${sensorId}`] = null;
    }
    const configVersion = (Number(configSnapshot.child("configVersion").val()) || 0) + 1;
    const hardwareAddress = typeof data.hardwareAddress === "string" ? data.hardwareAddress.trim() : "";
    updates[`tumbara/sensors/${sensorId}`] = {
      ...(currentSensor || {}),
      id: sensorId,
      farmId,
      kumbungId,
      gatewayId,
      name,
      ...(hardwareAddress ? { hardwareAddress } : {}),
      status: "pending",
      createdBy: currentSensor?.createdBy || ownerUid,
      createdAt: currentSensor?.createdAt || now,
      updatedAt: now,
    };
    updates[`tumbara/kumbungSensors/${kumbungId}/${sensorId}`] = true;
    updates[`tumbara/gatewaySensors/${gatewayId}/${sensorId}`] = true;
    updates[`tumbara/gatewayConfigs/${gatewayId}/farmId`] = farmId;
    updates[`tumbara/gatewayConfigs/${gatewayId}/sensors/${sensorId}`] = {
      kumbungId,
      ...(hardwareAddress ? { hardwareAddress } : {}),
      enabled: true,
    };
    updates[`tumbara/gatewayConfigs/${gatewayId}/configVersion`] = configVersion;
    updates[`tumbara/gatewayConfigs/${gatewayId}/updatedAt`] = now;
    updates[`tumbara/gateways/${gatewayId}/configVersion`] = configVersion;
    updates[`tumbara/gateways/${gatewayId}/updatedAt`] = now;
    await database().ref().update(updates);
    return { farmId, kumbungId, sensorId, gatewayId, configVersion, status: "pending" };
  });

  return { addFarmOperator, removeFarmOperator, createGateway, disableGateway, assignSensor };
}

module.exports = { createDeviceManagement };
