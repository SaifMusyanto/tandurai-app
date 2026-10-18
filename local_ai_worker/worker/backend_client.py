from __future__ import annotations

import json
import os
import platform
import time
from typing import Any
from urllib import error, parse, request

from .config import ConfigError, WorkerConfig
from .firebase_client import FirebaseWorkerError


class BackendWorkerError(FirebaseWorkerError):
    """Operasi API backend gagal (turunan FirebaseWorkerError agar penanganan error command tetap sama)."""


class BackendClient:
    """Klien API internal backend Tandurai (`/api/worker/*`, Bearer WORKER_TOKEN).

    Antarmuka sama dengan FirebaseClient sehingga commands.py tidak perlu tahu sumber datanya.
    """

    def __init__(self, config: WorkerConfig):
        self.config = config
        self._base = config.backend_url.rstrip("/") + "/worker"

    def connect(self) -> "BackendClient":
        errors = self.config.validate(require_credentials=True)
        if errors:
            raise ConfigError("; ".join(errors))
        return self

    def _call(self, method: str, path: str, body: Any = None) -> Any:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = request.Request(
            self._base + path,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.config.worker_token}",
                **({"Content-Type": "application/json"} if data is not None else {}),
            },
        )
        try:
            with request.urlopen(req, timeout=self.config.request_timeout_seconds) as response:
                text = response.read().decode("utf-8")
                return json.loads(text) if text else None
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            raise BackendWorkerError(f"API backend {method} {path} gagal ({exc.code}): {detail}") from exc
        except (error.URLError, TimeoutError, OSError) as exc:
            raise BackendWorkerError(f"Backend tidak dapat dihubungi: {exc}") from exc

    @staticmethod
    def _id(value: str) -> str:
        return parse.quote(str(value), safe="")

    def read_sensor(self, kumbung_id: str, sensor_id: str) -> dict[str, Any] | None:
        value = self._call("GET", f"/kumbungs/{self._id(kumbung_id)}/sensors/{self._id(sensor_id)}/latest")
        return value if isinstance(value, dict) else None

    def read_feature_inputs(self, kumbung_id: str, date_keys: list[str]) -> dict[str, Any]:
        dates = parse.quote(",".join(date_keys), safe=",")
        value = self._call("GET", f"/kumbungs/{self._id(kumbung_id)}/feature-inputs?dates={dates}") or {}
        return {
            "batches": value.get("batches") or [],
            "telemetry": value.get("telemetry") or [],
            "harvestEvents": value.get("harvestEvents") or [],
        }

    def read_forecast_requests(self) -> dict[str, dict[str, Any]]:
        value = self._call("GET", "/forecast-requests") or {}
        return {str(key): item for key, item in value.items() if isinstance(item, dict)} if isinstance(value, dict) else {}

    def update_forecast_request(self, kumbung_id: str, payload: dict[str, Any]) -> None:
        self._call("PATCH", f"/forecast-requests/{self._id(kumbung_id)}", payload)

    def write_daily_features(self, kumbung_id: str, date_key: str, payload: dict[str, Any]) -> None:
        self._call("PUT", f"/kumbungs/{self._id(kumbung_id)}/features/{self._id(date_key)}", payload)

    def write_forecast(self, kumbung_id: str, forecast_id: str, payload: dict[str, Any]) -> None:
        self._call("PUT", f"/kumbungs/{self._id(kumbung_id)}/forecasts/{self._id(forecast_id)}", payload)

    def read_latest_forecast(self, kumbung_id: str) -> dict[str, Any] | None:
        value = self._call("GET", f"/kumbungs/{self._id(kumbung_id)}/forecasts/latest")
        return value if isinstance(value, dict) else None

    def write_heartbeat(self, status: str, command: str, detail: str | None = None) -> None:
        self._call("PUT", "/status", {
            "status": status,
            "command": command,
            "detail": detail,
            "heartbeatAt": int(time.time() * 1000),
            "workerVersion": self.config.worker_version,
            "hostname": platform.node(),
            "pid": os.getpid(),
            "schemaVersion": "ai-worker-status-v1",
        })

    def close(self) -> None:
        return None

    def __enter__(self) -> "BackendClient":
        return self.connect()

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()


def create_client(config: WorkerConfig):
    """Klien sumber data sesuai DATA_SOURCE (`api` = backend PostgreSQL, `firebase` = RTDB lama)."""
    if config.data_source == "firebase":
        from .firebase_client import FirebaseClient
        return FirebaseClient(config)
    return BackendClient(config)
