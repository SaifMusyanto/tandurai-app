# Rencana Implementasi AI dengan Arsitektur Gratis

## Arsitektur

```text
ESP32
  ↓
Firebase Realtime Database (Spark/gratis)
  ↓
Python AI Worker di laptop/server lokal
  ↓
Model menghitung forecast panen
  ↓
Python AI Worker menyimpan hasil ke Firebase
  ↓
React menampilkan AI Forecast
```

Model hanya berjalan pada Python AI Worker. Firebase digunakan untuk Authentication, RTDB, dan web yang sudah ada. Prediksi awal wajib berlabel `pilot` dan `synthetic_benchmark` sampai validasi lapangan selesai.

Setiap tahap dikerjakan setelah instruksi eksplisit, diuji, lalu berhenti pada checkpoint sebelum melanjutkan.

## Tahap 1 — Baseline, keamanan, dan konfigurasi lokal

Tujuan: menyiapkan fondasi aman sebelum worker mengakses Firebase.

Pekerjaan:

- Catat status build, lint, test, dan perubahan Git awal.
- Rotasi credential yang saat ini tersimpan di source frontend dan file environment contoh.
- Hapus hardcoded secret dari frontend tanpa mencetak nilainya.
- Masukkan `.env`, credential Firebase Admin, log, dan runtime state ke `.gitignore`.
- Buat `local_ai_worker/.env.example` tanpa nilai rahasia.
- Tentukan lokasi log dan state worker lokal.

Pengujian:

- Repository dan bundle frontend tidak mengandung credential aktif.
- Build frontend tetap berhasil.
- Credential lokal tidak muncul di `git status`.

Selesai jika tidak ada secret aktif di frontend/file contoh, baseline tercatat, dan konfigurasi worker dapat dibuat tanpa memasukkan secret ke Git.

Checkpoint: laporkan temuan keamanan, file berubah, serta hasil baseline.

## Tahap 2 — Kontrak data dan struktur RTDB

Tujuan: membekukan ID, path, tipe data, dan hak akses.

Struktur target:

```text
tumbara/
  farms/{farmId}
  kumbungs/{kumbungId}
  baglogBatches/{batchId}
  monitoring/{kumbungId}/{sensorId}
  history/{kumbungId}/{yyyy-mm-dd}/{pushId}
  harvestEvents/{kumbungId}/{eventId}
  aiFeaturesDaily/{kumbungId}/{yyyy-mm-dd}
  aiForecasts/{kumbungId}/latest
  aiForecasts/{kumbungId}/history/{forecastId}
  aiActuals/{kumbungId}/{forecastId}
  aiWorker/status
```

Pekerjaan:

- Tetapkan format `farmId`, `kumbungId`, `sensorId`, dan `batchId`.
- Tetapkan `harvest-features-v1` dan `harvest-forecast-v1`.
- Dokumentasikan payload telemetry, batch, panen, fitur, forecast, dan worker status.
- Buat adapter path lama `tumbara/monitoring/sensor1` ke kumbung default.
- Tambahkan RTDB Security Rules, validasi tipe, role, dan index timestamp.
- Pastikan frontend tidak dapat menyamar sebagai AI Worker.

Pengujian dilakukan dengan Firebase Emulator: akses anonim ditolak, user yang benar dapat membaca forecast, write lintas role ditolak, dan payload tidak valid ditolak.

Selesai jika semua komponen menggunakan kontrak yang sama dan adapter lama terpusat.

Checkpoint: tunjukkan kontrak data dan matriks hak akses.

## Tahap 3 — Pipeline telemetry ESP32 dan retensi

Tujuan: menyediakan histori sensor persisten per kumbung dengan penggunaan kuota terkendali.

Pekerjaan:

- Payload ESP32 memuat timestamp, farm, kumbung, sensor, dan unit konsisten.
- Simpan nilai terbaru ke `monitoring` dan histori setiap 5–10 menit.
- Query web dibatasi berdasarkan kumbung dan rentang tanggal.
- Tambahkan flag sensor stale, nilai tidak valid, dan sensor hilang.
- Atur retensi: arsip lokal lebih dulu, hapus data mentah lama, pertahankan ringkasan harian.
- Pertahankan adapter `sensor1` selama migrasi.

Pengujian:

- Kirim telemetry contoh dan pastikan tidak terjadi duplikasi berlebihan.
- Uji konversi UTC/Asia Jakarta, sensor stale, dan nilai out-of-range.
- Hitung estimasi pertumbuhan storage harian.

Selesai jika satu kumbung memiliki histori queryable, unit/timestamp konsisten, kuota diperkirakan aman, dan UI lama tetap bekerja.

Checkpoint: laporkan payload nyata, interval histori, dan estimasi kuota.

## Tahap 4 — Master kumbung, batch baglog, dan panen

Tujuan: mengumpulkan data operasional yang tidak tersedia dari sensor.

Pekerjaan:

