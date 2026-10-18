# Rencana Implementasi Hirarki Manajemen Sensor

## 1. Tujuan dan ruang lingkup

Mendukung banyak farm, banyak kumbung per farm, banyak sensor per kumbung, dan karyawan yang dikelola pada tingkat farm. Gateway dimiliki satu farm dan dapat mengumpulkan data dari sensor di beberapa kumbung dalam farm yang sama. Gateway membaca sensor melalui protokol hardware yang sudah tersedia dan mengunggah telemetry langsung ke Firebase Realtime Database (RTDB).

Dokumen ini menjadi rancangan dan backlog implementasi. Fase 1 selesai secara lokal/emulator dan belum diterapkan ke Firebase live (lihat [progres Fase 1](./progres-fase-1-fondasi-hirarki-sensor.md)). Seluruh rancangan berjalan **tanpa server**: tidak ada Cloud Functions/Admin SDK untuk membership maupun perangkat. Implementasi harus menjaga pembacaan dan riwayat telemetry yang sudah tersimpan.

## 2. Kondisi awal yang diketahui

Ekspor RTDB saat ini memuat:

- `tumbara/farms/{farmId}` sebagai data farm.
- `tumbara/kumbungs/{kumbungId}` dengan `farmId`.
- `tumbara/farmKumbungs/{farmId}/{kumbungId}` sebagai indeks kumbung.
- `tumbara/monitoring/{kumbungId}/{sensorId}` sebagai pembacaan terbaru.
- `tumbara/history/{kumbungId}/{tanggal}/{recordId}` sebagai riwayat; record berisi `sensorId`.
- `users/{uid}/access/farms/{farmId}` sebagai indeks akses user ke farm.
- Contoh aktif: `SNS-0101` pada `FARM-01-K01`; terdapat dua kumbung pada `FARM-01`.

Belum ada katalog sensor/gateway yang menjadi sumber penugasan perangkat. Web memakai nilai default kumbung/sensor di `apps/web/src/lib/firebasePaths.js`; `telemetryService.js` membaca berdasarkan nilai tersebut. Aplikasi akan perlu memindahkan pilihan konteks menjadi state yang berasal dari farm/kumbung/sensor yang tersedia bagi user.

Firebase dikonfigurasi lewat environment aplikasi web. `firebase.json` menunjuk aturan ke `database.rules.json`. Jangan menaruh secret provisioning atau kredensial gateway dalam source web maupun nilai environment yang dikirim ke browser.

## 3. Keputusan domain

1. Farm memiliki banyak kumbung dan banyak gateway.
2. Karyawan menjadi anggota farm. Role karyawan berlaku untuk seluruh kumbung di farm itu; tidak ada role karyawan per kumbung.
3. Gateway ditautkan ke tepat satu farm.
4. Gateway dapat mengumpulkan banyak sensor pada beberapa kumbung dalam farm yang sama.
5. Sensor mempunyai satu penempatan kumbung aktif dan satu gateway aktif pada suatu waktu.
6. Gateway adalah satu-satunya penulis telemetry. Akun web mengelola metadata dan membaca telemetry.
7. Gateway memakai protokol sensor yang sudah ada. Firebase menjadi sumber konfigurasi penugasan gateway/sensor; gateway menerapkan konfigurasi melalui protokol tersebut.
8. Perubahan penempatan hanya memengaruhi pembacaan berikutnya. Riwayat lama tetap terikat ke kumbung asal.

Role produk ditetapkan hanya dua:

| Role farm | Kewenangan |
|---|---|
| `owner` | Mengatur farm, karyawan, kumbung, gateway, sensor, dan operasi lainnya. |
| `operator` | Mengakses data serta menjalankan operasi farm yang diizinkan; tidak mengelola karyawan atau provisioning perangkat. |

Role berlaku untuk seluruh farm. Satu akun dapat menjadi owner/operator pada beberapa farm sesuai membership masing-masing. Tidak ada role per kumbung.

Satu akun dapat menjadi anggota beberapa farm. Untuk setiap farm, akses dan role dievaluasi terpisah.

## 4. Desain data RTDB

RTDB tetap menjadi backend. Tambahkan katalog normalisasi ringan dan indeks relasi denormalisasi untuk pembacaan efisien.

