# POST-DEPLOY PHOTO PERSISTENCE — smoke-тест сохранности фото

ТЗ: `NEXT_AGENT_TASKS_REFERENCE_DATA_AND_PHOTO_PERSISTENCE.md` (BLOCK F).
Скрипт: `scripts/post-deploy-photo-smoke.mjs`.
Evidence: `tool-results/post-deploy-photo-persistence.json` (коммитится — исключение в `.gitignore`).

## Почему этот тест существует

Исторический баг проекта: **фото, загруженные через живой сайт, уничтожались редеплоем**
(деплой = новый контейнер FC из артефакта; всё, что сотрудник загрузил в старый контейнер
после сборки артефакта, умирало вместе с ним; ~20 фото владельца погибли именно так,
см. `docs/FIX_REPORT.md` §17 и `docs/CRITICAL_STABILITY_PART11_REPORT.md`).

Доказательство исправления — не «тесты зелёные», а **реальный цикл**:

```
загрузили фото №1 → защищённый деплой → фото №1 осталось
загрузили фото №2 → ВТОРОЙ защищённый деплой → фото №1 и №2 остались
                    (optimized = HTTP 200, thumb = HTTP 200, запись в БД присутствует)
```

Второй деплой — главный acceptance-критерий: он доказывает, что данные,
попавшие на live ПОСЛЕ первого деплоя, корректно забираются финальным синком
второй сборки и переносятся в новый контейнер.

## Режимы запуска

### 1. Полный локальный прогон нового пайплайна (без платформы)

```bash
bun scripts/post-deploy-photo-smoke.mjs --local-pipeline
```

Что делает (всё в изолированной среде `tool-results/photo-smoke-*`, production-зона
`download/runtime` НЕ используется):

1. `bun run build` → standalone текущего кода;
2. поднимает **origin-сервер** `:3441` (аналог живого контейнера: отдельная
   runtime-зона из пустого шаблона, сидирование `scripts/seed-reference-data.ts --apply`);
3. **ЦИКЛ 1**: генерирует уникальное тестовое фото (sharp, JPEG с меткой времени) →
   `POST /api/upload` → проверка: запись в БД (`/api/admin?view=photos`),
   `optimized` и `thumb` → HTTP 200;
4. **защищённый деплой №1**: настоящий `.zscripts/build.sh`
   (`BUILD_ID=SMOKE1`, `LIVE_BASE_URL=:3441`, `RUNTIME_ROOT=<изолированная>`) —
   то есть полностью `ACQUIRE LOCK → DRAIN → FINAL SYNC → VERIFY LOCK → BUILD →
   ARTIFACT VERIFY → post-artifact re-check → renew ≥3600s`;
5. **cutover №1**: артефакт `/tmp/build_fullstack_SMOKE1.tar.gz` распаковывается,
   сервер стартует **из артефакта** (`next-service-dist/server.js` + `db/custom.db`
   из артефакта — ровно как `start.sh` в контейнере FC) на `:3442`;
   фото №1 перепроверяется на новом сервере;
6. **ЦИКЛ 2**: фото №2 загружается уже на сервер-из-артефакта →
   защищённый деплой №2 (`SMOKE2`) → cutover №2 (`:3443`) →
   **оба** фото перепроверяются;
7. итог пишется в evidence-файл (`result: PASS|FAIL`), все логи — в
   `tool-results/photo-smoke-files/*.log`.

Требования: свободные порты 3441–3443, `bun`, `sharp` (уже в зависимостях).
Длительность: ~5–8 минут (три полных сборки).

### 2. Поэтапный режим вокруг РЕАЛЬНОГО редеплоя владельца

Каждый этап — отдельный запуск, дописывающий evidence-файл (можно в разные дни):

```bash
# 0) до всего: снимок live (счётчики + 2 существующих фото + их HTTP-статусы)
bun scripts/post-deploy-photo-smoke.mjs --live-url https://j1jr777qg2d0-d.space-z.ai --stage baseline

# 1) загрузка фото №1 (реальный /api/upload) и проверка ДО деплоя
bun scripts/post-deploy-photo-smoke.mjs --live-url ... --stage pre-deploy-1
#    ↓ владелец делает защищённый редеплой нового кода
bun scripts/post-deploy-photo-smoke.mjs --live-url ... --stage post-deploy-1

# 2) загрузка фото №2 уже на новый live
bun scripts/post-deploy-photo-smoke.mjs --live-url ... --stage pre-deploy-2
#    ↓ второй защищённый редеплой
bun scripts/post-deploy-photo-smoke.mjs --live-url ... --stage post-deploy-2
#    → evidence.result = PASS только если ОБА фото пережили свои деплои
```

Опционально `--token <SYNC_EXPORT_TOKEN>` — тогда дополнительно снимаются счётчики
файлов из манифеста экспорта (`optimized/thumbs`). Без токена счётчики файлов = `null`
(метод фиксируется в evidence), проверка БД и media-HTTP работает всегда.

Проверки на каждом этапе: запись в БД, `optimized` → 200, `thumb` → 200,
счётчики не «уехали назад» (photoCount/optimizedCount/thumbCount после деплоя ≥ до).

## Схема evidence-файла

```json
{
  "startedAt": "...", "finishedAt": "...",
  "liveUrl": "...", "environment": "local-pipeline-simulation | real-live",
  "before": { "photoCount": 0, "optimizedCount": 0, "thumbCount": 0 },
  "cycle1": {
    "testPhoto": { "file": "...", "id": "...", "url": "/api/media/optimized/...", "thumbUrl": "/api/media/thumbs/..." },
    "beforeDeploy": "PASS",
    "afterDeploy": "PASS",
    "afterDeployDetails": { "check": { "dbVisible": true, "optimizedStatus": 200, "thumbStatus": 200 } }
  },
  "cycle2": { "...то же + photo1 и photo2 проверяются оба..." },
  "deploys": [ { "cycle": 1, "buildId": "SMOKE1", "lockId": "...", "finalRenewSec": 3600 } ],
  "result": "PASS",
  "notes": ["..."]
}
```

Бинарники тестовых фото (генерируются в `tool-results/photo-smoke-files/`) и секреты
в Git **не попадают**; коммитится только JSON-отчёт.

## Тестовые фото на реальном live

Тестовые фото подписаны комментарием `post-deploy-photo-smoke cycleN` и видны в
каталоге — это осознанное требование ТЗ (проверка «через реальный UI/API-поток»).
После успешного прогона их можно убрать штатно: Админка → Фото → удалить
(корзина, автоочистка 30 дней) — на сохранность остальных фото это не влияет.

## Что тест НЕ доказывает

- Локальный прогон не заменяет реальный cutover платформы (переключение контейнера
  FC выполняет платформа по редеплою владельца). Для него — режим 2.
- Реальные устройства (iPhone/Xiaomi) — отдельный чек-лист BLOCK G в
  `docs/REFERENCE_DATA_AND_POST_DEPLOY_REPORT.md`.
