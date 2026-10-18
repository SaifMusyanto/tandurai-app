import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from worker.backend_client import BackendClient, BackendWorkerError, create_client
from worker.config import WorkerConfig
from worker.firebase_client import FirebaseClient, FirebaseWorkerError

TOKEN = "worker-token-0123456789"


class Handler(BaseHTTPRequestHandler):
    calls: list = []

    def _respond(self, status, body=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length)) if length else None
        Handler.calls.append((self.command, self.path, self.headers.get("Authorization"), body))
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self._respond(401, {"error": "unauthorized"})
        if self.path == "/api/worker/forecast-requests":
            return self._respond(200, {"K1": {"status": "pending", "batchId": "B1"}})
        if self.path.startswith("/api/worker/kumbungs/K1/feature-inputs?dates=2026-10-14,2026-10-15"):
            return self._respond(200, {"batches": [{"id": "B1"}], "telemetry": [{"timestamp": 1}], "harvestEvents": []})
        if self.path == "/api/worker/kumbungs/K1/forecasts/latest":
            return self._respond(200, None)
        if self.command in ("PUT", "PATCH"):
            return self._respond(204)
        return self._respond(404, {"error": "not_found"})

    do_GET = do_PUT = do_PATCH = _handle

    def log_message(self, *args):
        pass


@pytest.fixture()
def server():
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    Handler.calls.clear()
    yield f"http://127.0.0.1:{httpd.server_port}/api"
    httpd.shutdown()


def config(tmp_path: Path, **overrides) -> WorkerConfig:
    values = dict(
        database_url="", credentials_path=tmp_path / "missing.json", default_farm_id="FARM-01",
        default_kumbung_id="K1", default_sensor_id="S1", timezone="Asia/Jakarta",
        log_dir=tmp_path / "logs", state_dir=tmp_path / "state", request_timeout_seconds=5,
        data_source="api", backend_url="http://127.0.0.1:9/api", worker_token=TOKEN,
    )
    values.update(overrides)
    return WorkerConfig(**values)


def test_api_mode_validation_needs_token_not_firebase(tmp_path):
    assert config(tmp_path).validate(require_credentials=True) == []
    errors = config(tmp_path, worker_token="pendek").validate(require_credentials=True)
    assert len(errors) == 1 and "WORKER_TOKEN" in errors[0]
    assert "worker_token" not in json.dumps(config(tmp_path).public_summary()).lower().replace("workertokenconfigured", "")


def test_create_client_follows_data_source(tmp_path):
    assert isinstance(create_client(config(tmp_path)), BackendClient)
    assert isinstance(create_client(config(tmp_path, data_source="firebase")), FirebaseClient)


def test_backend_client_contract(tmp_path, server):
    with BackendClient(config(tmp_path, backend_url=server)) as client:
        assert client.read_forecast_requests() == {"K1": {"status": "pending", "batchId": "B1"}}
        inputs = client.read_feature_inputs("K1", ["2026-10-14", "2026-10-15"])
        assert inputs["batches"][0]["id"] == "B1" and inputs["harvestEvents"] == []
        assert client.read_latest_forecast("K1") is None
        client.update_forecast_request("K1", {"status": "processing"})
        client.write_daily_features("K1", "2026-10-15", {"x": 1})
        client.write_forecast("K1", "fc 1", {"generatedAt": 1})
        client.write_heartbeat("idle", "watch")
    methods = [(method, path) for method, path, _, _ in Handler.calls]
    assert ("PATCH", "/api/worker/forecast-requests/K1") in methods
    assert ("PUT", "/api/worker/kumbungs/K1/forecasts/fc%201") in methods
    assert all(auth == f"Bearer {TOKEN}" for _, _, auth, _ in Handler.calls)
    heartbeat = next(body for method, path, _, body in Handler.calls if path == "/api/worker/status")
    assert heartbeat["status"] == "idle" and heartbeat["schemaVersion"] == "ai-worker-status-v1"


def test_backend_errors_are_worker_errors(tmp_path, server):
    client = BackendClient(config(tmp_path, backend_url=server, worker_token="token-salah-0123456789"))
    with pytest.raises(FirebaseWorkerError) as raised:
        client.read_forecast_requests()
    assert isinstance(raised.value, BackendWorkerError) and "401" in str(raised.value)