```text
users/{uid}/profile/
  username: "..."
  email: "..."

users/{uid}/access/
  farms/{farmId}: true
  farmRoles/{farmId}: "owner" | "operator"

userDirectory/{emailKey}/        # emailKey = email lowercase, '.' → ','
  uid: "{uid}"                   # ditulis user sendiri bila email terverifikasi
  updatedAt: 1784091139516

tumbara/farms/{farmId}/
  id: "{farmId}"
  ownerUid: "{uid}"
  name: "..."
  status: "active"
  timezone: "Asia/Jakarta"
  createdAt: 1784077200000
  updatedAt: 1784094645804

tumbara/farmMembers/{farmId}/{uid}/
  role: "owner" | "operator"
  status: "invited" | "active" | "disabled"
  email: "..."                  # email akun operator yang sudah terdaftar
  invitedBy: "{ownerUid}"
  createdAt: 1784091139516
  updatedAt: 1784091139516

tumbara/farmKumbungs/{farmId}/{kumbungId}: true
tumbara/farmGateways/{farmId}/{gatewayId}: true

tumbara/assignmentLog/{farmId}/{logId}/        # append-only, ditulis owner bersama operasinya
  action, actorUid, createdAt, sensorId, gatewayId, targetUid,
  fromKumbungId, toKumbungId, fromGatewayId, toGatewayId, configVersion

tumbara/alerts/{farmId}/{sensorId}_{jenis}/   # jenis: temperature_high | humidity_low | co2_high | device_offline
  farmId, kumbungId, sensorId, sensor, severity, status, message, value, threshold, startedAt, updatedAt, resolvedAt

tumbara/kumbungs/{kumbungId}/
  farmId: "{farmId}"
  name: "Kumbung 01"
  capacityBaglog: 1200
  status: "active"
  createdBy: "{uid}"
  createdAt: 1784077200000
  updatedAt: 1784091139516

tumbara/gateways/{gatewayId}/
  farmId: "{farmId}"
  authUid: "{firebaseAnonymousUid}"
  name: "Gateway A"
  status: "pending" | "online" | "offline" | "inactive"
  configVersion: 12
  appliedConfigVersion: 12
  firmwareVersion: "..."
  lastSeenAt: 1784091139516
  createdBy: "{uid}"
  createdAt: 1784091139516
  updatedAt: 1784091139516

tumbara/sensors/{sensorId}/
  farmId: "{farmId}"
  kumbungId: "{kumbungId}"
  gatewayId: "{gatewayId}"
  name: "Sensor Utara"
  type: "temperature-humidity"
  hardwareAddress: "..."       # bila berbeda dari sensorId dalam aplikasi
  status: "pending" | "active" | "inactive" | "maintenance"
  createdBy: "{uid}"
  createdAt: 1784091139516
  updatedAt: 1784091139516

tumbara/kumbungSensors/{kumbungId}/{sensorId}: true
tumbara/gatewaySensors/{gatewayId}/{sensorId}: true
tumbara/gatewayAuthUids/{authUid}: "{gatewayId}"

tumbara/gatewayAcks/{gatewayId}/              # ditulis gateway
  configVersion: 12
  reportedAt: 1784091139516
  sensors/{sensorId}/
    state: "ok" | "not_found" | "read_error"
    error: "..."
    hardwareAddress: "..."
    lastReadAt: 1784091139516

tumbara/gatewayConfigs/{gatewayId}/
  farmId: "{farmId}"
  configVersion: 12
  updatedAt: 1784091139516
  sensors/{sensorId}/
    kumbungId: "{kumbungId}"
    hardwareAddress: "..."
    enabled: true

tumbara/monitoring/{kumbungId}/{sensorId}/
  farmId: "{farmId}"
  kumbungId: "{kumbungId}"
  sensorId: "{sensorId}"
  gatewayId: "{gatewayId}"
  timestamp: 1785372235915
  temperature: 27.5
  humidity: 82.4
  co2: 677
  schemaVersion: "telemetry-v1"

tumbara/history/{kumbungId}/{tanggal}/{recordId}/
  farmId: "{farmId}"
  kumbungId: "{kumbungId}"
  sensorId: "{sensorId}"
  gatewayId: "{gatewayId}"
  timestamp: 1785372235915
  ...
```

### 4.1 Catatan integritas RTDB

