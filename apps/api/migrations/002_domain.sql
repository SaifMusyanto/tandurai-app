-- Domain aplikasi (pengganti Firebase RTDB): user, farm, anggota, kumbung, batch, panen,
-- audit, alert, forecast. Gateway berpindah dari milik user ke milik farm.

CREATE TABLE users (
  uid            text PRIMARY KEY CHECK (length(uid) BETWEEN 1 AND 128),
  email          text,
  email_verified boolean NOT NULL DEFAULT false,
  username       text CHECK (username IS NULL OR length(username) BETWEEN 1 AND 100),
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_email_idx ON users (lower(email));

CREATE TABLE farms (
  id         text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  timezone   text NOT NULL DEFAULT 'Asia/Jakarta',
  location   text NOT NULL DEFAULT 'Indonesia' CHECK (length(location) BETWEEN 1 AND 150),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by text REFERENCES users (uid) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE farm_members (
  farm_id    text NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  uid        text NOT NULL REFERENCES users (uid) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'operator')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  invited_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, uid)
);
CREATE INDEX farm_members_uid_idx ON farm_members (uid);

CREATE TABLE kumbungs (
  id              text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,96}$'),
  farm_id         text NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  capacity_baglog integer NOT NULL CHECK (capacity_baglog BETWEEN 1 AND 1000000),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'inactive')),
  harvest_profile jsonb,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kumbungs_farm_idx ON kumbungs (farm_id);

CREATE TABLE batches (
  id                   text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,120}$'),
  farm_id              text NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  kumbung_id           text NOT NULL REFERENCES kumbungs (id) ON DELETE CASCADE,
  started_at           timestamptz NOT NULL,
  baglog_count_initial integer NOT NULL CHECK (baglog_count_initial BETWEEN 1 AND 1000000),
  baglog_count_active  integer NOT NULL CHECK (baglog_count_active >= 0 AND baglog_count_active <= baglog_count_initial),
  substrate_type       text NOT NULL,
  growth_stage         text NOT NULL CHECK (growth_stage IN ('inoculation', 'incubation', 'fruiting', 'harvesting', 'completed')),
  contamination_pct    double precision NOT NULL CHECK (contamination_pct BETWEEN 0 AND 100),
  status               text NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
  created_by           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX batches_kumbung_idx ON batches (kumbung_id, started_at DESC);

-- Append-only: koreksi = baris baru dengan corrects_event_id (riwayat asli tetap ada).
CREATE TABLE harvest_events (
  id                text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,120}$'),
  farm_id           text NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  kumbung_id        text NOT NULL REFERENCES kumbungs (id) ON DELETE CASCADE,
  batch_id          text NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  harvested_at      timestamptz NOT NULL,
  weight_kg         double precision NOT NULL CHECK (weight_kg > 0 AND weight_kg <= 10000),
  grade             text NOT NULL CHECK (grade IN ('A', 'B', 'C', 'mixed')),
  grade_a_pct       double precision NOT NULL CHECK (grade_a_pct BETWEEN 0 AND 100),
  notes             text NOT NULL DEFAULT '',
  recorded_by       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  corrects_event_id text REFERENCES harvest_events (id) ON DELETE CASCADE,
  correction_reason text,
  CHECK ((corrects_event_id IS NULL) = (correction_reason IS NULL))
);
CREATE INDEX harvest_events_kumbung_idx ON harvest_events (kumbung_id, harvested_at DESC);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  farm_id    text NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  actor_uid  text NOT NULL,
  action     text NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_farm_idx ON audit_log (farm_id, created_at DESC);

-- Ambang alert & notifikasi per farm. Token bot Telegram tidak pernah dikirim ke client.
CREATE TABLE farm_alert_settings (
  farm_id            text PRIMARY KEY REFERENCES farms (id) ON DELETE CASCADE,
  thresholds         jsonb NOT NULL,
  notify             jsonb NOT NULL DEFAULT '{"critical": true, "warning": true, "offline": true}'::jsonb,
  cooldown_minutes   integer NOT NULL DEFAULT 10 CHECK (cooldown_minutes BETWEEN 1 AND 1440),
  telegram_enabled   boolean NOT NULL DEFAULT false,
  telegram_chat_id   text,
  telegram_bot_token text,
  updated_by         text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id               text PRIMARY KEY,               -- "{sensorId}_{jenis}" / "{gatewayId}_device_offline"
  farm_id          text NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  kumbung_id       text,
  sensor_id        text NOT NULL,
  gateway_id       text,
  sensor           text NOT NULL CHECK (sensor IN ('temperature_high', 'humidity_low', 'co2_high', 'device_offline')),
  type             text NOT NULL,
  device           text NOT NULL,
  unit             text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('critical', 'warning', 'normal')),
  status           text NOT NULL CHECK (status IN ('active', 'resolved')),
  message          text NOT NULL,
  value            double precision,
  threshold        double precision,
  started_at       timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  telegram_sent_at timestamptz,
  source           text NOT NULL DEFAULT 'backend'
);
CREATE INDEX alerts_farm_idx ON alerts (farm_id, status, updated_at DESC);

