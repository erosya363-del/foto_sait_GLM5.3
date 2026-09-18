#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# test-live-sync-race.sh — ТЕСТ ГОНКИ, КОТОРАЯ УНИЧТОЖИЛА ФОТО (PART 1.1 §10).
#
# Воспроизводит production-flow В ИЗОЛЯЦИИ (production runtime read-only):
#
#   A. live-фикстура: 26 живых фото + 1 фото в корзине (старше 30 дней) + токен
#   B. IN-FLIGHT WRITE DRAIN (§10.1): реальный writer держит lease
#      (beginRuntimeWrite из production-кода) → deploy-lock ЖДЁТ → lease
#      освобождён → lock отвечает ok, activeWriters = 0
#   C. ПОД LOCK: upload/fabric-photo/admin POST/admin DELETE → 423
#      DEPLOY_LOCKED; счётчики и файлы НЕ изменились;
#      GET view=trash — 200, autoPurged=0, физического удаления НЕТ (§2.4);
#      renew СВОИМ lockId → ok (REV.2 п.2), ЧУЖИМ → 409 LOCK_NOT_RENEWABLE
#   D. FINAL SYNC под lock (DEPLOY_LOCK_ID) → маркер с lockId
#   E. ARTIFACT BUILD (database-runtime-build.sh) + post-build verify
#   F. явный verify-runtime-artifact
#   G. UNLOCK → upload снова работает (200); renew после unlock → 409
#      LOCK_NOT_RENEWABLE (нет lock — продлить нельзя, REV.2 п.2)
#   H. MARKER RACE (§10.2): wrong lockId / dbSha mismatch / нет маркера /
#      нет БД / битый файл → DEPLOY BLOCKED; валидная зона → PASS
#   I. MANIFEST A/B (§7): «live изменился во время синка» → sync FAIL,
#      приёмник НЕ заменён
#   J. SYMLINK HARDENING (§9): symlink-файл → verify FAIL; сирота-symlink
#      не считается media-файлом (нет ложного срабатывания)
#   K. production не тронут (md5 до/после)
#
# Запуск: bash scripts/test-live-sync-race.sh   (требует .next/standalone)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=3202
BASE="http://localhost:${PORT}"
TOOL="$PWD/tool-results"
FIXTURE="$TOOL/race-live"          # «живой сайт»
LOCAL="$TOOL/race-local"           # локальная зона (приёмник final sync)
ARTIFACT="$TOOL/race-artifact"
SNAP="$TOOL/race-local-snap"
PROD="download/runtime"
TOKEN="test-race-token-$(date +%s)"
PHOTO_LIVE=26

PASS=0; FAIL=0
check() { if [ "$1" = "0" ]; then PASS=$((PASS+1)); echo "  ✓ $2"; else FAIL=$((FAIL+1)); echo "  ✗ $2${3:+ — $3}"; fi }

prod_md5() { (cd "$1" && find uploads database -type f -exec md5sum {} \; 2>/dev/null | sort -k2 | md5sum | cut -d' ' -f1); }

SRV_PID=""
FAKE_PID=""
cleanup() {
  [ -n "$SRV_PID" ] && kill -9 "$SRV_PID" 2>/dev/null
  [ -n "$FAKE_PID" ] && kill -9 "$FAKE_PID" 2>/dev/null
  for p in $(ss -tlnp 2>/dev/null | grep -E ":(${PORT}|3203) " | grep -oE "pid=[0-9]+" | cut -d= -f2 | sort -u); do
    kill -9 "$p" 2>/dev/null || true
  done
}
trap cleanup EXIT

echo "── [0] Production runtime не тронут (снимок md5)"
PROD_BEFORE=$(prod_md5 "$PROD")

# ═══════════ A. ФИКСТУРА «LIVE»: 26 фото + корзина + токен ═══════════
echo "── [A] Фикстура live (26 живых фото + 1 в корзине 40 дней)"
rm -rf "$FIXTURE" "$LOCAL" "$ARTIFACT" "$SNAP"
mkdir -p "$(dirname "$FIXTURE")" "$FIXTURE/database" "$FIXTURE/uploads/optimized" "$FIXTURE/uploads/thumbs"
cp db/schema-template-empty.db "$FIXTURE/database/custom.db"
printf '%s\n' "$TOKEN" > "$FIXTURE/.sync-token"

