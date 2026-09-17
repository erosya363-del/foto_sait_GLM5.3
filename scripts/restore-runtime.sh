#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# restore-runtime.sh — восстановление runtime-данных из бэкапа.
#
# Использование:
#   bash scripts/restore-runtime.sh <архив.tar.gz>            — восстановить
#   bash scripts/restore-runtime.sh <архив.tar.gz> --check    — только проверить
#
# ПРАВКИ РЕВЬЮ v2 (пункты 3 и 4):
#
#   (3) FAIL-CLOSED по manifest — прежний restore только ПЕЧАТАл счётчик
#       photos и предлагал «сравните сами». Теперь restore завершается
#       EXIT 1 и НЕ ПРИКАСАЕТСЯ к runtime при любом расхождении:
#         manifest счётчик ≠ фактический   → EXIT 1
#         md5 БД ≠ manifest db_md5         → EXIT 1
#         файл из manifest отсутствует     → EXIT 1
#         md5 файла ≠ manifest             → EXIT 1
#         файл есть, но его нет в manifest → EXIT 1 (вскрытый/повреждённый архив)
#       Повреждённый архив больше не может пройти даже --check.
#
#   (4) СЕРВЕР ОСТАНАВЛИВАЕТСЯ ДО подмены runtime. Прежняя схема
#       «mv runtime → runtime.bak, потом перезапустите сервер вручную»
#       оставляла живой Next.js-процесс писать SQLite в СТАРЫЙ inode
#       (runtime.bak): восстановленная зона уже на месте, а сервер — ещё
#       в старой. Теперь порядок: stop server → verify archive → swap →
#       start server → health check. «Живые» серверы ищутся по /proc/<pid>/
#       environ: процесс с эффективным RUNTIME_ROOT = целевой зоне.
#
# Порядок работы:
#   1. Остановка серверов, держащих ЦЕЛЕВОЙ runtime (перед подменой)
#   2. Распаковка во ВРЕМЕННУЮ папку (не поверх живых данных)
#   3. Проверка структуры + integrity_check БД
#   4. FAIL-CLOSED сверка ВСЕХ счётчиков manifest, md5 БД, md5 всех файлов
#   5. Подмена: старая зона → runtime.bak-<штамп> (НЕ удаляется)
#   6. Запуск сервера + health check (если останавливали production :3000)
#
# Откат неудачного восстановления:
#   rm -rf download/runtime && mv download/runtime.bak-<штамп> download/runtime
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

ARCHIVE="${1:-}"
MODE="${2:-restore}"
RUNTIME_ROOT="${RUNTIME_ROOT:-$PWD/download/runtime}"
RUNTIME_ROOT_REAL="$(realpath -m "$RUNTIME_ROOT")"

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "Использование: $0 <runtime-*.tar.gz> [--check]"
  echo "Доступные бэкапы:"
  ls -1t download/backups/runtime-*.tar.gz 2>/dev/null || echo "  (нет)"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Шаг 0. Серверы, держащие ЦЕЛЕВОЙ runtime (сравнение по /proc/<pid>/environ;
# процессы без RUNTIME_ROOT считаются production-сервером с дефолтной зоной)
# ─────────────────────────────────────────────────────────────────────────────
server_pids_for_target() {
  local pid penv
  for pid in $(ss -tlnp 2>/dev/null | grep -oE "pid=[0-9]+" | cut -d= -f2 | sort -u); do
    case "$(cat "/proc/$pid/comm" 2>/dev/null || echo)" in
      node|next-server*|bun|bun-server*) ;;
      *) continue ;;
    esac
    penv="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep '^RUNTIME_ROOT=' | cut -d= -f2- || true)"
    [ -n "$penv" ] || penv="$PWD/download/runtime"
    [ "$(realpath -m "$penv" 2>/dev/null)" = "$RUNTIME_ROOT_REAL" ] || continue
    # Порт(ы) этого процесса — из ss (production стартует БЕЗ PORT в environ)
    local port
    for port in $(ss -tlnp 2>/dev/null | awk -v needle="pid=$pid," '$0 ~ needle {split($4, a, ":"); print a[length(a)]}' | sort -u); do
      echo "$pid $port"
    done
  done
}