- Buat form farm dan kumbung.
- Buat lifecycle batch: tanggal mulai, jumlah baglog, substrat, growth stage, kontaminasi, dan status.
- Buat form panen: waktu, berat, batch, grade, grade A, dan operator.
- Validasi berat, waktu, hubungan batch-kumbung, dan role.
- Event panen append-only atau memiliki audit metadata saat dikoreksi.

Selesai jika satu kumbung memiliki batch aktif lengkap, operator dapat mencatat panen dari web, dan seluruh fitur kategorikal mempunyai sumber data.

Checkpoint: demo-kan pembuatan batch sampai event panen tersimpan.

## Tahap 5 — Kerangka Python AI Worker

Tujuan: membuat aplikasi lokal yang terhubung aman ke RTDB.

Struktur target:

```text
jamur/local_ai_worker/
  README.md
  requirements.txt
  .env.example
  worker/
    config.py
    firebase_client.py
    logging_config.py
    commands.py
  tests/
```

Pekerjaan:

- Gunakan virtual environment terpisah.
- Tambahkan Firebase Admin SDK, paket model lokal, pandas, numpy, scikit-learn, joblib, dan test runner.
- Sediakan command `health`, `read-sensors`, dan `run-once --dry-run`.
- Tambahkan structured log, timeout, exit code, dan heartbeat `aiWorker/status`.

Selesai jika worker dapat dijalankan dari README, terhubung tanpa secret di Git, health check jelas, dan dry-run tidak menulis data.

Checkpoint: laporkan output health/dry-run dan instruksi setup komputer lain.

## Tahap 6 — Feature engineering harian

Tujuan: menghasilkan satu baris 37 fitur yang sesuai `FEATURE_COLUMNS` aktual (33 numerik + 4 kategorikal).

Pekerjaan:

- Agregasi harian mean/min/max/std sensor, runtime controller, dan jam kondisi stres.
- Turunkan jumlah/usia baglog, cycle day, stage, substrat, dan kontaminasi.
- Hitung lag panen 1/3/7/14 hari hanya dari masa lalu.
- Hitung rolling 7 hari dan encoding hari dalam minggu.
- Pertahankan data hilang sebagai `null/NaN`, bukan nol palsu.
- Hitung kelengkapan, fitur hilang, freshness, dan source window.
- Terapkan status `insufficient_data`.
- Simpan fitur ke `aiFeaturesDaily` untuk audit.

Pengujian mencakup agregasi, timezone, missing data, golden row, dan anti-leakage.

Selesai jika nama/urutan fitur tepat, hasil deterministik, leakage test lulus, dan worker dapat menjelaskan data yang kurang.

Checkpoint: tampilkan satu fitur harian dan laporan kualitasnya.

## Tahap 7 — Inferensi dan penyimpanan forecast

Tujuan: menjalankan artefak model dan menyimpan hasil terversi.

Pekerjaan:

- Load `histgradientboosting_reference.joblib` dan `quantile_regression.joblib` sekali saat startup.
- Buat manifest berisi checksum, versi schema, tanggal training, evidence scope, dan field validation.
- Tolak schema/artefak/library yang tidak kompatibel.
- Pastikan output non-negatif dan P10 <= P50 <= P90.
- Hitung confidence dan `supplyCommitmentKg = floor(P10)`.
- Tambahkan faktor risiko deterministik.
- Buat idempotency key dari kumbung, tanggal, dan versi model.
- Simpan `latest` dan `history` secara atomik.
- Jangan tampilkan `days_to_next_harvest` karena artefaknya belum tersedia.

Pengujian mencakup golden inference, artefak rusak, dry-run, idempotensi, dan kewajiban label pilot.

Selesai jika prediksi nyata tersimpan dengan metadata lengkap, dapat ditelusuri ke fitur/model, dan kegagalan tidak menimpa forecast valid terakhir.

Checkpoint: tunjukkan satu payload forecast end-to-end.

## Tahap 8 — Halaman AI Forecast

Tujuan: menampilkan hasil AI secara aman dan mudah dipahami.

Pekerjaan:

- Tambahkan route `/ai-forecast` dan menu sidebar.
- Buat hook/service forecast per kumbung.
- Tampilkan point forecast, P10/P50/P90, komitmen aman, confidence, risiko, kualitas data, metadata, dan histori.
- Tangani loading, empty, insufficient, stale, unauthorized, error, dan success.
- Tampilkan label pilot berdasarkan metadata, bukan teks hardcoded terpisah.

Pengujian mencakup seluruh state, desktop/mobile, lint/build, serta pemeriksaan bahwa model dan credential tidak masuk bundle.

Selesai jika user hanya melihat kumbung yang diizinkan dan semua batas kepercayaan ditampilkan dengan benar.

Checkpoint: demo-kan halaman dengan forecast RTDB nyata.

## Tahap 9 — Ringkasan Dashboard dan penjelasan

Status implementasi: selesai pada 16 Juli 2026.

Tujuan: memasukkan forecast ke aktivitas harian tanpa menjadikan chatbot sumber angka.

Pekerjaan:

