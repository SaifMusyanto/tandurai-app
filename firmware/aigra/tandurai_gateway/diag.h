// diag.h - Watchdog, alasan restart, penghitung putus Wi-Fi/MQTT, dan konfirmasi firmware hasil OTA.
// File ini identik di semua sketch gateway Tandurai (firmware/*/).
#pragma once
#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>
#include <esp_system.h>
#include <esp_ota_ops.h>

// Firmware hasil OTA baru "dikonfirmasi" setelah terbukti sehat (lihat diag::track). Bila restart
// sebelum itu (crash, watchdog, gagal konek), bootloader kembali ke firmware sebelumnya.
extern "C" bool verifyRollbackLater() { return true; }

namespace diag {

// Lebih lama dari blok terlama di loop: DNS + connect 10 dtk + handshake TLS 10 dtk (lihat setup()).
const uint32_t WATCHDOG_MS = 60000;
// Firmware baru dianggap sehat setelah MQTT tersambung, atau setelah 10 menit jalan tanpa restart
// (supaya Wi-Fi lokasi yang mati lama tidak memicu rollback).
const uint32_t STABLE_MS = 600000;

uint32_t wifiDrops = 0, mqttDrops = 0;
volatile uint8_t lastWifiReason = 0;   // kode esp_wifi (mis. 2 auth expire, 15 4-way handshake, 200 beacon timeout, 201 no AP)
bool firmwareConfirmed = false;

const char *resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:   return "power_on";
    case ESP_RST_EXT:       return "external";
    case ESP_RST_SW:        return "software";
    case ESP_RST_PANIC:     return "panic";
    case ESP_RST_INT_WDT:   return "int_wdt";
    case ESP_RST_TASK_WDT:  return "task_wdt";
    case ESP_RST_WDT:       return "wdt";
    case ESP_RST_BROWNOUT:  return "brownout";
    case ESP_RST_DEEPSLEEP: return "deepsleep";
    default:                return "unknown";
  }
}

void onWifiDisconnected(arduino_event_id_t, arduino_event_info_t info) { lastWifiReason = info.wifi_sta_disconnected.reason; }

// Dipanggil setelah halaman setup (yang berjalan tanpa batas waktu) dilewati.
void begin() {
  esp_task_wdt_config_t config = { WATCHDOG_MS, 1, true };   // idle task CPU0 tetap dipantau seperti bawaan core
  esp_task_wdt_reconfigure(&config);
  esp_task_wdt_add(NULL);                                     // task loop(): macet > WATCHDOG_MS → restart, relay OFF
  WiFi.onEvent(onWifiDisconnected, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  Serial.printf("[diag] restart terakhir: %s\n", resetReason());
}

void feed() { esp_task_wdt_reset(); }

// Dipanggil tiap loop(): catat transisi putus dan konfirmasi firmware.
void track(bool wifiUp, bool mqttUp, int mqttError) {
  static bool wifiWas = false, mqttWas = false;
  if (wifiWas && !wifiUp) { wifiDrops++; Serial.printf("[wifi] putus (alasan %u)\n", lastWifiReason); }
  if (mqttWas && !mqttUp) { mqttDrops++; Serial.printf("[mqtt] putus (err %d)\n", mqttError); }
  wifiWas = wifiUp; mqttWas = mqttUp;
  if (!firmwareConfirmed && (mqttUp || millis() > STABLE_MS)) {
    firmwareConfirmed = true;
    esp_ota_mark_app_valid_cancel_rollback();
  }
}

// Isi objek "diag" pada pesan status.
void fill(JsonObject d) {
  d["resetReason"] = resetReason();
  d["wifiDrops"] = wifiDrops;
  d["mqttDrops"] = mqttDrops;
  d["wifiReason"] = lastWifiReason;
  d["freeHeap"] = ESP.getFreeHeap();
  d["minFreeHeap"] = ESP.getMinFreeHeap();
}

}  // namespace diag
