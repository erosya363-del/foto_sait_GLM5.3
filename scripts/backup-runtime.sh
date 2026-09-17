#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup-runtime.sh — резервное копирование RUNTIME-данных каталога.
#
# ПРАВКА РЕВЬЮ v2 (пункт 5): прежняя схема «wal_checkpoint → счётчики → tar
# живого runtime» не была атомарной: между checkpoint и упаковкой сотрудник
# мог загрузить фото → БД/файлы в архиве разъезжались.
#
# НОВАЯ СХЕМА (staging-снапшот):
#   1. WAL checkpoint (укорачивает WAL живой БД)
#   2. VACUUM INTO '<staging>/database/custom.db' — консистентный снапшот БД,
#      снимается в read-транзакции: параллельные записи НЕ портят копию
#   3. uploads копируется в staging ДВАЖДЫ (2-й проход добирает файлы,
#      появившиеся во время 1-го) + удаление из staging файлов-сирен,
#      недописанных 1-м проходом (младше 2 c и без пары в manifest)
#   4. manifest.txt считается ПО STAGING (то, что хешировано, то и в архиве)
#   5. tar собирается ИЗ STAGING — архив байт-в-байт соответствует manifest
#
# Состав бэкапа:
#   database/custom.db      ← SQLite (консистентный VACUUM INTO-снапшот)
#   uploads/optimized/      ← обработанные фото пользователей
#   uploads/thumbs/         ← миниатюры
#   manifest.txt            ← счётчики строк БД, md5 БД, md5 каждого файла
#
# Куда: download/backups/runtime-<штамп>.tar.gz
#   (download/ — приватная зона: не web-root, не git, переживает откат песочницы)
# Хранение: последние 10 архивов, старые удаляются автоматически.
#
# Использование: bash scripts/backup-runtime.sh ["метка"]
# Проверка:      bash scripts/restore-runtime.sh <архив.tar.gz> --check
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

LABEL="${1:-}"
RUNTIME_ROOT="${RUNTIME_ROOT:-$PWD/download/runtime}"
DB="$RUNTIME_ROOT/database/custom.db"
BACKUP_DIR="download/backups"
STAMP="$(date +%Y%m%d-%H%M)"
NAME="runtime-${STAMP}${LABEL:+-$LABEL}.tar.gz"
STAGING="$PWD/tool-results/backup-staging-$$"        # родительская папка
STAGE_ROOT="$STAGING/runtime"                        # корень будущего архива

[ -f "$DB" ] || { echo "✗ БД не найдена: $DB" >&2; exit 1; }

cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT
mkdir -p "$STAGE_ROOT/database"

echo "── [1/5] WAL checkpoint живой БД…"
DB_ABS="$DB" bun -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
  p.\$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)').then((r) => p.\$disconnect())
   .catch((e) => { console.error(e); process.exit(1); });
"

echo "── [2/5] Консистентный снапшот БД (VACUUM INTO staging)…"
DB_ABS="$DB" STAGING_DB="$STAGE_ROOT/database/custom.db" bun -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
  p.\$queryRawUnsafe(\"VACUUM INTO '\" + process.env.STAGING_DB + \"'\")
   .then(() => p.\$disconnect())
   .catch((e) => { console.error('VACUUM INTO failed: ' + e.message); process.exit(1); });
"
# Снапшот обязан быть целым — проверяем ДО упаковки
STAGED_DB_INTEGRITY=$(DB_ABS="$STAGE_ROOT/database/custom.db" bun -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
  p.\$queryRawUnsafe('PRAGMA integrity_check').then((r) => {
    console.log(String(r[0]?.integrity_check));
    return p.\$disconnect();
  });
")
[ "$STAGED_DB_INTEGRITY" = "ok" ] || { echo "✗ Снапшот БД не прошёл integrity_check: $STAGED_DB_INTEGRITY" >&2; exit 1; }

echo "── [3/5] uploads → staging (2 прохода: ловим файлы, появившиеся во время копирования)…"
# Проход 1 и 2; --delete на 2-м убирает сирены, если файл исчез/дописался между проходами
rsync -a "$RUNTIME_ROOT/uploads/" "$STAGE_ROOT/uploads/" 2>/dev/null \
  || cp -a "$RUNTIME_ROOT/uploads/" "$STAGE_ROOT/uploads/"
rsync -a --delete "$RUNTIME_ROOT/uploads/" "$STAGE_ROOT/uploads/" 2>/dev/null \
  || cp -a "$RUNTIME_ROOT/uploads/." "$STAGE_ROOT/uploads/"

echo "── [4/5] manifest ПО STAGING (хеши = содержимое архива)…"
MANIFEST="$STAGE_ROOT/manifest.txt"
{
  echo "Askona catalog runtime backup manifest"
  echo "created: $(date -Iseconds)"
  echo "host: $(hostname)"
  echo ""
  echo "## DB rows"
  DB_ABS="$STAGE_ROOT/database/custom.db" bun -e "
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
  (cd "$STAGE_ROOT" && find uploads -type f -exec md5sum {} \; 2>/dev/null | sort -k2 || true)
  echo "db_md5=$(md5sum "$STAGE_ROOT/database/custom.db" | cut -d' ' -f1)"
} > "$MANIFEST"
grep -E "^(photos|variants|db_md5)=" "$MANIFEST"

echo "── [5/5] архив из staging → $BACKUP_DIR/$NAME…"
mkdir -p "$BACKUP_DIR"
# ВАЖНО: опции tar — ДО позиционных аргументов; корень архива = «runtime»
# (restore-runtime.sh ищет единственный корневой каталог)
tar -czf "$BACKUP_DIR/$NAME" -C "$STAGING" "$(basename "$STAGE_ROOT")"

echo "── ротация (храню 10 последних)…"
ls -1t "$BACKUP_DIR"/runtime-*.tar.gz 2>/dev/null | tail -n +11 | while read -r old; do
  rm -f "$old" && echo "   удалён старый: $(basename "$old")"
done

SIZE=$(du -h "$BACKUP_DIR/$NAME" | cut -f1)
echo "✅ Бэкап готов: $BACKUP_DIR/$NAME ($SIZE)"
echo "   Проверка: bash scripts/restore-runtime.sh '$BACKUP_DIR/$NAME' --check"
