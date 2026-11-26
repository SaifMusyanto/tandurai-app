/*
 * Firmware REFERENSI gateway Tandurai (ESP32 + Arduino core).
 * Mengikuti docs/KONTRAK_MQTT_GATEWAY.md; perilaku sama dengan simulator apps/api/tools/mqtt-gateway-sim.mjs.
 * STATUS: belum dikompilasi/diuji di hardware — titik awal untuk tim hardware, bukan firmware produksi final.
 *
 * Library (Library Manager):
 *   - "MQTT" oleh Joel Gaehwiler (256dpi/arduino-mqtt)  → mendukung publish QoS1 + LWT retained
 *   - "ArduinoJson" v7 oleh Benoit Blanchon
 *
 * SATU firmware untuk semua unit: tidak ada kredensial di kode. Saat pertama menyala (atau tombol
 * BOOT ditahan 3 dtk saat dinyalakan) gateway membuka Wi-Fi "Tandurai-Setup-XXXX"; buka 192.168.4.1
 * dari HP lalu isi Wi-Fi + hwUid + device secret (dari file <hwUid>.json menu Registrasi Perangkat).
 * Nilai disimpan di NVS.
 * Yang disesuaikan tim hardware sekali saja: bagian HARDWARE (pin) dan readSensor().
 *
 * Broker produksi: mqtts://mqtt.tandurai.id:8883 (TLS wajib, sudah jadi nilai bawaan halaman setup).
 * Sertifikat server diverifikasi dengan CA ISRG Root X1 yang ditanam di bawah (berlaku s.d. 2035).
 * TLS tanpa verifikasi (setInsecure) hanya aktif bila TANDURAI_ALLOW_INSECURE_TLS di-#define untuk uji.
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <MQTT.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WebServer.h>
#include <time.h>
#include <sys/time.h>
#if __has_include("ca_cert.h")
#include "ca_cert.h"   // opsional: #define TANDURAI_CA_CERT "..." untuk mengganti CA bawaan di bawah
#endif

#define FIRMWARE_VERSION "esp32-gw/0.3.0"
#define TANDURAI_MODEL "TDR-GW1"
const int SETUP_BUTTON_PIN = 0;   // tombol BOOT ESP32

// ─────────────────────────── BROKER PRODUKSI ───────────────────────────
// Nilai bawaan halaman setup; tetap bisa diganti per unit (mis. broker lokal saat uji).
const char *DEFAULT_MQTT_HOST = "mqtt.tandurai.id";
const int DEFAULT_MQTT_PORT = 8883;
const bool DEFAULT_MQTT_TLS = true;

#ifndef TANDURAI_CA_CERT
// ISRG Root X1 (Let's Encrypt), SHA-256 96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6
#define TANDURAI_CA_CERT ISRG_ROOT_X1
static const char ISRG_ROOT_X1[] = R"PEM(-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)PEM";
#endif

// ─────────────────────────── HARDWARE (sesuaikan) ───────────────────────────
struct SensorDef { const char *id; const char *type; };
// Setiap node SCD41 membaca suhu, kelembapan, dan CO₂.
SensorDef SENSORS[] = { {"S1", "scd41"}, {"S2", "scd41"} };
const char *SENSOR_METRICS[] = {"temperature", "humidity", "co2"};
const int SENSOR_COUNT = sizeof(SENSORS) / sizeof(SENSORS[0]);
const int METRIC_COUNT = 3;

struct ActuatorDef { const char *id; const char *type; int pin; bool activeHigh; uint32_t maxRunSec; uint32_t minIntervalSec; };
ActuatorDef ACTUATORS[] = {
  {"A1", "sprayer", 26, true, 120, 0},
  {"A2", "fan",     27, true, 3600, 0},
};
const int ACTUATOR_COUNT = sizeof(ACTUATORS) / sizeof(ACTUATORS[0]);

/**
 * Baca satu sensor. Isi dengan driver sensor sebenarnya (mis. SensirionI2cScd4x).
 * Kembalikan false bila gagal dibaca — sensor itu tidak dikirim di telemetry (jangan kirim 0).
 * values[] urut SENSOR_METRICS: suhu (°C), kelembapan (%), CO₂ (ppm). NAN = metrik tidak terbaca.
 */
