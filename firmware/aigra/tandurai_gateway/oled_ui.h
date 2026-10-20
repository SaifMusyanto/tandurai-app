// oled_ui.h - Tampilan OLED 1.3" (SH1106) + tombol BOOT untuk ganti slide.
// Slide dari sensor_oled.ino, ditambah slide status gateway Tandurai (Wi-Fi, MQTT, relay).
#pragma once
#include <U8g2lib.h>
#include <Wire.h>
#include "hardware.h"
#include "lora_sensor.h"
#include "rs485_sensor.h"

namespace ui {

// OLED 1.3" biasanya chip SH1106. Jika tampilan bergeser/berantakan,
// ganti baris ini dengan: U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE, PIN_SCL, PIN_SDA);
U8G2_SH1106_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE, PIN_SCL, PIN_SDA);

const int MAX_RELAYS = 4;
struct GatewayView {
  bool wifi, mqtt, clock;
  const char *hwUid;
  uint8_t relayCount;
  const char *relayLabel[MAX_RELAYS];
  bool relayOn[MAX_RELAYS];
};

uint8_t slide = 0;

void begin() {
  oled.setBusClock(400000);
  oled.begin();
  pinMode(PIN_BUTTON, INPUT_PULLUP);
}

void message(const char* l1, const char* l2, const char* l3 = nullptr) {
  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tf);
  oled.drawStr(0, 20, l1);
  oled.drawStr(0, 36, l2);
  if (l3) oled.drawStr(0, 52, l3);
  oled.sendBuffer();
}

void drawHeader(const char* title) {
  // Judul terbalik (teks gelap di kotak terang)
  oled.setFont(u8g2_font_6x10_tf);
  oled.drawBox(0, 0, 128, 11);
  oled.setDrawColor(0);
  oled.drawStr((128 - oled.getStrWidth(title)) / 2, 9, title);
  oled.setDrawColor(1);
}

void drawDataSlide() {
  const lora::Live &live = lora::live;
  char co2[12], t[10], h[10], p[12], line[24];
  if (!live.hasCo2) strcpy(co2, "--");
  else if (live.co2Err) strcpy(co2, "ERR");
  else snprintf(co2, sizeof co2, "%u", live.co2);
  if (!live.hasTemp) strcpy(t, "--");
  else if (live.tempErr) strcpy(t, "ERR");
  else snprintf(t, sizeof t, "%.1f", live.temp);
  if (!live.hasHum) strcpy(h, "--");
  else if (live.humErr) strcpy(h, "ERR");
  else snprintf(h, sizeof h, "%.1f", live.hum);
  if (!live.hasPress) strcpy(p, "--");
  else if (live.pressErr) strcpy(p, "ERR");
  else snprintf(p, sizeof p, "%.1f", live.press);

  drawHeader("Source : LoRaWAN");
  oled.setFont(u8g2_font_7x13_tf);          // font lebar tetap, titik dua sejajar
  snprintf(line, sizeof line, "CO2  : %s ppm", co2);  oled.drawStr(0, 24, line);
  snprintf(line, sizeof line, "Suhu : %s C", t);      oled.drawStr(0, 37, line);
  snprintf(line, sizeof line, "Humy : %s %%RH", h);   oled.drawStr(0, 50, line);
  snprintf(line, sizeof line, "Tek  : %s hPa", p);    oled.drawStr(0, 63, line);
}

void drawRs485Slide() {
  const rs485::State &rs = rs485::rs;
  char line[24];
  drawHeader("Source : RS485");
  oled.setFont(u8g2_font_7x13_tf);
  snprintf(line, sizeof line, "O2   : %.1f %%VOL", rs.o2);  oled.drawStr(0, 24, line);
  snprintf(line, sizeof line, "Suhu : %.1f C", rs.temp);    oled.drawStr(0, 37, line);
  snprintf(line, sizeof line, "Humy : %.1f %%RH", rs.hum);  oled.drawStr(0, 50, line);
}

void fmtAgo(char* out, size_t n, uint32_t ms) {
  uint32_t s = ms / 1000;
  if (s < 60) snprintf(out, n, "%lu dtk lalu", (unsigned long)s);
  else if (s < 3600) snprintf(out, n, "%lu mnt lalu", (unsigned long)(s / 60));
  else snprintf(out, n, "%lu jam lalu", (unsigned long)(s / 3600));
}

