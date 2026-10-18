# TANDURAI Local AI Worker

> **Sumber data:** `DATA_SOURCE=api` (default) membaca/menulis lewat API worker backend `apps/api` (`BACKEND_URL`, `WORKER_TOKEN` sama dengan `apps/api/.env`) — tanpa Firebase. `DATA_SOURCE=firebase` memakai RTDB lama dengan service account (langkah di bawah).

Worker berjalan di laptop/server lokal dan memakai Firebase Admin SDK. Model tidak pernah masuk browser. Worker menyediakan koneksi Firebase, feature engineering harian, inferensi model lokal, provenance, dan penyimpanan forecast terversi.

## Persyaratan

- Python 3.11–3.13 (scikit-learn 1.8.0 butuh ≥ 3.11; Ubuntu 24.04 bawaan 3.12 bisa dipakai).
- Akses ke project Firebase demo `tandurai-ai`.
- Service-account JSON yang disimpan lokal.

## Instalasi Windows

```powershell
cd jamur\local_ai_worker
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[dev]"
Copy-Item .env.example .env
```

File `.env` lokal untuk project demo sudah dapat memakai database URL demo. Jangan commit `.env` atau credential.

## Credential Firebase Admin

1. Buka Firebase Console → project `tandurai-ai`.
2. Buka Project settings → Service accounts.
3. Pilih **Generate new private key**.
4. Buat folder `local_ai_worker/credentials`.
5. Simpan file sebagai `local_ai_worker/credentials/firebase-admin.json`.
6. Jangan mengunggah atau mengirim file tersebut. Folder sudah diabaikan Git.

Credential memberi akses administratif penuh ke RTDB. Gunakan hanya project demo dan rotasi/hapus key setelah demo selesai.

## Command

Pemeriksaan lokal tanpa koneksi Firebase:

```powershell
python -m worker health
```

Pemeriksaan live. Command membaca latest sensor dan menulis heartbeat ke `tumbara/aiWorker/status`:

```powershell
python -m worker health --live
```

Membaca latest telemetry tanpa menulis:

```powershell
python -m worker read-sensors
```

Membangun fitur tanpa menulis:

```powershell
python -m worker build-features --date 2026-07-15 --dry-run
```

Menjalankan inferensi. Tanpa flag demo, data yang belum cukup akan ditahan:

```powershell
python -m worker run-once --date 2026-07-15 --dry-run
python -m worker run-once --date 2026-07-15 --demo-synthetic-fill --dry-run
python -m worker run-once --date 2026-07-15 --demo-synthetic-fill

# Skenario contoh terbaik: lingkungan baik dan P50 model tertinggi
python -m worker run-once --date 2026-07-15 --demo-best-case
```

Mode demo selalu menyimpan provenance sintetis pada payload dan tidak mencemari histori telemetry ESP32.

## Exit code

| Code | Arti |
|---:|---|
| 0 | Berhasil |
| 2 | Konfigurasi/credential belum valid |
| 3 | Operasi Firebase gagal |
| 4 | Kegagalan command tak terduga |

## Log dan state

- Structured JSON log: `runtime/logs/worker.jsonl`.
- Rotasi: 5 MB, tiga backup.
- Runtime state: `runtime/state/`.
- Keduanya diabaikan Git.

## Test

```powershell
pytest
```

Unit test memakai Firebase client palsu; tidak membaca credential dan tidak menulis project live.

## Mode otomatis untuk demo web

Jalankan worker berikut dan biarkan terminal tetap terbuka:

    python -m worker watch --interval 3

Ketika pengguna berhak membuka halaman **Perkiraan Panen**, web menulis permintaan ke tumbara/aiRequests/{kumbungId}. Worker membaca batch aktif terbaru. Pada fase inokulasi/inkubasi, worker membuat proyeksi panen pertama dari pola siklus sintetis sambil mempertahankan jumlah baglog aktual. Pada fase pembentukan dan panen, worker memakai mode hybrid_synthetic_fill: jumlah baglog, fase, umur batch, data panen, dan sensor yang tersedia dipertahankan; hanya fitur yang belum tersedia diisi dari benchmark sintetis.

Target model tetap harvest_next_7d_kg. Untuk menjaga jumlah baglog sebagai dasar skala, inferensi menghitung hasil pada referensi 10.000 baglog lalu menskalakan kilogram secara linear ke baglogCountActive. Hal ini sesuai generator data sintetis yang membentuk kapasitas panen secara linear dari jumlah baglog, tetapi tetap bukan klaim akurasi lapangan.

Periode yang ditampilkan adalah tujuh hari setelah tanggal perhitungan. Batch tahap awal dapat menghasilkan nol untuk periode tersebut; itu berarti panen belum diperkirakan terjadi minggu itu, bukan berarti seluruh siklus tidak menghasilkan panen.

## Model total panen batch (v3, histori kondisi)

Perkiraan total panen di web memakai model batch v3:

- Worker mengambil telemetry **sejak batch dimulai** (maks 120 hari) dan menghitung `batchHistory`: rata-rata, simpangan baku, dan persentase waktu di rentang optimal untuk suhu (22–28 °C), kelembapan (80–90 %), dan CO₂ (≤ 1000 ppm).
- Hasil per baglog aktif ±0,30 kg bila histori hampir selalu buruk dan ±0,50 kg bila selalu optimal, yaitu 300–500 kg per 1.000 baglog aktif.
- Isian sintetis mode demo tidak dipakai untuk total panen bila histori sensor tersedia.
- Bila histori belum cukup (< ±6 jam data), model memakai kondisi netral (±400 kg/1.000 baglog), tingkat kepastian "Rendah", dan risiko `no_sensor_history`.
- Forecast menyertakan `conditionHistory` (% optimal per parameter, hari data) dan `prediction.kgPer1000ActiveBaglogs`.

