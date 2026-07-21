# Tahap 1 — Baseline, Keamanan, dan Konfigurasi Lokal

## Baseline sebelum perubahan

Tanggal pemeriksaan: 2026-07-15 (Asia/Jakarta).

| Pemeriksaan | Hasil |
|---|---|
| `npm run build` | Lulus |
| `npm run lint` | Lulus |
| `python -m pytest -q` pada Modul AI | Belum berjalan: `pytest` belum terpasang pada Python aktif |
| Git worktree | Sudah kotor sebelum Tahap 1; terdapat perubahan source milik pengguna dan banyak perubahan pada `node_modules` yang terlacak |

Tidak dilakukan reset, checkout, atau penghapusan atas perubahan yang sudah ada.

## Temuan keamanan

- Satu API key provider AI berada langsung di `HomePage.jsx` sehingga ikut masuk bundle browser.
- Token bot dan API key provider AI berada dalam `functions/.env.example`.
- Root `.gitignore` belum melindungi seluruh credential dan runtime worker.
- Beberapa folder dependency sudah terlacak Git sehingga menambah noise dan risiko artefak lokal ikut masuk commit.

Nilai credential tidak dicantumkan dalam dokumen atau laporan.

## Perubahan Tahap 1

- Frontend tidak lagi menyimpan API key provider.
- Chat menggunakan `VITE_CHAT_API_URL` hanya untuk URL proxy tepercaya, tanpa Authorization secret dari browser.
- Jika proxy belum dikonfigurasi, chat memberi pesan nonaktif yang aman.
- File contoh Functions dikosongkan dan menggunakan format dotenv.
- Ignore rules melindungi environment, Firebase Admin JSON, log, state, runtime, virtual environment, dependency, dan build output.
- Lokasi log: `local_ai_worker/runtime/logs`.
- Lokasi state/lock: `local_ai_worker/runtime/state`.
- Lokasi credential: `local_ai_worker/credentials`.

## Tindakan pengguna: rotasi credential

Menghapus key dari source tidak menonaktifkan key lama. Anggap seluruh key yang pernah berada di repository sudah bocor.

### Rotasi API key provider AI

1. Masuk ke dashboard provider AI yang digunakan.
2. Buka halaman API Keys.
3. Revoke/hapus key lama yang pernah ada pada `HomePage.jsx` atau `.env.example`.
4. Bila chat diperlukan kelak, buat key baru.
5. Simpan key baru hanya pada backend/proxy lokal tepercaya, bukan dalam variabel `VITE_*`.
6. Untuk arsitektur gratis saat ini, biarkan `VITE_CHAT_API_URL` kosong sampai proxy aman tersedia.

### Rotasi token Telegram

1. Buka BotFather di Telegram.
2. Jalankan `/revoke`, pilih bot yang terdampak, lalu konfirmasi.
3. Jika diperlukan, gunakan `/token` untuk memperoleh token baru.
4. Simpan token baru hanya pada `functions/.env` untuk emulator lokal atau secret environment deployment.
5. Jangan menaruh token pada `.env.example`, source React, screenshot, atau dokumentasi.

Chat ID bukan password, tetapi tetap dipindahkan dari file contoh agar konfigurasi deployment tidak terbuka.

## Tutorial konfigurasi lokal

### Web

Pada Tahap 1, chat eksternal sengaja dinonaktifkan. Jika nanti tersedia proxy server-side yang aman:

1. Salin `apps/web/.env.example` menjadi `apps/web/.env`.
2. Isi `VITE_CHAT_API_URL` dengan URL proxy, bukan URL provider yang memerlukan key dari browser.
3. Restart Vite setelah mengubah `.env`.

### Firebase Admin untuk AI Worker

Credential ini baru digunakan saat Tahap 5.

1. Buka Firebase Console dan pilih project.
2. Buka Project settings → Service accounts.
3. Pilih Generate new private key.
4. Buat folder `jamur/local_ai_worker/credentials`.
5. Simpan file sebagai `firebase-admin.json` di folder tersebut.
6. Salin `local_ai_worker/.env.example` menjadi `local_ai_worker/.env`.
7. Pastikan `FIREBASE_CREDENTIALS_PATH=credentials/firebase-admin.json`.
8. Jangan unggah JSON ke Git, Drive publik, atau chat.

Anda belum perlu membuat service-account key sebelum Tahap 5.

## Catatan Git

Ignore rule tidak otomatis menghapus `node_modules` yang sudah pernah dilacak Git. Pembersihan index akan menghasilkan diff besar dan tidak dilakukan pada Tahap 1 tanpa persetujuan khusus.
