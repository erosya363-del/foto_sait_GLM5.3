#!/usr/bin/env bash
# restart.sh — надёжный перезапуск production-сервера :3000.
# Урок этой сессии: Next.js переименовывает процесс в «next-server (v…)»,
# pkill -f "standalone/server.js" его НЕ находит → зомби держит порт, и
# тесты молча попадают на СТАРЫЙ билд. Убиваем строго по порту.
set -uo pipefail
cd "$(dirname "$0")/.."

# Убиваем ВСЁ, что слушает :3000 (next-server переименовывает процесс —
# pkill -f server.js его не находит; lsof в песочнице слеп к сокету — берём pid из ss)
PIDS=$(ss -tlnp 2>/dev/null | grep ":3000 " | grep -oE "pid=[0-9]+" | cut -d= -f2 | sort -u)
for pid in $PIDS; do kill -9 "$pid" 2>/dev/null; done
for i in 1 2 3 4 5; do
  ss -tln 2>/dev/null | grep -q ":3000 " || break
  sleep 0.5
done
if ss -tln 2>/dev/null | grep -q ":3000 "; then
  echo "⚠ порт 3000 всё ещё занят" >&2
  exit 1
fi

nohup node .next/standalone/server.js > server.log 2>&1 &
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || true)
  if [ "$code" = "200" ]; then echo "✅ сервер :3000 готов (HTTP $code)"; exit 0; fi
  sleep 0.5
done
echo "⚠ сервер не поднялся — см. server.log" >&2
exit 1
