# Kontrak MQTT Gateway Tandurai v1

**Untuk:** tim firmware ESP32. **Acuan perilaku:** `apps/api/tools/mqtt-gateway-sim.mjs` (simulator yang lulus uji e2e backend).  
**Arsitektur:** ESP32 ⇄ MQTT Broker (broker Tandurai `apps/api/tools/broker.mjs`, atau Mosquitto) ⇄ Backend (`apps/api`) ⇄ PostgreSQL ⇄ Dashboard (REST + SSE).  
**Langkah praktis & alat bantu:** [`PANDUAN_INTEGRASI_HARDWARE.md`](PANDUAN_INTEGRASI_HARDWARE.md) · firmware referensi `firmware/tandurai-gateway/`.  
**Status uji:** semua alur di bawah lulus e2e dengan **simulator**; belum diuji dengan hardware fisik.

## 1. Koneksi

| Parameter | Nilai |
|---|---|
| Broker | `mqtt://<host>:1883` (produksi lewat internet: `mqtts://<host>:8883`, TLS + validasi sertifikat) |
| Protokol | MQTT 3.1.1 |
| Client ID | **`hwUid`** (wajib sama dengan username; broker menolak yang berbeda) |
| Username / password | `hwUid` / `deviceSecret` (dari tool pabrik, disimpan di NVS) |
| Clean session | **false** (antrean QoS1 untuk `cmd` disimpan broker saat perangkat offline) |
| Keepalive | 15–30 dtk |
| Last Will (LWT) | topic `tandurai/gw/{hwUid}/status`, payload `{"online":false}`, QoS 1, **retained** |
| Reconnect | otomatis, backoff 1 → 30 dtk + jitter; engine lokal tetap berjalan selama terputus |

`hwUid` = ID unik perangkat (mis. `TDR-A1B2C3D4E5F6`, huruf/angka/`-`/`_`, 4–64 karakter). Dicetak di label bersama **kode klaim** (8 karakter, mis. `K7Q2-M9XD`). Device secret **tidak pernah** dicetak/dilog.

## 2. Topic

Semua topic berbentuk `tandurai/gw/{hwUid}/{jenis}`; perangkat hanya boleh memakai topic miliknya (ACL broker).

| Jenis | Arah | QoS | Retain | Kapan |
|---|---|---|---|---|
| `register` | ESP32 → backend | 1 | tidak | setiap terhubung |
| `status` | ESP32 → backend | 1 | **ya** | setiap terhubung + tiap 60 dtk (heartbeat); LWT saat putus |
| `telemetry` | ESP32 → backend | 0 | tidak | tiap `telemetryIntervalSec` (default 10 dtk) |
| `state` | ESP32 → backend | 1 | tidak | saat status relay berubah + setelah terhubung |
| `ack` | ESP32 → backend | 1 | tidak | setelah memproses `cmd` atau `config` |
| `cmd` | backend → ESP32 | 1 | **tidak** | perintah manual dari dashboard |
| `config` | backend → ESP32 | 1 | **ya** | perubahan mode/jadwal/otomatis (versi terbaru selalu tersedia saat subscribe) |

Urutan setelah `CONNACK`: subscribe `cmd` + `config` (QoS 1) → publish `register` → publish `status` (retained) → publish `state` → telemetry pertama.

## 3. Payload ESP32 → backend

Semua JSON UTF-8. Waktu dalam **milidetik epoch** dari jam SNTP.

### 3.1 `register`

```json
{
  "model": "TDR-GW1",
  "firmware": "esp32-gw/1.0.0",
  "sensors": [
    { "id": "S1", "type": "scd41" },
    { "id": "S2", "type": "scd41" }
  ],
  "actuators": [
    { "id": "A1", "type": "sprayer", "maxRunSec": 120, "minIntervalSec": 300 },
    { "id": "A2", "type": "fan", "maxRunSec": 3600, "minIntervalSec": 0 }
  ]
}
```

- `id` lokal: `[A-Za-z0-9_]{1,16}`, unik dalam perangkat (sensor dan aktuator tidak boleh berbagi ID). Maks 32 sensor, 16 aktuator.
- **Setiap sensor membaca tepat 3 parameter:** `temperature` (−10…60 °C), `humidity` (0…100 %), `co2` (0…10000 ppm). Tidak perlu mengirim `metrics`; bila dikirim, diabaikan. `type` sensor opsional (info model).
- `type` aktuator: `sprayer`, `fan`, `humidifier`, `pump`, `light`, `heater`, `other`.
- `maxRunSec` (1…86400) = **batas keras hardware**; `minIntervalSec` = jeda minimal antar-ON.
- Setelah perangkat diklaim user, sensor/aktuator baru di `register` ditambahkan otomatis; yang lama tidak dihapus. Perubahan `type`/`metrics` sensor yang sudah ada ikut diperbarui.
- Tiap sensor dikirim terpisah (`S1`, `S2`, …); dashboard menampilkan per sensor atau rata-rata kumbung.

### 3.2 `status` (retained)

```json
{ "online": true, "firmware": "esp32-gw/1.0.0", "configVersion": 7, "uptimeSec": 3600 }
```

