#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# migrate-runtime.sh — ОДНОРАЗОВАЯ миграция runtime-данных в защищённую зону.
#
# ПЕРВОПРИЧИНА потери фото (см. docs/FIX_REPORT.md):
#   1) db/custom.db и public/uploads были закоммичены в git → деплой/откат
#      песочницы затирал их замороженной git-версией;
#   2) standalone-сервер (cwd = .next/standalone) с фолбэком DATABASE_URL
#      создавал БД внутри сборки → rebuild стирал её;
#   3) edge отдаёт статику только из снапшота → новые /uploads/* внешне 404.
#
# Что делает:
#   1. WAL-chekpoint БД (чтобы копия была полной)
#   2. Копирует db/custom.db  → download/runtime/database/custom.db
#   3. Копирует public/uploads → download/runtime/uploads
#   4. ВЕРИФИЦИРУЕТ (кол-во файлов + md5) — при расхождении abort
#   5. Переключает .env DATABASE_URL на новый путь
#
# Идемпотентен: существующие целевые файлы не перезаписывает без --force.
# ИСХОДНЫЕ ФАЙЛЫ НЕ УДАЛЯЮТСЯ (остаются как локальная страховка, из git
# убираются отдельно через git rm --cached).
#
# Использование: bash scripts/migrate-runtime.sh [--force]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

SRC_DB="db/custom.db"
SRC_UPLOADS="public/uploads"
RUNTIME_ROOT="${RUNTIME_ROOT:-$PWD/download/runtime}"
DST_DB_DIR="$RUNTIME_ROOT/database"
DST_DB="$DST_DB_DIR/custom.db"
DST_UPLOADS="$RUNTIME_ROOT/uploads"

echo "── Runtime root: $RUNTIME_ROOT"

# ── 1. WAL checkpoint: вылить WAL в основной файл (безопасно при живом сервере) ──
if [ -f "$SRC_DB" ]; then
  echo "── [1/5] WAL checkpoint db/custom.db…"
  bun -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient({ datasourceUrl: 'file:' + process.cwd() + '/db/custom.db' });
    p.\$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)').then((r) => {
      const conv = JSON.parse(JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
      console.log('   checkpoint:', JSON.stringify(conv));
      return p.\$disconnect();
    }).catch((e) => { console.error(e); process.exit(1); });
  "
else
  echo "── [1/5] db/custom.db не найден — пропускаю checkpoint"
fi

# ── 2. Копия БД ──
mkdir -p "$DST_DB_DIR"
if [ -f "$SRC_DB" ]; then
  if [ -f "$DST_DB" ] && [ "$FORCE" -eq 0 ]; then
    echo "── [2/5] $DST_DB уже существует — пропускаю (для перезаписи: --force)"
  else
    cp "$SRC_DB" "$DST_DB"
    # WAL/SHM копируем, только если не пустые (после TRUNCATE wal = 0 байт)
    [ -s "${SRC_DB}-wal" ] && cp "${SRC_DB}-wal" "${DST_DB}-wal" || true
    [ -s "${SRC_DB}-shm" ] && cp "${SRC_DB}-shm" "${DST_DB}-shm" || true
    echo "── [2/5] БД скопирована"
  fi
else
  echo "── [2/5] db/custom.db не найден — пропускаю копию БД"
fi

# ── 3. Копия uploads ──
if [ -d "$SRC_UPLOADS" ]; then
  mkdir -p "$DST_UPLOADS"
  echo "── [3/5] rsync uploads…"
  rsync -a "$SRC_UPLOADS/" "$DST_UPLOADS/"
else
  echo "── [3/5] public/uploads не найден — пропускаю"
fi

# ── 4. Верификация ──
echo "── [4/5] Верификация…"
FAIL=0

if [ -f "$SRC_DB" ] && [ -f "$DST_DB" ]; then
  A=$(md5sum "$SRC_DB" | cut -d' ' -f1)
  B=$(md5sum "$DST_DB" | cut -d' ' -f1)
  if [ "$A" != "$B" ]; then echo "  ✗ БД md5 различаются: $A != $B"; FAIL=1; else echo "  ✓ БД md5 совпадает ($A)"; fi
fi

if [ -d "$SRC_UPLOADS" ]; then
  NA=$(find "$SRC_UPLOADS" -type f | wc -l)
  NB=$(find "$DST_UPLOADS" -type f | wc -l)
  if [ "$NA" != "$NB" ]; then echo "  ✗ Кол-во файлов uploads: $NA != $NB"; FAIL=1; else echo "  ✓ uploads: $NA файлов"; fi
  # md5 всех файлов
  (cd "$SRC_UPLOADS" && find . -type f -exec md5sum {} \; | sort -k2) > /tmp/migrate-src.md5
  (cd "$DST_UPLOADS" && find . -type f -exec md5sum {} \; | sort -k2) > /tmp/migrate-dst.md5
  if ! diff -q /tmp/migrate-src.md5 /tmp/migrate-dst.md5 > /dev/null; then
    echo "  ✗ md5 uploads различаются:"; diff /tmp/migrate-src.md5 /tmp/migrate-dst.md5 | head -10; FAIL=1
  else
    echo "  ✓ md5 всех $(wc -l < /tmp/migrate-src.md5) файлов uploads совпадают"
  fi
fi

if [ "$FAIL" -ne 0 ]; then
  echo "✗ ВЕРИФИКАЦИЯ ПРОВАЛЕНА — .env НЕ переключён, разберитесь вручную" >&2
  exit 1
fi

# ── 5. Переключение .env ──
NEW_URL="DATABASE_URL=file:$DST_DB"
if [ -f .env ] && grep -q "^DATABASE_URL=file:$RUNTIME_ROOT/database/custom.db$" .env; then
  echo "── [5/5] .env уже указывает на runtime — ок"
elif [ -f .env ] && grep -q "^DATABASE_URL=" .env; then
  cp .env .env.bak-runtime-migrate
  sed -i "s|^DATABASE_URL=.*|$NEW_URL|" .env
  echo "── [5/5] .env обновлён (старый сохранён в .env.bak-runtime-migrate):"
else
  echo "$NEW_URL" > .env
  echo "── [5/5] .env создан:"
fi
echo "        $(grep '^DATABASE_URL=' .env)"
echo "✅ Runtime-миграция завершена. Исходники db/custom.db и public/uploads НЕ удалены (страховка)."
