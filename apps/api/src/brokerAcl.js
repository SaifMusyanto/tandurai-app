// Aturan akses MQTT yang sama untuk broker uji (Aedes) dan Mosquitto (deploy/mosquitto/acl).
import { TOPIC_PREFIX } from './mqtt.js';

export const DEVICE_PUBLISH = ['register', 'status', 'telemetry', 'state', 'ack'];
export const DEVICE_SUBSCRIBE = ['cmd', 'config'];

const parse = topic => {
  const parts = String(topic || '').split('/');
  return parts.length === 4 && `${parts[0]}/${parts[1]}` === TOPIC_PREFIX ? { hwUid: parts[2], kind: parts[3] } : null;
};

/** Perangkat hanya boleh publish ke topic miliknya; backend hanya publish cmd/config. */
export function canPublish(identity, topic) {
  const parsed = parse(topic);
  if (!parsed || !identity) return false;
  if (identity.role === 'backend') return DEVICE_SUBSCRIBE.includes(parsed.kind) && parsed.hwUid !== '+' && parsed.hwUid !== '#';
  return identity.role === 'device' && parsed.hwUid === identity.hwUid && DEVICE_PUBLISH.includes(parsed.kind);
}

/** Perangkat hanya subscribe cmd/config miliknya; backend boleh `tandurai/gw/+/<kind>` untuk pesan perangkat. */
export function canSubscribe(identity, topic) {
  if (!identity) return false;
  const parsed = parse(topic);
  if (identity.role === 'backend') return Boolean(parsed) && DEVICE_PUBLISH.includes(parsed.kind) && !parsed.hwUid.includes('#');
  return identity.role === 'device' && Boolean(parsed) && parsed.hwUid === identity.hwUid && DEVICE_SUBSCRIBE.includes(parsed.kind);
}
