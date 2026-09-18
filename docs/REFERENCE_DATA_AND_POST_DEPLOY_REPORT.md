# REFERENCE DATA AND POST-DEPLOY REPORT — Task 49

ТЗ: `NEXT_AGENT_TASKS_REFERENCE_DATA_AND_PHOTO_PERSISTENCE.md`
START_HEAD: `35c4c390d13276e5dc711e87cd6d15f49c03fa16`
FINAL_HEAD: см. финальный ответ задачи (перечень коммитов ветки — §9)
Дата: 2026-09-19

---

## 1. Резюме

Выполнены BLOCK C/D/E/F частично/A/G/H: канонический master-data закоммичен,
идемпотентный сидер написан и протестирован (6 локальных сценариев), справочники
**засеяны на живом сайте** (138 моделей + 161 материал, 0 ошибок, 14 конфликтов
регистра оставлены владельцу), локальная runtime-зона восстановлена из live,
smoke-тест сохранности фото написан и **пройден полным локальным пайплайном**
(два защищённых деплоя через настоящий `.zscripts/build.sh` + cutover из артефакта:
оба тестовых фото выжили, `result: PASS`). Реальный live-цикл smoke — поэтапный
режим готов, выполняется вокруг защищённого редеплоя владельца. Real iPhone/Xiaomi —
NOT TESTED (нужны устройства владельца, чек-листы §8).

Кресла НЕ импортированы. ProductVariant/Photo/файлы НЕ изменены (проверено счётчиками).

---

## 2. BLOCK A — до любого редеплоя

### 2.1 PLATFORM SNAPSHOT — PENDING

Статус: **CHECKED (агентская часть) / PENDING (платформа)**. В доступных агенту
источниках (workspace, Git-история, `/tmp`-артефакты, `download/backups`) потерянные
~20 фото **не обнаружены** (проверялось в PART 1, §20; с тех пор runtime-зона была
стёрта платформенным откатом и восстановлена синком с live — то есть восстановлено
то, что живёт на live сейчас: 26 фото, 38+38 файлов). **Platform snapshot не проверен**
— у песочницы агента нет доступа к консоли платформы. Чек-лист владельцу:

1. Консоль платформы (FC): предыдущие версии контейнера/образа (снапшоты деплоя);
2. снимки постоянного диска/volume за период 17–18.09;
3. старые runtime-тома, если платформа их сохраняет при cutover;
4. если что-то найдено — восстановление: `bash scripts/restore-runtime.sh <архив.tar.gz>`,
   затем `sync-from-live` НЕ нужен (restore идёт напрямую в `download/runtime`).

Формулировка фиксируется как в PART 1.1: **фото считаются непроверенными к
восстановлению, пока platform snapshot не осмотрен** — «невосстановимы» не заявляется.

### 2.2 PRODUCTION TOPOLOGY — SINGLE_INSTANCE

Вывод: **SINGLE_INSTANCE** (по архитектуре деплоя; подтверждение владельца — ниже).

Evidence:
- `docs/FIX_REPORT.md` §17.2: динамика `/api/*` обслуживается сервером **внутри
  контейнера FC** (`X-Fc-Request-Id`), деплой = новый контейнер из артефакта
  (`/tmp/build_fullstack_*.tar.gz` → `/app`), данные едут внутри артефакта;
- runtime-данные живут на эфемерном диске контейнера (`/app/db/custom.db`,
  `/app/next-service-dist/download/runtime/uploads`) — общие инстансы с общим
  диском платформа не создаёт (иначе потеря фото при cutover была бы невозможна
  физически);
- file-based deploy-lock корректен ровно в модели «один живой контейнер на момент
  сборки»: lock ставится на live-контейнер, артефакт выпекается из его данных,
  cutover убивает контейнер вместе с lock'ом (TTL 3600 c — страховка).

Требуется подтверждение владельца: в настройках платформы `max replicas = 1`.
Если платформа когда-либо поднимет ≥2 реплик без общего `RUNTIME_ROOT`,
file-based lock перестанет быть распределённым — это задокументированное
ограничение (см. также ТЗ BLOCK A.2).

### 2.3 FIRST BOOTSTRAP ROLLOUT — готов, одноразовый

Проверено 19.09: live работает на коде **до** PART 1.1 (`/api/admin/deploy-lock`
→ 404), а `/api/admin/export` — **публичный** (200 без токена, мусорный токен
игнорируется) → переходный сценарий §8.1 применим ровно один раз:

