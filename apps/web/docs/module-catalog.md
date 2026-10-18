# Katalog Modul

Path relatif terhadap `apps/web`. Peran diringkas dari source.

## Pages / Routes

| Path → export | Peran |
|---|---|
| `src/App.jsx` → `App` default | Auth gate, provider global, route dan 404. |
| `src/pages/AuthPage.jsx` → default | UI autentikasi sebelum dashboard. |
| `src/pages/HomePage.jsx` → default | Dashboard, telemetry, cuaca dan chat opsional. |
| `src/pages/MonitoringPage.jsx` → default | Monitoring sensor/cuaca. |
| `src/pages/OperationsExperiencePage.jsx` → default | Operasional kumbung harian (Hari Ini, Batch, Rekap, Atur); route `/operations`. |
| `src/components/operations/*` | `TodayPanel`, `QuickActions` (+`VoidDialog`), `ActivityDialog`, `HarvestDialog`, `BatchWizard`, `BatchList`, `BatchDialogs` (pindah tahap/tutup), `RecapPanel`, `FarmKumbungSettings`, `controls` (tombol pilihan besar, stepper). |
| `src/pages/AIForecastPage.jsx` → default | UI forecast AI. |
| `src/pages/AutomationPage.jsx` → default | UI otomasi. |
| `src/pages/DevicesPage.jsx` → default | Gateway MQTT farm terpilih: status, klaim (owner), penempatan sensor/aktuator, lepas. |
| `src/pages/AlertsPage.jsx` → default | Peringatan farm terpilih (`useAlerts`), filter status/tingkat/kumbung, `DataTable` berpaginasi, status Telegram. |
| `src/components/TelegramStatus.jsx` → default | Ringkasan koneksi Telegram farm (atau peringatan belum terhubung) + tautan ke Pengaturan → Notifikasi. |
| `src/contexts/IotContext.jsx` → `IotProvider`, `useIot` | Gateway IoT + satu SSE untuk seluruh dashboard; aksi IoT; `subscribe(event)` untuk `alert`/`forecast`/`changed`/`ready`. |
| `src/lib/iot.js`, `src/lib/iotApi.js` | Reducer event SSE + status command (murni); endpoint IoT backend. |
| `src/components/iot/*` | `AddGatewayDialog`, `GatewayCard`, `ActuatorControlPanel`, `ActuatorConfigDialog`. |
| `src/lib/access.js` → `farmRoleOf`, `farmRolesOf` | Legacy: role dari data akses RTDB (hanya dipakai test). Role kini dari backend (`/me`, `/operations`). |
| `src/contexts/FarmContext.jsx` → `FarmProvider`, `useFarmContext` | Profil user, farm/kumbung (backend) dan sensor gateway; `target`, setter, role, `createFarm`. |
| `src/lib/farmContext.js` → `resolveSelection`, `readStoredSelection`, `writeStoredSelection` | Logika pemilihan konteks dan penyimpanan per user (murni). |
| `src/components/ContextBar.jsx` → default, `FarmSwitcher` | `FarmSwitcher`: pilih farm di navbar (kiri ikon notifikasi). Default: kumbung → sensor di atas halaman sesuai `level` (`CONTEXT_LEVELS` di `DashboardLayout`); form “Buat farm” untuk akun tanpa farm. |
| `src/components/KumbungSensorSummary.jsx` → default | Ringkasan per sensor kumbung terpilih di Monitoring. |
| `src/hooks/useKumbungTelemetry.js` → `useKumbungTelemetry`, `useKumbungHistory` | **Sumber tunggal** data lingkungan kumbung: gabungan semua sensor (live SSE + histori 10 menit). |
| `src/lib/parameters.js` → `PARAMETERS`, `mergeReadings`, `latestValues`, `formatParameter` | Definisi tunggal parameter resmi (suhu, kelembapan, CO₂): label, satuan, warna, rentang optimal. |
| `src/components/DataTable.jsx` → default | Satu-satunya komponen tabel dashboard, dengan pagination sisi klien dan kolom `hideOnMobile` yang bisa dibuka per baris. |
| `src/components/WeatherCard.jsx` → default | Kartu cuaca luar (sekarang + 24 jam per 3 jam), data dari `hooks/useWeather.js` / `lib/weather.js`. |
| `src/lib/healthScore.js` | Rumus Farm Health Score (`farmHealthScore`, `parameterScore`, `averageValues`). |
| `src/hooks/useAlerts.js` → `useAlerts` | Alert backend + update realtime SSE. |
| `src/pages/FarmMembersPage.jsx` → default | Anggota farm: daftar, tambah/cabut operator. |
| `src/components/AssignmentLogPanel.jsx` → default | Riwayat perubahan farm dari `GET /farms/:id/audit`. |
| `src/lib/alerts.js` → `sortAlerts`, `ALERT_META`, `evaluateSensor`, `buildAlertRecord` | Urutan/definisi alert; evaluasi & record (murni, dipakai test; evaluasi produksi di backend). |
| `src/pages/HistoricalPage.jsx` → default | Data historis per kumbung/sensor/periode: satu grafik tiga garis (suhu, kelembapan, CO₂), log, export (`TelemetryExportCard`). |
| `src/components/TelemetryExportCard.jsx` → default | Unduh data parameter Excel/CSV: rentang tanggal, kumbung, sensor, interval, pengelompokan. |
| `src/pages/AnalyticsPage.jsx` → default | Analitik telemetry dan chart. |
| `src/pages/admin/*` | Konsol admin: `AdminOverviewPage` (ringkasan sistem), `AdminFarmsPage` (farm + detail + buka dashboard farm), `AdminUsersPage` (akun & peran), `adminFormat`. |
| `src/pages/ReportsPage.jsx` → default | Jadwal laporan otomatis ke Telegram + laporan sekarang (pratinjau, unduh Excel/CSV). |
| `src/components/reports/*` | `ReportScheduleDialog`, `ReportPreview`, `reportOptions` (label isi/frekuensi). |
| `src/lib/download.js` → `saveBlob` | Simpan file dari `apiDownload`. |
| `src/pages/SettingsPage.jsx` → default | Preferensi, akun, security dan integrasi. |

