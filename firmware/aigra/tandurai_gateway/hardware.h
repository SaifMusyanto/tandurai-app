// hardware.h - Pin & parameter board Aigra (patokan: sensor_oled/sensor_oled.ino)
#pragma once

// ================= LoRa SX1276 (SPI default ESP32: SCK=18, MISO=19, MOSI=23) =================
#define USE_LORA  false           // sensor ZYD-M500CO2 (S1) lewat LoRa. false = nonaktif: S1 tidak didaftarkan,
                                  // radio tidak dinyalakan, kolom kunci LoRa disembunyikan di halaman setup
#define PIN_NSS   5
#define PIN_RST   14
#define PIN_DIO0  26
#define PIN_DIO1  33

// Samakan dengan pengaturan sensor ZYD-M500CO2
#define LORA_FREQ_MHZ   921.4     // frekuensi single-channel di sensor
#define LORA_SF         9         // Spreading Factor di sensor
#define LORA_BW_KHZ     125.0
#define SENSOR_FPORT    85        // Application Port di sensor
#define REPORT_INTERVAL_MIN 1     // samakan dengan Reporting Interval sensor
#define MISSED_FOR_DISCONNECT 2   // DISCONNECTED jika 2 kiriman berturut-turut tidak diterima

// Perkiraan jarak (KASAR, perlu kalibrasi)
// Rumus log-distance: jarak = REF_DIST_M * 10^((RSSI_REF_DBM - RSSI) / (10 * PATH_LOSS_N))
#define REF_DIST_M     10.0       // jarak referensi saat kalibrasi (meter)
#define RSSI_REF_DBM   -50.0      // RSSI rata-rata yang terukur di jarak referensi
#define PATH_LOSS_N    2.7        // 2.0 lapangan terbuka, 2.7-3.5 perumahan, 4+ dalam gedung

// ================= OLED 1.3" I2C (SH1106) =================
#define PIN_SDA   21
#define PIN_SCL   22
#define SLIDE_INTERVAL_S 5        // slide berganti otomatis tiap 5 detik

// ================= Sensor RS485 (RS-O2WS-N01, Modbus RTU) =================
#define USE_RS485       true      // modul RS485-TTL sudah terpasang
#define PIN_RS485_RX    16        // ke RO / RXD modul RS485
#define PIN_RS485_TX    17        // ke DI / TXD modul RS485
#define PIN_RS485_DE    -1        // -1 = modul auto-direction (tanpa pin DE/RE). MAX485: isi 4
#define RS485_BAUD      4800      // default pabrik
#define RS485_ADDR      1         // default pabrik
#define RS485_POLL_S    5         // baca sensor tiap 5 detik
#define RS485_PRINT_S   30        // tampilkan di Serial tiap 30 detik
#define RS485_LOST_FAILS 3        // dianggap terputus setelah 3x gagal berturut-turut

// ================= Relay =================
#define RELAY_ACTIVE_HIGH true    // modul relay aktif HIGH
#define PIN_RELAY_EXHAUST 25
#define PIN_RELAY_FAN     32
#define PIN_RELAY_WATER   27

// ================= LED status =================
// LED biru on-board ESP32 DevKit (WROOM-32D) di GPIO 2. LED merah = power, tidak bisa diatur.
#define PIN_STATUS_LED         2
#define STATUS_LED_ACTIVE_HIGH true

// ================= Tombol =================
// BOOT: ditekan saat berjalan = ganti slide OLED (opsional; slide juga berganti otomatis).
// Halaman setup dibuka lewat saklar power OFF-ON 3× cepat, karena tombol tertutup casing.
#define PIN_BUTTON 0