- Tambahkan kartu ringkas forecast dan link ke halaman lengkap.
- Pastikan nilai Dashboard berasal dari `aiForecasts/latest` yang sama.
- Chatbot tidak boleh menghitung forecast atau menggunakan secret di browser.
- Jika backend generatif aman tidak tersedia, gunakan insight deterministik lokal.
- Hubungkan risiko ke halaman Monitoring.

Selesai jika angka Dashboard konsisten dengan halaman forecast dan satu-satunya sumber angka resmi adalah Python AI Worker.

Checkpoint: tunjukkan konsistensi kedua tampilan.

## Tahap 10 — Otomasi worker lokal

Tujuan: menjalankan prediksi otomatis tanpa scheduler cloud.

Pekerjaan:

- Tambahkan `run-all` untuk semua kumbung aktif.
- Tambahkan process lock, retry terbatas, timeout, dan idempotensi.
- Simpan waktu mulai/sukses/gagal dan versi worker.
- Siapkan Windows Task Scheduler serta contoh cron Linux/Raspberry Pi.
- Jalankan setelah pergantian hari, misalnya 00:15 Asia/Jakarta.
- Tambahkan task retensi dengan dry-run terlebih dahulu.
- Dokumentasikan startup setelah reboot dan recovery setelah internet mati.

Pengujian mencakup task manual, koneksi putus, Firebase gagal, artefak hilang, proses ganda, stale heartbeat, dan reboot jika memungkinkan.

Selesai jika prediksi berjalan tanpa terminal, kegagalan terlihat, re-run aman, dan worker kembali aktif setelah reboot.

Checkpoint: satu siklus scheduler berhasil dan tercatat di RTDB.

## Tahap 11 — Actual dan evaluasi lapangan

Tujuan: mengukur model setelah horizon tujuh hari selesai.

Pekerjaan:

- Hitung actual panen t+1 sampai t+7 untuk setiap forecast.
- Simpan actual/error tanpa mengubah forecast asli.
- Hitung WAPE, MAE, coverage P10–P90, dan performa per kumbung/stage.
- Tampilkan forecast versus actual.
- Bedakan benchmark sintetis, pilot lapangan, dan status sampel belum cukup.

Pengujian mencakup window target, anti-hindsight, immutability forecast, dan verifikasi metrik manual.

Selesai jika evaluasi reproducible, bebas leakage, dan siap menjadi dasar retraining.

Checkpoint: laporkan jumlah sampel dan metrik hanya saat sampel memadai.

## Tahap 12 — E2E, hardening, dan serah terima

Tujuan: memastikan sistem dapat dioperasikan dan dipulihkan.

Pekerjaan:

- Uji ESP32 → RTDB → worker → model → RTDB → web.
- Jalankan unit, integration, rules, lint, dan build.
- Uji role, isolasi data, serta pola kuota aktual.
- Tambahkan backup/export lokal dan restore.
- Buat runbook setup mesin, rotasi credential, operasi manual, log, worker offline, update/rollback model, dan retensi data.
- Catat known limitations serta kondisi migrasi ke Blaze/Cloud Run.

Selesai jika seluruh acceptance criteria sebelumnya tetap lulus, forecast otomatis tampil di web, recovery tersedia, dan pemilik dapat menjalankan operasi normal.

Checkpoint akhir: serahkan ringkasan implementasi, hasil test, keterbatasan, dan rekomendasi operasional.

## Milestone

| Milestone | Tahap | Hasil |
|---|---:|---|
| Fondasi aman | 1–2 | Secret aman, kontrak dan rules tersedia |
| Data siap AI | 3–4 | Telemetry, batch, dan panen tersimpan |
| Prediksi lokal | 5–7 | Worker menulis forecast nyata ke RTDB |
| Fitur web | 8–9 | Halaman AI Forecast dan kartu Dashboard |
| Otomatis | 10 | Prediksi harian dari laptop/server lokal |
| Terukur | 11 | Forecast dibandingkan dengan actual |
| Selesai | 12 | E2E, runbook, backup, dan recovery lulus |

## Definition of Done keseluruhan

- Model tidak berjalan di browser.
- Semua secret berada di mesin worker dan tidak di Git.
- ID, unit, serta timestamp konsisten per kumbung.
- Feature engineering leakage-safe dan dapat diaudit.
- Point forecast dan P10/P50/P90 berasal dari artefak tersedia.
- Setiap forecast terversi dan idempotent.
- Semua state UI tersedia.
- Worker otomatis, memiliki health/status, dan pulih setelah reboot.
- Penggunaan RTDB dipantau agar aman pada Spark.
- Forecast immutable dan dapat dibandingkan dengan actual.
- Label pilot tetap ada sampai field validation memenuhi gate.
- Runbook instalasi, operasi, backup, dan recovery tersedia.

## Di luar scope arsitektur gratis

- Cloud Run, Cloud Scheduler, dan AI pada Cloud Functions.
- GRU/TFT sebelum mengalahkan baseline pada data lapangan.
- `days_to_next_harvest` sebelum artefaknya tersedia.
- Chatbot dengan secret provider di frontend.
- Klaim akurasi lapangan dari benchmark sintetis.
- Auto-scaling dan high availability.
