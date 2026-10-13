# Progres Fase 1 — Fondasi Hirarki Sensor

**Status:** **Selesai (lokal/emulator).** Rules, domain service, dan test sudah dimigrasikan ke rancangan tanpa server: ESP32 memakai Firebase Anonymous Auth, owner memasangkan UID ke gateway, dan seluruh operasi owner berjalan sebagai multipath update yang divalidasi RTDB Rules. Belum ada deploy atau write ke Firebase live.

**Tanggal pembaruan:** 2026-10-12  
**Rencana utama:** [`implementasi-hirarki-manajemen-sensor.md`](./implementasi-hirarki-manajemen-sensor.md)  
**Simulasi ESP32:** [`simulasi-gateway-esp32-firebase.md`](./simulasi-gateway-esp32-firebase.md)  
**Audit awal:** [`progres-fase-0-audit-sistem-sensor.md`](./progres-fase-0-audit-sistem-sensor.md)

## 1. Keputusan yang berlaku

- Role hanya `owner` dan `operator`, berlaku pada tingkat farm. Satu akun dapat menjadi anggota beberapa farm.
- **Tanpa server:** tidak ada Cloud Functions, Admin SDK, custom token, atau service account untuk membership maupun perangkat. Klien owner menulis langsung ke RTDB; Rules adalah satu-satunya penjaga integritas.
- Gateway terikat ke satu farm, dapat melayani sensor di beberapa kumbung farm tersebut, dan menjadi satu-satunya penulis telemetry.
- ESP32 login dengan Anonymous Auth REST; UID dipetakan oleh owner:

  ```text
  tumbara/gateways/{gatewayId}/authUid = {uid}
  tumbara/gatewayAuthUids/{uid}       = {gatewayId}
  ```

  Rules menganggap UID sebagai gateway hanya bila **kedua arah** mapping cocok dan status gateway bukan `inactive`.
- Owner menambahkan operator berdasarkan email terverifikasi lewat indeks `userDirectory/{emailKey} = { uid }`. Entri ditulis user sendiri saat login (`App.jsx` → `publishUserDirectoryEntry`), hanya bila `auth.token.email_verified === true`. `emailKey` = email huruf kecil dengan `.` diganti `,`.
- Akun/data lama dianggap dummy; akun demo `Petani` belum dibuat di Firebase Auth live.

## 2. Hasil implementasi

### Rules (`database.rules.json`)

| Area | Aturan |
|---|---|
| `userDirectory/{emailKey}` | Baca per key oleh user login (tanpa listing). Tulis hanya user sendiri dengan email terverifikasi dan key sesuai email token. |
| `users/{uid}/access/farms|farmRoles/{farmId}` | Owner farm dapat memberi/mencabut `operator` untuk user lain, hanya bersama entri `farmMembers` yang konsisten. Tidak dapat mengubah akses sendiri atau menurunkan owner. |
| `farmMembers/{farmId}/{uid}` | Owner menulis `operator` aktif dengan `invitedBy = auth.uid`; email harus terdaftar di `userDirectory` untuk UID tersebut. Hapus harus bersama indeks akses. Entri owner tidak dapat diubah/dihapus. |
| `gateways/{gatewayId}` | Owner farm membuat (status wajib `pending`) dan mengelola metadata; `farmId` tidak dapat dipindah. Gateway hanya dapat menulis `status='online'`, `lastSeenAt` (monoton), `firmwareVersion`, `appliedConfigVersion` (monoton, ≤ `configVersion`). |
| `gatewayAuthUids/{uid}` | Pairing hanya oleh owner farm gateway, untuk gateway `pending` tanpa `authUid`, UID bukan akun manusia (`users/{uid}` tidak ada), dan UID belum dipakai. Lepas pairing harus menghapus `authUid` gateway. |
| `gatewayConfigs/{gatewayId}` | Dibaca anggota farm dan gateway pemilik. `configVersion` hanya naik tepat +1 dan harus sama dengan `gateways/{id}/configVersion`; perubahan entri sensor wajib menaikkan versi. Entri sensor harus cocok dengan katalog (`gatewayId`, `kumbungId`, `enabled` = status ≠ `inactive`). |
| `sensors/{sensorId}` | Owner farm menulis katalog; kumbung dan gateway harus satu farm, indeks dan config harus ikut diperbarui, tidak bisa pindah farm, owner tidak dapat memberi status `active`. Gateway pemilik hanya dapat mengubah status `pending → active` (tidak dari `inactive`). |
| `kumbungSensors`, `gatewaySensors` | Ditulis owner, harus cocok dengan katalog sensor pada state baru. |
| `monitoring`, `history` | Write hanya gateway terpasang untuk sensor `active` yang ditugaskan ke gateway itu, di kumbung dan farm yang sama, dengan `gatewayId` payload = gateway terautentikasi. History append-only. Gateway dapat membaca record history miliknya (atau mengetahui record belum ada) untuk retry idempoten. |

