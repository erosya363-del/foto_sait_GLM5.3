#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# test-export-sync.sh — интеграционная проверка механизма синхронизации:
#   [1] /api/admin/export отдаёт манифест (счётчики БД + sha256 файлов)
#   [2] /api/admin/export?part=db отдаёт целую БД с ожидаемым числом строк
#   [3] scripts/sync-from-live.sh скачивает БД+фото и атомарно кладёт в
#       изолированную runtime-зону /tmp/sync-rt (production не затрагивается)
#   [4] приёмник содержит ровно то, что отдал источник
#
# Сервер поднимается на :3100 внутри ЭТОГО процесса (фоновые процессы вне
# вызова sandbox убивает), в конце гасится.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd /home/z/my-project

PORT=3100

echo "── Старт dev-сервера :$PORT (лог: /tmp/dev-test-3100.log)"
bunx next dev -p $PORT > /tmp/dev-test-3100.log 2>&1 &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null || true' EXIT

READY=""
for i in $(seq 1 90); do
    if curl -sf -o /dev/null --max-time 5 "http://localhost:$PORT/"; then READY=1; break; fi
    sleep 1
done
[ -n "$READY" ] || { echo "✗ сервер не поднялся"; tail -30 /tmp/dev-test-3100.log; exit 1; }
echo "── сервер готов"

FAIL=0

echo "── [тест 1] манифест /api/admin/export"
if curl -sf --max-time 120 "http://localhost:$PORT/api/admin/export" -o /tmp/exp-manifest.json; then
    python3 - <<'EOF' || FAIL=1
import json
m = json.load(open('/tmp/exp-manifest.json'))
print("   db:", m['db'])
print("   files:", len(m['uploads']['optimized']), "+", len(m['uploads']['thumbs']))
assert m['db']['photos'] == 26, f"ожидалось 26 фото, получено {m['db']['photos']}"
assert len(m['uploads']['optimized']) == 38
assert len(m['uploads']['thumbs']) == 38
print("   OK")
EOF
else
    echo "   ✗ манифест не получен"; tail -5 /tmp/dev-test-3100.log; FAIL=1
fi

echo "── [тест 2] выгрузка БД ?part=db"
if curl -sf --max-time 120 "http://localhost:$PORT/api/admin/export?part=db" -o /tmp/export-test.db; then
    node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/tmp/export-test.db', { readOnly: true });
  const ic = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const photos = db.prepare('SELECT COUNT(*) c FROM photos').get().c;
  console.log('   integrity:', ic, '| photos:', photos);
  if (ic !== 'ok' || photos !== 26) process.exit(1);
" || FAIL=1
else
    echo "   ✗ БД не получена"; tail -5 /tmp/dev-test-3100.log; FAIL=1
fi

echo "── [тест 3] sync-from-live → изолированная зона /tmp/sync-rt"
rm -rf /tmp/sync-rt
if RUNTIME_ROOT=/tmp/sync-rt bash scripts/sync-from-live.sh "http://localhost:$PORT" --yes; then
    echo "   sync завершился без ошибок"
else
    echo "   ✗ sync-from-live упал"; FAIL=1
fi

echo "── [тест 4] содержимое приёмника"
node -e "
  const { DatabaseSync } = require('node:sqlite');
  const { readdirSync } = require('fs');
  const db = new DatabaseSync('/tmp/sync-rt/database/custom.db', { readOnly: true });
  const ic = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const photos = db.prepare('SELECT COUNT(*) c FROM photos').get().c;
  const opt = readdirSync('/tmp/sync-rt/uploads/optimized').length;
  const thm = readdirSync('/tmp/sync-rt/uploads/thumbs').length;
  console.log('   integrity:', ic, '| photos:', photos, '| files:', opt, '+', thm);
  if (ic !== 'ok' || photos !== 26 || opt !== 38 || thm !== 38) process.exit(1);
  console.log('   OK');
" || FAIL=1

echo "── [тест 5] fail-closed: без BASE_URL скрипт обязан отказаться"
if bash scripts/sync-from-live.sh 2>/dev/null; then
    echo "   ✗ скрипт отработал без BASE_URL — так нельзя"; FAIL=1
else
    echo "   OK — отказ без BASE_URL подтверждён"
fi

if [ "$FAIL" = "0" ]; then
    echo "✅ ВСЕ ТЕСТЫ ПРОШЛИ"
else
    echo "❌ ЕСТЬ ПРОВАЛЕННЫЕ ТЕСТЫ"
fi
exit $FAIL
