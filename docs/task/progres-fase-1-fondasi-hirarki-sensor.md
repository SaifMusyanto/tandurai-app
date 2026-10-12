# Progres Fase 1 — Fondasi Hirarki Sensor

**Status terbaru:** Rancangan ESP32 tanpa server provisioning tambahan sudah dipilih dan dicatat, tetapi source Fase 1 belum dimigrasikan ke rancangan ini. Kode dan Rules saat ini masih memakai custom claims/Cloud Functions; jangan deploy sebagai solusi ESP32 langsung sebelum mismatch tersebut dibereskan.

**Tanggal pembaruan:** 2026-10-09  
**Rencana utama:** [`implementasi-hirarki-manajemen-sensor.md`](./implementasi-hirarki-manajemen-sensor.md)  
**Simulasi ESP32:** [`simulasi-gateway-esp32-firebase.md`](./simulasi-gateway-esp32-firebase.md)  
**Audit awal:** [`progres-fase-0-audit-sistem-sensor.md`](./progres-fase-0-audit-sistem-sensor.md)

## 1. Keputusan domain dan autentikasi terbaru

- Role hanya `owner` dan `operator`, berlaku pada tingkat farm.
- Satu akun dapat terhubung ke lebih dari satu farm. Owner menambahkan karyawan sebagai operator farm.
- Akun/data lama dianggap dummy. Fixture demo berisi owner bernama `Petani` dengan UID placeholder; akun itu belum dibuat di Firebase Auth dan belum di-seed ke Firebase live.
- Gateway memiliki ID stabil yang dibuat dari software, terikat ke satu farm, dan dapat menangani sensor di beberapa kumbung dalam farm tersebut.
- Hanya gateway yang menulis telemetry ke RTDB.
- **ESP32 login langsung ke Firebase Anonymous Auth melalui HTTPS REST API.** Tidak memakai custom token, Admin SDK, service-account key, atau server khusus untuk menerbitkan token gateway.
- Firebase Auth mengembalikan UID, ID token, dan refresh token. ESP32 mengirim ID token ke RTDB dan menyimpan refresh token secara lokal agar UID tetap sama setelah reboot.
- Owner memasangkan UID Auth ESP32 dengan gateway ID. Registry yang direncanakan:

  ```text
  tumbara/gateways/{gatewayId}/authUid = {uid}
  tumbara/gatewayAuthUids/{uid} = {gatewayId}
  ```

- RTDB Rules mencari gateway dari `auth.uid` melalui registry tersebut, lalu memeriksa farm, status gateway, assignment sensor, dan kumbung. Rules tidak lagi mengandalkan custom claims `identity`, `gatewayId`, atau `farmId`.
- Cara pairing UI belum dibuat. Sebelum UID dipasangkan owner, akun anonim ESP32 tidak boleh membaca config atau menulis telemetry.
- Firebase Auth/RTDB masih layanan cloud dan tetap mengikuti kuota/harga project. Pilihan ini menghindari server compute terpisah khusus untuk provisioning/login gateway.

## 2. Kondisi source saat ini

### Sudah dibuat sebelumnya

- Registry dan Rules awal untuk `gateways`, `sensors`, `farmMembers`, `kumbungSensors`, `gatewaySensors`, dan `gatewayConfigs`.
- Rules awal mengganti role global dengan `users/{uid}/access/farmRoles/{farmId}` (`owner`/`operator`) serta membatasi akses data farm.
- Rules awal mengunci latest/history write ke gateway, tetapi identifikasi gatewaynya memakai **custom claims**. Ini belum sesuai rancangan Anonymous Auth UID mapping.
- `functions/device-management.js` menyediakan callable `createGateway`, `assignSensor`, `disableGateway`, `addFarmOperator`, dan `removeFarmOperator`.
- `createGateway` saat ini membuat custom token dengan claims; bagian provisioning ini harus dihapus atau diganti. Jangan menerbitkan custom token dari backend untuk desain yang dipilih.
- Web sudah punya path builder dan `deviceManagementService`, tetapi belum punya halaman UI manajemen perangkat/pairing.
- Fixture test owner `Petani` memakai placeholder; tidak menyimpan password akun nyata.

### Belum dilakukan

- Belum ada firmware atau source ESP32 di repository.
- Anonymous Auth belum diaktifkan/diuji pada project Firebase live.
- Belum ada Auth REST client ESP32, refresh token storage/NVS, pairing UID, atau sensor adapter.
- Belum ada perubahan Rules untuk `gatewayAuthUids/{uid}`.
- Belum ada perubahan sumber penulisan metadata gateway/config agar pairing dan assignment dapat dilakukan tanpa Cloud Function provisioning khusus. Tentukan mana yang dapat dilakukan langsung oleh aplikasi owner dengan multipath update + Rules.
- Belum ada UI pairing owner, UI gateway/sensor, acknowledgement firmware, atau test end-to-end perangkat.
- Tidak ada deploy atau write ke Firebase live.