`configVersion` = versi config terakhir yang tersimpan di NVS. Bila lebih kecil dari versi backend, backend mengirim ulang config. Backend menganggap offline bila menerima LWT `{"online":false}` atau tidak ada aktivitas valid > 180 dtk.

### 3.3 `telemetry`

```json
{ "ts": 1791507600000, "readings": { "S1": { "temperature": 27.5, "humidity": 82.4, "co2": 677 }, "S2": { "temperature": 28.1, "humidity": 79.0, "co2": 720 } } }
```

Sensor yang gagal dibaca **dihilangkan** dari `readings` (jangan kirim 0). Nilai di luar rentang dibuang backend. Backend menyimpan nilai terbaru dan satu sampel histori per sensor per 10 menit.

### 3.4 `state`

```json
{ "actuators": { "A1": { "state": "on", "mode": "timer", "source": "manual", "since": 1791507600000, "offAt": 1791507660000, "override": true, "trigger": null } } }
```

`state`: `on` | `off` | `fault`. `source`: `manual` | `timer` | `auto` | `estop` | `protection` | `config` | `boot` | `button`. `offAt` hanya saat `on`. `override`: `true` bila dinyalakan manual saat mode `timer`/`auto` aktif. `trigger` (saat `on`): `{ "rule": "<id>" }` atau `{ "schedule": "<id>" }` — aturan/jadwal yang menyalakan; dipakai dashboard & log untuk menjelaskan alasan aktuator menyala.

### 3.5 `ack` untuk command

```json
{ "type": "command", "id": "8f3c…-uuid", "status": "success", "reason": null, "state": "on", "offAt": 1791507660000 }
```

`status`: `success` | `failed` | `rejected` | `expired`. `reason` untuk non-sukses: `expired`, `interval`, `unknown_actuator`, `invalid_action`, `no_clock`, `hardware`.

### 3.6 `ack` untuk config

```json
{ "type": "config", "version": 7, "status": "applied",
  "items": { "A1": { "status": "ok" }, "A2": { "status": "fault", "error": "unknown_channel" },
             "S1": { "status": "ok" }, "S2": { "status": "not_found", "error": "Sensor tidak menjawab" } } }
```

`status`: `applied` | `rejected` (+ `reason`). `items` per aktuator (`ok` | `fault`) dan per sensor (`ok` | `not_found` | `read_error`). Dashboard menampilkan **Pending Sync** sampai ACK berisi versi tersebut.

## 4. Payload backend → ESP32

### 4.1 `cmd`

```json
{ "id": "8f3c…-uuid", "actuator": "A1", "action": "on", "durationSec": 60, "expiresAt": 1791507630000 }
```

`action`: `on` (dengan `durationSec`) | `off` | `estop`. Kedaluwarsa default 30 dtk setelah dibuat.

**Aturan eksekusi (urut):**

1. `id` sudah ada di daftar ID yang diproses (NVS, ≥ 50 terakhir) → **abaikan** (redelivery QoS1).
2. Jam belum tersinkron SNTP → ACK `rejected`/`no_clock`.
3. `now > expiresAt` → ACK `expired` (**jangan** eksekusi; terjadi saat command diantrekan selama offline).
4. Aktuator tidak dikenal → `rejected`/`unknown_actuator`.
5. `estop` → relay OFF, tahan OFF (abaikan jadwal/otomatis) sampai config baru atau command manual `on` → `success`.
6. **Override manual:** `on`/`off` berlaku di mode apa pun. Saat mode `timer`/`auto`, `on` menghentikan sementara engine aktuator itu (`override: true`) sampai relay mati; setelah `off` manual di mode `auto`, tunggu `cooldownSec` sebelum otomatis boleh menyala lagi.
7. `on` dalam `minIntervalSec` sejak ON terakhir → `rejected`/`interval`.
8. `on`: relay ON, **timer non-blocking** mati otomatis setelah `min(durationSec, maxRunSec)`. `off`: relay OFF.
9. Simpan `id` ke NVS → publish `ack` lalu `state`.

Target: ACK < 2 dtk setelah command diterima. Jangan memakai `delay()` di jalur relay.

### 4.2 `config` (retained)

```json
{
  "version": 7,
  "controlVersion": 3,
  "telemetryIntervalSec": 10,
  "utcOffsetMin": 420,
  "actuators": {
    "A1": { "mode": "auto", "maxRunSec": 120, "minIntervalSec": 300, "schedules": null,
            "rules": [
              { "id": "r1", "sensor": "S1", "metric": "humidity", "operator": "below", "threshold": 85,
                "stop": { "type": "value", "value": 88 }, "cooldownSec": 60 },
              { "id": "r2", "sensor": "S1", "metric": "temperature", "operator": "above", "threshold": 30,
                "stop": { "type": "duration", "onSec": 60 }, "cooldownSec": 300 }
            ] },
    "A2": { "mode": "timer", "maxRunSec": 3600, "minIntervalSec": 0, "rules": null,
            "schedules": [
              { "id": "a1b2c3d4", "type": "at", "at": "07:00", "onSec": 300, "days": [1, 2, 3, 4, 5] },
              { "id": "e5f6a7b8", "type": "every", "intervalSec": 3600, "onSec": 600, "window": "06:00-18:00", "days": [1, 2, 3, 4, 5, 6, 7] }
            ] }
  }
}
```

