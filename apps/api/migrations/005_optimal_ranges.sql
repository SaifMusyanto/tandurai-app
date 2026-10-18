-- Rentang optimal parameter kumbung per farm (null = rekomendasi bawaan DEFAULT_OPTIMAL).
-- Dipakai dashboard untuk status KPI, garis optimal grafik, dan Farm Health Score.
ALTER TABLE farm_alert_settings ADD COLUMN optimal jsonb;