- `farmMembers` adalah data keanggotaan; `users/{uid}/access/farms` adalah indeks role untuk memuat farm user. Operator ditambahkan oleh owner dari akun Firebase Auth dengan email terverifikasi yang tercatat di `userDirectory`. Owner menulis membership dan indeks dalam satu multipath update; Rules memvalidasi konsistensinya.
- `farmKumbungs`, `kumbungSensors`, dan `gatewaySensors` adalah indeks. Sumber metadata tetap di node farm, kumbung, sensor, dan gateway.
- Penambahan/pemindahan sensor harus memperbarui katalog, indeks relasi, dan konfigurasi gateway secara bersamaan, atau melewati status transisi yang eksplisit jika dua gateway terlibat.
- Kredensial perangkat, private key, atau token permanen tidak disimpan pada node yang dapat dibaca klien web. Jika metadata auth perlu direferensikan, simpan hanya ID/status dan batasi pada backend tepercaya.
- ID sensor harus unik global pada fase awal. Jika hardware hanya menyediakan alamat yang tidak unik, gunakan ID aplikasi yang unik dan simpan alamat bus sebagai `hardwareAddress`.
- `farmId` pada telemetry tidak menjadi sumber otoritatif: Rules/backend memverifikasi kecocokannya dengan kumbung dan katalog sensor.

## 5. Alur kerja produk

### 5.1 Membuat farm dan mengundang karyawan

1. Owner membuat farm atau menjadi owner farm yang sudah ada.
2. Owner menambahkan akun karyawan berdasarkan email terverifikasi; karyawan baru mendapat role `operator`. Owner sendiri tercatat sebagai `owner`.
3. Aplikasi owner mencari UID di `userDirectory/{emailKey}`. Entri itu dibuat oleh user sendiri saat login bila emailnya terverifikasi; akun yang belum terdaftar/terverifikasi harus melakukannya terlebih dahulu.
4. Aplikasi owner menulis `farmMembers/{farmId}/{uid}`, `users/{uid}/access/farms/{farmId}=true`, dan `users/{uid}/access/farmRoles/{farmId}="operator"` dalam satu multipath update.
5. Operator melihat seluruh kumbung farm. Tidak ada assignment akses atau role per kumbung.
6. Owner dapat mencabut operator; membership dan indeks akses dihapus secara atomik. Owner tidak dapat dicabut melalui fitur pengelolaan operator.

### 5.2 Mendaftarkan gateway

1. Owner memilih farm dan membuka **Perangkat → Gateway → Tambah gateway**.
2. Masukkan ID gateway, nama, dan metadata yang diperlukan. Sistem menolak ID duplikat.
3. Buat katalog gateway dengan status `pending`.
4. Jalankan pairing/provisioning tepercaya untuk memasang kredensial perangkat unik.
5. Gateway mengautentikasi ke Firebase, membaca konfigurasi kosong/versi awal, lalu memperbarui heartbeat/status.
6. UI menunjukkan `online`, versi firmware, versi konfigurasi terpasang, dan waktu heartbeat.

### 5.3 Menambahkan sensor dan menugaskannya

1. Pengguna memilih farm dan kumbung, lalu memilih **Tambah sensor**.
2. Masukkan ID sensor aplikasi, label/lokasi, jenis, serta alamat hardware jika berbeda.
3. Pilih gateway pada farm yang sama. Gateway boleh telah melayani sensor di kumbung lain dalam farm itu.
4. Trusted operation memvalidasi role user, keanggotaan farm, kumbung, gateway, dan keunikan ID sensor.
5. Simpan katalog sensor, indeks `kumbungSensors`, indeks `gatewaySensors`, dan entri `gatewayConfigs` secara konsisten. Naikkan `configVersion` gateway.
6. Gateway melihat versi konfigurasi baru dan menerapkan assignment menggunakan protokol sensor yang sudah ada.
7. Gateway mengirim acknowledgement versi konfigurasi dan status tiap sensor.
8. UI mengubah sensor dari `pending` menjadi `active` hanya setelah acknowledgement dan/atau telemetry valid diterima.

### 5.4 Telemetry dan retry

1. Gateway membaca banyak sensor lokal dan mengumpulkan batch.
2. Setiap record membawa `gatewayId`, `sensorId`, `kumbungId`, timestamp, nilai, schema version, dan ID pembacaan stabil untuk deduplikasi retry.
3. Gateway menulis pembacaan terbaru ke `monitoring/{kumbungId}/{sensorId}` dan riwayat ke `history/{kumbungId}/{tanggal}/{recordId}`.
4. Firebase Rules mengizinkan hanya gateway terautentikasi dan assignment yang cocok.
5. Gateway menyimpan antrean lokal ketika offline dan mengirim ulang saat tersambung; key record yang sama mencegah retry menjadi duplikat.
6. `lastSeenAt` gateway dan `lastSeenAt`/status sensor diperbarui dengan frekuensi yang dibatasi, agar heartbeat tidak memperbesar jumlah write secara tidak terkendali.

