from pathlib import Path

from worker.config import WorkerConfig


def config(tmp_path: Path) -> WorkerConfig:
    return WorkerConfig(
        database_url="https://demo-default-rtdb.asia-southeast1.firebasedatabase.app",
        credentials_path=tmp_path / "missing.json",
        default_farm_id="FARM-01",
        default_kumbung_id="FARM-01-K01",
        default_sensor_id="SNS-0101",
        timezone="Asia/Jakarta",
        log_dir=tmp_path / "logs",
        state_dir=tmp_path / "state",
        request_timeout_seconds=20,
    )


def test_local_validation_does_not_require_secret(tmp_path):
    assert config(tmp_path).validate(require_credentials=False) == []


def test_live_validation_requires_admin_credential(tmp_path):
    errors = config(tmp_path).validate(require_credentials=True)
    assert len(errors) == 1
    assert "tidak ditemukan" in errors[0]


def test_public_summary_never_contains_private_key(tmp_path):
    summary = config(tmp_path).public_summary()
    assert summary["credentialsConfigured"] is False
    assert "credential" not in json_text(summary).lower().replace("credentialsconfigured", "")


def json_text(value):
    import json
    return json.dumps(value)
