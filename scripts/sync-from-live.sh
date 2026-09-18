#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# sync-from-live.sh — возврат данных живого сайта в рабочую runtime-зону.
#
# ЗАЧЕМ: живой контейнер — единственное место, где существуют фото, загруженные
# через сайт. Редеплой собирает НОВЫЙ контейнер из артефакта и уничтожает диск
# старого. Поэтому ПЕРЕД каждым редеплоем данные нужно вернуть в рабочую
# область — тогда следующий деплой выпечет их в артефакт
# (.zscripts/database-runtime-build.sh) и ничего не потеряется.
#
# ПРАВИЛО ПОРЯДКА (критично!):
#   sync-from-live → локальные правки → проверка → редеплой
#   Синк ЗАМЕНЯЕТ локальную runtime-зону данными живого сайта. Локальные
#   изменения, сделанные ПОСЛЕ последнего деплоя и ещё не выпущенные, при
#   синке пропадут (останутся только в страховочном бэкапе из шага 1).
#
# Шаги:
#   1. бэкап текущей runtime-зоны (scripts/backup-runtime.sh, метка pre-sync);
#      если целевая runtime-зона ещё пуста — бэкап пропускается с предупреждением
#   2. манифест живого сайта: GET /api/admin/export (счётчики + sha256 файлов)
#   3. скачивание БД: GET /api/admin/export?part=db → integrity_check →
#      сверка счётчика живых фото с манифестом
#   4. скачивание всех файлов фото по манифесту через /api/media/*,
#      сверка sha256 каждого файла
#   5. атомарная замена: uploads переезжает mv'ом целиком, БД — mv поверх
#      старой; сироты-файлы исчезают вместе со старым каталогом
#
# Fail-closed:
#   - без явного BASE_URL скрипт НЕ работает (никаких дефолтов на production);
#   - без токена экспорта НЕ работает (PART 1.1 §8: автогенерация ЗАПРЕЩЕНА —
#     случайный токен live не знает → HTTP 401; только ЯВНЫЙ bootstrap);
#   - манифест сверяется ДВАЖДЫ (A до скачивания, B перед заменой — PART 1.1
#     §7): fingerprint (счётчики БД + name/bytes/sha256 всех файлов) изменился
#     → «live менялся во время синка» (lock bypass/race) → ЗАМЕНА ЗАПРЕЩЕНА;
#   - любая ошибка проверки → EXIT 1, локальная зона не трогается (замена
#     происходит только после того, как ВСЕ данные уже скачаны и сверены).
#
# PRODUCTION-ПАЙПЛАЙН (PART 1.1 §4): вызывается СБОРКОЙ (.zscripts/build.sh)
# АВТОМАТИЧЕСКИ под живым deploy-lock — пользователю НЕ нужно помнить про
# ручной синк перед деплоем. Переменная DEPLOY_LOCK_ID (id активного lock'а)
# записывается в маркер (.live-sync.json.lockId) — deploy-guard затем требует
# marker.lockId === DEPLOY_LOCK_ID (ТЗ §5).
#
# Использование:
#   bash scripts/sync-from-live.sh <BASE_URL> [--yes] [--bootstrap-token]
#     <BASE_URL>  напр. https://<site>.space-z.ai
#     --yes       без интерактивного подтверждения (для автоматизации)
#     --bootstrap-token  ЯВНОЕ разрешение сгенерировать токен — ТОЛЬКО для
#                 первого перехода со старого публичного экспорта (ТЗ §8.1).
#
# Окружение:
#   RUNTIME_ROOT — корень приёмника (по умолчанию <проект>/download/runtime);
#                  удобно для тестов на изолированной папке.
#   SYNC_EXPORT_TOKEN — токен доступа к /api/admin/export живого сайта
#                  (требуется; отправляется как X-Sync-Token. НЕ коммитить).
#   SYNC_TOKEN_BOOTSTRAP=1 — эквивалент --bootstrap-token (первый переход).
#   DEPLOY_LOCK_ID — id активного deploy-lock (пишется в маркер; ставит
#                  сборка). Без lock'а поле будет пустым — ручной синк вне
#                  пайплайна остаётся возможен, но деплой под lock его НЕ примет.
#
# РЕЗУЛЬТАТ (ТЗ CRITICAL STABILITY 2.5): после успешного синка в runtime-зону
# пишется маркер .live-sync.json (source/syncedAt/dbSha256/manifestSha256/
# photoCount/optimizedCount/thumbCount). Его проверяет deploy-guard
# (scripts/check-deploy-freshness.mjs, вызывается сборкой) — деплой
# несинхронизированной зоны стал НЕВОЗМОЖЕН (fail-closed).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${1:-}"
if [ -z "$BASE_URL" ]; then
    echo "✗ ОТКАЗ: не указан адрес живого сайта (аргумент 1)." >&2
    echo "  Синхронизация — потенциально перезаписывающая операция: цель задаётся" >&2
    echo "  ЯВНО. Пример: bash scripts/sync-from-live.sh https://<site>.space-z.ai" >&2
    exit 1
