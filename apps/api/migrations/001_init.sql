-- Skema minimal backend IoT Tandurai (MQTT ⇄ PostgreSQL ⇄ REST/SSE).

-- Registry pabrik: hanya hash rahasia perangkat dan kode klaim (scrypt), tidak pernah plaintext.
CREATE TABLE devices (
  hw_uid      text PRIMARY KEY CHECK (hw_uid ~ '^[A-Za-z0-9_-]{4,64}$'),
  secret_hash text NOT NULL,
  claim_hash  text NOT NULL,
  model       text NOT NULL DEFAULT 'unknown',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Gateway = perangkat yang pernah registrasi lewat MQTT; owner terisi setelah diklaim.
CREATE TABLE gateways (
  id                     text PRIMARY KEY REFERENCES devices (hw_uid),
  owner_uid              text,
  farm_id                text,
  name                   text,
  model                  text,
  firmware               text,
  capabilities           jsonb NOT NULL DEFAULT '{}'::jsonb,
  registered_at          timestamptz,
  claimed_at             timestamptz,
  online                 boolean NOT NULL DEFAULT false,
  last_seen_at           timestamptz,
  config_version         integer NOT NULL DEFAULT 0,
  applied_config_version integer NOT NULL DEFAULT 0,
  config                 jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX gateways_owner_idx ON gateways (owner_uid);

CREATE TABLE sensors (
  id          text PRIMARY KEY,                       -- "{hwUid}-{localId}"
  gateway_id  text NOT NULL REFERENCES gateways (id) ON DELETE CASCADE,
  local_id    text NOT NULL,
  type        text NOT NULL,
  metrics     text[] NOT NULL DEFAULT '{}',
  name        text NOT NULL,
  kumbung_id  text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error')),
  error       text,
  last_values jsonb,
  last_ts     timestamptz,
  UNIQUE (gateway_id, local_id)
);

CREATE TABLE actuators (
  id               text PRIMARY KEY,                  -- "{hwUid}-{localId}"
  gateway_id       text NOT NULL REFERENCES gateways (id) ON DELETE CASCADE,
  local_id         text NOT NULL,
  type             text NOT NULL,
  name             text NOT NULL,
  kumbung_id       text,
  max_run_sec      integer NOT NULL CHECK (max_run_sec > 0),
  min_interval_sec integer NOT NULL DEFAULT 0 CHECK (min_interval_sec >= 0),
  mode             text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'timer', 'auto')),
  timer            jsonb,
  auto             jsonb,
  config_version   integer NOT NULL DEFAULT 0,      -- versi config gateway saat aktuator ini terakhir diubah
  applied_version  integer NOT NULL DEFAULT 0,      -- versi yang sudah di-ACK gateway untuk aktuator ini
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error')),
  error            text,
  state            text NOT NULL DEFAULT 'unknown' CHECK (state IN ('on', 'off', 'fault', 'unknown')),
  state_source     text,
  state_since      timestamptz,
  off_at           timestamptz,
  UNIQUE (gateway_id, local_id)
);

-- Histori sampling: satu baris per sensor per bucket (default 10 menit).
CREATE TABLE telemetry_history (
  sensor_id    text NOT NULL REFERENCES sensors (id) ON DELETE CASCADE,
  bucket_start timestamptz NOT NULL,
  ts           timestamptz NOT NULL,
  "values"     jsonb NOT NULL,
  PRIMARY KEY (sensor_id, bucket_start)
);

CREATE TABLE commands (
  id           uuid PRIMARY KEY,
  gateway_id   text NOT NULL REFERENCES gateways (id) ON DELETE CASCADE,
  actuator_id  text NOT NULL REFERENCES actuators (id) ON DELETE CASCADE,
  action       text NOT NULL CHECK (action IN ('on', 'off', 'estop')),
  duration_sec integer,
  requested_by text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'rejected', 'expired')),
  reason       text,
  acked_at     timestamptz
);
CREATE INDEX commands_pending_idx ON commands (expires_at) WHERE status = 'pending';
CREATE INDEX commands_actuator_idx ON commands (actuator_id, created_at DESC);
