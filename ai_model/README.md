# ai_model — runtime model AI untuk `local_ai_worker`

Salinan **runtime** dari folder `Modul AI Aitoma` (riset & training). Isinya hanya yang dibaca worker saat inferensi, supaya model ikut repo `jamur` dan ter-deploy bersama aplikasi dalam satu image Docker.

| Path | Dipakai untuk |
|---|---|
| `tandurai_harvest_ai/` | kelas yang di-*pickle* di `quantile_regression.joblib` (`tandurai_harvest_ai.models`) |
| `artifacts/*.joblib`, `run_summary.json` | model forecast 7 hari (HistGB + quantile) |
| `artifacts/batch/` | model total panen batch v3 + manifest fitur |
| `data/daily_model_table.csv` | referensi sintetis untuk mode `hybrid_synthetic_fill` / demo |

Training, data mentah, dan dependensi berat (LightGBM, XGBoost, PyTorch) **tetap** di `Modul AI Aitoma`, tidak ikut ke server.

## Memperbarui model setelah training ulang

1. Latih ulang di `Modul AI Aitoma` (lihat README di sana).
2. Salin hasilnya ke sini:
   ```powershell
   powershell -ExecutionPolicy Bypass -File tools/sync-ai-model.ps1
   ```
3. Jalankan `npm run test:worker`, commit, lalu deploy ulang (`./deploy/deploy.sh`).

Artefak di-*pickle* dengan **scikit-learn 1.8.0**; worker menolak start bila versinya berbeda.
