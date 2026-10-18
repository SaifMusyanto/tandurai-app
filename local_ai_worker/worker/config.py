from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import load_dotenv

WORKER_ROOT = Path(__file__).resolve().parents[1]


class ConfigError(ValueError):
    """Configuration is missing or unsafe."""


def _path(value: str, default: str) -> Path:
    candidate = Path(value or default).expanduser()
    return candidate.resolve() if candidate.is_absolute() else (WORKER_ROOT / candidate).resolve()


def _positive_int(value: str, name: str, default: int) -> int:
    try:
        result = int(value or default)
    except ValueError as exc:
        raise ConfigError(f"{name} harus berupa angka") from exc
    if result <= 0:
        raise ConfigError(f"{name} harus lebih dari nol")
    return result


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    credentials_path: Path
    default_farm_id: str
    default_kumbung_id: str
    default_sensor_id: str
    timezone: str
    log_dir: Path
    state_dir: Path
    request_timeout_seconds: int
    worker_version: str = "0.1.0"
    # Sumber data: "api" (backend Tandurai + PostgreSQL) atau "firebase" (RTDB lama).
    data_source: str = "firebase"
    backend_url: str = "http://localhost:8787/api"
    worker_token: str = ""

    @classmethod
    def load(cls, env_file: Path | None = None) -> "WorkerConfig":
        load_dotenv(env_file or WORKER_ROOT / ".env", override=False)
        return cls(
            database_url=os.getenv("FIREBASE_DATABASE_URL", "").strip(),
            credentials_path=_path(os.getenv("FIREBASE_CREDENTIALS_PATH", ""), "credentials/firebase-admin.json"),
            default_farm_id=os.getenv("DEFAULT_FARM_ID", "FARM-01").strip(),
            default_kumbung_id=os.getenv("DEFAULT_KUMBUNG_ID", "FARM-01-K01").strip(),
            default_sensor_id=os.getenv("DEFAULT_SENSOR_ID", "SNS-0101").strip(),
            timezone=os.getenv("TIMEZONE", "Asia/Jakarta").strip(),
            log_dir=_path(os.getenv("WORKER_LOG_DIR", ""), "runtime/logs"),
            state_dir=_path(os.getenv("WORKER_STATE_DIR", ""), "runtime/state"),
            request_timeout_seconds=_positive_int(
                os.getenv("REQUEST_TIMEOUT_SECONDS", "") or os.getenv("FIREBASE_TIMEOUT_SECONDS", ""), "REQUEST_TIMEOUT_SECONDS", 20
            ),
            data_source=(os.getenv("DATA_SOURCE", "api").strip().lower() or "api"),
            backend_url=os.getenv("BACKEND_URL", "http://localhost:8787/api").strip(),
            worker_token=os.getenv("WORKER_TOKEN", "").strip(),
        )

    def validate(self, require_credentials: bool = False) -> list[str]:
        errors: list[str] = []
        if self.data_source not in ("api", "firebase"):
            errors.append("DATA_SOURCE harus api atau firebase")
        elif self.data_source == "api":
            backend = urlparse(self.backend_url)
            if backend.scheme not in ("http", "https") or not backend.netloc:
                errors.append("BACKEND_URL harus URL http(s) API backend, mis. http://localhost:8787/api")
            if require_credentials and len(self.worker_token) < 16:
                errors.append("WORKER_TOKEN wajib diisi (minimal 16 karakter, sama dengan backend)")
        else:
            parsed = urlparse(self.database_url)
            if parsed.scheme != "https" or not parsed.netloc.endswith("firebasedatabase.app"):
                errors.append("FIREBASE_DATABASE_URL harus URL HTTPS Firebase RTDB")
        if not self.default_farm_id or not self.default_kumbung_id or not self.default_sensor_id:
            errors.append("DEFAULT_FARM_ID, DEFAULT_KUMBUNG_ID, dan DEFAULT_SENSOR_ID wajib diisi")
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError:
            errors.append(f"TIMEZONE tidak dikenal: {self.timezone}")
        if require_credentials and self.data_source == "firebase" and not self.credentials_path.is_file():
            errors.append(f"Credential Firebase Admin tidak ditemukan: {self.credentials_path}")
        return errors

    def prepare_runtime(self) -> None:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.state_dir.mkdir(parents=True, exist_ok=True)

    def public_summary(self) -> dict[str, object]:
        return {
            "dataSource": self.data_source,
            "backendUrl": self.backend_url if self.data_source == "api" else None,
            "workerTokenConfigured": bool(self.worker_token),
            "databaseHost": urlparse(self.database_url).netloc or None,
            "credentialsConfigured": self.credentials_path.is_file(),
            "defaultFarmId": self.default_farm_id,
            "defaultKumbungId": self.default_kumbung_id,
            "defaultSensorId": self.default_sensor_id,
            "timezone": self.timezone,
            "logDir": str(self.log_dir),
            "stateDir": str(self.state_dir),
            "requestTimeoutSeconds": self.request_timeout_seconds,
            "workerVersion": self.worker_version,
        }
