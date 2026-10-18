# Panduan Integrasi Hardware Tandurai

Untuk **admin backend** (yang menjalankan broker) dan **tim hardware/firmware**. Detail protokol: [`KONTRAK_MQTT_GATEWAY.md`](KONTRAK_MQTT_GATEWAY.md). Firmware referensi: [`../firmware/tandurai-gateway/`](../firmware/tandurai-gateway/). Deploy server produksi: [`PANDUAN_DEPLOY.md`](PANDUAN_DEPLOY.md).

```
ESP32 gateway ──MQTT──▶ Broker Tandurai ──▶ Backend (apps/api) ──▶ PostgreSQL ──▶ Dashboard
   (sensor + relay)      (auth dari tabel devices)
```

Jadwal & aturan otomatis **disimpan di NVS dan dijalankan ESP32 sendiri**; cloud hanya mengirim konfigurasi dan perintah manual.

## Pembagian tanggung jawab

| Tim software (kita) | Tim hardware |
|---|---|
| Broker MQTT, backend, database, dashboard | Rangkaian sensor & relay |
| Kontrak MQTT (`KONTRAK_MQTT_GATEWAY.md`) | Firmware yang memenuhi kontrak — **ditulis sekali** untuk semua unit |
| Registrasi perangkat (hwUid, secret, kode klaim) | Mengisi kredensial tiap unit ke NVS (lewat halaman setup) |
| Simulator + alat cek perangkat untuk verifikasi | Menjalankan alat cek sampai semua ✔ |

**Menambah gateway baru tidak perlu menulis kode lagi.** Firmware yang sama di-flash ke semua unit; tiap unit hanya diberi kredensialnya sendiri.

## Ringkasan alur (5 langkah)

| # | Siapa | Langkah | Hasil |
|---|---|---|---|
| 1 | Admin backend | Jalankan broker + backend (sekali) | `mqtt://<host>:1883` siap |
| 2 | Admin backend | `npm run factory … --count N --out-dir provisioning` | `<hwUid>.json` per perangkat + `labels.csv` |
| 3 | Tim hardware | Flash firmware yang sama → isi Wi-Fi + isi `<hwUid>.json` di halaman setup | perangkat login ke broker |
| 4 | Tim hardware | `npm run device:check … --hw-uid <hwUid>` | ✔/✖ per pesan sesuai kontrak |
| 5 | Owner farm | Dashboard → Devices → Tambah gateway (UID + kode klaim) | sensor/aktuator muncul, kontrol aktif |

Semua perintah `npm` dijalankan dari folder `jamur`.

## 1. Admin backend: broker + backend

Broker yang disarankan adalah **broker Tandurai** (`apps/api/tools/broker.mjs`): login perangkat dicek langsung ke tabel `devices`, sehingga perangkat yang baru didaftarkan **langsung bisa tersambung** tanpa mengubah file password broker.

1. `apps/api/.env` (salin dari `.env.example`): isi `DATABASE_URL`, `MQTT_PASSWORD` (acak, panjang), `AUTH_MODE=firebase`.
2. Jalankan (dua proses; di server gunakan systemd/PM2 agar restart otomatis):
   ```bash
   npm run api:broker     # broker MQTT, port 1883 (atau MQTT_BROKER_PORT)
   npm run api:start      # backend, port 8787
   ```
3. Buka port **1883** di firewall untuk jaringan perangkat. Bila perangkat terhubung lewat internet, pakai TLS:
   `MQTT_TLS_CERT=/path/fullchain.pem MQTT_TLS_KEY=/path/privkey.pem` → broker juga membuka **8883**; tutup 1883 dari internet.
4. Log broker menjelaskan setiap penolakan, mis. `ditolak TDR-…: device secret salah`, `clientId harus sama dengan username`, `hwUid belum didaftarkan`.

> Alternatif Mosquitto (`apps/api/deploy/`): setiap perangkat baru harus ditambahkan manual dengan `mosquitto_passwd` lalu reload broker. Pakai bila butuh broker yang sudah ada.

## 2. Admin backend: daftarkan perangkat

**Lewat dashboard (disarankan):** menu **Registrasi Perangkat** (hanya untuk email di `ADMIN_EMAILS` pada `apps/api/.env`) → isi jumlah → **Daftarkan** → unduh *file setup* (.json, rahasia, untuk tim hardware) dan *label* (.csv). Alamat broker yang diisi ke gateway diambil dari `MQTT_PUBLIC_HOST`/`MQTT_PUBLIC_PORT`/`MQTT_PUBLIC_TLS`: saat uji di jaringan lokal = IP LAN komputer broker (`ipconfig`), saat produksi = IP publik/domain server. Jangan `localhost` — gateway tidak bisa menjangkaunya.

**Lewat terminal (alternatif):**

```bash
npm run factory -w apps/api -- --count 5 --out-dir ../../provisioning --host <IP-atau-domain-broker> [--port 1883] [--tls]
```

Hasil di `jamur/provisioning/` (sudah di-.gitignore — **berisi rahasia**):

| File | Untuk | Catatan |
|---|---|---|
| `<hwUid>.json` | tim hardware → halaman setup gateway (atau tool flash NVS mereka) | hwUid, device secret, host/port/TLS broker |
| `labels.csv` | cetak label/QR di perangkat | **hwUid + kode klaim** saja (tanpa secret) |

