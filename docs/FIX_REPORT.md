# Askona Photo Catalog — Fix Report

**Дата:** 17 сентября 2026 · **Аудитор этапа:** сессия стабилизации (Super Z)
**Назначение:** полный отчёт для повторной проверки другим аудитором.

---

## 1. Исходное состояние

| Параметр | Значение |
|---|---|
| Commit до работы | `c1e12c677ce05afef435c45287ea4efb8d582a04` («1212b3f4-…», platform worklog commit) |
| Ветка | `main` (origin/main отставал на 5 коммитов: iOS-оболочка + worklog) |
| Дата работы | 17 сентября 2026, 11:30–13:00 UTC |
| Deployment | edge-шлюз `https://j1jr777qg2d0-d.space-z.ai` = снапшот последнего задеплоенного коммита (`0e30c86`); динамика `/api/*` проксируется живьём в эту песочницу (сервер `:3000`, standalone) |
| Версия приложения в UI | «Склад мебели · **v1.4**» — захардкожена, расходилась с фактической (CHANGELOG 1.7.0, package.json 0.2.1) |
| git status до работы | чистый |

---

## 2. Найденные проблемы

| ID | Приоритет | Проблема | Причина | Как воспроизводилась | Риск |
|---|---|---|---|---|---|
| F-001 | P0 | Фото пользователей исчезают / заменяются «тестовыми» / возвращается другой набор | **db/custom.db и 76 файлов public/uploads были закоммичены в git.** Деплой/пробуждение/откат песочницы рематериализует рабочую зону из последнего коммита → runtime-состояние затирается замороженной git-версией | Загрузить фото → git push любого коммита → деплой/откат → каталог возвращается к состоянию коммита | Потеря реальных данных каталога |
| F-002 | P0 | То же + потеря ДАЖЕ незакоммиченных данных при сборке | Standalone-сервер делает `process.chdir(__dirname)` → фолбэк `DATABASE_URL=file:<cwd>/db/custom.db` создавал БД **внутри `.next/standalone/db/`**; каждый `next build` стирает её. Эксперимент: сборка 17.09 11:37 запекла в `.next/standalone` весь workspace, включая `db/custom.db` (md5 совпадал с корневым) | `bun run build` → все загрузки после предыдущей сборки исчезают | Потеря данных при каждом build |
| F-003 | P0 | Новые фото внешне НЕ видны (404) до следующего деплоя | Edge-шлюз отдаёт статику **только из снапшота деплоя**. Probe-тест: новый `public/edge-probe.txt` → внешне 404 (локально 200); новый `/uploads/optimized/edge-probe.jpg` → внешне 404; старый git-tracked `bed-pola-1.jpg` → внешне 200 | Загрузить фото на живом сайте → открыть URL снаружи → 404 | «Загрузил — а фото нет» |
| F-004 | P0 | Возможен полный авто-сброс каталога | `prisma/seed.ts` начинался с `deleteMany()` по **всем** таблицам (Photo, ProductVariant, Category, …) и был валидной командой `prisma db seed`-класса; плюс `package.json` содержал `db:push --accept-data-loss` и `db:reset` | Один запуск seed/reset → каталог пуст | Катастрофический |
| F-005 | P1 | Публичная раздача полных резервных копий проекта | Роут `/api/backup/[name]` + `public/sait_copy_2.tar.gz` (36 МБ, закоммичен в git) — любой человек скачивает весь проект с БД и .env-структурой | `curl <домен>/api/backup/sait_copy_2.tar.gz` | Утечка данных |
| F-006 | P1 | Production build не падает на TS-ошибках | `next.config.ts`: `typescript.ignoreBuildErrors: true` | `tsc --noEmit` находил 17 ошибок (prisma/seed.ts), build проходил | Скрытые баги в проде |
| F-007 | P1 | Мутирующие E2E пишут в production | `test-s5`, `audit-full` (секция H) создавали категории/фото/корзину прямо на `:3000` (реальная БД) | Запуск тестов → тестовый мусор в проде | Порча прод-данных тестами |
| F-008 | P2 | Версия в UI неверна | «v1.4» захардкожена в `portal.tsx`; реальная версия 1.7.0 | Открыть сайдбар | Невозможно определить деплой |
| F-009 | P2 | Браузерный zoom запрещён | `maximumScale: 1, userScalable: false` в viewport meta | Попытка pinch-zoom на iPhone/Android | Доступность |
| F-010 | P2 | Малые touch-target | Переключатель темы 28×28, вид «Остатков» 32×36, карандаш фото 28×28 | audit-full секция C | Промахи на телефоне |
| F-011 | P2 | Debug-глобалы в production | `window.__portal`, `window.__pswp` выставлялись всегда | Консоль в проде | Мусор/информация о внутренностях |
| F-012 | P2 | Edge кэширует ответы API | Внешний `/api/catalog` отдавал устаревший ответ (старые URL `/uploads/*`) после миграции БД на `/api/media/*` — заголовков кэширования API не выставляли | `curl` внешний vs локальный | Расхождение внешнего и живого каталога |

---

## 3. Главная проблема с фотографиями (F-001/F-002/F-003)

### Почему фотографии исчезали — точная цепочка

