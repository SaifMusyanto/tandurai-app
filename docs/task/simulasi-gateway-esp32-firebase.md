# Simulasi Konfigurasi Gateway ESP32 ke Firebase

Dokumen ini menjelaskan rancangan prototipe gateway berbasis ESP32 yang login langsung ke Firebase Auth, membaca assignment sensor, dan mengirim telemetry langsung ke RTDB tanpa server provisioning terpisah. Semua ID, URL, interval, serta nilai sensor pada contoh adalah simulasi. Dokumen ini tidak mengubah firmware atau Firebase live.

> **Keputusan autentikasi terbaru:** ESP32 membuat/memakai akun Firebase Anonymous Auth, lalu RTDB Rules mengenali perangkat melalui pemetaan UID→gateway yang disetujui owner. Rancangan credential perangkat/Cloud Functions pada progres Fase 1 belum disesuaikan di source; source dan Rules harus diubah sebelum deploy agar cocok dengan dokumen ini.

## 1. Batas rancangan dan asumsi

- ESP32 bertindak sebagai **gateway**; sensor lokal tidak login ke Firebase dan tidak menulis langsung ke cloud.
- Satu gateway ditautkan ke satu farm. Gateway boleh menangani sensor pada beberapa kumbung dalam farm itu.
- ESP32 memakai Firebase Authentication **Anonymous Auth** langsung melalui HTTPS REST API. Tidak ada service account, custom-token signer, atau server provisioning tambahan.
- Firebase Auth memberikan UID tetap dan pasangan ID/refresh token. RTDB Rules tidak memakai custom claims; Rules mencocokkan `auth.uid` dengan registrasi gateway yang disetujui owner.
- ESP32 memerlukan koneksi internet ke Firebase Auth dan RTDB. Firebase tetap layanan cloud terkelola dan penggunaan Auth/RTDB mengikuti kuota/harga project; pendekatan ini menghindari server compute tambahan untuk login gateway.
- Firebase Anonymous Auth harus diaktifkan pada project. Simpan refresh token/identitas lokal di NVS; setelah flash reset atau token hilang, gateway harus dipasangkan ulang.
- Firmware membaca daftar sensor dari `tumbara/gatewayConfigs/{gatewayId}`. Protokol sensor fisik belum diketahui. Contoh `modbus-rtu:1` hanya ilustrasi.
- Aturan RTDB saat ini di repository masih memakai claim custom gateway. Rules dan code provisioning Fase 1 belum cocok dengan pendekatan Anonymous Auth; perubahan migrasi dirinci di bagian autentikasi.

## 2. Arsitektur komponen firmware

Pisahkan firmware agar alur Firebase dapat dites memakai sensor tiruan:

1. **Provisioning**: menyimpan `gatewayId` yang dibuat software. Setelah Firebase Auth pertama berhasil, menampilkan UID untuk dipasangkan oleh owner.
2. **Firebase Auth REST client**: membuat sesi anonymous pada boot pertama, menyimpan refresh token, dan memperbarui ID token.
3. **RTDB REST client**: membaca konfigurasi dan menulis heartbeat/latest/history menggunakan ID token.
4. **Config manager**: memvalidasi `farmId`, `configVersion`, daftar sensor, dan alamat perangkat.
5. **Sensor adapter**: menerjemahkan assignment menjadi pembacaan protokol lokal; adapter tiruan dipakai sebelum sensor fisik tersedia.
6. **Telemetry normalizer**: membentuk payload `telemetry-v1`, memvalidasi rentang data, dan memastikan waktu tersinkron.
7. **Outbox**: antrean terbatas untuk data yang belum terkirim.
8. **Diagnostics**: status jaringan/Auth, versi config, uptime, dan error; token tidak boleh ditulis ke log.

## 3. Parameter simulasi

### 3.1 Project dan gateway

```text
FIREBASE_API_KEY       = <Firebase Web API key project>
FIREBASE_PROJECT_ID    = tandurai-ai
FIREBASE_DATABASE_URL  = https://<database-name>.firebasedatabase.app
FIREBASE_AUTH_HOST     = https://identitytoolkit.googleapis.com
FIREBASE_TOKEN_HOST    = https://securetoken.googleapis.com
GATEWAY_ID             = GW-01
GATEWAY_UID            = <UID hasil Anonymous Auth, mis. random Firebase UID>
FARM_ID                = FARM-01
FIRMWARE_VERSION       = esp32-gateway-sim/0.2.0
```

