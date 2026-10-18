import { randomUUID } from 'node:crypto';
import { requireFarm } from './access.js';
import { summarize } from './activities.js';
import { DEFAULT_OPTIMAL, boundedNumber } from './domainValidate.js';
import { HttpError } from './validate.js';
import { buildCsv, buildXlsx } from './xlsx.js';

// Export data parameter kumbung (CSV/Excel) dan laporan farm: sekali unduh atau terjadwal ke
// Telegram farm. Semua tanggal dan jam dalam WIB (UTC+7, tanpa DST).

const WIB = 7 * 3600 * 1000;
const DAY = 86_400_000;
const METRICS = [
  { key: 'temperature', label: 'Suhu', unit: '°C', digits: 1, icon: '🌡' },
  { key: 'humidity', label: 'Kelembapan', unit: '%', digits: 1, icon: '💧' },
  { key: 'co2', label: 'CO₂', unit: 'ppm', digits: 0, icon: '🫧' },
];
export const REPORT_SECTIONS = Object.freeze(['parameters', 'harvest', 'activities', 'alerts']);
const FREQUENCIES = ['daily', 'weekly', 'monthly'];
const FREQUENCY_LABEL = { daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan' };
const STAGE_LABEL = { inoculation: 'Inokulasi', incubation: 'Inkubasi', fruiting: 'Buka baglog', harvesting: 'Masa panen', completed: 'Selesai' };

const bad = message => new HttpError(400, 'invalid_input', message);
const round = (value, digits) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(digits)));
const localIso = ms => new Date(ms + WIB).toISOString();
const localDate = ms => localIso(ms).slice(0, 10);
export const dayStartWib = date => Date.parse(`${date}T00:00:00+07:00`);
const escapeHtml = value => String(value ?? '').replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
const idList = value => (typeof value === 'string' && value.trim() ? [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))].slice(0, 200) : []);
const formatNumber = (value, digits = 1) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('id-ID', { maximumFractionDigits: digits }));
const formatDay = ms => new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });

/** Rentang tanggal WIB (inklusif) → { startMs, endMs } dengan batas hari. */
export function dateRange(query, { defaultDays = 7, maxDays = 366, now = Date.now() } = {}) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  for (const key of ['from', 'to']) {
    if (query?.[key] && (!pattern.test(query[key]) || !Number.isFinite(dayStartWib(query[key])))) throw bad(`Tanggal ${key} tidak valid`);
  }
  const today = localDate(now);
  const endMs = dayStartWib(query?.to || today) + DAY;
  const startMs = query?.from ? dayStartWib(query.from) : endMs - defaultDays * DAY;
  if (startMs >= endMs) throw bad('Tanggal awal harus sebelum tanggal akhir');
  if (endMs - startMs > maxDays * DAY) throw bad(`Rentang maksimal ${maxDays} hari`);
  return { startMs, endMs };
}

// ───────────────────────────── jadwal

/** Waktu kirim berikutnya setelah `fromMs` sesuai frekuensi (jam WIB). */
export function nextRunAt(schedule, fromMs = Date.now()) {
  const local = new Date(fromMs + WIB);
  const at = (year, month, day) => Date.UTC(year, month, day, schedule.sendHour) - WIB;
  const [y, m, d] = [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()];
  if (schedule.frequency === 'daily') {
    const today = at(y, m, d);
    return today > fromMs ? today : at(y, m, d + 1);
  }
  if (schedule.frequency === 'weekly') {
    const isoDay = ((local.getUTCDay() + 6) % 7) + 1; // 1 = Senin
    let add = (schedule.weekday - isoDay + 7) % 7;
    if (add === 0 && at(y, m, d) <= fromMs) add = 7;
    return at(y, m, d + add);
  }
  const thisMonth = at(y, m, schedule.monthDay);
  return thisMonth > fromMs ? thisMonth : at(y, m + 1, schedule.monthDay);
}

/** Periode laporan untuk pengiriman pada `runMs`: kemarin / 7 hari terakhir / bulan lalu (hari penuh WIB). */
export function reportPeriod(frequency, runMs = Date.now()) {
  const todayStart = dayStartWib(localDate(runMs));
  if (frequency === 'daily') return { startMs: todayStart - DAY, endMs: todayStart };
  if (frequency === 'weekly') return { startMs: todayStart - 7 * DAY, endMs: todayStart };
  const local = new Date(runMs + WIB);
  return {
    startMs: Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1) - WIB,
    endMs: Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - WIB,
  };
}

