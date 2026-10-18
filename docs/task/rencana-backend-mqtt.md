# Rencana Implementasi — Backend MQTT Tandurai

**Status:** Backend B0–B8 dan frontend F1–F5 **selesai** (2026-10-15). E2E backend lulus dengan **simulator MQTT** (bukan hardware fisik); UI lulus lint + build, belum diuji klik di browser dengan login nyata. Keputusan bagian 9: Node.js + Express, database `tandurai_iot` di PG18 :5433, broker uji Node + Mosquitto compose, akses hanya pemilik. Cara menjalankan: [`../../apps/api/README.md`](../../apps/api/README.md).  
**Tanggal:** 2026-10-15  
**Menggantikan untuk jalur IoT:** [`rencana-integrasi-iot-gateway.md`](./rencana-integrasi-iot-gateway.md) dan [`../PANDUAN_INTEGRASI_HARDWARE.md`](../PANDUAN_INTEGRASI_HARDWARE.md) (desain RTDB langsung dihentikan). Konsep yang tetap dipakai: UID hardware + device secret + claim code, capabilities otomatis, command ber-ID + kedaluwarsa + ACK, mode Manual/Timer/Auto dieksekusi di gateway, proteksi hardware.

```text
ESP32 ⇄ MQTT Broker ⇄ Backend (apps/api) ⇄ PostgreSQL
                          ⇅ REST + SSE
                      Dashboard (apps/web, Firebase Auth tetap)
```

## 1. Hasil audit

| Komponen | Kondisi | Keputusan |
|---|---|---|
| Backend HTTP | **Tidak ada.** Hanya Firebase Functions (alert legacy) dan worker Python AI. Dokumen strategi AI merencanakan FastAPI, tetapi belum dibuat. | Backend baru **Node.js** di `jamur/apps/api` (monorepo JS; simulator, Functions, dan web sudah JS). |
| PostgreSQL | PG 18.4 lokal port **5433** (auth lokal tanpa password) berisi database project lain; PG 16 port 5432 butuh password. | Database baru terpisah `tandurai_iot` (+ `tandurai_iot_test` untuk uji). Tidak menyentuh database lain. |
| MQTT broker | **Tidak ada.** Docker terpasang tetapi service mati; Mosquitto belum terpasang. | Produksi: **Mosquitto** (docker-compose disediakan). Pengembangan/uji: broker lokal Node (Aedes) dengan aturan auth & ACL yang sama, tanpa Docker. |
| Auth dashboard | Firebase Auth (tetap). | Backend memverifikasi Firebase ID token (`firebase-admin` sudah ada di `functions`). |
| Farm/kumbung/operasi | RTDB (tetap, bukan IoT). | Gateway/sensor/aktuator menyimpan `farmId`/`kumbungId` sebagai label konteks dashboard. |
| Data IoT di RTDB (gateway, sensor, telemetry) | Ada dari Fase 1–3. | Tidak dipakai lagi untuk IoT; halaman web dialihkan bertahap ke backend. Data lama tidak dihapus. |
| Simulator | `tools/gateway-simulator.mjs` (REST RTDB). | Simulator baru `tools/mqtt-gateway-sim.mjs` (MQTT). |

## 2. Struktur backend (sederhana, satu proses)

```text
jamur/apps/api/
  package.json            # express, pg, mqtt, firebase-admin (dev: aedes untuk broker uji)
  .env.example
  migrations/001_init.sql
  src/
    server.js             # bootstrap: DB pool, MQTT client tunggal, HTTP, sweeper
    config.js
    db.js                 # pg Pool + helper transaksi
    auth.js               # verifikasi Firebase ID token → req.user
    mqtt.js               # satu client persisten, reconnect, subscribe tandurai/gw/+/+
    events.js             # hub SSE per user
    devices/              # registrasi, klaim, status online
    telemetry/            # latest + histori 10 menit
    commands/             # command, ACK, expiry
    configs/              # versi config, publish retained, ACK
    routes.js             # REST
  tools/
    factory-provision.mjs # registry pabrik: hwUid + device secret + claim code (hash)
    dev-broker.mjs        # broker uji (Aedes) dengan auth/ACL dari tabel devices
```

Prinsip: satu MQTT client persisten, tanpa Redis/queue/microservice/scheduler cloud; sweeper offline & expiry berupa `setInterval` di proses backend.

## 3. MQTT: topic & payload (JSON, satu prefix per gateway)

