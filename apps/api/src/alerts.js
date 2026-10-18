import { accessibleFarmIds, requireFarm } from './access.js';
import { audit } from './domain.js';
import { DEFAULT_OPTIMAL, DEFAULT_THRESHOLDS, boundedNumber, checkOptimalAgainstThresholds, optimalInput, thresholdsInput } from './domainValidate.js';
import { HttpError } from './validate.js';

// Definisi & aturan sama dengan functions/alert-core.js dan apps/web/src/lib/alerts.js.
export const ALERT_DEFINITIONS = Object.freeze({
  temperature_high: { type: 'Suhu Tinggi', device: 'Sensor Suhu Kumbung', unit: '°C' },
  humidity_low: { type: 'Kelembapan Rendah', device: 'Sensor Kelembapan Kumbung', unit: '%' },
  co2_high: { type: 'CO₂ Tinggi', device: 'Sensor CO₂ Kumbung', unit: 'ppm' },
  device_offline: { type: 'Perangkat Offline', device: 'Gateway Kumbung', unit: 'detik' },
});

const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Evaluasi satu pembacaan sensor terhadap ambang farm. */
export function evaluateReadings(values, thresholds = DEFAULT_THRESHOLDS) {
  const results = [];
  const temperature = finite(values?.temperature);
  const humidity = finite(values?.humidity);
  const co2 = finite(values?.co2);
  if (temperature !== null) {
    const { warning, critical } = thresholds.temperature;
    const severity = temperature > critical ? 'critical' : temperature > warning ? 'warning' : 'normal';
    results.push({
      key: 'temperature_high', severity, value: temperature, threshold: severity === 'critical' ? critical : warning,
      message: severity === 'normal' ? `Suhu kembali aman pada ${temperature}°C.` : `Suhu ${temperature}°C melewati batas ${severity === 'critical' ? 'kritis' : 'peringatan'}.`,
    });
  }
  if (humidity !== null) {
    const { warning, critical } = thresholds.humidity;
    const severity = humidity < critical ? 'critical' : humidity < warning ? 'warning' : 'normal';
    results.push({
      key: 'humidity_low', severity, value: humidity, threshold: severity === 'critical' ? critical : warning,
      message: severity === 'normal' ? `Kelembapan kembali aman pada ${humidity}%.` : `Kelembapan ${humidity}% berada di bawah batas ${severity === 'critical' ? 'kritis' : 'peringatan'}.`,
    });
  }
  if (co2 !== null) {
    const { warning, critical } = thresholds.co2;
    const severity = co2 > critical ? 'critical' : co2 > warning ? 'warning' : 'normal';
    results.push({
      key: 'co2_high', severity, value: co2, threshold: severity === 'critical' ? critical : warning,
      message: severity === 'normal' ? `Kadar CO₂ kembali aman pada ${co2} ppm.` : `Kadar CO₂ ${co2} ppm melewati batas ${severity === 'critical' ? 'kritis' : 'peringatan'}.`,
    });
  }
  return results;
}

const ms = value => (value ? new Date(value).getTime() : null);

export const alertView = row => ({
  id: row.id, farmId: row.farm_id, kumbungId: row.kumbung_id, sensorId: row.sensor_id, gatewayId: row.gateway_id,
  sensor: row.sensor, type: row.type, device: row.device, unit: row.unit, severity: row.severity, status: row.status,
  message: row.message, value: row.value, threshold: row.threshold, startedAt: ms(row.started_at),
  updatedAt: ms(row.updated_at), resolvedAt: ms(row.resolved_at), telegramSentAt: ms(row.telegram_sent_at), source: row.source,
});

const settingsView = row => ({
  farmId: row.farm_id, thresholds: row.thresholds, optimal: row.optimal || DEFAULT_OPTIMAL, optimalIsDefault: !row.optimal,
  notify: row.notify, cooldownMinutes: row.cooldown_minutes,
  telegramEnabled: row.telegram_enabled, telegramChatId: row.telegram_chat_id,
  hasTelegramToken: Boolean(row.telegram_bot_token), updatedAt: ms(row.updated_at),
});

