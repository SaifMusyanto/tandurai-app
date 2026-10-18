from worker.forecasting import build_forecast
from worker.feature_schema import FEATURE_COLUMNS


class FakeRuntime:
    point_version = "point-test-v1"
    batch_model_version = "batch-test-v1"

    def predict_batch_total(self, value):
        contamination = float(value["features"].get("contamination_rate_pct") or 0)
        factor = 1 - contamination / 100
        return {
            "forecastKg": 600.0 * factor, "p10Kg": 500.0 * factor,
            "p50Kg": 600.0 * factor, "p90Kg": 700.0 * factor,
            "harvestStartDay": 28, "harvestEndDay": 75,
            "yieldKgPerBaglog": 0.6,
        }

    def predict(self, payload):
        return 35.0, {0.10: 30.0, 0.50: 35.0, 0.90: 40.0}

    def manifest(self):
        return {
            "schemaVersion": "harvest-features-v1", "pointVersion": self.point_version,
            "quantileVersion": "quantile-test-v1", "evidenceScope": "synthetic_benchmark",
            "fieldValidated": False,
        }


def payload():
    features = {name: 1 for name in FEATURE_COLUMNS}
    features.update({
        "baglog_count_active": 1000, "baglog_age_days": 1, "cycle_day": 1,
        "contamination_rate_pct": 0, "temperature_mean_c": 25.0,
        "relative_humidity_mean_pct": 87.0, "co2_mean_ppm": 900.0,
        "farm_id": "FARM-01", "kumbung_id": "FARM-01-K01",
        "growth_stage": "fruiting", "substrate_type": "campuran",
    })
    return {
        "schemaVersion": "harvest-features-v1", "featureCount": len(FEATURE_COLUMNS),
        "farmId": "FARM-01", "kumbungId": "FARM-01-K01", "asOfDate": "2026-07-15",
        "features": features, "featureVector": [features[name] for name in FEATURE_COLUMNS],
        "dataQuality": {"completenessPct": 100, "missingFeatures": []},
    }


def test_total_batch_forecast_uses_500_to_700_kg_per_1000_baglogs():
    result = build_forecast(FakeRuntime(), payload(), {"mode": "observed"}, generated_at=123)
    assert result["forecastType"] == "batch_total"
    assert result["forecastKg"] == 600.0
    assert (result["p10Kg"], result["p50Kg"], result["p90Kg"]) == (500.0, 600.0, 700.0)
    assert result["supplyCommitmentKg"] == 500


def test_contamination_reduces_total_batch_estimate():
    value = payload()
    value["features"]["contamination_rate_pct"] = 10
    result = build_forecast(FakeRuntime(), value, {"mode": "observed"}, generated_at=123)
    assert (result["p10Kg"], result["p50Kg"], result["p90Kg"]) == (450.0, 540.0, 630.0)


def test_demo_provenance_is_never_hidden():
    provenance = {"mode": "hybrid_synthetic_fill", "sourceDataset": "synthetic_simulation_v1", "fieldValidated": False}
    result = build_forecast(FakeRuntime(), payload(), provenance, generated_at=123)
    assert result["status"] == "demo"
    assert result["input"]["provenance"] == provenance
    assert result["model"]["evidenceScope"] == "synthetic_benchmark"
    assert "synthetic_demo_input" in {risk["code"] for risk in result["riskFactors"]}


def test_idempotency_key_does_not_depend_on_generation_time():
    one = build_forecast(FakeRuntime(), payload(), {"mode": "observed"}, generated_at=123)
    two = build_forecast(FakeRuntime(), payload(), {"mode": "observed"}, generated_at=999)
    assert one["idempotencyKey"] == two["idempotencyKey"]
    assert one["input"]["featureHash"] == two["input"]["featureHash"]
    assert one["idempotencyKey"].endswith("batch-ai-v4")


def test_idempotency_key_is_unique_per_batch():
    first = payload()
    first["batchId"] = "FARM-01-K01-B01"
    second = payload()
    second["batchId"] = "FARM-01-K01-B02"
    one = build_forecast(FakeRuntime(), first, {"mode": "observed"}, generated_at=123)
    two = build_forecast(FakeRuntime(), second, {"mode": "observed"}, generated_at=123)
    assert one["idempotencyKey"] != two["idempotencyKey"]


def test_forecast_exposes_batch_basis_and_full_harvest_window():
    value = payload()
    value["batchId"] = "FARM-01-K01-B09"
    value["features"]["baglog_count_active"] = 1500
    result = build_forecast(FakeRuntime(), value, {"mode": "observed"}, generated_at=123)
    assert result["input"]["batchId"] == "FARM-01-K01-B09"
    assert result["input"]["baglogCountActive"] == 1500
    assert result["forecastPeriodStart"] == "2026-08-11"
    assert result["forecastPeriodEnd"] == "2026-09-27"


def test_harvest_window_follows_batch_age_not_legacy_seven_day_horizon():
    value = payload()
    value["features"]["baglog_age_days"] = 30
    value["features"]["cycle_day"] = 30
    result = build_forecast(
        FakeRuntime(), value,
        {"mode": "synthetic_projected_planning", "projectedDaysAhead": 29},
        generated_at=123,
    )
    assert result["forecastPeriodStart"] == "2026-07-13"
    assert result["forecastPeriodEnd"] == "2026-08-29"
