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

Gunakan akun Firebase Authentication khusus perangkat dengan role `operator` dan hanya akses ke farm terkait. Jangan memakai akun petani permanen atau menaruh password di firmware yang di-commit. Untuk perangkat demo, simpan konfigurasi Wi-Fi/Auth dalam `secrets.h` yang diabaikan Git.

Sebelum firmware tersedia, `node tools/telemetry-simulator.mjs` mereplikasi alur pengiriman dan rules yang sama.
