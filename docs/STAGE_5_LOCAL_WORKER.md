# Checkpoint Tahap 5 — Local AI Worker

## Status

Implementasi worker, pengujian lokal, dan verifikasi koneksi Firebase live selesai pada project demo `tandurai-ai`.

## Komponen

```text
local_ai_worker/
  pyproject.toml
  requirements.txt
  requirements-dev.txt
  .env.example
  worker/
    config.py
    firebase_client.py
    logging_config.py
    commands.py
  tests/
```

Command tersedia:

- `health`: validasi konfigurasi lokal tanpa Firebase.
- `health --live`: read latest telemetry dan write heartbeat `aiWorker/status`.
- `read-sensors`: read latest telemetry tanpa write.
- `run-once --dry-run`: read input dan menegaskan `writePerformed=false`.

## Hasil pengujian

- Unit test: 7 lulus.
- `pip check`: tidak ada dependency rusak.
- Python compile: lulus.
- `health`: exit 0, status `ok`.
- Dry-run tanpa credential: exit 2 dengan pesan konfigurasi, tidak ada write.
- `.env`, `.venv`, runtime log/state, dan credential: diabaikan Git.
- Pencarian private key pada source: tidak ditemukan.

## Verifikasi live

- Firebase Admin connected: `true`.
- Latest sensor ditemukan: `FARM-01-K01/SNS-0101`.
- Heartbeat tersimpan: status `healthy`, worker `0.1.0`.
- `read-sensors`: status `ok`.
- `run-once --dry-run`: status `dry_run_complete`, `writePerformed=false`.

Credential Admin SDK telah disimpan lokal pada:

```text
jamur/local_ai_worker/credentials/firebase-admin.json
```

Command verifikasi:

```powershell
cd jamur\local_ai_worker
.\.venv\Scripts\Activate.ps1
python -m worker health --live
python -m worker read-sensors
python -m worker run-once --dry-run
```

Seluruh kriteria live tersebut sudah terpenuhi. Tahap 5 siap menjadi fondasi feature engineering pada Tahap 6.

## Keamanan

Service-account melewati RTDB Security Rules dan memiliki hak administratif. Key hanya digunakan pada project demo, tidak dikirim melalui chat, dan sebaiknya dihapus/dirotasi setelah demo selesai.
