# Data, State, dan Integrasi

## State management map

Tidak ditemukan Redux, Zustand, Jotai, atau Recoil. State memakai `useState`/`useEffect` pada page/hook. `ThemeContext` menyediakan tema; `SettingsPage` memiliki context lokal untuk bahasa/form; `use-toast.js` mengelola antrean toast. `IotContext` memegang gateway + satu koneksi SSE dan membagikan event domain lewat `subscribe(event, handler)`; `FarmContext` memegang profil, farm, kumbung, dan sensor terpilih.

```text
Page → hook/page state → service → src/lib/api.js (REST) → backend apps/api → PostgreSQL
                       ↘ IotContext.subscribe(...) ← SSE /stream ← backend
```

## API client dan konfigurasi data

- `src/firebase.js` hanya menginisialisasi **Firebase Auth** (`initializeApp`, `getAuth`). Enam nilai `VITE_FIREBASE_*` inti wajib; `measurementId` opsional. Realtime Database tidak dipakai lagi oleh web.
- `src/lib/api.js`: klien REST tunggal (`apiRequest`, `api.*`, `streamUrl`). Setiap request membawa `Authorization: Bearer <Firebase ID token>`; base URL `VITE_API_URL` (fallback `VITE_IOT_API_URL`, default `http://localhost:8787/api`). Error backend dilempar sebagai `ApiError` (`status`, `code`, `message`). `src/lib/iotApi.js` berisi endpoint IoT di atas klien yang sama.
- `.env.example` mendokumentasikan `VITE_FIREBASE_*`, `VITE_API_URL`, `VITE_CHAT_API_URL` (proxy chat opsional), dan default farm/kumbung/sensor. File `.env` lokal tidak dirinci di dokumen.
- Vite mengekspos variabel `VITE_*` ke browser; rahasia (mis. token bot Telegram) disimpan di backend dan tidak pernah dikirim balik ke client.

## Otorisasi

Backend menegakkan akses per farm (pengganti `database.rules.json`): **owner** mengelola farm, anggota, kumbung, gateway (klaim/lepas/penempatan), dan pengaturan alert; **operator** melihat data farm, mengelola batch, mencatat/mengoreksi panen, meminta forecast, serta mengontrol aktuator dan modenya. Farm yang tidak dapat diakses dibalas 404. UI menyembunyikan aksi owner memakai `useFarmContext().isOwner` / `operations.roles`, tetapi backend tetap menjadi penentu.

## Flow data inti

### Konteks farm/kumbung/sensor

`DashboardLayout` membungkus dashboard dengan `IotProvider` lalu `FarmProvider` dan menampilkan `ContextBar`. `FarmProvider` memuat `GET /me` (profil + farm beserta role) dan `GET /farms/:id/kumbungs`; sensor = sensor gateway farm yang ditempatkan di kumbung (dari `IotContext`, realtime). Pilihan terakhir disimpan di `localStorage` (`tandurai-context:{uid}`); logika pemilihan murni di `src/lib/farmContext.js` (`resolveSelection`). Event SSE `changed` (farm/anggota/kumbung) dan `ready` (reconnect) memicu muat ulang. Akun tanpa farm melihat form “Buat farm” di `ContextBar` (pembuat menjadi owner).

### IoT gateway

`IotProvider` memuat `GET /gateways` lalu membuka satu SSE `/stream?token=<Firebase ID token>`; event `gateway`/`telemetry`/`actuator`/`config`/`command` diterapkan oleh `src/lib/iot.js`, event `alert`/`forecast`/`changed`/`ready` diteruskan ke pelanggan `subscribe`. `/devices` (klaim ke farm dengan UID + kode; owner menempatkan sensor/aktuator dan melepas gateway), `ActuatorControlPanel` di Automation (ON/OFF/E-STOP; status dari ACK gateway; mode Manual/Timer/Auto dengan Pending Sync).

### Telemetry

Sumber tunggal: `src/hooks/useKumbungTelemetry.js`. `useKumbungTelemetry` menggabungkan nilai terbaru semua sensor kumbung terpilih (SSE) dan `useKumbungHistory` menggabungkan histori backend (`GET /kumbungs/:id/telemetry`, sampel 10 menit) per timestamp ditambah data live. Parameter yang dipakai hanya suhu, kelembapan, dan CO₂ (`src/lib/parameters.js`), di mana setiap parameter berasal dari sensor yang mengukurnya. Dipakai Home, Monitoring, Historical, Analytics, Automation, dan `TopNavbar`. `KumbungSensorSummary` tetap menampilkan per sensor.

