# Progres Fase 0 — Audit Sistem Sensor dan Gateway

**Status:** Audit repository selesai. Pemeriksaan firmware/protokol gateway dan uji koneksi perangkat belum dapat dilakukan karena source firmware dan spesifikasi gateway tidak ditemukan di repository yang tersedia.

**Tanggal audit:** 2026-10-09

**Dokumen rencana utama:** [`implementasi-hirarki-manajemen-sensor.md`](./implementasi-hirarki-manajemen-sensor.md)

Dokumen ini dimaksudkan sebagai handoff untuk sesi implementasi berikutnya. Temuan berasal dari inspeksi source/config dan ekspor RTDB yang telah diberikan. Tidak ada source code, rules, atau data Firebase yang diubah dalam Fase 0 ini.

## 1. Hasil audit repository

### Struktur backend dan data

- Backend utama adalah Firebase Realtime Database dan Firebase Authentication.
- `jamur/firebase.json` mengarahkan Rules database ke `jamur/database.rules.json`; fungsi Firebase terdaftar dari `jamur/functions`.
- Project alias default dalam `.firebaserc` adalah `tandurai-ai`; alias production tercatat `tumbara-bea7a`.
- Ekspor RTDB yang diberikan berisi `FARM-01`, `FARM-01-K01`, `FARM-01-K02`, indeks `farmKumbungs`, dan telemetry sensor `SNS-0101` pada `FARM-01-K01`.
- Telemetry terkini disimpan di `tumbara/monitoring/{kumbungId}/{sensorId}`. Riwayat disimpan di `tumbara/history/{kumbungId}/{tanggal}/{recordId}` dan sample record berisi `sensorId`.
- Belum ditemukan katalog `sensors`, katalog `gateways`, atau daftar assignment sensor-gateway pada ekspor yang diperiksa.
- `users/{uid}/access/farms/{farmId}` adalah bentuk akses yang tersedia; role lama seperti `manager` berada di `users/{uid}/access/role`. Ekspor belum mendefinisikan model owner/karyawan per farm secara konsisten. Owner `FARM-01` tidak boleh ditebak hanya dari role global lama.

### Aplikasi web

- `jamur/apps/web/src/firebase.js` menginisialisasi Auth dan RTDB dari `VITE_FIREBASE_*`; konfigurasi web tidak menyediakan autentikasi perangkat.
- `jamur/apps/web/src/lib/firebasePaths.js` mempunyai default `FARM-01-K01` dan `SNS-0101`, serta path legacy `tumbara/monitoring/sensor1`.
- `jamur/apps/web/src/lib/telemetryService.js` subscribe pada satu latest record yang dipilih oleh ID kumbung/sensor; jika option tidak diberikan, ia memakai default. Ia juga selalu subscribe fallback legacy.
- Call site yang ditemukan: Home, Monitoring, Historical, Analytics, TopNavbar dan Automation. Monitoring/Automation secara eksplisit memakai default kumbung untuk history. Konteks farm/kumbung/sensor belum mengalir dari satu selector bersama.
- `jamur/apps/web/src/pages/DevicesPage.jsx` memuat empat perangkat statis di `initialDevices`; add/edit/delete hanya mengubah state lokal. Ini belum terhubung ke katalog maupun telemetry.
- `jamur/apps/web/src/lib/telemetry.js` membangun payload `telemetry-v1` dengan `farmId`, `kumbungId`, `sensorId`, timestamp, dan quality, tetapi ini adalah helper aplikasi/simulator, bukan implementasi firmware gateway.
- Halaman dan layanan operasi sudah memuat farm/kumbung melalui `farmKumbungs`; ini dapat menjadi salah satu fondasi untuk selector dinamis, dengan penyesuaian terhadap akses farm baru.

### Rules dan sumber penulisan

