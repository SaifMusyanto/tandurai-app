# Rencana Integrasi IoT Gateway (Hardware ↔ Firebase RTDB ↔ Dashboard)

**Status:** Analisis + rancangan + rencana implementasi. Belum ada perubahan kode/Rules untuk bagian baru.  
**Tanggal:** 2026-10-15  
**Menggantikan sebagian:** [`konsep-integrasi-hardware-aktuator.md`](./konsep-integrasi-hardware-aktuator.md) (alur pairing dan model perintah di sini lebih lengkap dan menjadi acuan).  
**Kontrak firmware & panduan instalasi:** [`../PANDUAN_INTEGRASI_HARDWARE.md`](../PANDUAN_INTEGRASI_HARDWARE.md)

## 1. Goal (ringkas)

Dashboard ↔ Firebase RTDB ↔ Gateway ESP32 ↔ Sensor & Aktuator, dengan:

1. **Registrasi & pairing:** gateway punya UID hardware unik, mendaftarkan diri beserta daftar sensor/aktuator memakai **autentikasi perangkat**; user menambah gateway dengan UID + **verifikasi pairing**; setelah itu semua sensor/aktuator muncul otomatis. Mengetahui UID saja **tidak cukup** untuk mengambil alih.
2. **Monitoring sensor** realtime, termasuk status offline/bermasalah per sensor.
3. **Kontrol aktuator** ON/OFF lewat Firebase; gateway menerima via **SSE**, mengeksekusi, mengirim **ack + status aktual**; dashboard menampilkan Pending/Success/Failed/Offline; command ber-ID unik dan kedaluwarsa.
4. **Hybrid timer & automation:** konfigurasi di Firebase, gateway menerima via SSE, simpan di **NVS**, **logika berjalan di gateway** (tetap jalan saat offline), dashboard membedakan **Pending Sync** vs diterapkan.
5. **Mode operasi** per aktuator: Manual / Timer / Auto Threshold; hanya mode aktif yang berkuasa; **proteksi hardware prioritas tertinggi**.
6. **Offline & keamanan:** heartbeat, perintah kedaluwarsa tidak dijalankan setelah reconnect, Rules membatasi akses per pemilik, gateway melaporkan versi config yang diterapkan dan status aktuator.
7. **Komunikasi:** Gateway→Firebase HTTP (REST); Firebase→Gateway SSE; Dashboard↔Firebase Web SDK.

## 2. Analisis: sejauh mana sekarang

Legenda: ✅ ada dan teruji · 🟡 sebagian/berbeda dari goal · ❌ belum ada