/** Input jadwal (baru atau ubah sebagian dari `current` bentuk API). */
export function scheduleInput(input, current = null) {
  const pick = (key, fn) => (input?.[key] === undefined && current ? current[key] : fn(input?.[key]));
  const frequency = pick('frequency', value => {
    if (!FREQUENCIES.includes(value)) throw bad('Frekuensi laporan tidak valid');
    return value;
  });
  const sections = pick('sections', value => {
    const list = Array.isArray(value) ? [...new Set(value)] : [];
    if (!list.length || list.some(item => !REPORT_SECTIONS.includes(item))) throw bad('Pilih minimal satu isi laporan');
    return list;
  });
  return {
    name: pick('name', value => {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text || text.length > 100) throw bad('Nama laporan 1–100 karakter');
      return text;
    }),
    frequency,
    sendHour: pick('sendHour', value => Math.round(boundedNumber(value ?? 7, 'Jam kirim', 0, 23))),
    weekday: frequency === 'weekly' ? Math.round(boundedNumber(input?.weekday ?? current?.weekday ?? 1, 'Hari kirim', 1, 7)) : null,
    monthDay: frequency === 'monthly' ? Math.round(boundedNumber(input?.monthDay ?? current?.monthDay ?? 1, 'Tanggal kirim', 1, 28)) : null,
    kumbungIds: pick('kumbungIds', value => (Array.isArray(value) ? [...new Set(value.map(String))].slice(0, 200) : [])),
    sections,
    attachExcel: pick('attachExcel', value => value !== false),
    enabled: pick('enabled', value => value !== false),
  };
}

const scheduleView = row => ({
  id: row.id, farmId: row.farm_id, name: row.name, frequency: row.frequency, sendHour: row.send_hour,
  weekday: row.weekday, monthDay: row.month_day, kumbungIds: row.kumbung_ids, sections: row.sections,
  attachExcel: row.attach_excel, enabled: row.enabled,
  nextRunAt: row.next_run_at ? new Date(row.next_run_at).getTime() : null,
  lastRunAt: row.last_run_at ? new Date(row.last_run_at).getTime() : null,
  lastStatus: row.last_status, lastError: row.last_error, createdBy: row.created_by,
});

// ───────────────────────────── layanan