- `jamur/database.rules.json` melindungi root secara default, lalu membuka izin per path.
- Saat ini `monitoring/{kumbungId}/{sensorId}` dapat ditulis role `manager` atau `operator` yang memiliki akses ke farm; telemetry belum mensyaratkan identitas gateway atau assignment sensor.
- Pembacaan monitoring/history mengotorisasi melalui akses farm; belum ada check keanggotaan karyawan baru atau claim perangkat.
- `jamur/tests/database-rules.test.mjs` mengunci perilaku lama, termasuk operator dapat menulis telemetry dan viewer tidak dapat. Perubahan kebijakan gateway-only nantinya memerlukan revisi ekspektasi tersebut.
- `jamur/tools/telemetry-simulator.mjs` adalah writer non-hardware yang membangun path berdasarkan `kumbungId`/`sensorId` dan menulis latest + history melalui multipath update. Periksa mode autentikasinya sebelum memakai simulator pada rules gateway-only.
- `jamur/functions/index.js` menggunakan Admin SDK dan trigger hardcoded di `tumbara/monitoring/sensor1`; ia menulis alert/cooldown/system dan menambahkan salinan ke `tumbara/history` dengan push key. Ini adalah jalur legacy yang perlu dipahami sebelum mengubah aturan/struktur alert atau menonaktifkan legacy.
- `jamur/functions/local-alert-worker.js` memakai `DEFAULT_KUMBUNG_ID`/`DEFAULT_SENSOR_ID`, subscribe ke satu sensor terpilih, dan dapat subscribe ke legacy `sensor1`. Ia menggunakan Admin SDK/service credentials, bukan identitas gateway.
- `jamur/local_ai_worker/worker/firebase_client.py` membaca latest telemetry berdasarkan satu `sensor_id` serta history per kumbung menggunakan Firebase Admin credentials. Worker AI bukan uploader perangkat.
- Source lokal yang tersedia mengindikasikan ada lebih dari satu konsep writer (simulator, fungsi/admin worker, dan rencana gateway). Migrasi harus mengklasifikasikan identitas masing-masing supaya kebijakan gateway-only tidak tanpa sengaja memutus alat simulasi atau proses server.

### Kode hardware/gateway

- Repository `jamur` memiliki `tools/telemetry-simulator.mjs`, `functions`, dan `local_ai_worker`; pencarian nama/file dan referensi `gateway`, `firmware`, `ESP32`, `MQTT`, `Modbus`, serta sensor tidak menemukan source firmware atau implementasi protokol gateway.
- Temuan ini hanya berarti firmware/protokol tidak tersedia di repository yang diperiksa; belum membuktikan hardware tidak memiliki konfigurasi jarak jauh.
- Belum dapat diverifikasi bentuk ID sensor fisik, hardware address, mekanisme gateway membaca config RTDB, mekanisme acknowledgement, format telemetry gateway, kemampuan antrean offline, autentikasi Firebase dari firmware, atau penyimpanan kredensial pada perangkat.

## 2. Kontrak domain yang sudah dipastikan

Keputusan dari user untuk rancangan:

1. Gateway hanya melayani kumbung-kumbung dalam **satu farm**.
2. Karyawan ditambahkan pada tingkat **farm**, bukan diberi role per kumbung.
3. Gateway membaca sensor melalui protokol sensor yang sudah ada.
4. Gateway mengirim telemetry langsung ke Firebase.
5. Struktur produk yang dituju: satu farm memiliki banyak kumbung; satu kumbung dapat memiliki banyak sensor; satu gateway melayani banyak sensor pada beberapa kumbung dalam farm yang sama.

Konsekuensi teknis: Rules harus mengecek bahwa `auth.token.gatewayId` dan `auth.token.farmId` cocok dengan katalog gateway aktif, serta setiap `sensorId` yang ditulis ditugaskan pada gateway itu dan kumbung tersebut. Klaim tidak boleh berasal dari nilai payload saja.

## 3. Risiko/ketergantungan yang ditemukan

1. **Autentikasi Firebase perangkat belum tersedia di repo.** Firebase client web memakai Auth user; fungsi/worker memakai Firebase Admin. Belum ditemukan proses penerbitan/refresh kredensial khusus gateway.
2. **Aturan write lama terlalu luas untuk kebijakan baru.** Operator saat ini boleh menulis monitoring, sedangkan targetnya hanya gateway menulis telemetry. Harus ada strategi cutover dan revisi test Rules.
3. **Sensor dan gateway tidak punya registry.** UI tidak dapat memvalidasi unique sensor, penempatan, atau config gateway sampai katalog/index ditambahkan.
4. **Beberapa konsumen masih single-sensor/legacy.** Default IDs dan path `sensor1` muncul di UI, alert worker, Functions, konfigurasi AI worker, dan simulator.
5. **Owner farm lama tidak dapat dipastikan.** Sebelum backfill `farmMembers`, owner `FARM-01` harus ditentukan secara eksplisit; role global manager bukan bukti kepemilikan.
6. **Semantik history berbeda antar-writer.** Simulator menggunakan ID history deterministik untuk deduplikasi; Functions lama memakai `push`. Perlu keputusan apakah jalur legacy tetap dibaca, dihentikan, atau dinormalisasi.
7. **Direct Firebase write perlu kontrol per perangkat.** Bootstrap, penerbit token tepercaya, refresh, revoke, TLS, dan penyimpanan token pada hardware perlu dipastikan. Jangan memasukkan Admin private key atau custom-token signer ke firmware/web.