SEED_MANIFEST="$FIXTURE" bun -e "
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Database } = require('bun:sqlite');
const root = process.env.SEED_MANIFEST;
const dbFile = path.join(root, 'database', 'custom.db');
const db = new Database(dbFile);
const now = Date.now();
// ВАЖНО: только bind-параметры — bun:sqlite молча падает на inline-кириллице в SQL
db.query('INSERT INTO categories (id, name, active, sortOrder) VALUES (?, ?, ?, ?)').run('racecat', 'RaceCat', 1, 0);
db.query('INSERT INTO models (id, name, active, sortOrder, categoryId) VALUES (?, ?, ?, ?, ?)').run('racemodel', 'RaceModel', 1, 0, 'racecat');
db.query('INSERT INTO materials (id, name, type, active) VALUES (?, ?, ?, ?)').run('racemat', 'RaceMat', 'Ткань', 1);
db.query('INSERT INTO product_variants (id, categoryId, modelId, active, "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)').run('racevar', 'racecat', 'racemodel', 1, now, now);
(async () => {
  try {
    const colors = ['#0f766e','#134e4a','#115e59','#047857','#065f46','#064e3b','#14b8a6','#0d9488','#0f766e','#115e59'];
    for (let i = 1; i <= 26; i++) {
      const opt = 'seed-' + String(i).padStart(2, '0') + '.jpg';
      const thm = 'seed-' + String(i).padStart(2, '0') + '-t.jpg';
      const color = colors[i % colors.length];
      await sharp({ create: { width: 320, height: 220, channels: 3, background: color } }).jpeg().toFile(path.join(root, 'uploads/optimized', opt));
      await sharp({ create: { width: 160, height: 110, channels: 3, background: color } }).jpeg().toFile(path.join(root, 'uploads/thumbs', thm));
      db.query('INSERT INTO photos (id, variantId, url, "thumbUrl", sortOrder, "createdAt") VALUES (?, ?, ?, ?, ?, ?)')
        .run('racephoto-' + i, 'racevar', '/api/media/optimized/' + opt, '/api/media/thumbs/' + thm, i, now);
    }
    // корзина: фото старше 30 дней — autoPurgeTrash обязан был бы его удалить
    const opt = 'seed-trash.jpg', thm = 'seed-trash-t.jpg';
    await sharp({ create: { width: 320, height: 220, channels: 3, background: '#7f1d1d' } }).jpeg().toFile(path.join(root, 'uploads/optimized', opt));
    await sharp({ create: { width: 160, height: 110, channels: 3, background: '#7f1d1d' } }).jpeg().toFile(path.join(root, 'uploads/thumbs', thm));
    db.query('INSERT INTO photos (id, variantId, url, "thumbUrl", sortOrder, "createdAt", "deletedAt") VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('racetrash', 'racevar', '/api/media/optimized/' + opt, '/api/media/thumbs/' + thm, 99, now - 40 * 864e5, now - 40 * 864e5);
    db.close();
    console.log('seeded: 26 live + 1 trash');
    process.exit(0);
  } catch (e) {
    console.error('SEED ERROR:', e && (e.stack || e.message));
    process.exit(1);
  }
})();
" || { echo "✗ сид фикстуры упал"; exit 1; }

# ═══════════ СЕРВЕР (standalone, изолированная зона) ═══════════
[ -f .next/standalone/server.js ] || { echo "✗ нет .next/standalone — сначала bun run build"; exit 1; }
PORT=$PORT RUNTIME_ROOT="$FIXTURE" NODE_ENV=production nohup node .next/standalone/server.js > /tmp/race-server.log 2>&1 &
SRV_PID=$!
CODE=""
for i in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/catalog" 2>/dev/null || true)
  [ "$CODE" = "200" ] && break; sleep 0.5
done
[ "$CODE" = "200" ]; check $? "сервер поднялся на :$PORT (изолированная зона)"

AUTH=(-H "X-Sync-Token: $TOKEN")
PHOTOS_NOW() { bun -e "
const { Database } = require('bun:sqlite');
const db = new Database('$1', { readonly: true });
console.log(db.query('SELECT COUNT(*) c FROM photos WHERE \"deletedAt\" IS NULL').get().c);
db.close();"; }

# ── A. манифест: 26 живых (корзина НЕ считается) ──
curl -sS "${AUTH[@]}" "$BASE/api/admin/export" -o /tmp/race-manifest.json
P=$(MANIFEST=/tmp/race-manifest.json bun -e "const m=JSON.parse(require('fs').readFileSync(process.env.MANIFEST,'utf8'));console.log(m.db.photos)")
OPTF=$(ls -1 "$FIXTURE/uploads/optimized" | wc -l | tr -d ' ')
[ "$P" = "$PHOTO_LIVE" ]; check $? "A. манифест: живых фото = $PHOTO_LIVE (корзина не учитывается)" "got $P"
[ "$OPTF" = "27" ]; check $? "A. файлов optimized = 27 (26+1 trash)" "got $OPTF"

# ═══════════ B. §10.1 IN-FLIGHT WRITE DRAIN ═══════════
echo "── [B] §10.1 writer держит lease → deploy-lock ДОЖИДАЕТСЯ"
RELEASE="$TOOL/race-release.tmp"; STATE="$TOOL/race-state.tmp"
rm -f "$RELEASE" "$STATE"
RUNTIME_ROOT="$FIXTURE" nohup bun scripts/lease-holder.ts test-slow-writer "$RELEASE" "$STATE" > /tmp/race-holder.log 2>&1 &
HOLDER_PID=$!
HELD=""
for i in $(seq 1 100); do
  [ -f "$STATE" ] && HELD="$(cat "$STATE")" && case "$HELD" in HELD:*|LOCKED) break;; esac
  sleep 0.1
done
case "$HELD" in
  HELD:*) check 0 "B1. writer получил lease (реальный beginRuntimeWrite)" "$HELD"; ;;
  *)      check 1 "B1. writer получил lease (реальный beginRuntimeWrite)" "$HELD"; ;;
