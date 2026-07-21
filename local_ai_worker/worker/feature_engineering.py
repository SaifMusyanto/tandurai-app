from __future__ import annotations

import math
import statistics
import time
from collections import defaultdict
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from .feature_schema import FEATURE_COLUMNS, SCHEMA_VERSION

EXPECTED_SAMPLES_PER_DAY = 144
MIN_COMPLETENESS_PCT = 50.0
SAMPLE_HOURS = 10 / 60


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _mean(values: Iterable[Any]) -> float | None:
    clean = [value for item in values if (value := _number(item)) is not None]
    return sum(clean) / len(clean) if clean else None


def _min(values: Iterable[Any]) -> float | None:
    clean = [value for item in values if (value := _number(item)) is not None]
    return min(clean) if clean else None


def _max(values: Iterable[Any]) -> float | None:
    clean = [value for item in values if (value := _number(item)) is not None]
    return max(clean) if clean else None


def _std(values: Iterable[Any]) -> float | None:
    clean = [value for item in values if (value := _number(item)) is not None]
    return statistics.stdev(clean) if len(clean) >= 2 else None


def _round(value: Any) -> Any:
    return round(value, 6) if isinstance(value, float) and math.isfinite(value) else value


def _local_date(timestamp_ms: Any, zone: ZoneInfo) -> date | None:
    value = _number(timestamp_ms)
    if value is None or value <= 0:
        return None
    if value < 100_000_000_000:
        value *= 1000
    return datetime.fromtimestamp(value / 1000, timezone.utc).astimezone(zone).date()


def _timestamp_ms(value: Any) -> int | None:
    numeric = _number(value)
    if numeric is None or numeric <= 0:
        return None
    if numeric < 100_000_000_000:
        numeric *= 1000
    return int(numeric)


def _daily(rows: list[dict[str, Any]], zone: ZoneInfo) -> dict[date, dict[str, Any]]:
    grouped: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        key = _local_date(row.get("timestamp"), zone)
        if key is not None:
            grouped[key].append(row)

    result: dict[date, dict[str, Any]] = {}
    for key, items in grouped.items():
        result[key] = {
            "temperature_mean": _mean(item.get("temperature") for item in items),
            "temperature_min": _min(item.get("temperature") for item in items),
            "temperature_max": _max(item.get("temperature") for item in items),
            "temperature_std": _std(item.get("temperature") for item in items),
            "humidity_mean": _mean(item.get("humidity") for item in items),
            "humidity_min": _min(item.get("humidity") for item in items),
            "humidity_max": _max(item.get("humidity") for item in items),
            "humidity_std": _std(item.get("humidity") for item in items),
            "co2_mean": _mean(item.get("co2") for item in items),
            "co2_max": _max(item.get("co2") for item in items),
            "co2_std": _std(item.get("co2") for item in items),
            "pressure_mean": _mean(item.get("pressure") for item in items),
            "airflow_mean": _mean(item.get("airflow") for item in items),
            "substrate_mean": _mean(item.get("substrateMoisture") for item in items),
            "light_mean": _mean(item.get("light") for item in items),
            "fan_runtime": _mean(100.0 if item.get("fanStatus") is True else 0.0 if item.get("fanStatus") is False else None for item in items),
            "misting_runtime": _mean(100.0 if item.get("mistingStatus") is True else 0.0 if item.get("mistingStatus") is False else None for item in items),
            "temp_stress_hours": sum(SAMPLE_HOURS for item in items if (_number(item.get("temperature")) is not None and (_number(item.get("temperature")) < 20 or _number(item.get("temperature")) > 28))),
            "rh_low_hours": sum(SAMPLE_HOURS for item in items if (_number(item.get("humidity")) is not None and _number(item.get("humidity")) < 80)),
            "co2_high_hours": sum(SAMPLE_HOURS for item in items if (_number(item.get("co2")) is not None and _number(item.get("co2")) > 1500)),
            "count": len(items),
            "latest": max(filter(None, (_timestamp_ms(item.get("timestamp")) for item in items)), default=None),
        }
    return result


