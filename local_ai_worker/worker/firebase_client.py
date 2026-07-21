from __future__ import annotations

import os
import platform
import time
from typing import Any

from .config import ConfigError, WorkerConfig


class FirebaseWorkerError(RuntimeError):
    """Firebase Admin operation failed."""


class FirebaseClient:
    def __init__(self, config: WorkerConfig):
        self.config = config
        self._app = None

    def connect(self) -> "FirebaseClient":
        errors = self.config.validate(require_credentials=True)
        if errors:
            raise ConfigError("; ".join(errors))
        try:
            import firebase_admin
            from firebase_admin import credentials

            credential = credentials.Certificate(str(self.config.credentials_path))
            name = f"tandurai-worker-{os.getpid()}-{time.time_ns()}"
            self._app = firebase_admin.initialize_app(
                credential,
                {"databaseURL": self.config.database_url, "httpTimeout": self.config.request_timeout_seconds},
                name=name,
            )
            return self
        except ConfigError:
            raise
        except Exception as exc:
            raise FirebaseWorkerError(f"Gagal menginisialisasi Firebase Admin: {exc}") from exc

    def _reference(self, path: str):
        if self._app is None:
            raise FirebaseWorkerError("Firebase client belum terhubung")
        from firebase_admin import db
        return db.reference(path, app=self._app)

    def read_sensor(self, kumbung_id: str, sensor_id: str) -> dict[str, Any] | None:
        try:
            value = self._reference(f"tumbara/monitoring/{kumbung_id}/{sensor_id}").get()
            return value if isinstance(value, dict) else None
        except Exception as exc:
            raise FirebaseWorkerError(f"Gagal membaca telemetry: {exc}") from exc

    def read_feature_inputs(self, kumbung_id: str, date_keys: list[str]) -> dict[str, Any]:
        try:
            batch_index = self._reference(f"tumbara/kumbungBatches/{kumbung_id}").get() or {}
            batches = []
            if isinstance(batch_index, dict):
                for batch_id, linked in batch_index.items():
                    if linked:
                        value = self._reference(f"tumbara/baglogBatches/{batch_id}").get()
                        if isinstance(value, dict):
                            batches.append({"id": batch_id, **value})
            history = []
            for date_key in date_keys:
                values = self._reference(f"tumbara/history/{kumbung_id}/{date_key}").get() or {}
                if isinstance(values, dict):
                    history.extend(value for value in values.values() if isinstance(value, dict))
            harvest_map = self._reference(f"tumbara/harvestEvents/{kumbung_id}").get() or {}
            harvest_events = []
            if isinstance(harvest_map, dict):
                harvest_events = [{"id": key, **value} for key, value in harvest_map.items() if isinstance(value, dict)]
            return {"batches": batches, "telemetry": history, "harvestEvents": harvest_events}
        except Exception as exc:
            raise FirebaseWorkerError(f"Gagal membaca input feature engineering: {exc}") from exc

    def read_forecast_requests(self) -> dict[str, dict[str, Any]]:
        try:
            value = self._reference("tumbara/aiRequests").get() or {}
            return {
                str(kumbung_id): request
                for kumbung_id, request in value.items()
                if isinstance(request, dict)
            } if isinstance(value, dict) else {}
        except Exception as exc:
            raise FirebaseWorkerError(f"Gagal membaca permintaan forecast: {exc}") from exc

    def update_forecast_request(self, kumbung_id: str, payload: dict[str, Any]) -> None:
        try:
            self._reference(f"tumbara/aiRequests/{kumbung_id}").update(payload)
        except Exception as exc:
            raise FirebaseWorkerError(f"Gagal memperbarui permintaan forecast: {exc}") from exc
    def write_daily_features(self, kumbung_id: str, date_key: str, payload: dict[str, Any]) -> None:
        try:
            self._reference(f"tumbara/aiFeaturesDaily/{kumbung_id}/{date_key}").set(payload)
        except Exception as exc:
            raise FirebaseWorkerError(f"Gagal menulis fitur harian: {exc}") from exc

    def write_forecast(self, kumbung_id: str, forecast_id: str, payload: dict[str, Any]) -> None:
        try:
            self._reference(f"tumbara/aiForecasts/{kumbung_id}").update({
                "latest": payload,
                f"history/{forecast_id}": payload,
            })
        except Exception as exc:
            raise FirebaseWorkerError(f"Gagal menulis forecast secara atomik: {exc}") from exc

    def read_latest_forecast(self, kumbung_id: str) -> dict[str, Any] | None:
        try:
            value = self._reference(f"tumbara/aiForecasts/{kumbung_id}/latest").get()
            return value if isinstance(value, dict) else None
        except Exception as exc:
            raise FirebaseWorkerError(f"Gagal membaca forecast terbaru: {exc}") from exc

    def write_heartbeat(self, status: str, command: str, detail: str | None = None) -> None:
        now = int(time.time() * 1000)
        payload = {
            "status": status,
            "command": command,
            "detail": detail,
            "heartbeatAt": now,
            "workerVersion": self.config.worker_version,
            "hostname": platform.node(),
            "pid": os.getpid(),
            "schemaVersion": "ai-worker-status-v1",
        }
        try:
            self._reference("tumbara/aiWorker/status").set(payload)
        except Exception as exc:
            raise FirebaseWorkerError(f"Gagal menulis heartbeat: {exc}") from exc

    def close(self) -> None:
        if self._app is None:
            return
        try:
            import firebase_admin
            firebase_admin.delete_app(self._app)
        finally:
            self._app = None

    def __enter__(self) -> "FirebaseClient":
        return self.connect()

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()
