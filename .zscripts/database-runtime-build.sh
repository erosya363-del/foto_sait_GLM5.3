#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# database-runtime-build.sh — данные каталога В ДЕПЛОЙ-АРТЕФАКТЕ.
#
# ПЕРВОПРИЧИНА ИСЧЕЗНОВЕНИЯ ФОТО ПРИ КАЖДОМ ДЕПЛОЕ (разобрано 2026-09-17):
#   деплой = НОВЫЙ контейнер, разворачиваемый из артефакта. Прежняя версия
#   этого скрипта клала в артефакт ТОЛЬКО легаси db/custom.db (записи
#   каталога), но НЕ файлы фото (download/runtime/uploads). Итог на живом
#   сайте: записи в БД есть, а каждый /api/media/* отвечает 404 —
#   «все фотографии исчезают». А всё, что пользователь загрузил через живой
#   сайт, существовало только на диске старого контейнера и уничтожалось
#   следующим редеплоем → «после каждой правки грузим фото заново».
#
#   Деплой гарантированно переносит только сам артефакт — значит, данные
#   должны ехать ВНУТРИ артефакта:
#     /app/db/custom.db                                   ← БД (как и прежде;
#       ровно этот путь ждёт start.sh: DATABASE_URL=file:/app/db/custom.db,
#       и ровно его принимает src/lib/runtime.ts — абсолютный file: вне
#       легаси-пути <projectRoot>/db/custom.db)
#     /app/next-service-dist/download/runtime/uploads/*   ← фото. Это ровно
#       то, что приложение вычисляет как UPLOADS_ROOT на контейнере:
#       projectRoot() = cwd standalone-сервера = /app/next-service-dist.
#
# Источник данных — runtime-зона рабочей области (тот же выбор, что у
# приложения, src/lib/runtime.ts). Фолбэки — только для переходного периода:
#   1. download/runtime/database/custom.db   ← истина
#   2. db/custom.db (легаси)                 ← ПРЕДУПРЕЖДЕНИЕ в лог
#   3. db/schema-template-empty.db           ← ПРЕДУПРЕЖДЕНИЕ: деплой без данных
#
# БД кладётся консистентным снапшотом (VACUUM INTO): параллельные записи
# dev-сервера не могут порвать копию. Схема копии сверяется с
# prisma/schema.prisma (prisma db push по КОПИИ, не по рабочей runtime-зоне!).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project}"
BUILD_DIR="${BUILD_DIR:?BUILD_DIR is required}"

# RUNTIME_ROOT можно переопределить (изолированные тесты пайплайна данных);
# по умолчанию — рабочая runtime-зона проекта (истина приложения).
RUNTIME_SRC="${RUNTIME_ROOT:-$PROJECT_DIR/download/runtime}"

RUNTIME_DB="$RUNTIME_SRC/database/custom.db"
UPLOADS_SRC="$RUNTIME_SRC/uploads"
DIST_DIR="$BUILD_DIR/next-service-dist"
UPLOADS_DST="$DIST_DIR/download/runtime/uploads"

# ═════════════════════════════════════════════════════════════════════════════
# ТЗ CRITICAL STABILITY 2.4/2.5 — DEPLOY GUARD: деплой НЕактуальных данных
# НЕВОЗМОЖЕН. Прежде чем что-то печь, проверяем свежий sync-маркер
# (.live-sync.json, который пишет scripts/sync-from-live.sh): без него/со
# старым маркером сборка УПАДАЕТ — именно так пропали ~20 фото (деплой выпёк
# артефакт из несинхронизированной зоны).
# Чистая установка: RUNTIME_BOOTSTRAP_EMPTY=1 (тот же флаг, что в runtime.ts).
# ═════════════════════════════════════════════════════════════════════════════
if [ "${RUNTIME_BOOTSTRAP_EMPTY:-}" = "1" ]; then
    echo "⚠  RUNTIME_BOOTSTRAP_EMPTY=1 — deploy-guard пропущен (ЯВНАЯ чистая установка)"
