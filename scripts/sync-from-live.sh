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
#   - любая ошибка проверки → EXIT 1, локальная зона не трогается (замена
#     происходит только после того, как ВСЕ данные уже скачаны и сверены).
#
# Использование:
#   bash scripts/sync-from-live.sh <BASE_URL> [--yes]
#     <BASE_URL>  напр. https://<site>.space-z.ai
#     --yes       без интерактивного подтверждения (для автоматизации)
#
# Окружение:
#   RUNTIME_ROOT — корень приёмника (по умолчанию <проект>/download/runtime);
#                  удобно для тестов на изолированной папке.
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
for arg in "${@:2}"; do
    [ "$arg" = "--yes" ] && ASSUME_YES=1
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

echo "── [1/5] Страховочный бэкап текущей runtime-зоны…"
if [ -f "$DB" ]; then
    RUNTIME_ROOT="$RUNTIME_ROOT" bash scripts/backup-runtime.sh "pre-sync"
else
    echo "    ⚠️  Целевая БД не существует ($DB) — бэкап пропущен (синк в пустую зону)"
fi

echo "── [2/5] Манифест живого сайта…"
curl -fsS --max-time 60 "$BASE_URL/api/admin/export" -o "$TMP/manifest.json" || {
    echo "✗ Не удалось получить манифест: $BASE_URL/api/admin/export" >&2
    exit 1
}

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

echo "── [3/5] БД живого сайта…"
curl -fsS --max-time 180 "$BASE_URL/api/admin/export?part=db" -o "$TMP/custom.db" || {
    echo "✗ Не удалось скачать БД" >&2
    exit 1
}

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

echo "── [4/5] Файлы фото ($((OPT_COUNT + THM_COUNT)) шт)…"
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

echo "── [5/5] Замена runtime-зоны…"
mkdir -p "$RUNTIME_ROOT/database"

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

echo ""
echo "✅ Синхронизация завершена: данных живого сайта от $(MANIFEST="$TMP/manifest.json" bun -e "
  const m = JSON.parse(require('fs').readFileSync(process.env.MANIFEST, 'utf8'));
  console.log(m.generatedAt);
")"
echo "   Живых фото: $PHOTOS_DB, файлов: optimized=$OPT_COUNT, thumbs=$THM_COUNT"
echo "   Если dev-сервер запущен — перезапусти его, чтобы он открыл новую БД."
echo "   Теперь можно делать правки и запускать деплой: данные уедут в артефакт."
