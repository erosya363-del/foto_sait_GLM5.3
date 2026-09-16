#!/usr/bin/env bash
# make-copy4.sh — резервная копия №4 проекта (v3.0) по образцу копии №3 (worklog Task 34).
# Состав: .git, .env, .zscripts, CHECKPOINT.md, skills-lock.json, src, prisma, db, public,
#         scripts, tests, skills/, data/, agent/, download/
# Исключено: node_modules, .next, tool-results, dot-папки агентов, *.tar.gz (бэкап в бэкап),
#            WAL-сайдкеры (перед сборкой чекпоинтим WAL в основной файл БД).
set -uo pipefail
cd /home/z/my-project

OUT=public/sait_copy_4.tar.gz

echo "== 1) WAL-чекпоинт SQLite =="
python3 - <<'PY'
import sqlite3
con = sqlite3.connect('db/custom.db')
print('wal_checkpoint:', con.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone())
con.close()
PY

echo "== 2) Сборка архива =="
tar --transform 's,^,sait_copy_4/,' \
    --exclude='*.tar.gz' \
    --exclude='scripts/*.png' \
    --exclude='db/custom.db-shm' \
    --exclude='db/custom.db-wal' \
    -czf "$OUT" \
    .git .env .zscripts CHECKPOINT.md skills-lock.json \
    src prisma db public scripts tests skills data agent download

echo "== 3) Проверка целостности =="
gzip -t "$OUT" && echo "gzip: OK"
ENTRIES=$(tar -tzf "$OUT" | wc -l)
echo "записей в архиве: $ENTRIES"
echo "skills файлов: $(tar -tzf "$OUT" | grep -c '^sait_copy_4/skills/')"
echo "src файлов:     $(tar -tzf "$OUT" | grep -c '^sait_copy_4/src/')"
echo "git файлов:     $(tar -tzf "$OUT" | grep -c '^sait_copy_4/.git/')"
echo "db в архиве:    $(tar -tzf "$OUT" | grep '^sait_copy_4/db/custom.db$' | wc -l)"
echo "таргзов внутри: $(tar -tzf "$OUT" | grep -c '\.tar\.gz$')  (должно быть 0)"
ls -lh "$OUT"

echo "== 4) Копии: standalone/public + download =="
cp -f "$OUT" .next/standalone/public/
cp -f "$OUT" download/
ls -lh .next/standalone/public/sait_copy_4.tar.gz download/sait_copy_4.tar.gz

echo "== 5) Рестарт сервера (Next снапшотит public/ на старте — иначе 404) =="
bash scripts/restart.sh

echo "== 6) Проверка раздачи =="
curl -sI http://localhost:3000/sait_copy_4.tar.gz | head -8
echo "-- md5 оригинал / копия в standalone / отданный сервером --"
md5sum "$OUT" .next/standalone/public/sait_copy_4.tar.gz
curl -s http://localhost:3000/sait_copy_4.tar.gz | md5sum
echo "== ГОТОВО =="