else
    echo "🛡  Deploy guard: проверка свежего sync-маркера и целостности runtime-зоны…"
    (cd "$PROJECT_DIR" && bun scripts/check-deploy-freshness.mjs "$RUNTIME_SRC")
fi

mkdir -p "$BUILD_DIR/db"

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

# ── [1/3] БД: ЕДИНСТВЕННЫЙ источник — runtime-зона (ТЗ 2.6: фолбэков нет) ──
# Легаси db/custom.db и пустой шаблон БОЛЬШЕ НЕ подставляются молча:
# «тихий» фолбэк умел вернуть старый набор фото после пропажи runtime-зоны —
# тот самый симптом. Чистая установка — ТОЛЬКО с RUNTIME_BOOTSTRAP_EMPTY=1.
if [ -f "$RUNTIME_DB" ]; then
    SRC_DB="$RUNTIME_DB"
    echo "🗄️  Источник БД: runtime-зона: $SRC_DB"
elif [ "${RUNTIME_BOOTSTRAP_EMPTY:-}" = "1" ]; then
    echo "⚠  Чистая установка: БД будет пустой схемой (RUNTIME_BOOTSTRAP_EMPTY=1)"
    SRC_DB=""
else
    echo "❌ Runtime-БД не найдена: $RUNTIME_DB — деплой БЕЗ данных запрещён (fail-closed)." >&2
    echo "   Восстановление: bash scripts/restore-runtime.sh <архив.tar.gz>" >&2
    echo "   Список бэкапов:  ls -1t download/backups/runtime-*.tar.gz" >&2
    echo "   Синк с живым сайтом: bash scripts/sync-from-live.sh <BASE_URL> --yes" >&2
    echo "   Только для заведомо чистой установки (без данных): RUNTIME_BOOTSTRAP_EMPTY=1" >&2
    exit 1
fi

