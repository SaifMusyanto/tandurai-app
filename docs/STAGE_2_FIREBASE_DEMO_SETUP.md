# Tahap 2 — Kontrak Data dan RTDB Demo

## Hasil implementasi

- Project demo: `tandurai-ai`.
- Project production `tumbara-bea7a` tidak menerima deployment atau perubahan data.
- Alias `default` dan `demo` menunjuk ke project demo.
- Production hanya dapat dituju eksplisit dengan alias `production`.
- Web lokal membaca seluruh konfigurasi Firebase dari `apps/web/.env`.
- Security Rules telah diuji lokal dan di-deploy ke RTDB demo.
- Master data awal `FARM-01`, `FARM-01-K01`, dan `FARM-01-K01-B01` telah dibuat di RTDB demo.
- Client tidak dapat menulis fitur, forecast, actual, worker status, role, atau farm membership.

## Hasil pengujian

| Pengujian | Hasil |
|---|---|
| Anonymous read ditolak | Lulus |
| Manager hanya membaca farm yang ditugaskan | Lulus |
| Viewer hanya membaca forecast farm sendiri | Lulus |
| Operator menulis telemetry farm sendiri | Lulus |
| Viewer menulis telemetry ditolak | Lulus |
| Manager/client menulis forecast ditolak | Lulus |
| User menaikkan role sendiri ditolak | Lulus |
| User membuat profil sendiri | Lulus |
| History dan harvest event append-only | Lulus |
| Build frontend dengan Firebase demo | Lulus |
| Lint frontend | Lulus |
| Deploy rules ke `tandurai-ai` | Lulus |

Total rules test: 10 lulus, 0 gagal.

## Konfigurasi yang harus dilakukan pengguna

### 1. Aktifkan Email/Password

1. Buka Firebase Console project `tandurai-ai`.
2. Buka Authentication → Sign-in method.
3. Aktifkan Email/Password.

### 2. Buat user demo

Pilihan A: jalankan web dengan `npm run dev`, lalu daftar melalui halaman register.

Pilihan B: Firebase Console → Authentication → Users → Add user.

Jika user dibuat dari Console, tambahkan profil secara manual atau login lalu gunakan halaman Settings.

### 3. Berikan role dan akses farm

Salin UID user dari Authentication. Pada RTDB demo, tambahkan:

```text
users/{UID}/access/role = "manager"
users/{UID}/access/farms/FARM-01 = true
```

Gunakan tipe boolean `true`, bukan string `"true"`.

Role/farm access sengaja tidak dapat ditulis dari browser agar user tidak dapat mengangkat hak akses sendiri.

## Menjalankan rules test kembali

Firebase CLI 15 membutuhkan JDK 21+. JDK portable telah disimpan pada folder ignored:

```text
local_ai_worker/runtime/jdk21
```

Jalankan:

```powershell
npm run test:rules
```

Script akan menggunakan JDK portable jika tersedia.

## Deployment aman

Deploy rules demo:

```powershell
npm run deploy:rules:demo
```

Jangan menggunakan alias `production` kecuali memang ingin mengubah project production:

```powershell
firebase deploy --only database --project production
```

Perintah production tersebut tidak dibutuhkan untuk implementasi AI demo.

## Catatan dependency

`@firebase/rules-unit-testing` ditambahkan sebagai dev dependency. `npm install` melaporkan sembilan vulnerability pada dependency tree (2 low, 2 moderate, 3 high, 2 critical). Tidak dilakukan `npm audit fix` otomatis karena dapat mengubah dependency aplikasi di luar scope Tahap 2.

## Batas Tahap 2

- Firmware dan penyimpanan telemetry baru belum diubah; itu Tahap 3.
- Form batch dan panen belum dibuat; itu Tahap 4.
- Python worker belum memakai Firebase Admin; itu Tahap 5.
- Path lama `tumbara/monitoring/sensor1` hanya read-only untuk kompatibilitas sementara.
