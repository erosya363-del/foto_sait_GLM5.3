#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# db-push.sh — ЕДИНСТВЕННЫЙ способ запускать prisma db push / migrate.
#
# ПРАВКА РЕВЬЮ v2 (пункт 7): `prisma db push` напрямую брал DATABASE_URL из
# окружения. Платформа экспортирует ЛЕГАСИ DATABASE_URL=<проект>/db/custom.db
# в каждый процесс (проверено /proc/<pid>/environ), а приложение его
# игнорирует и работает на download/runtime/database/custom.db. Итог:
# разработчик мог выполнить `bun run db:push` и изменить СТАРУЮ легаси-БД,
# тогда как живой сайт сидит на runtime-БД.
#
# Wrapper:
#   1. Вычисляет тот же путь, что и приложение (src/lib/runtime.ts, через bun)
#   2. Проверяет, что runtime-БД существует — НЕТ → EXIT 1 без изменений
#      (fail-closed: никаких автосозданий/подмен из CLI)
#   3. Явно передаёт DATABASE_URL=file:<runtime БД> в prisma
#   4. --accept-data-loss запрещён этим wrapper'ом (деструктивная синхронизация
#      схемы — только через осознанный процесс с бэкапом, см. docs/FIX_REPORT.md)
#
# Использование:
#   bash scripts/db-push.sh            # prisma db push (схема → runtime БД)
#   bash scripts/db-push.sh --generate # + prisma generate
#   bash scripts/db-push.sh --migrate  # prisma migrate dev (интерактивно)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

for arg in "$@"; do
  if [ "$arg" = "--accept-data-loss" ]; then
    echo "✗ ОТКАЗ: --accept-data-loss запрещён (может стереть данные runtime-БД)." >&2
    echo "  Изменение схемы с потерей данных — только осознанно, с бэкапом:" >&2
    echo "    1) bash scripts/backup-runtime.sh" >&2
    echo "    2) вручную: DATABASE_URL=\"file:\$PWD/download/runtime/database/custom.db\" bunx prisma db push --accept-data-loss" >&2
    exit 1
  fi
done

# Тот же источник истины, что у приложения: src/lib/runtime.ts (bun умеет TS)
DB_FILE="$(bun -e '
import { DATABASE_FILE } from "./src/lib/runtime.ts";
console.log(DATABASE_FILE);
')"

if [ ! -f "$DB_FILE" ]; then
  echo "✗ ОТКАЗ: runtime-БД не найдена: $DB_FILE" >&2
  echo "  Схему применять некуда — данные НЕ создаются/не подменяются из CLI." >&2
  echo "  Восстановление: bash scripts/restore-runtime.sh <архив.tar.gz>" >&2
  echo "  Список бэкапов: ls -1t download/backups/runtime-*.tar.gz" >&2
  exit 1
fi

case "${1:-}" in
  --migrate)
    echo "── prisma migrate dev → runtime-БД: $DB_FILE"
    exec env DATABASE_URL="file:$DB_FILE" bunx prisma migrate dev
    ;;
  --generate)
    echo "── prisma generate + db push → runtime-БД: $DB_FILE"
    env bunx prisma generate
    exec env DATABASE_URL="file:$DB_FILE" bunx prisma db push
    ;;
  "")
    echo "── prisma db push → runtime-БД: $DB_FILE"
    exec env DATABASE_URL="file:$DB_FILE" bunx prisma db push
    ;;
  *)
    echo "── prisma db push $* → runtime-БД: $DB_FILE"
    exec env DATABASE_URL="file:$DB_FILE" bunx prisma db push "$@"
    ;;
esac
