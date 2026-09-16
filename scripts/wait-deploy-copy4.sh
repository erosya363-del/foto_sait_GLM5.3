#!/usr/bin/env bash
# wait-deploy-copy4.sh — опрос внешней ссылки бэкапа до появления деплоя (561be1e).
URL_API="https://j1jr777qg2d0-d.space-z.ai/api/backup/sait_copy_4.tar.gz"
URL_STA="https://j1jr777qg2d0-d.space-z.ai/sait_copy_4.tar.gz"
for i in $(seq 1 20); do
  A=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$URL_API")
  S=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$URL_STA")
  echo "[$(date +%H:%M:%S)] попытка $i: /api/backup=$A  статика=$S"
  if [ "$A" = "200" ] || [ "$S" = "200" ]; then echo "ДЕПЛОЙ ВИДЕН"; exit 0; fi
  sleep 30
done
echo "деплой не появился за отведённое время"
exit 1
