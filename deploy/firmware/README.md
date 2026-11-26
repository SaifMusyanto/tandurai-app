# Firmware gateway untuk OTA

Folder ini di-mount ke container `api` (read-only) dan disajikan publik di
`https://<DASHBOARD_DOMAIN>/api/firmware/<nama>.bin`. Hanya file `*.bin` yang disajikan; file biner tidak masuk Git.

1. Compile di laptop dengan partisi OTA, lalu ambil `<sketch>.ino.bin` (bukan `.merged.bin`):
   ```powershell
   arduino-cli compile --fqbn "esp32:esp32:esp32:PartitionScheme=min_spiffs" --output-dir out firmware/aigra/tandurai_gateway
   ```
2. Salin ke VM dengan nama yang memuat versi, mis. `tandurai-gw-aigra-0.4.1.bin`, ke folder ini.
3. Kirim ke gateway dari VM (folder `deploy/`):
   ```bash
   sudo docker compose exec api node apps/api/tools/ota.mjs --file tandurai-gw-aigra-0.4.1.bin --hw-uid TDR-XXXXXXXXXXXX
   ```

Lihat `docs/PANDUAN_DEPLOY_DOCKER_GCP.md` bagian *Update firmware gateway (OTA)*.