fi
case "$BASE_URL" in
    http://* | https://*) ;;
    *) echo "✗ ОТКАЗ: BASE_URL должен начинаться с http:// или https://" >&2; exit 1 ;;
esac
BASE_URL="${BASE_URL%/}"

ASSUME_YES=""
BOOTSTRAP_TOKEN=""
for arg in "${@:2}"; do
    [ "$arg" = "--yes" ] && ASSUME_YES=1
    [ "$arg" = "--bootstrap-token" ] && BOOTSTRAP_TOKEN=1
done

RUNTIME_ROOT="${RUNTIME_ROOT:-$PWD/download/runtime}"
DB="$RUNTIME_ROOT/database/custom.db"

echo "── Источник (живой сайт): $BASE_URL"
echo "── Приёмник (runtime):    $RUNTIME_ROOT"
if [ -z "$ASSUME_YES" ]; then
    printf "Заменить локальные runtime-данные данными живого сайта? [y/N] "
    read -r ANSWER
    case "$ANSWER" in
        y | Y | yes | да | Дa | Да) ;;
        *) echo "Отменено"; exit 1 ;;
    esac
fi

TMP="$PWD/tool-results/sync-live-$$"
mkdir -p "$TMP/uploads"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# ТЗ 2.10 + PART 1.1 §8: экспорт живого сайта закрыт токеном. Источник токена
#   (строгий приоритет):
#   1. env SYNC_EXPORT_TOKEN;
#   2. существующий $RUNTIME_ROOT/.sync-token (zero-config, печётся в артефакт);
#   3. ИНАЧЕ — ОТКАЗ. АВТОГЕНЕРАЦИЯ ЗАПРЕЩЕНА (ТЗ §8): после того как live
#      защищён токеном, случайный новый токен сервер не знает → HTTP 401, и
#      молчаливая генерация маскировала бы ошибку. Новый токен создаётся
#      ТОЛЬКО ЯВНЫМ bootstrap'ом первого перехода: env SYNC_TOKEN_BOOTSTRAP=1
#      или флаг --bootstrap-token.
AUTH_ARGS=()
SYNC_TOKEN="${SYNC_EXPORT_TOKEN:-}"
if [ -z "$SYNC_TOKEN" ] && [ -f "$RUNTIME_ROOT/.sync-token" ]; then
    SYNC_TOKEN="$(tr -d '[:space:]' < "$RUNTIME_ROOT/.sync-token")"
    echo "── авторизация экспорта: X-Sync-Token (из $RUNTIME_ROOT/.sync-token)"
fi
if [ -z "$SYNC_TOKEN" ] && [ "${SYNC_TOKEN_BOOTSTRAP:-}" = "1" ]; then
    BOOTSTRAP_TOKEN=1
