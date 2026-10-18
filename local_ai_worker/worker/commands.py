from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

from .config import ConfigError, WorkerConfig
from .backend_client import create_client
from .firebase_client import FirebaseWorkerError
from .feature_engineering import build_daily_features
from .forecasting import build_forecast
from .logging_config import configure_logging
from .model_runtime import HarvestModelRuntime

EXIT_OK = 0
EXIT_CONFIG = 2
EXIT_FIREBASE = 3
EXIT_COMMAND = 4


def _print(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def command_health(config: WorkerConfig, live: bool, client_factory: Callable = create_client) -> dict[str, object]:
    errors = config.validate(require_credentials=live)
    result: dict[str, object] = {
        "command": "health",
        "status": "ok" if not errors else "configuration_required",
        "live": live,
        "configuration": config.public_summary(),
        "errors": errors,
    }
    if errors or not live:
        return result
    with client_factory(config) as client:
        telemetry = client.read_sensor(config.default_kumbung_id, config.default_sensor_id)
        client.write_heartbeat("healthy", "health", "Firebase read/write berhasil")
        result["firebase"] = {
            "connected": True,
            "sensorFound": telemetry is not None,
            "sensorTimestamp": telemetry.get("timestamp") if telemetry else None,
            "heartbeatWritten": True,
        }
    return result


def command_read_sensors(
    config: WorkerConfig, kumbung_id: str, sensor_id: str, client_factory: Callable = create_client
) -> dict[str, object]:
    with client_factory(config) as client:
        telemetry = client.read_sensor(kumbung_id, sensor_id)
    return {
        "command": "read-sensors",
        "status": "ok" if telemetry else "not_found",
        "kumbungId": kumbung_id,
        "sensorId": sensor_id,
        "telemetry": telemetry,
    }


def _default_feature_date(config: WorkerConfig) -> str:
    return (datetime.now(ZoneInfo(config.timezone)).date() - timedelta(days=1)).isoformat()


def _date_keys(as_of_date: str, days: int = 14) -> list[str]:
    target = date.fromisoformat(as_of_date)
    return [(target - timedelta(days=offset)).isoformat() for offset in range(days - 1, -1, -1)]


MAX_HISTORY_DAYS = 120  # batas tanggal per permintaan feature-inputs backend


def _batch_history_days(batch: dict | None, as_of_date: str, timezone_name: str) -> int:
    """Jumlah hari dari tanggal mulai batch sampai `as_of_date` (inklusif, maks 120)."""
    started = (batch or {}).get("startedAt")
    if not started:
        return 0
    start_date = datetime.fromtimestamp(int(started) / 1000, ZoneInfo(timezone_name)).date()
    return max(1, min(MAX_HISTORY_DAYS, (date.fromisoformat(as_of_date) - start_date).days + 1))


def _select_batch(
    batches: list[dict], as_of_date: str, timezone_name: str, batch_id: str | None = None,
) -> dict | None:
    target_end = datetime.combine(date.fromisoformat(as_of_date) + timedelta(days=1), datetime.min.time(), ZoneInfo(timezone_name))
    cutoff_ms = int(target_end.timestamp() * 1000)
    eligible = [batch for batch in batches if batch.get("status") == "active" and int(batch.get("startedAt") or 0) < cutoff_ms]
    if batch_id:
        return next((batch for batch in eligible if batch.get("id") == batch_id), None)
    return max(eligible, key=lambda item: int(item.get("startedAt") or 0), default=None)


def command_build_features(
    config: WorkerConfig, dry_run: bool, kumbung_id: str, as_of_date: str | None = None,
    client_factory: Callable = create_client, batch_id: str | None = None,
) -> dict[str, object]:
    target_date = as_of_date or _default_feature_date(config)
    date.fromisoformat(target_date)
    with client_factory(config) as client:
        inputs = client.read_feature_inputs(kumbung_id, _date_keys(target_date))
        batch = _select_batch(inputs["batches"], target_date, config.timezone, batch_id)
        # Model batch memakai histori kondisi sejak batch mulai → ambil telemetry seluruh batch.
        history_days = _batch_history_days(batch, target_date, config.timezone)
        if history_days > 14:
            inputs = client.read_feature_inputs(kumbung_id, _date_keys(target_date, history_days))
        farm_id = (batch or {}).get("farmId") or config.default_farm_id
        payload = build_daily_features(
            farm_id=farm_id, kumbung_id=kumbung_id, as_of_date=target_date,
            timezone_name=config.timezone, telemetry=inputs["telemetry"], batch=batch,
            harvest_events=inputs["harvestEvents"],
        )
        if not dry_run:
            client.write_daily_features(kumbung_id, target_date, payload)
    return {
        "command": "build-features", "status": payload["status"], "dryRun": dry_run,
        "writePerformed": not dry_run, "kumbungId": kumbung_id, "asOfDate": target_date,
        "feature": payload,
    }


def command_run_once(
    config: WorkerConfig, dry_run: bool, kumbung_id: str, sensor_id: str,
    as_of_date: str | None = None, demo_synthetic_fill: bool = False,
    demo_best_case: bool = False, demo_planning: bool = False, batch_id: str | None = None,
    client_factory: Callable = create_client, runtime_factory: Callable = HarvestModelRuntime,
) -> dict[str, object]:
    feature_result = command_build_features(config, True, kumbung_id, as_of_date, client_factory, batch_id)
    raw_feature = feature_result["feature"]
    if sum(bool(value) for value in (demo_synthetic_fill, demo_best_case, demo_planning)) > 1:
        raise ConfigError("Pilih hanya satu mode demo")
    if raw_feature["status"] != "ok" and not demo_synthetic_fill and not demo_best_case and not demo_planning:
        return {
            "command": "run-once", "status": "insufficient_data", "dryRun": dry_run,
            "writePerformed": False, "kumbungId": kumbung_id, "sensorId": sensor_id,
            "asOfDate": raw_feature["asOfDate"], "dataQuality": raw_feature["dataQuality"],
            "message": "Forecast ditahan; gunakan data lapangan cukup atau --demo-synthetic-fill untuk demo berlabel.",
        }

    runtime = runtime_factory()
    if demo_planning:
        stage = raw_feature.get("features", {}).get("growth_stage")
        if stage in {"inoculation", "incubation"}:
            model_feature, provenance = runtime.synthetic_planning(raw_feature)
        else:
            model_feature, provenance = runtime.synthetic_fill(raw_feature)
    elif demo_best_case:        model_feature, provenance = runtime.synthetic_best_case(raw_feature)
    elif demo_synthetic_fill:
        model_feature, provenance = runtime.synthetic_fill(raw_feature)
    else:
        model_feature = raw_feature
        provenance = {"mode": "observed", "evidenceScope": "pilot", "fieldValidated": False}
    model_feature, category_mappings = runtime.adapt_categories(model_feature)
    provenance["categoryAdapter"] = category_mappings
    forecast = build_forecast(runtime, model_feature, provenance)
    if not dry_run:
        with client_factory(config) as client:
            client.write_daily_features(kumbung_id, raw_feature["asOfDate"], raw_feature)
            client.write_forecast(kumbung_id, forecast["idempotencyKey"], forecast)
            client.write_heartbeat("healthy", "run-once", f"Forecast {forecast['idempotencyKey']} tersimpan")
    return {
        "command": "run-once", "status": forecast["status"], "dryRun": dry_run,
        "writePerformed": not dry_run, "kumbungId": kumbung_id, "sensorId": sensor_id,
        "asOfDate": raw_feature["asOfDate"], "forecast": forecast,
    }



def command_watch(
    config: WorkerConfig, interval_seconds: int = 3, once: bool = False,
    client_factory: Callable = create_client, runtime_factory: Callable = HarvestModelRuntime,
) -> dict[str, object]:
    processed = 0
    failed = 0
    with client_factory(config) as request_client:
        request_client.write_heartbeat("healthy", "watch", "Menunggu permintaan forecast dari web")
        while True:
            requests = request_client.read_forecast_requests()
            pending = [
                (kumbung_id, request)
                for kumbung_id, request in requests.items()
                if request.get("status") == "pending"
            ]
            pending.sort(key=lambda item: int(item[1].get("requestedAt") or 0))
            for kumbung_id, request in pending:
                requested_at = int(request.get("requestedAt") or 0)
                request_client.update_forecast_request(kumbung_id, {
                    "status": "processing",
                    "startedAt": int(time.time() * 1000),
                })
                try:
                    result = command_run_once(
                        config, False, kumbung_id, config.default_sensor_id,
                        str(request.get("asOfDate") or datetime.now(ZoneInfo(config.timezone)).date()),
                        demo_planning=True, batch_id=request.get("batchId"), client_factory=client_factory,
                        runtime_factory=runtime_factory,
                    )
                    completed_at = int(time.time() * 1000)
                    forecast = result.get("forecast") or {}
                    request_client.update_forecast_request(kumbung_id, {
                        "status": "completed" if result.get("writePerformed") else "insufficient_data",
                        "completedAt": completed_at,
                        "processedRequestedAt": requested_at,
                        "forecastId": forecast.get("idempotencyKey"),
                        "batchId": request.get("batchId"),
                        "message": "Perkiraan terbaru siap dilihat" if result.get("writePerformed") else result.get("message"),
                    })
                    processed += 1
                except Exception as exc:
                    request_client.update_forecast_request(kumbung_id, {
                        "status": "failed",
                        "completedAt": int(time.time() * 1000),
                        "processedRequestedAt": requested_at,
                        "message": f"Perhitungan gagal: {exc}",
                    })
                    failed += 1
                    logging.getLogger("tandurai.worker").exception(
                        "forecast request failed", extra={"event": "forecast_request_failed", "kumbung_id": kumbung_id}
                    )
            if once:
                return {
                    "command": "watch", "status": "ok" if failed == 0 else "completed_with_errors",
                    "processed": processed, "failed": failed, "once": True,
                }
            time.sleep(interval_seconds)

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tandurai-worker", description="TANDURAI local AI worker")
    parser.add_argument("--env-file", type=Path, help="Path .env lokal")
    parser.add_argument("--verbose", action="store_true")
    subparsers = parser.add_subparsers(dest="command", required=True)

    health = subparsers.add_parser("health", help="Periksa konfigurasi lokal atau koneksi Firebase")
    health.add_argument("--live", action="store_true", help="Baca sensor dan tulis heartbeat")

    read = subparsers.add_parser("read-sensors", help="Baca latest telemetry")
    read.add_argument("--kumbung-id")
    read.add_argument("--sensor-id")

    features = subparsers.add_parser("build-features", help="Bangun dan audit fitur harian")
    features.add_argument("--date", help="Tanggal bisnis YYYY-MM-DD; default kemarin Asia/Jakarta")
    features.add_argument("--kumbung-id")
    features.add_argument("--dry-run", action="store_true", help="Hitung tanpa menulis RTDB")
    features.add_argument("--batch-id", help="Hitung hanya batch aktif yang dipilih")

    run = subparsers.add_parser("run-once", help="Jalankan satu siklus worker")
    run.add_argument("--dry-run", action="store_true", help="Inferensi tanpa menulis RTDB")
    run.add_argument("--date", help="Tanggal bisnis YYYY-MM-DD; default kemarin Asia/Jakarta")
    run.add_argument("--demo-synthetic-fill", action="store_true", help="Isi fitur kosong dari referensi sintetis berlabel")
    run.add_argument("--demo-best-case", action="store_true", help="Gunakan skenario sintetis terbaik berlabel")
    run.add_argument("--kumbung-id")
    run.add_argument("--sensor-id")
    run.add_argument("--batch-id", help="Hitung hanya batch aktif yang dipilih")

    watch = subparsers.add_parser("watch", help="Tunggu dan proses permintaan forecast otomatis dari web")
    watch.add_argument("--interval", type=int, default=3, help="Jeda pemeriksaan antrean dalam detik")
    watch.add_argument("--once", action="store_true", help="Periksa antrean sekali lalu keluar")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    started = time.monotonic()
    try:
        config = WorkerConfig.load(args.env_file)
        config.prepare_runtime()
        logger = configure_logging(config.log_dir, args.verbose)
        logger.info("command started", extra={"event": "command_start", "command": args.command})

        if args.command == "health":
            result = command_health(config, args.live)
            exit_code = EXIT_OK if not result["errors"] else EXIT_CONFIG
        elif args.command == "read-sensors":
            result = command_read_sensors(
                config, args.kumbung_id or config.default_kumbung_id, args.sensor_id or config.default_sensor_id
            )
            exit_code = EXIT_OK
        elif args.command == "build-features":
            result = command_build_features(
                config, args.dry_run, args.kumbung_id or config.default_kumbung_id, args.date,
                batch_id=args.batch_id,
            )
            exit_code = EXIT_OK
        elif args.command == "run-once":
            result = command_run_once(
                config, args.dry_run, args.kumbung_id or config.default_kumbung_id,
                args.sensor_id or config.default_sensor_id, args.date,
                demo_synthetic_fill=args.demo_synthetic_fill,
                demo_best_case=args.demo_best_case,
                batch_id=args.batch_id,
            )
            exit_code = EXIT_OK
        elif args.command == "watch":
            if args.interval < 1:
                raise ConfigError("--interval minimal 1 detik")
            result = command_watch(config, args.interval, args.once)
            exit_code = EXIT_OK
        else:
            raise ConfigError(f"Command tidak dikenal: {args.command}")

        duration_ms = round((time.monotonic() - started) * 1000)
        logger.info("command finished", extra={"event": "command_finish", "command": args.command, "duration_ms": duration_ms})
        result["durationMs"] = duration_ms
        _print(result)
        return exit_code
    except ConfigError as exc:
        _print({"status": "configuration_error", "error": str(exc)})
        return EXIT_CONFIG
    except FirebaseWorkerError as exc:
        logging.getLogger("tandurai.worker").exception("firebase command failed")
        _print({"status": "firebase_error", "error": str(exc)})
        return EXIT_FIREBASE
    except Exception as exc:
        logging.getLogger("tandurai.worker").exception("unexpected command failure")
        _print({"status": "command_error", "error": str(exc)})
        return EXIT_COMMAND


if __name__ == "__main__":
    sys.exit(main())
