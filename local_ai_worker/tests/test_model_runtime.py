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
