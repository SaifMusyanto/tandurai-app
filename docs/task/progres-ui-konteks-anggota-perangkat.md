# Progres UI — Konteks Farm, Anggota, dan Perangkat (Fase 5 & 6)

**Status:** **UI sesuai rencana selesai secara lokal** (lint dan test lulus, belum dicek di browser). Diprioritaskan sebelum Fase 4 atas permintaan user; data dummy diisi lewat simulator gateway. Rules `assignmentLog` belum di-deploy.

**Tanggal pembaruan:** 2026-10-13  
**Rencana utama:** [`implementasi-hirarki-manajemen-sensor.md`](./implementasi-hirarki-manajemen-sensor.md) bagian 7, Fase 5, Fase 6

## 1. Cakupan terhadap rencana

| Rencana | Hasil |
|---|---|
| 7.1 Pemilih farm/kumbung di shell + persistensi per user | `ContextBar` di atas setiap halaman: Farm → Kumbung → Sensor; disimpan di `localStorage` per UID. |
| 7.1 Semua halaman menerima konteks eksplisit; hilangkan default tersembunyi | Home, Monitoring, Historical, Analytics, Automation, navbar membaca `target` konteks. Default `SNS-0101` hanya fallback migrasi untuk kumbung default tanpa katalog, ditandai “default lama”. |
| 7.3 Pengaturan farm/anggota | Halaman **Anggota Farm** (`/farm-members`): daftar, role, status, tanggal; owner menambah operator via email dan mencabut. |
| 7.3 Daftar gateway | Sejak Fase 2 (`/devices`). |
| 7.3 Daftar sensor per kumbung (pembacaan terakhir, kualitas data) | Kolom **Data terakhir** (suhu/RH/CO₂, umur data, usang/kualitas) dan **Pembacaan** (ack gateway). |
| 7.3 Form tambah/edit sensor | Sejak Fase 2. |
| 7.3 Monitoring: selector sensor, satu sensor atau ringkasan beberapa sensor | Kartu **Sensor di kumbung** (nilai per sensor, sumber gateway, timestamp, status Live/Usang/Sebagian/Invalid/Menunggu gateway/Belum ada data); klik kartu memilih sensor untuk grafik detail. Tidak ada rata-rata antarsensor. |
| 7.3 State pending/offline/usang/degraded/tanpa sensor/gagal koneksi | Ditampilkan di ContextBar, ringkasan Monitoring, tabel sensor, kartu gateway, Historical. |
| Fase 5.7 Riwayat perubahan assignment untuk audit | **Riwayat perubahan** di `/devices` dan `/farm-members` dari log append-only `tumbara/assignmentLog/{farmId}` (siapa, kapan, dari → ke, versi config). |
| Fase 6.4 Agregasi multi-sensor | Ringkasan per sensor; tidak ada agregasi kumbung. |
| Fase 6.6 Batasi listener | Monitoring hanya subscribe sensor di kumbung terpilih; halaman lain hanya sensor terpilih. |

Sisa Fase 6: AI Forecast kini sinkron dua arah dengan konteks (2026-10-15). Reports masih template statis tanpa data sensor sehingga belum ada yang perlu dihubungkan. Fallback sensor tunggal belum dihapus (menunggu uji manual nol/satu/banyak sensor).

## 2. Data dummy

`npm run simulate:gateway backfill <GATEWAY_ID> [jam]` mengisi history sensor aktif gateway itu, satu record per bucket 10 menit, untuk N jam ke belakang (default 48). Record ditulis lewat jalur gateway yang sama (divalidasi Rules), idempoten, dengan pola harian pada adapter tiruan. Contoh untuk GW-02:

```
npm run simulate:gateway backfill GW-02 72
npm run simulate:gateway run GW-02
```

## 3. Perubahan kode

- Konteks: `src/contexts/FarmContext.jsx`, `src/lib/farmContext.js`, `src/components/ContextBar.jsx`, `DashboardLayout.jsx`.
- Telemetry: `telemetryService.js` (target eksplisit tanpa legacy, `subscribeKumbungTelemetry`, filter `sensorId` di history), `src/hooks/useSensorHistory.js`.
- Halaman: `MonitoringPage` (+`KumbungSensorSummary`), `HistoricalPage` (history nyata, rentang 24 jam/7/30 hari, kolom kualitas/misting), `AnalyticsPage` (history nyata per timeframe, downsample seluruh rentang), `HomePage`, `AutomationPage`, `TopNavbar`, `DevicesPage` (farm dari konteks, riwayat), `FarmMembersPage` (baru), `FarmSensorsPanel` (data terakhir), `AssignmentLogPanel` (baru), route `/farm-members` dan menu **Anggota Farm**.
- Audit: `buildAuditEntry`, `sensorAssignmentAction`; service menulis log di setiap operasi owner; `subscribeAssignmentLog`, `subscribeFarmMembers`.
- Rules: `tumbara/assignmentLog/{farmId}/{logId}` — tulis hanya owner farm, entri baru (tidak dapat diubah/dihapus), `actorUid = auth.uid`, `createdAt` ±5 menit dari server, aksi dari daftar, field lain ditolak; dibaca anggota farm; `.indexOn: createdAt`.
- Simulator: perintah `backfill`, adapter tiruan berpola harian.

