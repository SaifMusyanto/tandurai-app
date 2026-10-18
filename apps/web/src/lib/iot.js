import { PARAMETERS } from './parameters.js';

// Logika murni untuk data IoT dari backend MQTT (apps/api): penerapan event SSE ke state
// dan status tampilan command. Dipakai IotContext dan diuji di tests/iot-web.test.mjs.

export const IOT_EVENTS = ['gateway', 'telemetry', 'actuator', 'config', 'command'];

const patchGateway = (gateways, gatewayId, patch) =>
  gateways.map(gateway => (gateway.id === gatewayId ? patch(gateway) : gateway));

/**
 * Gabung data aktuator baru. ACK config gateway (SSE) bisa tiba sebelum respons simpan yang masih
 * "pending"; versi tidak boleh mundur sehingga status "mengirim ke gateway" tidak macet.
 */
function mergeActuator(current, next) {
  const configVersion = Math.max(current.configVersion ?? 0, next.configVersion ?? 0);
  const appliedVersion = Math.max(current.appliedVersion ?? 0, next.appliedVersion ?? 0);
  return { ...current, ...next, configVersion, appliedVersion, pendingSync: appliedVersion < configVersion };
}

/** Terapkan satu event SSE ke daftar gateway. Event untuk gateway yang tidak dikenal diabaikan. */
export function applyGatewayEvent(gateways, event, data) {
  switch (event) {
    case 'gateway':
      return patchGateway(gateways, data.gatewayId, gateway => ({
        ...gateway,
        ...(typeof data.online === 'boolean' ? { online: data.online } : {}),
        ...(data.lastSeenAt ? { lastSeenAt: data.lastSeenAt } : {}),
      }));
    case 'telemetry':
      return patchGateway(gateways, data.gatewayId, gateway => ({
        ...gateway,
        online: true,
        sensors: gateway.sensors.map(sensor => (sensor.id === data.sensorId
          ? { ...sensor, lastValues: data.values, lastTs: data.ts, status: 'active', error: null }
          : sensor)),
      }));
    case 'actuator':
      return patchGateway(gateways, data.gatewayId, gateway => ({
        ...gateway,
        actuators: gateway.actuators.map(actuator => (actuator.id === data.id ? mergeActuator(actuator, data) : actuator)),
      }));
    case 'config':
      return data.gateway ? patchGateway(gateways, data.gatewayId, () => data.gateway) : gateways;
    default:
      return gateways;
  }
}

/**
 * Command terbaru per aktuator (dipakai untuk menampilkan status eksekusi terakhir).
 * ACK gateway (SSE) bisa tiba sebelum respons HTTP command yang masih `pending`; status final
 * untuk command yang sama tidak boleh turun kembali ke `pending`.
 */
export function mergeCommand(commands, command) {
  const previous = commands[command.actuatorId];
  if (previous && previous.id !== command.id && Date.parse(previous.createdAt) > Date.parse(command.createdAt)) return commands;
  if (previous && previous.id === command.id && previous.status !== 'pending' && command.status === 'pending') return commands;
  return { ...commands, [command.actuatorId]: { ...previous?.id === command.id ? previous : {}, ...command } };
}

/**
 * Status tampilan command: Pending, Success, Failed, atau Offline.
 * Sukses hanya bila gateway mengirim ACK `success`; tanpa ACK tidak pernah dianggap berhasil.
 */
export function commandDisplay(command, gatewayOnline) {
  if (!command) return null;
  if (command.status === 'success') return { kind: 'success', label: 'Berhasil' };
  if (command.status === 'pending') {
    return gatewayOnline ? { kind: 'pending', label: 'Menunggu konfirmasi gateway…' } : { kind: 'offline', label: 'Gateway offline' };
  }
  if (command.status === 'expired' && command.reason === 'gateway_offline') {
    return { kind: 'offline', label: 'Gagal: gateway offline' };
  }
  const reasons = {
    expired: 'kedaluwarsa', no_ack: 'tidak ada ACK', mode: 'mode bukan manual', interval: 'jeda minimal belum lewat',
    unknown_actuator: 'aktuator tidak dikenal', hardware: 'gangguan hardware', broker_unavailable: 'broker tidak tersedia',
    no_clock: 'jam perangkat belum sinkron',
  };
  return { kind: 'failed', label: `Gagal: ${reasons[command.reason] || command.reason || command.status}` };
}

export const ACTION_LABEL = { on: 'Nyalakan', off: 'Matikan', estop: 'Matikan darurat' };
export const MODE_LABEL = { manual: 'Manual', timer: 'Jadwal', auto: 'Otomatis' };
// Label & satuan parameter dari satu sumber (lib/parameters.js).
export const METRIC_LABEL = Object.fromEntries(Object.values(PARAMETERS).map(item => [item.key, item.label]));
export const METRIC_UNIT = Object.fromEntries(Object.values(PARAMETERS).map(item => [item.key, item.unit]));

