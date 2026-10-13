# Progres Fase 2 — Provisioning Gateway

**Status:** **Selesai secara lokal/emulator.** Kriteria uji di staging (gateway sungguhan login, membaca config sendiri, heartbeat, gagal setelah dicabut) menunggu Rules di-deploy ke project staging/demo. Belum ada deploy atau write ke Firebase live.

**Tanggal pembaruan:** 2026-10-12  
**Rencana utama:** [`implementasi-hirarki-manajemen-sensor.md`](./implementasi-hirarki-manajemen-sensor.md)  
**Fase sebelumnya:** [`progres-fase-1-fondasi-hirarki-sensor.md`](./progres-fase-1-fondasi-hirarki-sensor.md)

## 1. Ringkasan

| Item rencana Fase 2 | Hasil |
|---|---|
| Pendaftaran gateway ID unik, status `pending` | UI **Tambah gateway** di `/devices` (owner). ID duplikat/lintas farm ditolak Rules. Gateway terindeks di `tumbara/farmGateways/{farmId}`. |
| Anonymous Auth ESP32 + pairing owner | UI **Pasangkan UID**; ESP32 diwakili `tools/gateway-simulator.mjs` sampai firmware tersedia. |
| Revoke/reset + prosedur pemulihan | UI **Lepas pairing**, **Cabut**, **Aktifkan ulang**, plus kartu panduan pemulihan (lihat §3). Alur pemulihan diuji end-to-end. |
| Heartbeat terbatas, firmware, `appliedConfigVersion` | Simulator: heartbeat 60 detik dan saat config baru diakui. UI menampilkan heartbeat relatif, firmware, `appliedConfigVersion` / `configVersion`, dan tanda “belum diterapkan”. |
| Status provisioning di UI | `gatewayConnectionState`: `pending` (menunggu pairing), `paired` (UID terpasang, belum heartbeat), `online`, `offline`, `inactive` (dicabut). |

Tambahan atas keputusan user: **alert per farm**. Dimajukan dari Fase 5 agar telemetry live dapat diuji: panel **Sensor per kumbung** di `/devices` (`src/components/FarmSensorsPanel.jsx`) — tambah sensor, ubah/pindah penugasan kumbung/gateway, nonaktifkan; status `pending → active` mengikuti gateway.

Uji live (2026-10-13): Rules ter-deploy ke `tandurai-ai`; GW-01 dan GW-02 dibuat dari UI dan GW-02 tersambung melalui simulator. Simulator kini menerima ID gateway sebagai argumen posisi (`npm run simulate:gateway run GW-02`) karena PowerShell membuang `--` sehingga npm menelan `--gateway`.

## 2. Definisi status gateway

- Heartbeat prototipe: 60 detik (`GATEWAY_HEARTBEAT_MS`).
- **Offline** bila `lastSeenAt` lebih lama dari 3 heartbeat (`GATEWAY_OFFLINE_AFTER_MS` = 3 menit). Status `online` di database hanya klaim terakhir gateway; UI selalu menghitung dari `lastSeenAt` dan menyegarkan tampilan tiap 15 detik.
- Config **belum diterapkan** bila `appliedConfigVersion < configVersion`. Gateway hanya mengakui versi bila semua sensor aktif menjawab.

## 3. Prosedur pemasangan dan pemulihan

1. Owner: **Tambah gateway** (ID, nama) → status menunggu pairing.
2. Installer: setel ID ke ESP32 dan nyalakan. Perangkat menjalankan Anonymous Auth sekali dan menampilkan UID di serial console (simulator: `npm run simulate:gateway provision <ID>`).
3. Owner: verifikasi perangkat fisik, lalu **Pasangkan UID**.
4. Perangkat membaca config, mengirim heartbeat, tampil online (simulator: `npm run simulate:gateway run <ID>`).

| Kejadian | Tindakan |
|---|---|
| ESP32 diganti, flash/NVS terhapus, refresh token dicabut | Owner **Lepas pairing** → perangkat provision ulang (`reset` lalu `provision` di simulator) → **Pasangkan UID** baru. |
| Perangkat hilang atau dicurigai bocor | Owner **Cabut**. UID dihapus, status `inactive`; perangkat tidak dapat mengaktifkan dirinya. |
| Gateway yang dicabut akan dipakai lagi | Owner **Aktifkan ulang** (kembali `pending`) → provision ulang → pasangkan UID baru. UID lama tetap tanpa akses. |
| Config tertahan “belum diterapkan” | Periksa sensor yang tidak menjawab di perangkat. |

## 4. Alert per farm

