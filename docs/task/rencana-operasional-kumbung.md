# Rencana Implementasi — Operasional Kumbung untuk Petani

Status: **fase 1–4 selesai** (18 Okt 2026); fase 5 menunggu uji browser bersama user. Keputusan bagian 7 memakai usulan: operator boleh mulai batch dan ganti tahap, tutup hanya owner; export CSV + cetak; foto ditunda; chip sesuai 3.2; bawaan jamur tiram.

Catatan implementasi: migration bernama `006_activities.sql` (005 dipakai rentang optimal). Nomor batch diambil dari ID (`…-B03`), jadi kolom `seq` tidak dibuat. Data kegiatan hari ini memakai endpoint rekap, bukan tambahan pada `/operations`.

## 1. Tujuan

Halaman Operasional Kumbung menjadi alat kerja harian petani. Petani bisa:

1. Mencatat **batch** baglog: mulai, pindah tahap, selesai atau afkir.
2. Mencatat **kegiatan harian**: perawatan, baglog terkontaminasi atau dibuang, hama, catatan.
3. Mencatat **panen** dengan cepat, termasuk beberapa kali per hari.
4. Melihat dan **mengekspor rekap** kegiatan kumbung dengan filter.

Prinsip UI: petani tidak perlu paham istilah teknis. Ketikan dibuat seminimal mungkin dan diganti tombol besar. Halaman nyaman dipakai di HP dengan satu tangan.

## 2. Kondisi sekarang (`OperationsExperiencePage.jsx`)

| Ada | Kurang |
| --- | --- |
| Tab Hari Ini, Siklus Baglog, Catatan Panen, Farm & Kumbung | Belum ada catatan harian, sehingga kegiatan selain panen tidak terekam |
| Batch dengan 5 tahap dan tombol "lanjut tahap" | ID batch mentah ditampilkan; istilah teknis (inoculation, growth stage); kontaminasi berupa % yang diketik manual |
| Catat panen dan koreksi append-only | Hanya 100 panen terakhir per kumbung yang dimuat; tidak ada total harian |
| — | Tidak ada rekap dan export; tidak ada filter tanggal, batch, atau jenis kegiatan |
| — | Kode 281 baris dengan baris sangat panjang, sulit dirawat; belum dioptimalkan untuk HP |
| — | Data sensor kumbung tidak tampil di halaman kerja harian |

## 3. Fitur (cukup, tidak kompleks)

### 3.1 Hari Ini (layar utama, mobile-first)
- **Kartu batch aktif:** nama ramah (mis. "Batch 3 · masuk 12 Okt"), **hari ke-N** sejak baglog masuk, tahap saat ini, jumlah baglog aktif, dan total panen batch ini.
- **Kondisi kumbung ringkas:** suhu, kelembapan, dan CO₂ dari `useKumbungTelemetry`, plus status Aman/Waspada.
- **Tiga tombol besar.** Di HP tombol ini menjadi bar tetap di bawah layar:
  - **Catat Panen**
  - **Catat Kegiatan**
  - **Laporkan Masalah**
- **Kegiatan hari ini:** daftar singkat yang sudah dicatat hari ini oleh siapa saja, sehingga anggota tim tidak mencatat dobel.
- **Panduan tahap:** satu kalimat tindakan yang disarankan untuk tahap ini, memakai `PHASES` yang sudah ada.

### 3.2 Catat Kegiatan (dialog sekali tekan)
- Chip pilihan yang bisa dipilih lebih dari satu:
  - Pengkabutan atau penyiraman
  - Bersihkan kumbung
  - Buka/tutup ventilasi
  - Cek hama
  - Lainnya
- Catatan opsional satu baris. Waktu otomatis "sekarang" dan bisa diubah.
- Tanpa isian wajib selain minimal satu chip.

### 3.3 Laporkan Masalah
- Pilihan masalahnya:
  - Baglog kontaminasi atau dibuang: **jumlah baglog** lewat stepper +/−.
  - Hama
  - Jamur tidak tumbuh
  - Lainnya
- Untuk baglog dibuang, **baglog aktif batch otomatis berkurang** dan persentase kontaminasi dihitung sistem, tidak diketik lagi.

