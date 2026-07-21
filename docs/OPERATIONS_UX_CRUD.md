# UX dan CRUD Operasional Kumbung

## Tujuan pengalaman pengguna

Halaman Operasional Kumbung dibuat sebagai panduan kerja, bukan tabel administrasi. Petani cukup:

1. Memilih farm dan kumbung.
2. Membuka tab **Hari Ini** untuk melihat fase yang sedang berjalan.
3. Menekan **Sudah selesai, lanjut tahap** setelah pekerjaan fase selesai.
4. Mencatat hasil timbangan pada **Catatan Panen**.
5. Mengoreksi kesalahan tanpa menghapus riwayat lama.

Lima fase selalu ditampilkan dalam urutan yang sama:

1. Masukkan bibit.
2. Tunggu miselium tumbuh.
3. Mulai pembentukan jamur.
4. Masa panen.
5. Siklus selesai.

Formulir lanjutan disimpan dalam dialog agar halaman utama tidak penuh dan membingungkan.

## Cakupan CRUD yang aman

| Data | Buat | Lihat | Ubah | Hapus/penutupan |
| --- | --- | --- | --- | --- |
| Farm | Bootstrap admin | Ya | Nama, lokasi, status | Nonaktifkan |
| Kumbung | Manager/admin | Ya | Nama, kapasitas, status | Nonaktifkan |
| Batch baglog | Manager/admin | Ya | Jumlah, bahan, fase, kontaminasi, status | Batalkan atau selesaikan |
| Hasil panen | Operator/manager/admin | Ya | Koreksi dengan alasan | Tidak dihapus; audit dipertahankan |

Penghapusan permanen sengaja tidak tersedia untuk farm, kumbung, batch, dan panen karena dapat memutus hubungan data serta mengubah perhitungan prediksi. Status dan koreksi menyediakan hasil operasional yang setara tanpa kehilangan sejarah.

## Koreksi hasil panen

Koreksi dibuat sebagai event baru yang menunjuk catatan asli. Web menampilkan koreksi terbaru sebagai nilai aktif, sedangkan worker AI mengganti nilai asli dengan koreksi terbaru sebelum menghitung fitur panen. Dengan demikian:

- riwayat siapa dan alasan perubahan tetap tersedia;
- nilai asli dan koreksi tidak dijumlahkan dua kali;
- koreksi terhadap event yang tidak ada ditolak oleh Firebase Rules.

## Hak akses

- viewer: melihat data.
- operator: melihat dan mencatat/mengoreksi panen.
- manager dan admin: seluruh aksi operator serta mengelola farm, kumbung, batch, dan fase.