| # | Kebutuhan goal | Status | Kondisi sekarang | Yang harus dilakukan |
|---|---|---|---|---|
| 1a | UID hardware unik per gateway | 🟡 | ID gateway dibuat owner di web (`GW-01`); identitas perangkat = UID Firebase Anonymous Auth (acak). | ID gateway = **UID hardware** (dari MAC/eFuse, mis. `TDR-A1B2C3D4E5F6`) yang dicatat di registry pabrik. |
| 1b | Gateway registrasi sendiri + daftar sensor/aktuator | ❌ | Owner membuat gateway lalu menugaskan sensor satu per satu. | Node `deviceRegistrations/{hwUid}` berisi **capabilities** (sensor & aktuator lokal) yang ditulis perangkat. |
| 1c | Autentikasi perangkat, bukan UID saja | 🟡 | Anonymous Auth + mapping UID; siapa pun bisa membuat akun anonim, tetapi tidak bisa memakai gateway tanpa pairing owner. Belum ada bukti bahwa perangkat itu asli. | **Device secret** per unit (diisi pabrik, disimpan di NVS); Rules mencocokkan dengan registry pabrik yang tidak bisa dibaca klien. |
| 1d | User tambah gateway dengan UID + verifikasi pairing | 🟡 | Owner mengetik UID Firebase 28 karakter. | Owner memasukkan **UID hardware + kode klaim** (label/QR/layar perangkat). Rules memverifikasi kode terhadap registry pabrik. |
| 1e | Sensor & aktuator otomatis muncul setelah pairing | ❌ | Ditambahkan manual. | Klaim membuat katalog sensor & aktuator dari capabilities dalam satu multipath (kumbung default dipilih saat klaim, bisa dipindah). |
| 1f | Tidak bisa diambil alih hanya dengan UID | 🟡 | Pairing hanya oleh owner untuk gateway `pending`; UID perangkat bukan rahasia. | Klaim wajib kode klaim; perangkat yang sudah diklaim tidak bisa diklaim ulang sebelum dilepas pemiliknya. |
| 2a | Telemetry berkala ke RTDB | ✅ | `telemetry-v1` latest + history, Rules gateway-only, outbox idempoten. | Tetap. Sensor ID menjadi `{hwUid}-{lokal}`. |
| 2b | Dashboard realtime listener | ✅ | Monitoring/Home/Historical memakai `onValue` per konteks. | Tetap. |
| 2c | Status sensor offline/bermasalah | ✅ | Ack per sensor (`ok/not_found/read_error`), stale, kolom Pembacaan, alert offline per sensor (worker). | Tetap; tambah status sensor di kartu gateway baru. |
| 3a | Command ON/OFF lewat Firebase | ❌ | Tombol Automation hanya state lokal browser. | `gatewayCommands/{gw}/{cmdId}` ditulis dashboard dengan Rules ketat. |
| 3b | Gateway terima via SSE | ❌ | Simulator **polling** config tiap 30 dtk; belum ada SSE. | Klien SSE di simulator & firmware untuk command dan config. |
| 3c | Ack + status aktual | ❌ | Ada pola ack untuk config/sensor saja. | `commandResults/{gw}/{cmdId}` + `actuatorStates/{gw}/{aid}`. |
| 3d | Status Pending/Success/Failed/Offline | ❌ | — | Diturunkan di dashboard dari command + result + heartbeat (bukan dari klik). |
| 3e | ID unik + kedaluwarsa | ❌ | — | `cmdId` + `expiresAt` (≤ 60 dtk), gateway menolak/mencatat `expired`. |
| 4a | Konfigurasi timer/threshold di Firebase | 🟡 | `gatewayConfigs` bervesi ada (sensor saja). | Tambah `actuators/{aid}` dengan `mode`, `timer`, `auto`, batas proteksi. |
| 4b | Dashboard atur interval/durasi/threshold | ❌ | Halaman Automation statis. | Editor per aktuator. |
| 4c | Gateway terima config via SSE + NVS | 🟡 | Polling 30 dtk; tanpa NVS (simulator RAM). | SSE + simpan config terakhir yang valid (simulator: file; firmware: NVS). |
| 4d | Logika timer/threshold di gateway | ❌ | — | Engine mode di simulator lalu firmware. **Tidak** ada scheduler di dashboard/Firebase. |
| 4e | Tetap jalan saat offline | 🟡 | Sensor tetap dibaca + antre saat offline. | Engine aktuator memakai config dari NVS saat offline. |
| 4f | Sinkron setelah reconnect | 🟡 | Outbox history + reload config. | Ditambah sinkron `actuatorStates`, hasil command, ack config. |
| 4g | Pending Sync vs diterapkan | 🟡 | `configVersion` vs `appliedConfigVersion` per gateway sudah tampil. | Ditampilkan per aktuator (ack menyebut `configVersion` per aktuator). |
| 5 | Mode Manual/Timer/Auto + proteksi hardware | ❌ | — | Field `mode` per aktuator; command manual ditolak bila mode bukan manual; proteksi di firmware. |
| 6a | Heartbeat online/offline | ✅ | `lastSeenAt` 60 dtk, offline > 3 mnt. | Tetap. |
| 6b | Jalankan config terakhir saat offline | 🟡 | Sensor ya; aktuator belum ada. | Bagian engine aktuator. |
| 6c | Command kedaluwarsa tidak dijalankan setelah reconnect | ❌ | — | Cek `expiresAt` dengan jam SNTP; tanpa jam valid → tolak. |
| 6d | Rules: user hanya akses gateway miliknya | ✅ | Rules per farm (owner/operator) + 41 uji emulator. | Perluas ke node baru. |
| 6e | Lapor versi config + status aktuator | 🟡 | `appliedConfigVersion` + ack sensor. | Tambah ack aktuator + `actuatorStates`. |
| 7 | HTTP / SSE / Web SDK | 🟡 | HTTP REST ✅, Web SDK ✅, SSE ❌. | SSE untuk command & config. |
| — | Mock gateway untuk pengujian | ✅ | `tools/gateway-simulator.mjs` + e2e emulator. | Perluas: capabilities, registrasi, SSE, aktuator tiruan, mode engine. |