Rules baca legacy (`monitoring`, `history`, `monitoring/sensor1`, forecast, operasi) tidak diubah dan diverifikasi oleh test regresi.

### Kode

- `apps/web/src/lib/deviceManagementPlan.js` (baru): pembangun multipath update murni — `buildDirectoryEntryUpdates`, `buildAddOperatorUpdates`, `buildRemoveOperatorUpdates`, `buildCreateGatewayUpdates`, `buildPairGatewayUpdates`, `buildUnpairGatewayUpdates`, `buildDisableGatewayUpdates`, `buildAssignSensorUpdates`, `buildDeactivateSensorUpdates`. Dipakai service web dan test, sehingga test menguji update yang sama dengan aplikasi.
- `apps/web/src/lib/deviceManagementService.js`: memakai Firebase Database SDK langsung (bukan callable). Operasi: `publishUserDirectoryEntry`, `addFarmOperator`, `removeFarmOperator`, `createGateway`, `pairGateway`, `unpairGateway`, `disableGateway`, `assignSensor`, `deactivateSensor`. Versi config dibaca lalu dinaikkan; bila berubah di tengah jalan, Rules menolak (concurrency optimistik).
- `apps/web/src/lib/firebasePaths.js`: builder `farmAccess`, `userDirectoryEntry`, `gatewayAuthUid`; aman diimpor dari Node.
- `apps/web/src/App.jsx`: mendaftarkan entri direktori email setiap login.
- `apps/web/src/firebase.js`: `getFunctions` dihapus. `functions/device-management.js` dan registrasinya di `functions/index.js` dihapus.
- `tools/gateway-simulator.mjs` (baru): simulator ESP32 berbasis REST murni — provision Anonymous Auth, "NVS" UID/refresh token di `.gateway-sim/` (diabaikan Git, ditulis atomik), refresh ID token, menunggu pairing, polling + validasi config, ack `appliedConfigVersion` hanya bila seluruh sensor menjawab, heartbeat 60 detik, aktivasi sensor, telemetry latest + history dengan outbox idempoten, backoff+jitter, adapter sensor tiruan (`SIM_FAIL_SENSORS` untuk sensor tidak menjawab).
- `tools/gateway-sim-e2e.mjs` (baru) dan `firebase.json` (emulator Auth port 9099).
- `package.json`: `simulate:gateway`, `test:gateway-sim`. `tools/run-database-rules-tests.ps1` menerima `-Only` dan `-Command` (default tetap test Rules).

## 3. Verifikasi (2026-10-12)

| Perintah | Hasil |
|---|---|
| `npm run test:rules` | **33/33 lulus** di RTDB Emulator |
| `npm run test:gateway-sim` | **Lulus** — owner membuat gateway + 2 sensor di 2 kumbung, UID belum dipasangkan tanpa akses, pairing → config diterapkan/sensor aktif/telemetry/heartbeat, reboot dengan UID sama dan retry history idempoten, nonaktif sensor → config baru, sensor tidak terbaca, revoke → tidak ada write |
| `npm run test:telemetry`, `npm run test:operations` | 5/5 dan 4/4 lulus |
| ESLint file web yang diubah; `node --check` functions/tools | Lulus |

