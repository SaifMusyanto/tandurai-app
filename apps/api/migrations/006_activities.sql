-- Catatan kegiatan kumbung (perawatan harian, masalah, perubahan batch) untuk halaman
-- Operasional & rekap. Append-only: pembatalan mengisi voided_* (riwayat tetap ada).
CREATE TABLE kumbung_activities (
  id           text PRIMARY KEY,
  farm_id      text NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  kumbung_id   text NOT NULL REFERENCES kumbungs (id) ON DELETE CASCADE,
  batch_id     text REFERENCES batches (id) ON DELETE SET NULL,
  type         text NOT NULL CHECK (type IN ('care', 'problem', 'note', 'batch_start', 'phase_change', 'batch_end')),
  occurred_at  timestamptz NOT NULL,
  items        jsonb NOT NULL DEFAULT '[]'::jsonb,
  quantity     integer CHECK (quantity IS NULL OR quantity BETWEEN 0 AND 1000000),
  notes        text NOT NULL DEFAULT '',
  recorded_by  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz,
  voided_by    text,
  void_reason  text
);
CREATE INDEX kumbung_activities_farm_idx ON kumbung_activities (farm_id, occurred_at DESC);
CREATE INDEX kumbung_activities_kumbung_idx ON kumbung_activities (kumbung_id, occurred_at DESC);
CREATE INDEX harvest_events_farm_idx ON harvest_events (farm_id, harvested_at DESC);

-- Data batch tambahan untuk petani (semua opsional).
ALTER TABLE batches
  ADD COLUMN mushroom_type text NOT NULL DEFAULT 'tiram',
  ADD COLUMN spawn_source  text NOT NULL DEFAULT '',
  ADD COLUMN notes         text NOT NULL DEFAULT '',
  ADD COLUMN ended_at      timestamptz;
UPDATE batches SET ended_at = updated_at WHERE status <> 'active';