## Components

| Path → export | Peran |
|---|---|
| `src/components/DashboardLayout.jsx` → default | Shell dashboard dan outlet route. |
| `src/components/Sidebar.jsx` → default | Navigasi utama. |
| `src/components/TopNavbar.jsx` → default | Navbar dashboard. |
| `src/components/ScrollToTop.jsx` → default | Reset scroll saat lokasi route berubah. |
| `src/components/DashboardForecastCard.jsx` → default | Ringkasan forecast dashboard. |
| `src/components/ui/*.jsx` → named exports beragam | Primitive UI Radix/shadcn-style; ikuti import page untuk pemakaian. |

## Hooks, Context, State

| Path → export | Peran |
|---|---|
| `src/hooks/useForecastData.js` → `useForecastData` | Scope dan data forecast untuk page. |
| `src/hooks/useDashboardForecast.js` → `useDashboardForecast` | Forecast terbaru lintas kumbung (backend + SSE `forecast`). |
| `src/hooks/use-toast.js` → `useToast`, `toast`, reducer | Antrean toast berbasis reducer/listener modul. |
| `src/hooks/use-mobile.jsx` → `useIsMobile` | Deteksi breakpoint mobile. |
| `src/contexts/ThemeContext.jsx` → `ThemeProvider`, `useTheme` | Tema light/dark dengan localStorage. |

## Services / API

| Path → export | Peran |
|---|---|
| `src/firebase.js` → `auth`, `firebaseProjectId` | Firebase Auth saja dan pemeriksaan env wajib. |
| `src/lib/api.js` → `api`, `apiRequest`, `streamUrl`, `ApiError`, `API_URL` | Klien REST backend (Bearer Firebase ID token) dan URL SSE. |
| `src/lib/telemetryService.js` → `readTelemetryHistory`, `latestFromSensor` | Histori telemetry kumbung (backend) dan normalisasi data live sensor. |
| `src/lib/operationsService.js` → fungsi load/CRUD | Farm, kumbung, batch dan panen lewat backend. |
| `src/lib/forecastService.js` → fungsi load/request | Membaca forecast dan meminta perhitungan lewat backend. |

## Utils dan domain

| Path → export | Peran |
|---|---|
| `src/lib/firebasePaths.js` → `FIREBASE_PATHS` | Legacy: path RTDB (test/alat lama) + ID default konteks. |
| `src/lib/deviceManagementPlan.js` → `build*Updates`, `emailDirectoryKey` | Legacy: multipath update RTDB (hanya test Rules & simulator lama). |
| `src/lib/telemetry.js` → helpers/konstanta | Normalisasi, staleness, timestamp dan payload telemetry. |
| `src/lib/forecast.js` → helpers/konstanta | Normalisasi dan validasi forecast. |
| `src/lib/operations.js` → helpers/konstanta | Status domain dan pembentuk payload operasi. |
| `src/lib/operationsView.js` → helpers/konstanta | Fase (istilah petani), label kegiatan/masalah, `batchLabel`, `batchDay`, `describeRecapRow`, ledger panen. |
| `src/lib/utils.js` → `cn` | Penggabung class Tailwind. |
| `src/lib/dummyDataGenerator.js` → generator | Membuat data chart contoh. |

`src/index.css` menyediakan style global; `tailwind.config.js` dan `postcss.config.js` mengatur style. Folder `src/components/ui` berisi primitive presentasi.