fi
if [ -z "$SYNC_TOKEN" ]; then
    if [ "$BOOTSTRAP_TOKEN" = "1" ]; then
        # ОДНОКРАТНЫЙ bootstrap первого перехода со старого публичного экспорта.
        SYNC_TOKEN="$(bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
        mkdir -p "$RUNTIME_ROOT"
        printf '%s\n' "$SYNC_TOKEN" > "$RUNTIME_ROOT/.sync-token"
        chmod 600 "$RUNTIME_ROOT/.sync-token" 2>/dev/null || true
        echo "── [BOOTSTRAP] создан токен экспорта: $RUNTIME_ROOT/.sync-token (не коммитить!)"
        echo "   После первого защищённого деплоя автогенерация ЗАПРЕЩЕНА —"
        echo "   СОХРАНИТЕ токен вне Git (platform secret / env / личное хранилище)."
    else
        echo "✗ ОТКАЗ: токен экспорта не найден." >&2
        echo "   Приоритет: env SYNC_EXPORT_TOKEN → $RUNTIME_ROOT/.sync-token" >&2
        echo "   Автогенерация отключена (PART 1.1 §8): случайный токен live не знает → 401." >&2
        echo "   Первый bootstrap (однократно, до первого защищённого деплоя):" >&2
        echo "     SYNC_TOKEN_BOOTSTRAP=1 bash scripts/sync-from-live.sh <BASE_URL> --yes --bootstrap-token" >&2
        exit 1
    fi
fi
AUTH_ARGS=("-H" "X-Sync-Token: $SYNC_TOKEN")

echo "── [1/6] Страховочный бэкап текущей runtime-зоны…"
if [ -f "$DB" ]; then
    RUNTIME_ROOT="$RUNTIME_ROOT" bash scripts/backup-runtime.sh "pre-sync"
else
    echo "    ⚠️  Целевая БД не существует ($DB) — бэкап пропущен (синк в пустую зону)"
fi

echo "── [2/6] Манифест живого сайта (A — ДО скачивания данных)…"
MANIFEST_CODE=$(curl -sS --max-time 60 "${AUTH_ARGS[@]}" "$BASE_URL/api/admin/export" -o "$TMP/manifest.json" -w "%{http_code}" || true)
if [ "$MANIFEST_CODE" != "200" ]; then
    if [ "$MANIFEST_CODE" = "401" ]; then
        echo "✗ Экспорт живого сайта требует токен (HTTP 401)." >&2
        echo "  Задайте SYNC_EXPORT_TOKEN=<токен> в окружении (тот же, что на сервере) и повторите." >&2
    else
        echo "✗ Не удалось получить манифест: $BASE_URL/api/admin/export (HTTP $MANIFEST_CODE)" >&2
    fi
    exit 1
fi

