# Panduan Agent

Berlaku untuk aplikasi `apps/web`.

- Mulai dari [`SYSTEM_MAP.md`](SYSTEM_MAP.md), lalu baca hanya dokumen dan source yang relevan. Source code adalah sumber kebenaran.
- Buat perubahan terkecil yang menyelesaikan tugas; pertahankan perilaku lain dan hindari refactor atau dependency tanpa alasan.
- Gunakan komponen di `src/components/` dan `src/components/ui/`; ikuti pola Tailwind dan helper `cn`.
- Pisahkan tanggung jawab: page untuk komposisi, component untuk UI, hook untuk state/effect reusable, `src/lib` untuk domain dan layanan. Hindari abstraksi atau global state yang tidak diperlukan.
- Ikuti pola React dan JavaScript/JSX. Bersihkan subscription/effect serta tangani loading, data kosong, dan error.
- Gunakan service dan path builder Firebase yang ada bila sesuai; jangan sebarkan literal path database.
- Jangan menaruh secret di source atau `VITE_*`, dan jangan tampilkan nilai `.env`.
- Jaga aksesibilitas, responsivitas, dan gaya file sekitar. Jangan ubah area yang tidak terkait.
- Jangan ubah file hasil generate/build atau folder/file yang dikecualikan di [`SYSTEM_MAP.md`](SYSTEM_MAP.md).
- Jangan jalankan test, lint, atau build kecuali diminta. Periksa diff dan laporkan verifikasi dengan akurat.
- Jika flow/arsitektur berubah, perbarui dokumen `docs/` terkait dan `SYSTEM_MAP.md`.
