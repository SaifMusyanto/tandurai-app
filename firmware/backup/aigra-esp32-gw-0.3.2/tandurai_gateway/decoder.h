// decoder.h - Decoder payload ZYD-M500CO2 (sesuai Bab 7 user manual)
#pragma once
#include <stdint.h>
#include <string.h>
#include <stddef.h>
#include <stdio.h>

struct SensorData {
  bool hasBattery;   uint8_t battery;        // %
  bool hasTemp;      bool tempErr;  float temperature;   // °C
  bool hasHum;       bool humErr;   float humidity;      // %RH
  bool hasCo2;       bool co2Err;   uint16_t co2;        // ppm
  bool hasPress;     bool pressErr; float pressure;      // hPa
  bool basicInfo;    bool powerOn;  char serial[17];
  uint8_t hwMajor, hwMinor, swMajor, swMinor;
  bool mutationAlarm; float mutTemp, mutDelta;
  int historyCount;
  struct History { uint32_t ts; uint16_t co2; float pressure, temperature, humidity;
                   bool co2Err, pressErr, tempErr, humErr; } history[4];
  bool unknown; uint8_t unknownCh, unknownType;
};

static inline uint16_t le16(const uint8_t* b) { return (uint16_t)(b[0] | (b[1] << 8)); }

// Mengembalikan true jika seluruh payload berhasil di-decode.
// Jika ada channel tidak dikenal, field yang sudah terbaca tetap terisi.
static bool decodePayload(const uint8_t* b, size_t n, SensorData& d) {
  memset(&d, 0, sizeof(d));
  size_t i = 0;
  while (i + 2 <= n) {
    uint8_t ch = b[i], ty = b[i + 1];
    i += 2;
    size_t need = 0;
    if (ch == 0xFF) {
      switch (ty) {
        case 0x0B: need = 1; break;
        case 0x01: need = 1; break;
        case 0x16: need = 8; break;
        case 0x09: need = 2; break;
        case 0x0A: need = 2; break;
        case 0x0F: need = 1; break;
        default: d.unknown = true; d.unknownCh = ch; d.unknownType = ty; return false;
      }
      if (i + need > n) return false;
      d.basicInfo = true;
      if (ty == 0x0B) d.powerOn = true;
      if (ty == 0x16) { for (int k = 0; k < 8; k++) snprintf(d.serial + k * 2, 3, "%02x", b[i + k]); }
      if (ty == 0x09) { d.hwMajor = b[i]; d.hwMinor = b[i + 1] >> 4; }
      if (ty == 0x0A) { d.swMajor = b[i]; d.swMinor = b[i + 1]; }
      i += need;
    } else if (ch == 0x01 && ty == 0x75) {
      if (i + 1 > n) return false;
      d.hasBattery = true; d.battery = b[i]; i += 1;
    } else if (ch == 0x03 && ty == 0x67) {
      if (i + 2 > n) return false;
      uint16_t raw = le16(b + i); i += 2;
      d.hasTemp = true; d.tempErr = (raw == 0xFFFF);
      d.temperature = (int16_t)raw / 10.0f;
    } else if (ch == 0x04 && ty == 0x68) {
      if (i + 1 > n) return false;
      d.hasHum = true; d.humErr = (b[i] == 0xFF); d.humidity = b[i] / 2.0f; i += 1;
    } else if (ch == 0x05 && ty == 0x7D) {
      if (i + 2 > n) return false;
      uint16_t raw = le16(b + i); i += 2;
      d.hasCo2 = true; d.co2Err = (raw == 0xFFFF); d.co2 = raw;
    } else if (ch == 0x06 && ty == 0x73) {
      if (i + 2 > n) return false;
      uint16_t raw = le16(b + i); i += 2;
      d.hasPress = true; d.pressErr = (raw == 0xFFFF); d.pressure = raw / 10.0f;
    } else if (ch == 0x83 && ty == 0xD7) {
      if (i + 5 > n) return false;
      d.mutationAlarm = true;
      d.mutTemp  = (int16_t)le16(b + i) / 10.0f;
      d.mutDelta = (int16_t)le16(b + i + 2) / 10.0f;
      i += 5;
    } else if (ch == 0x20 && ty == 0xCE) {
      if (i + 11 > n) return false;
      if (d.historyCount < 4) {
        SensorData::History& h = d.history[d.historyCount++];
        h.ts = (uint32_t)b[i] | ((uint32_t)b[i+1] << 8) | ((uint32_t)b[i+2] << 16) | ((uint32_t)b[i+3] << 24);
        uint16_t c = le16(b + i + 4), p = le16(b + i + 6), t = le16(b + i + 8);
        h.co2 = c;              h.co2Err = (c == 0xFFFF);
        h.pressure = p / 10.0f; h.pressErr = (p == 0xFFFF);
        h.temperature = (int16_t)t / 10.0f; h.tempErr = (t == 0xFFFF);
        h.humidity = b[i + 10] / 2.0f;      h.humErr = (b[i + 10] == 0xFF);
      }
      i += 11;
    } else {
      d.unknown = true; d.unknownCh = ch; d.unknownType = ty;
      return false;
    }
  }
  return i == n;
}
