# Backend Tandurai (`apps/api`)

Seluruh data aplikasi (user, farm, anggota, kumbung, batch, panen, gateway, telemetry, alert, forecast) — pengganti Firebase RTDB; **Firebase hanya untuk login**. ESP32 ⇄ MQTT Broker ⇄ **Backend** ⇄ PostgreSQL ⇄ Dashboard (REST + SSE). Node.js + Express, satu MQTT client persisten, tanpa Redis/queue/scheduler cloud. Rencana domain: [`../../docs/task/rencana-backend-domain.md`](../../docs/task/rencana-backend-domain.md). Kontrak firmware: [`../../docs/KONTRAK_MQTT_GATEWAY.md`](../../docs/KONTRAK_MQTT_GATEWAY.md). Rencana & keputusan: [`../../docs/task/rencana-backend-mqtt.md`](../../docs/task/rencana-backend-mqtt.md).

## Menjalankan lokal (dari folder `jamur`)

```bash
cp apps/api/.env.example apps/api/.env      # isi MQTT_PASSWORD; AUTH_MODE=firebase
npm run migrate -w apps/api                 # skema PostgreSQL (database tandurai_iot)
npm run api:broker                          # terminal 1: broker MQTT Tandurai (auth dari tabel devices)
npm run api:start                           # terminal 2: backend http://localhost:8787/api
npm run dev                                 # terminal 3: dashboard http://localhost:3000
```

Integrasi hardware (broker, registrasi massal, cek perangkat, firmware referensi): [`../../docs/PANDUAN_INTEGRASI_HARDWARE.md`](../../docs/PANDUAN_INTEGRASI_HARDWARE.md).

Deploy ke server (PostgreSQL, broker TLS, systemd, Nginx, AI worker, sampai klaim gateway): [`../../docs/PANDUAN_DEPLOY.md`](../../docs/PANDUAN_DEPLOY.md).

Perangkat simulasi:

```bash
npm run factory -w apps/api -- --out apps/api/.sim/gw1.device.json   # catat UID & kode klaim
node apps/api/tools/mqtt-gateway-sim.mjs --device apps/api/.sim/gw1.device.json
```

Lalu di dashboard: **Devices → Tambah gateway** → UID + kode klaim → klaim. Kontrol aktuator & mode di **Automation**; sensor realtime + histori di **Monitoring**.

## Uji

```bash
npm test -w apps/api                   # unit (hash, ACL broker, validasi IoT & domain, evaluasi alert)
npm run test:e2e -w apps/api           # semua e2e (database tandurai_iot_test di-reset):
npm run test:e2e:iot -w apps/api       #   IoT: pairing ke farm, telemetry, alert+Telegram (tiruan), command, config, offline, histori, lepas klaim
npm run test:e2e:domain -w apps/api    #   domain: akun, farm, anggota, kumbung, batch, panen, forecast + API worker (+ klien Python bila .venv ada)
npm run test:e2e:import -w apps/api    #   impor ekspor RTDB → PostgreSQL → verifikasi lewat API
```

## Migrasi data dari Firebase RTDB

```bash
firebase database:get / --project demo > rtdb-export.json                 # ekspor (jangan di-commit)
npm run import:rtdb -w apps/api -- --file ../../rtdb-export.json           # dry-run: rencana + anomali
npm run import:rtdb -w apps/api -- --file ../../rtdb-export.json --apply   # tulis (idempoten)
```

Hak akses diambil dari `users/{uid}/access` (sama dengan Rules lama). Telemetry lama masuk ke gateway virtual `LEGACY-{farmId}` (tidak bisa login ke broker). Token Telegram global tidak diimpor — atur ulang per farm. Data tidak valid dilewati dan dilaporkan.

## Produksi

- Broker: `npm run broker -w apps/api` (disarankan; perangkat baru langsung bisa login, TLS via `MQTT_TLS_CERT`/`MQTT_TLS_KEY`). Alternatif Mosquitto: `deploy/docker-compose.yml` + `mosquitto_passwd` per perangkat.
- Backend: `NODE_ENV=production`, `AUTH_MODE=firebase` (mode `dev` ditolak di production), jalankan dengan process manager (systemd/PM2) agar restart otomatis.
- PostgreSQL: backup rutin; histori dipangkas otomatis setelah `HISTORY_RETENTION_DAYS`.

## REST

Semua endpoint (kecuali `health` dan `/worker/*`) memakai `Authorization: Bearer <Firebase ID token>` (Google atau email/password). User tercatat otomatis saat request pertama. Akses per farm: **owner** (kelola farm, anggota, kumbung, gateway, penempatan, alert) dan **operator** (lihat, batch, panen, forecast, kontrol & mode aktuator). Farm yang tidak dapat diakses → 404.

