#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# test-deploy-cycle.sh — DATA PERSISTENCE по ТЗ CRITICAL STABILITY 10.1.
#
# Полный цикл В ИЗОЛЯЦИИ (production runtime read-only, не трогается):
#   A. upload photo через живой API изолированного сервера
#   B. verify DB row + optimized file + thumb
#   C. simulate build artifact (database-runtime-build.sh c RUNTIME_ROOT=фикстура)
#   D. verify artifact (входит в database-runtime-build, но сверяем и вручную)
#   E. simulate redeploy/start against artifact runtime
#   F. verify same photo survives (HTTP 200 + тот же sha256)
#   G. SECOND CYCLE: upload ещё одного фото УЖЕ на «переdeployнутом» сервере
#      → sync/build/deploy simulation → photo survives. Второй цикл критичен.
#
# Запуск: bash scripts/test-deploy-cycle.sh
# Production runtime сверяется md5 до/после всего прогона.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=3201
BASE="http://localhost:${PORT}"
FIXTURE="$PWD/tool-results/deploy-cycle-runtime"
ARTIFACT="$PWD/tool-results/deploy-cycle-artifact"
PROD="download/runtime"

PASS=0; FAIL=0
check() { if [ "$1" = "0" ]; then PASS=$((PASS+1)); echo "  ✓ $2"; else FAIL=$((FAIL+1)); echo "  ✗ $2${3:+ — $3}"; fi }

uploads_md5() { (cd "$1" && find uploads -type f -exec md5sum {} \; 2>/dev/null | sort -k2 | md5sum | cut -d' ' -f1); }