Skenario allow/deny di test Rules: direktori email (email sendiri/terverifikasi saja, tanpa listing); tambah/cabut operator (UID–email tidak cocok, update parsial, owner farm lain, owner dicabut → ditolak); buat gateway (duplikat, lintas farm, operator → ditolak); UID anonim belum dipasangkan; pairing hanya owner, gateway pending, UID bukan manusia/belum dipakai; lepas dan pasang ulang; mapping menggantung; gateway membaca hanya config/katalog sendiri dan tidak bisa mengubah metadata; revoke dan `inactive`; owner/operator/non-member tidak dapat menulis telemetry; telemetry gateway/farm/kumbung/sensor salah dan out-of-range; history append-only, bucket konsisten, record gateway lain; sensor `pending`/`inactive`; penugasan dengan versi basi, lintas farm, tanpa indeks, tanpa bump versi, owner memaksa `active`; pindah gateway+kumbung; aktivasi oleh gateway; nonaktif sensor; akses baca legacy.

Emulator menampilkan peringatan kredensial Firebase CLI lokal kedaluwarsa; tidak memengaruhi emulator. Tidak login ulang atau deploy.

## 4. Batasan dan catatan untuk fase berikutnya

- ~~`tumbara/alerts` tidak memiliki rule.~~ Diselesaikan di Fase 2: alert per farm (`tumbara/alerts/{farmId}/{sensorId}_{jenis}`).
- `tools/telemetry-simulator.mjs` login sebagai akun manusia sehingga ditolak Rules gateway-only; gunakan `tools/gateway-simulator.mjs`.
- Worker/Functions berbasis Admin SDK (`functions/index.js`, `local-alert-worker.js`, `local_ai_worker`) tidak terpengaruh Rules, tetapi masih memakai sensor default/legacy `sensor1` (Fase 6).
- Gateway belum dapat menandai sensor `maintenance`/error; status sensor tak terbaca terlihat dari telemetry stale. Kontrak acknowledgement per sensor dikerjakan di Fase 3.
- Membuat farm baru dan menetapkan owner pertama belum ada alur di aplikasi; owner awal di-seed (akun demo `Petani` dibuat terpisah saat diperlukan).
- `userDirectory` memungkinkan user login mengecek apakah email tertentu terdaftar (hanya mengembalikan UID). Ini konsekuensi pilihan tanpa server; pertimbangkan App Check sebelum produksi.
- Belum ada UI manajemen anggota/gateway/sensor (Fase 2 dan Fase 5).

## 5. Sebelum deploy Rules ke Firebase

1. Aktifkan Anonymous Auth pada project Firebase.
2. Review dengan ekspor RTDB terbaru: semua `gateways`/`sensors` lama harus memenuhi skema baru (tidak ada data katalog pada ekspor yang diaudit di Fase 0).
3. ~~Putuskan rule `tumbara/alerts`.~~ Selesai di Fase 2 (per farm).
4. Pastikan tidak ada penulis telemetry manusia yang masih diperlukan.
5. Deploy ke project demo/staging terlebih dahulu, jalankan simulator gateway terhadap staging, baru production.

## 6. Langkah berikutnya (Fase 2)

1. UI owner: buat gateway, tampilkan status `pending/online/offline/inactive`, heartbeat, firmware, `configVersion` vs `appliedConfigVersion`; form pairing UID, lepas pairing, dan revoke.
2. Prosedur recovery perangkat (NVS hilang → lepas UID lama → provision → pairing ulang) di UI dan dokumen operasional.
3. Definisi offline dari `lastSeenAt` (prototipe: heartbeat 60 detik).
4. Uji simulator gateway terhadap project staging setelah Rules di-deploy ke sana.
5. Setelah hardware dipilih: firmware Wi-Fi/TLS/Auth/refresh token terlebih dahulu, mengikuti perilaku `tools/gateway-simulator.mjs`.