| Method & path | Fungsi |
|---|---|
| `GET /api/health` | status DB + MQTT |
| `GET /api/stream?token=` | SSE ke anggota farm: `gateway`, `telemetry`, `actuator`, `config`, `command`, `alert`, `forecast`, `changed` |
| `GET/PATCH /api/me`, `GET/PUT /api/me/settings` | profil & preferensi user (field rahasia dibuang) |
| `GET/POST /api/farms`, `GET/PATCH /api/farms/:farmId` | farm (pembuat = owner) |
| `GET/POST /api/farms/:farmId/members`, `DELETE …/members/:uid` | operator lewat email akun terverifikasi |
| `GET /api/farms/:farmId/audit` | riwayat perubahan farm |
| `GET/POST /api/farms/:farmId/kumbungs`, `PATCH /api/kumbungs/:id` | kumbung (ID `{farmId}-Knn`) |
| `PUT /api/kumbungs/:id/harvest-profile` | profil estimasi panen |
| `POST /api/kumbungs/:id/batches`, `PATCH /api/batches/:id` | batch baglog (ID `{kumbungId}-Bnn`) |
| `POST /api/kumbungs/:id/harvests` | catat panen; koreksi = `correctsEventId` + `correctionReason` (append-only) |
| `GET /api/operations` | farm, kumbung, batch, ledger panen semua farm user |
| `POST /api/kumbungs/:id/activities`, `POST /api/activities/:id/void` | kegiatan harian / masalah (baglog kontaminasi mengurangi baglog aktif); batal catat oleh pencatat atau owner |
| `GET /api/admin/overview`, `/api/admin/users`, `/api/admin/farms`, `/api/admin/farms/:id` | konsol admin (hanya `ADMIN_EMAILS`/platformAdmin): ringkasan sistem, akun & peran, farm + detail |
| `GET /api/farms/:farmId/telemetry-export` | data parameter CSV/Excel (`from`,`to`,`kumbungIds`,`sensorIds`,`interval`=10m/1h/1d,`groupBy`=sensor/kumbung,`format`) |
| `GET /api/farms/:farmId/report`, `GET …/report-file` | laporan farm per kumbung (parameter + % waktu optimal, panen, kegiatan, alert); file xlsx/csv |
| `GET/POST /api/farms/:farmId/report-schedules`, `PATCH/DELETE /api/report-schedules/:id`, `POST …/:id/send` | jadwal laporan ke Telegram farm (owner mengelola); sweeper tiap menit |
| `GET /api/farms/:farmId/recap`, `GET …/recap.csv` | rekap kegiatan + panen (filter `from`,`to`,`kumbungId`,`batchId`,`kinds`,`actor`); CSV `;` + BOM untuk Excel |
| `GET /api/kumbungs/:id/telemetry?sensorId&from&to&maxPoints` | telemetry kumbung (format baris lama) |
| `GET /api/alerts?farmId&status` | alert (dievaluasi backend) |
| `GET/PUT /api/farms/:farmId/alert-settings`, `POST …/test` | ambang alert, rentang optimal (`optimal`, `null` = rekomendasi bawaan) & Telegram per farm (token write-only) |
| `GET /api/kumbungs/:id/forecast`, `POST …/forecast-requests` | forecast & permintaan hitung |
| `GET /api/forecasts/latest`, `GET /api/system/worker-status` | forecast terbaru semua kumbung, status AI worker |
| `GET /api/gateways[?farmId]`, `GET /api/gateways/:id` | gateway farm + sensor + aktuator |
| `GET /api/devices/:hwUid/preview?claimCode=` | pratinjau sebelum klaim |
| `POST /api/gateways/claim` | `{hwUid, claimCode, farmId, kumbungId?, name}` (owner farm) |
| `DELETE /api/gateways/:id` | lepas klaim (owner; data farm dihapus) |
| `PATCH /api/sensors/:id`, `PATCH /api/actuators/:id` | nama / kumbung (owner, kumbung farm yang sama) |
| `POST /api/actuators/:id/commands` | `{action: on|off|estop, durationSec}` → 202 pending |
| `GET /api/commands/:id`, `GET /api/actuators/:id/commands` | status command |
| `PUT /api/actuators/:id/config` | `{mode, timer?, auto?}` → versi baru, Pending Sync sampai ACK |
| `GET /api/sensors/:id/history?from&to` | histori bucket 10 menit |

API internal AI worker (`Authorization: Bearer <WORKER_TOKEN>`): `GET /api/worker/forecast-requests`, `PATCH /api/worker/forecast-requests/:kumbungId`, `GET /api/worker/kumbungs/:id/feature-inputs?dates=`, `GET …/sensors/:sensorId/latest`, `PUT …/features/:dateKey`, `PUT …/forecasts/:forecastId`, `GET …/forecasts/latest`, `PUT /api/worker/status`. Worker Python: `DATA_SOURCE=api`, `BACKEND_URL`, `WORKER_TOKEN` di `local_ai_worker/.env`.