- `utcOffsetMin`: offset jam lokal farm (WIB = 420) untuk `at`, `window`, dan `days`. Butuh jam tersinkron SNTP.
- `days`: hari ISO, 1 = Senin … 7 = Minggu.
- `schedules` hanya berisi jadwal aktif dan hanya dikirim saat `mode: "timer"`; `rules` hanya aturan aktif saat `mode: "auto"`.
- **Semua jadwal & aturan disimpan di NVS dan dieksekusi gateway sendiri** — cloud tidak menyalakan aktuator otomatis, sehingga tidak ada jeda jaringan dan tetap berjalan saat offline.

Penanganan:

1. `version` < versi di NVS → abaikan (retained usang). Sama → kirim ulang ACK saja.
2. Lebih baru → **simpan ke NVS dulu**, lalu terapkan: aktuator yang konfigurasinya berubah dimatikan dan engine-nya direset.
3. Publish `ack` config (§3.6) dan `state`.
4. `actuators` kosong = perangkat dilepas pemilik → semua relay OFF, otomasi berhenti.
5. Saat boot tanpa jaringan, pakai config dari NVS.

## 5. Mode & proteksi (dijalankan di ESP32)

| Prioritas | Aturan |
|---|---|
| 1. Proteksi | Relay OFF saat boot/watchdog reset; ON tidak pernah melebihi `maxRunSec`; `estop` selalu berlaku. |
| 2. Override manual | `cmd` `on` saat `timer`/`auto` menahan engine aktuator itu sampai relay mati (lihat §4.1 butir 6). |
| 3. Mode aktif | `manual`: hanya `cmd` (dan tombol fisik). `timer`: tiap jadwal — `at`: ON `onSec` sekali pada menit `at` di hari `days`; `every`: ON `onSec` tiap `intervalSec` di dalam `window` (opsional) pada hari `days`; bila relay sudah ON, pemicu dilewati. `auto`: saat relay OFF dan jeda lewat, aturan pertama yang kondisinya terpenuhi (`operator` `below`/`above` `threshold`) menyalakan relay (`trigger.rule`). OFF ketika `stop.type: "duration"` habis (`onSec`) atau `stop.type: "value"` tercapai (`below` → nilai ≥ `stop.value`; `above` → nilai ≤ `stop.value`). ON otomatis tetap dibatasi `maxRunSec`. Setelah mati, aturan menunggu `cooldownSec`; setelah OFF manual, tunggu `cooldownSec` terbesar. |
| 4. Sensor acuan `auto` tidak terbaca > 180 dtk | Relay OFF, `source: "protection"`. |

Engine jadwal/otomatis berjalan dari config NVS **walau MQTT/Wi-Fi terputus**.

## 6. Siklus hidup perangkat

1. **Pabrik:** `npm run factory -w apps/api -- --count N --out-dir ../../provisioning --host <broker>` → isi `<hwUid>.json` (hwUid, device secret, broker) ke NVS gateway (mis. lewat halaman setup firmware referensi), cetak label UID + kode klaim dari `labels.csv`. Broker Tandurai langsung menerima perangkat baru; Mosquitto perlu `mosquitto_passwd`. Validasi: `npm run device:check -w apps/api -- --hw-uid <hwUid>`.
2. **Instalasi:** Wi-Fi via captive portal → SNTP → connect MQTT → `register`/`status`.
3. **Klaim (dashboard):** user memasukkan UID + kode klaim → pratinjau sensor/aktuator → klaim → backend mengirim `config` v1 → perangkat ACK → sensor/aktuator aktif.
4. **Operasi:** telemetry, heartbeat, command, config sesuai di atas.
5. **Lepas klaim:** backend mengirim config kosong; perangkat mematikan semua relay. Bisa diklaim akun lain dengan kode yang sama.

## 7. Checklist penerimaan firmware

- [ ] Login ditolak dengan secret salah; clientId ≠ hwUid ditolak.
- [ ] `register` + `status` terkirim setelah connect; LWT terkirim saat kabel jaringan dicabut.
- [ ] Command `on 60` → ACK `success` < 2 dtk; relay mati tepat 60 dtk walau Wi-Fi diputus.
- [ ] Command yang sama dikirim ulang → tidak dieksekusi dua kali.
- [ ] Command dibuat saat perangkat offline → setelah reconnect ACK `expired`, relay tidak menyala.
- [ ] Config baru → tersimpan di NVS, ACK < 5 dtk; setelah restart tanpa internet tetap memakai config tersebut.
- [ ] Jadwal (`at` & `every`, per hari) dan aturan otomatis (mati setelah durasi / saat kembali normal) berjalan tanpa internet dan `state` melaporkan `trigger`; command manual menjadi override sementara lalu engine melanjutkan; `estop` selalu berhasil.
- [ ] Relay OFF setelah power cycle dan watchdog reset.