-- Forecast AI: satu permintaan aktif per kumbung (sama dengan aiRequests/{kumbungId}).
CREATE TABLE ai_requests (
  kumbung_id text PRIMARY KEY REFERENCES kumbungs (id) ON DELETE CASCADE,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_forecasts (
  kumbung_id   text NOT NULL REFERENCES kumbungs (id) ON DELETE CASCADE,
  id           text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  generated_at timestamptz,
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kumbung_id, id)
);
CREATE INDEX ai_forecasts_generated_idx ON ai_forecasts (kumbung_id, generated_at DESC);

CREATE TABLE ai_forecast_latest (
  kumbung_id  text PRIMARY KEY REFERENCES kumbungs (id) ON DELETE CASCADE,
  forecast_id text NOT NULL,
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_features_daily (
  kumbung_id text NOT NULL REFERENCES kumbungs (id) ON DELETE CASCADE,
  date_key   text NOT NULL CHECK (date_key ~ '^\d{4}-\d{2}-\d{2}$'),
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kumbung_id, date_key)
);

CREATE TABLE worker_status (
  name       text PRIMARY KEY,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Gateway: milik farm. Data uji lama (owner_uid tanpa farm terdaftar) dipindahkan ke farm
-- placeholder agar tidak hilang; pengklaim menjadi owner farm tersebut.
ALTER TABLE gateways RENAME COLUMN owner_uid TO claimed_by;
DROP INDEX IF EXISTS gateways_owner_idx;

INSERT INTO users (uid) SELECT DISTINCT claimed_by FROM gateways WHERE claimed_by IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE gateways SET farm_id = 'FARM-' || substr(md5(claimed_by), 1, 8)
WHERE claimed_by IS NOT NULL AND (farm_id IS NULL OR farm_id !~ '^[A-Za-z0-9_-]{1,64}$');
UPDATE gateways SET farm_id = NULL WHERE claimed_by IS NULL;

INSERT INTO farms (id, name, created_by)
SELECT DISTINCT ON (farm_id) farm_id, farm_id, claimed_by FROM gateways
WHERE farm_id IS NOT NULL ORDER BY farm_id, claimed_at
ON CONFLICT DO NOTHING;

INSERT INTO farm_members (farm_id, uid, role)
SELECT DISTINCT farm_id, claimed_by, 'owner' FROM gateways WHERE farm_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE gateways
  ADD CONSTRAINT gateways_farm_fk FOREIGN KEY (farm_id) REFERENCES farms (id) ON DELETE RESTRICT,
  ADD CONSTRAINT gateways_claim_farm_chk CHECK ((claimed_by IS NULL) = (farm_id IS NULL));
CREATE INDEX gateways_farm_idx ON gateways (farm_id);

-- Kumbung yang dirujuk sensor/aktuator lama dibuat di farm gateway-nya.
INSERT INTO kumbungs (id, farm_id, name, capacity_baglog)
SELECT DISTINCT ON (ref.kumbung_id) ref.kumbung_id, g.farm_id, ref.kumbung_id, 1
FROM (SELECT gateway_id, kumbung_id FROM sensors UNION ALL SELECT gateway_id, kumbung_id FROM actuators) ref
JOIN gateways g ON g.id = ref.gateway_id
WHERE ref.kumbung_id ~ '^[A-Za-z0-9_-]{1,96}$' AND g.farm_id IS NOT NULL
ORDER BY ref.kumbung_id
ON CONFLICT DO NOTHING;

UPDATE sensors s SET kumbung_id = NULL FROM gateways g
WHERE g.id = s.gateway_id AND s.kumbung_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM kumbungs k WHERE k.id = s.kumbung_id AND k.farm_id = g.farm_id);
UPDATE actuators a SET kumbung_id = NULL FROM gateways g
WHERE g.id = a.gateway_id AND a.kumbung_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM kumbungs k WHERE k.id = a.kumbung_id AND k.farm_id = g.farm_id);

ALTER TABLE sensors ADD CONSTRAINT sensors_kumbung_fk FOREIGN KEY (kumbung_id) REFERENCES kumbungs (id) ON DELETE SET NULL;
ALTER TABLE actuators ADD CONSTRAINT actuators_kumbung_fk FOREIGN KEY (kumbung_id) REFERENCES kumbungs (id) ON DELETE SET NULL;
CREATE INDEX sensors_kumbung_idx ON sensors (kumbung_id);
