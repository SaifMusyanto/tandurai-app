import { apiRequest } from './api';

// Endpoint IoT backend (apps/api). Dashboard tidak terhubung langsung ke MQTT.
const id = encodeURIComponent;

export const iotApi = {
  listGateways: () => apiRequest('GET', '/gateways'),
  preview: (hwUid, claimCode) => apiRequest('GET', `/devices/${id(hwUid)}/preview?claimCode=${id(claimCode)}`),
  claim: input => apiRequest('POST', '/gateways/claim', input),
  unclaim: gatewayId => apiRequest('DELETE', `/gateways/${id(gatewayId)}`),
  renameGateway: (gatewayId, name) => apiRequest('PATCH', `/gateways/${id(gatewayId)}`, { name }),
  updateSensor: (sensorId, input) => apiRequest('PATCH', `/sensors/${id(sensorId)}`, input),
  updateActuator: (actuatorId, input) => apiRequest('PATCH', `/actuators/${id(actuatorId)}`, input),
  sendCommand: (actuatorId, input) => apiRequest('POST', `/actuators/${id(actuatorId)}/commands`, input),
  saveConfig: (actuatorId, input) => apiRequest('PUT', `/actuators/${id(actuatorId)}/config`, input),
  history: (sensorId, from, to) => apiRequest('GET', `/sensors/${id(sensorId)}/history?from=${id(from)}&to=${id(to)}`),
  actuatorLog: (kumbungId, limit = 50) => apiRequest('GET', `/kumbungs/${id(kumbungId)}/actuator-log?limit=${limit}`),
};