# ── проверки манифеста ──
read -r PHOTOS_LIVE OPT_COUNT THM_COUNT < <(MANIFEST="$TMP/manifest.json" bun -e "
  const m = JSON.parse(require('fs').readFileSync(process.env.MANIFEST, 'utf8'));
  const photos = m?.db?.photos, opt = m?.uploads?.optimized, thm = m?.uploads?.thumbs;
  if (!Number.isInteger(photos) || !Array.isArray(opt) || !Array.isArray(thm)) {
    console.error('manifest: неожиданная структура'); process.exit(1);
  }
  console.log(photos, opt.length, thm.length);
")

echo "    фото в БД: $PHOTOS_LIVE, файлов: optimized=$OPT_COUNT, thumbs=$THM_COUNT"

echo "── [3/6] БД живого сайта…"
DB_CODE=$(curl -sS --max-time 180 "${AUTH_ARGS[@]}" "$BASE_URL/api/admin/export?part=db" -o "$TMP/custom.db" -w "%{http_code}" || true)
if [ "$DB_CODE" != "200" ]; then
    if [ "$DB_CODE" = "401" ]; then
        echo "✗ Экспорт БД требует токен (HTTP 401). Задайте SYNC_EXPORT_TOKEN." >&2
    else
        echo "✗ Не удалось скачать БД (HTTP $DB_CODE)" >&2
    fi
    exit 1
fi

INTEGRITY=$(DB_ABS="$TMP/custom.db" bun -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
  p.\$queryRawUnsafe('PRAGMA integrity_check').then((r) => {
    console.log(String(r[0]?.integrity_check));
    return p.\$disconnect();
  });
")
[ "$INTEGRITY" = "ok" ] || { echo "✗ Скачанная БД не прошла integrity_check: $INTEGRITY" >&2; exit 1; }

PHOTOS_DB=$(DB_ABS="$TMP/custom.db" bun -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
  p.photo.count({ where: { deletedAt: null } }).then((c) => {
    console.log(c); return p.\$disconnect();
  });
")
[ "$PHOTOS_DB" = "$PHOTOS_LIVE" ] || {
    echo "✗ Расхождение: манифест говорит фото=$PHOTOS_LIVE, в скачанной БД живых=$PHOTOS_DB" >&2
    exit 1
}
echo "    целостность БД: ok, живых фото: $PHOTOS_DB — совпадает с манифестом"

echo "── [4/6] Файлы фото ($((OPT_COUNT + THM_COUNT)) шт)…"
MANIFEST="$TMP/manifest.json" BASE_URL="$BASE_URL" TMP="$TMP" bun -e "

  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const m = JSON.parse(fs.readFileSync(process.env.MANIFEST, 'utf8'));
  const base = process.env.BASE_URL.replace(/\/+$/, '');
  const tmp = process.env.TMP;
  let done = 0, failed = 0;
  for (const [group, key] of [['optimized', 'optimized'], ['thumbs', 'thumbs']]) {
    fs.mkdirSync(path.join(tmp, 'uploads', group), { recursive: true });
    for (const f of m.uploads[key]) {
      if (!/^[A-Za-z0-9._-]+$/.test(f.name)) {
        console.error('  ✗ подозрительное имя в манифесте: ' + f.name); failed++; continue;
      }
      const res = await fetch(base + '/api/media/' + group + '/' + encodeURIComponent(f.name));
      if (!res.ok) { console.error('  ✗ ' + f.name + ': HTTP ' + res.status); failed++; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      if (sha !== f.sha256) { console.error('  ✗ ' + f.name + ': sha256 не совпал'); failed++; continue; }
      fs.writeFileSync(path.join(tmp, 'uploads', group, f.name), buf);
      done++;
    }
  }
  console.log('    скачано и сверено: ' + done + (failed ? ', ОШИБОК: ' + failed : ''));
  if (failed > 0 || done !== m.uploads.optimized.length + m.uploads.thumbs.length) process.exit(1);
"

echo "── [5/6] Верификация: live НЕ изменился во время синка (манифест B)…"
# PART 1.1 §7: дополнительная страховка ДАЖЕ при deploy-lock. Перед атомарной
# заменой скачиваем манифест B и сравниваем fingerprint с манифестом A:
#   { db counts; optimized: name+bytes+sha256; thumbs: name+bytes+sha256 }
# (generatedAt/runtimeRoot ИСКЛЮЧЕНЫ — они не являются данными). A ≠ B →
# LOCK BYPASS / гонка → FAIL, локальная зона НЕ заменяется.
MANIFEST_CODE_B=$(curl -sS --max-time 60 "${AUTH_ARGS[@]}" "$BASE_URL/api/admin/export" -o "$TMP/manifest-b.json" -w "%{http_code}" || true)
if [ "$MANIFEST_CODE_B" != "200" ]; then
    echo "✗ Не удалось получить контрольный манифест B (HTTP $MANIFEST_CODE_B)" >&2
    exit 1
fi
FP_RESULT=$(MANIFEST_A="$TMP/manifest.json" MANIFEST_B="$TMP/manifest-b.json" bun -e "
  const fs = require('fs');
  const fp = (p) => {
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    return JSON.stringify({
      db: m.db,
      optimized: (m.uploads?.optimized ?? []).map((f) => [f.name, f.bytes, f.sha256]),
      thumbs: (m.uploads?.thumbs ?? []).map((f) => [f.name, f.bytes, f.sha256]),
    });
  };
  const a = fp(process.env.MANIFEST_A), b = fp(process.env.MANIFEST_B);
  console.log(a === b ? 'MATCH' : 'CHANGED');
")
if [ "$FP_RESULT" != "MATCH" ]; then
    echo "✗ LOCK BYPASS / RACE: live изменился ВО ВРЕМЯ синка (манифест A ≠ B)." >&2
    echo "  Локальная зона НЕ тронута. Повторите синк под действующим deploy-lock" >&2
    echo "  (production-сборка делает это автоматически); проверьте статус lock'а:" >&2
    echo "  GET /api/admin/deploy-lock (токен обязателен)." >&2
    exit 1
fi
echo "    fingerprint A == B — live стабилен, замена безопасна"

echo "── [6/6] Замена runtime-зоны…"
mkdir -p "$RUNTIME_ROOT/database"

# Хеши ДЛЯ МАРКЕРА считаем от скачанных и уже сверенных данных:
# маркер описывает ровно то, что сейчас уедет в runtime-зону (а затем в артефакт)
DB_SHA256=$(sha256sum "$TMP/custom.db" | cut -d' ' -f1)
MANIFEST_SHA256=$(sha256sum "$TMP/manifest.json" | cut -d' ' -f1)
SYNC_AT=$(date -Iseconds)
# PART 1.1 §5: маркер привязывается к ТЕКУЩЕМУ deploy-lock (ставит сборка).
# Пусто при ручном синке вне пайплайна — тогда деплой под lock его НЕ примет.
LOCK_ID="${DEPLOY_LOCK_ID:-}"

# uploads целиком (mv внутри той же ФС — атомарная операция)
if [ -d "$RUNTIME_ROOT/uploads" ]; then
    rm -rf "$TMP/uploads-old"
    mv "$RUNTIME_ROOT/uploads" "$TMP/uploads-old"
fi
mv "$TMP/uploads" "$RUNTIME_ROOT/uploads"

# БД: mv поверх старой (старая остаётся в бэкапе из шага 1);
# сайдкары старой БД удаляем — иначе старый WAL допишется к новым данным
mv -f "$TMP/custom.db" "$DB"
rm -f "$DB-wal" "$DB-shm"

# ТЗ 2.5: FRESH SYNC MARKER — паспорт синка для deploy-guard.
# БД уже на месте ($DB заменена mv'ом выше), хеши считаны из скачанных файлов.
MARKER_JSON="$RUNTIME_ROOT/.live-sync.json.tmp"
{
  printf '{\n'
  printf '  "source": "%s",\n' "$BASE_URL"
  printf '  "generatedAt": "%s",\n' "$(MANIFEST="$TMP/manifest.json" bun -e "const m=JSON.parse(require('fs').readFileSync(process.env.MANIFEST,'utf8'));console.log(m.generatedAt)")"
  printf '  "syncedAt": "%s",\n' "$SYNC_AT"
  printf '  "lockId": "%s",\n' "$LOCK_ID"
  printf '  "dbSha256": "%s",\n' "$DB_SHA256"
  printf '  "manifestSha256": "%s",\n' "$MANIFEST_SHA256"
  printf '  "photoCount": %s,\n' "$PHOTOS_DB"
  printf '  "optimizedCount": %s,\n' "$OPT_COUNT"
  printf '  "thumbCount": %s\n' "$THM_COUNT"
  printf '}\n'
} > "$MARKER_JSON"
mv -f "$MARKER_JSON" "$RUNTIME_ROOT/.live-sync.json"

echo ""
echo "✅ Синхронизация завершена: данных живого сайта от $(MANIFEST="$TMP/manifest.json" bun -e "
  const m = JSON.parse(require('fs').readFileSync(process.env.MANIFEST, 'utf8'));
  console.log(m.generatedAt);
")"
echo "   Живых фото: $PHOTOS_DB, файлов: optimized=$OPT_COUNT, thumbs=$THM_COUNT"
if [ -n "$LOCK_ID" ]; then
    echo "   Синк выполнен ПОД deploy-lock: $LOCK_ID (записан в маркер)"
else
    echo "   ⚠️  Синк БЕЗ deploy-lock: маркер без lockId — деплой под lock его НЕ примет."
fi
echo "   Маркер свежего синка: $RUNTIME_ROOT/.live-sync.json (deploy-guard пропустит сборку)"
echo "   Если dev-сервер запущен — перезапусти его, чтобы он открыл новую БД."
echo "   Теперь можно делать правки и запускать деплой: данные уедут в артефакт."