**Механизм А (git-заморозка):** история коммитов `db/custom.db` — 8+ коммитов
(`c5c4584`, `c85a036`, `8d206cb`, `979f8fd`, `f1611f6`, `011cb0e`, `ce9bc60`, `561be1e`).
`git ls-files` содержал `db/custom.db` и 76 файлов `public/uploads/{optimized,thumbs}/…`
(сид-набор эпохи v2.7–v2.8). Платформа при деплое/пробуждении восстанавливает
рабочую зону из коммита → **БД и uploads откатывались к моменту последнего
коммита, который их касался**. Симптом «возвращается другой набор фотографий» =
возврат git-сид-набора. Симптом «исчезают» = удаление всего, что было
загружено после коммита.

**Механизм Б (выпечка в сборку):** `.next/standalone/server.js` выполняет
`process.chdir(__dirname)`; старый фолбэк в `src/lib/db.ts` —
`file:<cwd>/db/custom.db` → в standalone это `.next/standalone/db/custom.db`.
Проверено: сборка 17.09 11:37 скопировала в standalone весь workspace
(`src/`, `scripts/`, `db/`, `download/`, `.env`), а `db.ts`-якорь `paths.ts`
уводил и uploads внутрь сборки. **Каждый rebuild стирал всё загруженное
после предыдущей сборки.**

**Механизм В (edge-404):** probe-эксперимент (файлы создавались и удалялись):

| Файл | Локально | Внешне |
|---|---|---|
| `public/edge-probe.txt` (новый) | 200 | **404** |
| `/uploads/optimized/edge-probe.jpg` (новый) | 200 | **404** |
| `/uploads/optimized/bed-pola-1.jpg` (был в git → в снапшоте) | 200 | 200 |

→ новые фото не видны снаружи до следующего деплоя; а следующий деплой
затирал их механизмом А. **Замкнутый круг потери фото.**

### Старые и новые пути

| Что | Было | Стало |
|---|---|---|
| SQLite БД | `db/custom.db` (git-tracked) / `.next/standalone/db/custom.db` (build-dir) | **`download/runtime/database/custom.db`** (env: `DATABASE_URL`/`RUNTIME_ROOT`) |
| Optimized фото | `public/uploads/optimized/` (git-tracked / выпекались в сборку) | **`download/runtime/uploads/optimized/`** (env: `UPLOADS_ROOT`) |
| Thumbs | `public/uploads/thumbs/` | **`download/runtime/uploads/thumbs/`** |
| Раздача | `/uploads/*` (edge: только из снапшота) | **`/api/media/*`** (edge проксирует `/api/*` живьём) + `/uploads/*` легаси-маршрут на те же каталоги |

### Защищённые runtime-директории

`download/runtime/` — папка `download/` документирована проектом как
«единственная зона, переживающая откат песочницы»; она исключена из git и
из состава сборки (`scripts/prune-standalone.sh`). Внутри: `database/`,
`uploads/optimized/`, `uploads/thumbs/`, `manifest.txt`.

### Почему следующий deploy больше не затронет данные

1. **В git больше нет runtime-данных** — `git rm --cached db/custom.db`,
   `git rm -r --cached public/uploads` (+ `.gitignore`). Рематериализация из
   коммита физически не может затереть `download/runtime/` — этих путей в
   коммите нет.
2. **Сборка не трогает runtime** — пути резолвит `src/lib/runtime.ts`
   (`projectRoot()` устойчив к chdir; `RUNTIME_ROOT` env), данные лежат вне
   `.next`; `prune-standalone.sh` выкидывает `download/`, `db/`,
   `public/uploads` из standalone. Доказано regression-тестом (см. §14).
3. **Новые фото видны снаружи** — URL `/api/media/*`, edge проксирует `/api/*`
   живьём (проверено: внешний `/api/admin` = 200 на живых данных).

### Миграция (выполнена, идемпотентный скрипт сохранён)

`scripts/migrate-runtime.sh`: WAL checkpoint → копия БД → rsync uploads →
**md5-верификация** (БД + 76 файлов) → переключение `.env`. Исходные файлы
`db/custom.db` и `public/uploads/` на диске СОХРАНЕНЫ (страховка, не в git).
`scripts/migrate-photo-urls.mjs`: 26 Photo + 35 Material URL
`/uploads/* → /api/media/*` (dry-run по умолчанию, авто-бэкап БД перед
`--apply`, идемпотентен).

---

## 4. База данных

| Аспект | Состояние |
|---|---|
| Старое расположение | `db/custom.db` (tracked) + ambient `DATABASE_URL=file:/home/z/my-project/db/custom.db`, экспортируемая платформой во все процессы (обнаружено через `/proc/2940/environ`) — **игнорируется** кодом как легаси |
| Новое расположение | `download/runtime/database/custom.db` |
| Миграции схемы | Прямой `prisma db push` только вручную; **`--accept-data-loss` удалён из package.json**, `db:reset` удалён; `prisma/seed.ts` УДАЛЁН (начинался с `deleteMany()` всех таблиц — вектор авто-сброса, F-004) |
| Bootstrap чистого деплоя | `db/schema-template-empty.db` — пустая схема (0 строк, проверено count=0/0/0); `ensureRuntime()` копирует её ТОЛЬКО если файла БД нет; существующая БД никогда не перезаписывается |
| Backup | `scripts/backup-runtime.sh` → `download/backups/runtime-*.tar.gz` (WAL checkpoint + manifest: счётчики 8 таблиц + md5 всех файлов; ротация 10 шт.; вне web-root, вне git) |
| Restore | `scripts/restore-runtime.sh <архив>` — temp-распаковка → структура → `PRAGMA integrity_check` → сверка manifest → подмена с сохранением предыдущей зоны как `.bak-*` |
| Защита от reset | Ни один скрипт/команда запуска приложения не выполняет reset/seed/migrate; автоматических Prisma-команд в build/start/dev нет |

