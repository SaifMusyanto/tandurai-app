# Progres Fase 3 — Sinkronisasi Config dan Ack Sensor

**Status:** **Selesai secara lokal/emulator** untuk sisi Firebase, Rules, simulator, dan UI. Implementasi protokol sensor fisik (adapter bus) menunggu pemilihan hardware. Rules `gatewayAcks` belum di-deploy.

**Tanggal pembaruan:** 2026-10-13  
**Rencana utama:** [`implementasi-hirarki-manajemen-sensor.md`](./implementasi-hirarki-manajemen-sensor.md)  
**Fase sebelumnya:** [`progres-fase-2-provisioning-gateway.md`](./progres-fase-2-provisioning-gateway.md)  
**Kontrak firmware:** [`simulasi-gateway-esp32-firebase.md`](./simulasi-gateway-esp32-firebase.md) (Langkah 1b dan Langkah 6)

## 1. Status per item rencana

| Item Fase 3 | Hasil |
|---|---|
| 1. `gatewayConfigs` sebagai snapshot dengan `configVersion` monoton | Sejak Fase 1: Rules mewajibkan kenaikan tepat +1 setiap perubahan entri sensor dan menyamakan `gateways/{id}/configVersion`. |
| 2. Gateway mengambil versi terbaru dan menerapkan idempoten | Simulator: polling 30 detik, validasi farm/versi mundur, probe tiap sensor, aktivasi `pending → active`. Protokol bus nyata menunggu hardware (adapter tiruan). |
| 3. Kontrak acknowledgement | **Baru:** `tumbara/gatewayAcks/{gatewayId}` — `configVersion`, `reportedAt`, dan per sensor `state` (`ok`/`not_found`/`read_error`), `error`, `hardwareAddress`, `lastReadAt`. `appliedConfigVersion` tetap hanya naik bila semua sensor menjawab. |
| 4. Retry/backoff | Backoff eksponensial + jitter (1–60 detik) sejak Fase 1. **Baru:** mode offline — sensor tetap dibaca, history diantrekan, dikirim idempoten setelah tersambung. |
| 5. Perubahan lintas gateway tanpa dua assignment aktif | Dijamin katalog `sensors/{id}/gatewayId` + multipath update + Rules telemetry. **Baru:** perilaku antrean ditetapkan — record yang ditolak Rules karena assignment berubah dibuang; penolakan memicu muat ulang config. |
| 6. Bedakan gateway online vs sensor tidak terbaca | **Baru:** kartu gateway menampilkan sensor bermasalah; tabel sensor punya kolom **Pembacaan** (terbaca/stale/tidak ditemukan/gagal dibaca/menunggu laporan). |

## 2. Perubahan

- `database.rules.json`: `tumbara/gatewayAcks/{gatewayId}` — tulis hanya gateway pemilik yang terpasang dan tidak `inactive`; sensor harus ada di config gateway; `configVersion` ≤ config; state dari daftar; field lain ditolak; tidak dapat dihapus klien. Dibaca anggota farm gateway dan gateway itu sendiri.
- `tools/gateway-simulator.mjs` (firmware sim `0.3.0`): ack per sensor; baca sensor lokal tanpa jaringan dan antrekan history sebelum upload; status `offline`; buang record antrean yang ditolak Rules; bila semua upload ditolak, cek pairing (`unpaired`/`denied`); `fetchImpl` untuk injeksi gangguan jaringan; getter diagnostik `outboxPaths`; tidak lagi GET status sensor setiap siklus (status dibaca saat config diterapkan).
- Web: `FIREBASE_PATHS.gatewayAck`; `subscribeFarmGateways` menyertakan `gateway.ack`; `sensorHealth` di `deviceManagementPlan.js`; tampilan masalah sensor di `DevicesPage.jsx` dan kolom Pembacaan di `FarmSensorsPanel.jsx`.

## 3. Verifikasi (2026-10-13)

| Perintah | Hasil |
|---|---|
| `npm run test:rules` | **39/39 lulus** (tambahan: ack ditulis gateway pemilik dan dibaca anggota; ditolak untuk gateway lain, manusia, sensor di luar config, versi di depan config, state/field asing, hapus, gateway `inactive`) |
| `npm run test:gateway-sim` | **9 skenario lulus**, termasuk: ack per sensor setelah pairing; sensor dinonaktifkan hilang dari ack; sensor tidak menjawab → `not_found` + alasan; jaringan putus → status offline, latest tidak berubah, 2 record diantrekan → tersambung → record terkirim dengan timestamp saat offline, 2 record sensor yang dinonaktifkan selama offline dibuang, config baru dimuat ulang; revoke dan pemulihan tetap lulus |
| `npm run test:devices` | 7/7 lulus (tambahan `sensorHealth`) |
| ESLint file web yang diubah | Lulus |

Kriteria rencana — gateway memuat ≥2 sensor dalam dua kumbung satu farm, menerapkan config baru, mengakui hasil, pulih setelah koneksi putus — terpenuhi di emulator. Uji staging menunggu deploy Rules terbaru.

## 4. Yang perlu dilakukan pada project live

1. Deploy ulang Rules: `npm run deploy:rules:demo` (menambah `gatewayAcks`).
2. Hentikan simulator GW-02 yang sedang berjalan dan jalankan ulang (`npm run simulate:gateway run GW-02`) agar memakai simulator `0.3.0` yang menulis ack.
3. Buka `/devices`: kolom **Pembacaan** berubah dari “Menunggu laporan gateway” menjadi “Terbaca … lalu”.

## 5. Batasan

- Adapter sensor masih tiruan; format alamat hardware, probe, dan kode error nyata ditentukan saat protokol bus dipilih.
- Outbox simulator berada di RAM (hilang bila proses mati). Firmware nyata perlu outbox persisten terbatas (mis. ring buffer di flash) dengan memperhatikan keausan flash.
- Laporan ack menimpa laporan sebelumnya; belum ada riwayat ack/assignment (audit, Fase 5).
- Gateway belum dapat mengubah status katalog sensor menjadi `maintenance`; masalah sensor terlihat dari ack.

## 6. Langkah berikutnya

- **Fase 4 — migrasi katalog dan backfill:** tool dry-run untuk ekspor RTDB (inventaris sensor dari monitoring/history, mismatch farm-kumbung, laporan anomali), lalu bersihkan data legacy (alert datar lama, `notif_cooldown` lama, `role: manager`).
- Firmware ESP32 nyata setelah hardware dipilih, mengikuti perilaku simulator.
