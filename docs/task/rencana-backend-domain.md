# Rencana: Backend domain menggantikan Firebase RTDB

Tujuan: seluruh data aplikasi (user, farm, anggota, kumbung, batch, panen, gateway, telemetry,
alert, forecast, pengaturan) pindah dari Firebase Realtime Database ke backend `apps/api`
(Express + PostgreSQL). **Firebase hanya dipakai untuk Authentication** (Google / email-password);
backend memverifikasi ID token dan memegang semua otorisasi.

## Model akses (pengganti `database.rules.json`)

| Peran | Hak |
|---|---|
| `owner` farm | ubah farm, tambah/ubah kumbung, kelola anggota, klaim/lepas gateway, penempatan & nama sensor/aktuator, pengaturan alert farm, profil estimasi panen |
| `operator` farm | lihat semua data farm, batch (buat/ubah), catat & koreksi panen, minta forecast, kontrol aktuator (ON/OFF/E-STOP) dan mode timer/threshold |
| user login tanpa farm | membuat farm baru (otomatis menjadi owner) |
| `platformAdmin` (custom claim Firebase) | baca & ubah semua farm |
| AI worker lokal | API internal `/api/worker/*` dengan `WORKER_TOKEN` (bukan token user) |

Anggota ditambahkan lewat email akun yang sudah pernah login ke Tandurai dengan email terverifikasi
(pengganti `userDirectory`). Owner tidak bisa dicabut lewat API anggota.

## Skema PostgreSQL (`migrations/002_domain.sql`)

`users`, `farms`, `farm_members`, `kumbungs` (+ `harvest_profile`), `batches`, `harvest_events`
(append-only, koreksi lewat `corrects_event_id`), `audit_log`, `farm_alert_settings`
(token Telegram write-only), `alerts`, `ai_requests`, `ai_forecasts`, `ai_forecast_latest`,
`ai_features_daily`, `worker_status`. Gateway kini milik **farm** (`gateways.farm_id` wajib
saat diklaim, `claimed_by` = pengklaim); `sensors/actuators.kumbung_id` → FK `kumbungs`.

## API (base `/api`, Bearer Firebase ID token)

- **Akun**: `GET/PATCH /me`, `GET/PUT /me/settings`
- **Farm**: `GET/POST /farms`, `GET/PATCH /farms/:farmId`, `GET /farms/:farmId/audit`
- **Anggota**: `GET/POST /farms/:farmId/members`, `DELETE /farms/:farmId/members/:uid`
- **Kumbung**: `GET/POST /farms/:farmId/kumbungs`, `PATCH /kumbungs/:id`, `PUT /kumbungs/:id/harvest-profile`
- **Batch & panen**: `POST /kumbungs/:id/batches`, `PATCH /batches/:id`, `POST /kumbungs/:id/harvests`
- **Operasional (agregat semua farm)**: `GET /operations`
- **Telemetry kumbung**: `GET /kumbungs/:id/telemetry?sensorId&from&to&maxPoints`
- **Alert**: `GET /alerts?farmId&status`, `GET/PUT /farms/:farmId/alert-settings`
- **Forecast**: `GET /kumbungs/:id/forecast`, `POST /kumbungs/:id/forecast-requests`, `GET /forecasts/latest`
- **IoT** (sudah ada, kini berbasis farm): gateway, klaim, command, config, histori sensor, SSE
- **Worker** (`WORKER_TOKEN`): permintaan forecast, input fitur, tulis fitur/forecast, heartbeat

SSE `/stream` mengirim event per farm ke semua anggotanya: `gateway`, `telemetry`, `actuator`,
`config`, `command`, `alert`, `forecast`, `changed` (entitas domain berubah → frontend memuat ulang).

## Alert

Dievaluasi backend saat telemetry masuk (sensor yang ditempatkan di kumbung) memakai ambang per farm
(default sama dengan `functions/alert-core.js`); `device_offline` dibuat saat gateway offline dan
selesai saat online. Notifikasi Telegram opsional per farm dengan cooldown, dikirim dari backend.
Worker alert lokal Firebase (`functions/local-alert-worker.js`) tidak diperlukan lagi.

## Tahapan

| Tahap | Isi | Status |
|---|---|---|
| D1 | Migrasi skema domain + migrasi data gateway lama ke model farm | selesai |
| D2 | Akun, farm, anggota, kumbung, audit (otorisasi per farm) | selesai |
| D3 | Batch, panen (ledger koreksi), operasional agregat, profil panen | selesai |
| D4 | Gateway/SSE berbasis farm, telemetry kumbung | selesai |
| D5 | Alert backend + pengaturan farm + Telegram | selesai |
| D6 | Forecast: API user + API worker; adaptor Python `BackendClient` | selesai |
| D7 | Impor data dari ekspor JSON RTDB (`tools/import-rtdb.mjs`) | selesai |
| D8 | Uji e2e domain + e2e IoT diperbarui | selesai |
| W1–W6 | Frontend: klien API + bus SSE, konteks farm, telemetry, operasional, anggota & audit, alert, pengaturan, forecast → backend (tanpa `firebase/database`) | selesai |

## Verifikasi

- Backend: unit 7/7; e2e IoT 9 skenario, domain 7 skenario (termasuk AI worker Python sungguhan), impor RTDB 3 skenario — semua dengan broker uji + PostgreSQL `tandurai_iot_test` + simulator gateway.
- Frontend: ESLint (0 error), `vite build` lulus, test web 24/24. **Belum** diuji klik di browser dengan login Firebase nyata.
- AI worker: pytest 29/29 (termasuk kontrak `BackendClient`).

## Yang belum / catatan

- Data produksi RTDB belum diimpor: jalankan `import:rtdb` (dry-run lalu `--apply`) setelah ekspor; perlu persetujuan pemilik data.
- Halaman login hanya email/password (Firebase Auth); tombol "Masuk dengan Google" belum ada di UI (backend sudah menerima token Google).
- Ambang suhu rendah, kelembapan tinggi, kelembapan media, dan air di Settings belum dievaluasi backend (sama seperti sebelumnya).
- Worker alert lokal Firebase (`functions/`), Rules RTDB, dan simulator RTDB lama dibiarkan untuk referensi; tidak dipakai jalur baru.
