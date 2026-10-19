#!/bin/sh
# Broker MQTT di container: tunggu sertifikat TLS dari Caddy, lalu keluar saat sertifikat diperbarui
# supaya Docker (restart: unless-stopped) menyalakan ulang broker dengan sertifikat baru.
set -u

if [ -n "${MQTT_TLS_CERT:-}" ]; then
  until [ -s "$MQTT_TLS_CERT" ] && [ -s "$MQTT_TLS_KEY" ]; do
    echo "[broker] menunggu sertifikat TLS dari Caddy: $MQTT_TLS_CERT"
    sleep 5
  done
fi

node apps/api/tools/broker.mjs &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null; wait "$pid"; exit 0' TERM INT

if [ -n "${MQTT_TLS_CERT:-}" ]; then
  stamp=$(stat -c %Y "$MQTT_TLS_CERT")
  while kill -0 "$pid" 2>/dev/null; do
    sleep 600 &
    wait $!
    if [ "$(stat -c %Y "$MQTT_TLS_CERT" 2>/dev/null || echo "$stamp")" != "$stamp" ]; then
      echo "[broker] sertifikat TLS diperbarui, restart broker"
      kill -TERM "$pid"
    fi
  done
fi

wait "$pid"
exit 1
