-- Diagnostik gateway (dari pesan status firmware ≥ 0.4.0) dan status update firmware OTA.
ALTER TABLE gateways
  ADD COLUMN diagnostics   jsonb,                         -- { uptimeSec, resetReason, wifiDrops, mqttDrops, wifiReason, freeHeap, minFreeHeap }
  ADD COLUMN booted_at     timestamptz,                   -- perkiraan waktu boot terakhir (now - uptimeSec)
  ADD COLUMN restart_count integer NOT NULL DEFAULT 0,    -- restart terdeteksi sejak kolom ini ada
  ADD COLUMN ota           jsonb;                         -- OTA terakhir: { id, version, fromVersion, url, status, reason, sentAt, updatedAt }