API key Firebase adalah identifier project, bukan password. Jangan menaruh refresh/ID token, service-account JSON, atau private key di repository atau log. UID dihasilkan Firebase Auth, bukan dipilih oleh firmware.

### 3.2 Konfigurasi yang disimpan server

Owner membuat gateway `GW-01`, lalu menambahkan dua sensor pada farm yang sama. Contoh `gatewayConfigs/GW-01`:

```json
{
  "farmId": "FARM-01",
  "configVersion": 2,
  "updatedAt": 1791507600000,
  "sensors": {
    "SNS-0101": {
      "kumbungId": "FARM-01-K01",
      "hardwareAddress": "modbus-rtu:1",
      "enabled": true
    },
    "SNS-0102": {
      "kumbungId": "FARM-01-K02",
      "hardwareAddress": "modbus-rtu:2",
      "enabled": true
    }
  }
}
```

Node tersebut berada di `tumbara/gatewayConfigs/GW-01`. Mapping identitas yang disetujui owner disimpan terpisah:

```text
tumbara/gateways/GW-01/authUid = "<GATEWAY_UID>"
tumbara/gatewayAuthUids/<GATEWAY_UID> = "GW-01"
```

Indeks UID diperlukan agar Rules dapat menemukan gateway hanya dari `auth.uid`. Hanya owner farm yang boleh memasangkan atau mencabut mapping ini. Mapping UID↔gateway harus unik dan diupdate konsisten.

`hardwareAddress` adalah alamat protokol lokal; `sensorId` adalah identitas aplikasi pada path telemetry. Jangan memakai alamat bus yang tidak unik sebagai ID sensor global.

### 3.3 Data lokal ESP32

```text
NVS (gunakan proteksi flash bila board mendukung)
├── gateway_id       # GW-01, disetel saat provisioning
├── firebase_uid     # UID Anonymous Auth yang sudah dipasangkan
├── refresh_token    # rahasia sesi; jangan dicetak ke serial
└── provisioned      # true setelah owner menghubungkan UID ke GW-01

RAM saja
├── id_token         # token sementara untuk request RTDB
├── id_token_expiry
└── current_config   # snapshot configVersion aktif
```

Jangan sign up anonymous baru pada setiap boot. Boot berikutnya memakai refresh token agar UID tetap sama. Jika NVS terhapus atau refresh token dicabut, hapus mapping UID lama lewat owner, buat sesi baru, lalu pasangkan ulang.

## 4. Alur autentikasi langsung di ESP32

### Langkah A — Siapkan gateway di software

1. Owner membuat ID stabil, misalnya `GW-01`, pada software. Gateway dibuat berstatus `pending` dan belum punya `authUid`.
2. Software memberikan `gatewayId` ke ESP32 lewat konfigurasi serial saat commissioning. `gatewayId` bukan secret; ia tidak memberikan akses tanpa UID yang disetujui Rules.
3. Aktifkan Firebase Authentication → Anonymous pada project Firebase. REST API menggunakan Web API key project yang sama dengan aplikasi web.

### Langkah B — ESP32 membuat identitas Firebase langsung

Pada boot pertama, ESP32 mengirim HTTPS POST:

```http
POST https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<FIREBASE_API_KEY>
Content-Type: application/json
```

Body untuk Anonymous Auth:

```json
{ "returnSecureToken": true }
```

Respons berisi `localId` (UID), `idToken`, `refreshToken`, dan `expiresIn`. ESP32 menyimpan UID dan refresh token ke NVS. ID token disimpan di RAM.

Untuk boot selanjutnya, gunakan refresh token. Jangan panggil `accounts:signUp` lagi kecuali provisioning ulang memang diperlukan; jika selalu sign up, setiap boot akan membuat akun/UID baru.

### Langkah C — Owner memasangkan UID ke ID gateway