1. Токен уже создан bootstrap'ом: `download/runtime/.sync-token` (chmod 600,
   вне Git). **Сохранить его вне песочницы** (platform secret/env) — после
   первого защищённого деплоя live начнёт требовать именно его.
2. Локальная runtime-зона восстановлена синком с live (26 фото, 76 файлов,
   fingerprint A==B, маркер `.live-sync.json` записан) — сидированные словари
   включены (см. §5).
3. Первый защищённый деплой: обычная кнопка redeploy владельцем; сборка платформы
   идёт через `.zscripts/build.sh`, который в bootstrap-режиме
   (`FIRST_DEPLOY_LOCK_BOOTSTRAP=1`) красно предупреждает, требует ручного
   maintenance window (запрет загрузок на время сборки) и мягко пробует lock.
   Если платформа позволяет задать env сборки — установить
   `FIRST_DEPLOY_LOCK_BOOTSTRAP=1` **только на этот раз**.
4. После первого успешного деплоя: флаг больше НЕ использовать; обычная сборка
   без полученного lock'а падает fail-closed (это ожидаемое поведение).

---

## 3. BLOCK B/C — канонический master-data в Git

- `data/reference/catalog-master-data.json` — точная копия приложенного
  `catalog_master_data.json`, canonical reference-источник репозитория.
- Состав (проверено скриптом): категории `Кровати`, `Диваны`; **39** моделей
  диванов; **102** модели кроватей; **190** точных названий тканей; дублей нет;
  `excluded.Кровати = [Основание ASKONA, Основание с ламелями]`;
  `excluded.Кресла = "Entire chairs workbook excluded"`.
- Байт-точность канонических имён сохранена (проверены `Ральф (Ralph)`,
  `Elisa Nova (Элиза нова)`, `Torino (Торинo)`, `Sandra (Сандра)`) — сидер копирует
  строки из JSON как есть, без переводов/автокоррекций.
- Это recovery/reference-источник, НЕ замена runtime-персистентности: фото и
  live-БД продолжают жить в пайплайне lock → final-sync → build (§8 ТЗ master-data).

## 4. BLOCK D — идемпотентный сидер

`scripts/seed-reference-data.ts` (bun). CLI:

```bash
bun scripts/seed-reference-data.ts --dry-run                    # по умолчанию
bun scripts/seed-reference-data.ts --apply                      # вставки в транзакции
bun scripts/seed-reference-data.ts --live-url https://<site> [--apply] [--json-out p]
```

Гарантии (реализованы и протестированы):
- читает ТОЛЬКО `data/reference/catalog-master-data.json`;
- вставляет отсутствующее; не удаляет, не переименовывает, не «чинит» регистр;
- конфликты «отличается только регистром/пробелами» (ключ: trim → lower → схлопнуть
  пробелы) — репортятся и **пропускаются**, без молчаливых слияний и вторых строк;
- ProductVariant/Photo/файлы структурно не затрагиваются (в коде нет обращений);
  после apply счётчики сверяются — расхождение = аварийный exit;
- `--apply` — в `prisma.$transaction`;
- кресла невозможны структурно: если в JSON появится ключ `models["Кресла"]`,
  сидер отказывается работать;
- соответствие уже существующим правилам приложения: Category `name @unique`,
  Model `@@unique([name, categoryId])`, Material — app-level проверка (как в
  admin create);
- вывод ровно по формату ТЗ (`Category/Model/Material: existing/inserted/conflicts`,
  `CHAIRS_IMPORTED=0`, `PRODUCT_VARIANTS_MODIFIED=0`, `PHOTOS_MODIFIED=0`) +
  JSON-отчёт в `tool-results/`.
- Два транспорта: прямой Prisma (тот же алгоритм выбора БД, что в
  `src/lib/runtime.ts`: `RUNTIME_ROOT` → не-легаси `DATABASE_URL` →
  `download/runtime`) и HTTP-режим (`--live-url`): existing из
  `GET /api/dictionaries`, вставки через СУЩЕСТВУЮЩИЙ
  `POST /api/admin {entity, action:"create"}` — никакого нового серверного API.

### 4.1 Локальные тесты сидера (изолированные БД из пустого шаблона)