def _effective_harvest_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return original harvest records with their latest audit correction applied."""
    originals = [event for event in events if not event.get("correctsEventId")]
    corrections: dict[str, dict[str, Any]] = {}
    for event in events:
        target_id = event.get("correctsEventId")
        if not target_id:
            continue
        current = corrections.get(str(target_id))
        event_order = _timestamp_ms(event.get("createdAt")) or _timestamp_ms(event.get("harvestedAt")) or 0
        current_order = (
            _timestamp_ms(current.get("createdAt")) or _timestamp_ms(current.get("harvestedAt")) or 0
            if current else -1
        )
        if current is None or event_order >= current_order:
            corrections[str(target_id)] = event

    return [corrections.get(str(event.get("id")), event) for event in originals]

def build_daily_features(
    *, farm_id: str, kumbung_id: str, as_of_date: str, timezone_name: str,
    telemetry: list[dict[str, Any]], batch: dict[str, Any] | None,
    harvest_events: list[dict[str, Any]], now_ms: int | None = None,
) -> dict[str, Any]:
    zone = ZoneInfo(timezone_name)
    target = date.fromisoformat(as_of_date)
    start_local = datetime.combine(target, datetime_time.min, zone)
    end_local = start_local + timedelta(days=1)
    window_start_ms = int((start_local - timedelta(days=13)).timestamp() * 1000)
    window_end_ms = int(end_local.timestamp() * 1000)
    current_ms = now_ms if now_ms is not None else int(time.time() * 1000)
    effective_end_ms = min(window_end_ms, current_ms)

    safe_rows = []
    ignored_future = 0
    for row in telemetry:
        timestamp = _timestamp_ms(row.get("timestamp"))
        if timestamp is None:
            continue
        if timestamp >= effective_end_ms:
            ignored_future += 1
        elif timestamp >= window_start_ms:
            safe_rows.append(row)

    daily = _daily(safe_rows, zone)
    today = daily.get(target, {})
    previous_days = [target - timedelta(days=offset) for offset in range(1, 8)]
    previous = [daily[key] for key in previous_days if key in daily]

    started_at = _timestamp_ms((batch or {}).get("startedAt"))
    started_date = _local_date(started_at, zone) if started_at else None
    age = max(0, (target - started_date).days) if started_date and started_date <= target else None

    harvest_by_day: dict[date, float] = defaultdict(float)
    ignored_future_harvest = 0
    for event in _effective_harvest_events(harvest_events):
        timestamp = _timestamp_ms(event.get("harvestedAt"))
        weight = _number(event.get("weightKg"))
        if timestamp is None or weight is None:
            continue
        if timestamp >= effective_end_ms:
            ignored_future_harvest += 1
            continue
        key = _local_date(timestamp, zone)
        if key is not None and key < target:
            harvest_by_day[key] += weight

    def harvest_sum(days: int) -> float:
        return sum(harvest_by_day[target - timedelta(days=offset)] for offset in range(1, days + 1))

    weekday_angle = 2 * math.pi * target.weekday() / 7
    features: dict[str, Any] = {
        "baglog_count_active": _number((batch or {}).get("baglogCountActive")),
        "baglog_age_days": age, "cycle_day": age,
        "temperature_mean_c": today.get("temperature_mean"), "temperature_min_c": today.get("temperature_min"),
        "temperature_max_c": today.get("temperature_max"), "temperature_std_c": today.get("temperature_std"),
        "relative_humidity_mean_pct": today.get("humidity_mean"), "relative_humidity_min_pct": today.get("humidity_min"),
        "relative_humidity_max_pct": today.get("humidity_max"), "relative_humidity_std_pct": today.get("humidity_std"),
        "co2_mean_ppm": today.get("co2_mean"), "co2_max_ppm": today.get("co2_max"), "co2_std_ppm": today.get("co2_std"),
        "air_pressure_mean_hpa": today.get("pressure_mean"), "airflow_mean_ms": today.get("airflow_mean"),
        "fan_runtime_pct": today.get("fan_runtime"), "misting_runtime_pct": today.get("misting_runtime"),
        "substrate_moisture_mean_pct": today.get("substrate_mean"), "light_mean_lux": today.get("light_mean"),
        "contamination_rate_pct": _number((batch or {}).get("contaminationPct")),
        "harvest_lag_1d_kg": harvest_sum(1), "harvest_lag_3d_sum_kg": harvest_sum(3),
        "harvest_lag_7d_sum_kg": harvest_sum(7), "harvest_lag_14d_sum_kg": harvest_sum(14),
        "temperature_7d_mean_c": _mean(item.get("temperature_mean") for item in previous),
        "relative_humidity_7d_mean_pct": _mean(item.get("humidity_mean") for item in previous),
        "co2_7d_mean_ppm": _mean(item.get("co2_mean") for item in previous),
        "temp_stress_hours_7d": sum(item.get("temp_stress_hours", 0) for item in previous) if previous else None,
        "rh_low_hours_7d": sum(item.get("rh_low_hours", 0) for item in previous) if previous else None,
        "co2_high_hours_7d": sum(item.get("co2_high_hours", 0) for item in previous) if previous else None,
        "day_of_week_sin": math.sin(weekday_angle), "day_of_week_cos": math.cos(weekday_angle),
        "farm_id": farm_id, "kumbung_id": kumbung_id,
        "growth_stage": (batch or {}).get("growthStage"), "substrate_type": (batch or {}).get("substrateType"),
    }
    features = {key: _round(features.get(key)) for key in FEATURE_COLUMNS}
    missing = [key for key in FEATURE_COLUMNS if features[key] is None]
    sample_count = int(today.get("count", 0))
    completeness = round(min(100.0, sample_count / EXPECTED_SAMPLES_PER_DAY * 100), 2)
    required = ["farm_id", "kumbung_id", "growth_stage", "substrate_type", "baglog_count_active", "temperature_mean_c", "relative_humidity_mean_pct", "co2_mean_ppm"]
    reasons = []
    if batch is None:
        reasons.append("active_batch_missing")
    if completeness < MIN_COMPLETENESS_PCT:
        reasons.append("telemetry_completeness_below_50_pct")
    if any(features[name] is None for name in required):
        reasons.append("required_features_missing")
    is_partial = current_ms < window_end_ms
    if is_partial:
        reasons.append("day_not_complete")

    available = {key: value for key, value in features.items() if value is not None}
    latest = today.get("latest")
    return {
        "status": "insufficient_data" if reasons else "ok",
        "schemaVersion": SCHEMA_VERSION,
        "featureCount": len(FEATURE_COLUMNS),
        "asOfDate": as_of_date,
        "farmId": farm_id,
        "kumbungId": kumbung_id,
        "batchId": (batch or {}).get("id"),
        "baglogCountInitial": (batch or {}).get("baglogCountInitial"),
        "batchStartedAt": (batch or {}).get("startedAt"),
        "generatedAt": current_ms,
        "featureOrder": list(FEATURE_COLUMNS),
        "featureVector": [features[key] for key in FEATURE_COLUMNS],
        "features": available,
        "dataQuality": {
            "sampleCount": sample_count, "expectedSampleCount": EXPECTED_SAMPLES_PER_DAY,
            "completenessPct": completeness, "missingFeatures": missing,
            "freshestTelemetryAt": latest,
            "freshnessMinutes": round(max(0, effective_end_ms - latest) / 60000, 2) if latest else None,
            "insufficientReasons": reasons, "isPartialDay": is_partial,
        },
        "sourceWindow": {
            "timezone": timezone_name, "startAt": window_start_ms, "endAtExclusive": effective_end_ms,
            "requestedDayEndAt": window_end_ms, "ignoredFutureTelemetry": ignored_future,
            "ignoredFutureHarvestEvents": ignored_future_harvest,
        },
        "modelReadiness": {"evidenceScope": "pilot", "fieldValidated": False, "forecastWritten": False},
    }