bool readSensor(int index, float values[METRIC_COUNT]) {
  // TODO tim hardware: ganti dengan pembacaan sensor asli.
  (void)index;
  for (int i = 0; i < METRIC_COUNT; i++) values[i] = NAN;
  return false;
}

// ─────────────────────────── KONSTANTA KONTRAK ───────────────────────────
const uint32_t HEARTBEAT_MS = 60000;
const uint32_t SENSOR_STALE_MS = 180000;
const int MAX_SCHEDULES = 12;
const int MAX_RULES = 8;
const int EXECUTED_IDS = 50;

// Kredensial per unit (disimpan di NVS lewat halaman setup).
struct Credentials { String wifiSsid, wifiPassword, hwUid, deviceSecret, mqttHost; int mqttPort = DEFAULT_MQTT_PORT; bool tls = DEFAULT_MQTT_TLS; };
Credentials creds;

String topicOf(const char *kind) { return String("tandurai/gw/") + creds.hwUid + "/" + kind; }

WiFiClient plainNet;
WiFiClientSecure secureNet;
MQTTClient mqtt(8192);   // buffer cukup untuk config berisi jadwal & aturan
Preferences nvs;

// ─────────────────────────── STATE ───────────────────────────
struct Schedule { char id[17]; bool at; int atMinute; uint32_t intervalSec; uint32_t onSec; int winStart; int winEnd; uint8_t daysMask; };
struct Rule { char id[17]; char sensor[17]; char metric[16]; bool below; float threshold; bool stopDuration; uint32_t onSec; float stopValue; uint32_t cooldownSec; };
struct ActuatorCfg { char mode; uint32_t maxRunSec; uint32_t minIntervalSec; Schedule schedules[MAX_SCHEDULES]; int nSchedules; Rule rules[MAX_RULES]; int nRules; bool present; };
struct Relay {
  bool on = false; String source = "boot"; uint64_t sinceMs = 0; uint32_t offAtMillis = 0; uint32_t lastOnMillis = 0;
  bool hold = false, override_ = false; String triggerKind; String triggerId; uint32_t resumeAtMillis = 0;
  uint64_t nextEveryMs[MAX_SCHEDULES]; int firedDay[MAX_SCHEDULES]; int firedMinute[MAX_SCHEDULES];
};

ActuatorCfg cfg[ACTUATOR_COUNT];
Relay relays[ACTUATOR_COUNT];
long configVersion = 0;
int telemetryIntervalSec = 10;
int utcOffsetMin = 420;
String executed[EXECUTED_IDS];
int executedNext = 0;
float lastValues[SENSOR_COUNT][METRIC_COUNT];
uint32_t lastReadMillis[SENSOR_COUNT];
uint32_t lastHeartbeat = 0, lastTelemetry = 0, lastTick = 0, lastReconnect = 0, reconnectDelay = 1000;

// Pesan masuk diproses di loop() (klien MQTT tidak boleh dipakai di dalam callback).
const int QUEUE_SIZE = 8;
String inTopic[QUEUE_SIZE], inPayload[QUEUE_SIZE];
int queueHead = 0, queueCount = 0;

// ─────────────────────────── WAKTU ───────────────────────────
bool clockSynced() { return time(nullptr) > 1700000000; }
uint64_t epochMs() {
  struct timeval tv; gettimeofday(&tv, nullptr);
  return (uint64_t)tv.tv_sec * 1000ULL + tv.tv_usec / 1000;
}
struct LocalClock { int minute; int day; int date; };
LocalClock localClock() {
  time_t local = time(nullptr) + utcOffsetMin * 60;
  struct tm t; gmtime_r(&local, &t);
  LocalClock c; c.minute = t.tm_hour * 60 + t.tm_min; c.day = t.tm_wday == 0 ? 7 : t.tm_wday; c.date = t.tm_year * 400 + t.tm_yday;
  return c;
}
int parseHHMM(const char *text) { return text && strlen(text) >= 5 ? atoi(text) * 60 + atoi(text + 3) : -1; }
bool inWindow(const Schedule &s, int minute) {
  if (s.winStart < 0) return true;
  return s.winStart <= s.winEnd ? (minute >= s.winStart && minute < s.winEnd) : (minute >= s.winStart || minute < s.winEnd);
}