| Topic | Arah | QoS | Retained | Isi |
|---|---|---|---|---|
| `tandurai/gw/{hwUid}/register` | ESP32 → backend | 1 | tidak | model, firmware, daftar sensor & aktuator |
| `tandurai/gw/{hwUid}/status` | ESP32 → backend | 1 | **ya** | heartbeat 60 dtk `{online:true, fw, configVersion, uptimeSec}`; LWT `{online:false}` |
| `tandurai/gw/{hwUid}/telemetry` | ESP32 → backend | 0 | tidak | `{ts, readings:{S1:{temperature,humidity}}}` |
| `tandurai/gw/{hwUid}/state` | ESP32 → backend | 1 | tidak | status aktual aktuator `{A1:{state,mode,source,since,offAt}}` |
| `tandurai/gw/{hwUid}/ack` | ESP32 → backend | 1 | tidak | `{type:"command", id, status, reason, state}` / `{type:"config", version, status, items}` |
| `tandurai/gw/{hwUid}/cmd` | backend → ESP32 | 1 | **tidak** | `{id, actuator:"A1", action:"on"|"off"|"estop", durationSec, expiresAt}` |
| `tandurai/gw/{hwUid}/config` | backend → ESP32 | 1 | **ya** | `{version, actuators:{A1:{mode,timer,auto,protection}}, telemetryIntervalSec}` |

Auth broker: username = `hwUid`, password = device secret; ACL: perangkat hanya boleh publish/subscribe `tandurai/gw/{username}/#` sesuai arah di atas. Backend memakai akun service sendiri.

## 4. Skema PostgreSQL minimal

```text
devices            hw_uid PK, secret_hash, claim_hash, model, created_at          -- registry pabrik (scrypt)
gateways           id PK→devices, owner_uid, farm_id, name, model, firmware, capabilities jsonb,
                   claimed_at, online, last_seen_at, config_version, applied_config_version,
                   config jsonb (versi terbaru), registered_at
sensors            id PK ("{hwUid}-{local}"), gateway_id, local_id, type, metrics text[],
                   name, kumbung_id, status, last_values jsonb, last_ts
actuators          id PK, gateway_id, local_id, type, name, kumbung_id, max_run_sec, min_interval_sec,
                   state, state_source, state_since, off_at, mode, applied_version
telemetry_history  (sensor_id, bucket_start) PK, ts, values jsonb             -- 1 baris / sensor / 10 menit
commands           id PK (uuid dari backend), gateway_id, actuator_id, action, duration_sec,
                   requested_by, created_at, expires_at, status, reason, acked_at
```

- Histori: `INSERT … ON CONFLICT DO NOTHING` per bucket 10 menit (tanpa duplikasi; telemetry 10 dtk hanya memperbarui `sensors.last_values`).
- Config: hanya versi terbaru disimpan di `gateways.config` (`config_version` naik +1 per perubahan).
- Retensi histori opsional (mis. 180 hari) lewat query hapus harian di proses backend.

## 5. REST API (Firebase ID token di `Authorization: Bearer`)

| Method & path | Fungsi |
|---|---|
| `GET /api/gateways` | Gateway milik user + sensor + aktuator + status |
| `GET /api/devices/:hwUid/preview?claimCode=` | Pratinjau perangkat terdaftar (setelah kode valid) |
| `POST /api/gateways/claim` | `{hwUid, claimCode, farmId, kumbungId, name}` → klaim, buat sensor/aktuator, publish config v1 |
| `DELETE /api/gateways/:id` | Lepas klaim (data histori tetap) |
| `PATCH /api/sensors/:id`, `PATCH /api/actuators/:id` | Nama/kumbung |
| `POST /api/actuators/:id/commands` | `{action, durationSec}` → `202 {id, status:"pending"}` |
| `GET /api/commands/:id` | Status command |
| `PUT /api/actuators/:id/config` | `{mode, timer, auto}` → versi baru, publish retained |
| `GET /api/sensors/:id/history?from&to` | Histori 10 menit |
| `GET /api/stream` | **SSE**: `telemetry`, `gateway`, `command`, `actuator`, `config` untuk gateway milik user |
| `GET /api/health` | DB + MQTT tersambung |

Otorisasi MVP: gateway hanya dapat diakses `owner_uid` (pengklaim). Akses operator farm menyusul (bagian 9).

## 6. Alur utama

