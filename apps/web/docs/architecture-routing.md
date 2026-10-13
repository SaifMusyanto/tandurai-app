# Arsitektur dan Routing

## Project Summary

Tandurai adalah dashboard pemantauan dan pengelolaan budidaya jamur. Stack dari source/manifest: React 18.3, JavaScript/JSX (TypeScript tidak ditemukan), Vite 7, React Router DOM 7, Tailwind CSS 3, Radix UI/shadcn-style. Pola: SPA, route/page terpusat di `App.jsx`, layout dashboard bersama, state fitur lokal, dan akses Firebase melalui hook/service.

## Entrypoint dan core flow

```text
index.html (#root) → src/main.jsx → src/App.jsx
→ Firebase onAuthStateChanged → AuthPage jika anonim
→ ThemeProvider + BrowserRouter + DashboardLayout → page sesuai path
→ komponen/hook → service atau Firebase SDK → Firebase Realtime Database
```

`main.jsx` memasang App dan CSS global. `App.jsx` menunggu status Firebase Auth (`undefined` = loading), menampilkan AuthPage jika tidak login, dan hanya memasang router dashboard setelah user tersedia.

## Routing

Router `react-router-dom` (`BrowserRouter`, `Routes`, `Route`; `Navigate` juga diimpor tetapi tidak tampak digunakan). Route statis ada di `src/App.jsx`; halaman dashboard berada di parent `DashboardLayout`.

| Path | Page |
|---|---|
| `/` | `HomePage` |
| `/monitoring` | `MonitoringPage` |
| `/operations` | `OperationsExperiencePage` (diimpor sebagai `OperationsPage`) |
| `/ai-forecast` | `AIForecastPage` |
| `/automation` | `AutomationPage` |
| `/devices` | `DevicesPage` |
| `/farm-members` | `FarmMembersPage` |
| `/alerts` | `AlertsPage` |
| `/historical` | `HistoricalPage` |
| `/analytics` | `AnalyticsPage` |
| `/reports` | `ReportsPage` |
| `/settings` | `SettingsPage` |
| `*` | Tampilan 404 di dalam layout dashboard |

Auth gate ada di `App`, bukan wrapper route terpisah. Route dashboard tidak dirender untuk user anonim; konfigurasi role-per-route tidak ditemukan. Semua page diimpor statis; route-level lazy loading/Suspense tidak ditemukan. `ScrollToTop` dan `Toaster` berada di dalam router.

## Clean Tree `src/`

```text
src/
├── main.jsx, App.jsx, index.css, firebase.js
├── pages/                 # 12 page route/auth
├── components/
│   ├── DashboardLayout.jsx, Sidebar.jsx, TopNavbar.jsx, ScrollToTop.jsx
│   ├── DashboardForecastCard.jsx
│   └── ui/                 # primitives Radix/shadcn-style
├── contexts/ThemeContext.jsx
├── hooks/                  # forecast, toast, responsive
└── lib/                    # Firebase paths, services, domain helpers, export
```