int actuatorIndex(const char *id) { for (int i = 0; i < ACTUATOR_COUNT; i++) if (!strcmp(ACTUATORS[i].id, id)) return i; return -1; }
int sensorIndex(const char *id) { for (int i = 0; i < SENSOR_COUNT; i++) if (!strcmp(SENSORS[i].id, id)) return i; return -1; }
int metricIndex(const char *m) { for (int i = 0; i < METRIC_COUNT; i++) if (!strcmp(SENSOR_METRICS[i], m)) return i; return -1; }
uint32_t maxRunOf(int i) { uint32_t hw = ACTUATORS[i].maxRunSec; return cfg[i].present && cfg[i].maxRunSec ? min(hw, cfg[i].maxRunSec) : hw; }

// ─────────────────────────── RELAY ───────────────────────────
void publishState(int only = -1);

void writePin(int i, bool on) { digitalWrite(ACTUATORS[i].pin, (on == ACTUATORS[i].activeHigh) ? HIGH : LOW); }

void setRelay(int i, bool on, const String &source, uint32_t durationSec = 0, const String &triggerKind = "", const String &triggerId = "") {
  Relay &r = relays[i];
  r.on = on; r.source = source; r.sinceMs = epochMs(); r.offAtMillis = 0;
  if (on) {
    uint32_t seconds = max<uint32_t>(1, min(durationSec, maxRunOf(i)));   // tidak pernah melebihi maxRunSec
    r.offAtMillis = millis() + seconds * 1000UL; r.lastOnMillis = millis();
    r.triggerKind = triggerKind; r.triggerId = triggerId;
  } else {
    r.override_ = false; r.triggerKind = ""; r.triggerId = "";
  }
  writePin(i, on);
}

uint32_t maxRuleCooldown(int i) { uint32_t c = 0; for (int k = 0; k < cfg[i].nRules; k++) c = max(c, cfg[i].rules[k].cooldownSec); return c; }
void pauseEngine(int i) {
  uint32_t cooldown = maxRuleCooldown(i);
  for (int k = 0; k < cfg[i].nRules; k++) if (relays[i].triggerKind == "rule" && relays[i].triggerId == cfg[i].rules[k].id) cooldown = cfg[i].rules[k].cooldownSec;
  relays[i].resumeAtMillis = millis() + cooldown * 1000UL;
}

// ─────────────────────────── PUBLISH ───────────────────────────
void publishJson(const char *kind, JsonDocument &doc, bool retained, int qos) {
  if (!mqtt.connected()) return;
  String out; serializeJson(doc, out);
  mqtt.publish(topicOf(kind), out, retained, qos);
}

void publishRegister() {
  JsonDocument doc;
  doc["model"] = TANDURAI_MODEL; doc["firmware"] = FIRMWARE_VERSION;
  JsonArray sensors = doc["sensors"].to<JsonArray>();
  for (int i = 0; i < SENSOR_COUNT; i++) {
    JsonObject s = sensors.add<JsonObject>(); s["id"] = SENSORS[i].id; s["type"] = SENSORS[i].type;   // parameter selalu suhu, kelembapan, CO₂
  }
  JsonArray actuators = doc["actuators"].to<JsonArray>();
  for (int i = 0; i < ACTUATOR_COUNT; i++) {
    JsonObject a = actuators.add<JsonObject>(); a["id"] = ACTUATORS[i].id; a["type"] = ACTUATORS[i].type;
    a["maxRunSec"] = ACTUATORS[i].maxRunSec; a["minIntervalSec"] = ACTUATORS[i].minIntervalSec;
  }
  publishJson("register", doc, false, 1);
}

void publishStatus() {
  JsonDocument doc;
  doc["online"] = true; doc["firmware"] = FIRMWARE_VERSION; doc["configVersion"] = configVersion; doc["uptimeSec"] = millis() / 1000;
  publishJson("status", doc, true, 1);
}

void publishState(int only) {
  JsonDocument doc;
  JsonObject list = doc["actuators"].to<JsonObject>();
  for (int i = 0; i < ACTUATOR_COUNT; i++) {
    if (only >= 0 && i != only) continue;
    Relay &r = relays[i];
    JsonObject a = list[ACTUATORS[i].id].to<JsonObject>();
    a["state"] = r.on ? "on" : "off";
    a["mode"] = cfg[i].mode == 't' ? "timer" : cfg[i].mode == 'a' ? "auto" : "manual";
    a["source"] = r.source; a["since"] = r.sinceMs; a["override"] = r.override_;
    if (r.on) {
      a["offAt"] = epochMs() + (uint64_t)(r.offAtMillis - millis());
      if (r.triggerKind.length()) a["trigger"][r.triggerKind] = r.triggerId; else a["trigger"] = nullptr;
    }
  }
  publishJson("state", doc, false, 1);
}