export function createReportService({ pool, activities, notifier, log = console }) {
  async function kumbungScope(farmId, ids) {
    const { rows } = await pool.query(
      `SELECT id, name, status FROM kumbungs WHERE farm_id = $1 AND (cardinality($2::text[]) = 0 OR id = ANY($2)) ORDER BY name`,
      [farmId, ids],
    );
    if (ids.length && rows.length !== ids.length) throw bad('Ada kumbung yang tidak ada di farm ini');
    return ids.length ? rows : rows.filter(row => row.status !== 'inactive');
  }

  // ── export parameter

  /** Data parameter kumbung sesuai filter → { filename, body, contentType }. */
  async function telemetryExport(user, farmId, query) {
    await requireFarm(pool, user, farmId);
    const { startMs, endMs } = dateRange(query);
    const interval = ['10m', '1h', '1d'].includes(query?.interval) ? query.interval : '1h';
    const perSensor = query?.groupBy !== 'kumbung';
    const format = query?.format === 'xlsx' ? 'xlsx' : 'csv';
    const kumbungIds = idList(query?.kumbungIds);
    const sensorIds = idList(query?.sensorIds);
    const bucket = { '10m': 'h.bucket_start', '1h': "date_trunc('hour', h.ts)", '1d': "(date_trunc('day', h.ts AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')" }[interval];
    const metricSql = METRICS.map(({ key }) => {
      const value = `(h."values"->>'${key}')::float8`;
      return `avg(${value}) AS ${key}_avg, min(${value}) AS ${key}_min, max(${value}) AS ${key}_max`;
    }).join(', ');
    const limit = 200_000;
    const { rows } = await pool.query(
      `SELECT ${bucket} AS bucket, k.name AS kumbung_name, ${perSensor ? 's.name AS sensor_name, s.id AS sensor_id,' : ''}
         count(DISTINCT h.sensor_id) AS sensors, count(*) AS samples, ${metricSql}
       FROM telemetry_history h JOIN sensors s ON s.id = h.sensor_id JOIN kumbungs k ON k.id = s.kumbung_id
       WHERE k.farm_id = $1 AND h.ts >= $2 AND h.ts < $3
         AND (cardinality($4::text[]) = 0 OR k.id = ANY($4)) AND (cardinality($5::text[]) = 0 OR s.id = ANY($5))
       GROUP BY 1, k.id, k.name${perSensor ? ', s.id, s.name' : ''}
       ORDER BY 1, k.name${perSensor ? ', s.name' : ''} LIMIT ${limit + 1}`,
      [farmId, new Date(startMs), new Date(endMs), kumbungIds, sensorIds],
    );
    if (rows.length > limit) throw bad('Data terlalu banyak; perpendek rentang atau pilih interval per jam/per hari');

    const single = interval === '10m' && perSensor; // satu sampel per baris → cukup satu nilai
    const header = ['Tanggal', 'Jam', 'Kumbung', perSensor ? 'Sensor' : 'Jumlah sensor',
      ...METRICS.flatMap(({ label, unit }) => (single ? [`${label} (${unit})`] : [`${label} rata-rata (${unit})`, `${label} min (${unit})`, `${label} maks (${unit})`])),
      ...(single ? [] : ['Jumlah data'])];
    const table = [header, ...rows.map(row => {
      const local = localIso(new Date(row.bucket).getTime());
      return [
        local.slice(0, 10), interval === '1d' ? '' : local.slice(11, 16), row.kumbung_name,
        perSensor ? row.sensor_name || row.sensor_id : Number(row.sensors),
        ...METRICS.flatMap(({ key, digits }) => (single ? [round(row[`${key}_avg`], digits)]
          : [round(row[`${key}_avg`], digits), round(row[`${key}_min`], digits), round(row[`${key}_max`], digits)])),
        ...(single ? [] : [Number(row.samples)]),
      ];
    })];
    const name = `data-parameter-${farmId}-${localDate(startMs)}_${localDate(endMs - 1)}`;
    if (format === 'csv') return { filename: `${name}.csv`, contentType: 'text/csv; charset=utf-8', body: buildCsv(table) };
    const info = [['Keterangan', 'Nilai'], ['Farm', farmId], ['Periode', `${localDate(startMs)} s/d ${localDate(endMs - 1)}`],
      ['Interval', { '10m': '10 menit', '1h': 'per jam', '1d': 'per hari' }[interval]], ['Pengelompokan', perSensor ? 'per sensor' : 'rata-rata per kumbung'],
      ['Jumlah baris', rows.length], ['Dibuat', localIso(Date.now()).slice(0, 16).replace('T', ' ') + ' WIB']];
    return {
      filename: `${name}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: buildXlsx([{ name: 'Data parameter', rows: table, widths: [12, 7, 18, 18, ...header.slice(4).map(() => 14)] }, { name: 'Info', rows: info, widths: [16, 36] }]),
    };
  }

  // ── laporan farm

  /** Susun laporan farm untuk periode & kumbung terpilih (tanpa cek akses; dipanggil setelah requireFarm). */
  async function buildReport(farmId, { startMs, endMs, kumbungIds = [], sections = REPORT_SECTIONS }) {
    const { rows: [farm] } = await pool.query(
      'SELECT f.id, f.name, s.optimal FROM farms f LEFT JOIN farm_alert_settings s ON s.farm_id = f.id WHERE f.id = $1', [farmId]);
    if (!farm) throw new HttpError(404, 'not_found', 'Farm tidak ditemukan.');
    const optimal = farm.optimal || DEFAULT_OPTIMAL;
    const kumbungs = await kumbungScope(farmId, kumbungIds);
    const ids = kumbungs.map(item => item.id);
    const range = [new Date(startMs), new Date(endMs)];
    const report = {
      farm: { id: farm.id, name: farm.name }, startAt: startMs, endAt: endMs, sections, optimal, generatedAt: Date.now(),
      kumbungs: kumbungs.map(item => ({ id: item.id, name: item.name })), daily: [], recap: [],
    };
    const byId = new Map(report.kumbungs.map(item => [item.id, item]));
    if (!ids.length) return report;

    const { rows: batches } = await pool.query(
      `SELECT DISTINCT ON (kumbung_id) * FROM batches WHERE kumbung_id = ANY($1) AND status = 'active' ORDER BY kumbung_id, started_at DESC`, [ids]);
    for (const batch of batches) {
      const day = Math.floor((Math.min(endMs, Date.now()) + WIB) / DAY) - Math.floor((new Date(batch.started_at).getTime() + WIB) / DAY) + 1;
      byId.get(batch.kumbung_id).batch = { id: batch.id, number: Number(/-B(\d+)$/.exec(batch.id)?.[1]) || null, day, stage: batch.growth_stage, active: batch.baglog_count_active, initial: batch.baglog_count_initial };
    }

    if (sections.includes('parameters')) {
      const metric = ({ key }) => {
        const value = `(h."values"->>'${key}')::float8`;
        const [lo, hi] = [Number(optimal[key].min), Number(optimal[key].max)];
        return `avg(${value}) AS ${key}_avg, min(${value}) AS ${key}_min, max(${value}) AS ${key}_max,
          avg(CASE WHEN ${value} IS NULL THEN NULL WHEN ${value} BETWEEN ${lo} AND ${hi} THEN 1.0 ELSE 0.0 END) AS ${key}_ok`;
      };
      const select = METRICS.map(metric).join(', ');
      const base = `FROM telemetry_history h JOIN sensors s ON s.id = h.sensor_id WHERE s.kumbung_id = ANY($1) AND h.ts >= $2 AND h.ts < $3`;
      const { rows: totals } = await pool.query(`SELECT s.kumbung_id, count(*) AS samples, ${select} ${base} GROUP BY s.kumbung_id`, [ids, ...range]);
      for (const row of totals) {
        byId.get(row.kumbung_id).parameters = Object.fromEntries(METRICS.map(({ key, digits }) => [key, {
          avg: round(row[`${key}_avg`], digits), min: round(row[`${key}_min`], digits), max: round(row[`${key}_max`], digits),
          optimalPct: row[`${key}_ok`] === null ? null : Math.round(Number(row[`${key}_ok`]) * 100),
        }]));
        byId.get(row.kumbung_id).samples = Number(row.samples);
      }
      const { rows: daily } = await pool.query(
        `SELECT to_char(h.ts AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day, s.kumbung_id, ${select} ${base} GROUP BY 1, 2 ORDER BY 1, 2`, [ids, ...range]);
      report.daily = daily.map(row => ({
        date: row.day, kumbungId: row.kumbung_id,
        ...Object.fromEntries(METRICS.map(({ key, digits }) => [key, { avg: round(row[`${key}_avg`], digits), min: round(row[`${key}_min`], digits), max: round(row[`${key}_max`], digits), optimalPct: row[`${key}_ok`] === null ? null : Math.round(Number(row[`${key}_ok`]) * 100) }])),
      }));
    }

    if (sections.includes('harvest') || sections.includes('activities')) {
      const filter = { startMs, endMs, kumbungId: null, batchId: null, actor: null, kinds: ['harvest', 'care', 'problem', 'batch'] };
      const rows = (await activities.rows(farmId, filter, 50_000)).filter(row => byId.has(row.kumbungId));
      for (const item of report.kumbungs) item.recap = summarize(rows.filter(row => row.kumbungId === item.id), filter);
      report.recap = rows.reverse();
    }

    if (sections.includes('alerts')) {
      const { rows } = await pool.query(
        `SELECT kumbung_id, severity, count(*) AS n FROM alert_events WHERE farm_id = $1 AND kumbung_id = ANY($2)
           AND occurred_at >= $3 AND occurred_at < $4 GROUP BY 1, 2`, [farmId, ids, ...range]);
      for (const item of report.kumbungs) item.alerts = { critical: 0, warning: 0 };
      for (const row of rows) byId.get(row.kumbung_id).alerts[row.severity] = Number(row.n);
    }
    return report;
  }

  /** Laporan sebagai teks Telegram (HTML, ≤ 4000 karakter). */
  function reportText(report, title) {
    const period = report.endAt - report.startAt <= DAY ? formatDay(report.startAt) : `${formatDay(report.startAt)} – ${formatDay(report.endAt - 1)}`;
    const has = section => report.sections.includes(section);
    const parts = [`📊 <b>${escapeHtml(title)} — ${escapeHtml(report.farm.name)}</b>`, `🗓 ${period}`];
    let totalKg = 0;
    for (const item of report.kumbungs) {
      const lines = [`\n🏠 <b>${escapeHtml(item.name)}</b>${item.batch ? ` · Batch ${item.batch.number ?? ''} hari ke-${item.batch.day} (${STAGE_LABEL[item.batch.stage] || item.batch.stage})` : ''}`];
      if (has('parameters')) {
        if (!item.parameters) lines.push('   Tidak ada data sensor.');
        else for (const metric of METRICS) {
          const value = item.parameters[metric.key];
          if (value.avg === null) continue;
          lines.push(`${metric.icon} ${metric.label} ${formatNumber(value.avg, metric.digits)} ${metric.unit} (${formatNumber(value.min, metric.digits)}–${formatNumber(value.max, metric.digits)}) · ${value.optimalPct ?? '—'}% waktu optimal`);
        }
      }
      if (has('harvest') && item.recap) {
        totalKg += item.recap.harvestKg;
        lines.push(`⚖️ Panen ${formatNumber(item.recap.harvestKg, 2)} kg (${item.recap.harvestCount}×) · mutu A ${formatNumber(item.recap.gradeKg.A, 2)} kg`);
      }
      if (has('activities') && item.recap) lines.push(`🧺 Kegiatan ${item.recap.careCount} · masalah ${item.recap.problemCount} · baglog dibuang ${item.recap.baglogRemoved}`);
      if (has('alerts') && item.alerts) lines.push(`⚠️ Alert: ${item.alerts.critical} kritis, ${item.alerts.warning} peringatan`);
      parts.push(lines.join('\n'));
    }
    if (!report.kumbungs.length) parts.push('\nBelum ada kumbung aktif.');
    if (has('harvest') && report.kumbungs.length > 1) parts.push(`\n<b>Total panen: ${formatNumber(totalKg, 2)} kg</b>`);
    let text = parts.join('\n');
    if (text.length > 4000) text = `${text.slice(0, 3950)}\n… (lengkap di file Excel)`;
    return text;
  }

  /** Laporan sebagai file Excel (Ringkasan, Parameter harian, Kegiatan & panen, Info). */
  function reportSheets(report) {
    const names = new Map(report.kumbungs.map(item => [item.id, item.name]));
    const summary = [['Kumbung', 'Batch berjalan', 'Hari ke',
      ...METRICS.flatMap(m => [`${m.label} rata-rata (${m.unit})`, `${m.label} min`, `${m.label} maks`, `${m.label} % optimal`]),
      'Panen (kg)', 'Kali panen', 'Mutu A (kg)', 'Mutu B (kg)', 'Campur (kg)', 'Kegiatan', 'Masalah', 'Baglog dibuang', 'Alert kritis', 'Alert peringatan']];
    for (const item of report.kumbungs) {
      summary.push([item.name, item.batch ? `Batch ${item.batch.number ?? item.batch.id}` : '', item.batch?.day ?? '',
        ...METRICS.flatMap(m => { const v = item.parameters?.[m.key]; return [v?.avg ?? '', v?.min ?? '', v?.max ?? '', v?.optimalPct ?? '']; }),
        item.recap?.harvestKg ?? '', item.recap?.harvestCount ?? '', item.recap?.gradeKg.A ?? '', item.recap?.gradeKg.B ?? '', item.recap?.gradeKg.mixed ?? '',
        item.recap?.careCount ?? '', item.recap?.problemCount ?? '', item.recap?.baglogRemoved ?? '', item.alerts?.critical ?? '', item.alerts?.warning ?? '']);
    }
    const daily = [['Tanggal', 'Kumbung', ...METRICS.flatMap(m => [`${m.label} rata-rata (${m.unit})`, `${m.label} min`, `${m.label} maks`, `${m.label} % optimal`])],
      ...report.daily.map(row => [row.date, names.get(row.kumbungId) || row.kumbungId, ...METRICS.flatMap(m => [row[m.key].avg ?? '', row[m.key].min ?? '', row[m.key].max ?? '', row[m.key].optimalPct ?? ''])])];
    const TYPE = { harvest: 'Panen', care: 'Kegiatan harian', note: 'Catatan', problem: 'Masalah', batch_start: 'Batch dimulai', phase_change: 'Ganti tahap', batch_end: 'Batch ditutup' };
    const recap = [['Tanggal', 'Jam', 'Kumbung', 'Jenis', 'Rincian', 'Baglog', 'Berat (kg)', 'Mutu', 'Catatan', 'Dicatat oleh'],
      ...report.recap.map(row => {
        const local = localIso(row.occurredAt);
        return [local.slice(0, 10), local.slice(11, 16), row.kumbungName, TYPE[row.type] || row.type, row.items.join(', '),
          row.quantity ?? '', row.weightKg ?? '', row.grade ?? '', row.notes, row.recordedByName || ''];
      })];
    const optimal = report.optimal;
    const info = [['Keterangan', 'Nilai'], ['Farm', report.farm.name], ['Periode', `${localDate(report.startAt)} s/d ${localDate(report.endAt - 1)}`],
      ...METRICS.map(m => [`Rentang optimal ${m.label}`, `${optimal[m.key].min}–${optimal[m.key].max} ${m.unit}`]),
      ['Dibuat', `${localIso(report.generatedAt).slice(0, 16).replace('T', ' ')} WIB`]];
    const sheets = [{ name: 'Ringkasan', rows: summary, widths: [18, 14, 8] }];
    if (report.sections.includes('parameters')) sheets.push({ name: 'Parameter harian', rows: daily, widths: [12, 18] });
    if (report.sections.includes('harvest') || report.sections.includes('activities')) sheets.push({ name: 'Kegiatan & panen', rows: recap, widths: [12, 7, 18, 16, 30, 8, 10, 8, 30, 16] });
    sheets.push({ name: 'Info', rows: info, widths: [24, 40] });
    return sheets;
  }

  const reportFilters = query => {
    const sections = idList(query?.sections).filter(item => REPORT_SECTIONS.includes(item));
    return { ...dateRange(query), kumbungIds: idList(query?.kumbungIds), sections: sections.length ? sections : [...REPORT_SECTIONS] };
  };

  async function report(user, farmId, query) {
    await requireFarm(pool, user, farmId);
    return buildReport(farmId, reportFilters(query));
  }

  async function reportFile(user, farmId, query) {
    await requireFarm(pool, user, farmId);
    const filters = reportFilters(query);
    const data = await buildReport(farmId, filters);
    const name = `laporan-${farmId}-${localDate(filters.startMs)}_${localDate(filters.endMs - 1)}`;
    if (query?.format === 'csv') return { filename: `${name}.csv`, contentType: 'text/csv; charset=utf-8', body: buildCsv(reportSheets(data)[0].rows) };
    return { filename: `${name}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: buildXlsx(reportSheets(data)) };
  }

  // ── jadwal & pengiriman

  async function listSchedules(user, farmId) {
    await requireFarm(pool, user, farmId);
    const { rows } = await pool.query('SELECT * FROM report_schedules WHERE farm_id = $1 ORDER BY created_at', [farmId]);
    return rows.map(scheduleView);
  }

  async function checkKumbungs(farmId, kumbungIds) {
    if (kumbungIds.length) await kumbungScope(farmId, kumbungIds);
  }

  async function createSchedule(user, farmId, input) {
    await requireFarm(pool, user, farmId, { owner: true });
    const fields = scheduleInput(input);
    await checkKumbungs(farmId, fields.kumbungIds);
    const { rows: [row] } = await pool.query(
      `INSERT INTO report_schedules (id, farm_id, name, frequency, send_hour, weekday, month_day, kumbung_ids, sections, attach_excel, enabled, next_run_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [randomUUID(), farmId, fields.name, fields.frequency, fields.sendHour, fields.weekday, fields.monthDay, fields.kumbungIds, fields.sections,
        fields.attachExcel, fields.enabled, new Date(nextRunAt(fields)), user.uid],
    );
    return scheduleView(row);
  }

  async function scheduleForOwner(db, user, id) {
    const { rows: [row] } = await db.query('SELECT * FROM report_schedules WHERE id::text = $1', [id]);
    if (!row) throw new HttpError(404, 'not_found', 'Jadwal laporan tidak ditemukan.');
    await requireFarm(db, user, row.farm_id, { owner: true, notFound: 'Jadwal laporan tidak ditemukan.' });
    return row;
  }

  async function updateSchedule(user, id, input) {
    const current = await scheduleForOwner(pool, user, id);
    const fields = scheduleInput(input, scheduleView(current));
    await checkKumbungs(current.farm_id, fields.kumbungIds);
    const { rows: [row] } = await pool.query(
      `UPDATE report_schedules SET name = $2, frequency = $3, send_hour = $4, weekday = $5, month_day = $6, kumbung_ids = $7,
         sections = $8, attach_excel = $9, enabled = $10, next_run_at = $11, updated_at = now() WHERE id = $1 RETURNING *`,
      [current.id, fields.name, fields.frequency, fields.sendHour, fields.weekday, fields.monthDay, fields.kumbungIds, fields.sections,
        fields.attachExcel, fields.enabled, new Date(nextRunAt(fields))],
    );
    return scheduleView(row);
  }

  async function deleteSchedule(user, id) {
    const current = await scheduleForOwner(pool, user, id);
    await pool.query('DELETE FROM report_schedules WHERE id = $1', [current.id]);
  }

  /** Susun & kirim satu jadwal ke Telegram farm; status disimpan di jadwal. */
  async function deliver(row, runMs = Date.now()) {
    const schedule = scheduleView(row);
    let status = 'sent';
    let errorText = null;
    try {
      const { rows: [settings] } = await pool.query('SELECT * FROM farm_alert_settings WHERE farm_id = $1', [row.farm_id]);
      if (!settings?.telegram_enabled || !settings.telegram_bot_token || !settings.telegram_chat_id) throw new Error('Telegram farm belum terhubung');
      const period = reportPeriod(schedule.frequency, runMs);
      const data = await buildReport(row.farm_id, { ...period, kumbungIds: schedule.kumbungIds, sections: schedule.sections });
      const target = { token: settings.telegram_bot_token, chatId: settings.telegram_chat_id };
      await notifier.send(target, reportText(data, `Laporan ${FREQUENCY_LABEL[schedule.frequency]} · ${schedule.name}`));
      if (schedule.attachExcel && notifier.sendDocument) {
        await notifier.sendDocument(target, {
          filename: `laporan-${localDate(period.startMs)}_${localDate(period.endMs - 1)}.xlsx`,
          buffer: buildXlsx(reportSheets(data)),
          caption: `📎 ${schedule.name} (Excel)`,
        });
      }
    } catch (error) {
      status = 'failed';
      errorText = error.message.slice(0, 300);
      log.warn?.(`[report] ${row.id} gagal: ${errorText}`);
    }
    const { rows: [updated] } = await pool.query(
      'UPDATE report_schedules SET last_run_at = now(), last_status = $2, last_error = $3 WHERE id = $1 RETURNING *', [row.id, status, errorText]);
    return scheduleView(updated);
  }

  async function sendNow(user, id) {
    return deliver(await scheduleForOwner(pool, user, id));
  }

  /** Sweeper: kirim jadwal yang sudah waktunya; next_run dimajukan dulu agar tidak terkirim dobel. */
  async function runDue(now = Date.now()) {
    const { rows } = await pool.query(
      'SELECT * FROM report_schedules WHERE enabled AND next_run_at <= $1 ORDER BY next_run_at LIMIT 20', [new Date(now)]);
    for (const row of rows) {
      const next = nextRunAt(scheduleView(row), now);
      const { rowCount } = await pool.query(
        'UPDATE report_schedules SET next_run_at = $2 WHERE id = $1 AND enabled AND next_run_at <= $3', [row.id, new Date(next), new Date(now)]);
      if (rowCount) await deliver(row, now);
    }
    return rows.length;
  }

  return { telemetryExport, report, reportFile, buildReport, reportText, listSchedules, createSchedule, updateSchedule, deleteSchedule, sendNow, runDue };
}
