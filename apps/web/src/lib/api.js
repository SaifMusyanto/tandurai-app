import { auth } from '../firebase';

// Backend Tandurai (apps/api): seluruh data aplikasi + IoT. Firebase hanya untuk login.
export const API_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_IOT_API_URL || 'http://localhost:8787/api').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function token() {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'unauthorized', 'Login diperlukan.');
  return user.getIdToken();
}

export async function apiRequest(method, path, body) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await token()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Backend Tandurai tidak dapat dihubungi.');
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiError(response.status, data?.error || 'error', data?.message || `HTTP ${response.status}`);
  return data;
}

/** Unduh file dari backend (mis. CSV rekap) → { blob, filename }. */
export async function apiDownload(path, fallbackName = 'unduhan') {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${await token()}` } });
  } catch {
    throw new ApiError(0, 'network', 'Backend Tandurai tidak dapat dihubungi.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.error || 'error', data?.message || `HTTP ${response.status}`);
  }
  const match = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '');
  return { blob: await response.blob(), filename: match?.[1] || fallbackName };
}

/** URL SSE dengan token terbaru (EventSource tidak dapat mengirim header Authorization). */
export async function streamUrl() {
  return `${API_URL}/stream?token=${encodeURIComponent(await token())}`;
}

const id = encodeURIComponent;
const query = params => {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  return search.toString() ? `?${search}` : '';
};

export const api = {
  // akun
  me: () => apiRequest('GET', '/me'),
  updateMe: input => apiRequest('PATCH', '/me', input),
  settings: () => apiRequest('GET', '/me/settings'),
  saveSettings: settings => apiRequest('PUT', '/me/settings', settings),
  // farm, anggota, audit
  farms: () => apiRequest('GET', '/farms'),
  createFarm: input => apiRequest('POST', '/farms', input),
  updateFarm: (farmId, input) => apiRequest('PATCH', `/farms/${id(farmId)}`, input),
  members: farmId => apiRequest('GET', `/farms/${id(farmId)}/members`),
  addMember: (farmId, email) => apiRequest('POST', `/farms/${id(farmId)}/members`, { email }),
  removeMember: (farmId, uid) => apiRequest('DELETE', `/farms/${id(farmId)}/members/${id(uid)}`),
  audit: (farmId, limit = 30) => apiRequest('GET', `/farms/${id(farmId)}/audit${query({ limit })}`),
  // kumbung, batch, panen
  kumbungs: farmId => apiRequest('GET', `/farms/${id(farmId)}/kumbungs`),
  createKumbung: (farmId, input) => apiRequest('POST', `/farms/${id(farmId)}/kumbungs`, input),
  updateKumbung: (kumbungId, input) => apiRequest('PATCH', `/kumbungs/${id(kumbungId)}`, input),
  saveHarvestProfile: (kumbungId, input) => apiRequest('PUT', `/kumbungs/${id(kumbungId)}/harvest-profile`, input),
  createBatch: (kumbungId, input) => apiRequest('POST', `/kumbungs/${id(kumbungId)}/batches`, input),
  updateBatch: (batchId, input) => apiRequest('PATCH', `/batches/${id(batchId)}`, input),
  createHarvest: (kumbungId, input) => apiRequest('POST', `/kumbungs/${id(kumbungId)}/harvests`, input),
  operations: () => apiRequest('GET', '/operations'),
  // kegiatan kumbung & rekap
  createActivity: (kumbungId, input) => apiRequest('POST', `/kumbungs/${id(kumbungId)}/activities`, input),
  voidActivity: (activityId, reason) => apiRequest('POST', `/activities/${id(activityId)}/void`, { reason }),
  recap: (farmId, params = {}) => apiRequest('GET', `/farms/${id(farmId)}/recap${query(params)}`),
  recapCsv: (farmId, params = {}) => apiDownload(`/farms/${id(farmId)}/recap.csv${query(params)}`, 'rekap.csv'),
  // export data parameter & laporan farm
  telemetryExport: (farmId, params = {}) => apiDownload(`/farms/${id(farmId)}/telemetry-export${query(params)}`, 'data-parameter'),
  report: (farmId, params = {}) => apiRequest('GET', `/farms/${id(farmId)}/report${query(params)}`),
  reportFile: (farmId, params = {}) => apiDownload(`/farms/${id(farmId)}/report-file${query(params)}`, 'laporan'),
  reportSchedules: farmId => apiRequest('GET', `/farms/${id(farmId)}/report-schedules`),
  createReportSchedule: (farmId, input) => apiRequest('POST', `/farms/${id(farmId)}/report-schedules`, input),
  updateReportSchedule: (scheduleId, input) => apiRequest('PATCH', `/report-schedules/${id(scheduleId)}`, input),
  deleteReportSchedule: scheduleId => apiRequest('DELETE', `/report-schedules/${id(scheduleId)}`),
  sendReportSchedule: scheduleId => apiRequest('POST', `/report-schedules/${id(scheduleId)}/send`),
  kumbungTelemetry: (kumbungId, params) => apiRequest('GET', `/kumbungs/${id(kumbungId)}/telemetry${query(params)}`),
  // alert & forecast
  alerts: params => apiRequest('GET', `/alerts${query(params || {})}`),
  alertSettings: farmId => apiRequest('GET', `/farms/${id(farmId)}/alert-settings`),
  saveAlertSettings: (farmId, input) => apiRequest('PUT', `/farms/${id(farmId)}/alert-settings`, input),
  testTelegram: farmId => apiRequest('POST', `/farms/${id(farmId)}/alert-settings/test`),
  forecast: kumbungId => apiRequest('GET', `/kumbungs/${id(kumbungId)}/forecast`),
  requestForecast: (kumbungId, batchId) => apiRequest('POST', `/kumbungs/${id(kumbungId)}/forecast-requests`, { batchId }),
  latestForecasts: () => apiRequest('GET', '/forecasts/latest'),
  workerStatus: () => apiRequest('GET', '/system/worker-status'),
  // konsol admin Tandurai
  adminOverview: () => apiRequest('GET', '/admin/overview'),
  adminUsers: () => apiRequest('GET', '/admin/users'),
  adminFarms: () => apiRequest('GET', '/admin/farms'),
  adminFarm: farmId => apiRequest('GET', `/admin/farms/${id(farmId)}`),
  // registrasi perangkat (admin Tandurai)
  adminDevices: () => apiRequest('GET', '/admin/devices'),
  provisionDevices: input => apiRequest('POST', '/admin/devices', input),
};