### 5.5 Memindahkan atau menonaktifkan sensor

1. Pengguna memilih **Pindah kumbung** atau **Ganti gateway**.
2. Validasi bahwa sumber dan tujuan berada pada farm yang sama dan user berwenang.
3. Buat perubahan config dengan versi baru. Untuk perpindahan gateway, kirim versi baru ke gateway lama dan gateway tujuan.
4. Gateway lama mengakui penghapusan; gateway baru menerapkan dan mengakui assignment baru.
5. Setelah assignment baru aktif, perbarui node katalog dan indeks. Jika urutan acknowledgement gagal, tandai status transisi/error dan sediakan retry/rollback eksplisit.
6. Pembacaan baru memakai kumbung tujuan; histori yang sudah ada tidak dipindah.

## 6. Autentikasi gateway dan Firebase Rules

ESP32 login langsung ke Firebase Authentication Anonymous Auth melalui HTTPS REST API. Tidak diperlukan server aplikasi tambahan atau service-account key untuk autentikasi gateway. Firebase Auth memberi UID, ID token, dan refresh token; ESP32 memakai ID token untuk RTDB dan menyimpan refresh token di storage perangkat.

Karena Anonymous Auth tidak memiliki custom claim `gatewayId`/`farmId`, registry mengikat `auth.uid` ke satu gateway:

```text
tumbara/gateways/{gatewayId}/authUid = "{authUid}"
tumbara/gatewayAuthUids/{authUid} = "{gatewayId}"
```

Alur pairing:

1. Owner membuat ID gateway dan metadata awal `pending` di software.
2. ESP32 membuat sesi Anonymous Auth pada boot pertama dan menampilkan UID melalui kanal commissioning lokal.
3. Owner memasangkan UID dengan gateway dari aplikasi; Rules mengizinkan hanya owner farm melakukan linking/unlinking. Sebelum pairing, akun ESP32 tidak boleh membaca config atau telemetry farm.
4. Untuk setiap RTDB request, Rules mencari gateway lewat `gatewayAuthUids/{auth.uid}`, lalu memvalidasi status gateway, farm, assignment sensor, kumbung, dan path payload.
5. ESP32 membaca config sendiri, mengirim heartbeat, dan menulis telemetry menggunakan ID token; refresh token dipakai untuk memperoleh ID token baru.
6. Revoke mengubah gateway menjadi `inactive` dan menghapus mapping UID. Rules menolak operasi gateway berikutnya.

Web API key Firebase adalah identifier project, bukan password. Keamanan berasal dari Firebase Auth, pairing yang disetujui owner, mapping UID→gateway, serta RTDB Rules. Jangan menyimpan Admin private key, service account, atau kredensial owner di ESP32. Jika NVS/refresh token hilang, lakukan pairing ulang dengan UID baru.

**Status:** Rules dan service sudah memakai Anonymous Auth, registry UID dua arah, dan pairing owner; custom claims serta callable `createGateway` telah dihapus. Allow/deny diuji di Emulator (`npm run test:rules`, `npm run test:gateway-sim`).

Uji Rules untuk UID belum dipasangkan, UID gateway yang tepat, UID mencoba membaca gateway lain, sensor/kumbung/farm mismatch, gateway `inactive`, serta akun owner/operator yang mencoba menulis telemetry.

## 7. Dampak aplikasi web

### 7.1 Konteks data

- Tambahkan pemilih farm/kumbung pada shell dashboard dan persistensi pilihan terakhir per user bila sesuai.
- Semua halaman monitoring, home/dashboard, historical, analytics, alerts, automation, dan forecast harus menerima konteks eksplisit.
- Hilangkan ketergantungan runtime pada `VITE_DEFAULT_KUMBUNG_ID`/`VITE_DEFAULT_SENSOR_ID` setelah alur selector berjalan. Nilai default boleh dipakai sementara hanya sebagai fallback migrasi.
- Daftar konteks harus berasal dari `users/{uid}/access/farms`, `farmKumbungs`, dan katalog sensor.

### 7.2 Layanan/path

- Tambahkan builders ke `apps/web/src/lib/firebasePaths.js` untuk member, gateway, sensor, konfigurasi, dan indeks relasi.
- Buat domain service terpisah untuk farms/members dan devices. Jangan menyebarkan literal RTDB path ke page.
- Buat operasi perubahan relasi melalui transaksi/multipath update dari aplikasi owner dengan Rules yang memvalidasi seluruh relasi; jangan mengandalkan beberapa `set()` independen dari UI untuk integritas data.
- Buat fungsi selector sensor berdasarkan `kumbungId` dan penanganan kosong/loading/error.

