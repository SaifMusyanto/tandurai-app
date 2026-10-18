# Panduan Deploy Tandurai ke Server + Integrasi Hardware

Dari server kosong sampai gateway ESP32 mengirim data ke dashboard. Contoh memakai **Ubuntu 24.04** dan domain `tandurai.id`; ganti dengan milik Anda.

| Alamat | Untuk |
|---|---|
| `https://dashboard.tandurai.id` | dashboard web + API (`/api`) |
| `mqtts://mqtt.tandurai.id:8883` | broker MQTT untuk gateway (TLS) |

> Semua nilai rahasia di panduan ini ditulis `<…>`. Jangan menyalin rahasia ke chat, repo, atau `VITE_*`.

---

## 0. Gambaran sistem

```
ESP32 gateway ──MQTT TLS 8883──▶ Broker Tandurai ──1883 (lokal)──▶ Backend apps/api :8787 ──▶ PostgreSQL
                                                                     ▲   │ REST + SSE
                                 AI worker (Python) ──API token──────┘   ▼
                                                     Nginx (HTTPS 443) ──▶ Dashboard (file statis)
```

| Komponen | Folder | Proses di server |
|---|---|---|
| Broker MQTT | `apps/api/tools/broker.mjs` | systemd `tandurai-broker` |
| Backend | `apps/api` | systemd `tandurai-api` |
| Dashboard | `apps/web` → `dist/apps/web` | file statis lewat Nginx |
| AI worker | `local_ai_worker` + folder model `Modul AI Aitoma` | systemd `tandurai-worker` |
| Database | PostgreSQL 16 | layanan bawaan |

**Spesifikasi minimum:** 2 vCPU, 4 GB RAM, 40 GB SSD.

**Port yang dibuka ke internet** hanya 22 (SSH), 80/443 (web), dan 8883 (MQTT TLS). Port 1883, 8787, dan 5432 cukup untuk lokal.

---

## 1. DNS

Di pengelola domain, buat dua record **A** ke IP publik server:

```
dashboard.tandurai.id   A   <IP_SERVER>
mqtt.tandurai.id        A   <IP_SERVER>
```

Tunggu sampai `ping dashboard.tandurai.id` menjawab dari IP server.

---

## 2. Siapkan server

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx certbot python3-certbot-nginx postgresql ufw build-essential \
                    python3 python3-venv     # Python 3.12 di Ubuntu 24.04
# Node.js 22 (wajib ≥ 22)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v22.x

