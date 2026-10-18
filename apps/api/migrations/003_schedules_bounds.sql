-- Kontrol aktuator v2: banyak jadwal per aktuator (jam tertentu / berulang, per hari) dan mode
-- otomatis dengan batas bawah/atas (menyala sampai batas tercapai). Data lama dikonversi.

ALTER TABLE actuators ADD COLUMN schedules jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE actuators SET schedules = jsonb_build_array(jsonb_build_object(
  'id', 's1', 'type', 'every', 'enabled', true,
  'intervalSec', (timer->>'intervalSec')::int, 'onSec', (timer->>'onSec')::int,
  'window', timer->'window', 'days', '[1,2,3,4,5,6,7]'::jsonb))
WHERE timer IS NOT NULL AND timer ? 'intervalSec';

-- Auto lama {operator, threshold, hysteresis} → {direction, lower, upper}.
UPDATE actuators SET auto = jsonb_build_object(
  'sensorId', auto->'sensorId', 'sensorLocalId', auto->'sensorLocalId', 'metric', auto->'metric',
  'direction', CASE WHEN auto->>'operator' = 'above' THEN 'lower' ELSE 'raise' END,
  'lower', CASE WHEN auto->>'operator' = 'above'
    THEN (auto->>'threshold')::float8 - COALESCE(NULLIF((auto->>'hysteresis')::float8, 0), 1)
    ELSE (auto->>'threshold')::float8 END,
  'upper', CASE WHEN auto->>'operator' = 'above'
    THEN (auto->>'threshold')::float8
    ELSE (auto->>'threshold')::float8 + COALESCE(NULLIF((auto->>'hysteresis')::float8, 0), 1) END,
  'cooldownSec', COALESCE((auto->>'cooldownSec')::int, 60))
WHERE auto IS NOT NULL AND auto ? 'operator';

ALTER TABLE actuators DROP COLUMN timer;
