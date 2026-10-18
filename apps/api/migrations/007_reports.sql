-- Jadwal laporan farm (parameter kumbung + panen + kegiatan + alert), dikirim ke Telegram farm
-- oleh sweeper backend. Waktu kirim dalam WIB (UTC+7).
CREATE TABLE report_schedules (
  id            uuid PRIMARY KEY,
  farm_id       text NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  frequency     text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  send_hour     integer NOT NULL CHECK (send_hour BETWEEN 0 AND 23),
  weekday       integer CHECK (weekday BETWEEN 1 AND 7),        -- 1 = Senin (mingguan)
  month_day     integer CHECK (month_day BETWEEN 1 AND 28),     -- tanggal (bulanan)
  kumbung_ids   text[] NOT NULL DEFAULT '{}',                    -- kosong = semua kumbung
  sections      text[] NOT NULL,
  attach_excel  boolean NOT NULL DEFAULT true,
  enabled       boolean NOT NULL DEFAULT true,
  next_run_at   timestamptz,
  last_run_at   timestamptz,
  last_status   text,
  last_error    text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_schedules_due_idx ON report_schedules (next_run_at) WHERE enabled;

-- Riwayat kejadian alert (tabel alerts hanya menyimpan status terakhir per sensor; severity
-- ditimpa "normal" saat pulih). Satu baris setiap alert aktif atau naik/turun tingkat.
CREATE TABLE alert_events (
  id          bigserial PRIMARY KEY,
  alert_id    text NOT NULL,
  farm_id     text NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  kumbung_id  text,
  sensor_id   text NOT NULL,
  sensor      text NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('critical', 'warning')),
  value       double precision,
  threshold   double precision,
  message     text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_events_farm_idx ON alert_events (farm_id, occurred_at DESC);
