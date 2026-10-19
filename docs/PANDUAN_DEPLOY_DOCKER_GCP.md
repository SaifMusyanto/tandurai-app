# Panduan Deploy Tandurai — VM GCP `aitoma-prod` (Docker + Nginx Proxy Manager)

Tandurai (dashboard, API, broker MQTT, PostgreSQL, AI worker + model) dipasang sebagai satu project Docker Compose di **VM produksi Aitoma yang sudah berjalan** (`aitoma-prod`), berdampingan dengan project lain. VM tidak perlu dibuat baru. Setelah persiapan awal, deploy dan update cukup **satu perintah**:

```bash
sudo bash deploy/deploy.sh
```

> Panduan ini menggantikan cara systemd di [`PANDUAN_DEPLOY.md`](PANDUAN_DEPLOY.md). Bagian integrasi hardware (§12 di sana) tetap berlaku; bedanya hanya cara menjalankan perintah server (lihat [§8](#8-perintah-server)).

---

## 0. Gambaran

Port 80/443 di VM sudah dipegang container **Nginx Proxy Manager** (NPM) yang melayani semua project. Tandurai tidak membuka port 80/443 sendiri; NPM meneruskan domain Tandurai ke container `web` lewat network Docker `shared_network`.

```
                          ┌──────────────────────────── VM aitoma-prod ────────────────────────────────┐
Browser ──HTTPS 443──▶ NPM (TLS dashboard) ──http──▶ web/Caddy ── /api ──▶ api :8787 ──▶ postgres :5432 │
Let's Encrypt ─HTTP 80─▶ NPM ──http──▶ web/Caddy → sertifikat RSA MQTT_DOMAIN     ▲  │ MQTT 1883 (internal)
                          │                 └── caddy-data (volume) ──┐           │  ▼                  │
ESP32 ──MQTTS 8883──────────────────────────────────────────────▶ broker (aedes) ◀┘                    │
                          │                                 worker (Python + ai_model) ──token──▶ api   │
                          └──────────────────── project lain (core, dashboard, cmms, …) ───────────────┘
```

| Container | Isi | Dibangun dari |
|---|---|---|
| `web` | Caddy: file dashboard, reverse proxy `/api`, ambil sertifikat MQTT | `deploy/Dockerfile.web` (build `apps/web`) |
| `api` | backend REST + SSE, migration otomatis | `deploy/Dockerfile.api` |
| `broker` | broker MQTT; TLS 8883 memakai sertifikat dari Caddy | image yang sama dengan `api` |
| `worker` | AI worker + model (`ai_model/`) | `deploy/Dockerfile.worker` |
| `postgres` | PostgreSQL 16 khusus Tandurai | image resmi |

**Port.** Tandurai hanya membuka **8883/tcp** di host. PostgreSQL, API, dan MQTT 1883 Tandurai hanya ada di network internal Docker, jadi tidak bentrok dengan port 1883/5432 yang dibuka NPM untuk project lain.

**Sertifikat.** HTTPS dashboard diurus NPM. Sertifikat `MQTT_DOMAIN` sengaja **tetap diambil Caddy** (NPM hanya meneruskan port 80 domain itu): Caddy dipaksa memakai kunci **RSA** yang berantai ke **ISRG Root X1**, sama dengan CA di firmware ESP32, dan broker membacanya dari volume `caddy-data`.

**Nama.** Di `shared_network` container `web` hanya dikenal sebagai `tandurai-web`, dan Caddy memanggil API lewat `tandurai-api`, sehingga tidak bentrok dengan service `web`/`api` milik project lain. Konfigurasi ini ada di `deploy/docker-compose.npm.yml`, aktif lewat `COMPOSE_FILE` di `deploy/.env`.

**Model AI sudah digabung ke repo.** Folder `ai_model/` berisi salinan runtime dari `Modul AI Aitoma` (±7 MB). Setelah training ulang, jalankan `tools/sync-ai-model.ps1` (lihat `ai_model/README.md`).

---

## 1. Cek kondisi VM (sebelum pasang)

SSH ke VM, lalu:

```bash
# 8883 harus kosong (80/443 memang milik NPM)
sudo ss -tulpn | grep -E ':(80|443|8883)\b'

# Network NPM: harus "shared_network"
sudo docker inspect nginx-proxy-manager --format '{{json .NetworkSettings.Networks}}'

# Nama project / volume "tandurai" belum dipakai
sudo docker compose ls
sudo docker volume ls | grep tandurai

# Kapasitas: RAM, swap, disk, pemakaian project lain
free -h
df -h /
sudo docker stats --no-stream
```

Hasil cek 19-10-2026: 80/443 dipakai `nginx-proxy-manager`, 8883 kosong, network `shared_network`, belum ada project/volume `tandurai`.

### Kebutuhan resource Tandurai

| Container | RAM idle | RAM puncak | Batas (`mem_limit`) | Ukuran image |
|---|---:|---:|---:|---:|
| postgres | ±60 MB | — | 512 MB | ±420 MB |
| api | ±45 MB | — | 512 MB | ±435 MB |
| broker | ±30 MB | — | 384 MB | (sama dengan api) |
| worker | ±100 MB | ±270 MB (model dimuat) | 768 MB | ±740 MB |
| web (Caddy) | ±15 MB | — | 256 MB | ±85 MB |
| **Total** | **±250 MB** | | **±2,4 GB** | **±1,7 GB** |

- Saat **build** (`deploy.sh`), `vite build` dashboard butuh tambahan **±1–1,5 GB RAM sesaat**. Kalau `free -h` menunjukkan RAM tersedia < 2 GB dan swap 0, minta admin VM menambah swap (atau jalankan build di luar jam sibuk), supaya project lain tidak ikut terganggu.
- Disk: siapkan ±3 GB untuk image + build cache, ditambah data telemetry **5–8 MB per sensor** (180 hari) dan backup.

---

## 2. Siapkan repo (di laptop)

Pastikan semua perubahan sudah di-commit dan di-push ke branch **`develop`** (branch yang dipakai VM).

`deploy/.env` dan semua `.env` lain **tidak** ikut ke Git maupun image Docker (`.gitignore` + `.dockerignore`).

---

## 3. DNS & firewall

### DNS

Arahkan dua record **A** ke IP eksternal `aitoma-prod` (cek di Console *Compute Engine → VM instances*, atau `curl -s ifconfig.me` dari VM):

```
dashboard.tandurai.id   A   <IP_aitoma-prod>
mqtt.tandurai.id        A   <IP_aitoma-prod>
```

Tunggu sampai `nslookup mqtt.tandurai.id` menjawab IP tersebut **sebelum §6**, karena Caddy langsung meminta sertifikat saat proxy host dibuat.

### Firewall GCP

Port 80/443 sudah terbuka untuk NPM. Yang perlu ditambah hanya **8883/tcp** untuk MQTT TLS:

```bash
gcloud compute instances list --filter="name~aitoma-prod" --format="table(name,zone,tags.items)"
gcloud compute firewall-rules create tandurai-mqtt --allow=tcp:8883 --target-tags=tandurai-mqtt
gcloud compute instances add-tags aitoma-prod --zone=<zona> --tags=tandurai-mqtt
```

> Lewat Console: **VPC network → Firewall → Create firewall rule**, target tag `tandurai-mqtt`, protokol `tcp:8883`; lalu tambahkan tag itu di VM (*Edit → Network tags*).

---

## 4. Pasang repo & isi `deploy/.env`

Project lain di VM ini ada di `/home/service/<project>`; Tandurai mengikuti pola yang sama. User `info` belum masuk grup `docker`, jadi semua perintah memakai `sudo` dan repo dimiliki root (jangan campur `git` tanpa sudo dengan `sudo bash deploy/deploy.sh`, karena Git menolak repo milik user lain).

```bash
sudo git clone -b develop https://github.com/SaifMusyanto/tandurai-app.git /home/service/tandurai
cd /home/service/tandurai
sudo cp deploy/.env.example deploy/.env
for k in POSTGRES_PASSWORD MQTT_PASSWORD WORKER_TOKEN; do
  sudo sed -i "s/^$k=.*/$k=$(openssl rand -hex 32)/" deploy/.env
done
sudo nano deploy/.env
```

Repo private? Pakai *personal access token* saat `git clone`, atau *deploy key* (SSH key read-only di GitHub → Settings → Deploy keys) milik root.

Yang wajib diisi manual:

| Variabel | Isi |
|---|---|
| `DASHBOARD_DOMAIN`, `MQTT_DOMAIN` | domain dari §3 |
| `ACME_EMAIL` | email untuk Let's Encrypt (sertifikat MQTT) |
| `ADMIN_EMAILS` | email admin Tandurai (pisahkan koma) |
| `VITE_FIREBASE_*` | dari Firebase Console → Project settings → *Your apps* (Web). Nilainya publik |

Biarkan dua baris ini seperti di `.env.example`; keduanya yang membuat Tandurai berjalan di belakang NPM:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.npm.yml
NPM_NETWORK=shared_network
```

`POSTGRES_PASSWORD`, `MQTT_PASSWORD`, dan `WORKER_TOKEN` sudah terisi acak oleh perintah di atas dan dipakai bersama oleh semua container.

Di **Firebase Console → Authentication → Settings → Authorized domains**, tambahkan `dashboard.tandurai.id`.

---

## 5. Deploy

```bash
cd /home/service/tandurai
sudo bash deploy/deploy.sh
```

Skrip ini: `git pull` → build semua image → start/restart container Tandurai → hapus image *dangling* → tunggu API sehat → tampilkan status. Project lain tidak disentuh. Build pertama ±5–10 menit.

Hasil yang diharapkan:

```
NAME                IMAGE                    STATUS
tandurai-api-1      tandurai-api:latest      Up (healthy)
tandurai-broker-1   tandurai-api:latest      Up
tandurai-postgres-1 postgres:16-alpine       Up (healthy)
tandurai-web-1      tandurai-web:latest      Up
tandurai-worker-1   tandurai-worker:latest   Up
health: {"ok":true,"db":true,"mqtt":false,...}
```

`mqtt:false` dan log broker `menunggu sertifikat TLS dari Caddy` masih normal di tahap ini: sertifikat MQTT baru bisa diambil setelah proxy host NPM dibuat (§6).

---

## 6. Proxy Host di Nginx Proxy Manager

Buka panel admin NPM (port admin 81 dipetakan ke host **82**: `http://<IP_aitoma-prod>:82`, atau lewat tunnel SSH bila port itu tidak dibuka ke publik), lalu **Hosts → Proxy Hosts → Add Proxy Host**.

### a. Dashboard

| Tab | Isian |
|---|---|
| Details | Domain `dashboard.tandurai.id` · Scheme `http` · Forward Hostname `tandurai-web` · Port `80` · centang *Block Common Exploits* |
| SSL | *Request a new SSL Certificate* · centang *Force SSL* dan *HTTP/2 Support* |
| Advanced | isi di bawah |

```nginx
# SSE realtime dashboard: jangan ditahan buffer NPM
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 1h;
client_max_body_size 4m;
```

### b. Domain MQTT (hanya untuk sertifikat)

| Tab | Isian |
|---|---|
| Details | Domain `mqtt.tandurai.id` · Scheme `http` · Forward Hostname `tandurai-web` · Port `80` |
| SSL | **None.** Jangan minta sertifikat di NPM dan jangan *Force SSL*, supaya challenge HTTP-01 Let's Encrypt diteruskan ke Caddy |

### c. Ambil sertifikat MQTT

```bash
cd /home/service/tandurai/deploy
sudo docker compose restart web
sudo docker compose logs -f web      # tunggu "certificate obtained successfully" untuk mqtt.tandurai.id
sudo docker compose logs -f broker   # "menunggu sertifikat" berhenti, broker jalan
```

Lalu cek:

```bash
curl -s https://dashboard.tandurai.id/api/health      # "ok":true,"db":true,"mqtt":true
openssl s_client -connect mqtt.tandurai.id:8883 -servername mqtt.tandurai.id </dev/null 2>/dev/null \
  | grep -E 'i:|Server public key'                    # intermediate RSA (R10, R11, …), kunci 2048 bit
```

Buka `https://dashboard.tandurai.id`, login dengan email di `ADMIN_EMAILS`, lalu lanjutkan isi data awal seperti di §11 `PANDUAN_DEPLOY.md`.

---

## 7. Update aplikasi

Di laptop: commit & push ke `develop`. Di VM:

```bash
cd /home/service/tandurai && sudo bash deploy/deploy.sh
```

Migration database berjalan otomatis saat `api` start. Model AI baru cukup di-sync ke `ai_model/` (lihat `ai_model/README.md`), commit, lalu jalankan perintah yang sama.

---

## 8. Perintah server

Jalankan dari `/home/service/tandurai/deploy` (di sana `.env` memilih mode NPM; **jangan** tambahkan `-f docker-compose.yml`, karena opsi itu menimpa `COMPOSE_FILE`):

| Kebutuhan | Perintah |
|---|---|
| Status | `sudo docker compose ps` |
| Pemakaian RAM/CPU (semua project) | `sudo docker stats --no-stream` |
| Log semua / satu layanan | `sudo docker compose logs -f` · `sudo docker compose logs -f broker` |
| Restart satu layanan | `sudo docker compose restart worker` |
| Health API | `curl -s https://dashboard.tandurai.id/api/health` |
| Health AI worker | `sudo docker compose exec worker python -m worker health` |
| Registrasi perangkat massal | `sudo docker compose run --rm -v /root/provisioning:/out api node apps/api/tools/factory-provision.mjs --count 20 --out-dir /out` |
| Cek gateway | `sudo docker compose exec api node apps/api/tools/device-check.mjs --hw-uid TDR-XXXXXXXXXXXX --seconds 120` |
| Masuk database | `sudo docker compose exec postgres psql -U tandurai tandurai_iot` |
| Matikan Tandurai saja | `sudo docker compose down` (data aman di volume; project lain tidak terpengaruh) |

> Jangan pernah `docker compose down -v` — opsi `-v` menghapus volume database dan sertifikat. Jangan juga `docker system prune -a --volumes` di VM ini: perintah itu ikut menyentuh image/volume project lain.

File hasil `factory-provision` di `/root/provisioning` berisi `deviceSecret`: simpan aman, lalu hapus dari VM.

---

## 9. Backup

Cron dipasang di crontab root (karena docker butuh sudo):

```bash
sudo crontab -e
```

Tambahkan:

```
0 2 * * * BACKUP_DIR=/home/service/tandurai-backups /home/service/tandurai/deploy/backup.sh >> /var/log/tandurai-backup.log 2>&1
```

Backup disimpan 14 hari. Agar juga ada salinan di luar VM, buat bucket Cloud Storage dan tambahkan `BACKUP_BUCKET=gs://<nama-bucket>` di awal baris cron (service account VM butuh akses *Storage read/write*). Snapshot disk VM sebaiknya dikoordinasikan dengan admin `aitoma-prod`, karena berlaku untuk semua project.

Pulihkan database:

```bash
cd /home/service/tandurai/deploy
sudo docker compose exec -T postgres pg_restore -U tandurai -d tandurai_iot --clean --if-exists < /home/service/tandurai-backups/<file>.dump
```

---

## 10. Sertifikat HTTPS & MQTT TLS

- **Dashboard:** sertifikat diambil dan diperpanjang NPM (proxy host §6a).
- **MQTT:** Caddy mengambil dan memperpanjang sertifikat Let's Encrypt RSA untuk `MQTT_DOMAIN` lewat HTTP-01 yang diteruskan NPM (§6b). Broker membacanya dari volume `caddy-data` dan otomatis restart saat sertifikat diperbarui (dicek tiap 10 menit). Gateway tersambung ulang sendiri.
- Proxy host `mqtt.tandurai.id` di NPM **jangan dihapus** dan jangan diberi SSL: tanpa itu sertifikat MQTT gagal diperpanjang ±90 hari kemudian.

---

## 11. Checklist go-live

- [ ] `sudo docker compose ps`: semua `Up`, `api` dan `postgres` `healthy`
- [ ] `curl https://dashboard.tandurai.id/api/health` → `"ok":true` dan `"mqtt":true`
- [ ] Realtime dashboard ter-update tanpa refresh (cek *Advanced* proxy host dashboard)
- [ ] Login Google & email berhasil (domain sudah di Authorized domains)
- [ ] `sudo docker compose exec worker python -m worker health` → `"errors": []`
- [ ] **Perkiraan Panen → Hitung ulang** berhasil
- [ ] Gateway uji tersambung lewat `mqtt.tandurai.id:8883` dan `device-check` tanpa ✖
- [ ] Project lain tetap normal: `sudo docker compose ls` semuanya `running`
- [ ] Cron backup berjalan
- [ ] `deploy/.env` ber-permission `600`

---

## 12. Pemecahan masalah

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| `port is already allocated` (80/443) | `COMPOSE_FILE` di `deploy/.env` hilang/terkomentar, atau perintah memakai `-f docker-compose.yml` | aktifkan lagi `COMPOSE_FILE`, jalankan dari folder `deploy/` tanpa `-f` |
| `network shared_network ... not found` | nama network NPM berubah | cek `sudo docker inspect nginx-proxy-manager --format '{{json .NetworkSettings.Networks}}'`, sesuaikan `NPM_NETWORK` |
| NPM `502 Bad Gateway` | container `web` belum jalan / tidak di network NPM | `sudo docker compose ps web`; `sudo docker network inspect shared_network` harus memuat `tandurai-web` |
| Broker terus `menunggu sertifikat` | proxy host MQTT belum ada / diberi SSL / DNS belum benar | cek §6b dan record A `mqtt.…`; `sudo docker compose logs web` |
| `/api/health` → `mqtt:false` | broker belum siap / crash | `sudo docker compose logs broker` |
| Realtime dashboard tidak update | NPM menahan respons SSE | Advanced config proxy host dashboard harus berisi `proxy_buffering off;` |
| ESP32 gagal TLS ke 8883 | port 8883 belum dibuka di firewall GCP / sertifikat bukan RSA | cek §3; cek `openssl s_client` di §6c |
| `fatal: detected dubious ownership` | `git`/`deploy.sh` dijalankan tanpa sudo pada repo milik root (atau sebaliknya) | konsisten pakai `sudo` |
| Build berhenti `Killed` / exit 137 | RAM VM habis saat `vite build` | cek `free -h`; minta tambah swap atau build di luar jam sibuk |
| Login `unauthorized-domain` | domain belum diizinkan Firebase | tambah di Authorized domains |
| `CORS` error | `DASHBOARD_DOMAIN` tidak sama dengan URL yang dibuka | samakan, lalu `sudo bash deploy/deploy.sh --no-pull` |
| Perkiraan panen gagal | worker mati / artefak model tidak cocok | `sudo docker compose logs worker`; `sudo docker compose exec worker python -m worker health` |
| Ubah `VITE_*` tidak berefek | nilai `VITE_*` masuk saat build | jalankan ulang `sudo bash deploy/deploy.sh` (build ulang image `web`) |

---

## Lampiran: VM baru khusus Tandurai

Bila suatu saat Tandurai dipindah ke VM sendiri tanpa NPM: hapus baris `COMPOSE_FILE` dan `NPM_NETWORK` dari `deploy/.env` (Caddy lalu memegang port 80/443 dan HTTPS dashboard sendiri), jalankan `sudo bash deploy/setup-vm.sh` sekali untuk memasang Docker + swap, dan buka firewall `tcp:80,tcp:443,udp:443,tcp:8883`.
