#!/usr/bin/env bash
# Backup PostgreSQL harian. Pasang di crontab root (sudo crontab -e):
#   0 2 * * * BACKUP_DIR=/home/service/tandurai-backups /home/service/tandurai/deploy/backup.sh >> /var/log/tandurai-backup.log 2>&1
# Opsional: BACKUP_BUCKET=gs://nama-bucket  → salinan juga diunggah ke Cloud Storage.
set -euo pipefail
cd "$(dirname "$0")"

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/tandurai_iot_$(date +%F_%H%M).dump"

docker compose exec -T postgres pg_dump -U tandurai -Fc tandurai_iot > "$file"
echo "$(date -Is) backup: $file ($(du -h "$file" | cut -f1))"

if [ -n "${BACKUP_BUCKET:-}" ]; then
  gcloud storage cp "$file" "$BACKUP_BUCKET/"
fi
find "$BACKUP_DIR" -name 'tandurai_iot_*.dump' -mtime +"$KEEP_DAYS" -delete