### 7.3 Halaman

- **Pengaturan farm/anggota:** daftar anggota, undangan, role, status, tindakan ubah/nonaktif/cabut.
- **Daftar gateway:** farm, status, heartbeat, firmware, config/applied version, tindakan provisioning/revoke.
- **Daftar sensor per kumbung:** label, ID, jenis, gateway, status, pembacaan terakhir, kualitas data.
- **Form tambah/edit sensor:** identitas, hardware address opsional, kumbung, gateway yang difilter per farm.
- **Monitoring:** selector sensor; pilihan tampilan satu sensor atau ringkasan beberapa sensor dengan nilai dan timestamp sumber yang jelas.
- Pertahankan dan tampilkan kondisi `pending`, `offline`, data usang, degraded, tidak ada sensor, dan gagal koneksi.

## 8. Migrasi data dan kompatibilitas

Migrasi awal dari ekspor yang tersedia:

1. Buat backup RTDB dan validasi backup dapat dibaca sebelum perubahan produksi.
2. Inventarisasi semua farm, anggota yang tercatat, kumbung, path monitoring/history, dan seluruh `sensorId` yang muncul.
3. Data user lama dianggap dummy dan tidak dimigrasikan sebagai owner. Siapkan akun demo baru `Petani` dan tetapkan membership owner secara eksplisit pada lingkungan demo.
4. Buat katalog `SNS-0101` dengan `kumbungId=FARM-01-K01` dan status yang sesuai perangkat nyata. Jangan menebak gateway ID; ambil dari hardware/provisioning.
5. Buat indeks `kumbungSensors` setelah validasi semua telemetry yang menyebut sensor tersebut.
6. Pertahankan semua `monitoring` dan `history` lama tanpa rewrite. Record lama yang tidak memiliki `gatewayId` tetap valid sebagai data legacy.
7. Jalankan migrasi staging; bandingkan hitungan record sebelum/sesudah dan sampling pembacaan terbaru serta data historis.
8. Rilis mode kompatibilitas, lalu ubah telemetry writer setelah gateway siap. Hapus fallback lama hanya setelah semua halaman beralih.

Migrasi harus idempoten: dapat dijalankan ulang tanpa menggandakan anggota, katalog, atau indeks. Simpan laporan perubahan dan jalur rollback.

## 9. Urutan implementasi rinci dan kriteria selesai

### Fase 0 — Audit protokol dan persiapan

1. Telusuri seluruh halaman/service yang membaca atau menulis `monitoring`, `history`, dan nilai default sensor.
2. Dokumentasikan firmware/bridge gateway: mekanisme autentikasi yang tersedia, jaringan, protokol pairing sensor, format hardware address, polling/notification config, kapasitas sensor, dan retensi antrean offline.
3. Tentukan apakah gateway dapat menjalankan Firebase Auth dengan kredensial per perangkat dan TLS; lakukan spike kecil autentikasi serta satu write emulator/staging.
4. Tentukan definisi online/offline dan batas data stale berdasarkan interval sampling/heartbeat.
5. Kunci format `telemetry-v1` atau revisi versi dengan aturan backward compatibility.

**Selesai bila:** kontrak payload/config, model identitas, alur bootstrap auth, role farm, dan batas gateway satu farm disepakati serta didokumentasikan.

### Fase 1 — Skema, domain service, dan rules (selesai lokal, 2026-10-12)

1. Tambahkan path builders tanpa mengubah reader lama.
2. Definisikan validator payload/type/domain untuk farm member, gateway, sensor, gateway config, dan telemetry.
3. Implementasikan operasi trusted untuk menambahkan/mencabut operator serta memperbarui indeks membership.
4. Implementasikan pembuatan gateway dan pairing UID Anonymous Auth oleh owner melalui software; gateway login langsung ke Firebase tanpa token signer/server tambahan.
5. Implementasikan operasi trusted untuk tambah, ubah, pindah, dan nonaktifkan sensor dengan pembaruan katalog/indeks/config yang atomik atau versioned.
6. Tambahkan Firebase Rules untuk role manusia dan pemetaan UID gateway. Batasi write telemetry web, baca config antar-gateway, dan perubahan akses sendiri.
7. Uji Rules di emulator untuk allow/deny matrix. Jangan deploy rules baru tanpa verifikasi akses legacy yang harus tetap hidup.