esac

LOCK_START=$(date +%s%N)
curl -sS "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "$BASE/api/admin/deploy-lock" \
  -d '{"action":"lock","ttlSec":1800,"owner":"race-test"}' -o /tmp/race-lock.json &
LOCK_CURL_PID=$!
sleep 1.2
if kill -0 "$LOCK_CURL_PID" 2>/dev/null; then
  check 0 "B2. lock ЖДЁТ активный writer (спустя 1.2 c ответа ещё нет)"
else
  check 1 "B2. lock ЖДЁТ активный writer (спустя 1.2 c ответа ещё нет)" "ответил мгновенно — гонка!"
fi
touch "$RELEASE"   # writer завершается → lease удаляется
LOCK_OK=""
for i in $(seq 1 150); do
  [ -s /tmp/race-lock.json ] && break; sleep 0.1
done
wait "$LOCK_CURL_PID" 2>/dev/null || true
LOCK_END=$(date +%s%N)
LOCK_MS=$(( (LOCK_END - LOCK_START) / 1000000 ))
LOCK_ID="$(LOCK_ID_ONLY=1 bun -e "try{console.log(JSON.parse(require('fs').readFileSync('/tmp/race-lock.json','utf8')).lockId||'')}catch{console.log('')}")"
ACTIVE="$(ACTIVE_ONLY=1 bun -e "try{console.log(String(JSON.parse(require('fs').readFileSync('/tmp/race-lock.json','utf8')).activeWriters ?? ''))}catch{console.log('')}")"
[ -n "$LOCK_ID" ]; check $? "B3. после release lock ответил ok (lockId получен)" "lockId=$LOCK_ID activeWriters=$ACTIVE"
[ "$ACTIVE" = "0" ]; check $? "B4. activeWriters = 0 (drain завершён)" "got $ACTIVE"
[ "$LOCK_MS" -ge 1000 ]; check $? "B5. lock действительно ждал (${LOCK_MS} мс ≥ 1000)"
kill -9 "$HOLDER_PID" 2>/dev/null || true
wait "$HOLDER_PID" 2>/dev/null || true

# ═══════════ C. ПОД LOCK: все мутации → 423 ═══════════
echo "── [C] Под lock: мутации отклонены (423), данные не меняются"
bun -e "const sharp=require('sharp');sharp({create:{width:480,height:320,channels:3,background:'#b45309'}}).jpeg().toFile('/tmp/race-upload.jpg').then(()=>console.log('ok'))" >/dev/null 2>&1