const defaultSettingsRow = farmId => ({
  farm_id: farmId, thresholds: DEFAULT_THRESHOLDS, optimal: null, notify: { critical: true, warning: true, offline: true },
  cooldown_minutes: 10, telegram_enabled: false, telegram_chat_id: null, telegram_bot_token: null, updated_at: null,
});

/** Pengirim Telegram bawaan (Bot API). Diganti di uji agar tidak ada request keluar. */
export function telegramNotifier({ timeoutMs = 10000 } = {}) {
  return {
    async send({ token, chatId }, text) {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`Telegram API ${response.status}`);
    },
    /** Kirim file (mis. laporan Excel) ke chat. */
    async sendDocument({ token, chatId }, { filename, buffer, caption }) {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      if (caption) { form.append('caption', caption); form.append('parse_mode', 'HTML'); }
      form.append('document', new Blob([buffer]), filename);
      const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs * 3) });
      if (!response.ok) throw new Error(`Telegram API ${response.status}`);
    },
  };
}

const escapeHtml = value => String(value ?? '').replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));

/** `names` = { farm, kumbung, sensor } (nama yang dikenal petani; fallback ke ID). */
function telegramText(alert, names = {}) {
  const emoji = alert.severity === 'critical' ? '🔴' : '🟡';
  const time = new Date(alert.updatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'medium' });
  const place = [names.farm, names.kumbung || alert.kumbungId, names.sensor || alert.sensorId].filter(Boolean).map(escapeHtml).join(' · ');
  return `${emoji} <b>[${alert.severity.toUpperCase()}] ${escapeHtml(alert.type)}</b>\n\n${escapeHtml(alert.message)}\n📍 ${place}\n🕐 ${time}`;
}

/**
 * Alert dievaluasi di backend saat telemetry masuk dan saat gateway offline/online.
 * Rekaman ditulis hanya saat status/severity berubah (atau nilai aktif diperbarui tiap ≥ 60 dtk).
 * ctx = { pool, hub, log, notifier }
 */