**Первый созданный бэкап:** `download/backups/runtime-20260917-1210-стабилизация.tar.gz`
(4.1 МБ; photos=26, variants=20, categories=12, models=18, materials=35, sizes=5, tags=10, stockItems=32).

---

## 5. Загрузка фотографий

| Изменение | Файл |
|---|---|
| Откат частичной записи: упал `db.photo.create` → unlink optimized+thumb, записанных ЭТИМ запросом (имена уникальны — чужие файлы не задеваются) | `src/app/api/upload/route.ts` |
| Пустой вариант, созданный этим же запросом при 0 сохранённых фото, удаляется | там же |
| fabric-photo: тот же откат + чистка старого swatch для обоих префиксов | `src/app/api/fabric-photo/route.ts` |
| Новые URL: `/api/media/optimized|thumbs/<uniq>` | оба роута |
| Валидация (без изменений): ≤10 файлов, ≤25 МБ, JPEG/PNG/WebP, magic-bytes через sharp | `src/app/api/upload/route.ts` |

Валидация и бизнес-логика не изменялись — только защита целостности и URL.

---

## 6. Backup

| Аспект | Значение |
|---|---|
| Что изменено | Удалён роут `src/app/api/backup/[name]/route.ts`; `public/sait_copy_2.tar.gz` удалён из web-root и из git (приватная копия в `download/backups/`, md5 `22e9a10d…` сверен до удаления публичной) |
| Публичный endpoint | БОЛЬШЕ НЕТ (проверка: `GET /api/backup/…` → 404; других раздач архивов нет) |
| Private storage | `download/backups/` — вне web-root, вне git (`.gitignore`) |
| Backup command | `bash scripts/backup-runtime.sh ["метка"]` |
| Restore command | `bash scripts/restore-runtime.sh <архив.tar.gz>` (проверка без изменений: `--check`) |
| Состав | SQLite (консистентный WAL-checkpoint) + uploads/optimized + uploads/thumbs + manifest.txt (счётчики + md5) |
| Что НЕ входит | Исходники, .env, node_modules (они и так в git / не нужны) |

**Историческая оговорка:** старые коммиты GitHub всё ещё содержат
`public/sait_copy_2.tar.gz` в истории (force-push запрещён ТЗ — история не
переписывалась). В HEAD архива нет.

---

## 7. Tests

| Test | Before | After | Result |
|---|---|---|---|
| `tsc --noEmit` (typecheck) | 17 ошибок (скрыты ignoreBuildErrors) | 0 ошибок | PASS |
| `eslint .` | 0 (с требованием обходов) | 0 | PASS |
| `bun run build` (strict) | проходил с ошибками TS | 0 ошибок, standalone чистый | PASS |
| Regression сохранности фото (`regression-photo-persistence.mjs`) | НЕ СУЩЕСТВОВАЛО | **17/17 PASS** (2 цикла build+restart) | PASS |
| test-s5 (корзина/удаления/автоочистка) | мутировал прод | в изоляции, полный прогон | PASS (все чеки ✓) |
| test-s4 (товары/справочники/дизайн) | мутировал прод | в изоляции | 34/34 PASS |
| audit-full --quick (сплэш/разделы/tap-target/offline/upload) | на проде | в изоляции | 0 находок |
| audit-back (Back/history, 4 сценария) | — | на живом :3000 | 4/4 PASS |
| Viewport-аудит (15 размеров × 4 раздела + поиск) | НЕ СУЩЕСТВОВАЛО | 60 комбинаций | 0 проблем |
| restore-roundtrip (backup→мутация→restore→сверка) | НЕ СУЩЕСТВОВАЛО | 13/13 PASS (v2: + fail-closed сверка manifest) | PASS |
| Консоль/сеть (console.error, pageerror, 4xx/5xx, requestfailed) | — | во всех 60 комбинациях | 0 неожиданных |

---

## 8. Viewports (все проверенные)

Мобильные портрет: 320×568, 360×640, 375×667, 390×844, 393×852, 412×915, 430×932.
Планшеты: 768×1024, 820×1180. Десктоп: 1280×800, 1366×768, 1440×900, 1920×1080.
Ландшафт: 852×393, 932×430.
Скриншоты мобильных разделов: `tool-results/stabilize-shots/` (36 шт.).

---

## 9. UI fixes

| # | Исправление | Где |
|---|---|---|
| 1 | Hit-area переключателя темы 28×28 → 44×44 (псевдоэлемент `after:-inset-2`, иконка и визуал НЕ изменены) | `theme-switch.tsx` |
| 2 | Hit-area переключателя вида «Остатков» 32×36 → 44×48 | `stock-view.tsx` |
| 3 | Hit-area карандаша «Редактировать привязку фото» 28×28 → 44×44 | `admin-photobank.tsx` |
| 4 | Браузерный zoom разрешён (maximumScale/userScalable удалены; авто-зум полей предотвращён существующим `font-size: max(16px,1em)` — проверено в globals.css:1606) | `layout.tsx` |
| 5 | `window.__portal` / `window.__pswp` — только `NODE_ENV !== "production"` | `store.ts`, `photo-viewer.tsx` |
| 6 | Версия в UI из сборки: «v1.7.0 · \<sha\>» | `portal.tsx` + `next.config.ts` |

