# Peta Sistem Tandurai Web

Indeks navigasi arsitektur aplikasi. Pemetaan bersumber dari source code `apps/web`; buka dokumen topik sesuai kebutuhan.

## Pilih dokumen

| Kebutuhan | Dokumen |
|---|---|
| Entrypoint, route, auth gate, struktur `src/` | [docs/architecture-routing.md](docs/architecture-routing.md) |
| Firebase, data flow, state, API, env | [docs/data-state-integrations.md](docs/data-state-integrations.md) |
| File penting, export, tugas modul | [docs/module-catalog.md](docs/module-catalog.md) |
| Build, konfigurasi, deployment, blind spots | [docs/build-risks.md](docs/build-risks.md) |

## Ringkasan

- Dashboard budidaya jamur Tandurai; React 18 + JavaScript/JSX + Vite 7.
- Routing memakai `react-router-dom`; Firebase Auth menjadi gerbang sebelum dashboard ditampilkan.
- Firebase Realtime Database adalah backend utama; Firebase Functions callable menjadi jalur tepercaya untuk membership dan provisioning perangkat. Tidak ditemukan Redux/Zustand/Jotai.
- Entry: `src/main.jsx` → `src/App.jsx` → AuthPage atau DashboardLayout → page → hook/service/Firebase.

## Core logic flow

```text
Browser → main.jsx → App.jsx [Firebase Auth gate]
  → AuthPage (anonim) | BrowserRouter → DashboardLayout → Page
  → Hook/state lokal → lib service/Firebase SDK → Firebase Realtime Database
  → Device management → Firebase Functions callable → Admin SDK → registry/config gateway di RTDB
```

Flow inti: telemetry (`/monitoring`, `/historical`, `/analytics`) → `telemetryService` → RTDB; operasi (`/operations`) → `operationsService` → RTDB; forecast (`/ai-forecast`) → hook → `forecastService` → RTDB; Home → telemetry + Open-Meteo + endpoint chat opsional.
