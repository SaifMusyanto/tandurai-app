# Tahap 6 — Feature Engineering Harian

Status: selesai diimplementasikan dan diuji pada Firebase demo `tandurai-ai` tanggal 15 Juli 2026.

## Hasil implementasi

- Worker membaca histori telemetry 14 hari, batch aktif, dan event panen per kumbung.
- Hari bisnis dan batas agregasi memakai `Asia/Jakarta`; semua timestamp RTDB tetap epoch millisecond UTC.
- Schema `harvest-features-v1` mengikuti `FEATURE_COLUMNS` model secara persis: **37 fitur** (33 numerik dan 4 kategorikal). Angka 36 pada rencana awal telah dikoreksi.
- Agregasi mencakup mean/min/max/sample-std, runtime controller, jam stres, master baglog, lag panen, rolling tujuh hari, serta encoding hari.
- Telemetry dan panen pada atau setelah cutoff tidak ikut dihitung. Rolling lingkungan hanya memakai tujuh hari sebelum `asOfDate`.
- Nilai sensor/rolling yang tidak diketahui tetap `null` pada `featureVector` dan dicatat pada `dataQuality.missingFeatures`. RTDB menghapus properti object yang bernilai null, sehingga object `features` hanya menyimpan nilai tersedia.
- Tidak adanya event panen pada hari lampau dianggap panen 0 kg karena `harvestEvents` merupakan ledger operasional append-only.
- Payload audit ditulis ke `tumbara/aiFeaturesDaily/{kumbungId}/{yyyy-mm-dd}`. Tahap ini tidak menjalankan model dan tidak menulis forecast.

## Gate kualitas

Status menjadi `insufficient_data` jika batch aktif/fitur wajib tidak ada, completeness telemetry di bawah 50% (kurang dari 72 dari target 144 sampel per hari), atau hari belum selesai. Payload tetap disimpan agar penyebabnya dapat diaudit.

Contoh nyata tanggal `2026-07-15`:

- batch: `FARM-01-K01-B01`
- feature count: 37, cocok persis dengan modul model
- sample count: 1/144 (0,69%)
- status: `insufficient_data`
- alasan: completeness di bawah 50% dan hari belum selesai
- forecast written: `false`

Status tersebut benar dan aman; worker tidak mengarang data yang belum tersedia.

## Perintah

```powershell
cd jamur\local_ai_worker
.\.venv\Scripts\Activate.ps1

# Tanggal default adalah kemarin di Asia/Jakarta, tanpa menulis RTDB
python -m worker build-features --dry-run

# Audit tanggal tertentu tanpa write
python -m worker build-features --date 2026-07-15 --dry-run

# Hitung dan simpan payload audit ke Firebase demo
python -m worker build-features --date 2026-07-15

# Siklus worker tetap aman dan tidak menulis forecast pada Tahap 6
python -m worker run-once --dry-run
```

Tidak ada konfigurasi baru yang perlu diisi pengguna. Worker memakai `.env` dan Firebase Admin credential yang sudah lolos health check Tahap 5.

## Verifikasi

- `pytest`: 13 test lulus.
- Schema check: model 37, worker 37, exact match `true`.
- Test mencakup golden aggregation, missing value, timezone, batas cutoff, lag anti-leakage, rolling anti-leakage, dan insufficient data.
- Live write/readback demo: payload ditemukan, schema `harvest-features-v1`, feature count 37, sample count 1, `forecastWritten=false`.

## Syarat data sebelum Tahap 7 menghasilkan forecast

ESP32 perlu mengirim histori setiap 10 menit, idealnya minimal 72 sampel/hari dan lengkap 144 sampel/hari. Sensor `airflow`, `substrateMoisture`, dan `light` yang belum tersedia tetap boleh null dan akan terlihat sebagai keterbatasan kualitas; model tidak boleh menganggapnya nol.