- Path: `tumbara/alerts/{farmId}/{sensorId}_{jenis}`; cooldown Telegram worker di `tumbara/notif_cooldown/{farmId}/…`.
- Rules: dibaca anggota farm (atau `platformAdmin`); ditulis anggota farm sebagai fallback browser, atau worker Admin SDK. Validasi: `farmId` = path, kumbung milik farm, ID = `sensorId_jenis`, jenis/severity/status dari daftar yang dikenal, `updatedAt` tidak di masa depan. Hapus oleh klien ditolak. Gateway tidak dapat menulis alert.
- `functions/local-alert-worker.js` menulis per farm (farm dari `tumbara/kumbungs/{DEFAULT_KUMBUNG_ID}/farmId`), menambah `farmId`/`kumbungId`/`sensorId` ke record.
- Web: `src/lib/alerts.js` (evaluasi dan record, dipindah dari `TopNavbar`), `src/lib/alertsService.js` (`subscribeFarmAlerts` lintas farm user, `syncFarmAlert`). `AlertsPage` menampilkan farm/kumbung/sensor sumber alert.

## 5. Perubahan kode

- `database.rules.json`: `tumbara/farmGateways`, `tumbara/alerts/{farmId}`.
- `apps/web/src/lib/deviceManagementPlan.js`: indeks `farmGateways` saat membuat gateway, `buildReactivateGatewayUpdates`, `gatewayConnectionState`, `gatewayConfigPending`, konstanta heartbeat/offline.
- `apps/web/src/lib/deviceManagementService.js`: `loadDeviceFarms`, `subscribeFarmGateways`, `reactivateGateway`.
- `apps/web/src/lib/firebasePaths.js`: `farmGateways`, `farmGateway`, `farmAlerts`, `farmAlert`.
- `apps/web/src/pages/DevicesPage.jsx`: diganti dari data statis menjadi manajemen gateway (owner kelola, operator baca).
- `apps/web/src/lib/alerts.js`, `alertsService.js` (baru); `AlertsPage.jsx`, `TopNavbar.jsx` memakai alert per farm.
- `functions/local-alert-worker.js`: alert dan cooldown per farm.
- `tools/gateway-sim-e2e.mjs`: verifikasi indeks dan alur pemulihan.
- `tests/device-management.test.mjs` (baru) dan script `npm run test:devices`.

## 6. Verifikasi (2026-10-12)

| Perintah | Hasil |
|---|---|
| `npm run test:rules` | **37/37 lulus** (tambahan: indeks `farmGateways`, aktivasi ulang + pairing ulang, alert per farm allow/deny, validasi alert) |
| `npm run test:gateway-sim` | **8 skenario lulus**, termasuk pemulihan: cabut → aktifkan ulang → provision UID baru → pairing → online; UID lama tetap ditolak |
| `npm run test:devices` | 6/6 lulus (status koneksi, config pending, key email, builder gateway/sensor, record alert) |
| `npm run test:alerts` (functions) | 9/9 lulus |
| ESLint file web yang diubah; `node --check` worker | Lulus |

**Belum diverifikasi:** tampilan `/devices` dan alert di browser. Web memakai Firebase live dari `.env`, sedangkan Rules baru belum di-deploy; aplikasi juga belum punya mode koneksi ke emulator. Build tidak dijalankan.

## 7. Batasan dan catatan

- Uji staging kriteria Fase 2 menunggu deploy Rules ke project demo/staging dan aktivasi Anonymous Auth.
- Data RTDB yang sudah ada di `tumbara/alerts/{jenis}` (struktur datar lama) tidak lagi dibaca. Data itu dapat dihapus manual setelah deploy; alert baru ditulis ke struktur per farm.
- `functions/index.js` (Cloud Functions legacy berbasis `sensor1`) belum dimigrasikan ke alert per farm.
- Fallback alert browser hanya memantau sensor default `TopNavbar`; alert multi-sensor penuh menunggu worker/halaman memakai katalog (Fase 6).
- Daftar gateway tidak menampilkan riwayat perubahan/audit (Fase 5).

## 8. Langkah berikutnya

1. Deploy Rules ke project demo/staging, aktifkan Anonymous Auth, lalu jalankan simulator terhadap staging untuk menutup kriteria Fase 2 secara resmi.
2. Fase 3: kontrak acknowledgement per sensor (sensor ditemukan/tidak, alasan error) agar config parsial tidak tertahan tanpa informasi.
3. Fase 5: pengelolaan operator farm dan audit perubahan assignment (UI sensor dasar sudah tersedia).