**Этап 13 (overlap в «Остатках») — вердикт: БАГА НЕТ.** Прошлые сигналы
оказались артефактами: (а) элемент «Закрыть поиск» с `visibility:hidden`
попадал в выборку и давал ложное перекрытие (скрытые элементы не перехватывают
тапы — в аудит добавлен фильтр display/visibility/opacity/pointer-events);
(б) тап-проверка нажимала кнопку режима, который и так активен по умолчанию
(`stockMode: "compact"` в store) — `aria-pressed` законно не менялся. Реальные
тапы «Карточки ⇄ Компактный вид» работают на всех 15 размерах; блокирующих
перекрытий не найдено.

---

## 10. Changed files

| File | Что изменено | Почему |
|---|---|---|
| `src/lib/runtime.ts` | **НОВЫЙ** — единая точка runtime-путей + bootstrap | Отделение данных от кода (F-001/002) |
| `src/lib/paths.ts` | Переписан поверх runtime.ts (совместимый API) | Там же |
| `src/lib/db.ts` | Разрешение БД через runtime.ts + `ensureRuntime()` | Там же + игнор легаси env |
| `src/app/api/media/[...path]/route.ts` | **НОВЫЙ** — live-раздача фото | F-003 (edge-404) |
| `src/app/uploads/[...path]/route.ts` | Стал легаси-маршрутом (те же каталоги) | Совместимость старых ссылок |
| `src/lib/photo-fs.ts` | safeTarget принимает `/uploads/` и `/api/media/` | Работа с новыми URL |
| `src/app/api/upload/route.ts` | Rollback частичной записи, очистка пустого варианта, URL `/api/media` | §5 |
| `src/app/api/fabric-photo/route.ts` | Тот же откат + чистка старого swatch | §5 |
| `src/middleware.ts` | **НОВЫЙ** — `Cache-Control: no-store` для `/api/*` | F-012 |
| `db/schema-template-empty.db` | **НОВЫЙ** — пустая схема (0 строк) | Чистые деплои без seed |
| `prisma/seed.ts` | **УДАЛЁН** | F-004 (auto-seed вектор) |
| `src/app/api/backup/[name]/route.ts` | **УДАЛЁН** | F-005 |
| `public/sait_copy_2.tar.gz` | **УДАЛЁН из web-root и git** (приватная копия проверена) | F-005 |
| `db/custom.db`, `public/uploads/**` | **Сняты с git-трекинга** (файлы на диске сохранены) | F-001 |
| `.gitignore` | runtime-зона, легаси-БД, архивы, `!db/schema-template-empty.db` | F-001 |
| `src/lib/store.ts` | `__portal` только dev | F-011 |
| `src/components/photo-viewer.tsx` | `__pswp` только dev | F-011 |
| `src/components/theme-switch.tsx` | Hit-area 44px | F-010 |
| `src/components/stock-view.tsx` | Hit-area 44px (обе кнопки) | F-010 |
| `src/components/admin-photobank.tsx` | Hit-area карандаша 44px | F-010 |
| `src/app/layout.tsx` | Zoom разрешён | F-009 |
| `src/components/portal.tsx` | Версия из `NEXT_PUBLIC_APP_VERSION` | F-008 |
| `next.config.ts` | ignoreBuildErrors удалён; `NEXT_PUBLIC_APP_VERSION` = package.json + git SHA | F-006, F-008 |
| `package.json` | version 1.7.0; `typecheck`, `verify`; build + prune; `db:push` без `--accept-data-loss`; `db:reset` удалён | F-004, F-006, этап 11 |
| `scripts/migrate-runtime.sh` | **НОВЫЙ** — миграция в runtime-зону с md5-верификацией | §3 |
| `scripts/migrate-photo-urls.mjs` | **НОВЫЙ** — идемпотентная смена URL в БД | §3 |
| `scripts/prune-standalone.sh` | **НОВЫЙ** — чистка workspace-копии из standalone | F-002 |
| `scripts/backup-runtime.sh` | **НОВЫЙ** | §6 |
| `scripts/restore-runtime.sh` | **НОВЫЙ** | §6 |
| `scripts/test-restore-roundtrip.sh` | **НОВЫЙ** — 10/10 PASS | §7 |
| `scripts/regression-photo-persistence.mjs` | **НОВЫЙ** — 17/17 PASS | §14 |
| `scripts/run-isolated.sh` | **НОВЫЙ** — изоляция E2E | F-007 |
| `scripts/stabilize-viewport-audit.mjs` | **НОВЫЙ** — 60 комбинаций, 0 проблем | §8 |
| `scripts/test-s5.mjs` | Env-параметры, runtime-пути, оба префикса URL | F-007 |
| `scripts/test-s4.mjs`, `test-s6.mjs`, `test-v31.mjs`, `audit-full.mjs`, `audit-back.mjs` | `E2E_BASE` env | F-007 |
| `scripts/db-stats.js`, `dbg-stabilize.mjs`, `dbg-nav.mjs` | **НОВЫЕ** — инструменты диагностики | Сопровождение |
| `CHANGELOG.md` | Запись v1.8.0 | Документация |
| `docs/FIX_REPORT.md` | **НОВЫЙ** — этот отчёт | Этап 28 |
| `.env` | `DATABASE_URL` → runtime-зона (файл в git НЕ входит) | §4 |

---

## 11. Git