| Сценарий | Результат |
|---|---|
| dry-run на пустой БД | existing 0/0/0, план 2+141+190, конфликтов 0 — PASS |
| apply на пустой БД | вставлено 2+141+190, верификация счётчиков — PASS |
| повторный dry-run | existing 2/141/190, план 0 — идемпотентность PASS |
| повторный apply | 0 вставок — идемпотентность PASS |
| в БД только регистровый вариант («Ника ПРО») | конфликт, канон НЕ вставлен; остальные 140 моделей вставлены — PASS |
| канон существует + в БД дубль регистра | дубль репортится, канон считается existing — PASS |

## 5. Seeding live (BLOCK E, explicit maintenance action)

Порядок применён по альтернативе BLOCK E «**seed live до получения deploy-lock** →
следующая сборка выполняет locked final sync и забирает строки в артефакт»
(запрещённая последовательность `FINAL SYNC → seed → build` не использовалась;
локальная mutation после маркера не делалась — apply шёл в БД live по HTTP).

### 5.1 DRY-RUN против live (до изменений)

| Entity | existing | plan insert | conflicts |
|---|---|---|---|
| Categories | 2 | 0 | 0 |
| Кровати (102) | 0 | 102 | 0 |
| Диваны (39) | 1 | 36 | 2 |
| Materials (190) | 17 | 161 | 12 |

### 5.2 APPLY против live

- Вставлено: **138 моделей + 161 материал, 0 ошибок** (категории уже были).
- Верификация после apply (повторный `GET /api/dictionaries`): все канонические
  строки присутствуют или числятся в конфликтах.
- Словари live: было 2 категории / 8 моделей / 35 материалов → стало
  **2 / 146 / 196** (146 = 139 канонических + 9 предсуществующих; 196 = 178 + 18).
- `CHAIRS_IMPORTED=0`, `PRODUCT_VARIANTS_MODIFIED=0`, `PHOTOS_MODIFIED=0`.
- JSON: `tool-results/seed-live-dry-run.json`, `tool-results/seed-live-apply.json`
  (вне Git, копии отчёта — в §5.3).

### 5.3 CONFLICTS (14) — требуют ручного решения владельца

Сидер не сливает и не переименовывает. Варианты: переименовать строку live до
канона в Админке (тогда канон больше не «конфликт») или оставить как есть.

| # | Entity | Канон (не вставлен) | В БД |
|---|---|---|---|
| 1 | model (Диваны) | Карина Про | Карина ПРО |
| 2 | model (Диваны) | Ника Про | Ника ПРО |
| 3–14 | material | Casanova Seawave/Beige/Chocolate/Grey/Lilac/Milk/Stone/Marsala/Desert/Ice/Grass/Scandy | те же с маленькой буквы |

### 5.4 Восстановление локальной runtime-зоны (bootstrap-синк)

`SYNC_TOKEN_BOOTSTRAP=1 bash scripts/sync-from-live.sh https://j1jr777qg2d0-d.space-z.ai --yes`
→ зона `download/runtime` восстановлена из live (стёрта платформенным откатом):
26 фото в БД, optimized=38, thumbs=38 (все sha256 сверены, fingerprint A==B),
токен `.sync-token` создан, маркер `.live-sync.json` записан, сидированные
словари подтверждены в локальной копии (existing 2/139/178).

## 6. BLOCK F — smoke сохранности фото

Создано: `scripts/post-deploy-photo-smoke.mjs`, `docs/POST_DEPLOY_PHOTO_PERSISTENCE.md`,
evidence `tool-results/post-deploy-photo-persistence.json` (коммитится).

### 6.1 Прогон: полный локальный пайплайн — RESULT: PASS

Среда: изолированная runtime-зона (пустой шаблон → сидирование), origin-сервер из
текущего кода (`:3441`), два цикла «upload → защищённая сборка `.zscripts/build.sh`
(LOCK→DRAIN→FINAL SYNC→VERIFY→BUILD→ARTIFACT VERIFY→post-artifact re-check→renew
3600 c) → cutover из tar-артефакта» (сервер стартует из артефакта, как контейнер FC).

| Проверка | Цикл 1 | Цикл 2 |
|---|---|---|
| фото загружено через `/api/upload` (БД + media 200) ДО деплоя | PASS | PASS |
| деплой (build.sh, артефакт SMOKE1/SMOKE2) | OK | OK |
| deploy-lock получен / финальный renew | `da542fc0…` / 3600 c | `f046f8be…` / 3600 c |
| запись в БД после cutover | true | true (оба фото) |
| optimized HTTP | 200 | 200 (оба) |
| thumb HTTP | 200 | 200 (оба) |
| счётчики не уехали назад | PASS | PASS (фото=2) |