# ── [2/3] Консистентный снапшот БД → артефакт ──────────────────────────
if [ -n "$SRC_DB" ]; then
echo "🗄️  Консистентный снапшот БД (VACUUM INTO staging)…"
if ! (
    cd "$PROJECT_DIR"
    DB_ABS="$SRC_DB" STAGING_DB="$STAGING/custom.db" bun -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
  p.\$queryRawUnsafe(\"VACUUM INTO '\" + process.env.STAGING_DB + \"'\")
    .then(() => p.\$disconnect())
    .catch((e) => { console.error(e.message); process.exit(1); });
"
); then
    echo "⚠️  VACUUM INTO не удался, копирую файл напрямую (сборка без параллельных записей)"
    cp "$SRC_DB" "$STAGING/custom.db"
fi

cp "$STAGING/custom.db" "$BUILD_DIR/db/custom.db"

# Выпеченная копия обязана быть целой — проверяем ДО дальнейших шагов
INTEGRITY=$(cd "$PROJECT_DIR" && DB_ABS="$BUILD_DIR/db/custom.db" bun -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
  p.\$queryRawUnsafe('PRAGMA integrity_check').then((r) => {
    console.log(String(r[0]?.integrity_check));
    return p.\$disconnect();
  });
")
[ "$INTEGRITY" = "ok" ] || {
    echo "❌ Выпеченная БД не прошла integrity_check: $INTEGRITY" >&2
    exit 1
}

# Схема: prisma db push по КОПИИ в артефакте.
# scripts/db-push.sh здесь СОЗНАТЕЛЬНО не используется: он жёстко направляет
# push в рабочую runtime-БД (защита разработчика от легаси-пути), а цель этого
# шага — именно копия артефакта. Если схема расходится с prisma/schema.prisma
# так, что требуется потеря данных — сборка падает здесь, громко, до деплоя.
echo "🗄️  Синхронизация схемы prisma по копии артефакта…"
(
    cd "$PROJECT_DIR"
    DATABASE_URL="file:$BUILD_DIR/db/custom.db" bunx prisma db push --skip-generate
)
else
    # Чистая установка (RUNTIME_BOOTSTRAP_EMPTY=1): пустая схема — тот же
    # источник, что разрешён src/lib/runtime.ts; 0 строк, никаких данных
    cp "$PROJECT_DIR/db/schema-template-empty.db" "$BUILD_DIR/db/custom.db"
    echo "🗄️  В артефакт положена ПУСТАЯ схема (0 строк)"
fi

# ── [3/3] Фото пользователей → внутрь standalone-корня артефакта ───────────
if [ ! -d "$DIST_DIR" ]; then
    echo "❌ $DIST_DIR не существует — артефакт собран без standalone, фото класть некуда." >&2
    echo "   Это сломанный пайплайн: деплой без файлов фото = снова «пропавшие фотографии»." >&2
    exit 1
fi

if [ ! -d "$UPLOADS_SRC" ]; then
    if [ "${RUNTIME_BOOTSTRAP_EMPTY:-}" = "1" ]; then
        echo "⚠  Чистая установка: uploads не существует — в артефакт пойдут пустые каталоги"
        mkdir -p "$UPLOADS_DST/optimized" "$UPLOADS_DST/thumbs"
    else
        echo "❌ $UPLOADS_SRC не найден — в артефакт нечего положить, деплой будет без фото." >&2
        echo "   Runtime-зона рабочей области повреждена? Восстановление:" >&2
        echo "     bash scripts/restore-runtime.sh <архив.tar.gz>" >&2
        echo "     ls -1t download/backups/runtime-*.tar.gz" >&2
        exit 1
    fi
else
mkdir -p "$UPLOADS_DST"
cp -a "$UPLOADS_SRC/." "$UPLOADS_DST/"
fi

OPT_COUNT=$(ls -1 "$UPLOADS_DST/optimized" 2>/dev/null | wc -l | tr -d ' ')
THM_COUNT=$(ls -1 "$UPLOADS_DST/thumbs" 2>/dev/null | wc -l | tr -d ' ')
if [ "$OPT_COUNT" = "0" ] && [ "${RUNTIME_BOOTSTRAP_EMPTY:-}" != "1" ]; then
    echo "⚠️  uploads/optimized пуст — БД ссылается на фото, которых нет в артефакте (404 на живом сайте)"
else
    echo "🖼️  Фото в артефакте: optimized=$OPT_COUNT, thumbs=$THM_COUNT → $UPLOADS_DST"
fi

# ═════════════════════════════════════════════════════════════════════
# ТЗ 2.8 — POST-BUILD VERIFY: проверяем УЖЕ АРТЕФАКТ, а не исходную зону:
# артефактная БД ↔ артефактные optimized/thumbs. Любая битая ссылка —
# сборка падает ЗДЕСЬ, а не после деплоя на живом сайте.
# ═════════════════════════════════════════════════════════════════════
echo "🛡  Post-build verify: фото-ссылки В АРТЕФАКТЕ (БД ↔ optimized/thumbs)…"
(cd "$PROJECT_DIR" && bun scripts/verify-runtime-artifact.mjs "$DIST_DIR/download/runtime" --db "$BUILD_DIR/db/custom.db")

# ТЗ 2.10: токен экспорта едет ВНУТРИ артефакта (RUNTIME_ROOT/.sync-token →
# сервер прочитает его тем же путём) — авторизация работает без .env.
if [ -f "$RUNTIME_SRC/.sync-token" ]; then
    cp "$RUNTIME_SRC/.sync-token" "$DIST_DIR/download/runtime/.sync-token"
fi

echo "✅ Данные каталога выпечены в артефакт: $BUILD_DIR/db/custom.db + $UPLOADS_DST"