Semua tabel memakai `src/components/DataTable.jsx` (pagination sisi klien). Kolom bertanda `hideOnMobile` disembunyikan di layar < `sm` dan tampil di panel detail lewat tombol segitiga per baris, sehingga tabel muat di HP tanpa geser horizontal.

### Operasional

`OperationsExperiencePage` memakai `operationsService.js` → `GET /operations` (farm, kumbung, batch, ledger panen semua farm user; `harvestEvents` diselesaikan `resolveHarvestLedger`). Create/update mengirim payload dari builder `operations.js`; backend memvalidasi ulang dan menetapkan ID (`{farmId}-Knn`, `{kumbungId}-Bnn`) serta `createdBy`. Panen append-only; koreksi = catatan baru dengan `correctsEventId` + `correctionReason`. Perubahan dari anggota lain memicu muat ulang lewat SSE `changed`.

Halaman memakai farm/kumbung terpilih dari `FarmContext` (ContextBar), dengan tab di URL (`?tab=today|batches|recap|settings`):
- **Hari Ini**: batch berjalan (hari ke-N, tahap, baglog aktif, total panen batch), kondisi sensor terhadap `ranges`, dan catatan hari ini dari `GET /farms/:id/recap?from=to=hari ini&kumbungId`.
- **Aksi cepat**: Catat Panen, Catat Kegiatan, Lapor Masalah. Di HP/tablet berupa bar tetap di bawah layar (`QuickActions`); di layar lebar berupa tombol besar.
- **Kegiatan**: `POST /kumbungs/:id/activities` (`care`/`problem`/`note`). Baglog kontaminasi mengurangi baglog aktif batch; pembatalan lewat `POST /activities/:id/void` mengembalikannya.
- **Batch**: wizard 2 langkah. Ganti tahap dan tutup batch tercatat otomatis sebagai kegiatan. Operator boleh mulai batch dan ganti tahap; menutup (selesai/afkir) hanya owner.
- **Rekap**: filter disimpan di URL (`from`, `to`, `kumbung`, `batch`, `kinds`, `actor`), ringkasan, `DataTable`, export `GET /farms/:id/recap.csv` (CSV `;` + BOM untuk Excel), serta cetak/PDF (`#recap-print` + CSS print di `index.css`).
- **Atur** (owner): data farm & kumbung.

Komponen ada di `src/components/operations/`.

### Forecast

`useForecastData` dan `useDashboardForecast` memakai `forecastService.js` / `GET /forecasts/latest`. Permintaan (`POST /kumbungs/:id/forecast-requests`) diproses AI worker lokal (Python, `DATA_SOURCE=api`) lewat API worker backend; hasil masuk lewat SSE `forecast` dan polling halaman forecast. Validasi/normalisasi ada di `forecast.js`.

### Anggota farm dan riwayat perubahan

`/farm-members` (`FarmMembersPage.jsx`): `GET /farms/:id/members`; owner menambah operator lewat email akun yang sudah pernah login dengan email terverifikasi (backend mencatat user dari token, pengganti `userDirectory`) dan mencabut operator. `AssignmentLogPanel` menampilkan `GET /farms/:id/audit` (farm, kumbung, anggota, gateway, penempatan sensor/aktuator, pengaturan alert) dan memuat ulang saat ada `changed` pada farm tersebut.

### Alert

Alert dievaluasi backend saat telemetry masuk (suhu tinggi, kelembapan rendah, CO₂ tinggi; ambang per farm) dan saat gateway offline/online. `useAlerts` memuat `GET /alerts` dan menerapkan event SSE `alert`; dipakai `AlertsPage` (difilter ke farm terpilih) dan `TopNavbar`. Setiap kejadian alert juga dicatat backend di `alert_events` untuk laporan. Pesan Telegram memakai nama farm/kumbung/sensor. Browser tidak lagi menulis alert. `src/lib/alerts.js` tetap berisi definisi/urutan alert (dan builder lama untuk test RTDB).

### Pengaturan

`SettingsPage`: preferensi user → `GET/PUT /me/settings` (field rahasia dibuang backend); nama → `PATCH /me` (+ `displayName` Firebase). Ambang alert yang dievaluasi backend, cooldown, filter notifikasi, dan Telegram → `GET/PUT /farms/:id/alert-settings` (hanya owner; token bot write-only, ditampilkan sebagai “tersimpan”). Tombol uji Telegram memanggil `POST …/alert-settings/test` sehingga token tidak pernah berada di browser. Profil estimasi panen Automation → `PUT /kumbungs/:id/harvest-profile` (owner).

## External Integrations

