// Uji end-to-end simulator gateway pada Firebase Emulator (Auth + RTDB) dengan Rules asli.
// Jalankan: npm run test:gateway-sim
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGatewaySimulator, createMockSensorAdapter, resolveEndpoints } from './gateway-simulator.mjs';
import {
  buildAssignSensorUpdates,
  buildCreateGatewayUpdates,
  buildDeactivateSensorUpdates,
  buildDisableGatewayUpdates,
  buildPairGatewayUpdates,
  buildReactivateGatewayUpdates,
} from '../apps/web/src/lib/deviceManagementPlan.js';

const endpoints = resolveEndpoints();
if (!endpoints.emulator) throw new Error('Skrip ini hanya untuk emulator (gunakan npm run test:gateway-sim).');

const FARM = 'FARM-SIM';
const K1 = 'FARM-SIM-K01';
const K2 = 'FARM-SIM-K02';
const GW = 'GW-SIM';

async function dbRequest(method, path, body, { token, admin = false } = {}) {
  const params = new URLSearchParams({ ...endpoints.dbParams, ...(token ? { auth: token } : {}) });
  const response = await fetch(`${endpoints.dbBase}/${path}.json?${params}`, {
    method,
    headers: {
      ...(admin ? { Authorization: 'Bearer owner' } : {}), // bypass Rules khusus emulator
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${JSON.stringify(json)}`);
  return json;
}
const adminGet = path => dbRequest('GET', path, undefined, { admin: true });
const ownerPatch = (token, updates) => dbRequest('PATCH', '', updates, { token });

async function signUpOwner() {
  const response = await fetch(`${endpoints.authBase}/accounts:signUp?key=${endpoints.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `owner-${Date.now()}@example.test`, password: 'emulator-only', returnSecureToken: true }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`Sign up owner gagal: ${JSON.stringify(json)}`);
  return { uid: json.localId, token: json.idToken };
}

const step = message => console.log(`✔ ${message}`);
const stateDir = mkdtempSync(join(tmpdir(), 'gateway-sim-'));
const quiet = () => {};

try {
  // 1. Owner & data farm (seed langsung; membuat farm/owner bukan bagian alur ini).
  const owner = await signUpOwner();
  await dbRequest('PATCH', '', {
    [`users/${owner.uid}/access`]: { farms: { [FARM]: true }, farmRoles: { [FARM]: 'owner' } },
    [`tumbara/farms/${FARM}`]: { name: 'Farm Simulasi', timezone: 'Asia/Jakarta', location: 'Lab', status: 'active', createdAt: 1, updatedAt: 1 },
    [`tumbara/farmMembers/${FARM}/${owner.uid}`]: { role: 'owner', status: 'active', createdAt: 1, updatedAt: 1 },
    [`tumbara/kumbungs/${K1}`]: { farmId: FARM, name: 'Kumbung 1', capacityBaglog: 500, status: 'active', createdBy: owner.uid, createdAt: 1, updatedAt: 1 },
    [`tumbara/kumbungs/${K2}`]: { farmId: FARM, name: 'Kumbung 2', capacityBaglog: 500, status: 'active', createdBy: owner.uid, createdAt: 1, updatedAt: 1 },
    [`tumbara/farmKumbungs/${FARM}`]: { [K1]: true, [K2]: true },
  }, { admin: true });

  // 2. Owner membuat gateway dan dua sensor di dua kumbung (melalui Rules).
  await ownerPatch(owner.token, buildCreateGatewayUpdates({ farmId: FARM, gatewayId: GW, name: 'Gateway Simulasi', ownerUid: owner.uid }));
  let version = 0;
  for (const [sensorId, kumbungId] of [['SNS-SIM-01', K1], ['SNS-SIM-02', K2]]) {
    const { updates, configVersion } = buildAssignSensorUpdates({
      farmId: FARM, kumbungId, sensorId, gatewayId: GW, name: sensorId, hardwareAddress: `mock:${sensorId}`,
      ownerUid: owner.uid, currentSensor: null, configVersions: { [GW]: version },
    });
    await ownerPatch(owner.token, updates);
    version = configVersion;
  }
  assert.equal(await adminGet(`tumbara/farmGateways/${FARM}/${GW}`), true);
  step(`owner membuat ${GW} (pending, terindeks di farmGateways) dan 2 sensor; configVersion=${version}`);

  // 3. Provision: Anonymous Auth langsung dari "ESP32".
  const simulator = createGatewaySimulator({ gatewayId: GW, endpoints, stateDir, log: quiet });
  const uid = await simulator.provision();
  assert.equal((await simulator.cycle()).state, 'unpaired');
  step('gateway login anonim; sebelum pairing tidak ada akses');

  // 4. Owner memasangkan UID.
  await ownerPatch(owner.token, buildPairGatewayUpdates({ gatewayId: GW, authUid: uid }));
  const first = await simulator.cycle();
  assert.equal(first.state, 'online');
  assert.equal(first.appliedConfigVersion, version);
  assert.deepEqual(first.uploaded.sort(), ['SNS-SIM-01', 'SNS-SIM-02']);
  const gateway = await adminGet(`tumbara/gateways/${GW}`);
  assert.equal(gateway.status, 'online');
  assert.equal(gateway.appliedConfigVersion, version);
  assert.equal((await adminGet('tumbara/sensors/SNS-SIM-02')).status, 'active');
  const latest2 = await adminGet(`tumbara/monitoring/${K2}/SNS-SIM-02`);
  assert.equal(latest2.gatewayId, GW);
  assert.equal(latest2.kumbungId, K2);
  step('setelah pairing: config diterapkan, sensor aktif, telemetry 2 kumbung terkirim, heartbeat online');

  // 5. Reboot: instance baru dari NVS yang sama → UID sama, history tidak dobel.
  const rebooted = createGatewaySimulator({ gatewayId: GW, endpoints, stateDir, log: quiet });
  assert.equal(rebooted.uid, uid);
  // History append-only: PUT ulang ke key bucket yang sama akan ditolak Rules (state 'denied'),
  // jadi siklus online membuktikan outbox mengecek record sebelum menulis.
  const again = await rebooted.cycle();
  assert.equal(again.state, 'online');
  assert.equal(again.outbox, 0);
  step('reboot memakai refresh token (UID tetap); retry history idempoten');

  // 6. Owner menonaktifkan satu sensor → config baru diterapkan.
  const sensor2 = { ...(await adminGet('tumbara/sensors/SNS-SIM-02')), id: 'SNS-SIM-02' };
  await ownerPatch(owner.token, buildDeactivateSensorUpdates({ currentSensor: sensor2, configVersion: version }));
  const fresh = createGatewaySimulator({ gatewayId: GW, endpoints, stateDir, log: quiet });
  const afterDeactivate = await fresh.cycle();
  assert.equal(afterDeactivate.appliedConfigVersion, version + 1);
  assert.deepEqual(afterDeactivate.uploaded, ['SNS-SIM-01']);
  step(`sensor dinonaktifkan; gateway menerapkan config v${version + 1} dan berhenti mengirim sensor tersebut`);

  // 7. Sensor tidak menjawab → versi config tidak diakui penuh.
  const flaky = createGatewaySimulator({ gatewayId: GW, endpoints, stateDir, log: quiet, adapter: createMockSensorAdapter({ failing: ['SNS-SIM-01'] }) });
  const flakyResult = await flaky.cycle();
  assert.equal(flakyResult.appliedConfigVersion, version + 1); // tetap versi yang sudah diakui sebelumnya (dari registry)
  assert.deepEqual(flakyResult.uploaded, []);
  step('sensor tidak terbaca: latest tidak diperbarui');

  // 8. Revoke: gateway tidak dapat mengakses lagi dan tidak dapat menghidupkan dirinya.
  await ownerPatch(owner.token, buildDisableGatewayUpdates({ gatewayId: GW, authUid: uid, ownerUid: owner.uid }));
  const before = (await adminGet(`tumbara/monitoring/${K1}/SNS-SIM-01`)).timestamp;
  const revoked = await fresh.cycle();
  assert.equal(revoked.state, 'unpaired');
  assert.equal((await adminGet(`tumbara/gateways/${GW}`)).status, 'inactive');
  assert.equal((await adminGet(`tumbara/monitoring/${K1}/SNS-SIM-01`)).timestamp, before);
  step('gateway dicabut: status inactive, mapping UID dihapus, tidak ada write baru');

  // 9. Pemulihan: owner mengaktifkan ulang, ESP32 reset NVS + provision UID baru, owner memasangkan.
  await ownerPatch(owner.token, buildReactivateGatewayUpdates({ gatewayId: GW }));
  fresh.reset();
  const replacement = createGatewaySimulator({ gatewayId: GW, endpoints, stateDir, log: quiet });
  const newUid = await replacement.provision();
  assert.notEqual(newUid, uid);
  await ownerPatch(owner.token, buildPairGatewayUpdates({ gatewayId: GW, authUid: newUid }));
  const recovered = await replacement.cycle();
  assert.equal(recovered.state, 'online');
  assert.deepEqual(recovered.uploaded, ['SNS-SIM-01']);
  assert.equal((await adminGet(`tumbara/gateways/${GW}`)).authUid, newUid);
  assert.equal(await adminGet(`tumbara/gatewayAuthUids/${uid}`), null);
  step('pemulihan: aktifkan ulang → provision UID baru → pairing → online kembali; UID lama tetap tanpa akses');

  console.log('\nSemua skenario simulator gateway lulus.');
} finally {
  rmSync(stateDir, { recursive: true, force: true });
}