export function relativeTime(iso, now = Date.now()) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return 'belum pernah';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds} dtk lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} jam lalu` : `${Math.floor(hours / 24)} hari lalu`;
}

/** Sisa detik sampai aktuator mati otomatis (null bila tidak sedang ON berwaktu). */
export function secondsUntilOff(actuator, now = Date.now()) {
  if (actuator?.state !== 'on' || !actuator.offAt) return null;
  return Math.max(0, Math.ceil((Date.parse(actuator.offAt) - now) / 1000));
}

/** Durasi detik → teks singkat ("45 detik", "2 menit", "1 jam 30 menit"). */
export function formatDuration(totalSec) {
  const sec = Math.max(0, Math.round(Number(totalSec) || 0));
  if (sec < 60) return `${sec} detik`;
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const rest = sec % 60;
  return [hours && `${hours} jam`, minutes && `${minutes} menit`, rest && `${rest} detik`].filter(Boolean).join(' ');
}

export const DAY_SHORT = { 1: 'Sen', 2: 'Sel', 3: 'Rab', 4: 'Kam', 5: 'Jum', 6: 'Sab', 7: 'Min' };

/** Hari ISO (1=Senin…7=Minggu) → "Setiap hari", "Senin–Jumat", "Akhir pekan", atau daftar singkat. */
export function daysLabel(days = [1, 2, 3, 4, 5, 6, 7]) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const key = sorted.join(',');
  if (key === '1,2,3,4,5,6,7') return 'Setiap hari';
  if (key === '1,2,3,4,5') return 'Senin–Jumat';
  if (key === '6,7') return 'Akhir pekan';
  return sorted.map(day => DAY_SHORT[day]).join(', ');
}

/** Ringkasan satu jadwal: kapan dan berapa lama. */
export function describeSchedule(schedule) {
  if (schedule.type === 'at') return `Pukul ${schedule.at}, nyala ${formatDuration(schedule.onSec)}`;
  const window = schedule.window ? ` (${schedule.window.replace('-', '–')})` : '';
  return `Tiap ${formatDuration(schedule.intervalSec)}${window}, nyala ${formatDuration(schedule.onSec)}`;
}

/**
 * Mode berikutnya setelah jadwal/aturan berubah (satu cara kerja aktif per aktuator).
 * `activate` ('timer' | 'auto'): pengguna menambah/mengaktifkan item jenis itu → pindah ke mode tsb.
 * Selain itu mode saat ini dipertahankan selama masih punya item aktif; bila tidak, jatuh ke jadwal,
 * lalu aturan, lalu manual.
 */
export function nextMode(actuator, { schedules = actuator.schedules || [], rules = actuator.rules || [], activate = null } = {}) {
  const hasSchedule = schedules.some(item => item.enabled);
  const hasRule = rules.some(item => item.enabled);
  if (activate === 'timer' && hasSchedule) return 'timer';
  if (activate === 'auto' && hasRule) return 'auto';
  if (actuator.mode === 'timer' && hasSchedule) return 'timer';
  if (actuator.mode === 'auto' && hasRule) return 'auto';
  if (actuator.mode === 'manual') return 'manual';
  if (hasSchedule) return 'timer';
  if (hasRule) return 'auto';
  return 'manual';
}

const metricText = metric => (METRIC_LABEL[metric] || metric).toLowerCase();
const withUnit = (value, metric) => `${value}${METRIC_UNIT[metric] ? ` ${METRIC_UNIT[metric]}` : ''}`;

/** Kalimat aturan otomatis: kapan menyala dan kapan mati. */
export function describeRule(rule) {
  if (!rule) return '';
  const start = `Nyala saat ${metricText(rule.metric)} ${rule.operator === 'below' ? '<' : '>'} ${withUnit(rule.threshold, rule.metric)}`;
  const stop = rule.stop?.type === 'duration'
    ? `mati setelah ${formatDuration(rule.stop.onSec)}`
    : `mati saat kembali ${rule.operator === 'below' ? '≥' : '≤'} ${withUnit(rule.stop?.value, rule.metric)}`;
  return `${start}, ${stop}.`;
}

/** Alasan aktuator sedang menyala, dari sumber & pemicu yang dilaporkan gateway. */
export function describeTrigger(actuator) {
  if (actuator.state !== 'on') return '';
  if (actuator.stateSource === 'auto') {
    const rule = (actuator.rules || []).find(item => item.id === actuator.stateTrigger?.rule);
    return rule ? `otomatis — ${describeRule(rule).replace(/\.$/, '')}` : 'otomatis';
  }
  if (actuator.stateSource === 'timer') {
    const schedule = (actuator.schedules || []).find(item => item.id === actuator.stateTrigger?.schedule);
    return schedule ? `jadwal — ${describeSchedule(schedule)}` : 'jadwal';
  }
  return { manual: 'manual', estop: 'darurat', protection: 'pengaman', button: 'tombol fisik' }[actuator.stateSource] || 'manual';
}

/** Kalimat cara kerja aktuator saat ini, untuk ditampilkan apa adanya ke pengguna. */
export function describeMode(actuator) {
  if (actuator.mode === 'timer') return `Mengikuti ${(actuator.schedules || []).filter(item => item.enabled).length} jadwal aktif.`;
  if (actuator.mode === 'auto') return `Mengikuti ${(actuator.rules || []).filter(item => item.enabled).length} aturan otomatis aktif.`;
  return 'Hanya menyala bila dinyalakan dari dashboard.';
}
