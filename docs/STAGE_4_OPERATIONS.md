# Checkpoint Tahap 4 — Operasional Kumbung

## Fitur

- Halaman `/operations` untuk melihat farm yang diizinkan.
- Manager/admin dapat memperbarui farm, membuat kumbung, membuat batch, dan memajukan lifecycle batch.
- Manager/operator/admin dapat mencatat panen.
- Viewer hanya dapat membaca.
- Event panen append-only: tidak dapat diubah atau dihapus dari client.

## Struktur data

```text
tumbara/farms/{farmId}
tumbara/farmKumbungs/{farmId}/{kumbungId} = true
tumbara/kumbungs/{kumbungId}
tumbara/kumbungBatches/{kumbungId}/{batchId} = true
tumbara/baglogBatches/{batchId}
tumbara/harvestEvents/{kumbungId}/{eventId}
```

Indeks relasi diperlukan karena RTDB Security Rules bukan filter. Web membaca ID hanya dari farm/kumbung yang diizinkan, kemudian mengambil entity satu per satu tanpa membuka koleksi global.

## Validasi utama

- Kumbung harus terhubung ke farm yang dapat dikelola user.
- Kapasitas minimal satu baglog.
- Baglog aktif tidak dapat melebihi jumlah awal.
- Kontaminasi dan grade A harus 0–100%.
- Batch harus menunjuk kumbung pada farm yang sama.
- Panen harus menunjuk batch pada kumbung yang sama.
- Panen tidak boleh sebelum batch dimulai atau lebih dari lima menit di masa depan.
- Berat panen harus lebih dari nol dan maksimal 10.000 kg/event.
- `recordedBy` harus sama dengan UID login.
- Timestamp disimpan epoch millisecond UTC, input form ditafsirkan sebagai Asia/Jakarta.

## Lifecycle

```text
inoculation → incubation → fruiting → harvesting → completed
```

UI hanya memajukan satu tahap. Status batch berubah menjadi `completed` saat tahap terakhir dicapai. Status lain yang tersedia adalah `cancelled`.

## Koreksi panen

Event panen asli sengaja immutable. Tahap ini tidak menyediakan edit/delete agar data training tidak berubah tanpa jejak. Jika terjadi kesalahan input, koreksi audit terpisah perlu ditambahkan sebelum operasi produksi lapangan; untuk demo, pemilik project dapat mencatat kejadian dan tidak memakai event salah pada dataset validasi.