**result: PASS** — фото №1 пережило первый деплой; фото №2 (загруженное уже в
новый контейнер) и фото №1 пережили второй деплой. Это локальное доказательство
нового пайплайна end-to-end; физический cutover платформы закрывается поэтапным
режимом вокруг реального редеплоя (§6.2).

### 6.2 Реальный live-цикл — готов, ожидает защищённого редеплоя

Поэтапный режим (каждая команда дописывает evidence):

```bash
bun scripts/post-deploy-photo-smoke.mjs --live-url https://j1jr777qg2d0-d.space-z.ai --stage baseline
bun scripts/post-deploy-photo-smoke.mjs --live-url ... --stage pre-deploy-1
#  → владелец: первый защищённый редеплой (bootstrap, §2.3)
bun scripts/post-deploy-photo-smoke.mjs --live-url ... --stage post-deploy-1
bun scripts/post-deploy-photo-smoke.mjs --live-url ... --stage pre-deploy-2
#  → владелец: второй обычный защищённый редеплой
bun scripts/post-deploy-photo-smoke.mjs --live-url ... --stage post-deploy-2
```

Тестовые фото подписаны комментарием `post-deploy-photo-smoke cycleN`; удаляются
штатно через Админку после прогона.

## 7. Найдено и исправлено попутно

- **Рабочая копия повреждена платформенным откатом**: `src/app/api/upload/route.ts`
  стёрт с диска (4-й случай в истории проекта), 147 файлов — шум режимов.
  Восстановлено из HEAD (`git checkout -- .`); HEAD `35c4c39` не пострадал.
- Комментарий `route.ts` «FormData: photos[]» неточен: роут читает
  `fd.getAll("photos")` — зафиксировано в smoke-скрипте (сам роут не менялся).
- `bun console.log` глотает `[m`-последовательности (ANSI-артефакт) — учтено в
  отчётах сидера.

## 8. BLOCK G — real device smoke — NOT TESTED

Real iPhone и Real Xiaomi **NOT TESTED** — требуются устройства владельца после
защищённого редеплоя. Чек-листы (ТЗ BLOCK G):

**iPhone**: полоса снизу на холодном старте (нет/есть); после Search open/close;
скачки панели при появлении/скрытии браузерной хром-оболочки; Upload Sheet ~86% и
анкеровка; клавиатура — поле ввода и CTA доступны; зум страницы вне viewer'а;
блик/гало на линзе; свайп страниц без повторного входа; хаптика — записать
фактический результат (не заявлять PASS из headless). При возврате полосы/скачков —
`?viewportDebug=1` + реальные метрики.

**Xiaomi/Android**: fallback-линза видна; нажатие увеличивает; drag держит одну
капсулу; перекрытая надпись/иконка — бирюзовая и уменьшенная; предыдущий таб
гаснет, когда линза его покинула; отпускание возвращает компактную линзу; линза
не пропадает из-за backdrop/SVG-фильтров. Записать модель устройства и версию
браузера.

## 9. Коммиты ветки (пофайлово)

- `data/reference/catalog-master-data.json` — канонический master-data (BLOCK C);
- `scripts/seed-reference-data.ts` — идемпотентный сидер (BLOCK D);
- `scripts/post-deploy-photo-smoke.mjs`, `docs/POST_DEPLOY_PHOTO_PERSISTENCE.md` —
  smoke сохранности фото (BLOCK F);
- `.gitignore` — исключение evidence-JSON из игнора `tool-results/`;
- `tool-results/post-deploy-photo-persistence.json` — evidence локального прогона
  (result: PASS);
- `docs/REFERENCE_DATA_AND_POST_DEPLOY_REPORT.md` — этот отчёт.

## 10. OPEN ISSUES / следующие шаги

1. Владелец: осмотреть **platform snapshot** (чек-лист §2.1) — судьба ~20 фото.
2. Владелец: подтвердить **replicas = 1** (§2.2).
3. Владелец: **первый защищённый редеплой** (bootstrap §2.3; токен сохранить вне Git).
4. После редеплоя: поэтапный smoke на реальном live (§6.2) — CYCLE 1 + CYCLE 2.
5. Владелец: решить 14 регистровых конфликтов (§5.3) в Админке.
6. Владелец: real iPhone/Xiaomi чек-листы (§8).
7. Следующая обычная сборка заберёт сидированные словари в артефакт автоматически
   (locked final sync) — отдельных действий не требуется.
8. STOP: Admin/roles redesign не начинался — ожидает ревью владельцем/ChatGPT.
