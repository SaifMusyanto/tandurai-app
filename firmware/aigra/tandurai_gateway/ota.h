// ota.h - Update firmware lewat internet (OTA), dipicu perintah {"action":"ota"} di topic cmd.
// Hemat ukuran: tanpa HTTPClient/HTTPUpdate. Memakai klien TLS yang sama dengan MQTT, library Update
// bawaan core, dan SHA-256 mbedtls (sudah ter-link untuk TLS).
// Hash SHA-256 datang lewat MQTT (TLS + login perangkat), jadi isi file tervalidasi walau URL-nya publik.
// File ini identik di semua sketch gateway Tandurai (firmware/*/).
#pragma once
#include <Update.h>
#include <WiFiClientSecure.h>
#include <esp_ota_ops.h>
#include <esp_task_wdt.h>
#include "mbedtls/sha256.h"

namespace ota {

struct Job { String id, url, sha256, version; uint32_t size = 0; };

// Alasan menolak sebelum download; nullptr = boleh dijalankan.
const char *check(const Job &job, const char *runningVersion, bool allowHttp) {
  const esp_partition_t *next = esp_ota_get_next_update_partition(NULL);
  if (!next) return "no_ota_partition";                      // di-flash dengan partisi tanpa OTA (mis. Huge APP)
  if (!job.size || job.size > next->size) return "size";
  if (job.sha256.length() != 64) return "sha256";
  if (job.version == runningVersion) return "same_version";
  if (!job.url.startsWith("https://") && !(allowHttp && job.url.startsWith("http://"))) return "url";
  return nullptr;
}

String readLine(Client &net) { String line = net.readStringUntil('\n'); line.trim(); return line; }

// Download lalu tulis ke partisi OTA berikutnya. "" = sukses (tinggal restart), selain itu kode gagal.
// Partisi aktif tidak tersentuh, jadi kegagalan di tengah jalan aman.
String download(const Job &job, WiFiClientSecure &tls, WiFiClient &plain, void (*progress)(int percent)) {
  bool https = job.url.startsWith("https://");
  String rest = job.url.substring(https ? 8 : 7);
  int slash = rest.indexOf('/');
  if (slash < 0) return "url";
  String hostPort = rest.substring(0, slash), path = rest.substring(slash);
  int colon = hostPort.indexOf(':');
  String host = colon < 0 ? hostPort : hostPort.substring(0, colon);
  uint16_t port = colon < 0 ? (https ? 443 : 80) : hostPort.substring(colon + 1).toInt();
  WiFiClient &net = https ? tls : plain;

  esp_task_wdt_reset();
  if (!net.connect(host.c_str(), port)) return "connect";
  net.setTimeout(15000);
  net.print(String("GET ") + path + " HTTP/1.1\r\nHost: " + host + "\r\nConnection: close\r\n\r\n");

  String status = readLine(net);
  if (!status.startsWith("HTTP/1.") || status.substring(9, 12) != "200") { net.stop(); return "http_" + status.substring(9, 12); }
  long length = -1;
  for (String line = readLine(net); line.length(); line = readLine(net)) {
    line.toLowerCase();
    if (line.startsWith("content-length:")) length = line.substring(15).toInt();
  }
  if (length != (long)job.size) { net.stop(); return "length"; }
  if (!Update.begin(job.size)) { net.stop(); return "begin"; }

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts(&sha, 0);
  uint8_t buf[1024];
  uint32_t got = 0, lastData = millis();
  int lastPercent = -1;
  while (got < job.size) {
    esp_task_wdt_reset();
    int n = net.read(buf, min<uint32_t>(sizeof(buf), job.size - got));
    if (n > 0) {
      if (Update.write(buf, n) != (size_t)n) break;
      mbedtls_sha256_update(&sha, buf, n);
      got += n; lastData = millis();
      int percent = got * 100ULL / job.size;
      if (progress && percent / 10 != lastPercent / 10) { lastPercent = percent; progress(percent); }
    } else if (!net.connected() || millis() - lastData > 20000) {
      break;
    } else {
      delay(2);
    }
  }
  net.stop();
  uint8_t digest[32];
  mbedtls_sha256_finish(&sha, digest);
  mbedtls_sha256_free(&sha);
  if (got != job.size) { Update.abort(); return Update.hasError() ? "write" : "incomplete"; }

  char hex[65];
  for (int i = 0; i < 32; i++) snprintf(hex + i * 2, 3, "%02x", digest[i]);
  if (!job.sha256.equalsIgnoreCase(hex)) { Update.abort(); return "sha256_mismatch"; }
  if (!Update.end()) return "end";                           // gambar valid → partisi ini jadi boot berikutnya
  return "";
}

}  // namespace ota