**Kesimpulan:** fondasi (auth perangkat tanpa server, Rules per farm, telemetry, config bervesi, ack, simulator, UI perangkat) sudah ada sekitar **45–50%** dari goal. Yang belum: registrasi berbasis UID hardware + capabilities + klaim terverifikasi, seluruh jalur aktuator (command, SSE, ack, status), engine mode/timer/threshold di gateway, dan firmware nyata.

## 3. Rancangan

### 3.1 Identitas dan kepercayaan

| Identitas | Asal | Rahasia? | Fungsi |
|---|---|---|---|
| `hwUid` | MAC/eFuse ESP32, mis. `TDR-A1B2C3D4E5F6`; dicetak di label | Tidak | ID gateway di seluruh sistem. |
| `deviceSecret` | Acak 32 byte, dibuat tool pabrik, disimpan di NVS (terenkripsi bila Flash Encryption aktif) | **Ya** (tidak pernah dicetak) | Membuktikan perangkat asli saat registrasi. |
| `claimCode` | Acak 8 karakter (Crockford base32), dicetak di label/QR | **Ya** (bukti fisik) | Membuktikan user memegang perangkat saat klaim. |
| Firebase UID | Anonymous Auth saat boot pertama | Tidak | Identitas sesi RTDB; dipetakan ke `hwUid` setelah klaim. |

Rules tidak dapat menghitung hash, sehingga `deviceSecret` dan `claimCode` disimpan di `tumbara/factoryDevices/{hwUid}` dengan `.read: false` dan `.write: false` (hanya tool pabrik dengan service account). Rules **hanya membandingkan kesamaan** nilai yang dikirim dengan nilai registry tanpa pernah mengembalikannya ke klien. Risiko: bila service account bocor, rahasia terbaca; mitigasinya rotasi service account dan registry hanya diisi lewat tool pabrik.

### 3.2 Node RTDB baru