void sampleAndPublishTelemetry() {
  JsonDocument doc;
  doc["ts"] = epochMs();
  JsonObject readings = doc["readings"].to<JsonObject>();
  for (int i = 0; i < SENSOR_COUNT; i++) {
    float v[METRIC_COUNT];
    if (!readSensor(i, v)) continue;
    JsonObject s = readings[SENSORS[i].id].to<JsonObject>();
    for (int k = 0; k < METRIC_COUNT; k++) {
      if (isnan(v[k])) continue;
      s[SENSOR_METRICS[k]] = v[k];
      lastValues[i][k] = v[k];
    }
    lastReadMillis[i] = millis();   // dipakai engine otomatis walau MQTT terputus
  }
  if (clockSynced()) publishJson("telemetry", doc, false, 0);
}

// ─────────────────────────── CONFIG (NVS) ───────────────────────────
void parseConfig(JsonDocument &doc) {
  telemetryIntervalSec = doc["telemetryIntervalSec"] | 10;
  utcOffsetMin = doc["utcOffsetMin"] | 420;
  JsonObject list = doc["actuators"].as<JsonObject>();
  for (int i = 0; i < ACTUATOR_COUNT; i++) {
    ActuatorCfg &c = cfg[i];
    c = ActuatorCfg(); c.mode = 'm';
    JsonObject a = list[ACTUATORS[i].id];
    if (a.isNull()) continue;
    c.present = true;
    const char *mode = a["mode"] | "manual";
    c.mode = !strcmp(mode, "timer") ? 't' : !strcmp(mode, "auto") ? 'a' : 'm';
    c.maxRunSec = a["maxRunSec"] | ACTUATORS[i].maxRunSec;
    c.minIntervalSec = a["minIntervalSec"] | ACTUATORS[i].minIntervalSec;
    for (JsonObject s : a["schedules"].as<JsonArray>()) {
      if (c.nSchedules >= MAX_SCHEDULES) break;
      Schedule &x = c.schedules[c.nSchedules++];
      strlcpy(x.id, s["id"] | "", sizeof(x.id));
      x.at = !strcmp(s["type"] | "", "at");
      x.atMinute = parseHHMM(s["at"] | "");
      x.intervalSec = s["intervalSec"] | 0; x.onSec = s["onSec"] | 1;
      const char *w = s["window"] | "";
      x.winStart = strlen(w) == 11 ? parseHHMM(w) : -1; x.winEnd = strlen(w) == 11 ? parseHHMM(w + 6) : -1;
      x.daysMask = 0;
      for (JsonVariant day : s["days"].as<JsonArray>()) { int d = day.as<int>(); if (d >= 1 && d <= 7) x.daysMask |= (1 << d); }
      if (!x.daysMask) x.daysMask = 0xFE;
    }
    for (JsonObject r : a["rules"].as<JsonArray>()) {
      if (c.nRules >= MAX_RULES) break;
      Rule &x = c.rules[c.nRules++];
      strlcpy(x.id, r["id"] | "", sizeof(x.id)); strlcpy(x.sensor, r["sensor"] | "", sizeof(x.sensor)); strlcpy(x.metric, r["metric"] | "", sizeof(x.metric));
      x.below = !strcmp(r["operator"] | "below", "below"); x.threshold = r["threshold"] | 0.0f;
      x.stopDuration = !strcmp(r["stop"]["type"] | "value", "duration");
      x.onSec = r["stop"]["onSec"] | 0; x.stopValue = r["stop"]["value"] | 0.0f; x.cooldownSec = r["cooldownSec"] | 60;
    }
  }
}

void loadConfigFromNvs() {
  String raw = nvs.getString("config", "");
  if (!raw.length()) return;
  JsonDocument doc;
  if (deserializeJson(doc, raw)) return;
  configVersion = doc["version"] | 0;
  parseConfig(doc);
}

