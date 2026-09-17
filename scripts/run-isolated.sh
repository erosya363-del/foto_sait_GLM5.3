#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-isolated.sh — запуск мутирующих E2E в ИЗОЛИРОВАННОЙ среде (этап 4 ТЗ).
#
# Что делает:
#   1. Создаёт ОДНОРАЗОВУЮ копию production runtime-зоны
#      → tool-results/e2e-runtime/ (исходник не трогается)
#   2. Поднимает production-сервер (standalone) на :3100 с RUNTIME_ROOT=копия
#   3. Запускает переданный тест с env:
#        E2E_BASE=http://localhost:3100
#        E2E_RUNTIME=<абс. путь к копии>
#        E2E_ROOT=<корень проекта>
#   4. ПОСЛЕ теста уничтожает копию вместе со всеми тестовыми данными
#      («копия уничтожается, original остаётся неизменным»)
#
# Использование:
#   bash scripts/run-isolated.sh bun scripts/test-s5.mjs
#   bash scripts/run-isolated.sh node scripts/audit-full.mjs --quick
#
# Требует собранный standalone (.next/standalone/server.js) — при отсутствии
# запускает bun run build автоматически.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

[ -x .next/standalone/server.js ] || { echo "── standalone нет — собираю…"; bun run build > /dev/null; }

PORT=3100
FIXTURE="$PWD/tool-results/e2e-runtime"
LOG="tool-results/e2e-server.log"

# Убить чужой процесс на :3100 (остался от прерванного прогона)
OLD_PIDS=$(ss -tlnp 2>/dev/null | grep ":${PORT} " | grep -oE "pid=[0-9]+" | cut -d= -f2 | sort -u || true)
for pid in ${OLD_PIDS:-}; do kill -9 "$pid" 2>/dev/null || true; done

echo "── Копия production runtime → $FIXTURE"
rm -rf "$FIXTURE"
mkdir -p "$FIXTURE"
cp -a download/runtime/. "$FIXTURE/"

cleanup() {
  echo "── Остановка сервера :${PORT} и удаление копии…"
  PIDS=$(ss -tlnp 2>/dev/null | grep ":${PORT} " | grep -oE "pid=[0-9]+" | cut -d= -f2 | sort -u || true)
  for pid in ${PIDS:-}; do kill -9 "$pid" 2>/dev/null || true; done
  rm -rf "$FIXTURE"
}
trap cleanup EXIT

echo "── Сервер :${PORT} (RUNTIME_ROOT=$FIXTURE)…"
PORT=$PORT RUNTIME_ROOT="$FIXTURE" NODE_ENV=production nohup node .next/standalone/server.js > "$LOG" 2>&1 &
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/api/catalog" 2>/dev/null || true)
  [ "$code" = "200" ] && break
  sleep 0.5
done
[ "$code" = "200" ] || { echo "✗ сервер не поднялся — см. $LOG" >&2; tail -20 "$LOG" >&2; exit 1; }
echo "── Сервер готов, запуск: $*"

set +e
E2E_BASE="http://localhost:${PORT}" E2E_RUNTIME="$FIXTURE" E2E_ROOT="$PWD" "$@"
RC=$?
set -e

echo "── Тест завершился с кодом $RC (копия данных будет удалена)"
exit $RC