```text
tumbara/factoryDevices/{hwUid}            # admin saja; tidak dapat dibaca/ditulis klien
  deviceSecret, claimCode, model, hwRevision, manufacturedAt

tumbara/deviceProofs/{hwUid}/{authUid}     # tidak dapat dibaca siapa pun
  = deviceSecret                           # ditulis perangkat; Rules: === factoryDevices/{hwUid}/deviceSecret

tumbara/deviceRegistrations/{hwUid}        # ditulis perangkat, dibaca user login per key
  authUid, model, firmwareVersion, registeredAt, status: "unclaimed" | "claimed"
  capabilities/
    sensors/{localId}:   { type, metrics: [...], channel }
    actuators/{localId}: { type, channel, maxRunSec, minIntervalSec }

tumbara/deviceClaims/{hwUid}               # bukti klaim, tidak dapat dibaca klien
  claimCode, farmId, claimedBy, claimedAt

tumbara/actuators/{actuatorId}             # katalog, seperti sensors
  farmId, kumbungId, gatewayId, name, type, localId, status
tumbara/kumbungActuators/{kumbungId}/{actuatorId}: true
tumbara/gatewayActuators/{gatewayId}/{actuatorId}: true

tumbara/gatewayConfigs/{gw}/actuators/{actuatorId}   # bagian config bervesi
  localId, kumbungId, enabled,
  protection: { maxRunSec, minIntervalSec }
  mode: "manual" | "timer" | "auto"
  timer: { intervalSec, onSec, window: "06:00-18:00" }
  auto:  { sensorId, metric, operator: "below" | "above", threshold, hysteresis, onSec, cooldownSec }

tumbara/gatewayCommands/{gw}/{cmdId}       # ditulis dashboard, tidak dapat diubah
  actuatorId, action: "on" | "off" | "estop", durationSec,
  requestedBy, createdAt, expiresAt

tumbara/commandResults/{gw}/{cmdId}        # ditulis gateway
  status: "success" | "failed" | "rejected" | "expired", reason, executedAt, stateAfter

tumbara/actuatorStates/{gw}/{actuatorId}   # ditulis gateway
  state: "on" | "off" | "fault", mode, source: "manual" | "timer" | "auto" | "button" | "protection",
  since, offAt, commandId, configVersion

tumbara/gatewayAcks/{gw}                   # diperluas: actuators/{actuatorId}: { state: ok|not_found|fault, configVersion }
```

Konvensi ID: `sensorId = {hwUid}-{localSensorId}` (mis. `TDR-A1B2C3D4E5F6-S1`), `actuatorId = {hwUid}-{localActuatorId}`. Unik global tanpa koordinasi.

### 3.3 Registrasi → klaim → otomatis muncul

```mermaid
sequenceDiagram
    participant F as Tool pabrik (admin)
    participant G as Gateway ESP32
    participant DB as RTDB + Rules
    participant W as Dashboard (owner)
    F->>DB: tulis factoryDevices/{hwUid} {deviceSecret, claimCode}
    F->>G: flash firmware + NVS {hwUid, deviceSecret}; cetak label {hwUid, claimCode}
    G->>DB: Auth signUp (anonim) → authUid
    G->>DB: PATCH multipath: deviceProofs/{hwUid}/{authUid}=deviceSecret + deviceRegistrations/{hwUid}={authUid, capabilities, status:unclaimed}
    Note over DB: Rules: secret == registry, authUid == auth.uid,<br/>belum diklaim (atau diklaim oleh authUid yang sama)
    W->>DB: GET deviceRegistrations/{hwUid} (pratinjau model & capabilities)
    W->>DB: PATCH multipath klaim: deviceClaims, gateways/{hwUid}, gatewayAuthUids/{authUid}, farmGateways, gatewayConfigs v1 (sensor+aktuator), sensors/*, actuators/*, indeks, registration.status=claimed, assignmentLog
    Note over DB: Rules: claimCode == registry, owner farm,<br/>registration unclaimed, authUid sesuai registration
    G->>DB: SSE gatewayAuthUids/{authUid} → hwUid (diklaim)
    G->>DB: SSE gatewayConfigs/{hwUid} → terapkan, simpan NVS, ack
    DB-->>W: sensor & aktuator muncul; status pending → active setelah ack
```

Perlindungan pengambilalihan:

- Registrasi palsu untuk `hwUid` orang lain gagal tanpa `deviceSecret`.
- Klaim tanpa `claimCode` gagal; perangkat `claimed` tidak bisa diklaim ulang sampai owner melepasnya (registration kembali `unclaimed`).
- Perangkat yang di-reset pabrik mendapat Firebase UID baru; registrasi ulang diterima hanya bila registrasi `unclaimed` (atau authUid sama).

### 3.4 Command aktuator dan status di dashboard