Device secret hanya muncul sekali (yang tersimpan di database hanya hash). Bila hilang: daftarkan ulang perangkat dengan hwUid baru.

## 3. Tim hardware: firmware & setup unit

**Sekali saja (membuat firmware):** penuhi kontrak MQTT. Titik awal: `firmware/tandurai-gateway/tandurai-gateway.ino` (**belum dikompilasi/diuji di hardware**).
1. Arduino IDE + board ESP32; library **MQTT** (Joel Gaehwiler / 256dpi) dan **ArduinoJson v7**.
2. Sesuaikan bagian **HARDWARE**: daftar sensor (`S1`, `S2`, … — tiap sensor selalu membaca suhu, kelembapan, CO₂), aktuator (`A1`… + pin relay, `maxRunSec`), dan isi `readSensor()` dengan driver sensor asli.
3. Yang sudah ditangani sketch: login MQTT (clientId = username = hwUid), LWT, register/status/state/telemetry, perintah manual + ACK + anti-duplikat, config di NVS + ACK, jadwal & aturan otomatis lokal, override manual, relay OFF saat boot, batas `maxRunSec`.

**Tiap unit baru (tanpa koding):**
1. Flash firmware yang sama.
2. Gateway pertama kali menyala → membuka Wi-Fi **`Tandurai-Setup-XXXX`**. Sambungkan HP, buka `http://192.168.4.1`.
3. Isi Wi-Fi lokasi + `hwUid`, `deviceSecret`, host/port broker dari `<hwUid>.json` → Simpan. Gateway restart dan tersambung.
4. Ganti Wi-Fi/broker nanti: tahan tombol **BOOT** 3 dtk saat menyalakan → halaman setup terbuka lagi.

Tim hardware boleh memakai cara lain untuk mengisi NVS (serial, QR, tool sendiri) selama nilainya sama.

Aturan penting (detail di kontrak):
- Waktu dalam **epoch milidetik** dari SNTP; sebelum jam sinkron, command ditolak `no_clock`.
- Sensor yang gagal dibaca **tidak dikirim** (jangan kirim 0).
- Jangan pakai `delay()` di jalur relay; relay harus mati tepat waktu walau Wi-Fi putus.

### Kenapa jadwal & aturan di NVS?

Supaya aktuator merespons **langsung tanpa jeda internet** dan **tetap berjalan saat Wi-Fi/server mati** (mis. sprayer tetap menyala saat kelembapan turun walau internet putus). Konsekuensinya firmware memuat mesin jadwal/aturan — tetapi itu ditulis **sekali**, bukan per unit.

## 4. Tim hardware: cek perangkat

```bash
npm run device:check -w apps/api -- --hw-uid TDR-XXXXXXXXXXXX --seconds 120
```

Menampilkan status perangkat di database (terdaftar, register terakhir, online, diklaim, nilai sensor) lalu memvalidasi **setiap pesan MQTT live** terhadap kontrak:

```
11.17.58 telemetry
  · S1: temperature=27.2 humidity=54.9 co2=884
  ✖ S2: dibuang humidity (bukan metrik sensor ini atau di luar rentang)
```

Restart perangkat saat alat berjalan untuk melihat pesan `register`.

## 5. Owner farm: klaim

Dashboard → **Devices** → **Tambah gateway** → UID + kode klaim dari label → pilih kumbung → klaim. Backend mengirim config pertama; perangkat ACK; sensor/aktuator tampil, kontrol di halaman **Kontrol & Otomasi**.

## Pemecahan masalah

| Gejala | Penyebab umum | Cek |
|---|---|---|
| Tidak ada pesan sama sekali | Wi-Fi, host/port broker salah, firewall | log broker; ping host dari jaringan perangkat |
| Log broker: `device secret salah` | secret salah ketik / dari unit lain | buka halaman setup (tahan BOOT 3 dtk), isi ulang dari `<hwUid>.json` |
| Log broker: `clientId … harus sama dengan username` | clientId acak/default library | clientId = hwUid |
| Log broker: `publish ditolak ACL` | topic salah ketik / hwUid lain | topic `tandurai/gw/<hwUid>/<jenis>` |
| `device:check`: `ts … dalam detik` / selisih waktu | SNTP belum jalan atau kirim detik | `configTime` + epoch **ms** |
| `entri ditolak` saat register | id bukan `[A-Za-z0-9_]`, metric/type tidak dikenal | tabel nilai di kontrak §3.1 |
| Telemetry diterima tapi tidak tersimpan | gateway belum diklaim | klaim di dashboard |
| Dashboard "Pending sync" terus | perangkat tidak mengirim `ack` config | `device:check` saat menyimpan jadwal/aturan |
| Command "Gagal: gateway offline" | perangkat offline saat perintah dibuat | normal; command kedaluwarsa 30 dtk & tidak dieksekusi |

## Uji tanpa hardware

Simulator berperilaku sama dengan firmware referensi:

```bash
npm run factory -w apps/api -- --out apps/api/.sim/gw1.device.json
node apps/api/tools/mqtt-gateway-sim.mjs --device apps/api/.sim/gw1.device.json
```