**Selesai bila:** seluruh skenario akses dan integritas utama lulus emulator; klien web tidak dapat memalsukan telemetry atau mengubah role; gateway hanya mengakses farm dan konfigurasi sendiri.

### Fase 2 — Provisioning gateway (selesai lokal, 2026-10-12; uji staging menunggu deploy)

Progres: [progres-fase-2-provisioning-gateway.md](./progres-fase-2-provisioning-gateway.md).

1. Implementasikan proses pendaftaran gateway dengan ID unik dan status `pending`.
2. Implementasikan Anonymous Auth langsung di ESP32 serta pairing UID→gateway yang disetujui owner.
3. Implementasikan revoke/reset kredensial dan dokumentasikan prosedur recovery perangkat.
4. Gateway melakukan heartbeat dengan interval terbatas dan melaporkan firmware serta `appliedConfigVersion`.
5. Tambahkan UI/status provisioning agar installer tahu apakah perangkat menunggu, online, offline, atau dicabut.

**Selesai bila:** gateway staging dapat login sebagai perangkat, hanya membaca config sendiri, mengirim heartbeat, dan gagal menulis setelah akses dicabut.

### Fase 3 — Sinkronisasi konfigurasi dan protokol sensor (selesai lokal, 2026-10-13; protokol sensor fisik menunggu hardware)

Progres: [progres-fase-3-sinkronisasi-config.md](./progres-fase-3-sinkronisasi-config.md).

1. Tetapkan `gatewayConfigs/{gatewayId}` sebagai snapshot konfigurasi yang memiliki `configVersion` monoton.
2. Implementasikan gateway mengambil versi terbaru dan menerapkan perubahan idempoten melalui protokol sensor yang tersedia.
3. Definisikan acknowledgement: versi config, sensor ditemukan/tidak ditemukan, hardware address, alasan error, dan timestamp.
4. Implementasikan retry/backoff saat sensor atau Firebase tidak tersedia.
5. Buat aturan update config untuk add/remove/reassign; pastikan perubahan lintas gateway memiliki state transisi dan tidak membuat dua penugasan aktif.
6. Tambahkan telemetry/heartbeat yang cukup untuk membedakan gateway online tetapi sensor tertentu tidak terbaca.

**Selesai bila:** gateway staging berhasil memuat sekurangnya dua sensor dalam dua kumbung di farm yang sama, menerapkan config baru, mengakui hasil, dan pulih setelah koneksi putus.

### Fase 4 — Migrasi katalog dan backfill awal (tool selesai, 2026-10-15; penerapan live menunggu persetujuan)

Tool: `npm run migrate:hierarchy -- --export <ekspor.json>` (dry-run), `--live` (dry-run baca live), `--live --apply` (backup lalu terapkan). Rincian: [progres-ui-konteks-anggota-perangkat.md](./progres-ui-konteks-anggota-perangkat.md) bagian 6.

1. Buat tool/script migrasi yang membaca ekspor/RTDB dan menghasilkan rencana perubahan kering (dry run).
2. Validasi relasi farm-kumbung dari `farmKumbungs` dan `kumbungs.farmId`; tampilkan mismatch tanpa memperbaikinya diam-diam.
3. Jangan migrasikan akun lama sebagai owner. Untuk demo, buat akun dummy `Petani` dan tetapkan `owner` secara eksplisit.
4. Backfill katalog sensor dari semua ID yang ditemukan di monitoring dan history; kelompokkan berdasarkan path kumbung dan tandai metadata gateway belum diketahui.
5. Tulis indeks hanya untuk relasi yang terverifikasi; buat laporan sensor tanpa katalog, telemetry tanpa kumbung, dan farm mismatch.
6. Jalankan pada staging dan bandingkan jumlah record/relasi. Jalankan di production dengan backup dan prosedur rollback.

**Selesai bila:** migrasi idempoten, data lama utuh, semua sensor lama terinventarisasi, dan semua anomali tercatat serta ditangani.

### Fase 5 — UI anggota farm dan perangkat (UI selesai lokal, 2026-10-13)

Progres: [progres-ui-konteks-anggota-perangkat.md](./progres-ui-konteks-anggota-perangkat.md).

