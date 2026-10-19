# Panduan Deploy Tandurai — 1 VM GCP + Docker

Seluruh sistem (dashboard, API, broker MQTT, PostgreSQL, AI worker + model) berjalan di **satu VM Google Cloud** dalam container Docker. Setelah persiapan awal, deploy dan update cukup **satu perintah**:

```bash
bash deploy/deploy.sh
```

> Panduan ini menggantikan cara systemd di [`PANDUAN_DEPLOY.md`](PANDUAN_DEPLOY.md). Bagian integrasi hardware (§12 di sana) tetap berlaku; bedanya hanya cara menjalankan perintah server (lihat [§9](#9-perintah-server-versi-docker)).

---

## 0. Gambaran

```
                       ┌──────────────────────── VM GCP (Docker Compose) ────────────────────────┐
Browser ──HTTPS 443──▶ │ web (Caddy) ── /api ──▶ api :8787 ──▶ postgres :5432                    │
                       │   │ sertifikat Let's Encrypt otomatis   ▲  │ MQTT 1883 (internal)          │
                       │   └── caddy-data (volume) ──┐           │  ▼                               │
ESP32 ──MQTTS 8883───▶ │                    broker (aedes) ◀─────┘                                 │
                       │                    worker (Python + ai_model) ──token──▶ api              │
                       └──────────────────────────────────────────────────────────────────────────┘
```

| Container | Isi | Dibangun dari |
|---|---|---|
| `web` | Caddy: HTTPS otomatis, file dashboard, reverse proxy `/api` | `deploy/Dockerfile.web` (build `apps/web`) |
| `api` | backend REST + SSE, migration otomatis | `deploy/Dockerfile.api` |
| `broker` | broker MQTT; TLS 8883 memakai sertifikat dari Caddy | image yang sama dengan `api` |
| `worker` | AI worker + model (`ai_model/`) | `deploy/Dockerfile.worker` |
| `postgres` | PostgreSQL 16 | image resmi |

**Model AI sudah digabung ke repo.** Folder `ai_model/` berisi salinan runtime dari `Modul AI Aitoma` (paket `tandurai_harvest_ai`, artefak `.joblib`, dan tabel referensi sintetis, ±7 MB). Folder `Modul AI Aitoma` tidak perlu lagi disalin ke server; folder itu tetap dipakai untuk riset & training. Setelah training ulang, jalankan `tools/sync-ai-model.ps1` (lihat `ai_model/README.md`).

Hanya port **22, 80, 443, 8883** yang terbuka. PostgreSQL, API, dan MQTT 1883 hanya ada di jaringan internal Docker.

---

## 1. Kebutuhan resource

### Pemakaian per container

Diukur dari stack ini berjalan lokal (idle + satu kali hitung forecast). Angka produksi bertambah sesuai jumlah gateway dan pengguna.

| Container | RAM idle | RAM puncak | Batas (`mem_limit`) | Ukuran image |
|---|---:|---:|---:|---:|
| postgres | ±60 MB | — | 512 MB | ±420 MB |
| api | ±45 MB | — | 512 MB | ±435 MB |
| broker | ±30 MB | — | 384 MB | (sama dengan api) |
| worker | ±100 MB | ±270 MB (model dimuat) | 768 MB | ±740 MB |
| web (Caddy) | ±15 MB | — | 256 MB | ±85 MB |
| **Total** | **±250 MB** | | | **±1,7 GB** |

Saat **build** (`deploy.sh`), `vite build` dashboard butuh tambahan ±1–1,5 GB RAM sesaat. Swap 2 GB dari `setup-vm.sh` mencegah VM kehabisan memori.

### Pertumbuhan data

- Histori telemetry disimpan 1 baris per sensor per 10 menit selama 180 hari → ±26 rb baris/sensor ≈ **5–8 MB per sensor** (termasuk indeks).
- 50 sensor ≈ 0,4 GB; 200 sensor ≈ 1,5 GB. Log container dibatasi 10 MB × 3 per container.
- Backup `pg_dump` terkompresi biasanya < 30% ukuran database.

### Rekomendasi VM

| Skala | Tipe mesin | vCPU / RAM | Disk | Estimasi biaya* |
|---|---|---|---|---|
| Pilot (≤ 10 gateway, ≤ 20 pengguna) | **e2-medium** ✅ | 2 vCPU (shared) / 4 GB | 30 GB pd-balanced | ±US$ 30–40/bulan |
| Produksi kecil (≤ 50 gateway) | e2-standard-2 | 2 vCPU / 8 GB | 50 GB pd-balanced | ±US$ 60–75/bulan |
| Minimum absolut (uji coba) | e2-small | 2 vCPU (shared) / 2 GB | 30 GB | ±US$ 15–20/bulan — build lambat, mengandalkan swap |

\*Region **asia-southeast2 (Jakarta)**, on-demand, termasuk disk dan IP statis (±US$ 3–4/bulan). Harga Jakarta lebih mahal ±20–30% dibanding `us-central1`. **Cek angka pasti di [Google Cloud Pricing Calculator](https://cloud.google.com/products/calculator)** sebelum mengajukan anggaran; *committed use discount* 1 tahun memotong ±37%.

Stack idle hanya ±250 MB, jadi e2-small sebenarnya cukup untuk *menjalankan* aplikasi. Yang berat adalah *build* dashboard dan cache PostgreSQL saat data membesar. Rekomendasi: mulai dengan **e2-medium + 30 GB**. Naikkan ke e2-standard-2 (cukup *stop → edit machine type → start*, data tetap) bila `docker stats` menunjukkan RAM terpakai > 75% terus-menerus.

---

## 2. Siapkan repo (di laptop)

Pastikan perubahan ini sudah di-commit dan di-push, termasuk folder `ai_model/` dan `deploy/`:

```powershell
cd jamur
git add ai_model deploy .dockerignore .gitattributes tools/sync-ai-model.ps1 docs/PANDUAN_DEPLOY_DOCKER_GCP.md local_ai_worker
git commit -m "deploy: satu VM docker compose + model AI digabung"
git push
```

`deploy/.env` dan semua `.env` lain **tidak** ikut ke Git maupun image Docker (`.gitignore` + `.dockerignore`).

---

## 3. Buat VM di GCP

Bisa lewat Console (**Compute Engine → VM instances → Create**) atau Cloud Shell. Versi `gcloud`:

```bash
PROJECT=<ID_PROJECT_GCP>
ZONE=asia-southeast2-a
gcloud config set project $PROJECT
gcloud services enable compute.googleapis.com

# IP statis (agar DNS tidak berubah saat VM restart)
gcloud compute addresses create tandurai-ip --region=asia-southeast2

# VM
gcloud compute instances create tandurai \
  --zone=$ZONE \
  --machine-type=e2-medium \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-balanced \
  --address=tandurai-ip \
  --tags=tandurai-web,tandurai-mqtt

# Firewall: HTTP/HTTPS (+HTTP/3) dan MQTT TLS. SSH (22) sudah dibuka rule bawaan "default-allow-ssh".
gcloud compute firewall-rules create tandurai-web \
  --allow=tcp:80,tcp:443,udp:443 --target-tags=tandurai-web
gcloud compute firewall-rules create tandurai-mqtt \
  --allow=tcp:8883 --target-tags=tandurai-mqtt

gcloud compute addresses describe tandurai-ip --region=asia-southeast2 --format='value(address)'
```

Catat IP yang muncul.

> Lewat Console: pilih region `asia-southeast2`, machine `e2-medium`, boot disk **Ubuntu 24.04 LTS** 30 GB *Balanced*, centang **Allow HTTP/HTTPS traffic**, lalu di *Networking → External IPv4* pilih **Reserve static**. Tambahkan rule firewall untuk `tcp:8883` di **VPC network → Firewall**.

---

## 4. DNS

Di pengelola domain, buat dua record **A** ke IP statis tadi:

```
dashboard.tandurai.id   A   <IP_STATIS>
mqtt.tandurai.id        A   <IP_STATIS>
```

Tunggu sampai `nslookup dashboard.tandurai.id` menjawab IP tersebut. **DNS harus sudah benar sebelum langkah 7**, karena Caddy langsung meminta sertifikat Let's Encrypt saat start.

---

## 5. Persiapan VM (sekali saja)

```bash
gcloud compute ssh tandurai --zone=asia-southeast2-a     # atau tombol SSH di Console

git clone https://github.com/SaifMusyanto/tandurai-app.git ~/tandurai-app
cd ~/tandurai-app
sudo bash deploy/setup-vm.sh      # Docker, Compose, swap 2 GB, zona waktu
exit                               # logout-login agar grup docker aktif
```

Repo private? Pakai *deploy key* (SSH key read-only di GitHub → Settings → Deploy keys) atau *personal access token* saat `git clone`.

---

## 6. Isi konfigurasi `deploy/.env`

```bash
gcloud compute ssh tandurai --zone=asia-southeast2-a
cd ~/tandurai-app
cp deploy/.env.example deploy/.env
for k in POSTGRES_PASSWORD MQTT_PASSWORD WORKER_TOKEN; do
  sed -i "s/^$k=.*/$k=$(openssl rand -hex 32)/" deploy/.env
done
nano deploy/.env
```

Yang wajib diisi manual:

| Variabel | Isi |
|---|---|
| `DASHBOARD_DOMAIN`, `MQTT_DOMAIN` | domain dari langkah 4 |
| `ACME_EMAIL` | email untuk Let's Encrypt |
| `ADMIN_EMAILS` | email admin Tandurai (pisahkan koma) |
| `VITE_FIREBASE_*` | dari Firebase Console → Project settings → *Your apps* (Web). Nilainya publik |

`POSTGRES_PASSWORD`, `MQTT_PASSWORD`, dan `WORKER_TOKEN` sudah terisi acak oleh perintah di atas. Nilai ini dipakai bersama oleh semua container, jadi tidak ada lagi yang perlu disamakan manual antar-file `.env`.

Di **Firebase Console → Authentication → Settings → Authorized domains**, tambahkan `dashboard.tandurai.id`.

---

## 7. Deploy

```bash
bash deploy/deploy.sh
```

Skrip ini: `git pull` → build semua image → start/restart container → hapus image lama → tunggu API sehat → tampilkan status. Build pertama ±5–10 menit di e2-medium; update berikutnya lebih cepat karena cache.

Hasil yang diharapkan:

```
NAME                IMAGE                    STATUS
tandurai-api-1      tandurai-api:latest      Up (healthy)
tandurai-broker-1   tandurai-api:latest      Up
tandurai-postgres-1 postgres:16-alpine       Up (healthy)
tandurai-web-1      tandurai-web:latest      Up
tandurai-worker-1   tandurai-worker:latest   Up
health: {"ok":true,"db":true,"mqtt":true,...}
```

Pada start pertama, broker menulis `menunggu sertifikat TLS dari Caddy` beberapa detik sampai Caddy selesai mengambil sertifikat untuk `MQTT_DOMAIN`; selama itu `mqtt:false`. Ini normal.

Buka `https://dashboard.tandurai.id`, login dengan email di `ADMIN_EMAILS`, lalu lanjutkan isi data awal seperti di §11 `PANDUAN_DEPLOY.md`.

---

## 8. Update aplikasi

Di laptop: commit & push. Di VM:

```bash
cd ~/tandurai-app && bash deploy/deploy.sh
```

Migration database berjalan otomatis saat `api` start. Model AI baru cukup di-sync ke `ai_model/` (lihat `ai_model/README.md`), commit, lalu jalankan perintah yang sama.

---

## 9. Perintah server versi Docker

Jalankan dari `~/tandurai-app/deploy`:

| Kebutuhan | Perintah |
|---|---|
| Status | `docker compose ps` |
| Pemakaian RAM/CPU | `docker stats --no-stream` |
| Log semua / satu layanan | `docker compose logs -f` · `docker compose logs -f broker` |
| Restart satu layanan | `docker compose restart worker` |
| Health API | `curl -s https://dashboard.tandurai.id/api/health` |
| Health AI worker | `docker compose exec worker python -m worker health` |
| Registrasi perangkat massal | `docker compose run --rm -v ~/provisioning:/out api node apps/api/tools/factory-provision.mjs --count 20 --out-dir /out` |
| Cek gateway | `docker compose exec api node apps/api/tools/device-check.mjs --hw-uid TDR-XXXXXXXXXXXX --seconds 120` |
| Masuk database | `docker compose exec postgres psql -U tandurai tandurai_iot` |
| Matikan semua | `docker compose down` (data aman di volume) |

> Jangan pernah `docker compose down -v` — opsi `-v` menghapus volume database dan sertifikat.

File hasil `factory-provision` di `~/provisioning` berisi `deviceSecret`: simpan aman, lalu hapus dari VM.

---

## 10. Backup

```bash
chmod +x ~/tandurai-app/deploy/backup.sh
crontab -e
```

Tambahkan:

```
0 2 * * * /home/<user>/tandurai-app/deploy/backup.sh >> /home/<user>/tandurai-backup.log 2>&1
```

Backup tersimpan di `~/backups` (14 hari). Agar juga ada salinan di luar VM, buat bucket Cloud Storage dan tambahkan `BACKUP_BUCKET=gs://<nama-bucket>` di awal baris cron (VM butuh akses *Storage read/write* pada service account-nya).

Tambahan yang disarankan: **Compute Engine → Snapshots → Create snapshot schedule** (harian, simpan 7) untuk disk VM.

Pulihkan database:

```bash
cd ~/tandurai-app/deploy
docker compose exec -T postgres pg_restore -U tandurai -d tandurai_iot --clean --if-exists < ~/backups/<file>.dump
```

---

## 11. Sertifikat HTTPS & MQTT TLS

- Caddy mengambil dan memperpanjang sertifikat Let's Encrypt otomatis untuk kedua domain (RSA, berantai ke **ISRG Root X1**, sama dengan CA di firmware ESP32).
- Broker membaca sertifikat `MQTT_DOMAIN` dari volume `caddy-data`. Saat Caddy memperpanjangnya, broker otomatis restart (dicek tiap 10 menit). Gateway tersambung ulang sendiri.
- Tidak perlu certbot atau cron sertifikat.

---

## 12. Checklist go-live

- [ ] `docker compose ps`: semua `Up`, `api` dan `postgres` `healthy`
- [ ] `curl https://dashboard.tandurai.id/api/health` → `"ok":true`
- [ ] Login Google & email berhasil (domain sudah di Authorized domains)
- [ ] `docker compose exec worker python -m worker health` → `"errors": []`
- [ ] **Perkiraan Panen → Hitung ulang** berhasil
- [ ] Gateway uji tersambung lewat `mqtt.tandurai.id:8883` dan `device-check` tanpa ✖
- [ ] Dari luar VM, port 5432/8787/1883 **tidak** bisa diakses (`nc -vz <IP> 5432` gagal)
- [ ] Cron backup berjalan; snapshot disk terjadwal
- [ ] `deploy/.env` ber-permission `600`

---

## 13. Pemecahan masalah

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| Browser: sertifikat tidak valid | DNS belum mengarah / port 80 tertutup saat Caddy start | cek DNS & firewall, lalu `docker compose restart web`; lihat `docker compose logs web` |
| Broker terus `menunggu sertifikat` | sertifikat `MQTT_DOMAIN` gagal diambil | cek record A `mqtt.…` dan `docker compose logs web` |
| `/api/health` → `mqtt:false` | broker belum siap / crash | `docker compose logs broker` |
| Build berhenti `Killed` / exit 137 | RAM habis saat `vite build` | pastikan swap aktif (`swapon --show`) atau naikkan tipe mesin |
| Login `unauthorized-domain` | domain belum diizinkan Firebase | tambah di Authorized domains |
| `CORS` error | `DASHBOARD_DOMAIN` tidak sama dengan URL yang dibuka | samakan, lalu `bash deploy/deploy.sh --no-pull` |
| Perkiraan panen gagal | worker mati / artefak model tidak cocok | `docker compose logs worker`; `docker compose exec worker python -m worker health` |
| Disk penuh | image lama / backup menumpuk | `docker system df`, `docker image prune -a`, cek `~/backups` |
| Ubah `VITE_*` tidak berefek | nilai `VITE_*` masuk saat build | jalankan ulang `bash deploy/deploy.sh` (build ulang image `web`) |