### 3.4 Catat Panen
- Input berat memakai keypad angka besar (`inputmode="decimal"`), satuan kg.
- Mutu dengan tiga tombol:
  - **Bagus (A)**
  - **Sedang (B)**
  - **Campur**
- Grade C dan persentase A tetap ada di backend tetapi disembunyikan di bawah "Detail".
- Setelah simpan muncul "Total hari ini: 12,4 kg (3 kali panen)". Dialog bisa langsung dipakai lagi.
- Koreksi tetap append-only, sesuai yang sudah ada.

### 3.5 Batch
- **Mulai batch**, wizard dua langkah:
  1. Jumlah baglog dan tanggal masuk.
  2. Jenis jamur, media, dan asal bibit; semuanya opsional dengan default.
- **Pindah tahap:** satu tombol berlabel jelas, mis. "Baglog sudah dibuka → mulai masa tumbuh jamur", dengan konfirmasi. Tahap tercatat otomatis di rekap.
- **Tutup batch** (Selesai atau Afkir) menampilkan ringkasan:
  - Lama siklus
  - Total panen
  - kg per 1.000 baglog
  - Tingkat kontaminasi
- Istilah tahap disederhanakan: Inokulasi → Inkubasi (miselium tumbuh) → Buka baglog → Panen → Selesai.

### 3.6 Rekap & Export
- **Filter:**
  - Rentang tanggal, dengan preset 7 hari, 30 hari, bulan ini, dan atur sendiri
  - Kumbung (satu atau semua)
  - Batch
  - Jenis kegiatan (panen, kegiatan harian, masalah, batch)
  - Pencatat
- **Ringkasan di atas:**
  - Total panen (kg)
  - Rata-rata per hari
  - Komposisi mutu
  - Baglog dibuang
  - Jumlah kegiatan
- **Tabel kronologis** memakai `DataTable`; kolom sekunder diberi `hideOnMobile`.
- **Export:**
  - **Excel (.csv)**: pemisah `;` dan BOM UTF-8 agar langsung rapi di Excel Indonesia.
  - **Cetak/PDF**: tampilan cetak memakai `window.print()` dengan CSS print.
  - Keduanya mengikuti filter yang aktif.

### 3.7 Pengaturan (hanya owner)
- Data farm dan kumbung tetap seperti sekarang, dipindah ke tab terakhir dan disembunyikan untuk operator.

## 4. Backend (`apps/api`)

### 4.1 Migration `005_activities.sql`
```sql
CREATE TABLE kumbung_activities (
  id           text PRIMARY KEY,
  farm_id      text NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  kumbung_id   text NOT NULL REFERENCES kumbungs (id) ON DELETE CASCADE,
  batch_id     text REFERENCES batches (id) ON DELETE SET NULL,
  type         text NOT NULL CHECK (type IN ('care','problem','batch_start','phase_change','batch_end','note')),
  occurred_at  timestamptz NOT NULL,
  items        jsonb NOT NULL DEFAULT '[]',   -- chip kegiatan / jenis masalah
  quantity     integer,                       -- baglog dibuang
  notes        text NOT NULL DEFAULT '',
  recorded_by  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz, voided_by text, void_reason text   -- batal catat, riwayat tetap ada
);
CREATE INDEX kumbung_activities_idx ON kumbung_activities (kumbung_id, occurred_at DESC);
ALTER TABLE batches ADD COLUMN seq integer, ADD COLUMN mushroom_type text NOT NULL DEFAULT 'tiram',
  ADD COLUMN spawn_source text NOT NULL DEFAULT '', ADD COLUMN ended_at timestamptz, ADD COLUMN notes text NOT NULL DEFAULT '';
```
Batch lama diberi `seq` berurutan per kumbung saat migrasi.

### 4.2 Endpoint baru
| Method | Path | Akses | Isi |
| --- | --- | --- | --- |
| POST | `/kumbungs/:id/activities` | owner, operator | Catat kegiatan atau masalah. `problem` + `quantity` mengurangi `baglog_count_active` dan menghitung ulang `contamination_pct` dalam satu transaksi |
| POST | `/activities/:id/void` | pencatat atau owner | Batalkan catatan dengan alasan; jumlah baglog dikembalikan |
| GET | `/farms/:farmId/recap?from&to&kumbungId&batchId&type&actor` | anggota | `{ summary, rows }` gabungan aktivitas dan panen, berpaginasi |
| GET | `/farms/:farmId/recap.csv?…` | anggota | Stream CSV (`;`, BOM) dengan filter yang sama, tanpa batas 100 |