# User khusus aplikasi
sudo adduser --system --group --home /opt/tandurai tandurai

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw allow 8883/tcp
sudo ufw enable
```

> Worker butuh **Python 3.11–3.13**, karena scikit-learn 1.8.0 butuh ≥ 3.11. Python 3.12 bawaan Ubuntu 24.04 sudah cukup: pakai `python3 -m venv`. Paket `python3.11` tidak perlu dipasang.

---

## 3. Ambil kode & folder model

```bash
sudo -u tandurai -H bash
cd /opt/tandurai
git clone <URL_REPO> app            # repo berisi folder jamur/
cd app/jamur
npm ci                              # dependency semua workspace (apps/api, apps/web)
exit
```

Folder model **`Modul AI Aitoma` tidak ada di repo**. Salin dari laptop ke `/opt/tandurai/Modul AI Aitoma`. Contoh dari laptop Windows (PowerShell, OpenSSH):

```powershell
scp -r "E:\FOLDER_SAIF\Magang Aitoma\Devs\Tandurai Web App\Modul AI Aitoma" user@<IP_SERVER>:/tmp/
```

lalu di server:

```bash
sudo mv "/tmp/Modul AI Aitoma" /opt/tandurai/ && sudo chown -R tandurai:tandurai "/opt/tandurai/Modul AI Aitoma"
```

---

## 4. Database

```bash
sudo -u postgres psql -c "CREATE USER tandurai WITH PASSWORD '<PASSWORD_DB>';"
sudo -u postgres psql -c "CREATE DATABASE tandurai_iot OWNER tandurai;"
```

Tabel dibuat otomatis oleh **migration** saat backend pertama kali jalan. Bisa juga dijalankan manual dengan `npm run migrate -w apps/api`.

---

## 5. Sertifikat HTTPS & MQTT TLS (Let's Encrypt)

Satu sertifikat untuk kedua nama:

```bash
sudo certbot certonly --nginx -d dashboard.tandurai.id -d mqtt.tandurai.id
```

Broker berjalan sebagai user `tandurai`, sedangkan file di `/etc/letsencrypt` hanya bisa dibaca root. Karena itu sertifikat disalin ke folder aplikasi setiap kali diperbarui:

```bash
sudo mkdir -p /etc/tandurai/certs
sudo tee /etc/letsencrypt/renewal-hooks/deploy/tandurai-mqtt.sh > /dev/null <<'EOF'
#!/bin/sh
cp /etc/letsencrypt/live/dashboard.tandurai.id/fullchain.pem /etc/tandurai/certs/fullchain.pem
cp /etc/letsencrypt/live/dashboard.tandurai.id/privkey.pem   /etc/tandurai/certs/privkey.pem
chown tandurai:tandurai /etc/tandurai/certs/*.pem && chmod 600 /etc/tandurai/certs/privkey.pem
systemctl restart tandurai-broker 2>/dev/null || true
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/tandurai-mqtt.sh
sudo /etc/letsencrypt/renewal-hooks/deploy/tandurai-mqtt.sh
```

---

## 6. Konfigurasi backend: `apps/api/.env`

Buat rahasia acak, lalu simpan hasilnya. Jalankan perintahnya dua kali untuk dua nilai berbeda:

```bash
openssl rand -hex 32   # → MQTT_PASSWORD
openssl rand -hex 32   # → WORKER_TOKEN
```

`/opt/tandurai/app/jamur/apps/api/.env` (pemilik `tandurai`, `chmod 600`):

```ini
NODE_ENV=production
PORT=8787
DATABASE_URL=postgres://tandurai:<PASSWORD_DB>@127.0.0.1:5432/tandurai_iot

# Backend ⇄ broker (lokal, tanpa TLS)
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USERNAME=tandurai-backend
MQTT_PASSWORD=<MQTT_PASSWORD>
MQTT_CLIENT_ID=tandurai-backend

# Broker: TLS untuk gateway lewat internet
MQTT_TLS_CERT=/etc/tandurai/certs/fullchain.pem
MQTT_TLS_KEY=/etc/tandurai/certs/privkey.pem
MQTT_TLS_PORT=8883

# Alamat broker yang ditulis ke file setup gateway
MQTT_PUBLIC_HOST=mqtt.tandurai.id
MQTT_PUBLIC_PORT=8883
MQTT_PUBLIC_TLS=true

# Login dashboard (wajib firebase di production)
AUTH_MODE=firebase
FIREBASE_PROJECT_ID=<ID_PROJECT_FIREBASE>
CORS_ORIGINS=https://dashboard.tandurai.id

# Admin Tandurai (boleh membuka Registrasi Perangkat)
ADMIN_EMAILS=<email-admin-1>,<email-admin-2>

# AI worker
WORKER_TOKEN=<WORKER_TOKEN>

# Perilaku (boleh dibiarkan bawaan)
HISTORY_RETENTION_DAYS=180
OFFLINE_AFTER_SEC=180
```

> Backend menolak start bila `NODE_ENV=production` tetapi `AUTH_MODE` bukan `firebase`. Broker memberi peringatan bila `MQTT_PASSWORD` kosong. **Wajib diisi**, karena tanpa itu siapa pun bisa login sebagai backend.

---

## 7. Layanan systemd (broker, backend)

`/etc/systemd/system/tandurai-broker.service`:

```ini
[Unit]
Description=Tandurai MQTT broker
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=tandurai
WorkingDirectory=/opt/tandurai/app/jamur
ExecStart=/usr/bin/node apps/api/tools/broker.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/tandurai-api.service`:

```ini
[Unit]
Description=Tandurai backend API
After=network-online.target postgresql.service tandurai-broker.service
Wants=network-online.target

[Service]
User=tandurai
WorkingDirectory=/opt/tandurai/app/jamur
ExecStart=/usr/bin/node apps/api/src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tandurai-broker tandurai-api
journalctl -u tandurai-broker -n 20   # "[broker] MQTT Tandurai di port 1883 dan TLS 8883"
journalctl -u tandurai-api -n 20      # migration + "[mqtt] tersambung"
curl -s http://127.0.0.1:8787/api/health   # {"ok":true,"db":true,"mqtt":true,...}
```

Kedua file `.env` dibaca dari `apps/api/.env`, jadi tidak perlu `EnvironmentFile`.

---

## 8. Dashboard web

`/opt/tandurai/app/jamur/apps/web/.env.production`:

```ini
VITE_FIREBASE_API_KEY=<…>
VITE_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<ID_PROJECT_FIREBASE>
VITE_FIREBASE_STORAGE_BUCKET=<…>
VITE_FIREBASE_MESSAGING_SENDER_ID=<…>
VITE_FIREBASE_APP_ID=<…>
VITE_API_URL=https://dashboard.tandurai.id/api
```

> Nilai `VITE_FIREBASE_*` memang publik, karena ikut terkirim ke browser. **Jangan** taruh token, password, atau secret apa pun di `VITE_*`.

```bash
sudo -u tandurai -H bash -c "cd /opt/tandurai/app/jamur && npm run build"
# hasil: /opt/tandurai/app/jamur/dist/apps/web
```

**Firebase Console** → Authentication:
- **Settings → Authorized domains**: tambahkan `dashboard.tandurai.id`.
- **Sign-in method**: pastikan Google dan Email/Password aktif.

---

## 9. Nginx

`/etc/nginx/sites-available/tandurai`:

```nginx
server {
  listen 80;
  server_name dashboard.tandurai.id;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name dashboard.tandurai.id;
  ssl_certificate     /etc/letsencrypt/live/dashboard.tandurai.id/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/dashboard.tandurai.id/privkey.pem;

  root /opt/tandurai/app/jamur/dist/apps/web;
  index index.html;

  # Realtime (SSE). Token login ada di query string → jangan dicatat di access log.
  location /api/stream {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    access_log off;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 4m;
  }

  # SPA: semua route dashboard → index.html
  location / {
    try_files $uri $uri/ /index.html;
  }

  location /assets/ {
    expires 30d;
    add_header Cache-Control "public, immutable";
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/tandurai /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Buka `https://dashboard.tandurai.id`, lalu login dengan email yang ada di `ADMIN_EMAILS`.

---

## 10. AI worker

```bash
sudo -u tandurai -H bash
cd /opt/tandurai/app/jamur/local_ai_worker
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -e .          # scikit-learn harus 1.8.0 (dikunci di requirements)
exit
```

`local_ai_worker/.env` (pemilik `tandurai`, `chmod 600`):

```ini
DATA_SOURCE=api
BACKEND_URL=http://127.0.0.1:8787/api
WORKER_TOKEN=<WORKER_TOKEN>            # sama persis dengan apps/api/.env
MODEL_MODULE_PATH="/opt/tandurai/Modul AI Aitoma"
TIMEZONE=Asia/Jakarta
WORKER_LOG_DIR=runtime/logs
WORKER_STATE_DIR=runtime/state
```

Cek dulu dengan `sudo -u tandurai /opt/tandurai/app/jamur/local_ai_worker/.venv/bin/python -m worker health`. Hasilnya harus `"errors": []`.

`/etc/systemd/system/tandurai-worker.service`:

```ini
[Unit]
Description=Tandurai AI worker
After=tandurai-api.service

[Service]
User=tandurai
WorkingDirectory=/opt/tandurai/app/jamur/local_ai_worker
ExecStart=/opt/tandurai/app/jamur/local_ai_worker/.venv/bin/python -m worker watch --interval 3
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now tandurai-worker
```

---

## 11. Setelah deploy: isi data awal

1. Login dengan email di `ADMIN_EMAILS`. Admin langsung masuk **Konsol Admin** (Ringkasan Sistem, Farm & Klien, Pengguna, Registrasi Perangkat). Farm dibuat oleh akun klien (owner); admin cukup membuka dashboard farm klien dari menu **Farm & Klien** untuk membantu.
2. **Operasional → Atur**: tambah kumbung.
3. **Pengaturan → Notifikasi**:
   - token bot dan chat ID Telegram, lalu **Kirim pesan uji**;
   - ambang alert dan rentang optimal (bawaan sudah sesuai jamur tiram).
4. **Pengaturan → Umum → Lokasi Ramalan Cuaca.**
5. **Anggota Farm**: tambahkan operator. Mereka harus sudah login sekali dan emailnya terverifikasi.
6. Opsional: **Laporan → Tambah jadwal** untuk rekap otomatis ke Telegram.

---

## 12. Integrasi hardware

### 12.1 Daftarkan perangkat (admin, sekali per unit)

**Lewat dashboard:** menu **Registrasi Perangkat** (hanya email di `ADMIN_EMAILS`) → jumlah unit → **Daftarkan**. Hasil untuk setiap unit:

| Data | Ke siapa | Catatan |
|---|---|---|
| `hwUid` (mis. `TDR-A1B2C3D4E5F6`) | label perangkat + tim hardware | ID unik |
| `deviceSecret` | **hanya** tim hardware (diisi ke NVS) | muncul **sekali**; database hanya menyimpan hash |
| kode klaim (mis. `K7Q2-M9XD`) | label perangkat (untuk owner farm) | dipakai saat klaim |
| file setup `.json` | tim hardware | berisi hwUid, secret, host/port/TLS broker |

**Lewat server (banyak unit sekaligus):**

```bash
sudo -u tandurai -H bash -c "cd /opt/tandurai/app/jamur && npm run factory -w apps/api -- --count 20 --out-dir /opt/tandurai/provisioning"
# → /opt/tandurai/provisioning/<hwUid>.json (rahasia) + labels.csv (hwUid + kode klaim, untuk cetak label/QR)
```

Simpan file `<hwUid>.json` di tempat aman. Kalau secret hilang, daftarkan ulang dengan hwUid baru.

### 12.2 Siapkan firmware (tim hardware)

Firmware referensi: `firmware/tandurai-gateway/tandurai-gateway.ino` (ESP32, library **arduino-mqtt** + **ArduinoJson v7**).

1. **CA certificate untuk TLS.** Broker memakai sertifikat Let's Encrypt, jadi ESP32 perlu root CA **ISRG Root X1**. Buat `ca_cert.h` di folder sketch:
   ```cpp
   #define TANDURAI_CA_CERT "-----BEGIN CERTIFICATE-----\n" \
   "...isi https://letsencrypt.org/certs/isrgrootx1.pem baris per baris...\n" \
   "-----END CERTIFICATE-----\n"
   ```
2. Sesuaikan daftar perangkat di bagian `HARDWARE (sesuaikan)`: sensor (`S1`, `S2`, …) dan relay aktuator (ID, jenis, pin, `maxRunSec`).
3. Compile lalu flash. **Satu firmware untuk semua unit**; identitas tiap unit diisi lewat halaman setup.

> Firmware ini masih referensi dan **belum diuji di hardware fisik**. Perilaku acuannya adalah simulator `apps/api/tools/mqtt-gateway-sim.mjs`, yang lulus uji e2e backend.

### 12.3 Isi identitas unit (halaman setup)

1. Nyalakan ESP32. Pada boot pertama, atau dengan **tombol BOOT ditahan 3 detik** saat dinyalakan, gateway membuka Wi-Fi **`Tandurai-Setup-XXXX`**.
2. Sambungkan HP/laptop ke Wi-Fi itu, lalu buka **http://192.168.4.1**.
3. Isi dari file `<hwUid>.json`:

| Kolom | Isi |
|---|---|
| Wi-Fi SSID / password | Wi-Fi lokasi kumbung (2,4 GHz) |
| hwUid | `TDR-…` |
| Device secret | `deviceSecret` |
| Broker host | `mqtt.tandurai.id` |
| Port | `8883` |
| TLS | ✔ dicentang |

4. Simpan. Gateway restart lalu tersambung ke broker. Data ini tersimpan di NVS (`tdr-creds`).

### 12.4 Info broker MQTT untuk firmware

**Koneksi**

| Parameter | Nilai |
|---|---|
| Host / port | `mqtt.tandurai.id` : **8883** (TLS, validasi sertifikat dengan ISRG Root X1) |
| Protokol | MQTT 3.1.1 |
| Client ID | **= hwUid** (wajib sama dengan username) |
| Username / password | `hwUid` / `deviceSecret` |
| Clean session | `false` |
| Keepalive | 15–30 detik |
| Last Will | topic `tandurai/gw/{hwUid}/status`, payload `{"online":false}`, QoS 1, **retained** |

**Topic yang di-*subscribe* gateway (QoS 1)**

| Topic | Isi |
|---|---|
| `tandurai/gw/{hwUid}/cmd` | perintah manual dari dashboard (`on`/`off`/`estop`, berlaku sampai `expiresAt`) |
| `tandurai/gw/{hwUid}/config` | mode, jadwal, dan aturan otomatis (**retained**; versi terbaru langsung diterima saat subscribe) |

**Topic yang di-*publish* gateway**

| Topic | QoS | Retain | Kapan |
|---|---|---|---|
| `tandurai/gw/{hwUid}/register` | 1 | – | setiap tersambung (daftar sensor & aktuator) |
| `tandurai/gw/{hwUid}/status` | 1 | ✔ | setiap tersambung + tiap 60 detik |
| `tandurai/gw/{hwUid}/telemetry` | 0 | – | tiap 10 detik: `{"ts":…, "readings":{"S1":{"temperature":…,"humidity":…,"co2":…}}}` |
| `tandurai/gw/{hwUid}/state` | 1 | – | saat relay berubah |
| `tandurai/gw/{hwUid}/ack` | 1 | – | setelah memproses `cmd` / `config` |

**Urutan setelah tersambung:**
1. Subscribe `cmd` dan `config`.
2. Publish `register`.
3. Publish `status` (retained).
4. Publish `state`.
5. Kirim telemetry pertama.

Broker menolak gateway yang publish/subscribe ke topic `hwUid` lain (ACL). Format payload lengkap dan aturan eksekusi ada di [`KONTRAK_MQTT_GATEWAY.md`](KONTRAK_MQTT_GATEWAY.md).

### 12.5 Cek gateway sudah benar

Di server:

```bash
sudo -u tandurai -H bash -c "cd /opt/tandurai/app/jamur && npm run device:check -w apps/api -- --hw-uid TDR-XXXXXXXXXXXX --seconds 120"
```

Tool ini menampilkan status perangkat di database dan **memvalidasi setiap pesan MQTT live** terhadap kontrak. Restart gateway saat tool berjalan untuk melihat pesan `register`.

Log broker menjelaskan setiap penolakan:

```bash
journalctl -u tandurai-broker -f
# ditolak TDR-…: device secret salah | clientId harus sama dengan username | hwUid belum didaftarkan
```

**Memantau dari laptop (opsional, untuk debug)** memakai `mosquitto_sub` dengan kredensial backend. Client ID **harus berbeda** (`-i`) supaya sesi backend tidak terputus. Akun backend hanya boleh subscribe topic kiriman gateway; wildcard `#` ditolak:

```bash
mosquitto_sub -h mqtt.tandurai.id -p 8883 --capath /etc/ssl/certs \
  -u tandurai-backend -P '<MQTT_PASSWORD>' -i debug-laptop-1 \
  -t 'tandurai/gw/+/telemetry' -t 'tandurai/gw/+/status' -t 'tandurai/gw/+/ack' -v
```

> `MQTT_PASSWORD` adalah kunci utama backend. Lebih aman memakai `device:check` di server daripada membagikannya ke laptop.

### 12.6 Klaim & mulai pakai (owner farm)

1. Dashboard → **Perangkat → Tambah gateway** → isi **hwUid + kode klaim** dari label.
2. Beri nama gateway, sensor, dan aktuator, lalu pilih kumbung masing-masing → **Klaim**.
3. Cek **Monitoring**: data sensor masuk tiap 10 detik, dan histori tersimpan per 10 menit.
4. **Kontrol**: coba manual ON/OFF; status "Mengirim → Berhasil" muncul setelah gateway mengirim ACK. Lalu atur jadwal atau aturan otomatis; aturan disimpan dan dijalankan di gateway (NVS).
5. Sensor atau aktuator baru yang dilaporkan gateway (setelah firmware diperbarui) muncul otomatis sebagai "belum ditempatkan".

---

## 13. Operasional

**Update aplikasi**

```bash
sudo -u tandurai -H bash -c "cd /opt/tandurai/app/jamur && git pull && npm ci && npm run build"
sudo systemctl restart tandurai-api tandurai-broker tandurai-worker
```

Migration database berjalan otomatis saat `tandurai-api` start.

**Backup database harian** (`/etc/cron.d/tandurai-backup`):

```
0 2 * * * postgres pg_dump -Fc tandurai_iot > /var/backups/tandurai_iot_$(date +\%F).dump && find /var/backups -name 'tandurai_iot_*.dump' -mtime +14 -delete
```

Pulihkan dengan `pg_restore -d tandurai_iot <file>.dump`. Simpan juga salinan backup di luar server.

**Hal yang perlu diketahui**
- Broker Tandurai menyimpan antrean QoS1 dan pesan retained **di memori**. Setelah broker restart:
  - gateway tersambung ulang otomatis;
  - backend mengirim ulang config ke gateway yang versinya tertinggal (dari `configVersion` di status);
  - perintah manual yang belum terkirim akan kedaluwarsa, dan hal ini memang disengaja.
- Histori telemetry disimpan `HISTORY_RETENTION_DAYS` hari (bawaan 180).
- Sertifikat diperpanjang otomatis oleh certbot. Hook di langkah 5 menyalin sertifikat baru dan me-restart broker.
- Log semua layanan: `journalctl -u tandurai-api -u tandurai-broker -u tandurai-worker -f`.

---

## 14. Checklist go-live

- [ ] `curl https://dashboard.tandurai.id/api/health` → `"ok":true`
- [ ] Login Google & email berhasil (domain sudah di Authorized domains Firebase)
- [ ] `MQTT_PASSWORD` dan `WORKER_TOKEN` terisi acak; `AUTH_MODE=firebase`; `NODE_ENV=production`
- [ ] Port 1883, 8787, dan 5432 **tidak** terbuka ke internet (`sudo ufw status`)
- [ ] Gateway uji tersambung lewat 8883 TLS dan `device:check` tanpa ✖
- [ ] Klaim, data Monitoring, kontrol manual, dan ACK berhasil
- [ ] Alert uji terkirim ke Telegram
- [ ] AI worker `health` OK, lalu **Perkiraan Panen → Hitung ulang** berhasil
- [ ] Backup harian berjalan (cek `/var/backups`)

## 15. Pemecahan masalah

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| Dashboard putih / 404 saat refresh halaman | `try_files` belum ada | cek blok `location /` Nginx |
| Login gagal "unauthorized-domain" | domain belum diizinkan Firebase | tambah di Authorized domains |
| Data tidak realtime, harus refresh | Nginx mem-buffer SSE | cek blok `location /api/stream` (`proxy_buffering off`) |
| `CORS` error di console | `CORS_ORIGINS` tidak sama persis dengan URL dashboard | samakan (https, tanpa `/` di akhir), restart api |
| `/api/health` → `mqtt:false` | broker mati / `MQTT_PASSWORD` beda | `journalctl -u tandurai-broker`, samakan password |
| Gateway: `device secret salah` | salah ketik di halaman setup | tahan BOOT 3 detik, isi ulang dari `<hwUid>.json` |
| Gateway: `hwUid belum didaftarkan` | unit belum diregistrasi di server ini | daftarkan di Registrasi Perangkat |
| Gateway gagal TLS / tidak pernah tersambung | `ca_cert.h` kosong, jam belum sinkron, atau port 8883 tertutup | isi ISRG Root X1, cek `ufw allow 8883/tcp` |
| Perkiraan panen gagal | worker mati / token beda / folder model tidak ada | `journalctl -u tandurai-worker`, cek `MODEL_MODULE_PATH` & `WORKER_TOKEN` |
