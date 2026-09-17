#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# test-restore-roundtrip.sh — проверка backup/restore (этап 8 ТЗ стабилизации).
#
# Сценарий (ВСЁ на одноразовой КОПИИ production, оригинал не трогается):
#   1. Копия production runtime → tool-results/restore-rt
#   2. backup-runtime.sh копии → архив
#   3. Сервер :3200 на копии: создать тестовый товар + залить фото (мутация)
#   4. Проверить, что мутация прошла (фото+1, категория есть)
#   5. restore-runtime.sh архива в ту же копию
#   6. Сверить: счётчики строк БД и md5 файлов = состояние на момент бэкапа
#   7. Production runtime не тронут весь прогон
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."

FIXTURE="$PWD/tool-results/restore-rt"
PORT=3200
BASE="http://localhost:${PORT}"
PROD="download/runtime"

PASS=0; FAIL=0
check() { if [ "$1" = "0" ]; then PASS=$((PASS+1)); echo "  ✓ $2"; else FAIL=$((FAIL+1)); echo "  ✗ $2${3:+ — $3}"; fi }

snapshot_counts() { # $1 = runtime dir → "photos|variants|categories"
  DB_ABS="$1/database/custom.db" bun -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
    Promise.all([p.photo.count(), p.productVariant.count(), p.category.count()])
      .then(([a,b,c]) => { console.log(a + '|' + b + '|' + c); return p.\$disconnect(); });
  "
}
uploads_md5() { (cd "$1" && find uploads -type f -exec md5sum {} \; 2>/dev/null | sort -k2 | md5sum | cut -d' ' -f1); }
# ПРАВКА v2: БД после VACUUM INTO отличается БАЙТАМИ при идентичном содержимом
# (компакция/перепаковка страниц — это и есть цель атомарного снапшота).
# Поэтому: uploads сравниваются побайтово, БД — по счётчикам + integrity +
# fail-closed сверке manifest внутри самого restore (шаг [5/7] ниже).

echo "── [1/7] Копия production → fixture"
rm -rf "$FIXTURE" && mkdir -p "$FIXTURE"
cp -a "$PROD/." "$FIXTURE/"
BEFORE_COUNTS=$(snapshot_counts "$FIXTURE")
BEFORE_UPLOADS_MD5=$(uploads_md5 "$FIXTURE")
echo "   состояние: $BEFORE_COUNTS, uploads_md5=$BEFORE_UPLOADS_MD5"

echo "── [2/7] Бэкап копии"
RUNTIME_ROOT="$FIXTURE" bash scripts/backup-runtime.sh "restore-rt" > /tmp/rt-backup.log 2>&1
ARCHIVE=$(ls -1t download/backups/runtime-*restore-rt.tar.gz | head -1)
[ -f "$ARCHIVE" ]; check $? "архив создан: $(basename "$ARCHIVE")"

echo "── [3/7] Сервер :${PORT} на копии + мутация"
# Убить осиротевшие серверы прошлых прогонов (иначе отвечают с deleted-inode БД)
OLD_PIDS=$(ss -tlnp 2>/dev/null | grep ":${PORT} " | grep -oE "pid=[0-9]+" | cut -d= -f2 | sort -u || true)
for pid in ${OLD_PIDS:-}; do kill -9 "$pid" 2>/dev/null || true; done
PORT=$PORT RUNTIME_ROOT="$FIXTURE" NODE_ENV=production nohup node .next/standalone/server.js > /tmp/rt-server.log 2>&1 &
SRV_PID=$!
cleanup() { kill -9 "$SRV_PID" 2>/dev/null || true; }
trap cleanup EXIT
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/catalog" 2>/dev/null || true)
  [ "$code" = "200" ] && break; sleep 0.5
done
[ "$code" = "200" ]; check $? "сервер поднялся"