| Commit | Message | Файлы (кратко) |
|---|---|---|
| `39b830f` | fix(runtime): отделить БД и пользовательские фото от исходного кода | runtime.ts, paths.ts, db.ts, media route, легаси route, photo-fs, middleware, template DB, migrate-скрипты, .gitignore, untrack db+uploads |
| `968ed3d` | fix(upload): откат частичной записи + URL /api/media | upload route, fabric-photo |
| `4cc6da0` | fix(backup): убрать публичную раздачу резервных копий, приватный backup/restore | −backup route, −tar.gz, backup/restore/roundtrip скрипты |
| `4c38e2d` | test(e2e): изолировать мутирующие тесты от production-данных | run-isolated, env в 6 тестах, regression, viewport-аудит, dbg |
| `bd7cc3a` | build: строгий TypeScript, единый verify, защита от авто-сброса БД | next.config, package.json, −seed.ts, prune-standalone |
| `1a9823e` | fix(ui): touch targets 44px, браузерный zoom, debug-глобалы только в dev | theme-switch, stock-view, admin-photobank, layout, store, photo-viewer |
| `8d38ae6` | chore(version): версия приложения из сборки | portal.tsx |
| *(этот коммит)* | docs: FIX_REPORT + CHANGELOG + worklog | docs, CHANGELOG, worklog |

Force-push не использовался; история не переписывалась.

---

## 12. Неисправленные проблемы

| Приоритет | Проблема | Причина | Рекомендуемый следующий шаг |
|---|---|---|---|
| P1 | **Внешний сайт требует редеплоя**: edge отдаёт статику из снапшота `0e30c86` (старый фронт, кэш старого `/api/catalog`), роут `/api/media` снаружи 404 до деплоя | Платформа деплоит только по команде владельца | После push нажать «деплой» на странице генерации; затем проверить внешний каталог и загрузку |
| P1 | Авторизация отсутствует (каталог/загрузка/админка публичны) | **Сознательно** — решение владельца (этап 9 ТЗ) | Отдельный этап после завершения сайта |
| P2 | `sait_copy_2.tar.gz` остаётся в старых коммитах GitHub (история) | Force-push запрещён | Если критично — Git History Rewrite отдельным решением |
| P2 | Гонка параллельных загрузок в один вариант (findFirst→create без unique-индекса) может создать дубликат варианта | Требуется миграция схемы (unique index) — не делалась без необходимости менять данные | Добавить частичный unique-индекс в спокойной сессии |
| P2 | В upload новые `tagIds` существующего варианта применяются ДО сохранения фото — если упадут все фото, теги останутся изменёнными | Порядок операций в транзакции upload (не связан с потерей фото) | Перенести привязку тегов после успешного сохранения всех фото (одна транзакция) |
| P3 | Рефакторинг `portal.tsx` (2.5k строк) / `globals.css` на модули не выполнялся | Этапы 19–20: приоритет — стабильность; риск regression при механическом разрезе | Отдельный этап с покомпонентным переносом и прогоном полных E2E после каждого шага |
| P3 | CSS dead code не удалялся | Простые grep-проходы не доказывают неиспользование (динамика/Framer/Radix); правило ТЗ «не удалять без доказательства» | Аудит покрытием (Chrome DevTools coverage) на всех разделах, затем точечное удаление |
| P3 | SW A→B тест «версия A → деплой → reload → получили B» вживую не выполнялся | Требует двух реальных деплоев | Выполнить при текущем редеплое (SW network-first по коду корректен: кэш только offline-fallback навигаций) |

---

## 13. Что сознательно НЕ менялось

- **Авторизация пользователей НЕ реализовывалась по требованию владельца**
  (этап 9 ТЗ: каталог/загрузка/админка публичны для группы 20–30 человек;
  Login/JWT/RBAC — отдельный будущий этап). Существующие подтверждения
  деструктивных действий в UI сохранены.
- Дизайн, Liquid Glass-пилюля, каталог, фильтры, поиск, просмотрщик
  (PhotoSwipe), остатки, бизнес-логика — не переписывались; правки UI
  только по подтверждённым пунктам (touch-target, zoom, debug-глобалы, версия).
- Реальные данные каталога (26 фото, 20 вариантов, справочники) не изменялись,
  кроме префикса URL в полях ссылок (Photo.url/thumbUrl, Material.swatchUrl) —
  содержимое файлов и связи не тронуты.
- История git не переписывалась; чужие изменения (5 локальных коммитов iOS-этапа)
  сохранены и запушены как есть.
- Service Worker оставлен без изменений (консервативный network-first,
  кэшируется только offline-копия «/», API/фото не перехватываются).

---

## 14. Проверка сохранности фотографий

`bun scripts/regression-photo-persistence.mjs` — изолированный сервер на копии
production-данных, 3 тестовых фото загружены через живой `/api/upload`:

| Этап | Строки Photo (id/url) | Файлы (sha256) | HTTP |
|---|---|---|---|
| До build (после загрузки) | 3 шт., зафиксированы | 6 новых файлов (3 optimized + 3 thumbs), зафиксированы | 3×200 |
| **После build №1 + restart** | идентичны | **побайтово те же**, фиксстура не тронута сборкой | 3×200, sha256 совпадают |
| **После build №2 + restart** | идентичны | **побайтово те же** | 3×200, sha256 совпадают |
| Production-зона (26 файлов + БД) | — | **не тронута всем прогоном** | — |
| `.next/standalone` | — | runtime-данных НЕ содержит (prune) | — |

**ИТОГ: 17/17 PASS** (`tool-results/regression-result.json`).

Дополнительно `test-restore-roundtrip.sh`: backup → создание товара+фото →
restore → счётчики БД `26|20|12` и md5 всех файлов = состояние бэкапа —
**10/10 PASS**.

Существующие реальные runtime-файлы проверялись только read-only (md5-снимки
до/после каждого прогона).

---

## 15. Финальный статус

