#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# snapshot.sh — ЕДИНАЯ ТОЧКА ФИКСАЦИИ ШАГА (защита от откатов песочницы)
#
# Что делает по порядку:
#   1. git commit всех изменений (если есть) с сообщением «snapshot: <label>»
#   2. git tag snap/<label>
#   3. rsync зеркалирует проект → sait_copy_1/ (горячая копия, без мусора)
#   4. tar.gz снапшот → download/snapshots/ (ПЕРЕЖИВАЕТ откат песочницы!)
#      Внутри: исходники + db + .env + .git (полная история) + документация
#   5. Копии worklog/STATUS/CHANGELOG → download/logs/ (постоянная зона)
#   6. Обновляет download/snapshots/INDEX.md
#
# Использование: bash scripts/snapshot.sh "step5-cart"
# Восстановление: bash scripts/restore_snapshot.sh download/snapshots/<файл>.tar.gz
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

LABEL="${1:-manual}"
STAMP="$(date +%Y%m%d-%H%M)"
SEQ_FILE="download/snapshots/.seq"
mkdir -p download/snapshots download/logs

SEQ=$(cat "$SEQ_FILE" 2>/dev/null || echo 0)
SEQ=$((SEQ + 1))
echo "$SEQ" > "$SEQ_FILE"
SEQ_PADDED=$(printf "%03d" "$SEQ")

echo "── [1/6] git commit…"
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add -A
  git commit -m "snapshot: ${LABEL} (${STAMP})" -q
  echo "        закоммичено"
else
  echo "        изменений нет"
fi

TAG="snap/v1.5-${LABEL}"
git tag -f "$TAG" >/dev/null 2>&1 || true
echo "── [2/7] тег $TAG"

echo "── [3/7] push в GitHub (main + теги)…"
# Токен живёт ВНЕ проекта (~/.github-token) — в копии/репозиторий не попадает.
# Нет токена (после сброса песочницы) — снапшот всё равно создаётся, пуш пропускается.
if [ -s "$HOME/.github-token" ] && git remote get-url origin >/dev/null 2>&1; then
  PTOKEN=$(cat "$HOME/.github-token")
  PURL=$(git remote get-url origin)
  PURL="${PURL/https:\/\//https:\/\/erosya363-del:${PTOKEN}@}"
  if git push "$PURL" main --tags --quiet 2>/dev/null; then
    echo "        ✓ отправлено в GitHub"
  else
    echo "        ⚠ push не удался (токен/сеть) — снапшот создан, пуш повторится в следующий раз"
  fi
else
  echo "        пропущено (нет ~/.github-token)"
fi

echo "── [4/7] зеркалирование в sait_copy_1…"
# ВАЖНО: якоря с ведущим «/» — иначе исключение «upload» зацепит src/app/api/upload
rsync -a --delete \
  --exclude=/node_modules --exclude=/.next --exclude=/sait_copy_1 --exclude=/sait_copy_2 --exclude=/public/sait_copy_2.tar.gz \
  --exclude=/download --exclude=/upload --exclude=/tool-results \
  --exclude=/dev.log --exclude=/skills --exclude=/examples --exclude=/mini-services \
  --exclude=/.git \
  ./ sait_copy_1/ >/dev/null
# .git копируем отдельно БЕЗ --delete (история только растёт)
mkdir -p sait_copy_1/.git
rsync -a .git/ sait_copy_1/.git/ >/dev/null
echo "        $(du -sh sait_copy_1 | cut -f1)"

SNAP="download/snapshots/snap-${SEQ_PADDED}-v1.5-${LABEL}-${STAMP}.tar.gz"
echo "── [5/7] tar-снапшот → $SNAP"
# ВАЖНО: «./NAME» — якорь к корню архива; «NAME» без якоря выкинет и src/app/api/upload!
tar -czf "$SNAP" \
  --exclude=./node_modules --exclude=./.next --exclude=./sait_copy_1 --exclude=./sait_copy_2 --exclude=./public/sait_copy_2.tar.gz \
  --exclude=./download --exclude=./upload --exclude=./tool-results \
  --exclude=./dev.log --exclude=./skills --exclude=./examples --exclude=./mini-services \
  --exclude="./server.log" \
  . 2>/dev/null
SIZE=$(du -sh "$SNAP" | cut -f1)
echo "        $SIZE"

echo "── [6/7] постоянные копии документации…"
for f in worklog.md STATUS.md CHANGELOG.md; do
  [ -f "$f" ] && cp -f "$f" "download/logs/${f%.md}-$(date +%Y%m%d).md"
done

echo "── [7/7] INDEX.md"
{
  echo "| ${SEQ_PADDED} | ${STAMP} | v1.5 · ${LABEL} | $(git rev-parse --short HEAD) | ${SIZE} |"
} >> download/snapshots/INDEX.md

echo ""
echo "✅ Снапшот ${SEQ_PADDED} зафиксирован: $SNAP ($SIZE)"
echo "   Git: $(git log --oneline -1 | head -c 60) · тег $TAG"