void handleConfig(const String &payload) {
  JsonDocument doc;
  if (deserializeJson(doc, payload)) return;
  long version = doc["version"] | -1L;
  if (version < 0 || version < configVersion) return;          // retained usang → abaikan
  bool changed = version != configVersion;
  if (changed) {
    String previous = nvs.getString("config", "");
    nvs.putString("config", payload);                           // simpan ke NVS dulu
    configVersion = version;
    JsonDocument old; deserializeJson(old, previous);
    for (int i = 0; i < ACTUATOR_COUNT; i++) {
      String before, after;
      serializeJson(old["actuators"][ACTUATORS[i].id], before);
      serializeJson(doc["actuators"][ACTUATORS[i].id], after);
      if (before != after) {                                    // konfigurasi aktuator berubah → matikan & reset engine
        if (relays[i].on) setRelay(i, false, "config");
        relays[i].hold = false; relays[i].resumeAtMillis = 0;
        for (int k = 0; k < MAX_SCHEDULES; k++) { relays[i].nextEveryMs[k] = 0; relays[i].firedDay[k] = -1; }
      }
    }
    parseConfig(doc);
  }
  JsonDocument ack;
  ack["type"] = "config"; ack["version"] = version; ack["status"] = "applied";
  JsonObject items = ack["items"].to<JsonObject>();
  for (JsonPair p : doc["actuators"].as<JsonObject>()) {
    if (actuatorIndex(p.key().c_str()) >= 0) items[p.key().c_str()]["status"] = "ok";
    else { items[p.key().c_str()]["status"] = "fault"; items[p.key().c_str()]["error"] = "unknown_channel"; }
  }
  for (int i = 0; i < SENSOR_COUNT; i++) {
    bool fresh = lastReadMillis[i] && millis() - lastReadMillis[i] < SENSOR_STALE_MS;
    items[SENSORS[i].id]["status"] = fresh ? "ok" : "not_found";
    if (!fresh) items[SENSORS[i].id]["error"] = "Sensor tidak menjawab";
  }
  publishJson("ack", ack, false, 1);
  if (changed) publishState();
}

// ─────────────────────────── COMMAND ───────────────────────────
bool alreadyExecuted(const String &id) { for (int i = 0; i < EXECUTED_IDS; i++) if (executed[i] == id) return true; return false; }
void rememberExecuted(const String &id) {
  executed[executedNext] = id; executedNext = (executedNext + 1) % EXECUTED_IDS;
  String all; for (int i = 0; i < EXECUTED_IDS; i++) if (executed[i].length()) { all += executed[i]; all += ','; }
  nvs.putString("executed", all);
}
void loadExecuted() {
  String all = nvs.getString("executed", ""); int start = 0;
  while (start < (int)all.length() && executedNext < EXECUTED_IDS) {
    int comma = all.indexOf(',', start); if (comma < 0) break;
    executed[executedNext++] = all.substring(start, comma); start = comma + 1;
  }
  executedNext %= EXECUTED_IDS;
}

void ackCommand(const String &id, int i, const char *status, const char *reason) {
  rememberExecuted(id);
  JsonDocument ack;
  ack["type"] = "command"; ack["id"] = id; ack["status"] = status;
  if (reason) ack["reason"] = reason; else ack["reason"] = nullptr;
  if (i >= 0) { ack["state"] = relays[i].on ? "on" : "off"; if (relays[i].on) ack["offAt"] = epochMs() + (uint64_t)(relays[i].offAtMillis - millis()); }
  publishJson("ack", ack, false, 1);
  if (i >= 0) publishState(i);
}