# В restore-режиме останавливаем ДО любых манипуляций; в --check сервер не нужен
declare -a STOPPED=()   # "pid:port"
if [ "$MODE" != "--check" ]; then
  echo "── [0/5] Серверы, держащие целевой runtime ($RUNTIME_ROOT_REAL)…"
  while read -r pid pport; do
    [ -n "${pid:-}" ] || continue
    echo "   pid=$pid порт=${pport:-?} — останавливаю…"
    kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    STOPPED+=("$pid:$pport")
  done < <(server_pids_for_target)
  if [ ${#STOPPED[@]} -eq 0 ]; then
    echo "   активных серверов на этой зоне нет — подмена безопасна"
  else
    # Дождаться фактического выхода (иначе inode ещё держится в момент mv)
    for i in $(seq 1 20); do
      ALIVE=0
      for entry in "${STOPPED[@]}"; do
        pid="${entry%%:*}"
        kill -0 "$pid" 2>/dev/null && ALIVE=1
      done
      [ "$ALIVE" = "0" ] && break
      sleep 0.5
    done
    for entry in "${STOPPED[@]}"; do
      pid="${entry%%:*}"
      if kill -0 "$pid" 2>/dev/null; then
        echo "✗ Сервер pid=$pid не завершился — восстановление ОТМЕНЕНО (fail-closed)" >&2
        exit 1
      fi
    done
    echo "   все серверы остановлены, соединения с БД закрыты"
  fi
fi

TMP="$PWD/tool-results/restore-check-$$"
mkdir -p "$TMP"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "── [1/5] Распаковка во временную папку…"
tar -xzf "$ARCHIVE" -C "$TMP"

# В архиве корень = runtime/ — единственный корневой каталог.
# ВАЖНО: путь АБСОЛЮТНЫЙ — Prisma разрешает относительные file: URL
# относительно schema-каталога, а не cwd (урок первого прогона)
RAW_DIR="$(find "$TMP" -maxdepth 1 -type d ! -path "$TMP" | head -1)"
[ -n "$RAW_DIR" ] || { echo "✗ Архив без корневого каталога" >&2; exit 1; }
SRC_DIR="$(realpath "$RAW_DIR")"

echo "── [2/5] Проверка структуры…"
[ -f "$SRC_DIR/database/custom.db" ] || { echo "✗ Нет database/custom.db" >&2; exit 1; }
N_OPT=$(find "$SRC_DIR/uploads/optimized" -type f 2>/dev/null | wc -l || echo 0)
N_THB=$(find "$SRC_DIR/uploads/thumbs" -type f 2>/dev/null | wc -l || echo 0)
echo "   optimized: $N_OPT, thumbs: $N_THB"

echo "── [3/5] Целостность БД…"
DB_ABS="$SRC_DIR/database/custom.db" bun -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
  p.\$queryRawUnsafe('PRAGMA integrity_check').then((r) => {
    if (String(r[0]?.integrity_check) !== 'ok') throw new Error('integrity: ' + JSON.stringify(r));
    console.log('   integrity: ok');
    return p.\$disconnect();
  }).catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
"

echo "── [4/5] FAIL-CLOSED сверка manifest (счётчики + md5 БД + md5 файлов)…"
if [ ! -f "$SRC_DIR/manifest.txt" ]; then
  echo "✗ В архиве нет manifest.txt — подмена данных ЗАПРЕЩЕНА (fail-closed)" >&2
  exit 1
fi
DB_ABS="$SRC_DIR/database/custom.db" SRC_DIR="$SRC_DIR" bun -e "
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const { PrismaClient } = require('@prisma/client');
  const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

  (async () => {
  const manifest = fs.readFileSync(path.join(process.env.SRC_DIR, 'manifest.txt'), 'utf8');
  const mCounters = {}; let mDbMd5 = null; const mFiles = new Map();
  for (const line of manifest.split('\n')) {
    let m = line.match(/^([a-z]+)=(\d+)\s*\$/i);
    if (m && m[1] !== 'db_md5') { mCounters[m[1]] = Number(m[2]); continue; }
    m = line.match(/^db_md5=([0-9a-f]{32})\s*\$/);
    if (m) { mDbMd5 = m[1]; continue; }
    m = line.match(/^([0-9a-f]{32}) {2}(.+)\$/);
    if (m) mFiles.set(m[2], m[1]);
  }

  const errors = [];
  const p = new PrismaClient({ datasourceUrl: 'file:' + process.env.DB_ABS });
  const rows = await Promise.all([
    p.photo.count(), p.productVariant.count(), p.category.count(),
    p.model.count(), p.material.count(), p.size.count(), p.tag.count(),
    p.stockItem.count(),
  ]);
  await p.\$disconnect();
  const actual = { photos: rows[0], variants: rows[1], categories: rows[2],
                   models: rows[3], materials: rows[4], sizes: rows[5],
                   tags: rows[6], stockItems: rows[7] };
  console.log('   счётчики БД: ' + Object.entries(actual).map(([k, v]) => k + '=' + v).join(' '));

  for (const [k, v] of Object.entries(actual)) {
    if (k in mCounters && mCounters[k] !== v) errors.push('счётчик ' + k + ': manifest=' + mCounters[k] + ', факт=' + v);
  }

  if (mDbMd5 !== null) {
    const dbHash = md5(path.join(process.env.SRC_DIR, 'database', 'custom.db'));
    if (dbHash !== mDbMd5) errors.push('md5 БД: manifest=' + mDbMd5 + ', факт=' + dbHash);
    else console.log('   md5 БД: OK (' + dbHash.slice(0, 8) + '…)');
  } else {
    console.log('   ⚠ manifest без db_md5 (старый формат) — хеш БД не сверен');
  }

  // Все файлы manifest: существуют + md5 совпадает
  let checked = 0;
  for (const [rel, hash] of mFiles) {
    const abs = path.join(process.env.SRC_DIR, rel);
    if (!fs.existsSync(abs)) { errors.push('файл из manifest отсутствует: ' + rel); continue; }
    const h = md5(abs);
    if (h !== hash) errors.push('md5 файла: ' + rel + ' manifest=' + hash + ', факт=' + h);
    checked++;
  }
  console.log('   файлов из manifest проверено: ' + checked);

  // Файлы вне manifest = содержимое архива не совпадает с его же описанием
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? walk(abs) : [path.relative(process.env.SRC_DIR, abs)];
  });
  const uploadFiles = walk(path.join(process.env.SRC_DIR, 'uploads'));
  for (const rel of uploadFiles) {
    if (!mFiles.has(rel)) errors.push('файл НЕ из manifest: ' + rel);
  }
  console.log('   файлов uploads в архиве: ' + uploadFiles.length);

  if (errors.length) {
    console.error('✗ MANIFEST MISMATCH — подмена runtime ЗАПРЕЩЕНА (fail-closed):');
    for (const e of errors.slice(0, 20)) console.error('   • ' + e);
    if (errors.length > 20) console.error('   … и ещё ' + (errors.length - 20));
    process.exit(1);
  }
  console.log('   manifest: ПОЛНОЕ СООТВЕТСТВИЕ');
  })().catch((e) => { console.error('✗ ' + (e && e.message || e)); process.exit(1); });
