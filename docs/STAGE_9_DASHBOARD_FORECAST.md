# Tahap 9 — Ringkasan Dashboard dan Penjelasan

Status: selesai diimplementasikan dan diverifikasi pada 16 Juli 2026.

## Hasil implementasi

- Dashboard memiliki kartu **Ringkasan Perkiraan Panen**.
- Kartu membaca langsung `tumbara/aiForecasts/{kumbungId}/latest` secara real-time; tidak ada perhitungan hasil panen di browser.
- Jika user memiliki beberapa kumbung, Dashboard menampilkan forecast resmi yang paling baru dan selalu menyebut nama kumbung serta batch yang dihitung. Nilai tidak digabung antarbatches.
- Kartu menampilkan perkiraan total, rentang P10–P90, tanggal mulai/akhir masa panen, tingkat kepastian, waktu perhitungan worker, status stale, status batch, dan label data latihan.
- Tombol **Lihat Perkiraan Lengkap** membawa konteks `kumbung` dan `batch` melalui URL. Halaman forecast memilih batch tersebut dan tetap meminta worker menghitung ulang sesuai alur yang sudah ada.
- Risiko suhu, kelembapan, atau CO₂ diterjemahkan menjadi kalimat tetap yang mudah dipahami dan ditautkan ke grafik sensor terkait pada halaman Monitoring.
- Chatbot diberi batas eksplisit untuk tidak menghitung, menebak, atau mengubah angka forecast. Tanpa `VITE_CHAT_API_URL`, chatbot generatif tetap nonaktif; insight Dashboard yang tersedia bersifat deterministik lokal.

## Satu sumber angka resmi

Dashboard dan halaman Perkiraan Panen memakai normalisasi yang sama di `apps/web/src/lib/forecast.js`. Forecast hanya diterima sebagai angka resmi jika:

- `forecastType` bernilai `batch_total`;
- metode pada `forecastMethod` atau `model.forecastMethod` bernilai `trained-batch-model-v1`;
- forecast menyebut `input.batchId`.

Output legacy tujuh hari atau hasil perhitungan browser tidak diterima oleh kedua tampilan.

## Checkpoint konsistensi live

Pembacaan read-only pada path `tumbara/aiForecasts/FARM-01-K01/latest` menghasilkan:

- batch: `FARM-01-K01-B04`;
- forecast total: `370,12 kg`;
- rentang: `328,66–398,21 kg`;
- masa panen: `18 Agustus 2026–30 September 2026`;
- tipe: `batch_total`;
- metode: `model.forecastMethod = trained-batch-model-v1`.

Dashboard dan halaman lengkap membaca objek RTDB yang sama sehingga angka, rentang, tanggal, batch, dan waktu pembaruan tidak dihitung ulang atau disalin ke sumber lain.

## State yang ditangani

- loading;
- forecast belum tersedia;
- akses atau koneksi gagal;
- stale lebih dari 36 jam;
- batch sudah tidak aktif;
- forecast sukses dengan atau tanpa risiko monitoring.

## File utama

- `apps/web/src/components/DashboardForecastCard.jsx`
- `apps/web/src/hooks/useDashboardForecast.js`
- `apps/web/src/hooks/useForecastData.js`
- `apps/web/src/lib/forecast.js`
- `apps/web/src/lib/forecastService.js`
- `apps/web/src/pages/HomePage.jsx`
- `apps/web/src/pages/AIForecastPage.jsx`
- `apps/web/src/pages/MonitoringPage.jsx`
- `apps/web/tests/forecast.test.js`

## Verifikasi

- Test frontend: 7/7 lulus.
- ESLint: lulus tanpa error.
- Production build Vite: lulus.
- Build output tersedia pada `dist/apps/web`.
- Credential Firebase Admin tetap hanya digunakan worker lokal dan tidak dimasukkan ke bundle browser.