## 4. Verifikasi (2026-10-13)

| Perintah | Hasil |
|---|---|
| `npm run test:rules` | **41/41 lulus** (tambahan: log audit ditulis owner bersama operasi, dibaca anggota, tidak dapat diubah/dihapus; ditolak untuk operator, aktor palsu, waktu lampau, aksi asing, farm lain) |
| `npm run test:gateway-sim` | **10 skenario lulus** (tambahan: backfill 12 record, diulang tanpa duplikat) |
| `npm run test:devices` | 10/10 lulus (tambahan: pemilihan konteks, penyimpanan per user, entri audit, jenis aksi sensor) |
| `npm run test:telemetry`, `npm run test:operations` | 5/5, 4/4 lulus |
| ESLint seluruh file web yang diubah | Lulus; 1 peringatan lama `HomePage.jsx:299` (tidak terkait) |

Tampilan belum dicek di browser; build tidak dijalankan.

## 5. Langkah di project live

1. `npm run deploy:rules:demo` (menambah `assignmentLog`; juga `gatewayAcks` dari Fase 3 bila belum).
2. Hentikan lalu jalankan ulang simulator dengan kode terbaru; isi data dummy: `npm run simulate:gateway backfill GW-02 72`.
3. Buka dashboard: pilih farm/kumbung/sensor di bar konteks; cek Monitoring, Historical, Analytics, `/devices`, dan `/farm-members`.

## 6. Penyelesaian kekurangan (2026-10-15)

| Item | Hasil |
|---|---|
| Deploy Rules | **Ter-deploy ke `tandurai-ai`** (`gatewayAcks`, `assignmentLog`); sintaks valid. Setelah seluruh suite lulus. |
| Build produksi | `vite build` lulus (bundle dibuat tanpa error). |
| Role per farm di Operasional & AI Forecast | **Bug diperbaiki.** Halaman memakai `access.role` lama (`manager`), padahal Rules memakai `farmRoles`. Kini `src/lib/access.js` (`farmRoleOf`, `farmRolesOf`): Operasional — owner mengelola, owner/operator mencatat panen; AI Forecast — owner/operator dapat meminta perhitungan untuk farm kumbung terpilih. |
| AI Forecast ↔ konteks | Pilihan kumbung sinkron dua arah dengan `ContextBar` (`selectKumbung` pada `FarmContext`); deep link `?kumbung=` tetap didahulukan. |
| Fase 4 migrasi | `tools/migration-plan.mjs` (murni) + `tools/migrate-hierarchy.mjs`: validasi farm↔kumbung, inventaris sensor dari monitoring/history, indeks `farmGateways`/`kumbungSensors`/`gatewaySensors` yang terverifikasi, `farmMembers` dari `farmRoles` (bukan dari role lama), hapus `access.role` lama, alert datar dan `notif_cooldown` datar. Anomali (sensor tanpa katalog, relasi tidak cocok, akses tanpa role) hanya dilaporkan. `--apply` mewajibkan `--live`, membuat backup per path di `migration-backups/` (diabaikan Git), lalu memverifikasi ulang (idempoten). |
| Worker alert lokal | Multi-sensor: semua sensor `active` katalog farm (`ALERT_FARM_ID`), realtime terhadap perubahan katalog, offline per sensor, lokasi Telegram menyebut kumbung/sensor. Pemilihan sensor di `functions/sensor-targets.js`. |

Dry-run terhadap ekspor RTDB terakhir: 1 sensor lama (`SNS-0101`, 94 history) belum ada di katalog → tugaskan lewat `/devices`; 8 perubahan direncanakan (owner petani ke `farmMembers`, hapus `role: manager`, 4 alert datar, 2 cooldown datar). **Belum diterapkan ke live**; jalankan `npm run migrate:hierarchy -- --live` untuk melihat rencana terkini lalu `--live --apply` setelah disetujui.

Verifikasi: rules 41/41, simulator gateway 10/10, `test:devices` 11/11, `test:migration` 4/4, `test:alerts` (functions) 11/11, **`test:alert-worker` lulus** (worker nyata pada emulator: 3 sensor aktif dipantau, pending/farm lain diabaikan, alert suhu, normal, dan offline per sensor), telemetry 5/5, operations 4/4, ESLint lulus.

Masih di luar jangkauan tanpa hardware/keputusan: firmware ESP32 nyata, worker AI (Python) yang masih single-sensor, Cloud Functions legacy `sensor1` (digantikan worker lokal), alur membuat farm baru dari aplikasi, dan App Check.

