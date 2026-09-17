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

RUNTIME_DB="$PROJECT_DIR/download/runtime/database/custom.db"
LEGACY_DB="$PROJECT_DIR/db/custom.db"
TEMPLATE_DB="$PROJECT_DIR/db/schema-template-empty.db"
UPLOADS_SRC="$PROJECT_DIR/download/runtime/uploads"
DIST_DIR="$BUILD_DIR/next-service-dist"
UPLOADS_DST="$DIST_DIR/download/runtime/uploads"

mkdir -p "$BUILD_DIR/db"

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

# ── [1/3] БД: выбор источника ───────────────────────────────────────────────
if [ -f "$RUNTIME_DB" ]; then
    SRC_DB="$RUNTIME_DB"
    SRC_KIND="runtime-зона (истина)"
elif [ -f "$LEGACY_DB" ]; then
    SRC_DB="$LEGACY_DB"
    SRC_KIND="⚠️  ЛЕГАСИ db/custom.db — runtime-зона не найдена!"
elif [ -f "$TEMPLATE_DB" ]; then
    SRC_DB="$TEMPLATE_DB"
    SRC_KIND="⚠️  ПУСТАЯ схема — деплой будет БЕЗ данных каталога"
else
    echo "❌ Нет ни runtime-БД, ни db/custom.db, ни шаблона схемы — нечего выпекать" >&2
    exit 1
fi
echo "🗄️  Источник БД: $SRC_KIND"
echo "    $SRC_DB"

# ── [2/3] Консистентный снапшот БД → артефакт ──────────────────────────────
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

# ── [3/3] Фото пользователей → внутрь standalone-корня артефакта ───────────
if [ ! -d "$DIST_DIR" ]; then
    echo "❌ $DIST_DIR не существует — артефакт собран без standalone, фото класть некуда." >&2
    echo "   Это сломанный пайплайн: деплой без файлов фото = снова «пропавшие фотографии»." >&2
    exit 1
fi

if [ ! -d "$UPLOADS_SRC" ]; then
    echo "❌ $UPLOADS_SRC не найден — в артефакт нечего положить, деплой будет без фото." >&2
    echo "   Runtime-зона рабочей области повреждена? Восстановление:" >&2
    echo "     bash scripts/restore-runtime.sh <архив.tar.gz>" >&2
    echo "     ls -1t download/backups/runtime-*.tar.gz" >&2
    exit 1
fi

mkdir -p "$UPLOADS_DST"
cp -a "$UPLOADS_SRC/." "$UPLOADS_DST/"

OPT_COUNT=$(ls -1 "$UPLOADS_DST/optimized" 2>/dev/null | wc -l | tr -d ' ')
THM_COUNT=$(ls -1 "$UPLOADS_DST/thumbs" 2>/dev/null | wc -l | tr -d ' ')
if [ "$OPT_COUNT" = "0" ]; then
    echo "⚠️  uploads/optimized пуст — БД ссылается на фото, которых нет в артефакте (404 на живом сайте)"
else
    echo "🖼️  Фото в артефакте: optimized=$OPT_COUNT, thumbs=$THM_COUNT → $UPLOADS_DST"
fi

echo "✅ Данные каталога выпечены в артефакт: $BUILD_DIR/db/custom.db + $UPLOADS_DST"
