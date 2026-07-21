# Checkpoint Tahap 3 — Telemetry dan Retensi

## Keputusan implementasi

- Latest: setiap siklus ESP32 ke `monitoring/{kumbungId}/{sensorId}`.
- History: satu sampel per bucket 10 menit, atau 144 sampel/hari/sensor.
- Timestamp: epoch millisecond UTC; shard tanggal memakai `Asia/Jakarta`.
- Stale: tidak ada update lebih dari 15 menit.
- Out-of-range: ditolak RTDB Rules dan ditandai oleh utilitas kualitas sebelum pengiriman.
- Missing: field tidak dikirim ke RTDB dan dicantumkan pada `quality/missingSensors`.
- Legacy: web mencoba telemetry-v1 lebih dahulu dan hanya membaca `monitoring/sensor1` bila path baru belum ada. Client tidak lagi menulis histori.

## Query web

Monitoring hanya membaca shard hari yang bersinggungan dengan filter satu jam, 24 jam, atau tujuh hari. Setiap query memakai `orderByChild(timestamp)`, `startAt`, `endAt`, dan batas jumlah titik. Ini mencegah download seluruh histori.

## Retensi gratis

Raw history dipertahankan 30 hari. Sebelum menghapus satu shard hari:

1. Export `tumbara/history/{kumbungId}/{yyyy-mm-dd}` ke `local_ai_worker/runtime/archive/`.
2. Jalankan `node tools/summarize-telemetry-export.mjs <raw-day.json> <summary.json>`.
3. Verifikasi `sampleCount`, source window, dan agregat.
4. Worker/Admin SDK menyimpan summary ke `tumbara/dailyTelemetry/{kumbungId}/{yyyy-mm-dd}`.
5. Baru hapus raw shard melalui Admin SDK/Console. Client biasa tidak diberi izin delete.

Penghapusan belum dijalankan pada project demo karena belum ada data berumur lebih dari 30 hari.

## Estimasi storage

Dengan interval 10 menit terdapat 144 row/hari. Asumsi konservatif 600 byte/row menghasilkan sekitar 86,4 KB/hari/sensor, 2,59 MB untuk 30 hari, atau 31,5 MB/tahun tanpa retensi. Latest dan summary harian relatif kecil. Angka nyata perlu dibandingkan dengan Usage Firebase setelah ESP32 aktif karena overhead key dan bentuk payload dapat berubah.

## Simulator

PowerShell:

```powershell
$env:TELEMETRY_EMAIL='akun-perangkat@example.com'
$env:TELEMETRY_PASSWORD='password-lokal'
node tools/telemetry-simulator.mjs
Remove-Item Env:TELEMETRY_EMAIL, Env:TELEMETRY_PASSWORD
```

Credential hanya berada pada environment proses dan tidak ditulis ke repository.