| Раздел | Статус |
|---|---|
| Отделение runtime-данных от кода (F-001/002/003) | **PASS** |
| Сохранность фото при build/restart (регресс) | **PASS** (17/17) |
| Защита БД от авто-сброса/seed | **PASS** (seed удалён, db:push без data-loss, db:reset удалён) |
| Загрузка: откат частичной записи | **PASS** (реализовано; изолированные E2E зелёные) |
| Публичный backup удалён | **PASS** |
| Приватный backup/restore | **PASS** (roundtrip 13/13; v2: атомарный backup + fail-closed restore, см. §16) |
| Strict TypeScript build | **PASS** (tsc/lint/build = 0) |
| Единая команда verify | **PASS** (`bun run verify`) |
| E2E-изоляция | **PASS** (run-isolated; test-s4 34/34, test-s5 — все чеки) |
| Мобильный аудит (15 вьюпортов, 4 раздела, поиск) | **PASS** (0 проблем) |
| Overlap «Остатков» (этап 13) | **PASS — подтверждённых багов нет** (артефакты аудита) |
| Touch targets (этап 14) | **PASS WITH WARNING** — основные исправлены (44px); точечный «Компактный вид» 36px остался визуальным размером при расширенном hit-area |
| Accessibility zoom (этап 15) | **PASS** (живой iPhone-тест остаётся за владельцем) |
| Debug-глобалы | **PASS** |
| Версия из сборки | **PASS** («v1.7.0 · \<sha\>»; финальный SHA появится в UI после редеплоя) |
| Service worker (этап 18) | **PASS WITH WARNING** (код корректен; живой A→B тест — при редеплое) |
| Рефакторинг portal/globals.css (этапы 19–20) | **NOT TESTED / отложен** (см. §12) |
| Внешний сайт после всех изменений | **NOT TESTED — требуется редеплой владельцем** (edge = снапшот) |

**Критерий готовности этапа (ТЗ) — ВЫПОЛНЕН И ДОКАЗАН:**
пользователь загрузил фото → разработчик изменил код → build → restart →
build → restart → новый frontend работает, SQLite не тронута, все фото
на месте побайтово, optimized/thumbs на месте, каталог показывает те же
данные — подтверждено автоматическим regression-тестом (17/17) и описано
выше.

---

## 16. Stabilization v2 — правки по второму ревью (этот этап)

Второе ревью подтвердило архитектуру (runtime-зона, /api/media, rollback
upload, снятие db/uploads с Git-трекинга, 8 тематических коммитов), но нашло
7 проблем до редеплоя. Все исправлены и проверены.

### 16.1 Исправленные проблемы