1. **Registrasi:** ESP32 connect ke broker (auth hwUid+secret) → publish `register` → backend upsert `gateways` (unclaimed) + capabilities.
2. **Klaim:** dashboard `POST /claim` → backend cek `claim_hash`, gateway terdaftar & belum diklaim → transaksi: set owner/farm, buat sensor & aktuator (mode manual, OFF), config v1 → publish `config` retained → SSE.
3. **Telemetry:** `telemetry` → update `last_values` + upsert bucket 10 menit → SSE (throttle ringan).
4. **Command:** `POST /commands` → baris `pending` (expires 30 dtk) → publish `cmd` QoS1 → ESP32 eksekusi (non-blocking, timer lokal) → `ack` → update status + `actuators.state` → SSE. Tanpa ACK sampai kedaluwarsa → `expired` (gateway offline → `offline`). ACK ganda/ID tidak dikenal diabaikan.
5. **Config:** `PUT /config` → versi +1 → publish retained → ESP32 simpan NVS → ack config → `applied_config_version` → SSE (Pending Sync ↔ Applied).
6. **Offline/reconnect:** LWT/`status` offline langsung; tanpa aktivitas valid 180 dtk → offline. Reconnect: ESP32 menerima config retained, melaporkan `status` (configVersion) + `state`; backend menandai command yang lewat sebagai `expired` dan tidak mengirim ulang command.

## 7. Tahapan (urut prioritas goal) dan estimasi

| # | Tahap | Isi | Estimasi |
|---|---|---|---|
| B0 | Fondasi | `apps/api`, config, DB pool, migrasi, health, broker uji, simulator kerangka | 30 mnt |
| B1 | **Pairing** | factory tool, auth broker, `register`, preview, claim, unclaim, `GET /gateways` | 45 mnt |
| B2 | **Telemetry** | subscriber, latest, histori 10 menit, SSE | 30 mnt |
| B3 | **Command ON/OFF** | REST, publish QoS1, ACK, expiry, dedup, status, SSE | 40 mnt |
| B4 | **Config timer/threshold** | versi, publish retained, ACK, Pending Sync; engine lokal di simulator | 40 mnt |
| B5 | **Offline/reconnect** | LWT, sweeper 180 dtk, sinkron versi & state, command kedaluwarsa | 20 mnt |
| B6 | Histori API + retensi | `GET history` | 10 mnt |
| B7 | Uji e2e | broker uji + PG test + simulator: pairing → telemetry → command → config → offline → reconnect → expiry | 30 mnt |
| B8 | Kontrak MQTT | `docs/KONTRAK_MQTT_GATEWAY.md` untuk tim firmware | 15 mnt |
| F1 | Frontend: klien API + SSE | `src/lib/apiClient.js`, `useIotStream` | 20 mnt |
| F2 | `/devices` | Tambah gateway (UID + claim code + pratinjau), daftar sensor/aktuator, status online | 30 mnt |
| F3 | Kontrol aktuator | Automation: ON/OFF/estop dengan Pending/Success/Failed/Offline dari backend | 25 mnt |
| F4 | Config timer/threshold | editor per aktuator + Pending Sync/Applied | 25 mnt |
| F5 | Monitoring | ringkasan sensor & histori dari backend untuk gateway MQTT | 20 mnt |

Total ±6 jam kerja; jalur kritis DoD (B0–B5, B7, F1–F4) ±5 jam. Bila waktu tidak cukup, F5 dan retensi ditunda.

## 8. Definition of Done & verifikasi

Dari dashboard (dengan **simulator MQTT**, bukan hardware fisik): tambah gateway (UID + claim code), sensor & aktuator muncul otomatis, telemetry realtime, ON/OFF dengan status benar (Success hanya setelah ACK), simpan timer/threshold dengan ACK config, offline terdeteksi dan command kedaluwarsa tidak dieksekusi setelah reconnect. Diuji otomatis lewat e2e (B7) + uji manual UI. Target: ACK command < 2 dtk, ACK config < 5 dtk (diukur di simulator lokal).

## 9. Keputusan yang dibutuhkan sebelum mulai

1. **Framework backend:** Node.js + Express (usulan; satu bahasa dengan web/simulator) atau Python FastAPI (sejalan rencana AI).
2. **Database:** buat database baru `tandurai_iot` dan `tandurai_iot_test` di PostgreSQL 18 lokal (port 5433)?
3. **Broker:** pengembangan memakai broker uji Node (tanpa Docker); Mosquitto via docker-compose untuk server. Atau nyalakan Docker dan pakai Mosquitto sejak awal.
4. **Akses:** MVP hanya pemilik (pengklaim) gateway; operator farm menyusul. Atau langsung ikut role farm dari Firebase (backend membaca `users/{uid}/access` — butuh service account).