1. Dashboard menulis `gatewayCommands/{gw}/{cmdId}` (ID = waktu + acak) + `assignmentLog`. Rules: anggota farm (owner/operator), aktuator `active` milik gateway, `durationSec` ≤ `protection.maxRunSec`, `expiresAt` ≤ `createdAt` + 60 dtk, `createdAt` ±60 dtk dari server, tidak bisa diubah/hapus oleh dashboard.
2. Gateway menerima lewat SSE, memeriksa (kedaluwarsa, ID sudah diproses, mode = manual, proteksi), mengeksekusi, lalu menulis `commandResults` dan `actuatorStates`.
3. Dashboard menurunkan status:

| Status UI | Kondisi |
|---|---|
| **Pending** | Belum ada result, belum kedaluwarsa, gateway online. |
| **Success** | Result `success` (dan `actuatorStates` sesuai). |
| **Failed** | Result `failed`/`rejected`/`expired` (alasan ditampilkan), atau kedaluwarsa tanpa result saat gateway online. |
| **Offline** | Belum ada result dan gateway offline (heartbeat > 3 mnt). Setelah reconnect, perintah yang sudah kedaluwarsa dilaporkan `expired`, tidak dijalankan. |

Tombol tidak pernah menampilkan "menyala" berdasarkan klik; tampilan aktual dari `actuatorStates`.

### 3.5 Mode operasi dan prioritas kendali (di gateway)

Urutan prioritas (tinggi → rendah):

1. **Proteksi hardware:** default OFF saat boot, `maxRunSec`, `minIntervalSec`, watchdog, interlock (mis. sensor acuan tidak terbaca), `estop`.
2. **Mode aktif** per aktuator:
   - **Manual:** perintah dashboard + tombol fisik. Perintah `on` wajib punya durasi (mati otomatis).
   - **Timer:** siklus `onSec` setiap `intervalSec` dalam `window`. Perintah manual ditolak (`rejected: mode`).
   - **Auto Threshold:** nyala `onSec` bila `metric` melewati `threshold` (dengan `hysteresis`, `cooldownSec`). Perintah manual ditolak.
3. `estop` diterima di semua mode: mematikan aktuator dan menahannya OFF sampai mode diubah (config baru) atau perintah manual `on` di mode Manual.

Ganti mode = ubah config (`configVersion` +1). Dashboard menampilkan **Pending Sync** sampai ack aktuator memuat `configVersion` tersebut.

### 3.6 Hybrid timer

- Firebase = sumber kebenaran konfigurasi; **tidak ada scheduler di dashboard/Firebase**.
- Gateway: SSE `gatewayConfigs/{gw}` → validasi → simpan ke NVS → engine memakai salinan NVS → ack. Saat boot tanpa internet, engine langsung memakai config NVS terakhir yang valid.
- Setelah reconnect: stream SSE mengirim snapshot terbaru (event `put`), gateway membandingkan `configVersion`, menerapkan bila lebih baru, lalu mengirim ack, `actuatorStates`, result yang tertunda, dan outbox history.

## 4. Rencana implementasi

Pola untuk setiap tahap (sama seperti Fase 1–3): pembangun update murni → Rules + uji allow/deny emulator → mock gateway + e2e emulator → UI → dokumentasi kontrak. Tidak ada deploy Rules sebelum uji lulus.

