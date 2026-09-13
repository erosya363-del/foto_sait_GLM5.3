#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# restore_snapshot.sh — восстановление проекта из снапшота download/snapshots/
#
# Использование:
#   bash scripts/restore_snapshot.sh download/snapshots/snap-002-....tar.gz
#
# Что делает: распаковывает исходники+db+.env+.git → bun install →
# prisma generate → bun run build → перезапуск production-сервера :3000
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "Использование: $0 <путь к .tar.gz снапшоту>"
  echo "Доступные снапшоты:"
  ls -1 download/snapshots/*.tar.gz 2>/dev/null || echo "  (нет снапшотов)"
  exit 1
fi

echo "── Остановка текущего сервера…"
pkill -f "standalone/server.js" 2>/dev/null || true
sleep 1

echo "── Распаковка $ARCHIVE → проект…"
tar -xzf "$ARCHIVE" -C .

echo "── Зависимости (bun install)…"
bun install --frozen-lockfile 2>/dev/null || bun install

echo "── Prisma client…"
bunx prisma generate

echo "── Сборка production…"
bun run build

echo "── Запуск сервера :3000…"
nohup node .next/standalone/server.js > server.log 2>&1 &
sleep 3
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/ || true
echo "✅ Восстановлено из: $ARCHIVE"