void handleCommand(const String &payload) {
  JsonDocument doc;
  if (deserializeJson(doc, payload)) return;
  String id = doc["id"] | "";
  if (!id.length() || alreadyExecuted(id)) return;              // 1. duplikat (redelivery QoS1)
  if (!clockSynced()) return ackCommand(id, -1, "rejected", "no_clock");
  uint64_t expiresAt = doc["expiresAt"] | 0ULL;
  if (!expiresAt || epochMs() > expiresAt) return ackCommand(id, -1, "expired", "expired");
  int i = actuatorIndex(doc["actuator"] | "");
  if (i < 0) return ackCommand(id, -1, "rejected", "unknown_actuator");
  String action = doc["action"] | "";
  bool automated = cfg[i].mode != 'm';
  if (action == "estop") { setRelay(i, false, "estop"); relays[i].hold = true; return ackCommand(id, i, "success", nullptr); }
  if (action == "off") { setRelay(i, false, "manual"); if (automated) pauseEngine(i); return ackCommand(id, i, "success", nullptr); }
  if (action == "on") {
    uint32_t minInterval = (cfg[i].present ? cfg[i].minIntervalSec : ACTUATORS[i].minIntervalSec) * 1000UL;
    if (!relays[i].on && relays[i].lastOnMillis && millis() - relays[i].lastOnMillis < minInterval) return ackCommand(id, i, "rejected", "interval");
    relays[i].hold = false;
    setRelay(i, true, "manual", doc["durationSec"] | 1);
    relays[i].override_ = automated;                            // override sementara jadwal/otomatis
    return ackCommand(id, i, "success", nullptr);
  }
  ackCommand(id, i, "rejected", "invalid_action");
}

// ─────────────────────────── ENGINE LOKAL (jalan walau offline) ───────────────────────────
bool readingFor(const char *sensor, const char *metric, float &out) {
  int s = sensorIndex(sensor), m = metricIndex(metric);
  if (s < 0 || m < 0 || !lastReadMillis[s] || millis() - lastReadMillis[s] > SENSOR_STALE_MS || isnan(lastValues[s][m])) return false;
  out = lastValues[s][m]; return true;
}

void runSchedules(int i) {
  if (!clockSynced()) return;
  LocalClock c = localClock();
  Relay &r = relays[i];
  for (int k = 0; k < cfg[i].nSchedules; k++) {
    Schedule &s = cfg[i].schedules[k];
    if (!(s.daysMask & (1 << c.day))) continue;
    if (s.at) {
      if (c.minute != s.atMinute || (r.firedDay[k] == c.date && r.firedMinute[k] == c.minute)) continue;
      r.firedDay[k] = c.date; r.firedMinute[k] = c.minute;
      if (!r.on) { setRelay(i, true, "timer", s.onSec, "schedule", s.id); publishState(i); }
    } else if (inWindow(s, c.minute)) {
      uint64_t now = epochMs();
      if (!r.nextEveryMs[k]) r.nextEveryMs[k] = now;
      if (now >= r.nextEveryMs[k] && !r.on) {
        setRelay(i, true, "timer", s.onSec, "schedule", s.id);
        r.nextEveryMs[k] = now + (uint64_t)s.intervalSec * 1000ULL;
        publishState(i);
      }
    }
  }
}

void runRules(int i) {
  Relay &r = relays[i];
  if (r.on && r.source == "auto") {
    for (int k = 0; k < cfg[i].nRules; k++) {
      Rule &x = cfg[i].rules[k];
      if (r.triggerId != x.id) continue;
      float value;
      if (!readingFor(x.sensor, x.metric, value)) { setRelay(i, false, "protection"); publishState(i); return; }
      if (!x.stopDuration && (x.below ? value >= x.stopValue : value <= x.stopValue)) { pauseEngine(i); setRelay(i, false, "auto"); publishState(i); }
      return;
    }
    setRelay(i, false, "protection"); publishState(i);           // aturan pemicu sudah dihapus
    return;
  }
  if (r.on || (int32_t)(millis() - r.resumeAtMillis) < 0) return;
  for (int k = 0; k < cfg[i].nRules; k++) {
    Rule &x = cfg[i].rules[k];
    float value;
    if (!readingFor(x.sensor, x.metric, value)) continue;
    if (x.below ? value < x.threshold : value > x.threshold) {
      setRelay(i, true, "auto", x.stopDuration ? x.onSec : maxRunOf(i), "rule", x.id);
      publishState(i);
      return;
    }
  }
}

void tick() {
  for (int i = 0; i < ACTUATOR_COUNT; i++) {
    Relay &r = relays[i];
    if (r.on && (int32_t)(millis() - r.offAtMillis) >= 0) {     // durasi habis / batas maxRunSec
      if (r.source == "auto") pauseEngine(i);
      setRelay(i, false, r.source); publishState(i);
    }
    if (!cfg[i].present || cfg[i].mode == 'm' || r.hold || r.override_) continue;
    if (cfg[i].mode == 't') runSchedules(i);
    else if (cfg[i].mode == 'a') runRules(i);
  }
}