1. Saat pertama kali login, ESP32 menampilkan `gatewayId` dan UID pada serial console atau kanal commissioning lokal yang dibatasi.
2. Owner memverifikasi bahwa ia sedang memasangkan perangkat fisik yang benar, lalu menghubungkan `GW-01` dengan UID itu melalui software.
3. Software owner menulis `gateways/GW-01/authUid` dan `gatewayAuthUids/{UID}=GW-01`; aturan RTDB harus mengizinkan owner farm melakukan perubahan itu dan menolak user biasa/operator.
4. Sebelum mapping terpasang, ESP32 hanya dapat mendaftar/login; Rules belum mengizinkannya membaca config atau mengirim telemetry.
5. Sesudah mapping aktif, gateway refresh/login ulang lalu mengakses hanya config dan sensor assignment miliknya.

Belum ada UI pairing pada aplikasi saat ini. Untuk simulasi, mapping dapat dibuat oleh owner di Firebase Console setelah Rules khusus owner ditambahkan. Jangan membuka write umum pada node mapping hanya agar perangkat bisa memasangkan dirinya sendiri.

### Langkah D — Refresh sesi

Sebelum ID token kedaluwarsa, kirim HTTPS POST:

```http
POST https://securetoken.googleapis.com/v1/token?key=<FIREBASE_API_KEY>
Content-Type: application/x-www-form-urlencoded
```

```text
grant_type=refresh_token&refresh_token=<REFRESH_TOKEN>
```

Simpan refresh token terbaru secara atomik. Bila RTDB memberi HTTP 401, refresh sekali dan ulang request. Bila akun anonymous dihapus/dicabut, minta owner hapus mapping UID lama dan lakukan pairing baru. Error jaringan ditangani dengan backoff; jangan retry rapat tanpa batas.

## 5. Alur RTDB

Gunakan HTTPS dan sertakan ID token pada parameter `auth` di request RTDB REST. Contoh di bawah menunjukkan bentuk URL—token harus dipasang secara runtime dan tidak dicetak:

```text
GET   {DATABASE_URL}/tumbara/gatewayConfigs/GW-01.json?auth={ID_TOKEN}
PATCH {DATABASE_URL}/tumbara/gateways/GW-01.json?auth={ID_TOKEN}
PUT   {DATABASE_URL}/tumbara/monitoring/FARM-01-K01/SNS-0101.json?auth={ID_TOKEN}
PUT   {DATABASE_URL}/tumbara/history/FARM-01-K01/2026-10-09/{RECORD_ID}.json?auth={ID_TOKEN}
```

### Langkah 1 — Ambil config

Setelah Auth berhasil dan owner menyetujui pemetaan UID, baca `gatewayConfigs/GW-01`. Validasi:

- `farmId` pada config harus cocok dengan `tumbara/gateways/GW-01/farmId`.
- `configVersion` harus angka dan tidak lebih kecil dari versi aktif lokal.
- Setiap sensor punya `kumbungId`, `enabled`, dan alamat hardware yang valid untuk adapter terpilih.
- Kumbung seluruh sensor harus berada di farm `FARM-01`.

Untuk simulasi awal, polling konfigurasi setiap 30–60 detik cukup. Ketika versi berubah, simpan versi yang sedang diproses, konfigurasi baru diterapkan idempoten, kemudian PATCH `appliedConfigVersion` setelah seluruh proses berhasil. Jika sebagian sensor gagal, jangan akui versi penuh sebagai berhasil; firmware perlu menyimpan status error lokal sampai ada kontrak acknowledgement per sensor.

### Langkah 2 — Tandai gateway online

Setelah koneksi RTDB terautentikasi, gateway PATCH node miliknya:

```json
{
  "status": "online",
  "lastSeenAt": 1791507600000,
  "firmwareVersion": "esp32-gateway-sim/0.1.0"
}
```

Jangan mengubah field `farmId`, `authUid`, atau `configVersion` dari firmware. Metadata itu dikelola aplikasi owner. Untuk prototipe, kirim heartbeat 60 detik sekali; status offline dapat dihitung oleh aplikasi/UI dari `lastSeenAt` yang melewati ambang.

### Langkah 3 — Terapkan sensor dan status