| Tahap | Isi | File utama | Uji / selesai bila | Butuh hardware |
|---|---|---|---|---|
| **I1. Registry pabrik & registrasi perangkat** | `factoryDevices` (tool `tools/factory-provision.mjs`, admin), `deviceProofs`, `deviceRegistrations` + capabilities; Rules | `database.rules.json`, `tools/factory-provision.mjs`, simulator (`register`) | Perangkat dengan secret benar terdaftar; secret salah/UID lain/registrasi ulang saat claimed ditolak; registry & proof tidak terbaca klien | Tidak |
| **I2. Klaim dengan UID + kode** | Builder klaim (gateway, mapping UID, config v1, sensor & aktuator dari capabilities, indeks, audit); UI "Tambah gateway" baru (UID + kode → pratinjau → pilih kumbung default → klaim); lepas klaim | `deviceManagementPlan.js`, `deviceManagementService.js`, `DevicesPage.jsx` | Klaim tanpa/ salah kode ditolak; perangkat claimed tidak bisa diklaim akun lain; sensor & aktuator muncul otomatis; alur lama (GW-01/02) tetap jalan | Tidak |
| **I3. Katalog & config aktuator** | `actuators`, indeks, `gatewayConfigs/actuators` (mode, timer, auto, proteksi), ack aktuator, Rules | builder, Rules, `FarmSensorsPanel` → panel perangkat | Konsistensi katalog–config–indeks seperti sensor; Pending Sync per aktuator | Tidak |
| **I4. SSE di mock gateway** | Klien SSE (put/patch/keep-alive/cancel/auth_revoked, reconnect + backoff, refresh token per jam) untuk `gatewayConfigs` dan `gatewayCommands`; config disimpan ke file (pengganti NVS) | `tools/gateway-simulator.mjs` | Perubahan config diterapkan < 2 dtk; reconnect setelah stream putus; boot offline memakai config tersimpan | Tidak |
| **I5. Command + result + status** | `gatewayCommands`, `commandResults`, `actuatorStates`, Rules (dashboard tulis-sekali; gateway hanya result/state miliknya; cleanup command lama); UI tombol ON/OFF/estop dengan status Pending/Success/Failed/Offline | Rules, builder, `AutomationPage.jsx` (ganti state lokal), simulator (relay tiruan) | Pending → Success < 2 dtk; perintah kedaluwarsa/duplikat/melebihi batas/mode salah ditolak; offline → Offline lalu `expired` setelah reconnect | Tidak |
| **I6. Engine mode di gateway** | Manual/Timer/Auto + proteksi + estop di simulator; editor config per aktuator di Automation | simulator, `AutomationPage.jsx` | Timer & threshold berjalan saat simulator "offline"; hanya mode aktif berkuasa; proteksi menang atas semua mode | Tidak |
| **I7. Firmware ESP32** | Wi-Fi provisioning, Auth REST, RTDB REST + SSE (TLS), NVS, outbox, relay + timer + watchdog, adapter sensor, mode engine (port dari simulator) | repo firmware baru | Semua skenario I1–I6 lulus di bench (1 ESP32, ≥2 sensor, ≥1 relay) | **Ya** |
| **I8. Pilot & cutover** | Satu kumbung nyata, migrasi GW-01/02 ke alur baru, pemantauan 1–2 minggu | — | Tidak ada nyala tak terduga; semua command ter-ack; telemetry stabil | **Ya** |

Urutan disarankan: I1 → I2 → I3 → I4 → I5 → I6 (semua dengan mock gateway), paralel dengan pemilihan hardware; I7 setelah hardware tersedia.

### 4.1 Kompatibilitas

- Gateway lama (`GW-01`, `GW-02`) dan alur pairing UID Firebase tetap berfungsi sampai dipindah ke alur klaim (I8).
- Data telemetry/history lama tidak dipindah; sensor baru memakai ID `{hwUid}-{lokal}`.
- `deviceManagementPlan`/service yang ada diperluas, bukan diganti.

## 5. Keputusan yang dibutuhkan

1. **Hardware:** varian ESP32, sensor (I2C/RS-485), relay & beban (sprayer pompa/solenoid, tegangan). Menentukan adapter dan `channel`.
2. **Media kode klaim:** label/QR saja (paling murah) atau juga layar OLED.
3. **Pengirim command:** usulan owner + operator; `estop` untuk semua anggota.
4. **Batas proteksi default:** usulan sprayer `maxRunSec` 120, `minIntervalSec` 300; fan `maxRunSec` 3600.
5. **Perilaku `estop`:** usulan menahan OFF sampai mode diubah atau perintah manual baru.
6. **Siapa menjalankan tool pabrik** (butuh service account): tim internal di mesin terpisah, bukan di aplikasi.
