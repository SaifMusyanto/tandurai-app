from pathlib import Path

import pytest

from worker.config import ConfigError
from worker.model_runtime import HarvestModelRuntime
from worker.feature_schema import FEATURE_COLUMNS


def test_missing_artifacts_are_rejected(tmp_path: Path):
    with pytest.raises(ConfigError, match="Artefak model tidak lengkap"):
        HarvestModelRuntime(tmp_path)



class PointModel:
    def predict(self, frame):
        assert frame.iloc[0]["baglog_count_active"] == 10_000
        return [100.0]


class QuantileModel:
    def predict(self, frame):
        assert frame.iloc[0]["baglog_count_active"] == 10_000
        return {0.10: [80.0], 0.50: [100.0], 0.90: [120.0]}


def test_prediction_scales_with_active_baglog_count():
    runtime = object.__new__(HarvestModelRuntime)
    runtime.point_model = PointModel()
    runtime.quantile_model = QuantileModel()
    features = {name: 1 for name in FEATURE_COLUMNS}
    features.update({
        "baglog_count_active": 2_000,
        "farm_id": "FARM-01", "kumbung_id": "FARM-01-K01",
        "growth_stage": "fruiting", "substrate_type": "sawdust_bran",
    })
    point, quantiles = runtime.predict({"features": features})
    assert point == 20.0
    assert quantiles == {0.10: 16.0, 0.50: 20.0, 0.90: 24.0}


def test_retrained_batch_artifact_matches_farmer_yield_prior():
    model_root = Path(__file__).resolve().parents[3] / "Modul AI Aitoma"
    runtime = HarvestModelRuntime(model_root)
    result = runtime.predict_batch_total({
        "asOfDate": "2026-01-31",
        "baglogCountInitial": 1_000,
        "features": {
            "baglog_count_active": 1_000,
            "baglog_age_days": 30,
            "substrate_type": "sawdust_bran",
            "temperature_mean_c": 25.5,
            "temperature_std_c": 0.8,
            "relative_humidity_mean_pct": 88.0,
            "relative_humidity_std_pct": 1.5,
            "co2_mean_ppm": 900.0,
            "co2_high_hours_7d": 0.0,
            "substrate_moisture_mean_pct": 64.0,
            "contamination_rate_pct": 0.0,
        },
        "dataQuality": {"completenessPct": 100.0},
    })

    assert 500 <= result["forecastKg"] <= 700
    assert 0.50 <= result["yieldKgPerBaglog"] <= 0.70
    assert result["p10Kg"] <= result["p50Kg"] <= result["p90Kg"]
    assert runtime.manifest()["batchModel"]["calibrationPrior"]["source"] == "farmer_interview"