UP_CODE=$(curl -s -o /tmp/race-up.json -w "%{http_code}" -X POST "$BASE/api/upload" \
  -F "categoryId=racecat" -F "modelId=racemodel" -F "photos=@/tmp/race-upload.jpg;type=image/jpeg")
UP_BODY="$(cat /tmp/race-up.json)"
echo "$UP_BODY" | grep -q '"code":"DEPLOY_LOCKED"'; C1=$?
[ "$UP_CODE" = "423" ] && [ $C1 = 0 ]; check $? "C1. upload под lock → HTTP 423 DEPLOY_LOCKED" "HTTP=$UP_CODE body=$UP_BODY"

FP_CODE=$(curl -s -o /tmp/race-fp.json -w "%{http_code}" -X POST "$BASE/api/fabric-photo" \
  -F "materialId=racemat" -F "photo=@/tmp/race-upload.jpg;type=image/jpeg")
echo "$(cat /tmp/race-fp.json)" | grep -q 'DEPLOY_LOCKED'; C2=$?
[ "$FP_CODE" = "423" ] && [ $C2 = 0 ]; check $? "C2. fabric-photo под lock → 423" "HTTP=$FP_CODE"

AD_CODE=$(curl -s -o /tmp/race-ad.json -w "%{http_code}" -X POST "$BASE/api/admin" \
  -H 'Content-Type: application/json' -d '{"entity":"category","action":"create","name":"RaceLocked"}')
echo "$(cat /tmp/race-ad.json)" | grep -q 'DEPLOY_LOCKED'; C3=$?
[ "$AD_CODE" = "423" ] && [ $C3 = 0 ]; check $? "C3. admin POST под lock → 423" "HTTP=$AD_CODE"

DEL_CODE=$(curl -s -o /tmp/race-del.json -w "%{http_code}" -X DELETE "$BASE/api/admin?photoId=racephoto-1")
[ "$DEL_CODE" = "423" ]; check $? "C3b. admin DELETE под lock → 423" "HTTP=$DEL_CODE"

CNT=$(PHOTOS_NOW "$FIXTURE/database/custom.db")
[ "$CNT" = "$PHOTO_LIVE" ]; check $? "C4. photo count НЕ изменился ($PHOTO_LIVE)" "got $CNT"
OPTF2=$(ls -1 "$FIXTURE/uploads/optimized" | wc -l | tr -d ' ')
[ "$OPTF2" = "27" ]; check $? "C5. новых media-файлов НЕТ (27)" "got $OPTF2"

# ── C6. §2.4: GET view=trash под lock НЕ мутирует (autoPurge пропущен) ──
TRASH=$(curl -sS "${AUTH[@]}" "$BASE/api/admin?view=trash")
AUTO="$(TRASH_JSON="$TRASH" bun -e "const t=JSON.parse(process.env.TRASH_JSON||'{}');console.log(String(t.autoPurged))")"
TRASH_N="$(TRASH_JSON="$TRASH" bun -e "const t=JSON.parse(process.env.TRASH_JSON||'{}');console.log(String((t.items||[]).length))")"
[ "$AUTO" = "0" ] && [ "$TRASH_N" = "1" ]; check $? "C6. GET trash под lock: autoPurged=0, фото в корзине на месте ($TRASH_N)" "autoPurged=$AUTO items=$TRASH_N"
[ -s "$FIXTURE/uploads/optimized/seed-trash.jpg" ]; check $? "C7. файл trash-фото физически существует (не удалён)"

