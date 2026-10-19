# Salin artefak runtime dari "Modul AI Aitoma" (training) ke jamur/ai_model (deploy).
# Pakai: powershell -ExecutionPolicy Bypass -File tools/sync-ai-model.ps1 [-Source "<path Modul AI Aitoma>"]
param(
  [string]$Source = (Join-Path $PSScriptRoot "..\..\Modul AI Aitoma")
)
$ErrorActionPreference = "Stop"
$Source = (Resolve-Path $Source).Path
$Target = Join-Path $PSScriptRoot "..\ai_model"

$files = @(
  "tandurai_harvest_ai\__init__.py",
  "tandurai_harvest_ai\config.py",
  "tandurai_harvest_ai\data.py",
  "tandurai_harvest_ai\evaluation.py",
  "tandurai_harvest_ai\models.py",
  "tandurai_harvest_ai\serving.py",
  "artifacts\histgradientboosting_reference.joblib",
  "artifacts\quantile_regression.joblib",
  "artifacts\run_summary.json",
  "artifacts\model_metrics.csv",
  "artifacts\model_status.csv",
  "artifacts\batch\batch_model_manifest.json",
  "artifacts\batch\batch_yield_point.joblib",
  "artifacts\batch\batch_yield_p10.joblib",
  "artifacts\batch\batch_yield_p90.joblib",
  "artifacts\batch\batch_start_day.joblib",
  "artifacts\batch\batch_end_day.joblib",
  "data\daily_model_table.csv",
  "data\dataset_card.json"
)

foreach ($file in $files) {
  $from = Join-Path $Source $file
  if (-not (Test-Path $from)) { throw "Tidak ditemukan: $from" }
  $to = Join-Path $Target $file
  New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
  Copy-Item $from $to -Force
}
Write-Host "Tersalin $($files.Count) file dari '$Source' ke '$((Resolve-Path $Target).Path)'."
