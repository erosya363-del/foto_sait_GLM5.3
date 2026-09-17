#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# prune-standalone.sh — чистка .next/standalone после сборки.
#
# ПОЧЕМУ: Next 16 (Turbopack, turbopack.root = workspace root) копирует ВЕСЬ
# рабочий каталог в .next/standalone — включая runtime-зону (download/runtime),
# легаси-БД (db/), пользовательские файлы (public/uploads), скрипты, скиллы,
# логи. Это мусор: сервер резолвит пути через projectRoot() НАРУЖУ
# (src/lib/runtime.ts), а «выпеченные» копии создают ложное чувство, что
# данные живут внутри сборки, и могут быть спутаны с настоящими.
#
# Правила:
#  — НЕ трогаем: server.js, .next, node_modules, public (кроме uploads),
#    package.json — то, что нужно standalone-серверу;
#  — runtime-данные (download/, db/) из сборки выкидываем: источник правды —
#    <корень проекта>/download/runtime;
#  — идемпотентно: отсутствующее просто пропускается.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

SA=".next/standalone"
[ -d "$SA" ] || { echo "✗ $SA не существует — сначала bun run build" >&2; exit 1; }

for entry in \
  download tool-results upload skills agent data ios tests scripts \
  dev.log server.log worklog.md CHANGELOG.md STATUS.md CHECKPOINT.md \
  Caddyfile bun.lock tsconfig.tsbuildinfo \
  "db" \
  "public/uploads" \
; do
  if [ -e "$SA/$entry" ]; then
    rm -rf "$SA/$entry"
    echo "  − $entry"
  fi
done

echo "✅ standalone очищен от нерантайм-содержимого"
