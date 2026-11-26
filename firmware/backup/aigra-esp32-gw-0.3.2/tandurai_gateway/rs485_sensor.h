// rs485_sensor.h - Sensor RS-O2WS-N01 (O₂, suhu, kelembapan) lewat RS485 Modbus RTU.
// Diambil dari sensor_oled.ino.
#pragma once
#include "hardware.h"

namespace rs485 {

struct State {
  bool detected; uint8_t fails;
  float o2, temp, hum;
  uint32_t lastOkMs;
} rs = {};

uint16_t modbusCrc(const uint8_t* b, size_t n) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < n; i++) {
    crc ^= b[i];
    for (int k = 0; k < 8; k++) crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
  }
  return crc;
}

// Baca 'count' holding register (fungsi 0x03). Hasil di 'out'. true jika berhasil.
bool modbusRead(uint8_t addr, uint16_t start, uint16_t count, uint16_t* out) {
  uint8_t req[8] = {addr, 0x03, (uint8_t)(start >> 8), (uint8_t)start,
                    (uint8_t)(count >> 8), (uint8_t)count, 0, 0};
  uint16_t crc = modbusCrc(req, 6);
  req[6] = crc & 0xFF; req[7] = crc >> 8;

  while (Serial2.available()) Serial2.read();          // buang sisa data lama
  if (PIN_RS485_DE >= 0) { digitalWrite(PIN_RS485_DE, HIGH); delayMicroseconds(200); }
  Serial2.write(req, 8);
  Serial2.flush();                                     // tunggu semua byte terkirim
  if (PIN_RS485_DE >= 0) { delayMicroseconds(200); digitalWrite(PIN_RS485_DE, LOW); }

  size_t want = 5 + 2 * count, got = 0;
  uint8_t resp[32];
  uint32_t t0 = millis();
  while (got < want && millis() - t0 < 300) {
    if (Serial2.available()) resp[got++] = Serial2.read();
  }
  if (got < want) return false;
  if (resp[0] != addr || resp[1] != 0x03 || resp[2] != 2 * count) return false;
  crc = modbusCrc(resp, want - 2);
  if (resp[want - 2] != (crc & 0xFF) || resp[want - 1] != (crc >> 8)) return false;
  for (uint16_t i = 0; i < count; i++) out[i] = (resp[3 + 2 * i] << 8) | resp[4 + 2 * i];
  return true;
}

void begin() {
  if (!USE_RS485) return;
  if (PIN_RS485_DE >= 0) { pinMode(PIN_RS485_DE, OUTPUT); digitalWrite(PIN_RS485_DE, LOW); }
  Serial2.begin(RS485_BAUD, SERIAL_8N1, PIN_RS485_RX, PIN_RS485_TX);
}

void poll() {
  if (!USE_RS485) return;
  static uint32_t lastPoll = 0, lastPrint = 0;
  if (millis() - lastPoll < RS485_POLL_S * 1000UL) return;
  lastPoll = millis();

  uint16_t r[3];
  if (modbusRead(RS485_ADDR, 0x0000, 3, r)) {
    rs.hum  = r[0] / 10.0f;
    rs.temp = (int16_t)r[1] / 10.0f;
    rs.o2   = r[2] / 10.0f;
    rs.fails = 0;
    rs.lastOkMs = millis();
    if (!rs.detected) {
      rs.detected = true;
      lastPrint = 0;
      Serial.println(">>> Sensor RS485 terdeteksi");
    }
    if (lastPrint == 0 || millis() - lastPrint >= RS485_PRINT_S * 1000UL) {
      lastPrint = millis();
      Serial.println("----------------------------------------");
      Serial.println("Source: RS485");
      Serial.printf("  %-12s: %.1f %%VOL\n", "O2", rs.o2);
      Serial.printf("  %-12s: %.1f C\n", "Suhu", rs.temp);
      Serial.printf("  %-12s: %.1f %%RH\n", "Kelembapan", rs.hum);
    }
  } else if (rs.detected && ++rs.fails >= RS485_LOST_FAILS) {
    rs.detected = false;
    Serial.println(">>> Sensor RS485 tidak merespons (cek kabel / daya 12V)");
  } else if (!rs.detected && (lastPrint == 0 || millis() - lastPrint >= RS485_PRINT_S * 1000UL)) {
    lastPrint = millis();
    Serial.println(">>> Sensor RS485 belum terdeteksi (cek kabel A/B, daya 12V, baud & alamat Modbus)");
  }
}

// Ambil suhu, kelembapan, CO₂ (urut SENSOR_METRICS). Sensor ini tidak punya CO₂ → NAN.
bool takeReading(float v[3]) {
  if (!rs.detected || millis() - rs.lastOkMs > RS485_POLL_S * 2000UL + 1000UL) return false;
  v[0] = rs.temp;
  v[1] = rs.hum;
  return true;
}

}  // namespace rs485
