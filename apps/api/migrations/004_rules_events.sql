-- Kontrol aktuator v3: mode otomatis berupa daftar aturan (kondisi nyala + kondisi mati berupa durasi
-- atau nilai normal), dijalankan gateway dari NVS. Log perubahan nyala/mati & pengaturan aktuator.

ALTER TABLE actuators ADD COLUMN rules jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Auto v2 {direction, lower, upper} → satu aturan dengan kondisi mati "kembali ke nilai normal".
UPDATE actuators SET rules = jsonb_build_array(jsonb_build_object(
  'id', 'r1', 'enabled', mode = 'auto',
  'sensorId', auto->'sensorId', 'sensorLocalId', auto->'sensorLocalId', 'metric', auto->'metric',
  'operator', CASE WHEN auto->>'direction' = 'lower' THEN 'above' ELSE 'below' END,
  'threshold', CASE WHEN auto->>'direction' = 'lower' THEN auto->'upper' ELSE auto->'lower' END,
  'stop', jsonb_build_object('type', 'value', 'value', CASE WHEN auto->>'direction' = 'lower' THEN auto->'lower' ELSE auto->'upper' END),
  'cooldownSec', COALESCE(auto->'cooldownSec', '60'::jsonb)))
WHERE auto IS NOT NULL AND auto ? 'direction';

UPDATE actuators SET mode = 'manual'
WHERE mode = 'auto' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rules) rule WHERE (rule->>'enabled')::boolean);

ALTER TABLE actuators DROP COLUMN auto;

-- Pemicu nyala terakhir yang dilaporkan gateway: {"rule": "<id>"} atau {"schedule": "<id>"}.
ALTER TABLE actuators ADD COLUMN state_trigger jsonb;

CREATE TABLE actuator_events (
  id          bigserial PRIMARY KEY,
  actuator_id text NOT NULL REFERENCES actuators (id) ON DELETE CASCADE,
  gateway_id  text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('state', 'config')),
  state       text,
  source      text,
  trigger     jsonb,
  actor_uid   text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX actuator_events_actuator_idx ON actuator_events (actuator_id, created_at DESC);