- Backend Tandurai `apps/api`: seluruh data aplikasi + IoT (REST + SSE).
- Firebase Authentication: login dan ID token untuk backend.
- Open-Meteo: `src/lib/weather.js` (forecast + geocoding) lewat hook `useWeather` dan komponen `WeatherCard`, dipakai `HomePage` dan `MonitoringPage`. Lokasi dari pengaturan user `weatherLocation` `{ name, latitude, longitude }` (Pengaturan → Umum → Lokasi Ramalan Cuaca); bawaan Sidoarjo.
- Rentang optimal & ambang alert per farm: `GET/PUT /farms/:farmId/alert-settings` (`optimal`, `thresholds`), dimuat `FarmContext` sebagai `ranges` & `thresholds` dan diatur di Pengaturan → Notifikasi. Bawaan (jamur tiram, fruiting): suhu 22–28 °C, kelembapan 80–90 %, CO₂ ≤ 1000 ppm. Dipakai status KPI, garis grafik Monitoring, saran Dashboard/Kontrol, dan Farm Health Score.
- Farm Health Score: `src/lib/healthScore.js` (rata-rata 30 menit terakhir terhadap `ranges` & `thresholds`).
- OpenStreetMap Nominatim: reverse geocoding di General tab `SettingsPage`.
- Telegram Bot API: dipanggil backend (notifikasi alert dan pesan uji), bukan browser.
- Chat endpoint opsional melalui `VITE_CHAT_API_URL` dipakai `HomePage`; endpoint tidak dikonfigurasi di template.

## Modul data/config penting

`src/firebase.js` = Auth; `src/lib/api.js` = klien REST + SSE URL; `src/lib/iotApi.js` = endpoint IoT; `src/lib/telemetry.js` = normalisasi/waktu; `src/lib/telemetryService.js` = histori + normalisasi data live; `src/lib/operationsService.js` = operasional; `src/lib/forecastService.js` = forecast; `src/lib/iot.js` = reducer event IoT. `src/lib/firebasePaths.js` dan `src/lib/deviceManagementPlan.js` hanya tersisa untuk test/alat RTDB lama (tidak diimpor aplikasi, kecuali default ID di `farmContext.js`).

### Data historis, export & laporan

- Farm dipilih di navbar (`FarmSwitcher`, kiri ikon notifikasi) untuk semua halaman. `ContextBar` di atas halaman hanya tampil bila perlu (`CONTEXT_LEVELS` di `DashboardLayout`): kumbung + sensor (Dashboard, Monitoring), kumbung (Kontrol, Operasional), tidak ada (halaman lain).
- `HistoricalPage` punya filter sendiri (kumbung, sensor, periode) → `GET /kumbungs/:id/telemetry`, dirata-rata per 10 menit (`mergeReadings`).
- Export data parameter: `GET /farms/:id/telemetry-export?from&to&kumbungIds&sensorIds&interval=10m|1h|1d&groupBy=sensor|kumbung&format=csv|xlsx`. Excel dibuat backend tanpa dependency (`apps/api/src/xlsx.js`).
- Laporan farm: `GET /farms/:id/report` (pratinjau), `GET /farms/:id/report-file?format=xlsx|csv`. Jadwal: `GET/POST /farms/:id/report-schedules`, `PATCH/DELETE /report-schedules/:id`, `POST /report-schedules/:id/send`. Sweeper backend (tiap menit) mengirim ringkasan teks + Excel ke Telegram farm. Periode: kemarin (harian), 7 hari (mingguan), bulan lalu (bulanan), dalam WIB.

### Konsol admin Tandurai

- **Siapa admin:** email terverifikasi di `ADMIN_EMAILS` (atau custom claim `platformAdmin`). Admin = `platformAdmin` + `deviceAdmin`: boleh membuka semua farm (diperlakukan sebagai owner) dan menerima event SSE semua farm.
- **Konsol bawaan:** setelah login admin diarahkan ke `/admin`; menu farm biasa disembunyikan (`FarmContext.adminConsole`, `DashboardLayout`). Halaman:
  - Ringkasan Sistem (`GET /admin/overview`): angka utama, kesehatan layanan, alert kritis, gateway offline, sensor tanpa data, pengguna terbaru;
  - Farm & Klien (`GET /admin/farms`, `/admin/farms/:id`);
  - Pengguna (`GET /admin/users`);
  - Registrasi Perangkat.
- **Membuka farm klien:** "Buka dashboard farm" (`enterFarmAsAdmin`) menyimpan mode farm di `sessionStorage` (`tandurai.adminFarmView`, per tab) dan menampilkan banner "Mode admin". "Kembali ke Konsol Admin" atau membuka rute `/admin` keluar dari mode farm. Perubahan oleh admin tercatat dengan uid admin di audit farm.
- Pengguna biasa yang membuka `/admin*` diarahkan ke `/`; backend tetap menolak dengan 403.

