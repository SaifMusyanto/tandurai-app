// lora_sensor.h - Penerima sensor ZYD-M500CO2 (LoRaWAN ABP, single-channel) lewat SX1276.
// Diambil dari sensor_oled.ino. Bedanya: kunci ABP dibaca dari NVS (halaman setup), dan error
// radio/kunci tidak menghentikan program (relay & MQTT harus tetap jalan).
#pragma once
#include <RadioLib.h>
#include <SPI.h>
#include "hardware.h"
#include "lorawan.h"
#include "decoder.h"

namespace lora {

enum State { NO_KEYS, NO_RADIO, READY };

SX1276 radio = new Module(PIN_NSS, PIN_DIO0, PIN_RST, PIN_DIO1);

// Data terakhir (digabung dari beberapa paket, mis. baterai dikirim terpisah)
struct Live {
  bool hasCo2, hasTemp, hasHum, hasPress, hasBatt;
  bool co2Err, tempErr, humErr, pressErr;
  uint16_t co2; float temp, hum, press; uint8_t batt;
  bool received; uint32_t lastRxMs;
} live = {};

// Statistik link (untuk uji jangkauan)
struct Link {
  bool seen; uint32_t lastMs;
  float rssi, snr, rssiAvg;
  uint32_t rxCount, lostCount;
} linkStat = {};

State state = NO_KEYS;
bool newData = false;            // ada suhu/kelembapan/CO₂ baru yang belum diambil takeReading()
uint32_t devAddr;
uint8_t nwkSKey[16], appSKey[16];
uint32_t lastFcnt = 0;
bool hasFcnt = false;
uint32_t packetCount = 0, radioResets = 0, spuriousIrq = 0;

volatile bool rxFlag = false;
void IRAM_ATTR onRx() { rxFlag = true; }

bool hexToBytes(const char* s, uint8_t* out, size_t n) {
  if (strlen(s) != n * 2) return false;
  for (size_t i = 0; i < n; i++) {
    char b[3] = {s[2 * i], s[2 * i + 1], 0};
    char* end;
    out[i] = (uint8_t)strtoul(b, &end, 16);
    if (*end) return false;
  }
  return true;
}

void printHex(const uint8_t* b, size_t n) {
  for (size_t i = 0; i < n; i++) Serial.printf("%02x", b[i]);
  Serial.println();
}

void printValue(const char* label, bool has, bool err, float v, int dec, const char* unit) {
  if (!has) return;
  Serial.printf("  %-12s: ", label);
  if (err) Serial.println("ERROR (sensor gagal membaca)");
  else Serial.printf("%.*f %s\n", dec, v, unit);
}

bool connected() {
  if (!linkStat.seen) return false;
  uint32_t timeoutMs = (uint32_t)MISSED_FOR_DISCONNECT * REPORT_INTERVAL_MIN * 60000UL + 20000UL;
  return millis() - linkStat.lastMs < timeoutMs;
}

const char* signalQuality(float snr) {
  // Batas demodulasi SF9 sekitar -12.5 dB, makin jauh di atasnya makin aman
  if (snr >= 0)    return "Sangat baik";
  if (snr >= -5)   return "Baik";
  if (snr >= -10)  return "Lemah";
  return "Kritis";
}

float estimateDistance(float rssi) {
  return REF_DIST_M * powf(10.0f, (RSSI_REF_DBM - rssi) / (10.0f * PATH_LOSS_N));
}

// ============================ Kesehatan radio ========================
// Lonjakan listrik saat relay ON/OFF bisa membuat SX1276 ter-reset sendiri.
// Setelah reset, semua settingnya kembali ke default (frekuensi, SF, mode)
// sehingga paket sensor tidak terdengar lagi. Fungsi di bawah mendeteksi
// hal itu dan menyetel ulang radio secara otomatis.
int initRadio() {
  int st = radio.begin(LORA_FREQ_MHZ, LORA_BW_KHZ, LORA_SF, 5,
                       RADIOLIB_SX127X_SYNC_WORD_LORAWAN, 10, 8, 0);
  if (st != RADIOLIB_ERR_NONE) return st;
  radio.setCRC(true);
  radio.invertIQ(false);
  radio.setPacketReceivedAction(onRx);
  return radio.startReceive();
}

uint8_t sxReadReg(uint8_t addr) {
  SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
  digitalWrite(PIN_NSS, LOW);
  SPI.transfer(addr & 0x7F);
  uint8_t v = SPI.transfer(0x00);
  digitalWrite(PIN_NSS, HIGH);
  SPI.endTransaction();
  return v;
}

bool radioHealthy() {
  if (sxReadReg(0x42) != 0x12) return false;          // RegVersion
  uint8_t op = sxReadReg(0x01);                        // RegOpMode
  return (op & 0x80) && ((op & 0x07) == 0x05);         // mode LoRa + RX continuous
}

void checkRadio(bool force) {
  if (state == NO_KEYS) return;
  static uint32_t lastCheck = 0;
  uint32_t every = state == READY ? 2000 : 30000;      // radio belum terdeteksi → coba lagi tiap 30 dtk
  if (!force && millis() - lastCheck < every) return;
  lastCheck = millis();
  if (state == READY && radioHealthy()) return;

  if (state == READY) Serial.println("[LORA] Radio terganggu (kemungkinan lonjakan listrik relay), setel ulang...");
  int st = initRadio();
  rxFlag = false;
  if (st == RADIOLIB_ERR_NONE) {
    if (state == READY) {
      radioResets++;
      Serial.printf("[LORA] Radio kembali normal (sudah %u kali disetel ulang)\n", (unsigned)radioResets);
    } else {
      Serial.println("[LORA] Radio SX1276 terdeteksi");
    }
    state = READY;
  } else {
    if (state == READY) Serial.printf("[LORA] Gagal setel ulang radio, kode %d\n", st);
    state = NO_RADIO;
  }
}

State begin(const String &devAddrHex, const String &nwkSKeyHex, const String &appSKeyHex) {
  if (!USE_LORA) { state = NO_KEYS; return state; }
  uint8_t a[4];
  if (!hexToBytes(devAddrHex.c_str(), a, 4) || !hexToBytes(nwkSKeyHex.c_str(), nwkSKey, 16) ||
      !hexToBytes(appSKeyHex.c_str(), appSKey, 16)) {
    Serial.println("[LORA] DevAddr/NwkSKey/AppSKey belum diisi atau format salah -> sensor LoRa nonaktif (isi di halaman setup)");
    state = NO_KEYS;
    return state;
  }
  devAddr = ((uint32_t)a[0] << 24) | ((uint32_t)a[1] << 16) | ((uint32_t)a[2] << 8) | a[3];

  int st = initRadio();
  if (st != RADIOLIB_ERR_NONE) {
    Serial.printf("[LORA] SX1276 tidak terdeteksi (kode %d). Cek wiring & daya 3.3V.\n", st);
    state = NO_RADIO;
    return state;
  }
  state = READY;
  Serial.printf("[LORA] %.1f MHz SF%d / %.0f kHz, DevAddr %08X\n", LORA_FREQ_MHZ, LORA_SF, LORA_BW_KHZ, (unsigned)devAddr);
  return state;
}

// Ambil suhu, kelembapan, CO₂ (urut SENSOR_METRICS) bila ada paket baru sejak pengambilan terakhir.
// Sensor hanya mengirim tiap REPORT_INTERVAL_MIN, jadi nilai lama tidak dikirim ulang sebagai data baru.
bool takeReading(float v[3]) {
  if (!newData) return false;
  newData = false;
  if (live.hasTemp && !live.tempErr) v[0] = live.temp;
  if (live.hasHum && !live.humErr) v[1] = live.hum;
  if (live.hasCo2 && !live.co2Err) v[2] = live.co2;
  return !isnan(v[0]) || !isnan(v[1]) || !isnan(v[2]);
}

void poll() {
  if (!USE_LORA) return;
  // Laporkan ke Serial saat status link berubah
  static bool prevConn = false;
  bool conn = connected();
  if (conn != prevConn) {
    if (!conn && linkStat.seen) Serial.println("[LORA] STATUS: DISCONNECTED (tidak ada data dari sensor)");
    prevConn = conn;
  }

  checkRadio(false);

  if (state != READY || !rxFlag) return;
  rxFlag = false;

  uint8_t buf[256];
  size_t len = radio.getPacketLength();
  if (len == 0) {
    // Interrupt palsu dari gangguan listrik, bukan paket sungguhan
    spuriousIrq++;
    Serial.printf("[LORA] Interrupt palsu diabaikan (total %u)\n", (unsigned)spuriousIrq);
    radio.startReceive();
    checkRadio(true);
    return;
  }
  if (len > sizeof(buf)) len = sizeof(buf);
  int st = radio.readData(buf, len);
  float rssi = radio.getRSSI();
  float snr = radio.getSNR();
  radio.startReceive();

  Serial.println("----------------------------------------");
  if (st == RADIOLIB_ERR_CRC_MISMATCH) { Serial.println("Paket rusak (CRC error), diabaikan."); return; }
  if (st != RADIOLIB_ERR_NONE) { Serial.printf("Gagal membaca paket, kode %d\n", st); return; }

  Serial.printf("Paket masuk: %u byte | RSSI %.0f dBm | SNR %.1f dB\n", (unsigned)len, rssi, snr);
  Serial.print("Raw        : "); printHex(buf, len);

  // 1. Parsing frame LoRaWAN
  lw::Uplink u;
  if (lw::parse(buf, len, u) != lw::PARSE_OK) {
    Serial.println("Bukan uplink LoRaWAN, diabaikan.");
    return;
  }
  if (u.devAddr != devAddr) {
    Serial.printf("DevAddr %08X bukan sensor ini, diabaikan.\n", (unsigned)u.devAddr);
    return;
  }
  if (u.confirmed) Serial.println("PERINGATAN: sensor memakai Confirmed Mode. Matikan di ToolBox.");

  // 2. Verifikasi MIC (memastikan paket asli & NwkSKey benar)
  uint32_t cand[2]; int nc = 0;
  uint32_t ext = hasFcnt ? lw::extendFcnt(lastFcnt, u.fcnt16) : u.fcnt16;
  cand[nc++] = ext;
  if (ext != u.fcnt16) cand[nc++] = u.fcnt16;
  int ok = -1;
  for (int k = 0; k < nc; k++) {
    if (lw::verifyMic(buf, len, u, cand[k], nwkSKey)) { ok = k; break; }
  }
  if (ok < 0) { Serial.println("MIC TIDAK COCOK -> NwkSKey di setup berbeda dengan di sensor."); return; }
  uint32_t fcnt = cand[ok];
  if (hasFcnt && ok == 0 && fcnt == lastFcnt) { Serial.println("Paket duplikat, diabaikan."); return; }
  if (ok == 1) Serial.println("Info: frame counter sensor ter-reset (sensor restart).");
  // Statistik link: hitung paket hilang dari loncatan frame counter
  if (hasFcnt && ok == 0 && fcnt > lastFcnt + 1) {
    uint32_t gap = fcnt - lastFcnt - 1;
    if (gap < 1000) linkStat.lostCount += gap;
  }
  linkStat.rxCount++;
  linkStat.rssi = rssi; linkStat.snr = snr;
  linkStat.rssiAvg = linkStat.seen ? (0.7f * linkStat.rssiAvg + 0.3f * rssi) : rssi;   // rata-rata bergerak
  linkStat.seen = true; linkStat.lastMs = millis();
  Serial.printf("Link       : %s, kualitas %s, jarak ~%.0f m (kasar), hilang %u paket\n",
                "CONNECTED", signalQuality(snr), estimateDistance(linkStat.rssiAvg), (unsigned)linkStat.lostCount);

  lastFcnt = fcnt; hasFcnt = true;
  Serial.printf("FCnt / Port: %u / %d\n", (unsigned)fcnt, u.fport);

  if (u.fport != SENSOR_FPORT || u.frmLen == 0) {
    Serial.println("Paket tanpa data aplikasi (hanya MAC command).");
    return;
  }

  // 3. Dekripsi payload dengan AppSKey
  uint8_t plain[256];
  lw::decrypt(appSKey, u.devAddr, fcnt, u.frm, u.frmLen, plain);
  Serial.print("Payload    : "); printHex(plain, u.frmLen);

  // 4. Decode sesuai manual
  SensorData d;
  bool full = decodePayload(plain, u.frmLen, d);
  packetCount++;
  Serial.printf("Source: LoRaWAN, data ke-%u:\n", (unsigned)packetCount);

  if (d.basicInfo) {
    Serial.println("  [Info perangkat]");
    if (d.powerOn) Serial.println("  Status      : sensor baru menyala");
    if (d.serial[0]) Serial.printf("  Serial No.  : %s\n", d.serial);
    if (d.hwMajor || d.hwMinor) Serial.printf("  Hardware    : v%u.%u\n", d.hwMajor, d.hwMinor);
    if (d.swMajor || d.swMinor) Serial.printf("  Software    : v%u.%u\n", d.swMajor, d.swMinor);
  }
  printValue("CO2",         d.hasCo2,   d.co2Err,   d.co2,         0, "ppm");
  printValue("Suhu",        d.hasTemp,  d.tempErr,  d.temperature, 1, "C");
  printValue("Kelembapan",  d.hasHum,   d.humErr,   d.humidity,    1, "%RH");
  printValue("Tekanan",     d.hasPress, d.pressErr, d.pressure,    1, "hPa");
  printValue("Baterai",     d.hasBattery, false,    d.battery,     0, "%");
  if (d.mutationAlarm)
    Serial.printf("  ALARM       : perubahan suhu mendadak, suhu %.1f C (selisih %.1f C)\n",
                  d.mutTemp, d.mutDelta);
  for (int k = 0; k < d.historyCount; k++) {
    const SensorData::History& h = d.history[k];
    Serial.printf("  Riwayat     : ts=%u CO2=%u ppm T=%.1f C H=%.1f %% P=%.1f hPa\n",
                  (unsigned)h.ts, h.co2, h.temperature, h.humidity, h.pressure);
  }
  // Simpan ke data terakhir untuk OLED & telemetry
  if (d.hasCo2)     { live.hasCo2 = true;   live.co2Err = d.co2Err;     live.co2 = d.co2; }
  if (d.hasTemp)    { live.hasTemp = true;  live.tempErr = d.tempErr;   live.temp = d.temperature; }
  if (d.hasHum)     { live.hasHum = true;   live.humErr = d.humErr;     live.hum = d.humidity; }
  if (d.hasPress)   { live.hasPress = true; live.pressErr = d.pressErr; live.press = d.pressure; }
  if (d.hasBattery) { live.hasBatt = true;  live.batt = d.battery; }
  if (d.hasCo2 || d.hasTemp || d.hasHum || d.hasPress || d.hasBattery) {
    live.received = true;
    live.lastRxMs = millis();
  }
  if (d.hasCo2 || d.hasTemp || d.hasHum) newData = true;

  if (!full) {
    if (d.unknown) Serial.printf("  Catatan     : channel tidak dikenal %02x %02x\n", d.unknownCh, d.unknownType);
    else Serial.println("  Catatan     : payload terpotong / tidak sesuai -> cek AppSKey");
  }
}

}  // namespace lora
