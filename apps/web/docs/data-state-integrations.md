# Data, State, dan Integrasi

## State management map

Tidak ditemukan Redux, Zustand, Jotai, atau Recoil. State memakai `useState`/`useEffect` pada page/hook. `ThemeContext` menyediakan tema; `SettingsPage` memiliki context lokal untuk bahasa/form; `use-toast.js` mengelola antrean toast berbasis reducer dan listener modul. Data live memakai callback Firebase `onValue`; forecast dan operasi memuat data async lalu menyimpannya di state hook/page.

```text
Page → hook/page state → service (opsional) → Firebase SDK → Realtime Database
                                     ↘ snapshot/callback → state → render
```

## API client dan konfigurasi data

- `src/firebase.js` menginisialisasi Firebase (`initializeApp`, `getAuth`, `getDatabase`). Tujuh nilai inti wajib; `measurementId` opsional. Jika konfigurasi inti kosong, modul melempar error saat dimuat.
- Tidak ditemukan Axios, TanStack Query, Apollo, atau client REST terpusat. Firebase SDK digunakan langsung di service dan beberapa page.
- `src/lib/firebasePaths.js` membangun path domain `tumbara/*`: farms, anggota, kumbungs, batch, gateway, sensor, config gateway, indeks relasi, telemetry, history, harvest, forecast, serta `userDirectory`. Modul aman diimpor dari Node (test) karena `import.meta.env` bersifat opsional.
- `.env.example` mendokumentasikan `VITE_FIREBASE_*`, `VITE_CHAT_API_URL` (proxy chat opsional), `VITE_LEGACY_SENSOR_PATH`, dan default farm/kumbung/sensor. File `.env` lokal tidak dirinci di dokumen.
- Vite mengekspos variabel `VITE_*` ke browser. Komentar template menyatakan rahasia provider harus berada di server, bukan `VITE_*`.

## Flow data inti

### Telemetry

`HomePage`, `MonitoringPage`, `HistoricalPage`, dan `AnalyticsPage` menggunakan `subscribeLatestTelemetry` (`src/lib/telemetryService.js`). Service mengamati sensor `telemetry-v1` dan jalur legacy, memilih data utama jika tersedia, menormalisasi dengan `telemetry.js`, serta mengembalikan fungsi unsubscribe. History dibaca per tanggal Jakarta dengan query timestamp, deduplikasi sensor+timestamp dan batas maksimum.

### Operasional

`OperationsExperiencePage` menggunakan `operationsService.js` untuk memuat akses user, farms, kumbungs, batch dan panen dari RTDB. Fungsi create/update menyimpan struktur domain yang disiapkan `operations.js`; `operationsView.js` merangkum ledger panen.

### Forecast

`useForecastData` dan `useDashboardForecast` menghubungkan page/card ke `forecastService.js`. Service membaca scope user, forecast terbaru/histori dan request; permintaan menulis request ke RTDB, bukan memanggil model langsung dari browser. Validasi/normalisasi ada di `forecast.js`.

### Anggota farm dan perangkat

`src/lib/deviceManagementService.js` menjalankan operasi owner langsung ke RTDB tanpa server: tambah/cabut operator, buat gateway, pairing/lepas UID gateway, cabut gateway, tugaskan/pindah/nonaktifkan sensor. Isi update dibangun oleh `src/lib/deviceManagementPlan.js` (modul murni, dipakai juga oleh test Rules). `database.rules.json` memvalidasi role owner dan konsistensi lintas path (katalog, indeks `kumbungSensors`/`gatewaySensors`, `gatewayConfigs`, kenaikan `configVersion` tepat +1).

- Penambahan operator memakai `userDirectory/{email}` → UID. `App.jsx` memanggil `publishUserDirectoryEntry` setiap login; entri hanya bisa ditulis user sendiri dengan email terverifikasi (`email.toLowerCase()` dengan `.` diganti `,`).
- Gateway ESP32 login dengan Firebase Anonymous Auth. Owner memasangkan UID ke gateway (`tumbara/gateways/{id}/authUid` + `tumbara/gatewayAuthUids/{uid}`); Rules mengenali gateway dari `auth.uid`, bukan custom claims.
- Hanya gateway yang menulis `monitoring`/`history`; status sensor `active` hanya diberikan gateway.
- Belum ada UI untuk operasi ini; `DevicesPage.jsx` masih memakai data statis.

## External Integrations

- Firebase Authentication dan Realtime Database: session serta data utama.
- Open-Meteo: `HomePage` dan `MonitoringPage` melakukan `fetch` langsung untuk cuaca.
- OpenStreetMap Nominatim: reverse geocoding di General tab `SettingsPage`.
- Telegram Bot API: pengiriman pesan uji/alert dari `SettingsPage`.
- Chat endpoint opsional melalui `VITE_CHAT_API_URL` dipakai `HomePage`; endpoint tidak dikonfigurasi di template.
- Firebase/Google Measurement ID opsional ada di env template, tetapi aktivasi SDK analytics tidak ditemukan.

## Modul data/config penting

`src/firebase.js` = inisialisasi; `src/lib/firebasePaths.js` = skema path; `src/lib/telemetry.js` = normalisasi/waktu; `src/lib/telemetryService.js` = subscription/history; `src/lib/operationsService.js` = CRUD; `src/lib/forecastService.js` = pembacaan/request forecast; `src/lib/deviceManagementPlan.js` = pembangun multipath update anggota/perangkat; `src/lib/deviceManagementService.js` = eksekusi operasi tersebut ke RTDB. Tidak ditemukan client API HTTP terpisah.
