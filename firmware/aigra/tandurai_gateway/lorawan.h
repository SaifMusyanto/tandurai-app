// lorawan.h - Parsing, verifikasi MIC, dan dekripsi uplink LoRaWAN 1.0.x (ABP)
// Tidak bergantung pada Arduino, hanya butuh mbedtls (sudah ada di ESP32).
#pragma once
#include <stdint.h>
#include <string.h>
#include <stddef.h>
#include "mbedtls/aes.h"

namespace lw {

static void aesEncrypt(const uint8_t key[16], const uint8_t in[16], uint8_t out[16]) {
  mbedtls_aes_context ctx;
  mbedtls_aes_init(&ctx);
  mbedtls_aes_setkey_enc(&ctx, key, 128);
  mbedtls_aes_crypt_ecb(&ctx, MBEDTLS_AES_ENCRYPT, in, out);
  mbedtls_aes_free(&ctx);
}

static void shiftLeft(const uint8_t in[16], uint8_t out[16]) {
  uint8_t carry = 0;
  for (int i = 15; i >= 0; i--) {
    uint8_t next = (in[i] & 0x80) ? 1 : 0;
    out[i] = (uint8_t)((in[i] << 1) | carry);
    carry = next;
  }
}

// AES-CMAC (RFC 4493)
static void aesCmac(const uint8_t key[16], const uint8_t* msg, size_t len, uint8_t mac[16]) {
  uint8_t L[16], K1[16], K2[16], zero[16] = {0};
  aesEncrypt(key, zero, L);
  shiftLeft(L, K1);  if (L[0] & 0x80)  K1[15] ^= 0x87;
  shiftLeft(K1, K2); if (K1[0] & 0x80) K2[15] ^= 0x87;

  size_t n = (len + 15) / 16;
  bool complete;
  if (n == 0) { n = 1; complete = false; } else { complete = (len % 16 == 0); }

  uint8_t last[16];
  const uint8_t* lastIn = msg + (n - 1) * 16;
  if (complete) {
    for (int i = 0; i < 16; i++) last[i] = lastIn[i] ^ K1[i];
  } else {
    size_t r = len % 16;
    memset(last, 0, 16);
    if (r) memcpy(last, lastIn, r);
    last[r] = 0x80;
    for (int i = 0; i < 16; i++) last[i] ^= K2[i];
  }

  uint8_t X[16] = {0}, Y[16];
  for (size_t b = 0; b + 1 < n; b++) {
    for (int i = 0; i < 16; i++) Y[i] = X[i] ^ msg[b * 16 + i];
    aesEncrypt(key, Y, X);
  }
  for (int i = 0; i < 16; i++) Y[i] = X[i] ^ last[i];
  aesEncrypt(key, Y, mac);
}

struct Uplink {
  bool confirmed;
  uint32_t devAddr;
  uint8_t fctrl;
  uint16_t fcnt16;
  uint8_t foptsLen;
  int fport;              // -1 jika tidak ada FPort
  const uint8_t* frm;     // FRMPayload (masih terenkripsi)
  size_t frmLen;
  const uint8_t* mic;
};

enum ParseResult { PARSE_OK, PARSE_TOO_SHORT, PARSE_NOT_UPLINK };

static ParseResult parse(const uint8_t* p, size_t len, Uplink& u) {
  if (len < 12) return PARSE_TOO_SHORT;          // MHDR(1)+FHDR(7)+MIC(4)
  uint8_t mtype = p[0] >> 5;
  if (mtype != 2 && mtype != 4) return PARSE_NOT_UPLINK;  // unconfirmed/confirmed data up
  if ((p[0] & 0x03) != 0) return PARSE_NOT_UPLINK;        // Major harus LoRaWAN R1
  u.confirmed = (mtype == 4);
  u.devAddr = (uint32_t)p[1] | ((uint32_t)p[2] << 8) | ((uint32_t)p[3] << 16) | ((uint32_t)p[4] << 24);
  u.fctrl = p[5];
  u.fcnt16 = (uint16_t)(p[6] | (p[7] << 8));
  u.foptsLen = u.fctrl & 0x0F;
  size_t idx = 8 + u.foptsLen;
  size_t macEnd = len - 4;
  if (idx > macEnd) return PARSE_TOO_SHORT;
  if (idx < macEnd) {
    u.fport = p[idx];
    u.frm = p + idx + 1;
    u.frmLen = macEnd - idx - 1;
  } else {
    u.fport = -1; u.frm = nullptr; u.frmLen = 0;
  }
  u.mic = p + macEnd;
  return PARSE_OK;
}

static void putLe32(uint8_t* d, uint32_t v) {
  d[0] = v & 0xFF; d[1] = (v >> 8) & 0xFF; d[2] = (v >> 16) & 0xFF; d[3] = (v >> 24) & 0xFF;
}

static bool verifyMic(const uint8_t* p, size_t len, const Uplink& u, uint32_t fcnt32,
                      const uint8_t nwkSKey[16]) {
  if (len < 12 || len > 255) return false;
  uint8_t buf[16 + 256];
  size_t msgLen = len - 4;
  buf[0] = 0x49;
  memset(buf + 1, 0, 4);
  buf[5] = 0x00;                 // Dir = uplink
  putLe32(buf + 6, u.devAddr);
  putLe32(buf + 10, fcnt32);
  buf[14] = 0x00;
  buf[15] = (uint8_t)msgLen;
  memcpy(buf + 16, p, msgLen);
  uint8_t mac[16];
  aesCmac(nwkSKey, buf, 16 + msgLen, mac);
  return memcmp(mac, u.mic, 4) == 0;
}

static void decrypt(const uint8_t key[16], uint32_t devAddr, uint32_t fcnt32,
                    const uint8_t* in, size_t len, uint8_t* out) {
  uint8_t A[16], S[16];
  for (size_t i = 0; i < len; i += 16) {
    A[0] = 0x01;
    memset(A + 1, 0, 4);
    A[5] = 0x00;                 // Dir = uplink
    putLe32(A + 6, devAddr);
    putLe32(A + 10, fcnt32);
    A[14] = 0x00;
    A[15] = (uint8_t)(i / 16 + 1);
    aesEncrypt(key, A, S);
    for (size_t j = 0; j < 16 && i + j < len; j++) out[i + j] = in[i + j] ^ S[j];
  }
}

// Perkirakan FCnt 32-bit dari 16 bit yang dikirim di udara.
static uint32_t extendFcnt(uint32_t last, uint16_t f16) {
  uint32_t c = (last & 0xFFFF0000u) | f16;
  if (c < last) c += 0x10000u;
  return c;
}

}  // namespace lw
