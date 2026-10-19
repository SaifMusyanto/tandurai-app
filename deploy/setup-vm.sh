#!/usr/bin/env bash
# Persiapan VM baru (Ubuntu 24.04, GCP). Jalankan sekali:  sudo bash deploy/setup-vm.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Jalankan dengan sudo." >&2; exit 1; fi
TARGET_USER="${SUDO_USER:-$USER}"

echo "▶ paket dasar"
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl git

echo "▶ Docker Engine + Compose plugin"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$TARGET_USER"
systemctl enable --now docker

echo "▶ swap 2 GB (cadangan saat build image di VM kecil)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

echo "▶ zona waktu"
timedatectl set-timezone Asia/Jakarta

echo "Selesai. Logout lalu login lagi agar user '$TARGET_USER' bisa menjalankan docker tanpa sudo."