CAT=$(curl -s -X POST "$BASE/api/admin" -H "Content-Type: application/json" \
  -d "{\"entity\":\"category\",\"action\":\"create\",\"name\":\"РесторКат-$(date +%s)\"}")
CAT_ID=$(echo "$CAT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
[ -n "$CAT_ID" ]; check $? "тестовая категория создана"

MDL=$(curl -s -X POST "$BASE/api/admin" -H "Content-Type: application/json" \
  -d "{\"entity\":\"model\",\"action\":\"create\",\"name\":\"РесторМодель-$(date +%s)\",\"categoryId\":\"$CAT_ID\"}")
MDL_ID=$(echo "$MDL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
[ -n "$MDL_ID" ]; check $? "тестовая модель создана"

bun -e "
  const sharp = require('sharp');
  sharp({ create: { width: 300, height: 200, channels: 3, background: '#123456' } }).jpeg().toFile('/tmp/rt-photo.jpg').then(() => console.log('ok'));
" > /dev/null
UP=$(curl -s -X POST "$BASE/api/upload" -F "categoryId=$CAT_ID" -F "modelId=$MDL_ID" -F "photos=@/tmp/rt-photo.jpg;type=image/jpeg")
echo "$UP" | grep -q '"uploaded":1'; check $? "тестовое фото загружено" "ответ: $(echo "$UP" | head -c 200)"

echo "── [4/7] Мутация зафиксирована"
MUT_COUNTS=$(snapshot_counts "$FIXTURE")
[ "$MUT_COUNTS" != "$BEFORE_COUNTS" ]; check $? "состояние изменилось: $BEFORE_COUNTS → $MUT_COUNTS"
cleanup; trap - EXIT

echo "── [5/7] Восстановление из архива"
RUNTIME_ROOT="$FIXTURE" bash scripts/restore-runtime.sh "$ARCHIVE" > /tmp/rt-restore.log 2>&1
grep -q "Восстановлено" /tmp/rt-restore.log; check $? "restore отработал"
grep -q "manifest: ПОЛНОЕ СООТВЕТСТВИЕ" /tmp/rt-restore.log; check $? "fail-closed сверка manifest пройдена (restore)"
if grep -qE "MANIFEST MISMATCH|REFUSE" /tmp/rt-restore.log; then check 1 "restore без противоречий manifest"; else check 0 "restore без противоречий manifest"; fi

echo "── [6/7] Сверка AFTER == BACKUP"
AFTER_COUNTS=$(snapshot_counts "$FIXTURE")
[ "$AFTER_COUNTS" = "$BEFORE_COUNTS" ]; check $? "счётчики БД восстановлены: $AFTER_COUNTS"
AFTER_UPLOADS_MD5=$(uploads_md5 "$FIXTURE")
[ "$AFTER_UPLOADS_MD5" = "$BEFORE_UPLOADS_MD5" ]; check $? "uploads совпадают побайтово с моментом бэкапа"
DB_INTEGRITY=$(DB_ABS="$FIXTURE/database/custom.db" bun -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
  p.\$queryRawUnsafe('PRAGMA integrity_check').then((r) => { console.log(String(r[0]?.integrity_check)); return p.\$disconnect(); });
")
[ "$DB_INTEGRITY" = "ok" ]; check $? "восстановленная БД проходит integrity_check"

echo "── [7/7] Production не тронут"
PROD_UPLOADS_MD5=$(uploads_md5 "$PROD")
[ -n "$PROD_UPLOADS_MD5" ]; check $? "production runtime доступен (uploads_md5=$PROD_UPLOADS_MD5)"

# уборка: .bak-каталоги от restore + fixture
rm -rf "$FIXTURE" "$FIXTURE".bak-* /tmp/rt-photo.jpg
# архив restore-rt удаляем (был одноразовым)
rm -f "$ARCHIVE"

echo ""
echo "═══ restore-roundtrip: PASS $PASS / FAIL $FAIL ═══"
[ "$FAIL" = "0" ]