void drawStatusSlide() {
  const lora::Link &linkStat = lora::linkStat;
  char line[28], ago[16];
  drawHeader(lora::connected() ? "STATUS: CONNECTED" : "STATUS: DISCONNECT");

  if (lora::state == lora::NO_KEYS) {
    oled.drawStr(0, 30, "LoRa nonaktif:");
    oled.drawStr(0, 44, "isi kunci di setup");
    return;
  }
  if (lora::state == lora::NO_RADIO) {
    oled.drawStr(0, 30, "ERROR LoRa:");
    oled.drawStr(0, 44, "cek wiring SX1276");
    return;
  }
  if (!linkStat.seen) {
    oled.drawStr(0, 30, "Belum ada data");
    oled.drawStr(0, 44, "dari sensor...");
    snprintf(line, sizeof line, "%.1fMHz SF%d", LORA_FREQ_MHZ, LORA_SF);
    oled.drawStr(0, 60, line);
    return;
  }

  snprintf(line, sizeof line, "RSSI %.0fdBm SNR %.1f", linkStat.rssi, linkStat.snr);
  oled.drawStr(0, 22, line);
  snprintf(line, sizeof line, "Sinyal : %s", lora::signalQuality(linkStat.snr));
  oled.drawStr(0, 33, line);
  float d = lora::estimateDistance(linkStat.rssiAvg);
  if (d < 1000) snprintf(line, sizeof line, "Jarak  : ~%.0f m", d);
  else snprintf(line, sizeof line, "Jarak  : ~%.1f km", d / 1000.0f);
  oled.drawStr(0, 44, line);
  fmtAgo(ago, sizeof ago, millis() - linkStat.lastMs);
  snprintf(line, sizeof line, "Update : %s", ago);
  oled.drawStr(0, 55, line);
  uint32_t total = linkStat.rxCount + linkStat.lostCount;
  snprintf(line, sizeof line, "Paket:%lu Hilang:%lu %lu%%", (unsigned long)linkStat.rxCount,
           (unsigned long)linkStat.lostCount, (unsigned long)(total ? linkStat.rxCount * 100 / total : 100));
  oled.drawStr(0, 64, line);
}

void drawGatewaySlide(const GatewayView &v) {
  char line[28];
  drawHeader("GATEWAY TANDURAI");
  snprintf(line, sizeof line, "WiFi : %s", v.wifi ? "terhubung" : "putus");
  oled.drawStr(0, 22, line);
  snprintf(line, sizeof line, "MQTT : %s", v.mqtt ? "terhubung" : (v.wifi && !v.clock) ? "tunggu jam" : "putus");
  oled.drawStr(0, 33, line);
  oled.drawStr(0, 44, v.hwUid);
  line[0] = 0;
  for (int i = 0; i < v.relayCount; i++) {
    size_t used = strlen(line);
    snprintf(line + used, sizeof line - used, "%s%s:%s", i ? " " : "", v.relayLabel[i], v.relayOn[i] ? "ON" : "--");
  }
  oled.drawStr(0, 58, line);
}

void update(const GatewayView &view) {
  static uint32_t lastDraw = 0, lastSlide = 0;
  static bool btnPrev = true;

  // Daftar slide aktif: LoRaWAN, RS485 (hanya jika terdeteksi), status LoRa, gateway
  enum { SL_LORA, SL_RS485, SL_STATUS, SL_GATEWAY };
  uint8_t list[4], n = 0;
  if (USE_LORA) list[n++] = SL_LORA;
  if (rs485::rs.detected) list[n++] = SL_RS485;
  if (USE_LORA) list[n++] = SL_STATUS;
  list[n++] = SL_GATEWAY;
  if (slide >= n) slide = 0;

  // Tombol BOOT: ganti slide langsung
  bool btn = digitalRead(PIN_BUTTON);
  if (btnPrev && !btn) { slide = (slide + 1) % n; lastSlide = millis(); lastDraw = 0; }
  btnPrev = btn;

  if (millis() - lastSlide >= SLIDE_INTERVAL_S * 1000UL) {
    slide = (slide + 1) % n; lastSlide = millis(); lastDraw = 0;
  }
  if (lastDraw && millis() - lastDraw < 1000) return;   // perbarui tiap 1 detik
  lastDraw = millis();

  oled.clearBuffer();
  switch (list[slide]) {
    case SL_LORA:    drawDataSlide();         break;
    case SL_RS485:   drawRs485Slide();        break;
    case SL_STATUS:  drawStatusSlide();       break;
    default:         drawGatewaySlide(view);  break;
  }
  oled.sendBuffer();
}

}  // namespace ui
