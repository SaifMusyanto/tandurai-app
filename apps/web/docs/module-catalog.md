# Katalog Modul

Path relatif terhadap `apps/web`. Peran diringkas dari source.

## Pages / Routes

| Path → export | Peran |
|---|---|
| `src/App.jsx` → `App` default | Auth gate, provider global, route dan 404. |
| `src/pages/AuthPage.jsx` → default | UI autentikasi sebelum dashboard. |
| `src/pages/HomePage.jsx` → default | Dashboard, telemetry, cuaca dan chat opsional. |
| `src/pages/MonitoringPage.jsx` → default | Monitoring sensor/cuaca. |
| `src/pages/OperationsExperiencePage.jsx` → default | Farm, kumbung, batch dan panen; route `/operations`. |
| `src/pages/AIForecastPage.jsx` → default | UI forecast AI. |
| `src/pages/AutomationPage.jsx` → default | UI otomasi. |
| `src/pages/DevicesPage.jsx` → default | Tampilan perangkat dan modal pengelolaan. |
| `src/pages/AlertsPage.jsx` → default | Tampilan alert. |
| `src/pages/HistoricalPage.jsx` → default | Data historis dan ekspor. |
| `src/pages/AnalyticsPage.jsx` → default | Analitik telemetry dan chart. |
| `src/pages/ReportsPage.jsx` → default | Laporan. |
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
| `src/hooks/useDashboardForecast.js` → `useDashboardForecast` | Forecast dashboard dan subscription. |
| `src/hooks/use-toast.js` → `useToast`, `toast`, reducer | Antrean toast berbasis reducer/listener modul. |
| `src/hooks/use-mobile.jsx` → `useIsMobile` | Deteksi breakpoint mobile. |
| `src/contexts/ThemeContext.jsx` → `ThemeProvider`, `useTheme` | Tema light/dark dengan localStorage. |

## Services / API

| Path → export | Peran |
|---|---|
| `src/firebase.js` → `db`, `auth`, `firebaseProjectId` | Inisialisasi Firebase dan pemeriksaan env wajib. |
| `src/lib/telemetryService.js` → `subscribeLatestTelemetry`, `readTelemetryHistory` | Feed telemetry live dan query history RTDB. |
| `src/lib/operationsService.js` → fungsi load/CRUD | Baca/tulis farm, kumbung, batch dan panen. |
| `src/lib/forecastService.js` → fungsi load/request | Membaca forecast dan menulis request ke RTDB. |

## Utils dan domain

| Path → export | Peran |
|---|---|
| `src/lib/firebasePaths.js` → `FIREBASE_PATHS` | Builder path Firebase. |
| `src/lib/deviceManagementPlan.js` → `build*Updates`, `emailDirectoryKey` | Pembangun multipath update anggota farm, gateway, pairing, dan sensor (murni, tanpa SDK). |
| `src/lib/deviceManagementService.js` → `addFarmOperator`, `createGateway`, `pairGateway`, `assignSensor`, dll. | Operasi owner langsung ke RTDB; validasi oleh Rules. |
| `src/lib/telemetry.js` → helpers/konstanta | Normalisasi, staleness, timestamp dan payload telemetry. |
| `src/lib/forecast.js` → helpers/konstanta | Normalisasi dan validasi forecast. |
| `src/lib/operations.js` → helpers/konstanta | Status domain dan pembentuk payload operasi. |
| `src/lib/operationsView.js` → helpers/konstanta | Fase operasi dan ledger panen untuk view. |
| `src/lib/exportUtils.js` → `exportToCSV`, `exportToExcel`, `exportToPDF` | Ekspor; Excel/PDF memakai fallback/mock. |
| `src/lib/utils.js` → `cn` | Penggabung class Tailwind. |
| `src/lib/dummyDataGenerator.js` → generator | Membuat data chart contoh. |

`src/index.css` menyediakan style global; `tailwind.config.js` dan `postcss.config.js` mengatur style. Folder `src/components/ui` berisi primitive presentasi.