## 4. Fase 0 checklist

| Pekerjaan | Status | Temuan |
|---|---|---|
| Audit halaman/service yang membaca latest/history | Selesai | Call sites dan default single-sensor dicatat di atas. |
| Audit sumber write telemetry dan Rules | Selesai | Operator, simulator, Functions legacy/Admin worker, serta rencana gateway memiliki identitas/write flow berbeda. |
| Audit Firebase config dan worker | Selesai | Web Firebase Auth/RTDB, functions dan local AI worker ditemukan; tidak ada auth client gateway. |
| Temukan dokumentasi/source gateway | Selesai dengan batasan | Tidak ditemukan pada repository `jamur`; perlu artefak eksternal atau akses repo firmware. |
| Tetapkan batas online/offline, interval sampling/heartbeat | Belum | Butuh interval hardware dan kebijakan operasional. |
| Tetapkan format gateway config/payload/ack | Belum | Butuh spesifikasi protocol/firmware. |
| Spike custom auth gateway + write ke emulator/staging | Belum dijalankan | Tidak aman menyimpulkan kesiapan tanpa spesifikasi firmware dan konfigurasi kredensial gateway. |
| Kunci farm owner lama | Belum | Perlu owner ditetapkan untuk setiap farm existing sebelum backfill membership. |

Tidak ada test, emulator, deploy, atau write ke Firebase yang dijalankan pada audit ini.

## 5. Keputusan/arah yang direkomendasikan untuk sesi selanjutnya

- Pertahankan latest/history legacy selama fase migrasi.
- Tambahkan katalog gateway/sensor dan config versioned sebagai sumber assignment sebelum UI add-sensor dihubungkan.
- Implementasikan perangkat sebagai identitas khusus. Gateway membaca konfigurasi sendiri dan menulis telemetry langsung ke RTDB; browser tidak menulis telemetry.
- Provisioning perangkat harus memakai layanan/lingkungan tepercaya untuk memperoleh sesi Firebase terikat pada `gatewayId` dan `farmId`. Evaluasi kemampuan Firebase Auth token refresh pada gateway sebelum memilih mekanisme final.
- Pisahkan status gateway online dari status sensor terbaca; gateway dapat online sementara salah satu sensor gagal.
- Simpan assignment history/config acknowledgement untuk operasi add/move/reassign dan penelusuran kegagalan.
- Migrasikan Rules dengan matriks allow/deny yang baru dan revisi test yang saat ini secara eksplisit mengizinkan operator menulis monitoring.
- Tentukan owner farm dan mapping role lama sebelum migrasi user; jangan otomatis mempromosikan manager menjadi owner.

## 6. Input yang dibutuhkan untuk menutup sisa Fase 0

Untuk menutup bagian gateway, sesi berikutnya perlu spesifikasi yang dapat dibagikan: model/OS gateway, bentuk ID/address sensor, protokol lokal dan format pairing, contoh config dan acknowledgement, format batch telemetry, sampling interval, mekanisme polling/push config, buffering offline, serta dukungan TLS dan Firebase Auth/refresh token. Jangan sertakan private key, password, token produksi, atau isi file credential.

Untuk cutover aplikasi, tentukan owner sah bagi setiap farm existing dan role mana yang boleh mengelola gateway/sensor (rekomendasi awal: owner dan manager).

## 7. Berkas yang diperiksa

- `jamur/firebase.json`, `jamur/.firebaserc`, `jamur/database.rules.json`
- `jamur/apps/web/AGENTS.md`, `jamur/apps/web/SYSTEM_MAP.md`, `jamur/apps/web/docs/data-state-integrations.md`, `jamur/apps/web/docs/module-catalog.md`
- `jamur/apps/web/src/firebase.js`, `src/lib/firebasePaths.js`, `src/lib/telemetryService.js`, `src/lib/telemetry.js`, `src/lib/operationsService.js`, `src/lib/forecastService.js`
- `jamur/apps/web/src/pages/DevicesPage.jsx`, `MonitoringPage.jsx`, `HomePage.jsx`, `HistoricalPage.jsx`, `AnalyticsPage.jsx`, `AutomationPage.jsx`, serta `components/TopNavbar.jsx`
- `jamur/functions/index.js`, `jamur/functions/local-alert-worker.js`, `jamur/local_ai_worker/worker/firebase_client.py`, `jamur/tools/telemetry-simulator.mjs`
- `jamur/tests/database-rules.test.mjs`, `jamur/tests/telemetry.test.mjs`
- Ekspor RTDB `tandurai-ai-default-rtdb-export.json` yang diberikan user.