Untuk setiap entry `enabled=true`, panggil sensor adapter. Dalam simulator, adapter menghasilkan nilai tiruan. Pada perangkat nyata, adapter mengubahnya menjadi pembacaan bus. Setelah sensor berhasil dikenali, gateway dapat mengubah `tumbara/sensors/{sensorId}/status` menjadi `active` sesuai Rules saat ini.

Rules saat ini hanya mengizinkan gateway mengubah status sensor menjadi `active`. Jika sensor kemudian tidak terbaca, gateway tidak dapat mengubah katalog menjadi `maintenance` atau `inactive`; tampilkan kondisi stale/error dari telemetry/heartbeat atau tambahkan endpoint trusted dan Rules khusus pada fase implementasi berikutnya.

### Langkah 4 — Normalisasi dan upload latest

Contoh record simulasi untuk `SNS-0101`:

```json
{
  "timestamp": 1791507600000,
  "farmId": "FARM-01",
  "kumbungId": "FARM-01-K01",
  "sensorId": "SNS-0101",
  "gatewayId": "GW-01",
  "schemaVersion": "telemetry-v1",
  "temperature": 27.5,
  "humidity": 82.4,
  "co2": 677,
  "quality": { "status": "valid" }
}
```

Tulis nilai terbaru ke `tumbara/monitoring/FARM-01-K01/SNS-0101`. Setiap payload harus memakai identitas dan lokasi dari config aktif, bukan menerima `farmId`/`kumbungId` tak tervalidasi dari sensor lokal. Sinkronkan jam ESP32 dengan SNTP/NTP sebelum menulis; Rules menerima timestamp paling jauh lima menit ke depan.

### Langkah 5 — Upload history

History menambahkan `bucketStart`, yaitu awal bucket 10 menit yang memuat timestamp:

```text
bucketStart = timestamp - (timestamp mod 600000)
```

Contoh path dan field:

```text
tumbara/history/FARM-01-K01/2026-10-09/SNS-0101_1791507600000
```

```json
{
  "timestamp": 1791507600000,
  "bucketStart": 1791507600000,
  "farmId": "FARM-01",
  "kumbungId": "FARM-01-K01",
  "sensorId": "SNS-0101",
  "gatewayId": "GW-01",
  "schemaVersion": "telemetry-v1",
  "temperature": 27.5,
  "humidity": 82.4,
  "co2": 677,
  "quality": { "status": "valid" }
}
```

`RECORD_ID` harus deterministik dan aman untuk path (misalnya gabungan `sensorId` dan timestamp), supaya retry menggunakan key yang sama. Latest boleh ditimpa data yang lebih baru; history append-only.

**Batasan yang perlu ditutup:** Rules lokal saat ini mengizinkan gateway menulis history tetapi `.read` history hanya diberikan kepada user farm. Karena itu gateway tidak bisa mengecek apakah PUT history dengan key yang sama sebelumnya berhasil jika respons hilang. Sebelum mengandalkan retry offline produksi, tambahkan izin baca history yang dibatasi ke sensor/assignment gateway tersebut atau sediakan endpoint ingestion tepercaya yang memberi acknowledgement idempoten. Jangan menganggap HTTP permission denied selalu berarti record sudah pernah tersimpan.

## 6. Simulasi satu siklus boot

```text
Power on
  ├─ baca gateway_id dan refresh_token dari storage
  ├─ jika belum ada refresh_token: masuk mode provisioning, jangan upload
  ├─ tukar refresh_token → ID token (atau signUp Anonymous Auth saat pairing pertama)
  ├─ sinkronisasi waktu melalui SNTP
  ├─ GET gatewayConfigs/GW-01
  ├─ validasi farmId dan configVersion
  ├─ jalankan adapter untuk SNS-0101 dan SNS-0102
  ├─ PATCH appliedConfigVersion + status online + lastSeenAt
  ├─ setiap interval sampling:
  │    ├─ baca sensor
  │    ├─ normalisasi dan cek rentang nilai
  │    ├─ PUT monitoring/{kumbungId}/{sensorId}
  │    └─ PUT history/{kumbungId}/{tanggal}/{recordId}
  └─ jika jaringan putus: simpan outbox, reconnect dengan exponential backoff+jitter
```

