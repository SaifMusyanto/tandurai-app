#!/usr/bin/env bash
# Deploy / update Tandurai dengan satu perintah:  ./deploy/deploy.sh
#   --no-pull   lewati git pull (mis. saat menguji perubahan lokal di server)
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "deploy/.env belum ada. Jalankan: cp deploy/.env.example deploy/.env  lalu isi nilainya." >&2
  exit 1
fi
chmod 600 .env

if [ "${1:-}" != "--no-pull" ] && git -C .. rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "▶ git pull"
  git -C .. pull --ff-only
fi

echo "▶ build & start container"
docker compose up -d --build --remove-orphans

echo "▶ bersihkan image lama"
docker image prune -f >/dev/null

echo "▶ menunggu API sehat"
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null || echo starting)
  [ "$status" = "healthy" ] && break
  sleep 3
done

docker compose ps
echo
docker compose exec -T api node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>r.text()).then(t=>console.log('health:', t))" || true
echo "Selesai. Log: docker compose -f deploy/docker-compose.yml logs -f"
