from datetime import datetime, timezone

import pytest

from worker.feature_engineering import build_daily_features
from worker.feature_schema import FEATURE_COLUMNS


def ms(value: str) -> int:
    return int(datetime.fromisoformat(value).astimezone(timezone.utc).timestamp() * 1000)


def batch():
    return {
        "id": "FARM-01-K01-B01", "startedAt": ms("2026-07-01T00:00:00+07:00"),
        "baglogCountActive": 980, "growthStage": "fruiting", "substrateType": "campuran",
        "contaminationPct": 2.0, "status": "active",
    }


def row(at: str, temperature=26, humidity=85, co2=700, **extra):
    return {
        "timestamp": ms(at), "temperature": temperature, "humidity": humidity, "co2": co2,
        "pressure": 1008, "fanStatus": False, "mistingStatus": False, **extra,
    }


def build(telemetry, harvest_events=None, now="2026-07-16T01:00:00+07:00"):
    return build_daily_features(
        farm_id="FARM-01", kumbung_id="FARM-01-K01", as_of_date="2026-07-15",
        timezone_name="Asia/Jakarta", telemetry=telemetry, batch=batch(),
        harvest_events=harvest_events or [], now_ms=ms(now),
    )


def test_schema_exactly_matches_model_feature_order():
    assert len(FEATURE_COLUMNS) == 37
    assert FEATURE_COLUMNS[:4] == ("baglog_count_active", "baglog_age_days", "cycle_day", "temperature_mean_c")
    assert FEATURE_COLUMNS[-4:] == ("farm_id", "kumbung_id", "growth_stage", "substrate_type")


def test_golden_daily_aggregation_and_missing_values():
    result = build([
        row("2026-07-15T00:05:00+07:00", temperature=24, humidity=80, co2=600, fanStatus=True),
        row("2026-07-15T23:55:00+07:00", temperature=28, humidity=90, co2=800),
    ])
    feature = result["features"]
    assert feature["temperature_mean_c"] == 26
    assert feature["temperature_std_c"] == pytest.approx(2.828427)
    assert feature["fan_runtime_pct"] == 50
    assert "airflow_mean_ms" not in feature
    assert result["featureVector"][FEATURE_COLUMNS.index("airflow_mean_ms")] is None


def test_timezone_boundary_and_future_records_are_excluded():
    before = build([row("2026-07-15T23:59:59+07:00", temperature=20)])
    after = build([row("2026-07-15T23:59:59+07:00", temperature=20), row("2026-07-16T00:00:00+07:00", temperature=55)])
    assert before["features"] == after["features"]
    assert after["sourceWindow"]["ignoredFutureTelemetry"] == 1


def test_harvest_lags_use_only_prior_days():
    events = [
        {"harvestedAt": ms("2026-07-14T10:00:00+07:00"), "weightKg": 5},
        {"harvestedAt": ms("2026-07-15T10:00:00+07:00"), "weightKg": 99},
    ]
    result = build([row("2026-07-15T12:00:00+07:00")], events)
    assert result["features"]["harvest_lag_1d_kg"] == 5
    assert result["features"]["harvest_lag_14d_sum_kg"] == 5


def test_rolling_environment_excludes_current_day():
    result = build([row("2026-07-14T12:00:00+07:00", temperature=20), row("2026-07-15T12:00:00+07:00", temperature=30)])
    assert result["features"]["temperature_mean_c"] == 30
    assert result["features"]["temperature_7d_mean_c"] == 20


def test_sparse_or_partial_day_is_insufficient():
    sparse = build([row("2026-07-15T12:00:00+07:00")])
    partial = build([row("2026-07-15T12:00:00+07:00")], now="2026-07-15T13:00:00+07:00")
    assert sparse["status"] == "insufficient_data"
    assert "telemetry_completeness_below_50_pct" in sparse["dataQuality"]["insufficientReasons"]
    assert "day_not_complete" in partial["dataQuality"]["insufficientReasons"]


def test_harvest_correction_replaces_original_without_double_counting():
    events = [
        {
            "id": "PANEN-1", "harvestedAt": ms("2026-07-14T10:00:00+07:00"),
            "weightKg": 5, "createdAt": ms("2026-07-14T10:01:00+07:00"),
        },
        {
            "id": "KOREKSI-1", "correctsEventId": "PANEN-1",
            "harvestedAt": ms("2026-07-14T10:00:00+07:00"), "weightKg": 7,
            "createdAt": ms("2026-07-14T11:00:00+07:00"),
        },
    ]
    result = build([row("2026-07-15T12:00:00+07:00")], events)
    assert result["features"]["harvest_lag_1d_kg"] == 7