- Perubahan batch (create, ganti tahap, tutup) **otomatis menulis aktivitas** `batch_start`, `phase_change`, atau `batch_end`, sehingga rekap lengkap tanpa input tambahan.
- SSE `changed` dengan entity `activity`.
- `GET /operations` tetap ada untuk layar utama, ditambah `todayActivities` dan `todayHarvestKg` per kumbung.

### 4.3 Validasi & uji
- Unit validator untuk activity input: chip yang diizinkan, `quantity` ≤ baglog aktif, dan tanggal tidak di masa depan lebih dari 5 menit.
- E2E `e2e-domain.mjs`:
  - Operator mencatat kegiatan.
  - Baglog dibuang mengurangi jumlah aktif.
  - Void mengembalikan jumlah.
  - Recap memfilter per tanggal, kumbung, dan jenis.
  - Header dan baris CSV benar.
  - Outsider ditolak (403).

## 5. Frontend (`apps/web`)

Pecah halaman menjadi komponen di `src/components/operations/`:

| Komponen | Isi |
| --- | --- |
| `TodayPanel.jsx` | Kartu batch aktif, kondisi kumbung, kegiatan hari ini |
| `QuickActions.jsx` | Tiga tombol besar (bar bawah di HP) |
| `ActivityDialog.jsx` | Catat Kegiatan dan Laporkan Masalah (satu dialog, dua mode) |
| `HarvestDialog.jsx` | Catat panen dan total hari ini |
| `BatchWizard.jsx`, `BatchCard.jsx`, `BatchCloseDialog.jsx` | Siklus batch |
| `RecapPanel.jsx`, `RecapFilters.jsx`, `ExportMenu.jsx` | Rekap, filter, export CSV/cetak |

- Tab baru: **Hari Ini · Batch · Rekap · Pengaturan** (Pengaturan hanya owner).
- Filter rekap disimpan di URL (`?from=&to=&kumbung=`) agar bisa dibagikan.
- `lib/operationsView.js` mendapat label tahap yang ramah petani dan fungsi `batchLabel(batch)`.
- Ukuran sentuh minimal 44 px, teks minimal 14 px di HP, dan semua aksi bisa dilakukan tanpa geser horizontal.

## 6. Tahapan kerja

| Fase | Isi | Selesai bila |
| --- | --- | --- |
| 1 | Migration 005, endpoint activities/void/recap/CSV, auto-log perubahan batch, unit dan e2e | e2e lulus |
| 2 | Refactor halaman ke komponen; Hari Ini, tombol cepat, Catat Kegiatan/Masalah, Catat Panen | Bisa dipakai penuh di lebar 400 px |
| 3 | Batch wizard, pindah tahap ramah petani, tutup batch dengan ringkasan | Siklus batch dari awal sampai akhir tercatat di rekap |
| 4 | Rekap dengan filter, ringkasan, tabel, export CSV, dan tampilan cetak | CSV terbuka rapi di Excel; cetak 1 halaman A4 per minggu |
| 5 | Uji browser (desktop dan HP) bersama user, perbarui `docs/`, `SYSTEM_MAP.md`, dan README API | Diterima user |

## 7. Keputusan yang perlu dikonfirmasi

1. **Operator boleh mulai/tutup batch?** Sekarang backend sudah mengizinkan operator, tetapi UI hanya menampilkan tombolnya untuk owner. Usulan: operator boleh mulai batch dan pindah tahap; tutup atau afkir tetap owner.
2. **Format export:** usulan CSV (Excel) dan cetak/PDF dari browser. File `.xlsx` asli bisa ditambah nanti dengan SheetJS.
3. **Foto kegiatan atau masalah:** membutuhkan penyimpanan file di server (bukan Firebase Storage). Usulan: tunda ke tahap berikutnya.
4. **Daftar chip kegiatan harian:** konfirmasi daftar di 3.2 atau tambahkan kebiasaan kumbung setempat.
5. **Jenis jamur:** hanya tiram, atau perlu kuping, merang, dan lainnya, dengan panduan tahap berbeda per jenis?
