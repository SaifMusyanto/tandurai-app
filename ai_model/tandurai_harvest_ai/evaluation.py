"""Point, probabilistic, and subgroup evaluation utilities."""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_pinball_loss, mean_squared_error, r2_score


def point_metrics(y_true, y_pred) -> dict[str, float]:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.maximum(0.0, np.asarray(y_pred, dtype=float))
    abs_error = np.abs(y_true - y_pred)
    denom = max(float(np.abs(y_true).sum()), 1e-9)
    wape = float(abs_error.sum() / denom)
    mean_actual = max(float(np.mean(y_true)), 1e-9)
    tolerance = np.maximum(0.20 * y_true, 2.0)
    return {
        "mae_kg": float(mean_absolute_error(y_true, y_pred)),
        "rmse_kg": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "wape_pct": 100.0 * wape,
        "forecast_accuracy_pct": 100.0 * max(0.0, 1.0 - wape),
        "mae_vs_mean_pct": 100.0 * float(mean_absolute_error(y_true, y_pred)) / mean_actual,
        "r2": float(r2_score(y_true, y_pred)),
        "within_20pct_or_2kg_pct": 100.0 * float(np.mean(abs_error <= tolerance)),
        "mean_actual_kg": float(np.mean(y_true)),
        "mean_prediction_kg": float(np.mean(y_pred)),
        "n_test": int(len(y_true)),
    }


def interval_metrics(y_true, p10, p50, p90) -> dict[str, float]:
    y_true = np.asarray(y_true, dtype=float)
    p10 = np.asarray(p10, dtype=float)
    p50 = np.asarray(p50, dtype=float)
    p90 = np.asarray(p90, dtype=float)
    inside = (y_true >= p10) & (y_true <= p90)
    return {
        "p10_pinball": float(mean_pinball_loss(y_true, p10, alpha=0.10)),
        "p50_pinball": float(mean_pinball_loss(y_true, p50, alpha=0.50)),
        "p90_pinball": float(mean_pinball_loss(y_true, p90, alpha=0.90)),
        "p10_p90_coverage_pct": 100.0 * float(np.mean(inside)),
        "mean_interval_width_kg": float(np.mean(p90 - p10)),
        "below_p10_pct": 100.0 * float(np.mean(y_true < p10)),
        "above_p90_pct": 100.0 * float(np.mean(y_true > p90)),
    }


def subgroup_wape(frame: pd.DataFrame, actual: str, prediction: str, group: str) -> pd.DataFrame:
    rows = []
    for name, part in frame.groupby(group):
        actual_volume = float(part[actual].abs().sum())
        denom = max(actual_volume, 1e-9)
        wape = float((part[actual] - part[prediction]).abs().sum() / denom)
        gate_applicable = actual_volume >= 50.0
        rows.append(
            {
                group: name,
                "wape_pct": 100.0 * wape,
                "actual_volume_kg": actual_volume,
                "gate_applicable": gate_applicable,
                "gate_pass": bool(wape <= 0.30) if gate_applicable else None,
                "note": "" if gate_applicable else "Insufficient test harvest volume (<50 kg)",
                "n": len(part),
            }
        )
    return pd.DataFrame(rows).sort_values("wape_pct", ascending=False).reset_index(drop=True)