1. Tambahkan pengelolaan operator farm berdasarkan akun terdaftar, status keanggotaan, dan pencabutan.
2. Tambahkan daftar/detail gateway beserta status, heartbeat, versi firmware, versi config, dan provisioning/revoke.
3. Tambahkan daftar sensor dalam konteks kumbung dan filter gateway dari farm terpilih.
4. Tambahkan form sensor dengan validasi ID unik, hardware address, dan penugasan kumbung/gateway.
5. Tambahkan alur status `pending → active`, error konfigurasi, retry, pindah, dan nonaktif.
6. Tambahkan loading/error/empty states dan konfirmasi untuk perubahan penempatan.
7. Sediakan riwayat perubahan assignment untuk audit: siapa, kapan, sumber, tujuan, gateway/config version.

**Selesai bila:** owner dapat menambahkan operator dan menambah sensor ke kumbung serta gateway yang valid; assignment lintas farm ditolak; status UI merefleksikan acknowledgement gateway.

### Fase 6 — Migrasi seluruh pembaca web ke konteks dinamis (halaman telemetry selesai lokal, 2026-10-13; AI/batch/Reports belum)

Progres: [progres-ui-konteks-anggota-perangkat.md](./progres-ui-konteks-anggota-perangkat.md).

1. Bangun pemilih farm/kumbung dari akses pengguna dan indeks kumbung.
2. Ubah Monitoring agar membaca satu atau beberapa sensor melalui katalog, bukan ID default.
3. Ubah Home/dashboard, Historical, Analytics, Alerts, Automation, Forecast, dan Reports agar menerima konteks terpilih secara konsisten.
4. Tegaskan agregasi multi-sensor: metrik per sensor terlebih dahulu; agregasi kumbung hanya untuk metrik yang bisa dibandingkan, dengan indikator data hilang/stale dan sumber pembacaan.
5. Pastikan request AI, harvest/batch, dan fitur per-kumbung tetap memakai `kumbungId` yang dipilih; jangan tanpa sengaja mencampur data antar-kumbung.
6. Ukur jumlah listener/query dan hindari subscribe ke semua telemetry seluruh farm bila halaman hanya perlu sensor terpilih.
7. Hapus fallback sensor tunggal sesudah seluruh route diuji secara manual terhadap nol, satu, dan banyak sensor.

**Selesai bila:** akun yang memiliki beberapa farm/kumbung dapat mengganti konteks, melihat sensor yang tepat, dan tidak ada jalur halaman utama yang membaca ID sensor default secara tersembunyi.

### Fase 7 — Cutover, observabilitas, dan operasi

1. Aktifkan migrasi anggota/katalog terlebih dahulu tanpa mengubah writer gateway.
2. Aktifkan provisioning gateway staging dan validasi autentikasi/rules.
3. Cutover gateway uji ke write langsung RTDB; bandingkan pembacaan terbaru dengan telemetry lama/sumber alat.
4. Aktifkan sensor produksi satu per satu dan pantau errors, write denial, stale readings, duplicate retry, serta config mismatch.
5. Sediakan rollback firmware/config dan tetap pertahankan pembacaan histori lama.
6. Setelah masa stabil, ubah aturan legacy secara bertahap dan hapus default sensor/path lama dari web.

**Selesai bila:** gateway yang terdaftar mengirim telemetry stabil ke jalur benar, sensor terkonfigurasi konsisten, akses karyawan sesuai role, dan proses revoke/rollback terbukti.

## 10. Matriks verifikasi yang diperlukan

| Area | Skenario sukses | Skenario harus ditolak/ditangani |
|---|---|---|
| Farm membership | Owner menambahkan operator terverifikasi; role berlaku di farm | User mengubah role sendiri; user farm lain membaca data |
| Gateway | Gateway terdaftar membaca config sendiri dan heartbeat | Gateway tidak dikenal/nonaktif membaca atau menulis |
| Sensor assignment | Gateway mengirim sensor yang ditugaskan di kumbung farm yang sama | Sensor milik gateway lain, kumbung farm lain, atau ID tidak terdaftar |
| Telemetry | Pembacaan valid memperbarui latest dan menambah history | Timestamp/measurement invalid, path/payload mismatch, replay/duplikasi |
| Konfigurasi | Gateway menerapkan versi baru dan mengirim acknowledgement | Versi lama menimpa versi baru; config parsial tanpa status/error |
| Operasi offline | Gateway mengantrekan dan mengirim ulang data | Retry menggandakan history atau membuat data mundur menjadi latest |
| Web | Farm/kumbung/sensor kosong, satu, dan banyak dapat dipilih | Halaman menggunakan default tersembunyi atau mencampur kumbung |
| Migrasi | Backfill dapat diulang dan mempertahankan telemetry | Mismatch relasi ditulis otomatis tanpa review |

## 11. Risiko dan mitigasi