export function createAlertService({ pool, hub, log, notifier = telegramNotifier() }) {
  const settingsCache = new Map(); // farmId → row

  async function settingsRow(farmId) {
    if (settingsCache.has(farmId)) return settingsCache.get(farmId);
    const { rows: [row] } = await pool.query('SELECT * FROM farm_alert_settings WHERE farm_id = $1', [farmId]);
    const value = row || defaultSettingsRow(farmId);
    settingsCache.set(farmId, value);
    return value;
  }

  async function notify(alert, settings) {
    const kind = alert.sensor === 'device_offline' ? 'offline' : alert.severity;
    if (!settings.telegram_enabled || !settings.telegram_bot_token || !settings.telegram_chat_id || settings.notify?.[kind] === false) return;
    const cooldownMs = settings.cooldown_minutes * 60000;
    if (alert.telegramSentAt && alert.updatedAt - alert.telegramSentAt < cooldownMs) return;
    const { rows: [names] } = await pool.query(
      `SELECT f.name AS farm, k.name AS kumbung, COALESCE(s.name, g.name) AS sensor FROM farms f
       LEFT JOIN kumbungs k ON k.id = $2 LEFT JOIN sensors s ON s.id = $3 LEFT JOIN gateways g ON g.id = $3
       WHERE f.id = $1`,
      [alert.farmId, alert.kumbungId, alert.sensorId],
    );
    try {
      await notifier.send({ token: settings.telegram_bot_token, chatId: settings.telegram_chat_id }, telegramText(alert, names));
      await pool.query('UPDATE alerts SET telegram_sent_at = now() WHERE id = $1', [alert.id]);
    } catch (error) {
      log.warn?.(`[alert] Telegram gagal untuk ${alert.id}: ${error.message}`);
    }
  }

  /** Terapkan satu hasil evaluasi; kirim SSE + notifikasi saat alert baru aktif/berubah severity. */
  async function applyResult(context, result, now = new Date()) {
    const id = `${context.sensorId}_${result.key}`;
    const { rows: [previous] } = await pool.query('SELECT * FROM alerts WHERE id = $1', [id]);
    const active = result.severity !== 'normal';
    const wasActive = previous?.status === 'active';
    const severityChanged = previous?.severity !== result.severity;
    if (!previous && !active) return null;
    if (previous && !severityChanged && (!active || now - previous.updated_at < 60000) && wasActive === active) return null;
    const definition = ALERT_DEFINITIONS[result.key];
    const { rows: [row] } = await pool.query(
      `INSERT INTO alerts (id, farm_id, kumbung_id, sensor_id, gateway_id, sensor, type, device, unit, severity, status,
         message, value, threshold, started_at, updated_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO UPDATE SET farm_id = EXCLUDED.farm_id, kumbung_id = EXCLUDED.kumbung_id,
         gateway_id = EXCLUDED.gateway_id, severity = EXCLUDED.severity, status = EXCLUDED.status,
         message = EXCLUDED.message, value = EXCLUDED.value, threshold = EXCLUDED.threshold,
         started_at = EXCLUDED.started_at, updated_at = EXCLUDED.updated_at, resolved_at = EXCLUDED.resolved_at
       RETURNING *`,
      [id, context.farmId, context.kumbungId || null, context.sensorId, context.gatewayId || null, result.key,
        definition.type, definition.device, definition.unit, result.severity, active ? 'active' : 'resolved',
        result.message, result.value, result.threshold,
        active && (!wasActive || severityChanged) ? now : (previous?.started_at || null),
        now,
        !active && wasActive ? now : (previous?.resolved_at || null)],
    );
    const view = alertView(row);
    if (active && (!wasActive || severityChanged)) {
      await pool.query(
        `INSERT INTO alert_events (alert_id, farm_id, kumbung_id, sensor_id, sensor, severity, value, threshold, message, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, context.farmId, context.kumbungId || null, context.sensorId, result.key, result.severity, result.value ?? null, result.threshold ?? null, result.message, now],
      );
    }
    hub.emitFarm(context.farmId, 'alert', view);
    if (active && (!wasActive || severityChanged)) await notify(view, await settingsRow(context.farmId));
    return view;
  }

  async function onTelemetry(context, values) {
    const settings = await settingsRow(context.farmId);
    for (const result of evaluateReadings(values, settings.thresholds)) await applyResult(context, result);
  }

  async function onGatewayOffline(gatewayId, farmId, lastSeenAt) {
    if (!farmId) return;
    const seconds = lastSeenAt ? Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 1000) : null;
    await applyResult({ farmId, sensorId: gatewayId, gatewayId }, {
      key: 'device_offline', severity: 'warning', value: seconds, threshold: null,
      message: `Gateway ${gatewayId} offline${seconds !== null ? ` (data terakhir ${seconds} detik lalu)` : ''}.`,
    });
  }

  async function onGatewayOnline(gatewayId, farmId) {
    if (!farmId) return;
    await applyResult({ farmId, sensorId: gatewayId, gatewayId }, {
      key: 'device_offline', severity: 'normal', value: 0, threshold: null, message: `Gateway ${gatewayId} kembali online.`,
    });
  }

  async function listAlerts(user, { farmId, status, limit } = {}) {
    let farmIds = await accessibleFarmIds(pool, user);
    if (farmId) {
      await requireFarm(pool, user, farmId);
      farmIds = [farmId];
    }
    const { rows } = await pool.query(
      `SELECT * FROM alerts WHERE farm_id = ANY($1) AND ($2::text IS NULL OR status = $2)
       ORDER BY (status = 'active') DESC, updated_at DESC LIMIT $3`,
      [farmIds, ['active', 'resolved'].includes(status) ? status : null, Math.min(Math.max(Number(limit) || 200, 1), 1000)],
    );
    return rows.map(alertView);
  }

  async function getSettings(user, farmId) {
    await requireFarm(pool, user, farmId);
    return settingsView(await settingsRow(farmId));
  }

  async function putSettings(user, farmId, input) {
    await requireFarm(pool, user, farmId, { owner: true });
    const current = await settingsRow(farmId);
    const thresholds = thresholdsInput(input?.thresholds || {}, current.thresholds);
    // optimal: undefined = tetap, null = kembali ke rekomendasi bawaan, objek = ubah.
    const optimal = input?.optimal === undefined ? current.optimal || null
      : input.optimal === null ? null : optimalInput(input.optimal, current.optimal || DEFAULT_OPTIMAL);
    if (input?.thresholds !== undefined || input?.optimal !== undefined) checkOptimalAgainstThresholds(optimal || DEFAULT_OPTIMAL, thresholds);
    const notify = { ...current.notify };
    for (const key of ['critical', 'warning', 'offline']) if (typeof input?.notify?.[key] === 'boolean') notify[key] = input.notify[key];
    const cooldown = input?.cooldownMinutes === undefined ? current.cooldown_minutes : Math.round(boundedNumber(input.cooldownMinutes, 'Cooldown', 1, 1440));
    const enabled = typeof input?.telegramEnabled === 'boolean' ? input.telegramEnabled : current.telegram_enabled;
    const chatId = input?.telegramChatId === undefined ? current.telegram_chat_id : (String(input.telegramChatId || '').trim().slice(0, 64) || null);
    // Token write-only: undefined = tetap, '' = hapus, string = ganti.
    const token = input?.telegramBotToken === undefined ? current.telegram_bot_token : (String(input.telegramBotToken || '').trim() || null);
    if (token && !/^\d{5,16}:[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(400, 'invalid_input', 'Format token bot Telegram tidak valid.');
    if (chatId && !/^-?\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/.test(chatId)) throw new HttpError(400, 'invalid_input', 'Chat ID Telegram tidak valid.');
    if (enabled && (!token || !chatId)) throw new HttpError(400, 'invalid_input', 'Notifikasi Telegram membutuhkan token bot dan chat ID.');
    const { rows: [row] } = await pool.query(
      `INSERT INTO farm_alert_settings (farm_id, thresholds, notify, cooldown_minutes, telegram_enabled, telegram_chat_id, telegram_bot_token, updated_by, updated_at, optimal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
       ON CONFLICT (farm_id) DO UPDATE SET thresholds = EXCLUDED.thresholds, optimal = EXCLUDED.optimal, notify = EXCLUDED.notify,
         cooldown_minutes = EXCLUDED.cooldown_minutes, telegram_enabled = EXCLUDED.telegram_enabled,
         telegram_chat_id = EXCLUDED.telegram_chat_id, telegram_bot_token = EXCLUDED.telegram_bot_token,
         updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [farmId, thresholds, notify, cooldown, enabled, chatId, token, user.uid, optimal],
    );
    await audit(pool, farmId, user.uid, 'alert_settings_update', { telegramEnabled: enabled });
    settingsCache.set(farmId, row);
    return settingsView(row);
  }

  /** Kirim pesan uji ke Telegram farm (owner). */
  async function testTelegram(user, farmId) {
    await requireFarm(pool, user, farmId, { owner: true });
    const settings = await settingsRow(farmId);
    if (!settings.telegram_bot_token || !settings.telegram_chat_id) throw new HttpError(400, 'invalid_input', 'Simpan token bot dan chat ID terlebih dahulu.');
    try {
      await notifier.send({ token: settings.telegram_bot_token, chatId: settings.telegram_chat_id }, '✅ <b>Tandurai</b>\n\nNotifikasi Telegram farm ini terhubung.');
    } catch (error) {
      throw new HttpError(502, 'telegram_failed', `Telegram gagal: ${error.message}`);
    }
    return { ok: true };
  }

  return { onTelemetry, onGatewayOffline, onGatewayOnline, listAlerts, getSettings, putSettings, testTelegram };
}
