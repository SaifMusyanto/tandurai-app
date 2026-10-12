# ESP32 Telemetry v1

## Tujuan dan interval

ESP32 mengirim nilai terbaru setiap perubahan/siklus pembacaan, tetapi menulis histori maksimal satu kali setiap 10 menit. ID histori deterministik (`{sensorId}_{bucketStart}`) mencegah duplikasi setelah restart.

Urutan pengiriman:

1. Sinkronkan jam melalui NTP dan buat Unix epoch millisecond UTC.
2. Baca sensor memakai unit baku: °C, RH %, ppm, hPa, m/s, %, dan lux.
3. Tandai field hilang atau tidak valid dalam `quality`; jangan mengubahnya menjadi nol.
4. Tulis latest ke `tumbara/monitoring/{kumbungId}/{sensorId}`.
5. Jika bucket 10 menit belum ada, tulis salinan dengan `bucketStart` ke `tumbara/history/{kumbungId}/{yyyy-mm-dd}/{sensorId}_{bucketStart}`.
6. Tanggal path dihitung dalam `Asia/Jakarta`, sedangkan timestamp tetap UTC.

Firebase RTDB tidak menyimpan properti bernilai `null`—nilai `null` berarti menghapus properti. Karena itu field sensor yang tidak tersedia dihilangkan dari payload RTDB dan namanya dicatat di `quality/missingSensors`. Pembaca web menormalkannya kembali menjadi `null`.

## Payload latest

```json
{
  "timestamp": 1784080800000,
  "farmId": "FARM-01",
  "kumbungId": "FARM-01-K01",
  "sensorId": "SNS-0101",
  "temperature": 27.4,
  "humidity": 82.1,
  "co2": 695,
  "pressure": 1008.2,
  "fanStatus": false,
  "fanSpeedPct": 0,
  "mistingStatus": false,
  "quality": { "status": "degraded", "missingSensors": ["airflow", "substrateMoisture", "light"] },
  "schemaVersion": "telemetry-v1"
}
```

Payload history sama, ditambah `bucketStart`, yaitu timestamp yang dibulatkan turun ke kelipatan 600.000 ms.

## Autentikasi perangkat

Gateway login langsung dengan Firebase **Anonymous Auth** (REST `accounts:signUp`, lalu refresh token). Owner memasangkan UID perangkat ke ID gateway dari aplikasi; Rules mengenali gateway melalui `tumbara/gatewayAuthUids/{uid}` dan hanya mengizinkan write untuk sensor yang ditugaskan ke gateway tersebut. Akun manusia (owner/operator) tidak dapat menulis telemetry. Jangan menaruh password, service account, atau token di firmware yang di-commit. Rincian: [`task/simulasi-gateway-esp32-firebase.md`](task/simulasi-gateway-esp32-firebase.md).

Sebelum firmware tersedia, `npm run simulate:gateway -- <provision|run|status|reset> --gateway <ID>` meniru gateway melalui REST, dan `npm run test:gateway-sim` menguji alurnya di emulator. `tools/telemetry-simulator.mjs` lama login sebagai akun manusia sehingga ditolak oleh Rules gateway-only.
