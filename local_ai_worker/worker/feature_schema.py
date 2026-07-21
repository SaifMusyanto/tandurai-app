from __future__ import annotations

SCHEMA_VERSION = "harvest-features-v1"

# Source of truth: Modul AI Aitoma/tandurai_harvest_ai/config.py.
NUMERIC_FEATURES = (
    "baglog_count_active", "baglog_age_days", "cycle_day",
    "temperature_mean_c", "temperature_min_c", "temperature_max_c", "temperature_std_c",
    "relative_humidity_mean_pct", "relative_humidity_min_pct", "relative_humidity_max_pct",
    "relative_humidity_std_pct", "co2_mean_ppm", "co2_max_ppm", "co2_std_ppm",
    "air_pressure_mean_hpa", "airflow_mean_ms", "fan_runtime_pct", "misting_runtime_pct",
    "substrate_moisture_mean_pct", "light_mean_lux", "contamination_rate_pct",
    "harvest_lag_1d_kg", "harvest_lag_3d_sum_kg", "harvest_lag_7d_sum_kg",
    "harvest_lag_14d_sum_kg", "temperature_7d_mean_c", "relative_humidity_7d_mean_pct",
    "co2_7d_mean_ppm", "temp_stress_hours_7d", "rh_low_hours_7d", "co2_high_hours_7d",
    "day_of_week_sin", "day_of_week_cos",
)

CATEGORICAL_FEATURES = ("farm_id", "kumbung_id", "growth_stage", "substrate_type")
FEATURE_COLUMNS = NUMERIC_FEATURES + CATEGORICAL_FEATURES

