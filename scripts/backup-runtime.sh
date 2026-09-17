#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup-runtime.sh — резервное копирование RUNTIME-данных каталога.
#
# Состав бэкапа:
#   database/custom.db      ← SQLite (после WAL-checkpoint — консистентная копия)
#   uploads/optimized/      ← обработанные фото пользователей
#   uploads/thumbs/         ← миниатюры
#   manifest.txt            ← состав, счётчики строк БД, md5 каждого файла
#
# Куда: download/backups/runtime-<штамп>.tar.gz
#   (download/ — приватная зона: не web-root, не git, переживает откат песочницы)
# Хранение: последние 10 архивов, старые удаляются автоматически.
#
# Использование: bash scripts/backup-runtime.sh ["метка"]
# Восстановление: bash scripts/restore-runtime.sh <архив.tar.gz>
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

LABEL="${1:-}"
RUNTIME_ROOT="${RUNTIME_ROOT:-$PWD/download/runtime}"
DB="$RUNTIME_ROOT/database/custom.db"
BACKUP_DIR="download/backups"
STAMP="$(date +%Y%m%d-%H%M)"
NAME="runtime-${STAMP}${LABEL:+-$LABEL}.tar.gz"

[ -f "$DB" ] || { echo "✗ БД не найдена: $DB" >&2; exit 1; }

echo "── [1/4] WAL checkpoint…"
DB_ABS="$DB" bun -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
  p.\$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)').then((r) => p.\$disconnect())
   .catch((e) => { console.error(e); process.exit(1); });
"

echo "── [2/4] manifest…"
MANIFEST="$RUNTIME_ROOT/manifest.txt"
{
  echo "Askona catalog runtime backup manifest"
  echo "created: $(date -Iseconds)"
  echo "host: $(hostname)"
  echo ""
  echo "## DB rows"
  DB_ABS="$DB" bun -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
    Promise.all([
      p.photo.count(), p.productVariant.count(), p.category.count(),
      p.model.count(), p.material.count(), p.size.count(), p.tag.count(),
      p.stockItem.count(),
    ]).then(([ph, v, c, m, mat, s, t, si]) => {
      console.log('photos=' + ph); console.log('variants=' + v);
      console.log('categories=' + c); console.log('models=' + m);
      console.log('materials=' + mat); console.log('sizes=' + s);
      console.log('tags=' + t); console.log('stockItems=' + si);
      return p.\$disconnect();
    }).catch((e) => { console.error(e); process.exit(1); });
"
  echo ""
  echo "## Files (md5)"
  (cd "$RUNTIME_ROOT" && find uploads -type f -exec md5sum {} \; 2>/dev/null | sort -k2 || true)
  echo "db_md5=$(md5sum "$DB" | cut -d' ' -f1)"
} > "$MANIFEST"
cat "$MANIFEST" | head -14

echo "── [3/4] архив → $BACKUP_DIR/$NAME…"
mkdir -p "$BACKUP_DIR"
# ВАЖНО: опции tar — ДО позиционных аргументов (GNU tar иначе завершается с ошибкой)
tar -czf "$BACKUP_DIR/$NAME" -C "$(dirname "$RUNTIME_ROOT")" "$(basename "$RUNTIME_ROOT")"

echo "── [4/4] ротация (храню 10 последних)…"
ls -1t "$BACKUP_DIR"/runtime-*.tar.gz 2>/dev/null | tail -n +11 | while read -r old; do
  rm -f "$old" && echo "   удалён старый: $(basename "$old")"
done

SIZE=$(du -h "$BACKUP_DIR/$NAME" | cut -f1)
echo "✅ Бэкап готов: $BACKUP_DIR/$NAME ($SIZE)"
echo "   Проверка: bash scripts/restore-runtime.sh '$BACKUP_DIR/$NAME' --check"
