from __future__ import annotations

import hashlib
import json
import math
import time
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .model_runtime import HarvestModelRuntime

FORECAST_SCHEMA_VERSION = "harvest-batch-ai-forecast-v4"
FORECAST_TYPE = "batch_total"


def _feature_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload["featureVector"], ensure_ascii=False, separators=(",", ":"), sort_keys=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _risk_factors(history: dict[str, Any] | None, history_used: bool, synthetic: bool) -> list[dict[str, str]]:
    """Risiko dari histori kondisi batch: parameter yang sering di luar rentang optimal."""
    risks = []
    metrics = (history or {}).get("metrics") or {}
    if history_used:
        for metric, code in (("temperature", "temperature_outside_reference"), ("humidity", "humidity_outside_reference"), ("co2", "co2_high")):
            pct = (metrics.get(metric) or {}).get("optimalPct")
            if pct is not None and pct < 70:
                risks.append({"code": code, "severity": "high" if pct < 40 else "medium"})
    else:
        risks.append({"code": "no_sensor_history", "severity": "medium"})
    if synthetic:
        risks.append({"code": "synthetic_demo_input", "severity": "high"})
    return risks


def _batch_start_date(feature_payload: dict[str, Any]) -> date:
    started_at = feature_payload.get("batchStartedAt")
    if started_at:
        return datetime.fromtimestamp(float(started_at) / 1000, ZoneInfo("Asia/Jakarta")).date()
    as_of = date.fromisoformat(feature_payload["asOfDate"])
    features = feature_payload.get("features", {})
    age = max(0, int(features.get("cycle_day") or features.get("baglog_age_days") or 0))
    return as_of - timedelta(days=age)


def build_forecast(
    runtime: HarvestModelRuntime,
    feature_payload: dict[str, Any],
    input_provenance: dict[str, Any],
    generated_at: int | None = None,
) -> dict[str, Any]:
    prediction = runtime.predict_batch_total(feature_payload)
    history = feature_payload.get("batchHistory")
    history_used = bool(prediction.get("historyUsed"))
    p10, p50, p90 = sorted(max(0.0, float(prediction[name])) for name in ("p10Kg", "p50Kg", "p90Kg"))
    point = max(0.0, float(prediction["forecastKg"]))
    width_ratio = (p90 - p10) / max(p50, 1.0)
    completeness = float(feature_payload.get("dataQuality", {}).get("completenessPct") or 0)
    scenario_completeness = float(feature_payload.get("dataQuality", {}).get("scenarioCompletenessPct") or 0)
    if not history_used:
        confidence = "low"  # belum ada histori sensor: model memakai kondisi netral
    elif width_ratio <= 0.25 and completeness >= 80:
        confidence = "high"
    elif width_ratio <= 0.55 or scenario_completeness >= 100:
        confidence = "medium"
    else:
        confidence = "low"

    batch_start = _batch_start_date(feature_payload)
    start_day = max(0, int(round(float(prediction["harvestStartDay"]))))
    end_day = max(start_day + 1, int(round(float(prediction["harvestEndDay"]))))
    period_start = batch_start + timedelta(days=start_day)
    period_end = batch_start + timedelta(days=end_day)
    manifest = runtime.manifest()
    manifest["forecastMethod"] = "trained-batch-model-v3-condition-history"
    batch_key = feature_payload.get("batchId") or "no-batch"
    idempotency_key = (
        f"{feature_payload['kumbungId']}_{batch_key}_{feature_payload['asOfDate']}_"
        f"{runtime.batch_model_version}_batch-ai-v4"
    )
    # Prediksi batch hanya memakai histori sensor nyata; isian sintetis tidak dipakai bila histori ada.
    synthetic = "synthetic" in str(input_provenance.get("mode", "")) and not history_used
    features = feature_payload["features"]
    contamination_pct = min(100.0, max(0.0, float(features.get("contamination_rate_pct") or 0)))
    return {
        "status": "demo" if synthetic else "ok",
        "schemaVersion": FORECAST_SCHEMA_VERSION,
        "forecastType": FORECAST_TYPE,
        "kumbungId": feature_payload["kumbungId"],
        "farmId": feature_payload["farmId"],
        "asOfDate": feature_payload["asOfDate"],
        "generatedAt": generated_at or int(time.time() * 1000),
        "forecastPeriodStart": period_start.isoformat(),
        "forecastPeriodEnd": period_end.isoformat(),
        "forecastKg": round(point, 2),
        "p10Kg": round(p10, 2),
        "p50Kg": round(p50, 2),
        "p90Kg": round(p90, 2),
        "confidence": confidence,
        "supplyCommitmentKg": math.floor(p10),
        "riskFactors": _risk_factors(history, history_used, synthetic),
        "conditionHistory": {
            "used": history_used,
            "conditionScore": (history or {}).get("conditionScore") if history_used else None,
            "temperatureOptimalPct": ((history or {}).get("metrics") or {}).get("temperature", {}).get("optimalPct") if history_used else None,
            "humidityOptimalPct": ((history or {}).get("metrics") or {}).get("humidity", {}).get("optimalPct") if history_used else None,
            "co2OptimalPct": ((history or {}).get("metrics") or {}).get("co2", {}).get("optimalPct") if history_used else None,
            "daysWithData": (history or {}).get("daysWithData"),
            "batchDays": (history or {}).get("batchDays"),
            "optimalRanges": (history or {}).get("optimalRanges"),
        },
        "dataQuality": feature_payload["dataQuality"],
        "input": {
            "featureSchemaVersion": feature_payload["schemaVersion"],
            "batchId": feature_payload.get("batchId"),
            "baglogCountInitial": feature_payload.get("baglogCountInitial"),
            "baglogCountActive": features.get("baglog_count_active"),
            "growthStage": features.get("growth_stage"),
            "contaminationPct": contamination_pct,
            "featureHash": _feature_hash(feature_payload),
            "featureCount": feature_payload["featureCount"],
            "provenance": input_provenance,
        },
        "prediction": {
            "yieldKgPerActiveBaglog": round(float(prediction["yieldKgPerBaglog"]), 6),
            "kgPer1000ActiveBaglogs": round(float(prediction["yieldKgPerBaglog"]) * 1000, 1),
            "harvestStartDay": round(float(prediction["harvestStartDay"]), 2),
            "harvestEndDay": round(float(prediction["harvestEndDay"]), 2),
        },
        "model": manifest,
        "idempotencyKey": idempotency_key,
    }