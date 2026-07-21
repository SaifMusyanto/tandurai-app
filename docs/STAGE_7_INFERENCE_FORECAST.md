# Tahap 7 — Inferensi dan Penyimpanan Forecast

Status: selesai diimplementasikan dan diverifikasi pada Firebase demo `tandurai-ai` tanggal 15 Juli 2026.

## Keputusan provenance data

Data sintetis boleh dipakai untuk demonstrasi, tetapi tidak disamarkan sebagai data lapangan. Worker menyediakan `--demo-synthetic-fill` yang:

- mempertahankan fitur hasil telemetry/master yang tersedia;
- mengisi hanya fitur kosong dari `daily_model_table.csv` secara deterministik;
- tidak menulis telemetry sintetis ke path histori ESP32;
- mencatat daftar fitur yang diisi, hash dataset, dan kategori yang diadaptasi;
- menetapkan forecast `status=demo`, `evidenceScope=synthetic_benchmark`, dan `fieldValidated=false`.

Tanpa flag tersebut, worker menahan forecast jika fitur berstatus `insufficient_data` dan tidak menimpa forecast valid terakhir.

## Artefak dan compatibility gate

- Point model: `histgradientboosting_reference.joblib`.
- Interval: `quantile_regression.joblib` untuk P10/P50/P90.
- Artefak dibuat dengan scikit-learn 1.8.0, sehingga dependency worker dikunci tepat ke `scikit-learn==1.8.0`.
- Worker memverifikasi urutan 37 fitur, versi library, keberadaan artefak, serta SHA-256 sebelum inferensi.
- Manifest menyimpan checksum, versi model, schema, batas tanggal training/validation, asal training sintetis, dan status validasi lapangan.

Adapter kategori yang tercatat pada forecast:

- `harvesting` → `fruiting`
- `campuran` → `mixed_agri_waste`
- mapping lain mengikuti padanan stage dan substrat antara aplikasi dengan training model.

## Penyimpanan

Worker menulis secara atomik:

```text
tumbara/aiForecasts/{kumbungId}/latest
tumbara/aiForecasts/{kumbungId}/history/{idempotencyKey}
```

Idempotency key dibentuk dari kumbung, tanggal bisnis, dan versi point model. Re-run tanggal/model yang sama memperbarui entry history yang sama, bukan membuat duplikasi.

Forecast mencakup point estimate, P10/P50/P90 terurut dan non-negatif, confidence, `floor(P10)` sebagai supply commitment, faktor risiko deterministik, feature hash, data quality, provenance, serta manifest model. `days_to_next_harvest` tidak dibuat karena artefaknya tidak tersedia.

## Command

```powershell
cd jamur\local_ai_worker
.\.venv\Scripts\Activate.ps1

# Data tidak cukup: aman, forecast ditahan
python -m worker run-once --date 2026-07-15 --dry-run

# Forecast demo tanpa write
python -m worker run-once --date 2026-07-15 --demo-synthetic-fill --dry-run

# Forecast demo dan simpan ke Firebase demo
python -m worker run-once --date 2026-07-15 --demo-synthetic-fill
```

## Checkpoint live

- schema: `harvest-forecast-v1`
- status: `demo`
- point forecast: 0,00 kg
- P10/P50/P90: 0,00 / 0,00 / 34,30 kg
- confidence: low
- supply commitment: 0 kg
- input: 25 fitur teramati/operasional dipertahankan, 12 fitur kosong diisi referensi sintetis
- latest dan history ditemukan dengan idempotency key yang sama
- model `fieldValidated=false`; tidak ada klaim akurasi lapangan

Nilai nol merupakan keluaran model untuk kombinasi cycle/lag saat ini, bukan error runtime. Interval yang lebar menunjukkan ketidakpastian tinggi.

## Pengujian

- 17 test lulus.
- Dependency check lulus.
- Mencakup output non-negatif, urutan quantile, provenance demo wajib, idempotensi, artefak hilang, feature engineering, anti-leakage, dry-run, dan gate insufficient data.
- Live atomic write/readback Firebase berhasil.



## Mode skenario terbaik untuk demonstrasi

Command berikut memilih kondisi lingkungan baik dari dataset sintetis, kemudian memilih kandidat dengan P50 tertinggi menggunakan model quantile yang sama:

```powershell
python -m worker run-once --date 2026-07-15 --demo-best-case
```

Mode ini tetap berstatus `demo`, mencatat `full_synthetic_best_case`, sumber baris, aturan pemilihan, serta hash dataset. Angka tidak ditulis manual. P10 model tetap ditampilkan apa adanya dan dapat bernilai nol.
