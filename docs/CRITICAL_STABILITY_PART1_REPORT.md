# CRITICAL STABILITY PART 1 — REPORT

**Проект:** Askona Photo Portal (https://github.com/erosya363-del/foto_sait_GLM5.3)
**Дата:** 19 сентября 2026 (UTC+4)
**START_HEAD:** `3db18a1e8e560e381961d6ed7f58286c76ea1859`
**FINAL_HEAD:** см. `git log` конца секции 12 (последний коммит — docs: этот отчёт)
**Статус:** PART 1 завершена; по ТЗ §15 — ОСТАНОВ, PART 2 не начата.

---

## 1. DATA LOSS (ТЗ §2)

### 1.1 Факты на момент начала (forensics §2.1)

| Проверка | Результат |
|---|---|
| Live DB (через /api/catalog + export) | **26** Photo-строк, все — сид-URL (`sofa-nika-*.jpg`, `bed-*`, `texture-*`) |
| Live media | 38 optimized + 38 thumbs, **все доступны (GET 200)**; HEAD заблокирован шлюзом (403) — не показатель |
| Live манифест | `photos=26, optimized=38, thumbs=38` (совпадает с локальной зоной) |
| Локальная runtime-зона | 26 фото / 38 файлов (синк от 17.09 23:12) |
| Build-артефакты в /tmp (4 шт: 17.09 23:24, 18.09 00:10, 18.09 02:05, 18.09 16:21) | В БД каждого **26 фото, все сид**; файлов 38; пользовательских — 0 |
| `download/backups/` | **ПУСТ** (платформенный откат стёр содержимое; каталог пересоздан 18.09) |
| Git-история (public/uploads, db/custom.db) | Только сид-файлы (76 шт) + 4 пользовательских webp эпохи **11–12.09** (другая, более ранняя эпоха; в текущую БД не привязаны) |
| Легаси `db/custom.db` на диске | 0 фото |
| `/tmp/my-project` (снапшот workspace 16.09) | 26 сид-фото + те же 4 webp |
| Regression-фикстура `tool-results/regression-runtime` | 26 сид + 3 файла `mu6atvh9-*` — собственные загрузки регрессионного теста, НЕ пользовательские |
| Платформенный snapshot / старый контейнер / volume | **Из workspace недоступны** (проверка невозможна) |

### 1.2 Восстановление (§2.2)

**LOST PHOTOS FOUND: 0 / approximately 20.**

В доступных источниках файлы не обнаружены. Заявление «невосстановимы вообще» не делается: не проверена инфраструктура платформы (snapshot/старый контейнер/persistent volume — если они существуют, восстановление возможно только через поддержку платформы до следующего деплоя, который заменит контейнер окончательно).

**ВНИМАНИЕ ВЛАДЕЛЬЦУ:** если платформа позволяет достать снапшот предыдущего контейнера — это последний шанс достать ~20 фото. После следующего redeploy окно закроется.

### 1.3 Точная причина повторной потери (§2.3)

Проверены все 15 сценариев ТЗ. Подтверждённая цепочка (**сценарии №1 + №2**):

1. 17.09 23:12 — sync-from-live: локальная зона = 26 сид-фото (состояние live на тот момент).
2. 18.09, между синком и вечером — владелец загрузил на **живой сайт** ~20 фото. Они существовали **только на диске живого контейнера**.
3. 18.09 16:21 — сборка артефакта из **несинхронизированной** локальной зоны (26 сид). Никакая часть пайплайна не проверяла свежесть зоны — сборка прошла успешно.
4. Redeploy этим артефактом заменил контейнер → диск старого уничтожен → **~20 фото и их DB-строки потеряны**.

Что это НЕ было: не пути (runtime.ts корректен), не bake-логика (фото выпекались), не env DATABASE_URL, не WAL. Это **отсутствие fail-closed проверки «зона ↔ live»** перед сборкой.

### 1.4 Deploy guards (§2.4–2.11)

| Guard | Файл | Что делает |
|---|---|---|
| Fresh sync marker (2.5) | `scripts/sync-from-live.sh` | После успешного синка пишет `download/runtime/.live-sync.json`: `{source, generatedAt, syncedAt, dbSha256, manifestSha256, photoCount, optimizedCount, thumbCount}` |
| Deploy guard (2.4) | `scripts/check-deploy-freshness.mjs` | маркер существует; свежесть ≤ 72 ч (`FRESH_SYNC_MAX_HOURS`); `photoCount` маркера = живые Photo в БД; media counts = файлы на диске; dbSha256 сверяется (расхождение → WARNING); все photo-ссылки целы. Любое нарушение → **exit 1** |
| Pre-flight (2.4) | `.zscripts/build.sh` | guard до `bun run build` — fail fast, сборка не тратится |
| No legacy fallback (2.6) | `.zscripts/database-runtime-build.sh` | фолбэки `db/custom.db` / `schema-template-empty.db` **УДАЛЕНЫ**: runtime-БД отсутствует → exit 1 с инструкциями; пустая схема — только с явным `RUNTIME_BOOTSTRAP_EMPTY=1` (тот же флаг, что в `runtime.ts`) |
| Verify каждой Photo (2.7) | `scripts/verify-runtime-artifact.mjs` | каждая живая Photo: `url`+`thumbUrl` → файл существует / regular / size>0 / путь внутри root; счётчик media vs БД; битая ссылка → exit 1 |
| Post-build verify (2.8) | `.zscripts/database-runtime-build.sh` | проверяется **УЖЕ АРТЕФАКТ** (артефактная БД `db/custom.db` ↔ артефактные optimized/thumbs), не исходная зона |
| Export security (2.10) | `src/app/api/admin/export/route.ts` | токен: env `SYNC_EXPORT_TOKEN` → иначе файл `RUNTIME_ROOT/.sync-token` (zero-config: платформа без .env; токен генерируется один раз в workspace и **печётся в артефакт тем же пайплайном** → всегда совпадает с сервером; chmod 600, в git не попадает). Без валидного `X-Sync-Token`/`Bearer` → **401** |

### 1.5 Data safety acceptance (§2.11)

Перед каждым redeploy владелец увидит в логе сборки:

```
SYNC: PASS (маркер .live-sync.json свежий)
DB INTEGRITY: PASS (integrity_check в database-runtime-build.sh)
PHOTO REFERENCES: PASS (verify-runtime-artifact по зоне)
ARTIFACT VERIFY: PASS (verify-runtime-artifact по артефакту, 2.8)
DEPLOY GUARD: PASS (pre-flight в build.sh)
```

Иначе — **DEPLOY BLOCKED** (exit 1 на одном из этапов).

### 1.6 Storage architecture (§2.9)

- **Было:** live-контейнер — единственное место пользовательских данных; перенос данных между контейнерами — ручной sync-from-live без контроля.
- **Стало:** данные живут в артефакте (как и раньше), но деплой **невозможен** без свежего синка; каждая сборка верифицирует фото-ссылки в артефакте.
- **Persistent storage:** платформа (space-z.ai) разворачивает ephemeral-контейнер из артефакта; подключение persistent disk из workspace не доступно и вслепую не менялось (запрещено ТЗ). Рекомендация: если у платформы есть persistent volume — монтировать его в `download/runtime` контейнера и убрать bake-модель; это отдельная инфраструктурная задача.

---

## 2. ANDROID LENS (ТЗ §3)

- **Почему Xiaomi не рисовал линзу:** линза живёт в `.pill-goo` с `filter: url(#pill-goo)` (SVG-фильтр) + `mix-blend-mode: screen` внутри + `backdrop-filter: blur(40px)` на панели. SVG `url()`-фильтры на Android-композиции исторически нестабильны: при сбое слоя рисуется **пустой слой** — линзы нет целиком. Headless Chromium на десктопе это не воспроизводит (потому и «у меня работает»).
- **Capability select (3.2):** beforeInteractive-скрипт: `glass-full` = `CSS.supports(backdrop-filter)` **И НЕ** Android. Android-эвристика — осознанное решение (возможность CSS.supports проверить реальную работоспособность SVG-фильтра отсутствует; «user-agent-only fix» запрещён ТЗ — здесь UA используется только как **дополнительный** сигнал поверх capability-проверки backdrop-filter; обоснование в коде и здесь). Debug-переопределение: `?glass=full` / `?glass=fallback` (используется тестом 10.2).
- **Full mode (iOS/desktop):** прежнее стекло v5 (blur/sat/goo/rim/caustics) — не тронуто.
- **Fallback mode:** goo `filter:none`; `backdrop-filter:none`; caustics/rim/sheen/specular `display:none`; панель = плотная капсула rgba(32,34,38,.88) (light .94); линза = **turquoise glass** `rgba(20,184,166,.16)` + граница `rgba(20,184,166,.28)` (light teal .12) — по ТЗ 3.4, без ярких shadow/glow.
- **Сохранено в fallback (по ТЗ 3.3):** позиция, ширина, press-увеличение, covered-пересечение, content scale, settle/release, все transform-переходы — доказано тестом A7–A10 (`test-stability-part1.mjs`).
- **Визуальные отличия:** см. `tool-results/stability/01–03` (fallback: линза читается бирюзовым стеклом; полноэкранное стекло и «жидкие» слияния отсутствуют).

---

## 3. LENS PHYSICS (ТЗ §4)

| Параметр | Значение |
|---|---|
| REST width | ширина вкладки (высота 54px: scaleY 0.90 от 60px) |
| PRESS width | **таб × 1.18** (ТЗ 4.2: +15–20%); высота 72px (выпирание над/под панелью) |
| DRAG width | **константа press-размера**; тест-допуск ±12% от 1.18×; жёсткий потолок «анти-колбаса» ≤ 1.32× (ТЗ 4.1/4.3); velocity stretch ≤ 0.04 (несколько процентов) |
| Tracking τ | **22 мс** (rate 45/с; ширина 36 мс) — из сетки ТЗ 4.8 (16/22/28/33); direct manipulation без headless-дрожания; финальный выбор — за владельцем на реальном устройстве |
| Covered | **реальное пересечение** `[lensLeft, lensRight]` ↔ вкладка, порог 6px (или 25% ширины вкладки, если меньше); накрыты ОБЕ — обе covered (ТЗ 4.4) |
| Covered visual | content scale .92 + цвет `var(--brand-strong)` в ОБЕИХ темах (4.5) |
| Старая вкладка (4.6) | `.pill-shell.is-dragging .pill-item.is-on:not(.is-lens-covered)` → muted: как только линза ушла, committed is-on гаснет; логический view не меняется до release |
| Release (4.7) | nearestItem → commit (или sheet для «Загрузки»); press → пружинный settle → rest, без прыжка |
| Верхний засвет (4.9) | `::after` спекуляр: rest 0.30→**0.06**, press +0.30→**+0.14**; radial линзы .20→.06 — «лампа сверху» устранена |
| REST glass (4.10) | прозрачность + кромка + контент; не fill/glow/blob |

Двухфазный bridge-стретч (PHASE 2.3 supplement B) **удалён** как противоречащий новой модели «капсулы» — по явному указанию ТЗ §4 («Это важнее предыдущих математических экспериментов»).

---

## 4. BOTTOM STRIP (ТЗ §5) — КРИТИЧНО: без доказанного root cause на реальном устройстве

- **Что найдено в коде (фактическая причина-кандидат №1, устранена):** `html { background: var(--edge) }` при `body { background: … , var(--background) }` — **разные цвета**. В любой момент, когда body временно ниже layout viewport (холодный старт PWA, закрытие клавиатуры, лаг `100dvh`), между низом body и низом вьюпорта просвечивал фон **другого цвета** = та самая полоса «цвета темы». Фикс: html bg = `var(--background)` — gap стал невидимым; плоский низ по-прежнему рисует `.fx-skirt`.
- **Stale KB state (5.3):** `measure()` теперь вызывается на `pageshow` (возврат на вкладку) и `visibilitychange=visible` — сбрасывает `kb-open`/`--kb-overlay`/`--kb-h` по факту; до этого iOS мог «проесть» resize при возврате, оставляя `--kb-overlay > 0` со смещённой панелью/полосой после поиска. Проверено тестом 10.4 (форс kb-состояния → focusout/resize → снято).
- **Safe area (5.5):** двойного учёта нет: `.pill-nav` = `max(10px, --sab)` один раз; search-pop один раз; sheet: `--sat` в height-clamp + `--sab` в padding контента — роли не пересекаются.
- **Debug overlay (5.1/5.2):** `?viewportDebug=1` — метрики (innerHeight/clientHeight/vv.height/vv.offsetTop/pageTop/scale/body/scrollHeight/--sab/--kb-overlay/--kb-h/pill.top/bottom/gap под панелью/search-pop/sheet/kb-open/glass/mode) + журнал последних 10 событий с отметками расхождений. Не показывается без параметра. **Инструкция владельцу:** открыть `https://…/?viewportDebug=1` на iPhone в момент полосы и снять скрин — значения подсветят виновника (если полоса ещё воспроизводится).
- **Честное ограничение:** реального iPhone в headless нет; полоса на холодном старте PWA может иметь второй слой причин (композиция backdrop-слоя — workaround-нуджи PHASE 2.3 оставлены). Требуется подтверждение владельцем → **REAL DEVICE REQUIRED**.

---

## 5. BROWSER PANEL JUMP (ТЗ §6)

- **Какой resize происходил:** скрытие/показ тулбаров Safari/Chrome меняет высоту layout viewport → `window.resize` + `ResizeObserver` на `.pill-shell` → `syncPosition(false)` → `drivePillRef(...)` + `settle()` — то есть **полный пересброс пружины линзы** на каждый тик анимации тулбара, визуально «панель прыгает».
- **Что теперь игнорируется:** ресайз, который не изменил ширину shell (±0.5px). Вертикальные колебания тулбара геометрию линзы не трогают вообще (линзе интересна только ширина/позиции вкладок).
- **Что обновляется:** только реальная смена ширины (поворот, breakpoint, смена шрифтов) — тогда один честный пересинк.
- **Режимы (6.1–6.3):** `html.is-standalone` / `html.is-browser` проставляются до отрисовки; standalone-стратегия (safe-area anchor) сохранена; browser-стратегия = игнор высотных тиков (вместо rAF-сглаживания позиции — проще и дешевле).
- **Zoom (6.5):** дубликат rules не создан: глобальные `touch-action: manipulation` и `input{font-size:max(16px,1em)}` уже существовали (v2.7); `.field` приведён к `max(16px,1em)` на мобильных (было 14px — источник iOS input-zoom). PhotoViewer zoom не тронут. user-scalable остался доступным ( accessibility).

---

## 6. UPLOAD SHEET (ТЗ §7)

| Параметр | Было | Стало |
|---|---|---|
| Mobile высота | `maxHeight`-only → сжималась по контенту до **~40%** экрана | `height: min(86dvh, 100dvh − sat − kbOverlay − 10px)` → **86%** на всех 4 вьюпортах (тест 10.5: 86.0% на 667/844/852/932) |
| Клавиатура | `bottom: --kb-overlay` с высотой по контенту → «маленькая карточка» | якорь `--kb-overlay` + height-clamp: при kb 40% sheet ≈ 55dvh — не карточка; фокус → `scrollIntoView({block:center})` внутри body (+320 мс под подъём iOS); CTA шагов 1/2 → **sticky footer** (как шаг 3) |
| Scroll lock | отсутствовал (фон скроллился под sheet) | **позиционная фиксация**: body `position:fixed; top:-scrollY` + `html.sheet-scroll-locked`; после закрытия scroll возвращается **точно** (тест: 500→500) |
| Stepper | мелкий | active: w-5/brand/bold; completed мягкий; future secondary (7.5) |
| Поля | 44px, font 14px (iOS input-zoom), disabled Model как «сломанное» | 48–52px (padding 12), font ≥16px mobile / 14px desktop; disabled: «Сначала выберите категорию»; helper: «Доступны значения из справочника. Новые пункты добавляет администратор.» |
| View type cleanup (§8) | `View` содержал `"upload"`, стаб в VIEW_COMPONENTS | `View = catalog|stock|admin`; `LegacyView = View|"upload"`; `NavItem = {type:"view"} | {type:"action"}` — `setView("upload")` невалиден по типам; миграции `upload→catalog` в restore/loadPersisted/popstate; native-bridge: таб upload → sheet |

---

## 7. TEST MATRIX (ТЗ §13.8)

| Тест | Результат |
|---|---|
| DATA PERSISTENCE (deploy-cycle: upload→verify→artifact→redeploy→survive) | **PASS** (22/0) |
| SECOND DEPLOY CYCLE (upload после deploy №1 → deploy №2 → оба живы) | **PASS** (в составе deploy-cycle) |
| NEGATIVE: deploy-guard блокирует несинхронизированную зону | **PASS** (C-/C-- в deploy-cycle) |
| ANDROID FALLBACK (класс/линза видима/физика/override/no-backdrop capability) | **PASS** (14 ассертов) |
| LENS PRESS (×1.18, высота 72px) | **PASS** |
| LENS DRAG CONSTANT SIZE (±12%, анти-колбаса ≤1.32) | **PASS** |
| COVERED STATE (реальное пересечение, обе вкладки) | **PASS** |
| OLD TAB DIM (4.6) | **PASS** |
| RELEASE / NO STUCK CLASSES | **PASS** (nav-search 109, h-nav 125, themes 33, viewer 49 — все 0 fail) |
| BOTTOM STRIP (5 вьюпортов: cold/tab-switch/KB-цикл, нет зазора) | **PASS** (headless) — **+ REAL DEVICE REQUIRED** для подтверждения на iPhone |
| BROWSER CHROME (вертикальный resize не сбрасывает линзу) | **PASS** (по коду-контракту ±0.5px; headless тулбары не эмулирует) — REAL DEVICE RECOMMENDED |
| UPLOAD HEIGHT (4 вьюпорта ≥80%) | **PASS** (86.0%) |
| UPLOAD SCROLL LOCK (фон не скроллится, восстановление точное) | **PASS** |
| KEYBOARD (фокус виден внутри sheet) | **PASS** (scrollIntoView; оверлей-подъём проверен ассертом 16c) — **REAL IOS REQUIRED** для живой клавиатуры |
| TYPECHECK | **PASS** |
| LINT | **PASS** |
| BUILD | **PASS** |
| verify:e2e (s4/s5/audit/stabilize) | **PASS** (34/0, 40/0, 0 находок) |
| verify:runtime (regression 17/0 + roundtrip 13/0) | **PASS** |

---

## 8. REAL DEVICES (ТЗ §13.9) — честно

- **REAL IPHONE: NOT TESTED.** Что проверить владельцу (после redeploy):
  1. холодный старт PWA — полоса снизу (с `?viewportDebug=1` — скрин в момент полосы);
  2. после поиска/клавиатуры — панель на месте, полосы нет;
  3. browser Safari — прыжки панели при скрытии/показе тулбара;
  4. линза: press ×1.18 / drag капсулой (не растягивается) / старая вкладка гаснет / обе covered в мосте;
  5. верхний засвет линзы отсутствует;
  6. хаптика press/step/commit;
  7. upload sheet: 86% высоты, клавиатура не ломает, фон не скроллится, поле видно при фокусе.
- **REAL XIAOMI: NOT TESTED.** Что проверить: линза ВИДНА (turquoise стекло) в rest/press/drag; плавность; мост-подсветка обеих вкладок. Если линзы снова нет — `?glass=full` для сравнения и скрин `?viewportDebug=1`.
- Headless Chrome НЕ засчитывается как Xiaomi/iPhone PASS.

---

## 9. OPEN ISSUES (ТЗ §13.10)

1. **~20 фото не восстановлены** — единственный оставшийся источник: платформенный snapshot/поддержка (срочно, до следующего deploy).
2. Полоса снизу: root cause-кандидат (html/body bg mismatch) устранён + stale-KB закрыт, но подтверждение на реальном iPhone отсутствует (device required).
3. Android-эвристика fallback (весь Android → fallback) — консервативно; если владелец захочет full-glass на конкретном Android: `?glass=full` (проверить на месте).
4. iOS-хаптика — workaround (stealth switch) без подтверждения на устройстве (унаследовано из PHASE 2.4).
5. Sync-token при потере `download/runtime/.sync-token` (платформенный откат): файл генерируется заново, но тогда нужен деплой нового артефакта ДО следующего sync (иначе 401) — сценарий описан, автоматизации нет.
6. `?viewportDebug=1` доступен и в production (по параметру) — осознанно: это инструмент диагностики владельца; отключается удалением компонента.

---

## 10. COMMITS (ТЗ §12)

```
a2c129a fix(data): make runtime uploads redeploy-safe (CRITICAL STABILITY 2.x)
f55d3cf fix(data): export route token — async readFileSync fix
7bbe015 fix(glass): add android lens fallback + remove top highlight (3.x/4.9/4.10/5.4)
eb251f8 fix(nav): stabilize lens drag and covered-state (4.x/6.4)
20cd0d6 fix(viewport): strip diagnostics + stale KB state guards (5.x)
98f86c8 fix(upload): expand mobile sheet and lock background (7.x)
936b2b6 refactor(view): View = catalog|stock|admin; NavItem discriminated union (8)
b65e9e6 test: cover data persistence, android glass and viewport regressions (10)
<docs>  docs: add critical stability part1 report + worklog Task 46
```

*(FINAL_HEAD = хеш docs-коммита; без reset --hard/clean — вся история линейная поверх 3db18a1.)*

---

## 11. ЧЕК-ЛИСТ ПЕРЕДЕПОЛОЯ (владельцу)

```bash
# 1. (один раз) забрать платформенный snapshot старого контейнера, если фото ещё нужны
# 2. sync данных живого сайта:
bash scripts/sync-from-live.sh https://j1jr777qg2d0-d.space-z.ai --yes
# 3. сборка — guards проверят всё сами:
#    (деплой платформой запускает .zscripts/build.sh)
# 4. после деплоя: чек-лист REAL DEVICES (§8)
```
