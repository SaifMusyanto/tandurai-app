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


def _history(temp_mean, temp_pct, hum_mean, hum_pct, co2_mean, co2_pct, sufficient=True):
    return {
        "sufficient": sufficient, "completenessPct": 100.0,
        "metrics": {
            "temperature": {"mean": temp_mean, "std": 1.0, "optimalPct": temp_pct},
            "humidity": {"mean": hum_mean, "std": 2.0, "optimalPct": hum_pct},
            "co2": {"mean": co2_mean, "std": 120.0, "optimalPct": co2_pct},
        },
    }


def _batch(history):
    return {
        "asOfDate": "2026-01-31", "baglogCountInitial": 1_000, "batchStartedAt": 1_767_200_000_000,
        "features": {"baglog_count_active": 1_000, "baglog_age_days": 30, "substrate_type": "sawdust_corn", "contamination_rate_pct": 0.0},
        "batchHistory": history, "dataQuality": {"completenessPct": 100.0},
    }


def test_batch_model_v3_follows_condition_history_300_to_500_kg_per_1000_baglogs():
    model_root = Path(__file__).resolve().parents[2] / "ai_model"
    runtime = HarvestModelRuntime(model_root)
    worst = runtime.predict_batch_total(_batch(_history(31.5, 3.0, 68.0, 2.0, 2200.0, 0.0)))
    middle = runtime.predict_batch_total(_batch(_history(27.5, 60.0, 80.0, 50.0, 1050.0, 40.0)))
    best = runtime.predict_batch_total(_batch(_history(25.0, 99.0, 85.0, 98.0, 720.0, 100.0)))
    unknown = runtime.predict_batch_total(_batch({"sufficient": False}))

    assert 280 <= worst["forecastKg"] <= 330, "histori hampir selalu buruk → ±300 kg/1000 baglog"
    assert 470 <= best["forecastKg"] <= 520, "histori selalu optimal → ±500 kg/1000 baglog"
    assert worst["forecastKg"] < middle["forecastKg"] < best["forecastKg"]
    assert worst["historyUsed"] and best["historyUsed"] and not unknown["historyUsed"]
    assert 330 <= unknown["forecastKg"] <= 470, "tanpa histori → kondisi netral di tengah"
    assert best["p10Kg"] <= best["p50Kg"] <= best["p90Kg"]
    assert runtime.manifest()["batchModel"]["calibrationPrior"]["source"] == "product_requirement"
