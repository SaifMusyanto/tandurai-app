from __future__ import annotations

import hashlib
import json
import math
import os
import sys
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import joblib
import pandas as pd
import sklearn

from .config import ConfigError, WORKER_ROOT
from .feature_schema import FEATURE_COLUMNS, SCHEMA_VERSION

REQUIRED_SKLEARN_VERSION = "1.8.0"
MODEL_REFERENCE_BAGLOG_COUNT = 10_000.0


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_model_root() -> Path:
    configured = os.getenv("MODEL_MODULE_PATH", "").strip()
    candidate = Path(configured).expanduser() if configured else WORKER_ROOT / "../ai_model"
    return candidate.resolve() if candidate.is_absolute() else (WORKER_ROOT / candidate).resolve()


class HarvestModelRuntime:
    def __init__(self, model_root: Path | None = None):
        self.root = (model_root or resolve_model_root()).resolve()
        self.point_path = self.root / "artifacts/histgradientboosting_reference.joblib"
        self.quantile_path = self.root / "artifacts/quantile_regression.joblib"
        self.summary_path = self.root / "artifacts/run_summary.json"
        self.demo_table_path = self.root / "data/daily_model_table.csv"
        self.batch_artifact_dir = self.root / "artifacts/batch"
        self.batch_manifest_path = self.batch_artifact_dir / "batch_model_manifest.json"
        self.batch_model_paths = {
            "yieldPoint": self.batch_artifact_dir / "batch_yield_point.joblib",
            "yieldP10": self.batch_artifact_dir / "batch_yield_p10.joblib",
            "yieldP90": self.batch_artifact_dir / "batch_yield_p90.joblib",
            "startDay": self.batch_artifact_dir / "batch_start_day.joblib",
            "endDay": self.batch_artifact_dir / "batch_end_day.joblib",
        }
        required = [self.point_path, self.quantile_path, self.summary_path, self.batch_manifest_path, *self.batch_model_paths.values()]
        missing = [str(path) for path in required if not path.is_file()]
        if missing:
            raise ConfigError("Artefak model tidak lengkap: " + ", ".join(missing))
        if sklearn.__version__ != REQUIRED_SKLEARN_VERSION:
            raise ConfigError(
                f"scikit-learn {REQUIRED_SKLEARN_VERSION} diperlukan oleh artefak; runtime={sklearn.__version__}"
            )
        if str(self.root) not in sys.path:
            sys.path.insert(0, str(self.root))
        self.point_model = joblib.load(self.point_path)
        self.quantile_model = joblib.load(self.quantile_path)
        self.run_summary = json.loads(self.summary_path.read_text(encoding="utf-8"))
        self.batch_manifest = json.loads(self.batch_manifest_path.read_text(encoding="utf-8"))
        self.batch_models = {name: joblib.load(path) for name, path in self.batch_model_paths.items()}
        expected_batch_features = self.batch_manifest.get("featureColumns", [])
        for name, model in self.batch_models.items():
            actual = list(getattr(model, "feature_names_in_", []))
            if actual and actual != expected_batch_features:
                raise ConfigError(f"Urutan fitur batch model {name} tidak cocok dengan manifest")
        point_features = list(getattr(self.point_model.named_steps.get("preprocess"), "feature_names_in_", []))
        if point_features and point_features != list(FEATURE_COLUMNS):
            raise ConfigError("Urutan FEATURE_COLUMNS worker tidak cocok dengan artefak point model")
        self.point_sha256 = _sha256(self.point_path)
        self.quantile_sha256 = _sha256(self.quantile_path)
        self.batch_sha256 = {name: _sha256(path) for name, path in self.batch_model_paths.items()}

    @property
    def point_version(self) -> str:
        return f"histgb-reference-{self.point_sha256[:12]}"

    @property
    def quantile_version(self) -> str:
        return f"quantile-regression-{self.quantile_sha256[:12]}"

    def manifest(self) -> dict[str, Any]:
        return {
            "schemaVersion": SCHEMA_VERSION,
            "pointVersion": self.point_version,
            "quantileVersion": self.quantile_version,
            "pointSha256": self.point_sha256,
            "quantileSha256": self.quantile_sha256,
            "runtime": {"scikitLearn": sklearn.__version__},
            "inference": {
                "baglogReferenceCount": int(MODEL_REFERENCE_BAGLOG_COUNT),
                "baglogScaling": "linear_from_reference_count",
            },
            "training": {
                "dataOrigin": self.run_summary.get("data_origin"),
                "trainEnd": self.run_summary.get("train_end"),
                "validationEnd": self.run_summary.get("validation_end"),
            },
            "evidenceScope": "synthetic_benchmark",
            "fieldValidated": False,
            "claimStatus": self.run_summary.get("claim_status"),
            "batchModel": {
                "schemaVersion": self.batch_manifest.get("schemaVersion"),
                "version": f"batch-yield-{self.batch_sha256['yieldPoint'][:12]}",
                "artifactSha256": self.batch_sha256,
                "training": self.batch_manifest.get("data"),
                "calibrationPrior": self.batch_manifest.get("calibrationPrior"),
                "testMetrics": self.batch_manifest.get("testMetrics"),
                "fieldValidated": False,
                "claimStatus": self.batch_manifest.get("claimStatus"),
            },
        }

    def synthetic_fill(self, feature_payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        if not self.demo_table_path.is_file():
            raise ConfigError(f"Dataset referensi sintetis tidak ditemukan: {self.demo_table_path}")
        frame = pd.read_csv(self.demo_table_path, usecols=list(FEATURE_COLUMNS))
        same_room = frame[
            (frame["farm_id"] == feature_payload["farmId"])
            & (frame["kumbung_id"] == feature_payload["kumbungId"])
        ]
        candidates = same_room if not same_room.empty else frame
        selector = hashlib.sha256(
            f"{feature_payload['kumbungId']}|{feature_payload['asOfDate']}".encode("utf-8")
        ).digest()
        source_index = int.from_bytes(selector[:8], "big") % len(candidates)
        source = candidates.iloc[source_index]
        values = dict(feature_payload.get("features", {}))
        filled = []
        for name in FEATURE_COLUMNS:
            value = values.get(name)
            if value is None or (isinstance(value, float) and pd.isna(value)):
                fallback = source[name]
                if pd.isna(fallback):
                    continue
                values[name] = fallback.item() if hasattr(fallback, "item") else fallback
                filled.append(name)
        if any(values.get(name) is None for name in FEATURE_COLUMNS):
            raise ConfigError("Referensi sintetis masih menyisakan fitur kosong")
        enriched = deepcopy(feature_payload)
        enriched["features"] = {name: values[name] for name in FEATURE_COLUMNS}
        enriched["featureVector"] = [values[name] for name in FEATURE_COLUMNS]
        provenance = {
            "mode": "hybrid_synthetic_fill",
            "sourceDataset": "synthetic_simulation_v1",
            "sourceDatasetSha256": _sha256(self.demo_table_path),
            "filledFeatures": filled,
            "preservedObservedFeatures": [name for name in FEATURE_COLUMNS if name not in filled],
            "fieldValidated": False,
        }
        return enriched, provenance

    def synthetic_best_case(self, feature_payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        if not self.demo_table_path.is_file():
            raise ConfigError(f"Dataset referensi sintetis tidak ditemukan: {self.demo_table_path}")
        frame = pd.read_csv(self.demo_table_path, usecols=list(FEATURE_COLUMNS))
        favorable = frame[
            frame["temperature_mean_c"].between(23, 27)
            & frame["relative_humidity_mean_pct"].between(84, 94)
            & (frame["co2_mean_ppm"] <= 1300)
            & (frame["contamination_rate_pct"] <= 3)
        ]
        candidates = favorable if not favorable.empty else frame
        quantiles = self.quantile_model.predict(candidates[list(FEATURE_COLUMNS)])
        best_position = int(quantiles[0.50].argmax())
        source = candidates.iloc[best_position]
        values = {
            name: (source[name].item() if hasattr(source[name], "item") else source[name])
            for name in FEATURE_COLUMNS
        }
        observed = feature_payload.get("features", {})
        values["baglog_count_active"] = observed.get("baglog_count_active")
        values["baglog_age_days"] = observed.get("baglog_age_days")
        values["cycle_day"] = observed.get("cycle_day")
        values["contamination_rate_pct"] = observed.get("contamination_rate_pct")
        values["growth_stage"] = observed.get("growth_stage")
        values["substrate_type"] = observed.get("substrate_type")
        values["farm_id"] = feature_payload["farmId"]
        values["kumbung_id"] = feature_payload["kumbungId"]
        enriched = deepcopy(feature_payload)
        enriched["features"] = values
        enriched["featureVector"] = [values[name] for name in FEATURE_COLUMNS]
        enriched["dataQuality"] = {
            **feature_payload.get("dataQuality", {}),
            "missingFeatures": [],
            "insufficientReasons": [],
            "scenarioCompletenessPct": 100.0,
        }
        provenance = {
            "mode": "full_synthetic_best_case",
            "sourceDataset": "synthetic_simulation_v1",
            "sourceDatasetSha256": _sha256(self.demo_table_path),
            "selectionRule": "favorable_environment_then_highest_predicted_p50",
            "preservedBatchFields": ["baglog_count_active", "baglog_age_days", "cycle_day", "contamination_rate_pct", "growth_stage", "substrate_type", "farm_id", "kumbung_id"],
            "candidateRows": int(len(candidates)),
            "sourceFarmId": str(source["farm_id"]),
            "sourceKumbungId": str(source["kumbung_id"]),
            "fieldValidated": False,
        }
        return enriched, provenance


    def synthetic_planning(self, feature_payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        if not self.demo_table_path.is_file():
            raise ConfigError(f"Dataset referensi sintetis tidak ditemukan: {self.demo_table_path}")
        frame = pd.read_csv(self.demo_table_path, usecols=list(FEATURE_COLUMNS))
        candidates = frame[
            frame["cycle_day"].between(27, 34)
            & frame["temperature_mean_c"].between(23, 27)
            & frame["relative_humidity_mean_pct"].between(84, 94)
            & (frame["co2_mean_ppm"] <= 1300)
            & (frame["contamination_rate_pct"] <= 3)
        ]
        if candidates.empty:
            candidates = frame[frame["cycle_day"].between(27, 34)]
        quantiles = self.quantile_model.predict(candidates[list(FEATURE_COLUMNS)])
        source = candidates.iloc[int(quantiles[0.50].argmax())]
        values = {
            name: (source[name].item() if hasattr(source[name], "item") else source[name])
            for name in FEATURE_COLUMNS
        }
        observed = feature_payload.get("features", {})
        values["baglog_count_active"] = observed.get("baglog_count_active")
        values["baglog_age_days"] = observed.get("baglog_age_days")
        values["cycle_day"] = observed.get("cycle_day")
        values["contamination_rate_pct"] = observed.get("contamination_rate_pct")
        values["growth_stage"] = observed.get("growth_stage")
        values["substrate_type"] = observed.get("substrate_type")
        values["farm_id"] = feature_payload["farmId"]
        values["kumbung_id"] = feature_payload["kumbungId"]
        current_age = int(observed.get("cycle_day") or 0)
        projected_cycle_day = int(values["cycle_day"])
        enriched = deepcopy(feature_payload)
        enriched["features"] = values
        enriched["featureVector"] = [values[name] for name in FEATURE_COLUMNS]
        enriched["dataQuality"] = {
            **feature_payload.get("dataQuality", {}),
            "scenarioCompletenessPct": 100.0,
        }
        provenance = {
            "mode": "synthetic_projected_planning",
            "sourceDataset": "synthetic_simulation_v1",
            "sourceDatasetSha256": _sha256(self.demo_table_path),
            "selectionRule": "first_flush_window_then_highest_predicted_p50",
            "projectedDaysAhead": max(0, projected_cycle_day - current_age),
            "projectedCycleDay": projected_cycle_day,
            "currentGrowthStage": observed.get("growth_stage"),
            "fieldValidated": False,
        }
        return enriched, provenance
    def adapt_categories(self, feature_payload: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, str]]]:
        mappings = {
            "growth_stage": {
                "inoculation": "incubation", "incubation": "incubation", "fruiting": "fruiting",
                "harvesting": "fruiting", "completed": "resting",
            },
            "substrate_type": {
                "serbuk-kayu": "sawdust_bran", "jerami": "mixed_agri_waste",
                "tandan-kosong": "mixed_agri_waste", "campuran": "mixed_agri_waste",
                "lainnya": "mixed_agri_waste",
            },
        }
        adapted = deepcopy(feature_payload)
        changes = []
        for name, values in mappings.items():
            original = adapted["features"].get(name)
            target = values.get(original, original)
            if target != original:
                adapted["features"][name] = target
                changes.append({"feature": name, "from": str(original), "to": str(target)})
        adapted["featureVector"] = [adapted["features"].get(name) for name in FEATURE_COLUMNS]
        return adapted, changes

    @property
    def batch_model_version(self) -> str:
        return f"batch-yield-{self.batch_sha256['yieldPoint'][:12]}"

    # Nilai "kondisi tidak diketahui" (skor ±0,5) bila belum ada histori sensor yang cukup.
    NEUTRAL_HISTORY = {
        "avg_temperature_c": 27.0, "temperature_std_c": 1.4, "temperature_optimal_pct": 50.0,
        "avg_humidity_pct": 81.0, "humidity_std_pct": 3.0, "humidity_optimal_pct": 50.0,
        "avg_co2_ppm": 1000.0, "co2_std_ppm": 150.0, "co2_optimal_pct": 50.0,
        "sensor_completeness_pct": 0.0,
    }

    # metrik batchHistory → (kolom rata-rata, kolom simpangan baku, kolom % optimal) model batch v3
    HISTORY_COLUMNS = {
        "temperature": ("avg_temperature_c", "temperature_std_c", "temperature_optimal_pct"),
        "humidity": ("avg_humidity_pct", "humidity_std_pct", "humidity_optimal_pct"),
        "co2": ("avg_co2_ppm", "co2_std_ppm", "co2_optimal_pct"),
    }

    def batch_history_features(self, feature_payload: dict[str, Any]) -> tuple[dict[str, float], bool]:
        """Fitur histori kondisi batch (model v3) dari `batchHistory`; nilai netral bila belum cukup."""
        history = feature_payload.get("batchHistory") or {}
        if not history.get("sufficient"):
            return dict(self.NEUTRAL_HISTORY), False
        values = {}
        for metric, (mean_col, std_col, optimal_col) in self.HISTORY_COLUMNS.items():
            item = (history.get("metrics") or {}).get(metric) or {}
            for column, field in ((mean_col, "mean"), (std_col, "std"), (optimal_col, "optimalPct")):
                value = item.get(field)
                values[column] = float(value) if value is not None else self.NEUTRAL_HISTORY[column]
        values["sensor_completeness_pct"] = float(history.get("completenessPct") or 0.0)
        return values, True

    def predict_batch_total(self, feature_payload: dict[str, Any]) -> dict[str, float]:
        features = feature_payload["features"]
        active = max(0.0, float(features.get("baglog_count_active") or 0))
        contamination = min(100.0, max(0.0, float(features.get("contamination_rate_pct") or 0)))
        initial = feature_payload.get("baglogCountInitial")
        if initial is None:
            initial = active / max(0.01, 1.0 - contamination / 100.0)
        started_at = feature_payload.get("batchStartedAt")
        if started_at:
            started = datetime.fromtimestamp(float(started_at) / 1000, ZoneInfo("Asia/Jakarta"))
        else:
            age = max(0, int(features.get("baglog_age_days") or 0))
            started = datetime.fromisoformat(feature_payload["asOfDate"]) - timedelta(days=age)
        angle = 2 * math.pi * (started.month - 1) / 12
        history_values, history_used = self.batch_history_features(feature_payload)
        row_values = {
            "baglog_count_initial": float(initial),
            "baglog_count_active": active,
            "substrate_type": features.get("substrate_type") or "mixed_agri_waste",
            "contamination_pct": contamination,
            **history_values,
            "start_month_sin": math.sin(angle),
            "start_month_cos": math.cos(angle),
        }
        columns = self.batch_manifest["featureColumns"]
        row = pd.DataFrame([[row_values[name] for name in columns]], columns=columns)
        yield_point = max(0.0, float(self.batch_models["yieldPoint"].predict(row)[0]))
        yield_p10 = max(0.0, float(self.batch_models["yieldP10"].predict(row)[0]))
        yield_p90 = max(0.0, float(self.batch_models["yieldP90"].predict(row)[0]))
        start_day = max(0.0, float(self.batch_models["startDay"].predict(row)[0]))
        end_day = max(start_day + 1, float(self.batch_models["endDay"].predict(row)[0]))
        return {
            "forecastKg": yield_point * active,
            "p10Kg": min(yield_p10, yield_p90) * active,
            "p50Kg": yield_point * active,
            "p90Kg": max(yield_p10, yield_p90) * active,
            "harvestStartDay": start_day,
            "harvestEndDay": end_day,
            "yieldKgPerBaglog": yield_point,
            "historyUsed": history_used,
        }
    def predict(self, feature_payload: dict[str, Any]) -> tuple[float, dict[float, float]]:
        values = dict(feature_payload["features"])
        actual_baglogs = float(values.get("baglog_count_active") or 0)
        values["baglog_count_active"] = MODEL_REFERENCE_BAGLOG_COUNT
        row = pd.DataFrame(
            [[values.get(name) for name in FEATURE_COLUMNS]],
            columns=list(FEATURE_COLUMNS),
        )
        scale = max(0.0, actual_baglogs) / MODEL_REFERENCE_BAGLOG_COUNT
        point = float(self.point_model.predict(row)[0]) * scale
        raw_quantiles = self.quantile_model.predict(row)
        quantiles = {q: float(raw_quantiles[q][0]) * scale for q in (0.10, 0.50, 0.90)}
        return point, quantiles