// ─────────────────────────── KONEKSI ───────────────────────────
void onMessage(String &topic, String &payload) {
  // Antrean penuh → pesan dibuang. cmd akan kedaluwarsa (dashboard menampilkan gagal); config retained
  // dikirim ulang saat reconnect / saat status melaporkan configVersion lama.
  if (queueCount >= QUEUE_SIZE) return;
  int slot = (queueHead + queueCount) % QUEUE_SIZE;
  inTopic[slot] = topic; inPayload[slot] = payload; queueCount++;
}

void processQueue() {
  while (queueCount) {
    String topic = inTopic[queueHead], payload = inPayload[queueHead];
    queueHead = (queueHead + 1) % QUEUE_SIZE; queueCount--;
    if (topic == topicOf("cmd")) handleCommand(payload);
    else if (topic == topicOf("config")) handleConfig(payload);
  }
}

void connectMqtt() {
  if (WiFi.status() != WL_CONNECTED || millis() - lastReconnect < reconnectDelay) return;
  if (creds.tls && !clockSynced()) return;                      // TLS memeriksa masa berlaku sertifikat → tunggu SNTP
  lastReconnect = millis();
  mqtt.setWill(topicOf("status").c_str(), "{\"online\":false}", true, 1);
  if (mqtt.connect(creds.hwUid.c_str(), creds.hwUid.c_str(), creds.deviceSecret.c_str())) {
    reconnectDelay = 1000;
    mqtt.subscribe(topicOf("cmd"), 1);
    mqtt.subscribe(topicOf("config"), 1);
    publishRegister();
    publishStatus();
    publishState();
    sampleAndPublishTelemetry();
    lastHeartbeat = lastTelemetry = millis();
  } else {
    // err negatif = gagal jaringan/TLS (host, port 8883, firewall, CA); rc 4/5 = hwUid/secret ditolak broker.
    Serial.printf("[mqtt] gagal tersambung ke %s:%d (err %d, rc %d)\n", creds.mqttHost.c_str(), creds.mqttPort, mqtt.lastError(), mqtt.returnCode());
    reconnectDelay = min<uint32_t>(reconnectDelay * 2, 30000) + random(0, 1000);   // backoff + jitter
  }
}

// ─────────────────────────── SETUP PORTAL (kredensial per unit) ───────────────────────────
bool loadCredentials() {
  Preferences p; p.begin("tdr-creds", true);
  creds.wifiSsid = p.getString("ssid", ""); creds.wifiPassword = p.getString("pass", "");
  creds.hwUid = p.getString("hwUid", ""); creds.deviceSecret = p.getString("secret", "");
  creds.mqttHost = p.getString("host", DEFAULT_MQTT_HOST); creds.mqttPort = p.getInt("port", DEFAULT_MQTT_PORT); creds.tls = p.getBool("tls", DEFAULT_MQTT_TLS);
  p.end();
  return creds.wifiSsid.length() && creds.hwUid.length() && creds.deviceSecret.length() && creds.mqttHost.length();
}

String htmlEscape(const String &value) { String out = value; out.replace("&", "&amp;"); out.replace("\"", "&quot;"); out.replace("<", "&lt;"); return out; }