## 3. Verifikasi terakhir pada source lama

- `npm run test:rules`: **17/17 lulus** pada Realtime Database Emulator sebelum perubahan rancangan Anonymous Auth. Test tersebut memvalidasi rancangan custom claims yang sekarang masih berada di source; test harus diperbarui saat Rules dimigrasikan.
- `node --check functions/device-management.js`, `node --check functions/index.js`, dan `node --check tests/database-rules.test.mjs`: lulus pada pemeriksaan terakhir.
- ESLint untuk `apps/web/src/firebase.js`, `firebasePaths.js`, dan `deviceManagementService.js`: lulus.
- Emulator menampilkan peringatan kredensial Firebase CLI lokal kedaluwarsa tetapi tetap menjalankan suite dengan sukses. Tidak login ulang atau deploy.
- Pemeriksaan di atas adalah baseline source lama; setelah implementasi UID mapping, ulangi test Rules dan unit/callable yang terkait.

## 4. Rancangan ESP32 yang perlu diimplementasikan

1. Software membuat `gatewayId`, contoh `GW-01`, dengan status `pending`.
2. ESP32 menjalankan Anonymous Auth `accounts:signUp` hanya saat provisioning pertama, menyimpan `localId`/UID dan `refreshToken` di storage perangkat, serta menyimpan ID token sementara di RAM.
3. ESP32 menampilkan UID melalui serial/proses commissioning yang dibatasi. Owner memverifikasi perangkat fisik, lalu memasangkan UID tersebut ke `GW-01`.
4. Software owner menulis mapping UID dua arah secara aman. Rules harus mencegah operator, gateway lain, atau user biasa mengubah mapping.
5. Setelah dipasangkan, ESP32 membaca `gatewayConfigs/GW-01`, melaporkan heartbeat dan versi config, lalu membaca sensor lokal.
6. ESP32 mengirim `telemetry-v1` ke latest/history memakai ID token. ID sensor, kumbung, farm, dan gateway harus berasal dari config/registry yang tervalidasi.
7. Token 401 memicu refresh sekali; error jaringan memakai backoff. Refresh token hilang/revoke berarti pairing ulang dengan UID baru.

Contoh payload, API Auth, bentuk config multi-sensor/multi-kumbung, dan batasan retry dijelaskan di dokumen simulasi ESP32 tertaut di atas. Protokol `modbus-rtu` pada contoh hanyalah placeholder; belum ada keputusan protokol hardware.

## 5. Langkah sesi berikutnya

1. **Migrasikan Rules gateway dari custom claims ke UID mapping.** Tambahkan path `gatewayAuthUids`, validasi gateway/farm, read config milik gateway sendiri, telemetry assignment, status inactive, dan aturan owner untuk pairing/unpair.
2. **Hilangkan callable custom-token provisioning.** Review `createGateway` dan `deviceManagementService`; pilih operasi metadata yang dapat dilakukan dari aplikasi owner langsung ke RTDB dengan Rules + multipath update. Jangan menaruh Admin credential di ESP32.
3. **Tambahkan test emulator baru** untuk UID anonim belum dipasangkan, gateway tepat, UID mencoba gateway lain, farm/kumbung mismatch, owner-only pairing, revoke, telemetry owner/operator ditolak, dan history retry/read scope.
4. **Buat simulator komputer** untuk Anonymous Auth, token refresh, pairing UID manual, config polling, heartbeat, serta telemetry tiruan sebelum hardware dibeli.
5. **Buat UI owner** untuk membuat ID gateway dan memasangkan UID perangkat; tampilkan status `pending/online/inactive` dan waktu heartbeat.
6. Tambahkan pengelolaan sensor: pilih kumbung, isi sensor ID/alamat, assign ke gateway pada farm yang sama; status `active` menunggu laporan gateway.
7. Setelah model ESP32/sensor/protokol dipilih, buat firmware Wi-Fi/TLS/Auth dahulu, lalu config manager, adapter sensor, outbox, dan recovery offline.
8. Pertahankan dry-run migrasi data legacy. Jangan mengangkat akun lama sebagai owner; akun demo `Petani` tetap perlu dibuat terpisah jika diperlukan.
9. Tidak ada deploy sebelum Rules yang baru lulus Emulator dan alur lama yang perlu dipertahankan sudah ditinjau.