# ── C8/C9. REV.2 п.2: action:"renew" — продление действующего lock ──
RN=$(curl -sS "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "$BASE/api/admin/deploy-lock" \
  -d "{\"action\":\"renew\",\"lockId\":\"$LOCK_ID\",\"ttlSec\":1800}")
RN_OK="$(RENEW_JSON="$RN" bun -e "try{const j=JSON.parse(process.env.RENEW_JSON);console.log(String(j.ok==='true'||j.ok===true))}catch{console.log('false')}")"
RN_TTL="$(RENEW_JSON="$RN" bun -e "try{const j=JSON.parse(process.env.RENEW_JSON);const t=(Date.parse(j.expiresAt)-Date.now())/1000;console.log(t>1500&&t<2100?'ok':'bad:'+t)}catch(e){console.log('err')}")"
[ "$RN_OK" = "true" ] && [ "$RN_TTL" = "ok" ]; check $? "C8. renew СВОИМ lockId → ok:true, expiresAt ≈ +1800c" "resp=$RN ttl=$RN_TTL"

RN_BAD_CODE=$(curl -s -o /tmp/race-rnbad.json -w "%{http_code}" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -X POST "$BASE/api/admin/deploy-lock" -d '{"action":"renew","lockId":"wrong-id","ttlSec":1800}')
grep -q 'LOCK_NOT_RENEWABLE' /tmp/race-rnbad.json; RNB=$?
[ "$RN_BAD_CODE" = "409" ] && [ $RNB = 0 ]; check $? "C9. renew ЧУЖИМ lockId → 409 LOCK_NOT_RENEWABLE (fail-closed)" "HTTP=$RN_BAD_CODE $(cat /tmp/race-rnbad.json)"

# ═══════════ D. FINAL SYNC ПОД LOCK ═══════════
echo "── [D] §10.3 FINAL SYNC под lock (production flow)"
# В production build.sh токен берётся из существующей $RUNTIME_ZONE/.sync-token;
# здесь приёмник пустой — передаём токен явно (как env, тот же приоритет-#1).
SYNC_EXPORT_TOKEN="$TOKEN" RUNTIME_ROOT="$LOCAL" DEPLOY_LOCK_ID="$LOCK_ID" \
  bash scripts/sync-from-live.sh "$BASE" --yes > /tmp/race-sync.log 2>&1
D=$?
[ $D = 0 ]; check $? "D1. final sync под lock завершился" "$(tail -2 /tmp/race-sync.log | tr '\n' ' ')"
MK_LOCK="$(bun -e "try{console.log(JSON.parse(require('fs').readFileSync('$LOCAL/.live-sync.json','utf8')).lockId||'')}catch{console.log('')}")"
[ "$MK_LOCK" = "$LOCK_ID" ]; check $? "D2. маркер привязан к deploy-lock (§5)" "marker.lockId=$MK_LOCK"
LCNT=$(PHOTOS_NOW "$LOCAL/database/custom.db")
[ "$LCNT" = "$PHOTO_LIVE" ]; check $? "D3. локальная зона = данным live ($PHOTO_LIVE фото)" "got $LCNT"

# ═══════════ E. ARTIFACT BUILD (LOCK → SYNC → BUILD) ═══════════
echo "── [E] §10.3 ARTIFACT BUILD из зоны, синхронизированной под lock"
mkdir -p "$ARTIFACT/next-service-dist"
cp -a .next/standalone/. "$ARTIFACT/next-service-dist/"
cp -a public "$ARTIFACT/next-service-dist/" 2>/dev/null || true
PROJECT_DIR="$PWD" BUILD_DIR="$ARTIFACT" RUNTIME_ROOT="$LOCAL" DEPLOY_LOCK_ID="$LOCK_ID" \
  bash .zscripts/database-runtime-build.sh > /tmp/race-databake.log 2>&1
[ $? = 0 ]; check $? "E1. database-runtime-build (guard c DEPLOY_LOCK_ID + bake)" "$(tail -3 /tmp/race-databake.log | tr '\n' ' ')"
grep -q "ARTIFACT VERIFY: PASS" /tmp/race-databake.log; check $? "E2. post-build verify артефакта PASS"
bun scripts/verify-runtime-artifact.mjs "$ARTIFACT/next-service-dist/download/runtime" --db "$ARTIFACT/db/custom.db" --quiet
check $? "F. повторный verify-runtime-artifact артефакта"

# ═══════════ G. UNLOCK → мутации снова работают ═══════════
echo "── [G] Unlock → live снова принимает записи"
UN=$(curl -sS "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "$BASE/api/admin/deploy-lock" \
  -d "{\"action\":\"unlock\",\"lockId\":\"$LOCK_ID\"}")
echo "$UN" | grep -q '"ok":true'; check $? "G1. unlock СВОИМ lockId" "$UN"
UP2=$(curl -s -X POST "$BASE/api/upload" -F "categoryId=racecat" -F "modelId=racemodel" -F "photos=@/tmp/race-upload.jpg;type=image/jpeg")
echo "$UP2" | grep -q '"uploaded":1'; check $? "G2. upload после unlock → 200 (uploaded:1)" "$UP2"
CNT2=$(PHOTOS_NOW "$FIXTURE/database/custom.db")
[ "$CNT2" = "27" ]; check $? "G3. live теперь 27 живых фото" "got $CNT2"

# ── G4. REV.2 п.2: renew ПОСЛЕ unlock — продлить нечего (fail-closed) ──
RN2_CODE=$(curl -s -o /tmp/race-rn2.json -w "%{http_code}" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -X POST "$BASE/api/admin/deploy-lock" -d "{\"action\":\"renew\",\"lockId\":\"$LOCK_ID\",\"ttlSec\":1800}")
grep -q 'LOCK_NOT_RENEWABLE' /tmp/race-rn2.json; RN2=$?
[ "$RN2_CODE" = "409" ] && [ $RN2 = 0 ]; check $? "G4. renew после unlock → 409 LOCK_NOT_RENEWABLE (нет lock — продлить нельзя)" "HTTP=$RN2_CODE"

# ═══════════ H. §10.2 MARKER RACE — build БЛОКИРУЕТСЯ ═══════════
echo "── [H] §10.2 marker race: каждое нарушение → DEPLOY BLOCKED"
rm -rf "$SNAP"; cp -a "$LOCAL" "$SNAP"
W="$TOOL/race-w"
wzone() { rm -rf "$W"; cp -a "$SNAP" "$W"; }

wzone
DEPLOY_LOCK_ID="wrong-lock-0000" bun scripts/check-deploy-freshness.mjs "$W" > /tmp/race-h1.log 2>&1
[ $? != 0 ]; check $? "H1. wrong lockId → BLOCK" "$(head -2 /tmp/race-h1.log | tr '\n' ' ')"

wzone
bun -e "
const { Database } = require('bun:sqlite');
const db = new Database('$W/database/custom.db');
db.query('INSERT INTO photos (id, variantId, url, \"thumbUrl\", sortOrder, \"createdAt\") VALUES (?, ?, ?, ?, ?, ?)')
  .run('race-extra', 'racevar', '/api/media/optimized/seed-01.jpg', '/api/media/thumbs/seed-01-t.jpg', 50, Date.now());
db.close();
" > /tmp/race-h2-insert.log 2>&1 || { echo "✗ H2: инсерт не сработал: $(cat /tmp/race-h2-insert.log)"; }
DEPLOY_LOCK_ID="$LOCK_ID" bun scripts/check-deploy-freshness.mjs "$W" > /tmp/race-h2.log 2>&1
[ $? != 0 ]; check $? "H2. dbSha mismatch (runtime изменился после sync) → BLOCK" "$(grep -o 'runtime DB изменилась.*' /tmp/race-h2.log | head -1)"

wzone
rm -f "$W/.live-sync.json"
bun scripts/check-deploy-freshness.mjs "$W" > /tmp/race-h3.log 2>&1
[ $? != 0 ]; check $? "H3. нет маркера → BLOCK"

wzone
mv "$W/database/custom.db" "$W/database/custom.db.keep"
bun scripts/check-deploy-freshness.mjs "$W" > /tmp/race-h4.log 2>&1
[ $? != 0 ]; check $? "H4. нет БД → BLOCK"
mv "$W/database/custom.db.keep" "$W/database/custom.db" 2>/dev/null || true

wzone
: > "$W/uploads/optimized/seed-03.jpg"
bun scripts/check-deploy-freshness.mjs "$W" > /tmp/race-h5.log 2>&1
[ $? != 0 ]; check $? "H5. битый Photo-файл (size=0) → BLOCK"

wzone
DEPLOY_LOCK_ID="$LOCK_ID" bun scripts/check-deploy-freshness.mjs "$W" > /tmp/race-h6.log 2>&1
[ $? = 0 ]; check $? "H6. контроль: валидная зона + верный lockId → PASS" "$(tail -1 /tmp/race-h6.log)"

# ═══════════ I. §7 MANIFEST A/B — live изменился ВО ВРЕМЯ синка ═══════════
echo "── [I] §7 манифест A/B: мутация live во время синка → sync FAIL"
FL="$TOOL/race-fakelive"
rm -rf "$FL"; mkdir -p "$FL/media/optimized" "$FL/media/thumbs"
bun -e "
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const root = '$FL';
(async () => {
  for (let i = 1; i <= 3; i++) {
    const name = \`fl-\${i}.jpg\`;
    const buf = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#1d4ed8' } }).jpeg().toBuffer();
    fs.writeFileSync(path.join(root, 'media/optimized', name), buf);
    fs.writeFileSync(path.join(root, 'media/thumbs', name.replace('.jpg', '-t.jpg')), buf);
  }
})();
" >/dev/null 2>&1
# два манифеста: B отличается sha256/bytes одного файла (мутация во время синка)
SYNC_DB="$FL/custom.db"
cp db/schema-template-empty.db "$SYNC_DB"
bun -e "
const { Database } = require('bun:sqlite');
const crypto = require('crypto');
const fs = require('fs');
const db = new Database('$SYNC_DB');
const now = Date.now();
db.query(\"INSERT INTO categories (id, name, active, sortOrder) VALUES ('flcat','FLCat',1,0)\").run();
db.query(\"INSERT INTO models (id, name, active, sortOrder, categoryId) VALUES ('flmodel','FLModel',1,0,'flcat')\").run();
db.query(\"INSERT INTO product_variants (id, categoryId, modelId, active) VALUES ('flvar','flcat','flmodel',1)\").run();
for (let i = 1; i <= 3; i++) {
  db.query('INSERT INTO photos (id, variantId, url, \"thumbUrl\", sortOrder, \"createdAt\") VALUES (?, ?, ?, ?, ?, ?)')
    .run('flphoto-' + i, 'flvar', '/api/media/optimized/fl-' + i + '.jpg', '/api/media/thumbs/fl-' + i + '-t.jpg', i, now);
}
db.close();
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const entry = (group, name) => ({ name, bytes: fs.statSync('$FL/media/' + group + '/' + name).size, sha256: sha('$FL/media/' + group + '/' + name) });
const files = (group, names) => names.map((n) => entry(group, n));
const opt = files('optimized', ['fl-1.jpg', 'fl-2.jpg', 'fl-3.jpg']);
const thm = files('thumbs', ['fl-1-t.jpg', 'fl-2-t.jpg', 'fl-3-t.jpg']);
const base = { generatedAt: '2026-09-19T10:00:00.000Z', runtimeRoot: 'runtime', db: { photos: 3, variants: 1, categories: 1, models: 1, materials: 0, sizes: 0, tags: 0, stockItems: 0 }, uploads: { optimized: opt, thumbs: thm } };
const a = JSON.parse(JSON.stringify(base));
const b = JSON.parse(JSON.stringify(base));
b.uploads.optimized[1] = { name: 'fl-2.jpg', bytes: 999999, sha256: 'deadbeef'.repeat(8) }; // мутация
fs.writeFileSync('$FL/manifestA.json', JSON.stringify(a));
fs.writeFileSync('$FL/manifestB.json', JSON.stringify(b));
console.log('manifests ready');
"
cat > "$FL/server.mjs" <<'FAKEEOF'
import http from "http";
import fs from "fs";
import path from "path";
const root = process.env.FL_ROOT;
const token = process.env.FL_TOKEN;
let manifestCalls = 0;
const server = http.createServer((req, res) => {
  if (req.headers["x-sync-token"] !== token) { res.writeHead(401); res.end("{}"); return; }
  const url = (req.url || "").split("?")[0];
  if (url === "/api/admin/export" && (req.url || "").includes("part=db")) {
    const body = fs.readFileSync(path.join(root, "custom.db"));
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(body);
    return;
  }
  if (url === "/api/admin/export") {
    manifestCalls++;
    const f = manifestCalls === 1 ? "manifestA.json" : "manifestB.json";
    const body = fs.readFileSync(path.join(root, f));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return;
  }
  const m = (req.url || "").match(/^\/api\/media\/(optimized|thumbs)\/([A-Za-z0-9._-]+)$/);
  if (m) {
    const p = path.join(root, "media", m[1], m[2]);
    if (fs.existsSync(p)) { res.writeHead(200); res.end(fs.readFileSync(p)); }
    else { res.writeHead(404); res.end(); }
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(3203, "127.0.0.1", () => console.log("fake-live ready"));
FAKEEOF
FL_ROOT="$FL" FL_TOKEN="$TOKEN" nohup bun "$FL/server.mjs" > /tmp/race-fakelive.log 2>&1 &
FAKE_PID=$!
for i in $(seq 1 40); do ss -tln 2>/dev/null | grep -q ":3203 " && break; sleep 0.25; done

LI="$TOOL/race-local-ab"
rm -rf "$LI"
SYNC_EXPORT_TOKEN="$TOKEN" RUNTIME_ROOT="$LI" \
  bash scripts/sync-from-live.sh "http://127.0.0.1:3203" --yes > /tmp/race-syncab.log 2>&1
[ $? != 0 ]; check $? "I1. sync FAIL при изменении live между манифестами A и B" "$(grep -o 'LOCK BYPASS.*' /tmp/race-syncab.log | head -1)"
[ ! -f "$LI/.live-sync.json" ]; check $? "I2. приёмник НЕ заменён (маркера нет)" "$(ls "$LI" 2>/dev/null | tr '\n' ' ')"
kill -9 "$FAKE_PID" 2>/dev/null || true; FAKE_PID=""

# ═══════════ J. §9 SYMLINK HARDENING ═══════════
echo "── [J] §9 symlink hardening"
wzone
SKIP=0
# ВАЖНО (§17 — без fake pass): если песочница запрещает СОЗДАНИЕ symlink,
# интеграционные J-проверки честно помечаются SKIP, а не «проходят» вакуумно.
rm -f "$W/uploads/optimized/seed-05.jpg"
if ln -s /etc/hostname "$W/uploads/optimized/seed-05.jpg" 2>/dev/null && [ -L "$W/uploads/optimized/seed-05.jpg" ]; then
  bun scripts/verify-runtime-artifact.mjs "$W" --quiet > /tmp/race-j1.log 2>&1
  [ $? != 0 ]; check $? "J1. symlink вместо media-файла → verify FAIL"
  # (без pipe-граблей: verify обязан выйти 1 — пишем вывод в файл и grep'аем)
  bun scripts/verify-runtime-artifact.mjs "$W" > /tmp/race-j2-full.log 2>&1 || true
  grep -q "SYMLINK" /tmp/race-j2-full.log
  check $? "J2. причина указана (SYMLINK запрещён)"
else
  SKIP=$((SKIP+1)); echo "  ⊘ J1/J2 SKIP: песочница запрещает создание symlink (проверка на deploy-машине)"
fi

wzone
if ln -s /etc/hostname "$W/uploads/optimized/orphan-link.jpg" 2>/dev/null && [ -L "$W/uploads/optimized/orphan-link.jpg" ]; then
  bun scripts/verify-runtime-artifact.mjs "$W" --quiet > /tmp/race-j2.log 2>&1
  [ $? = 0 ]; check $? "J3. сирота-symlink НЕ считается media-файлом (нет ложного FAIL)"
  OPT_COUNTED="$(bun scripts/verify-runtime-artifact.mjs "$W" 2>/dev/null | grep -o 'optimized=[0-9]*' | head -1 | cut -d= -f2)"
  [ "$OPT_COUNTED" = "27" ]; check $? "J4. countFiles не считает symlink (optimized=27)" "got $OPT_COUNTED"
else
  SKIP=$((SKIP+1)); echo "  ⊘ J3/J4 SKIP: песочница запрещает создание symlink (проверка на deploy-машине)"
  # Контрольный тест countFiles БЕЗ symlink всё равно честен: обычный счётчик = 27
  OPT_COUNTED="$(bun scripts/verify-runtime-artifact.mjs "$W" 2>/dev/null | grep -o 'optimized=[0-9]*' | head -1 | cut -d= -f2)"
  [ "$OPT_COUNTED" = "27" ]; check $? "J4b. countFiles: optimized=27 (регрессия счётчика)" "got $OPT_COUNTED"
fi

# ═══════════ K. PRODUCTION НЕ ТРОНУТ ═══════════
cleanup; trap - EXIT; SRV_PID=""; FAKE_PID=""
PROD_AFTER=$(prod_md5 "$PROD")
[ "$PROD_BEFORE" = "$PROD_AFTER" ]; check $? "K. production runtime неизменен (md5)"

rm -rf "$FIXTURE" "$LOCAL" "$ARTIFACT" "$SNAP" "$W" "$LI" "$FL" "$RELEASE" "$STATE" \
  /tmp/race-*.log /tmp/race-*.json /tmp/race-upload.jpg 2>/dev/null

echo ""
echo "═══ live-sync-race: PASS $PASS / FAIL $FAIL${SKIP:+ / SKIP $SKIP} ═══"
[ "$FAIL" = "0" ]
