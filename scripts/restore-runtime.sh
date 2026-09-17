#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# restore-runtime.sh — восстановление runtime-данных из бэкапа.
#
# Использование:
#   bash scripts/restore-runtime.sh <архив.tar.gz>            — восстановить
#   bash scripts/restore-runtime.sh <архив.tar.gz> --check    — только проверить
#
# Безопасность:
#   1. Распаковка во ВРЕМЕННУЮ папку (не поверх живых данных)
#   2. Проверка структуры (database/custom.db + uploads/) и целостности БД
#   3. Сравнение счётчиков строк с manifest.txt (если есть)
#   4. Только после этого: текущая runtime-зона переименовывается в
#      runtime.bak-<штамп> (НЕ удаляется!), на её место встаёт восстановленная
#   5. Сервер после восстановления нужно перезапустить: bash scripts/restart.sh
#
# Откат неудачного восстановления:
#   rm -rf download/runtime && mv download/runtime.bak-<штамп> download/runtime
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

ARCHIVE="${1:-}"
MODE="${2:-restore}"
RUNTIME_ROOT="${RUNTIME_ROOT:-$PWD/download/runtime}"

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "Использование: $0 <runtime-*.tar.gz> [--check]"
  echo "Доступные бэкапы:"
  ls -1t download/backups/runtime-*.tar.gz 2>/dev/null || echo "  (нет)"
  exit 1
fi

TMP="$PWD/tool-results/restore-check-$$"
mkdir -p "$TMP"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "── [1/4] Распаковка во временную папку…"
tar -xzf "$ARCHIVE" -C "$TMP"

# В архиве корень = runtime/ (basename RUNTIME_ROOT) — найдём его.
# ВАЖНО: путь должен быть АБСОЛЮТНЫМ — Prisma разрешает относительные file:
# URL относительно schema-каталога, а не cwd (урок первого прогона)
RAW_DIR="$(find "$TMP" -maxdepth 1 -type d ! -path "$TMP" | head -1)"
[ -n "$RAW_DIR" ] || { echo "✗ Архив без корневого каталога" >&2; exit 1; }
SRC_DIR="$(realpath "$RAW_DIR")"

echo "── [2/4] Проверка структуры…"
[ -f "$SRC_DIR/database/custom.db" ] || { echo "✗ Нет database/custom.db" >&2; exit 1; }
N_OPT=$(find "$SRC_DIR/uploads/optimized" -type f 2>/dev/null | wc -l || echo 0)
N_THB=$(find "$SRC_DIR/uploads/thumbs" -type f 2>/dev/null | wc -l || echo 0)
echo "   optimized: $N_OPT, thumbs: $N_THB"

echo "── [3/4] Целостность БД + счётчики…"
DB_ABS="$SRC_DIR/database/custom.db" bun -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
  p.\$queryRawUnsafe('PRAGMA integrity_check').then((r) => {
    if (String(r[0]?.integrity_check) !== 'ok') throw new Error('integrity: ' + JSON.stringify(r));
    return Promise.all([p.photo.count(), p.productVariant.count(), p.category.count()]);
  }).then(([ph, v, c]) => {
    console.log('   integrity: ok; photos=' + ph + ' variants=' + v + ' categories=' + c);
    return p.\$disconnect();
  }).catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
"

if [ -f "$SRC_DIR/manifest.txt" ]; then
  echo "── Сверка с manifest.txt:"
  EXPECTED=$(grep -E "^photos=" "$SRC_DIR/manifest.txt" | cut -d= -f2 || echo "?")
  echo "   manifest photos=${EXPECTED:-?} (сравните с числом выше)"
fi

if [ "$MODE" = "--check" ]; then
  echo "✅ Проверка пройдена (данные не тронуты)"
  exit 0
fi

echo "── [4/4] Подмена runtime-зоны (старая сохраняется как .bak)…"
STAMP="$(date +%Y%m%d-%H%M)"
if [ -d "$RUNTIME_ROOT" ]; then
  mv "$RUNTIME_ROOT" "${RUNTIME_ROOT}.bak-$STAMP"
  echo "   старая зона: ${RUNTIME_ROOT}.bak-$STAMP"
fi
mkdir -p "$(dirname "$RUNTIME_ROOT")"
cp -a "$SRC_DIR" "$RUNTIME_ROOT"

echo "✅ Восстановлено из: $ARCHIVE"
echo "   Перезапустите сервер: bash scripts/restart.sh"