- **Kredensial gateway bocor:** gunakan identitas per perangkat, storage kredensial terlindungi, rotasi/revoke, dan klaim terbatas.
- **RTDB Rules terlalu luas atau tidak mampu memvalidasi relasi:** uji prototipe Rules pada emulator lebih awal; jangan mengandalkan validasi UI.
- **Gateway offline atau konfigurasi belum diterapkan:** tampilkan `configVersion` versus `appliedConfigVersion`, status pending/error, dan retry eksplisit.
- **Penempatan berubah saat data tertunda:** gateway mengirim ID pembacaan stabil, config version, dan konteks assignment; tetapkan perilaku data antrean lama saat assignment berubah.
- **Write volume/biaya:** batch sensor jika sesuai, batasi heartbeat, dan tetapkan retensi/pembersihan histori terpisah tanpa mengubah kebutuhan laporan.
- **Migrasi membership ambigu:** akun lama adalah data dummy; jangan mengangkatnya menjadi owner. Buat akun demo `Petani` secara eksplisit.
- **Pembacaan gabungan menyesatkan:** tampilkan sumber, timestamp, dan kualitas setiap sensor; definisikan agregasi domain sebelum membuat rata-rata kumbung.

## 12. Pertanyaan implementasi yang masih harus dijawab melalui audit teknis

Pertanyaan berikut tidak mengubah keputusan domain, tetapi perlu dijawab saat Fase 0:

1. Spesifikasi firmware diperlukan untuk memastikan Anonymous Auth langsung, penyimpanan refresh token, refresh ID token, dan koneksi RTDB REST yang didukung gateway.
2. Apakah gateway saat ini dapat membaca konfigurasi assignment terpusat dari Firebase, atau perlu perubahan firmware/bridge untuk polling dan acknowledgement?
3. Apa bentuk ID unik, hardware address, batas jumlah sensor, sampling interval, ukuran batch, dan kapasitas antrean offline gateway?
4. Berapa interval heartbeat dan batas status offline/stale yang tepat?
5. Data lama hanya dummy; gunakan owner demo baru bernama `Petani`, tanpa mempromosikan akun lama.
6. Apakah sensor boleh dihapus permanen, atau hanya dinonaktifkan demi menjaga referensi histori/audit? Rekomendasi: soft delete/nonaktif.

## 13. Area source code yang diperkirakan terdampak

- `jamur/database.rules.json`: akses farm, anggota, device catalog/config, gateway UID mapping, telemetry write.
- `jamur/apps/web/src/lib/firebasePaths.js`: path dan defaults lama.
- `jamur/apps/web/src/lib/telemetryService.js`: baca telemetry berdasarkan konteks dinamis.
- `jamur/apps/web/src/lib/operationsService.js` dan `forecastService.js`: pemuatan kumbung berbasis akses farm.
- `jamur/apps/web/src/pages/DevicesPage.jsx`: evolusi menjadi manajemen gateway/sensor.
- `jamur/apps/web/src/pages/MonitoringPage.jsx`, `HomePage.jsx`, `HistoricalPage.jsx`, `AnalyticsPage.jsx`, `AlertsPage.jsx`, `AutomationPage.jsx`, dan halaman per-kumbung lainnya.
- Auth/farm context serta navigation/layout untuk pemilih farm/kumbung.
- `apps/web/src/lib/deviceManagementPlan.js` dan `deviceManagementService.js`: undangan operator, pemetaan UID gateway, dan assignment multipath langsung dari aplikasi owner (tanpa Functions). Audit trail assignment masih Fase 5.
- Source firmware/bridge gateway untuk autentikasi, sync config, protokol sensor, telemetry, antrean offline, dan acknowledgement.
- Simulasi konfigurasi dan alur firmware ESP32: [simulasi-gateway-esp32-firebase.md](./simulasi-gateway-esp32-firebase.md).
- Rencana integrasi IoT gateway (analisis goal, desain pairing/command/mode, tahap I1–I8): [rencana-integrasi-iot-gateway.md](./rencana-integrasi-iot-gateway.md); panduan instalasi & kontrak API firmware: [../PANDUAN_INTEGRASI_HARDWARE.md](../PANDUAN_INTEGRASI_HARDWARE.md).

Daftar ini indikatif; source aktual perlu diaudit sebelum backlog ditetapkan. Ikuti `jamur/apps/web/AGENTS.md` dan `SYSTEM_MAP.md` ketika perubahan implementasi dimulai, lalu sinkronkan dokumentasi arsitektur yang terpengaruh.
