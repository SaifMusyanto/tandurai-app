from pathlib import Path

import pytest

from worker.commands import command_health, command_read_sensors, command_run_once, command_watch
from worker.config import WorkerConfig


class FakeClient:
    heartbeat_calls = []

    def __init__(self, config):
        self.config = config

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def read_sensor(self, kumbung_id, sensor_id):
        return {"timestamp": 123, "temperature": 27.4, "kumbungId": kumbung_id, "sensorId": sensor_id}

    def write_heartbeat(self, status, command, detail=None):
        self.heartbeat_calls.append((status, command, detail))

    def read_feature_inputs(self, kumbung_id, date_keys):
        return {
            "batches": [{
                "id": "FARM-01-K01-B01", "farmId": "FARM-01", "kumbungId": kumbung_id,
                "startedAt": 1, "baglogCountActive": 1000, "growthStage": "fruiting",
                "substrateType": "campuran", "contaminationPct": 1, "status": "active",
            }],
            "telemetry": [], "harvestEvents": [],
        }

    def write_daily_features(self, kumbung_id, date_key, payload):
        raise AssertionError("dry-run tidak boleh menulis fitur")


@pytest.fixture
def configured(tmp_path: Path):
    credential = tmp_path / "firebase.json"
    credential.write_text("{}", encoding="utf-8")
    return WorkerConfig(
        database_url="https://demo-default-rtdb.asia-southeast1.firebasedatabase.app",
        credentials_path=credential,
        default_farm_id="FARM-01", default_kumbung_id="FARM-01-K01", default_sensor_id="SNS-0101",
        timezone="Asia/Jakarta", log_dir=tmp_path / "logs", state_dir=tmp_path / "state",
        request_timeout_seconds=20,
    )


def test_live_health_reads_and_writes_heartbeat(configured):
    FakeClient.heartbeat_calls.clear()
    result = command_health(configured, live=True, client_factory=FakeClient)
    assert result["status"] == "ok"
    assert result["firebase"]["heartbeatWritten"] is True
    assert len(FakeClient.heartbeat_calls) == 1


def test_read_sensors_returns_latest_payload(configured):
    result = command_read_sensors(configured, "FARM-01-K01", "SNS-0101", FakeClient)
    assert result["telemetry"]["temperature"] == 27.4


def test_dry_run_never_writes(configured):
    FakeClient.heartbeat_calls.clear()
    result = command_run_once(configured, True, "FARM-01-K01", "SNS-0101", client_factory=FakeClient)
    assert result["writePerformed"] is False
    assert FakeClient.heartbeat_calls == []


def test_non_dry_run_is_blocked_when_data_is_insufficient(configured):
    result = command_run_once(configured, False, "FARM-01-K01", "SNS-0101", client_factory=FakeClient)
    assert result["status"] == "insufficient_data"
    assert result["writePerformed"] is False


class FakeWatchClient(FakeClient):
    requests = {}
    updates = []
    forecasts = []

    def read_forecast_requests(self):
        return self.requests

    def update_forecast_request(self, kumbung_id, payload):
        self.updates.append((kumbung_id, payload))
        self.requests[kumbung_id] = {**self.requests[kumbung_id], **payload}

    def write_daily_features(self, kumbung_id, date_key, payload):
        return None

    def write_forecast(self, kumbung_id, forecast_id, payload):
        self.forecasts.append((kumbung_id, forecast_id, payload))


class FakeWatchRuntime:
    point_version = "point-watch-v1"
    batch_model_version = "batch-watch-v1"

    def predict_batch_total(self, feature):
        baglogs = float(feature["features"]["baglog_count_active"])
        return {
            "forecastKg": baglogs * 0.4, "p10Kg": baglogs * 0.3,
            "p50Kg": baglogs * 0.4, "p90Kg": baglogs * 0.5,
            "harvestStartDay": 30, "harvestEndDay": 75,
            "yieldKgPerBaglog": 0.4,
        }

    def synthetic_fill(self, feature):
        values = {name: feature.get("features", {}).get(name, 1) for name in feature["featureOrder"]}
        values.update({
            "farm_id": feature["farmId"], "kumbung_id": feature["kumbungId"],
            "growth_stage": values.get("growth_stage") or "fruiting",
            "substrate_type": values.get("substrate_type") or "mixed_agri_waste",
        })
        enriched = {**feature, "features": values, "featureVector": [values[name] for name in feature["featureOrder"]]}
        return enriched, {"mode": "hybrid_synthetic_fill", "fieldValidated": False}

    def adapt_categories(self, feature):
        return feature, []

    def predict(self, feature):
        amount = float(feature["features"]["baglog_count_active"]) / 10
        return amount, {0.10: amount * 0.8, 0.50: amount, 0.90: amount * 1.2}

    def manifest(self):
        return {
            "pointVersion": self.point_version, "evidenceScope": "synthetic_benchmark",
            "fieldValidated": False,
        }


def test_watch_processes_pending_web_request(configured):
    FakeWatchClient.requests = {
        "FARM-01-K01": {
            "status": "pending", "requestedAt": 123, "asOfDate": "2026-07-15",
            "batchId": "FARM-01-K01-B01",
        },
    }
    FakeWatchClient.updates = []
    FakeWatchClient.forecasts = []
    result = command_watch(
        configured, once=True, client_factory=FakeWatchClient,
        runtime_factory=FakeWatchRuntime,
    )
    assert result["processed"] == 1
    assert FakeWatchClient.requests["FARM-01-K01"]["status"] == "completed"
    assert FakeWatchClient.forecasts[0][2]["input"]["baglogCountActive"] == 1000
    assert FakeWatchClient.forecasts[0][2]["input"]["batchId"] == "FARM-01-K01-B01"
