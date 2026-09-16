#!/usr/bin/env bash
# gh-release-copy4.sh — публикация sait_copy_4.tar.gz как ассета GitHub Release
# (мгновенная ссылка для пользователя, без ожидания деплоя; лимит ассета 2ГБ).
set -uo pipefail
cd /home/z/my-project

TOKEN=$(git config --get remote.origin.url | sed -n -E 's#https://[^:@/]+:([^@]+)@.*#\1#p')
[ -n "$TOKEN" ] || { echo "токен не найден"; exit 1; }
API=https://api.github.com/repos/erosya363-del/foto_sait_GLM5.3

echo "== 1) релиз copy4-v3.0 =="
REL=$(curl -s -H "Authorization: token $TOKEN" "$API/releases/tags/copy4-v3.0")
if echo "$REL" | rg -q '"id":'; then
  REL_ID=$(echo "$REL" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
  echo "релиз уже существует: id=$REL_ID"
else
  REL=$(curl -s -X POST -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
    -d '{"tag_name":"copy4-v3.0","name":"Резервная копия №4 (v3.0)","body":"Полная копия проекта (каталог фото Askona) на коммите 561be1e — v3.0 + /api/backup. Состав: исходники, .git, .env, .zscripts, db, public, scripts, tests, skills, data, agent, download. Файл: sait_copy_4.tar.gz, 125 МБ (130247987 Б), MD5 e021762d095ad1ada465bd4b8e1d8f20. Восстановление: tar -xzf sait_copy_4.tar.gz → папка sait_copy_4/ → bun install && bun run build.","draft":false,"prerelease":false}' \
    "$API/releases")
  REL_ID=$(echo "$REL" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))")
  [ -n "$REL_ID" ] || { echo "ошибка создания релиза:"; echo "$REL" | head -5; exit 1; }
  echo "релиз создан: id=$REL_ID"
fi

echo "== 2) ассет sait_copy_4.tar.gz =="
ASSETS=$(curl -s -H "Authorization: token $TOKEN" "$API/releases/$REL_ID")
if echo "$ASSETS" | rg -q '"name": *"sait_copy_4.tar.gz"'; then
  echo "ассет уже залит"
else
  echo "заливаю 125МБ (может занять несколько минут)..."
  UP=$(curl -s -X POST -H "Authorization: token $TOKEN" -H "Content-Type: application/gzip" \
    --data-binary @public/sait_copy_4.tar.gz \
    "https://uploads.github.com/repos/erosya363-del/foto_sait_GLM5.3/releases/$REL_ID/assets?name=sait_copy_4.tar.gz")
  echo "$UP" | python3 -c "import json,sys; d=json.load(sys.stdin); print('asset:', d.get('name'), d.get('size'), d.get('browser_download_url') or d)"
fi

echo "== 3) итоговые ссылки =="
curl -s -H "Authorization: token $TOKEN" "$API/releases/$REL_ID" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('HTML:', d['html_url'])
for a in d['assets']:
    print('DL:', a['browser_download_url'], a['size'], 'Б')
"
