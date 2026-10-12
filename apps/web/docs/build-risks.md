# Build, Deploy, dan Blind Spots

## Build & Deploy

- Bundler: Vite 7 + `@vitejs/plugin-react`; konfigurasi utama `vite.config.js`, alias `@` → `src`.
- `npm run dev`: Vite port 3000. `npm run build`: `tools/generate-llms.js` lalu output Vite ke `../../dist/apps/web`. `npm run start`: Vite preview port 3000.
- Script lain: `npm run lint`, `npm run lint:warn`, `npm test` (Node test runner; project memuat test forecast dan operations view).
- Styling: `tailwind.config.js`, `postcss.config.js`; lint `eslint.config.mjs`; UI config `components.json`.
- Target deploy final: Not found. Yang tampak hanya lokasi output build dan preview lokal.
- Plugin visual editor, selection mode, iframe route restoration, dan pocketbase auth dipasang hanya saat development.

## Risks / Blind Spots

- Page diimpor statis, tanpa lazy loading/Suspense level route; bundle awal berpotensi memuat seluruh page.
- TypeScript/types statis tidak ditemukan; validasi data bergantung pada helper/runtime.
- State halaman lokal dan beberapa page mengakses Firebase langsung, sehingga akses data tidak seluruhnya lewat service seragam.
- `SettingsPage` memiliki context bahasa/form lokal, bukan provider global.
- Fetch cuaca/geocoding/Telegram berjalan dari browser; integrasi Telegram perlu ditinjau bersama pengelolaan token yang diinput UI.
- Chat hanya tersedia bila `VITE_CHAT_API_URL` disetel; implementasi server proxy tidak ditemukan di app.
- `exportToExcel` dan `exportToPDF` merupakan fallback (CSV dan `window.print`), bukan ekspor format asli.
- `vite.config.js` menyisipkan penanganan error/fetch yang mengirim `postMessage` ke `window.parent`; plugin dev juga menambah jalur editor/preview.
- Aturan deploy, rewrite SPA, pipeline secret, dan backend worker forecast: Not found dari source app.