void runSetupPortal() {
  String apName = "Tandurai-Setup-" + String((uint32_t)ESP.getEfuseMac(), HEX).substring(0, 4);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(apName.c_str());
  WebServer server(80);
  server.on("/", HTTP_GET, [&]() {
    String page = F("<!doctype html><meta name=viewport content='width=device-width'><title>Setup Tandurai</title>"
      "<style>body{font-family:sans-serif;max-width:420px;margin:24px auto;padding:0 12px}label{display:block;margin-top:10px}input{width:100%;padding:8px}</style>"
      "<h2>Setup Gateway Tandurai</h2><form method=post action=/save>");
    page += "<label>Wi-Fi SSID<input name=ssid required value=\"" + htmlEscape(creds.wifiSsid) + "\"></label>";
    page += F("<label>Wi-Fi password<input name=pass type=password></label>");
    page += "<label>hwUid<input name=hwUid required value=\"" + htmlEscape(creds.hwUid) + "\"></label>";
    page += F("<label>Device secret<input name=secret type=password required></label>");
    page += "<label>Broker host<input name=host required value=\"" + htmlEscape(creds.mqttHost) + "\"></label>";
    page += "<label>Broker port<input name=port type=number value=\"" + String(creds.mqttPort) + "\"></label>";
    page += String("<label><input name=tls type=checkbox style=width:auto") + (creds.tls ? " checked" : "") + "> TLS</label>";
    page += String(F("<p><small>Produksi: ")) + DEFAULT_MQTT_HOST + ", port " + DEFAULT_MQTT_PORT + F(", TLS dicentang.</small></p>");
    page += F("<p><button type=submit>Simpan &amp; restart</button></p></form>");
    server.send(200, "text/html", page);
  });
  server.on("/save", HTTP_POST, [&]() {
    Preferences p; p.begin("tdr-creds", false);
    p.putString("ssid", server.arg("ssid")); p.putString("pass", server.arg("pass"));
    p.putString("hwUid", server.arg("hwUid")); p.putString("secret", server.arg("secret"));
    bool tls = server.hasArg("tls");
    p.putString("host", server.arg("host")); p.putInt("port", server.arg("port").toInt() > 0 ? server.arg("port").toInt() : (tls ? 8883 : 1883));
    p.putBool("tls", tls);
    p.end();
    server.send(200, "text/html", "<p>Tersimpan. Gateway restart...</p>");
    delay(1500);
    ESP.restart();
  });
  server.begin();
  Serial.printf("[setup] buka Wi-Fi %s lalu http://192.168.4.1\n", apName.c_str());
  for (;;) { server.handleClient(); delay(5); }   // relay tetap OFF selama setup
}

bool setupButtonHeld() {
  pinMode(SETUP_BUTTON_PIN, INPUT_PULLUP);
  uint32_t start = millis();
  while (digitalRead(SETUP_BUTTON_PIN) == LOW) { if (millis() - start > 3000) return true; delay(10); }
  return false;
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < ACTUATOR_COUNT; i++) {                    // relay OFF saat boot (safe state)
    pinMode(ACTUATORS[i].pin, OUTPUT); writePin(i, false);
    for (int k = 0; k < MAX_SCHEDULES; k++) { relays[i].nextEveryMs[k] = 0; relays[i].firedDay[k] = -1; relays[i].firedMinute[k] = -1; }
  }
  for (int i = 0; i < SENSOR_COUNT; i++) { lastReadMillis[i] = 0; for (int k = 0; k < METRIC_COUNT; k++) lastValues[i][k] = NAN; }
  for (int i = 0; i < ACTUATOR_COUNT; i++) { cfg[i] = ActuatorCfg(); cfg[i].mode = 'm'; }
  if (!loadCredentials() || setupButtonHeld()) runSetupPortal();   // belum diisi / tombol BOOT ditahan
  nvs.begin("tandurai", false);
  loadExecuted();
  loadConfigFromNvs();                                          // jadwal/aturan tetap jalan tanpa internet

  WiFi.mode(WIFI_STA);
  WiFi.begin(creds.wifiSsid.c_str(), creds.wifiPassword.c_str());
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  if (creds.tls) {
#ifdef TANDURAI_ALLOW_INSECURE_TLS
    secureNet.setInsecure();                                    // HANYA untuk uji: sertifikat server tidak diverifikasi
#else
    secureNet.setCACert(TANDURAI_CA_CERT);                      // verifikasi rantai + nama host mqtt.tandurai.id
#endif
    mqtt.begin(creds.mqttHost.c_str(), creds.mqttPort, secureNet);
  } else {
    mqtt.begin(creds.mqttHost.c_str(), creds.mqttPort, plainNet);
  }
  mqtt.setCleanSession(false);
  mqtt.setKeepAlive(20);
  mqtt.onMessage(onMessage);
}

void loop() {
  mqtt.loop();
  if (!mqtt.connected()) connectMqtt();
  processQueue();
  uint32_t now = millis();
  if (now - lastTick >= 1000) { lastTick = now; tick(); }
  if (now - lastTelemetry >= (uint32_t)telemetryIntervalSec * 1000UL) { lastTelemetry = now; sampleAndPublishTelemetry(); }
  if (mqtt.connected() && now - lastHeartbeat >= HEARTBEAT_MS) { lastHeartbeat = now; publishStatus(); }
}