Nilai awal simulasi (bukan standar produksi): sampling 10 detik, heartbeat 60 detik, polling config 30–60 detik, refresh token saat sisa masa ID token kurang dari 5 menit, reconnect mulai 1 detik dan capped 60 detik dengan jitter. Sesuaikan interval dengan daya, kualitas jaringan, kapasitas flash, kebutuhan alert, dan biaya write.

## 7. Simulasi data sensor lokal

Sebelum board sensor tersedia, gunakan adapter tiruan yang menghasilkan nilai berikut setiap 10 detik:

```text
SNS-0101 / FARM-01-K01 / suhu 27.5–28.0 C / RH 81–83 % / CO2 650–700 ppm
SNS-0102 / FARM-01-K02 / suhu 28.0–28.5 C / RH 79–82 % / CO2 680–730 ppm
```

Tambahkan variasi kecil dan timestamp nyata dari clock tersinkron. Tes beberapa skenario: sensor tidak menjawab, nilai di luar rentang Rules, gateway offline, ID token kedaluwarsa, configVersion baru, config farm salah, sensor dipindah, dan gateway berstatus `inactive`. Pastikan Rules menolak payload invalid/cross-farm dan firmware tidak mencoba mengakalinya dengan service account.

## 8. Urutan prototyping sebelum hardware dibeli

1. Buat skrip simulator di komputer yang mengimplementasikan Anonymous Auth REST, refresh token, UID pairing owner, read config, heartbeat, dan telemetry.
2. Jalankan pada Firebase Emulator/staging dengan ID simulasi `GW-01`, lalu uji allow/deny Rules.
3. Buat versi ESP32 yang hanya menguji Wi-Fi + TLS + Auth + refresh token; belum perlu sensor.
4. Tambahkan polling config dan acknowledgement versi.
5. Tambahkan sensor adapter tiruan pada ESP32 untuk menguji loop end-to-end dan kestabilan memori/jaringan.
6. Setelah model sensor/protokol diputuskan, implementasikan adapter bus nyata (misalnya RS-485/Modbus hanya jika memang sesuai perangkat).
7. Uji reboot, listrik putus, Wi-Fi putus, token dicabut, config berubah saat offline, serta antrean penuh.
8. Baru setelah itu lakukan pilot dengan satu ESP32, satu gateway ID, dan satu sensor fisik; lanjutkan ke multi-sensor/multi-kumbung setelah telemetri stabil.

## 9. Checklist keamanan dan operasi

- ESP32 tidak memakai custom token atau service account. UID perangkat dihubungkan ke gateway oleh owner; write tetap dibatasi RTDB Rules.
- ID token hanya di RAM; refresh token disimpan di storage terlindungi dan dapat dihapus saat revoke/reset.
- Jangan mencatat token pada Serial, log RTDB, crash dump, atau analytics.
- Gunakan TLS dengan validasi sertifikat; jangan matikan certificate verification.
- API key tidak dipakai untuk otorisasi; seluruh write/read dibatasi Firebase Auth dan RTDB Rules.
- Firmware menolak config dengan farm/gateway tidak cocok dan tidak mengubah assignment berdasarkan payload sensor.
- Tambahkan Secure Boot dan Flash Encryption bila model ESP32 dan proses produksi mendukung; pertimbangkan anti-rollback dan akses debug pada tahap provisioning pabrik.
- Owner mencabut gateway dari aplikasi dengan mengubah status `inactive` dan menghapus mapping UID; gateway tidak boleh bisa menghidupkan dirinya lagi.
- Jangan log semua nilai/token pada interval tinggi; batasi heartbeat dan antrean agar flash tidak cepat aus.

## 10. Referensi resmi

- [Firebase Anonymous Authentication](https://firebase.google.com/docs/auth/web/anonymous-auth): membuat akun sementara tanpa server aplikasi khusus. [Firebase Auth REST API](https://firebase.google.com/docs/reference/rest/auth) menjelaskan endpoint `accounts:signUp` dan refresh token.

- [Firebase RTDB REST authentication](https://firebase.google.com/docs/database/rest/auth): gunakan Firebase ID token melalui parameter `auth` pada request RTDB REST.
- [Firebase RTDB REST saving data](https://firebase.google.com/docs/database/rest/save-data): bentuk request write/update RTDB.