| № | Проблема из ревью | Исправление | Проверка |
|---|---|---|---|
| 1 | `verify` содержал только typecheck+lint+build | `verify:static` / `verify:e2e` / `verify:runtime` / полный `verify` (static → e2e → runtime); в e2e: s4 + s5 + audit-full --quick + viewport-аудит, всё в изоляции; в runtime: regression сохранности + restore-roundtrip | Прогон всех трёх шагов: PASS (см. 16.3) |
| 2 (P1) | Мутирующие E2E имели фолбэк `E2E_BASE \|\| localhost:3000` и `E2E_RUNTIME \|\| production-runtime` — прямой запуск мутировал прод | `scripts/e2e-guard.mjs` (fail-closed): без `E2E_BASE` или с явным `:3000` → `REFUSE TO RUN`, exit 1; подключён к test-s4/s5/s6, audit-full; test-s5 дополнительно требует `E2E_RUNTIME` | Прямой запуск test-s4/test-s5 → exit 1; с `E2E_BASE=:3000` → exit 1; через run-isolated → PASS |
| 3 | restore только печатал счётчики («сравните сами»), не проверял md5 и не падал при расхождении | restore fail-closed: EXIT 1 при любом из — счётчик manifest ≠ факт (все 8 счётчиков), md5 БД ≠ `db_md5`, файл из manifest отсутствует, md5 файла ≠ manifest, файл есть вне manifest (вскрытый архив); без manifest.txt → EXIT 1; подмена runtime выполняется ТОЛЬКО после полного соответствия | Негатив: испорченный файл → EXIT 1; поддельный счётчик → EXIT 1; удалённый файл → EXIT 1. Позитив: --check → EXIT 0 |
| 4 | restore подменял runtime при работающем сервере (SQLite продолжал писать в старый inode) | Порядок: **stop server → verify → swap → start → health check**. Серверы целевой зоны ищутся по `/proc/<pid>/environ` (эффективный `RUNTIME_ROOT`; процесс без переменной = production-зона), порты — из `ss`; ожидание фактического выхода процессов; после swap перезапуск `restart.sh` с health check; не смогли остановить → отмена restore | Roundtrip: сервер :3200 останавливается до restore; production :3000 не матчится и не трогается |
| 5 | Backup не атомарен (checkpoint → счётчики → tar живого runtime: запись между шагами портит согласованность) | Схема staging-снапшота: `VACUUM INTO` staging-БД (консистентная копия в read-транзакции, переживает параллельные записи) → uploads в staging двумя проходами → manifest считается **ПО STAGING** → tar из staging → архив байт-в-байт = manifest; integrity_check снапшота до упаковки | backup + `--check` на копии: EXIT 0, полное соответствие manifest |
| 6 | `ensureRuntime()` фолбэком брал `db/custom.db` — при пропаже runtime приложение молча возвращало СТАРЫЙ набор фото | Legacy-фолбэк удалён: production без runtime-БД → **THROW** с инструкцией (restore-скрипт, список бэкапов); пустая схема — только при явном `RUNTIME_ROOT` (изолированная среда) или `RUNTIME_BOOTSTRAP_EMPTY=1` (заведомо чистая установка) | Тест без RUNTIME_ROOT/флага → exit 1 c ошибкой; с флагом на пустом окружении → БД из шаблона; production runtime существует → работа без изменений |
| 7 | `db:push` брал DATABASE_URL из окружения — платформа экспортирует легаси URL на старую БД | Wrapper `scripts/db-push.sh` (package.json `db:push`/`db:migrate`): путь БД берёт из `src/lib/runtime.ts`; БД не существует → EXIT 1 без изменений; `--accept-data-loss` запрещён с подсказкой безопасного процесса | С легаси `DATABASE_URL` в env цель = runtime-БД; `--accept-data-loss` → EXIT 1; реальный push → «already in sync» |
| 8 | `/api/media` отдавал immutable+1год, а middleware ставил no-store на ВЕСЬ /api — противоречие | Middleware: `/api/media/*` → `public, max-age=31536000, immutable`, остальные `/api/*` → `no-store` (значение дублируется в route-handler'ах) | Живой сервер: `/api/media/optimized/…` → immutable; `/api/catalog` → no-store |

Мелкие правки того же ревью:
- В отчёте арифметическая ошибка: вьюпортов **15** (7 мобильных + 2 планшета +
  4 десктопа + 2 ландшафта), не 16; 15 × 4 раздела = 60 комбинаций — исправлено
  в §7/§9/§15.
- P2-кейс тегов в upload (новые `tagIds` применяются до сохранения фото — при
  падении всех фото теги остаются изменёнными) — **не исправлен**, зафиксирован
  в §12 как отдельный следующий шаг (не связан с потерей фото).
- Гонка `findFirst → create` параллельных загрузок — остаётся в §12 (как и было).
- Удалён устаревший `manifest.txt` из корня production runtime (артефакт старого
  формата backup-скрипта; новые бэкапы пишут manifest только внутрь архива).

### 16.2 Изменённые файлы v2

| Файл | Изменение |
|---|---|
| `scripts/e2e-guard.mjs` | **НОВЫЙ** — fail-closed guard для мутирующих E2E |
| `scripts/test-s4.mjs`, `scripts/test-s5.mjs`, `scripts/test-s6.mjs`, `scripts/audit-full.mjs` | guard-импорт, убраны production-фолбэки |
| `scripts/backup-runtime.sh` | атомарный staging-снапшот (VACUUM INTO + 2 прохода + manifest по staging) |
| `scripts/restore-runtime.sh` | fail-closed сверка manifest/hash + stop→verify→swap→start |
| `scripts/test-restore-roundtrip.sh` | семантически корректные сравнения (uploads побайтово, БД через manifest+integrity), 13 чеков |
| `scripts/db-push.sh` | **НОВЫЙ** — wrapper db:push/db:migrate на runtime-БД |
| `src/lib/runtime.ts` | удалён legacy-фолбэк; fail-loudly; `RUNTIME_BOOTSTRAP_EMPTY` |
| `src/lib/db.ts` | комментарий/семантика bootstrap |
| `src/middleware.ts` | единая cache-policy (`/api/media/*` immutable) |
| `package.json` | `verify:static/e2e/runtime` + полный `verify`; `db:push`/`db:migrate` через wrapper |
| `docs/FIX_REPORT.md` | 15 вьюпортов, результаты v2, этот раздел |

### 16.3 Верификация v2 (полный `bun run verify`)

| Шаг | Состав | Результат |
|---|---|---|
| `verify:static` | typecheck + lint + build | **PASS** (0 ошибок) |
| `verify:e2e` | test-s4 (34/34) + test-s5 (все чеки) + audit-full --quick (0 находок) + viewport-аудит (60 комбинаций, 0 проблем) — всё в изоляции :3100 | **PASS** |
| `verify:runtime` | regression сохранности (17/17: 2 цикла build+restart, sha256 файлов) + restore-roundtrip (13/13) | **PASS** |
| Негативные тесты | guard: 3×REFUSE; restore: испорченный файл/подделка manifest/удалённый файл → 3×EXIT 1; `--accept-data-loss` → EXIT 1; fail-loudly bootstrap → EXIT 1 | **PASS** |
| Живой сервер | перезапуск :3000, `/api/media` immutable, `/api/catalog` no-store, catalog 200 | **PASS** |

### 16.4 Статус готовности к редеплою

- Локальная цепочка сохранности (build/restart/rebuild) — **PASS**.
- **Реальный platform redeploy — NOT TESTED** (edge = снапшот последнего
  коммита; деплой запускается владельцем). Ожидаемое снаружи после деплоя:
  новый фронт с версией «v1.7.0 · \<sha\>», роут `/api/media/*`, cache-заголовки
  из §16.1.8, сохранность существующих фото, работающая загрузка нового фото.
- Известные ограничения остаются из §12 (авторизация — сознательно не
  реализована; P2/P3 — отдельные следующие шаги).

---

## 17. v3 — расследование «после каждого деплоя фото пропадают» (17.09, вечер)

### 17.1 Симптом от владельца

> «Я загрузил фотографии, 20 штук. После правок мы задеплоили новый проект —
> и все фотографии исчезают. После каждой правки мы загружаем фотографии заново».

### 17.2 Установленная архитектура деплоя (уточнение к §1)

Вскрытие пайплайна (`.zscripts/build.sh` → `start.sh`, артефакт
`/tmp/build_fullstack_*.tar.gz` → контейнер FC `/app`):

| Этап | Что происходит |
|---|---|
| Сборка | в рабочей области: `bun run build` → standalone; затем артефакт: `next-service-dist/` (standalone + static + public) + `db/custom.db` + `start.sh` |
| Запуск на FC | `start.sh`: `cd /app/next-service-dist && DATABASE_URL=file:/app/db/custom.db bun server.js` |
| Пути приложения на FC | `projectRoot()` = `/app/next-service-dist`; `DATABASE_URL` принимается (не легаси-путь) → БД = `/app/db/custom.db`; `UPLOADS_ROOT` = `/app/next-service-dist/download/runtime/uploads` |

**Уточнение к §1 (проксирование динамики):** заголовки ответов живого сайта
(`X-Fc-Request-Id`, `X-Fc-Error-Type: FCCommonError`) и расхождение
«локальный :3000 → 200, живой сайт → 404» доказывают: динамика `/api/*`
обслуживается сервером ВНУТРИ контейнера FC, а не проксируется в песочницу,
как считалось в §1. Сервер `:3000` в песочнице (запущен платформой, cwd —
удалённый `.next/standalone`) — отдельный контур, он здоров: `/api/media` → 200.

### 17.3 Первопричина (F-013)

| ID | Приоритет | Проблема | Причина |
|---|---|---|---|
| F-013 | P0 | Фото исчезают при каждом деплое; загруженное через сайт живёт до следующего редеплоя | Прежний `database-runtime-build.sh` клал в артефакт ТОЛЬКО легаси `db/custom.db` (записи каталога). Файлы фото (`download/runtime/uploads`) в артефакт НЕ попадали: на FC БД есть → `/api/catalog` отдаёт позиции; файлов нет → каждый `/api/media/*` → 404. Загруженное владельцем через сайт писалось на диск контейнера и уничтожалось следующим редеплоем |

Проверка факта (17.09): живой `/api/catalog` — 13 позиций, 26 фото-записей;
живой `/api/media/optimized/sofa-nika-1.jpg` — 404; локальный `:3000` — 200.
Потерянные 20 фото владельца НЕ найдены нигде: runtime-зона, `public/uploads`,
git-история (84 файла — только сид-набор), 4 сборочных архива `/tmp`
(внутри — те же 38 сид-файлов), `download/backups` — везде только сид.

### 17.4 Решение v3: «деплой несёт данные с собой»

1. **`.zscripts/database-runtime-build.sh` (переписан)** — выпекает в артефакт:
   - БД: консистентный снапшот (`VACUUM INTO`) runtime-зоны → `/app/db/custom.db`
     (фолбэки: легаси → пустой шаблон, с предупреждениями); `integrity_check`
     обязателен; `prisma db push` по КОПИИ артефакта (расхождение схемы → сборка падает громко);
   - фото: `download/runtime/uploads` → `next-service-dist/download/runtime/uploads`
     (ровно тот путь, который `runtime.ts` вычисляет на контейнере).
2. **`GET /api/admin/export`** — выгрузка runtime-данных живого сайта:
   манифест (счётчики БД + sha256 каждого файла) и `?part=db` (снапшот БД
   через `VACUUM INTO`). Файлы фото качаются штатными `/api/media/*`.
3. **`scripts/sync-from-live.sh <BASE_URL> [--yes]`** — возврат данных живого
   сайта в рабочую runtime-зону ПЕРЕД редеплоем: бэкап → манифест → БД
   (integrity + сверка счётчиков) → все файлы (sha256) → атомарная замена.
   Fail-closed: без явного BASE_URL — отказ; любая ошибка сверки → EXIT 1 до
   touching локальных данных.
4. **Чистка тестового мусора** (`scripts/clean-test-junk.mjs`): удалены
   10×`ТестКат-*` и 10×`ТестМодель-*` (E2E-артефакты в словарях, видимые на
   живом сайте); перед чисткой — бэкап; защита от удаления при ссылках вариантов.

### 17.5 Протокол работы с данными (ОБЯЗАТЕЛЬНЫЙ порядок)

```
sync-from-live → локальные правки → bun run verify → редеплой (владелец)
```

- Синк ЗАМЕНЯЕТ локальную runtime-зону данными живого сайта — делать его ДО
  начала новых правок; несинхронизированные правки сохраняются в бэкапе `pre-sync`.
- После чистой установки/первого деплоя с этой версией владелец загружает фото
  один раз; дальше каждый редеплой предваряется синком — данные едут в артефакте.

### 17.6 Верификация v3

| Проверка | Результат |
|---|---|
| Выпечка в /tmp (`BUILD_DIR=/tmp/bake-test`) | БД: integrity ok, схема in sync; файлы 38+38 в нужном пути — **PASS** |
| `test-export-sync.sh` (5 тестов на :3100) | манифест (26 фото, 38+38, sha256) / `?part=db` (integrity ok) / полный sync в изолированную зону (76 файлов сверены) / содержимое приёмника / fail-closed без BASE_URL — **PASS** |
| Чистка мусора | до: 12 кат. / 18 мод.; после: 2 кат. / 8 мод.; варианты/фото/остатки не тронуты (20/26/32) — **PASS** |
| `bun run verify` (static + e2e + runtime) | см. §18 |

### 17.7 Статус

- Локальная цепочка: **PASS**. Реальный редеплой с v3 — ожидает владельца.
- Ожидание после редеплоя: каталог с РАБОТАЮЩИМИ фото (файлы выпечены),
  словари без `ТестКат-*`, `/api/admin/export` доступен для синка.