"

if [ "$MODE" = "--check" ]; then
  echo "✅ Проверка пройдена (данные не тронуты)"
  exit 0
fi

echo "── [5/5] Подмена runtime-зоны (серверы остановлены на шаге 0; старая сохраняется)…"
STAMP="$(date +%Y%m%d-%H%M)"
if [ -d "$RUNTIME_ROOT" ]; then
  mv "$RUNTIME_ROOT" "${RUNTIME_ROOT}.bak-$STAMP"
  echo "   старая зона: ${RUNTIME_ROOT}.bak-$STAMP"
fi
mkdir -p "$(dirname "$RUNTIME_ROOT")"
cp -a "$SRC_DIR" "$RUNTIME_ROOT"

echo "✅ Восстановлено из: $ARCHIVE"

# Запуск остановленных серверов + health check
RESTARTED=0
for entry in "${STOPPED[@]}"; do
  port="${entry##*:}"
  if [ "$port" = "3000" ]; then
    echo "── Перезапуск production-сервера :3000 + health check…"
    bash scripts/restart.sh || {
      echo "✗ Сервер не поднялся после восстановления — откатите зону:" >&2
      echo "    rm -rf $RUNTIME_ROOT && mv ${RUNTIME_ROOT}.bak-$STAMP $RUNTIME_ROOT" >&2
      exit 1
    }
    RESTARTED=1
  fi
done
[ "$RESTARTED" = "1" ] || echo "   Перезапустите серверы этой зоны вручную, если они должны работать."
