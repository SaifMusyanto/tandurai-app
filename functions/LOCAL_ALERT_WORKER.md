# Worker Alert Telegram Lokal

Worker ini menggantikan Firebase Cloud Functions untuk notifikasi sensor. Proses berjalan di laptop, memantau `tumbara/monitoring/{kumbungId}/{sensorId}`, menulis status ke `tumbara/alerts/{farmId}/{sensorId}_{jenis}`, dan mengirim Telegram ketika threshold terlewati.

Alert disimpan **per farm**. `farmId` dibaca dari `tumbara/kumbungs/{DEFAULT_KUMBUNG_ID}/farmId` saat alert pertama ditulis; cooldown Telegram disimpan di `tumbara/notif_cooldown/{farmId}/{sensorId}_{jenis}_{severity}`. Anggota farm dapat membaca alert farm-nya, dan browser anggota menulis alert yang sama sebagai fallback bila worker tidak berjalan. `functions/index.js` (Cloud Functions legacy `sensor1`) belum dimigrasikan dan masih menulis struktur lama.

Tidak diperlukan paket Firebase Blaze. Laptop harus menyala, terhubung internet, dan proses worker harus tetap berjalan.

## 1. Siapkan service account Firebase

1. Buka Firebase Console untuk project `tandurai-ai`.
2. Pilih **Project settings** → **Service accounts**.
3. Klik **Generate new private key** dan konfirmasi.
4. Buat folder `functions/credentials`.
5. Simpan file hasil unduhan sebagai:

   `functions/credentials/firebase-admin.json`

Folder dan pola nama credential tersebut sudah diabaikan Git. Jangan mengirim file JSON ini dan jangan memasukkannya ke commit karena credential memiliki akses administratif ke database.

## 2. Lengkapi `.env`

File `functions/.env` yang ada sudah berisi konfigurasi Telegram. Jangan menimpa token yang sudah valid. URL database dan path credential di bawah sudah menjadi default worker, sehingga langkah wajibnya hanya meletakkan service account pada path standar. Variabel berikut dapat ditambahkan jika ingin mengubah konfigurasi:

```dotenv
FIREBASE_DATABASE_URL=https://tandurai-ai-default-rtdb.asia-southeast1.firebasedatabase.app
FIREBASE_CREDENTIALS_PATH=credentials/firebase-admin.json
DEFAULT_KUMBUNG_ID=FARM-01-K01
DEFAULT_SENSOR_ID=SNS-0101
MONITOR_LEGACY_SENSOR=false
TELEGRAM_COOLDOWN_SECONDS=600
ALERT_LOCATION=Tandurai Smart Farm — Sidoarjo
TEMPERATURE_WARNING=30
TEMPERATURE_CRITICAL=33
HUMIDITY_WARNING=70
HUMIDITY_CRITICAL=60
CO2_WARNING=800
CO2_CRITICAL=1200
OFFLINE_AFTER_SECONDS=30
```

Template lengkap tersedia di `.env.example`.

## 3. Instal dan uji

Jalankan PowerShell dari folder `jamur/functions`:

```powershell
npm install
npm run test:alerts
npm run alerts:validate
npm run alerts:test-telegram
npm run alerts:once
```

- `test:alerts` menguji threshold, cooldown, critical escalation, dan recovery tanpa mengakses Firebase.
- `alerts:validate` memeriksa konfigurasi worker tanpa membuka koneksi Firebase atau mengirim Telegram.
- `alerts:test-telegram` memvalidasi bot/chat dan mengirim satu pesan uji.
- `alerts:once` membaca telemetry terbaru, memperbarui alert, kemudian keluar.

Untuk memindahkan tujuan ke akun Telegram lain, tekan **Start** pada `@Tanduraibot`, kirim kode unik, lalu jalankan:

```powershell
npm run alerts:bind-chat -- TANDURAI_SETUP
```

Perintah tersebut mencari pesan kode terbaru, memperbarui `TELEGRAM_CHAT_ID` di `.env`, dan mengirim konfirmasi ke akun baru tanpa menampilkan numeric chat ID.

## 4. Jalankan terus-menerus

```powershell
npm run alerts:local
```

Output normal akan menampilkan path sensor dan setiap telemetry yang diproses. Tekan `Ctrl+C` untuk menghentikan worker secara bersih.

Worker melakukan hal berikut:

- suhu di atas 30°C menghasilkan warning dan di atas 33°C menghasilkan critical;
- kelembapan di bawah 70% menghasilkan warning dan di bawah 60% menghasilkan critical;
- CO₂ di atas 800 ppm menghasilkan warning dan di atas 1200 ppm menghasilkan critical;
- pesan aktif dapat diulang setelah cooldown 10 menit;
- perubahan warning menjadi critical dapat langsung dikirim karena memiliki cooldown terpisah;
- sensor tanpa pembaruan selama 30 detik menghasilkan alert perangkat offline;
- status dan heartbeat worker ditulis ke `tumbara/system/localAlertWorker`.

## Troubleshooting

- `Service account tidak ditemukan`: pastikan nama/path JSON sesuai `FIREBASE_CREDENTIALS_PATH`.
- `PERMISSION_DENIED`: pastikan service account berasal dari project `tandurai-ai`.
- `Telemetry tidak ditemukan`: periksa `DEFAULT_KUMBUNG_ID` dan `DEFAULT_SENSOR_ID`.
- `Telegram API 401`: token bot salah atau sudah dicabut.
- `Telegram API 400 chat not found`: buka chat bot, tekan **Start**, lalu pastikan `TELEGRAM_CHAT_ID` benar.
- Alert offline terlalu cepat: sesuaikan `OFFLINE_AFTER_SECONDS` dengan interval kirim ESP32.