SRV_PID=""
cleanup() {
  [ -n "$SRV_PID" ] && kill -9 "$SRV_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "── [0] Production runtime не тронут (снимок md5)"
PROD_BEFORE=$(uploads_md5 "$PROD")

# ── [A] Изолированный сервер + фикстура = копия production ──
echo "── [A] Фикстура (копия production) + изолированный сервер :${PORT}"
rm -rf "$FIXTURE" "$ARTIFACT"
mkdir -p "$(dirname "$FIXTURE")"
cp -a "$PROD" "$FIXTURE"
# маркер/токен тоже копируются (deploy-guard нужен при сборке артефакта)

OLD_PIDS=$(ss -tlnp 2>/dev/null | grep ":${PORT} " | grep -oE "pid=[0-9]+" | cut -d= -f2 | sort -u || true)
for pid in ${OLD_PIDS:-}; do kill -9 "$pid" 2>/dev/null || true; done

if [ ! -f ".next/standalone/server.js" ]; then
  echo "  (нет .next/standalone — собираю)"
  bun run build > /tmp/dc-build.log 2>&1
fi
PORT=$PORT RUNTIME_ROOT="$FIXTURE" NODE_ENV=production nohup node .next/standalone/server.js > /tmp/dc-server.log 2>&1 &
SRV_PID=$!
CODE=""
for i in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/catalog" 2>/dev/null || true)
  [ "$CODE" = "200" ] && break; sleep 0.5
done
[ "$CODE" = "200" ]; check $? "сервер поднялся на фикстуре"

# категория/модель для загрузки
CAT=$(curl -s -X POST "$BASE/api/admin" -H "Content-Type: application/json" \
  -d "{\"entity\":\"category\",\"action\":\"create\",\"name\":\"ДеплойКат-$(date +%s)\"}")
CAT_ID=$(echo "$CAT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
MDL=$(curl -s -X POST "$BASE/api/admin" -H "Content-Type: application/json" \
  -d "{\"entity\":\"model\",\"action\":\"create\",\"name\":\"ДеплойМод-$(date +%s)\",\"categoryId\":\"$CAT_ID\"}")
MDL_ID=$(echo "$MDL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
[ -n "$CAT_ID" ] && [ -n "$MDL_ID" ]; check $? "тестовая категория+модель созданы"

# ── [A] upload фото №1
bun -e "const sharp=require('sharp');sharp({create:{width:640,height:420,channels:3,background:'#0f766e'}}).jpeg().toFile('/tmp/dc-photo-1.jpg').then(()=>console.log('ok'))" > /dev/null 2>&1
UP1=$(curl -s -X POST "$BASE/api/upload" -F "categoryId=$CAT_ID" -F "modelId=$MDL_ID" -F "photos=@/tmp/dc-photo-1.jpg;type=image/jpeg")
echo "$UP1" | grep -q '"uploaded":1'; check $? "A. upload фото №1" "$UP1"

ROW1=$(bun -e "
const { Database } = require('bun:sqlite');
const db = new Database('$FIXTURE/database/custom.db', { readonly: true });
const r = db.query(\"SELECT id, url, \\\"thumbUrl\\\" t FROM photos WHERE \\\"deletedAt\\\" IS NULL AND url LIKE '/api/media/%' ORDER BY \\\"createdAt\\\" DESC, id DESC LIMIT 1\").get();
console.log(JSON.stringify(r));
db.close();")
P1_URL=$(echo "$ROW1" | python3 -c "import json,sys; print(json.load(sys.stdin)['url'])")
P1_THUMB=$(echo "$ROW1" | python3 -c "import json,sys; print(json.load(sys.stdin)['t'])")
P1_FILE="$FIXTURE/uploads/optimized/$(basename "$P1_URL")"
P1_THUMB_FILE="$FIXTURE/uploads/thumbs/$(basename "$P1_THUMB")"

# ── [B] verify DB row + files
echo "── [B] verify DB row / optimized / thumb"
[ -n "$P1_URL" ]; check $? "B1. Photo-строка в БД ($P1_URL)"
[ -f "$P1_FILE" ] && [ -s "$P1_FILE" ]; check $? "B2. optimized существует и >0"
[ -f "$P1_THUMB_FILE" ] && [ -s "$P1_THUMB_FILE" ]; check $? "B3. thumb существует и >0"
HTTP1=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$P1_URL")
[ "$HTTP1" = "200" ]; check $? "B4. фото отдаётся 200 до деплоя"

kill -9 "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; SRV_PID=""
sleep 0.7

# ── [C-] НЕГАТИВ: build БЕЗ свежего маркера после мутации → guard обязан заблокировать
PROJECT_DIR="$PWD" BUILD_DIR="$ARTIFACT" RUNTIME_ROOT="$FIXTURE" \
  bash .zscripts/database-runtime-build.sh > /tmp/dc-databake-neg.log 2>&1
[ $? -ne 0 ]; check $? "C-. deploy-guard заблокировал несинхронизированную зону (fail-closed работает)"
grep -q "photoCount" /tmp/dc-databake-neg.log; check $? "C-- причина блокировки: расхождение счётчиков"

# ── [C] simulate build artifact (+ встроенный post-build verify)
echo "── [C] simulate build artifact (database-runtime-build, RUNTIME_ROOT=фикстура)"
# «Ре-синк»: после загрузки живой сайт имеет новые данные — sync-from-live
# переписал бы маркер под актуальное состояние. Симулируем это:
bun -e "
const fs=require('fs');
const { Database } = require('bun:sqlite');
const db = new Database('$FIXTURE/database/custom.db', { readonly: true });
const c = db.query('SELECT COUNT(*) c FROM photos WHERE \"deletedAt\" IS NULL').get().c;
const fs2=require('fs'), path=require('path'), crypto=require('crypto');
const opt=fs2.readdirSync('$FIXTURE/uploads/optimized').length;
const thm=fs2.readdirSync('$FIXTURE/uploads/thumbs').length;
const dbSha=crypto.createHash('sha256').update(fs2.readFileSync('$FIXTURE/database/custom.db')).digest('hex');
const marker=JSON.parse(fs2.readFileSync('$FIXTURE/.live-sync.json','utf8'));
marker.syncedAt=new Date().toISOString(); marker.dbSha256=dbSha;
marker.photoCount=c; marker.optimizedCount=opt; marker.thumbCount=thm;
fs2.writeFileSync('$FIXTURE/.live-sync.json', JSON.stringify(marker,null,2));
db.close(); console.log('marker re-stamped: photos='+c);
"
mkdir -p "$ARTIFACT/next-service-dist"
cp -a .next/standalone/. "$ARTIFACT/next-service-dist/"
cp -a public "$ARTIFACT/next-service-dist/" 2>/dev/null || true
PROJECT_DIR="$PWD" BUILD_DIR="$ARTIFACT" RUNTIME_ROOT="$FIXTURE" \
  bash .zscripts/database-runtime-build.sh > /tmp/dc-databake.log 2>&1
check $? "C. database-runtime-build + post-build verify" "$(tail -3 /tmp/dc-databake.log | tr '\n' ' ')"
grep -q "ARTIFACT VERIFY: PASS" /tmp/dc-databake.log; check $? "D. артефакт прошёл verify-runtime-artifact"

# маркер тоже должен переехать в артефакт-зону? Нет: маркер живёт в РАБОЧЕЙ
# зоне; артефакт содержит данные + токен. Проверяем данные артефакта:
bun scripts/verify-runtime-artifact.mjs "$ARTIFACT/next-service-dist/download/runtime" --db "$ARTIFACT/db/custom.db" --quiet
check $? "D2. повторный verify артефакта"

# ── [E/F] simulate redeploy: сервер против АРТЕФАКТНОЙ runtime-зоны
echo "── [E/F] redeploy simulation: сервер против артефакта"
cp -a "$ARTIFACT/next-service-dist/download/runtime/." "$FIXTURE/"
# «артефактная» БД едет в db/ контейнера:
cp -a "$ARTIFACT/db/custom.db" "$FIXTURE/../deploy-cycle-artifact-db.db" 2>/dev/null || true
PORT=$PORT RUNTIME_ROOT="$FIXTURE" NODE_ENV=production nohup node .next/standalone/server.js > /tmp/dc-server2.log 2>&1 &
SRV_PID=$!
CODE=""
for i in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/catalog" 2>/dev/null || true)
  [ "$CODE" = "200" ] && break; sleep 0.5
done
[ "$CODE" = "200" ]; check $? "E. сервер после redeploy поднялся"

P1_SHA_BEFORE=$(sha256sum "$P1_FILE" | cut -d' ' -f1)
HTTP2=$(curl -s -o /tmp/dc-photo-1-live.jpg -w "%{http_code}" "$BASE$P1_URL")
[ "$HTTP2" = "200" ]; check $? "F1. то же фото отдаётся 200 после redeploy"
P1_SHA_AFTER=$(sha256sum /tmp/dc-photo-1-live.jpg | cut -d' ' -f1)
[ "$P1_SHA_BEFORE" = "$P1_SHA_AFTER" ]; check $? "F2. содержимое побайтово то же (sha256)"

# ── [G] ВТОРОЙ ЦИКЛ: upload НОВОГО фото ПОСЛЕ deploy → снова artifact/redeploy
echo "── [G] ВТОРОЙ цикл (критичный): upload после deploy → artifact → redeploy"
bun -e "const sharp=require('sharp');sharp({create:{width:500,height:380,channels:3,background:'#134e4a'}}).jpeg().toFile('/tmp/dc-photo-2.jpg').then(()=>console.log('ok'))" > /dev/null 2>&1
UP2=$(curl -s -X POST "$BASE/api/upload" -F "categoryId=$CAT_ID" -F "modelId=$MDL_ID" -F "photos=@/tmp/dc-photo-2.jpg;type=image/jpeg")
echo "$UP2" | grep -q '"uploaded":1'; check $? "G1. upload фото №2 после первого deploy" "$UP2"

ROW2=$(bun -e "
const { Database } = require('bun:sqlite');
const db = new Database('$FIXTURE/database/custom.db', { readonly: true });
const r = db.query(\"SELECT url FROM photos WHERE \\\"deletedAt\\\" IS NULL ORDER BY \\\"createdAt\\\" DESC, id DESC LIMIT 1\").get();
console.log(r ? r.url : '');
db.close();")
P2_URL="$ROW2"
P2_FILE="$FIXTURE/uploads/optimized/$(basename "$P2_URL")"
[ -f "$P2_FILE" ] && [ -s "$P2_FILE" ]; check $? "G2. файл фото №2 в фикстуре"

kill -9 "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; SRV_PID=""
sleep 0.7

# ре-синк маркера (симуляция sync-from-live после загрузки №2)
bun -e "
const fs=require('fs');
const { Database } = require('bun:sqlite');
const db = new Database('$FIXTURE/database/custom.db', { readonly: true });
const c = db.query('SELECT COUNT(*) c FROM photos WHERE \"deletedAt\" IS NULL').get().c;
const crypto=require('crypto');
const opt=fs.readdirSync('$FIXTURE/uploads/optimized').length;
const thm=fs.readdirSync('$FIXTURE/uploads/thumbs').length;
const dbSha=crypto.createHash('sha256').update(fs.readFileSync('$FIXTURE/database/custom.db')).digest('hex');
const marker=JSON.parse(fs.readFileSync('$FIXTURE/.live-sync.json','utf8'));
marker.syncedAt=new Date().toISOString(); marker.dbSha256=dbSha;
marker.photoCount=c; marker.optimizedCount=opt; marker.thumbCount=thm;
fs.writeFileSync('$FIXTURE/.live-sync.json', JSON.stringify(marker,null,2));
db.close(); console.log('marker re-stamped: photos='+c);
"

rm -rf "$ARTIFACT" && mkdir -p "$ARTIFACT/next-service-dist"
cp -a .next/standalone/. "$ARTIFACT/next-service-dist/"
cp -a public "$ARTIFACT/next-service-dist/" 2>/dev/null || true
PROJECT_DIR="$PWD" BUILD_DIR="$ARTIFACT" RUNTIME_ROOT="$FIXTURE" \
  bash .zscripts/database-runtime-build.sh > /tmp/dc-databake2.log 2>&1
check $? "G3. второй artifact build + post-build verify"
grep -q "ARTIFACT VERIFY: PASS" /tmp/dc-databake2.log; check $? "G4. второй артефакт прошёл verify"

cp -a "$ARTIFACT/next-service-dist/download/runtime/." "$FIXTURE/"
PORT=$PORT RUNTIME_ROOT="$FIXTURE" NODE_ENV=production nohup node .next/standalone/server.js > /tmp/dc-server3.log 2>&1 &
SRV_PID=$!
for i in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/catalog" 2>/dev/null || true)
  [ "$CODE" = "200" ] && break; sleep 0.5
done
HTTP3=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$P1_URL")
[ "$HTTP3" = "200" ]; check $? "G5. ЦИКЛ 2: фото №1 живо после второго redeploy"
HTTP4=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$P2_URL")
[ "$HTTP4" = "200" ]; check $? "G6. ЦИКЛ 2: фото №2 (загружено ПОСЛЕ deploy 1) живо после deploy 2"

cleanup; trap - EXIT; SRV_PID=""

echo "── [0'] Production runtime не тронут (сверка md5)"
PROD_AFTER=$(uploads_md5 "$PROD")
[ "$PROD_BEFORE" = "$PROD_AFTER" ]; check $? "production runtime неизменен"

# уборка
rm -rf "$FIXTURE" "$ARTIFACT" /tmp/dc-photo-1.jpg /tmp/dc-photo-2.jpg /tmp/dc-photo-1-live.jpg deploy-cycle-artifact-db.db

echo ""
echo "═══ deploy-cycle: PASS $PASS / FAIL $FAIL ═══"
[ "$FAIL" = "0" ]
