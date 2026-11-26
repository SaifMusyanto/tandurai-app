# Backup firmware versi sebelumnya

Salinan firmware yang sudah ter-commit (`origin/develop`, commit 695f1e6) sebelum upgrade ke **esp32-gw/0.4.0** (OTA + diagnostik).
Dipakai untuk **kembali ke versi lama lewat USB** bila 0.4.0 bermasalah.

| Folder | Versi | Sketch | Versi terbaru |
|---|---|---|---|
| `aigra-esp32-gw-0.3.2/tandurai_gateway/` | esp32-gw/0.3.2 | board Aigra (lapangan) | `firmware/aigra/tandurai_gateway/` (0.4.0) |
| `generic-esp32-gw-0.3.0/tandurai-gateway/` | esp32-gw/0.3.0 | referensi generik | `firmware/tandurai-gateway/` (0.4.0) |

## Cara kembali ke versi lama
1. Buka folder sketch di Arduino IDE (nama folder = nama `.ino`, jangan diganti).
2. Matikan *Erase All Flash Before Sketch Upload* agar Wi-Fi, hwUid, secret, dan jadwal di NVS tetap tersimpan.
3. Partition scheme boleh tetap `Minimal SPIFFS`; lokasi NVS sama di semua scheme.
4. Upload lewat USB.

Catatan:
- Versi lama tidak mendukung OTA, jadi kembali ke 0.4.0 juga harus lewat USB.
- Versi lama hanya memercayai ISRG Root X1; jika sertifikat MQTT berganti ke rantai ECDSA (X2), koneksi TLS akan gagal.
- Generic 0.3.0 menyimpan config sebagai string, sedangkan 0.4.0 sebagai blob. Setelah downgrade, jadwal kosong sampai backend mengirim ulang config.
