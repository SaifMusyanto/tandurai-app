# Peta Sistem Tandurai Web

Indeks navigasi arsitektur aplikasi. Pemetaan bersumber dari source code `apps/web`; buka dokumen topik sesuai kebutuhan.

## Pilih dokumen

| Kebutuhan | Dokumen |
|---|---|
| Entrypoint, route, auth gate, struktur `src/` | [docs/architecture-routing.md](docs/architecture-routing.md) |
| Backend API, data flow, state, env | [docs/data-state-integrations.md](docs/data-state-integrations.md) |
| File penting, export, tugas modul | [docs/module-catalog.md](docs/module-catalog.md) |
| Build, konfigurasi, deployment, blind spots | [docs/build-risks.md](docs/build-risks.md) |

## Ringkasan

- Dashboard budidaya jamur Tandurai; React 18 + JavaScript/JSX + Vite 7.
- Routing memakai `react-router-dom`; Firebase Auth (hanya login) menjadi gerbang sebelum dashboard ditampilkan.
- Backend `apps/api` (Express + PostgreSQL) menyimpan seluruh data: user, farm & anggota (owner/operator), kumbung, batch, panen, gateway MQTT, telemetry, alert, forecast. Otorisasi per farm ditegakkan backend (pengganti `database.rules.json`). Firebase Realtime Database tidak dipakai lagi oleh web. Tidak ditemukan Redux/Zustand/Jotai.
- Entry: `src/main.jsx` → `src/App.jsx` → AuthPage atau DashboardLayout → page → hook/service → `src/lib/api.js`.

## Core logic flow

```text
Browser → main.jsx → App.jsx [Firebase Auth gate]
  → AuthPage (anonim) | BrowserRouter → DashboardLayout → Page
  → DashboardLayout → IotProvider (gateway + satu SSE + bus event) → FarmProvider (profil, farm, kumbung, sensor) + FarmSwitcher di TopNavbar + ContextBar (kumbung/sensor sesuai halaman)
  → Hook/service → src/lib/api.js (REST, Bearer Firebase ID token) → backend apps/api → PostgreSQL
  Gateway ESP32 → MQTT broker → backend apps/api (satu MQTT client) → PostgreSQL + SSE ke anggota farm
  AI worker lokal (Python) → API worker backend (WORKER_TOKEN)
```

Flow inti: semua data → `src/lib/api.js` (Bearer Firebase ID token) → backend; realtime lewat satu SSE di `IotContext` (`gateway`, `telemetry`, `actuator`, `config`, `command`, `alert`, `forecast`, `changed`; halaman berlangganan via `subscribe`). Telemetry (`/monitoring`, `/historical`, `/analytics`, Home, navbar, Automation) → `FarmContext.target` → `useLatestTelemetry` (SSE) + `telemetryService.readTelemetryHistory` (sampel 10 menit); anggota (`/farm-members`) → `api.members`; perangkat (`/devices`) → `IotContext`; operasi (`/operations`) → `operationsService`; alert → `useAlerts` (dievaluasi backend); forecast (`/ai-forecast`, Home) → `forecastService`/`useDashboardForecast`; Settings → `/me/settings` + pengaturan alert farm; Home → Open-Meteo + endpoint chat opsional.
