# Tahap 8 — Halaman AI Forecast

Status: selesai diimplementasikan; kontrak total batch diperbarui dan production build lulus pada 16 Juli 2026.

## Route dan akses

- Route: `/ai-forecast`.
- Menu sidebar: **AI Forecast**.
- Halaman membaca `users/{uid}/access/farms`, lalu hanya memuat kumbung dari farm yang dimiliki user.
- Forecast dibaca dari `tumbara/aiForecasts/{kumbungId}/latest` dan 20 entry terbaru dari `history`.
- RTDB Rules tetap menjadi lapisan otorisasi akhir; frontend tidak memiliki akses tulis ke fitur atau forecast.

## Informasi yang ditampilkan

- perkiraan total hasil satu batch dari awal sampai akhir masa panen;
- P10/P50/P90 dan visual rentang ketidakpastian;
- rentang hasil hati-hati, paling mungkin, dan kondisi baik (P10/P50/P90);
- confidence;
- rentang tanggal masa panen berdasarkan tanggal mulai dan umur batch;
- filter batch aktif per kumbung;
- faktor risiko deterministik;
- completeness, jumlah sampel, dan fitur kosong;
- versi schema, point model, quantile model, evidence scope, serta validasi lapangan;
- histori forecast total per batch dan kumbung.

Label demo berasal langsung dari metadata forecast. Forecast dengan `status=demo`, input `hybrid_synthetic_fill`, model `synthetic_benchmark`, atau `fieldValidated=false` ditampilkan dengan peringatan bahwa hasil belum tervalidasi lapangan.

## State UI

Halaman menangani:

- loading;
- tidak ada forecast;
- data tidak cukup;
- forecast stale lebih dari 36 jam;
- unauthorized/tidak memiliki farm;
- error dan retry;
- success;
- success dalam mode demo.

## File utama

- `apps/web/src/pages/AIForecastPage.jsx`
- `apps/web/src/hooks/useForecastData.js`
- `apps/web/src/lib/forecastService.js`
- `apps/web/src/lib/forecast.js`
- `apps/web/tests/forecast.test.js`

## Verifikasi

- Test frontend: 5/5 lulus.
- Test worker: 24/24 lulus.
- ESLint: lulus tanpa error.
- Production build Vite: lulus.
- Test mencakup patokan 300–500 kg per 1.000 baglog sehat, koreksi kontaminasi, rentang tanggal satu siklus, pemisahan batch, normalisasi interval, state UI, serta sorting history.
- Credential Firebase Admin dan file artefak model tetap berada di worker lokal, bukan frontend.

## Cara mencoba

```powershell
cd jamur\apps\web
npm run dev
```

Login menggunakan user demo yang memiliki akses `FARM-01`, lalu buka `http://localhost:3000/ai-forecast`. Pilih `FARM-01-K01`; forecast demo Tahap 7 akan dibaca langsung dari RTDB.
