# Kontrak Data AI TANDURAI — Firebase Demo

## Scope dan project

- Project production `tumbara-bea7a` tidak diubah.
- Project demo: `tandurai-ai`.
- RTDB demo: `https://tandurai-ai-default-rtdb.asia-southeast1.firebasedatabase.app`.
- Timezone bisnis: `Asia/Jakarta`.
- Timestamp disimpan sebagai Unix epoch millisecond UTC; tanggal agregasi memakai hari kalender Asia/Jakarta.

## Format ID

| Entitas | Format | Contoh |
|---|---|---|
| Farm | `FARM-{NN}` | `FARM-01` |
| Kumbung | `{farmId}-K{NN}` | `FARM-01-K01` |
| Sensor | `SNS-{NNNN}` | `SNS-0101` |
| Batch | `{kumbungId}-B{NN}` | `FARM-01-K01-B01` |
| Forecast | `{yyyy-mm-dd}_{modelVersion}` dengan karakter key Firebase yang aman | `2026-07-15_histgb-ref-v1` |

ID tidak boleh diubah setelah data turunan atau forecast dibuat.

## Struktur RTDB

```text
users/{uid}/profile
users/{uid}/settings
users/{uid}/access/role
users/{uid}/access/farms/{farmId}
tumbara/farms/{farmId}
tumbara/kumbungs/{kumbungId}
tumbara/farmKumbungs/{farmId}/{kumbungId}
tumbara/baglogBatches/{batchId}
tumbara/kumbungBatches/{kumbungId}/{batchId}
tumbara/monitoring/{kumbungId}/{sensorId}
tumbara/history/{kumbungId}/{yyyy-mm-dd}/{sensorId}_{bucketStart}
tumbara/dailyTelemetry/{kumbungId}/{yyyy-mm-dd}
tumbara/harvestEvents/{kumbungId}/{eventId}
tumbara/aiFeaturesDaily/{kumbungId}/{yyyy-mm-dd}
tumbara/aiForecasts/{kumbungId}/latest
tumbara/aiForecasts/{kumbungId}/history/{forecastId}
tumbara/aiActuals/{kumbungId}/{forecastId}
tumbara/aiWorker/status
```

## Payload telemetry

```json
{
  "timestamp": 1784077200000,
  "farmId": "FARM-01",
  "kumbungId": "FARM-01-K01",
  "sensorId": "SNS-0101",
  "temperature": 27.4,
  "humidity": 82.1,
  "co2": 695,
  "pressure": 1008.2,
  "airflow": null,
  "substrateMoisture": null,
  "light": null,
  "fanStatus": false,
  "fanSpeedPct": 0,
  "mistingStatus": false,
  "schemaVersion": "telemetry-v1"
}
```

Unit: suhu °C, RH %, CO2 ppm, tekanan hPa, airflow m/s, kelembapan substrat %, cahaya lux, dan runtime controller dalam persen. Nilai tidak diketahui tidak boleh diubah menjadi nol palsu. Karena RTDB memperlakukan `null` sebagai penghapusan properti, pengirim menghilangkan field tersebut dan mencatat namanya pada `quality/missingSensors`; pembaca menormalkannya kembali menjadi `null`.

## Payload batch baglog

```json
{
  "farmId": "FARM-01",
  "kumbungId": "FARM-01-K01",
  "startedAt": 1781485200000,
  "baglogCountInitial": 1000,
  "baglogCountActive": 980,
  "substrateType": "campuran",
  "growthStage": "fruiting",
  "contaminationPct": 2.0,
  "status": "active",
  "createdBy": "firebase-auth-uid",
  "createdAt": 1781485200000,
  "updatedAt": 1784077200000,
  "schemaVersion": "baglog-batch-v1"
}
```

## Payload event panen

```json
{
  "farmId": "FARM-01",
  "kumbungId": "FARM-01-K01",
  "batchId": "FARM-01-K01-B01",
  "harvestedAt": 1784077200000,
  "weightKg": 18.5,
  "grade": "A",
  "gradeAPct": 84,
  "recordedBy": "firebase-auth-uid",
  "createdAt": 1784077200000,
  "schemaVersion": "harvest-event-v1"
}
```

Event panen bersifat append-only dari client. Koreksi dilakukan sebagai event audit pada tahap implementasi form, bukan mengubah histori tanpa jejak.

## Payload forecast

```json
{
  "status": "ok",
  "kumbungId": "FARM-01-K01",
  "asOfDate": "2026-07-15",
  "generatedAt": 1784077200000,
  "horizonDays": 7,
  "forecastKg": 126.4,
  "p10Kg": 103.0,
  "p50Kg": 124.8,
  "p90Kg": 151.2,
  "confidence": "medium",
  "supplyCommitmentKg": 103,
  "dataQuality": {
    "completenessPct": 94.2,
    "missingFeatures": ["airflow_mean_ms"]
  },
  "model": {
    "pointVersion": "histgb-reference-v1",
    "quantileVersion": "quantile-v1",
    "schemaVersion": "harvest-features-v1",
    "evidenceScope": "synthetic_benchmark",
    "fieldValidated": false
  },
  "idempotencyKey": "FARM-01-K01_2026-07-15_histgb-reference-v1"
}
```

## Matriks akses

| Path | Viewer | Operator | Manager | Admin | Python Worker |
|---|---:|---:|---:|---:|---:|
| Profil/settings sendiri | RW | RW | RW | RW | Admin SDK |
| Access/role/farm membership | R sendiri | R sendiri | R sendiri | R | Admin SDK/bootstrap console |
| Farm/kumbung | R sesuai farm | R sesuai farm | RW sesuai farm | RW | Admin SDK |
| Telemetry/history | R sesuai farm | RW sesuai farm | RW sesuai farm | RW | Admin SDK |
| Batch | R sesuai farm | R | RW sesuai farm | RW | Admin SDK |
| Event panen | R | Create | Create | Create | Admin SDK |
| Fitur/forecast/actual | R sesuai farm | R sesuai farm | R sesuai farm | R | RW melalui Admin SDK |
| Worker status | - | - | R | R | RW melalui Admin SDK |

Client tidak pernah diberi write ke fitur, forecast, actual, atau status worker. Firebase Admin SDK pada worker melewati RTDB Rules; karena itu JSON credential hanya boleh berada pada komputer worker.

## Bootstrap user demo

1. Buat user melalui Authentication atau halaman register.
2. Salin UID user.
3. Pada Firebase Console RTDB, tambahkan secara manual:

```text
users/{uid}/access/role = manager
users/{uid}/access/farms/FARM-01 = true
```

4. Ganti placeholder UID pada fixture sebelum mengimpor fixture jika fixture digunakan.

Bootstrap melalui Console dilakukan oleh pemilik project. Client tidak dapat mengangkat role dirinya sendiri.

## Adapter path lama

Path lama `tumbara/monitoring/sensor1` dipertahankan sementara sebagai `FIREBASE_PATHS.legacySensor`. Data baru harus memakai `tumbara/monitoring/{kumbungId}/{sensorId}`. Tahap 3 akan memindahkan pembacaan halaman lama ke adapter dan menetapkan masa penghentian path `sensor1`.

Histori lama berbentuk `tumbara/history/{pushId}` tidak dipakai pada project demo karena bertabrakan dengan isolasi per-kumbung. Project demo langsung memakai struktur baru.
