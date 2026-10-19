"""Small serving helper used by the TANDURAI dashboard/API layer."""

from __future__ import annotations

from datetime import datetime, timezone

import numpy as np


def forecast_payload(kumbung_id: str, point_kg: float, quantiles: dict[float, float]) -> dict:
    p10 = max(0.0, float(quantiles[0.10]))
    p50 = max(p10, float(quantiles[0.50]))
    p90 = max(p50, float(quantiles[0.90]))
    width_ratio = (p90 - p10) / max(p50, 1.0)
    confidence = "high" if width_ratio <= 0.35 else "medium" if width_ratio <= 0.70 else "low"
    return {
        "kumbung_id": kumbung_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "horizon_days": 7,
        "forecast_kg": round(max(0.0, float(point_kg)), 2),
        "p10_kg": round(p10, 2),
        "p50_kg": round(p50, 2),
        "p90_kg": round(p90, 2),
        "confidence": confidence,
        "supply_commitment_kg": round(float(np.floor(p10)), 0),
    }

