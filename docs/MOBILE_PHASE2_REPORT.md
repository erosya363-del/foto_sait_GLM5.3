# MOBILE PHASE2 — отчёт о реализации (Photo Viewer · Liquid Panel · Horizontal Nav)

## PROJECT

| Поле | Значение |
|---|---|
| repo | https://github.com/erosya363-del/foto_sait_GLM5.3 |
| branch | main |
| START_HEAD | `bcc07cc04a4e3d09ecf0714c381e5260ffbc2b5c` (локальный HEAD = `e58def8` + worklog-коммит платформы) |
| FINAL_HEAD | `62e9e12a2d4bb3bf223707b90d6bd48fec48a43d` |
| date | 2026-09-18 |
| verify clone | `verify/foto_sait_verify` @ `62e9e12` (пересоздан после push; install/typecheck/lint/build — PASS) |

Каждое утверждение ниже проверяется по diff между `e58def8` и `62e9e12` (коммиты перечислены в §7.6).

---

## BLOCK 1 — PHOTO VIEWER (P0)

### B1-F1 · «Изображение иногда оказывается в странном положении» / зум молча не работает
- **Симптом:** при быстром переходе на соседний кадр фотография отображалась без пропорций, pinch не работал, слайд «прыгал».
- **Точная причина:** `photo-viewer.tsx` задавал `width/height` ТОЛЬКО первому слайду до `pswp.init()`; остальные слайды оставались с `width: 0` до завершения фонового зонда. В PhotoSwipe 5.4.4 `Content.onLoaded()` НЕ выводит размеры из `naturalWidth`, а `Slide.isZoomable()` = `Boolean(this.width) && …` — слайд с `width:0` навсегда незумибелен (`ZoomLevel.fit` считается от нуля) с нулевым layout. Проверено по `node_modules/photoswipe/dist/photoswipe.esm.js` (строки ~4856, ~1139).
- **Файл/функция:** `src/components/photo-viewer.tsx`, lifecycle-эффект открытия (`(async () => { … })()`).
- **Что было:** зонд первого слайда → `init()`; остальные — `probeDims().then()` в фоне.
- **Что стало:** `const dims = await Promise.all(photos.map(p => probeDims(p.thumbUrl || p.url)))` — пропорции ВСЕХ слайдов до `init()`; окно гонки закрыто (thumbs 640px уже в кэше сетки, параллельный зонд — миллисекунды).
- **Почему работает:** к моменту создания Slide все `data.width/height` валидны → `isZoomable()` = true, `ZoomLevel.fit` корректен, layout детерминирован.
- **Тест:** `scripts/test-photo-viewer-mobile.mjs` — «reopen: зум начинается с 1x», «pinch-out: зум вырос» (3 вьюпорта).

### B1-F2 · «Ощущение зависания после действий» (share/save)
- **Симптом:** после «Скачать фото»/«Поделиться» не происходило ничего несколько секунд.
- **Точная причина:** `sharePhoto`/`downloadPhoto` синхронно `await fetch(p.url)` (полное фото, мобильная сеть) без какого-либо фидбека.
- **Что стало:** `toast.loading("Готовим фото…"/"Скачиваем…")` с `toast.dismiss`/`toast.success` по завершении (sonner). Viewer не закрывается, зум не сбрасывается.
- **Тест:** шаг 10/11 viewer-теста — viewer остаётся открытым, sheet в корректном состоянии.

### B1-F3 · Странный layout слайда при недогруженном превью — «гонка placeholder»
- Устраняется B1-F1 (единый механизм). Дополнительно строка sheet'а информирует о реальных размерах (`nat` из `loadComplete`).

### B1-F4 · Body scroll НЕ блокировался при открытом viewer'е
- **Точная причина:** комментарий в коде утверждал «скролл-лок pswp делает сам» — проверка исходников PhotoSwipe 5.4.4 показала: лока НЕТ (только `touch-action:none` на своей поверхности). Программный скролл/скролл-чейнинг двигали страницу под просмотрщиком — вклад в «дёргания».
- **Что стало:** явный lock: `document.documentElement.style.overflow = "hidden"` на всё время `open`; при закрытии — восстановление позиции `window.scrollTo({ top: y, behavior: "instant" })` (мгновенно, т.к. `html { scroll-behavior: smooth }` иначе анимировал бы возврат).
- **Тест:** «body scroll lock: html overflow=hidden», «wheel при открытом viewer не скроллит страницу» (доверенный `mouse.wheel`), «scroll restored после close».

### B1-F5 · Action sheet приведён к ТЗ 1.6
- Удалён пункт «Скопировать изображение» (флейковый на iOS Safari ClipboardItem; ссылка/Share покрывают сценарий; ТЗ требует «не перегружать»). Итоговый состав: Поделиться… (если `navigator.share` доступен) · Скачать фото · Скопировать ссылку · Открыть оригинал · инфо-строка · Отмена.
- Высота строк поднята до **48px** (`.viewer-sheet-row` в `globals.css`, было `--tap-min`=44).
- Кнопка × — нативная pswp (50×60 → в приложении `min-width/height: var(--tap-min)`), работает **немедленно при любом зуме** (нативный `close()`, без reset-zoom) — проверено тестом «close из зума».
- Русские `aria`-подписи системных кнопок: `closeTitle/zoomTitle/arrowPrevTitle/arrowNextTitle`.

### Отдельные механики Block 1 (что и кем обрабатывается)
| Механика | Реализация | Источник истины |
|---|---|---|
| pinch | PhotoSwipe native (1x–5x, secondary 2.5x) | pswp Gestures/ZoomHandler |
| pan | PhotoSwipe native с границами | pswp DragHandler |
| horizontal swipe | PhotoSwipe native (`allowPanToNext`) — только при 1x | pswp MainScroll |
| vertical close | PhotoSwipe native `closeOnVerticalDrag` — отключается при `currZoomLevel > fit` и при multitouch (проверено по исходнику, строка ~1285) | pswp |
| close button | нативная pswp-кнопка × ≥44px, мгновенное закрытие из любого зума | pswp UI |
| cleanup | `destroy()` в cleanup-функции эффекта: listeners/observers/rAF снимает pswp; React-эффект восстанавливает html.overflow и scroll; `sheet` сбрасывается | эффект открытия |
| body scroll lock | явный (B1-F4) | portal-free |
| reopen after zoom | новый инстанс pswp на каждое открытие → зум с 1x | тест |
| iOS long-press меню | `-webkit-touch-callout:none` на `.pswp img` (вне viewer'а accessibility не тронута) | globals.css |
| page zoom vs photo zoom | `body { touch-action: pan-x pan-y }` запрещает пинч страницы; `.pswp { touch-action: none }` — пинч фото живёт | globals.css + photoswipe.css |
| performance | во время жеста React НЕ рендерится: `setState` только на `change` (смена кадра) и `loadComplete` (один раз на загрузку) — не на каждый кадр | architecture |

**REAL IPHONE: NOT TESTED** (см. §7.8).

---

## BLOCK 2 — LIQUID PANEL + SEARCH (P0/P1)

### Причина scroll-тормозов: измерение (ТЗ 2.7 «Не предполагать. Измерить.»)
Скрипт `scripts/audit-scroll-perf.mjs`: длинный список «Остатки», scripted wheel-скролл, rAF-сэмплер кадров + `PerformanceObserver(longtask)`, **CPU-throttling ×6** (headless-десктоп без троттлинга не воспроизводит мобильный jank — проверено: все варианты давали 0 провалов). 3 прогона на вариант, медиана. Полные данные: `tool-results/mobile-phase2/scroll-perf.json`.

| Вариант | gaps32 | gaps50 | maxGap | longTasks | longTotal |
|---|---|---|---|---|---|
| **base (после фиксов)** | **15** | **1** | **50 мс** | **2** | **138 мс** |
| `old-aurora` (вернуть `filter: blur(110px)`) | 23 | **23** | **267 мс** | **16** | **1071 мс** |
| `old-grain` (вернуть `inset:-50%`) | 14 | 1 | 67 мс | 0 | 0 |
| `no-pause` (выключить is-scrolling паузу) | 12 | 1 | 50 мс | 14 | 770 мс |
| `no-aurora` (авроры выключить целиком) | 8 | 0 | 50 мс | 0 | 0 |
| `no-grain` / `no-pill-bf` / `no-goo` / `no-vignette` | 11–14 | 0 | 33–50 мс | 0 | 0 |

**Выводы (по цифрам, не по догадкам):**
1. Самый дорогой слой — **авроры с `filter: blur(110px)`** (до фикса: 23 dropped frames @50 мс, maxGap 267 мс, 1071 мс long-tasks за один скролл-сессию).
2. Второй по цене — отсутствие паузы фоновых анимаций при скролле (770 мс long-tasks).
3. `backdrop-filter` панели, goo-фильтр линзы, виньетка — в пределах погрешности (НЕ тронуты).

### Что оптимизировано
| Файл | Было | Стало |
|---|---|---|
| `globals.css` `.aurora` | `filter: blur(110px)` на трёх слоях 560–720px | фильтр УДАЛЁН — радиальные градиенты уже сходят к прозрачности к 62% радиуса; вид тот же, ноль фильтр-растеризаций |
| `globals.css` `.fx-grain` | `inset: -50%` — композитный слой 4× вьюпорта | `inset: -8%` — ровно оверскан для анимации ±3% (≈1,16× слоя) |
| `portal.tsx` + CSS | анимации зерно/авроры работают всегда | `html.is-scrolling { .fx-grain, .aurora { animation-play-state: paused } }` — класс ставится на scroll (rAF-throttle), снимается через 240 мс после остановки |

### Прозрачность стекла (ТЗ 2.2)
- `--pill-bg` dark: `rgba(50,48,44, .30)` → **`.20`**; light: `rgba(255,255,255,.34)` → **`.26`**. Контент под панелью читается через стекло; читаемость текста сохранена (линза/рим/спекуляр не менялись). Проверено тестом `alpha ≤ 0.25`.

### Pointer drag по панели (ТЗ 2.4/2.5/2.6)
- **Файл:** `portal.tsx`, `[]`-эффект «gesture на панели»; события: `pointerdown` на `.pill-shell` (touch-action:none — полный поток), `pointermove/pointerup/pointercancel` на window (passive).
- **VISUAL PREVIEW отделён от COMMITTED VIEW:** во время движения линза едет за пальцем на существующей пружине (`drivePillRef` — только target, ноль setState), раздел НЕ меняется; `playStep()` при перескоке превью на соседнюю вкладку.
- **COMMIT** — только на `pointerup`: ближайший tab по центрам `itemRefs`; если ≠ текущего → `setView(tab)`; иначе линза плавно settle обратно. `pointercancel` → settle к активной.
- **Тап сохранён:** порог 8px — короткое касание не перехватывается, работает штатный click кнопок (в т.ч. `.pill-search` toggle).
- **Click-подавление при drag:** capture-фаза click на shell с `preventDefault + stopImmediatePropagation` (React-делегат корня срабатывает позже, на bubble); снимается в `setTimeout(0)` после отпускания.
- **Тест:** секция 9 `test-mobile-nav-search.mjs`: preview без commit, commit на release, settle «не дотянув», pointercancel, тап после жестов.

### Search transition state machine (ТЗ 2.8–2.10)
- **Эквивалентная реализация:** committed-состояние = `searchOpen` (React state); переходные состояния NAV_TO_SEARCH / SEARCH_TO_NAV = CSS-транзишны, привязанные к классу `.pill-morph-out`. Симметричные тайминги 220–260 мс (окно ТЗ 240–300 мс), прерываемость — реверс класса в любой момент (проверено секцией 10 «interrupt»).
- **Панель:** display:none в первый кадр УБРАН для поиска (остался ТОЛЬКО для клавиатуры — `html.kb-open .pill-nav`, мгновенно, как и было по ТЗ v4). Теперь: `opacity→0, translateY(18px) scale(.9), visibility hidden (delayed 240 мс), pointer-events none`.
- **Search surface:** старт `translateY(16px) scale(.96)` → 0/1 за 260 мс — «приезжает снизу и расширяется», противоположно уходящей панели.

### Keyboard (ТЗ 2.11)
- Логика `--kb-overlay` (подъём карточки на фактическое перекрытие) сохранена без изменений; панель при клавиатуре скрывается мгновенно (display:none); morph NAV→SEARCH завершается до открытия клавиатуры, т.к. на мобильном клавиатуру открывает тап пользователя по полю, а не кнопка поиска. Тесты секций 6–7 (390×844, kb-overlay 300px → низ карточки ≈308px).

### Единый путь закрытия (ТЗ 2.12)
- `SearchBar` больше НЕ делает `setSearchOpen(false)+blur()` (обходной путь УДАЛЁН): Escape и выбор варианта диспатчат `portal:search-close` → портал `closeSearchPop()`: **blur → state → морф SEARCH_TO_NAV**. Один вход, все способы (крестик, свайп вниз, Escape, тап мимо, другой раздел) идут через него.

### Listener lifecycle (ТЗ 2.13)
- `closeSearchPop`/`openSearch` → `useCallback([])` (стабильные идентичности); листенеры `portal:search-open` / `portal:search-close` → `[]`/`[stable]`-жизненный цикл. Раньше оба эффекта были БЕЗ массива зависимостей — пересоздание на каждый рендер портала.
- **Тест:** monkey-patch `window.addEventListener` + 6 быстрых переключений вкладок → **0 перерегистраций** каждого события; событие при этом работает.

---

## BLOCK 3 — HORIZONTAL PAGE NAVIGATION + SWIPE (P1)

### Tab ordering и направление (ТЗ 3.1)
- `VIEW_ORDER = ["catalog", "stock", "upload", "admin"]` (индексы 0–3). `newIndex > oldIndex → forward (новый справа)`, иначе backward. Вычисление — в рендере (ref-корректировка `prevViewRef`), чтобы enter-вариант уже знал сторону.
- Тап-переходы: `AnimatePresence mode="popLayout"` (одновременный вход/выход), варианты `pageVariants`: enter из `±42%` + opacity 0.6 → 1 (умеренная), exit в `∓46%` + opacity 0. **Анимируются только `transform: translate3d` и opacity** — blur/height на странице отсутствуют (3.2).

### Interactive edge swipe (ТЗ 3.3–3.7)
- **Файл:** `portal.tsx`, `[]`-эффект «интерактивный edge-swipe»; `touchstart` (passive) на `<main>`, `touchmove` (non-passive) / `touchend` / `touchcancel` — на window на время жеста.
- **НАСТОЯЩИЙ интерактивный жест:** при активации (|dx|>12px, |dx|>|dy|×1.25) монтируется neighbor-оверлей (`[data-tab-swipe-neighbor]`, fixed, top = низ шапки, pointer-events:none) с соседним разделом; текущий контент (`[data-tab-swipe-content]`) и оверлей двигаются ПРЯМЫМИ transform-записями за пальцем: content = `dx`, neighbor = `dir*w + dx`.
- **Progress:** `p = |dx|/w`; commit если `|dx| > 25% ширины` **ИЛИ** `velocity > 0.5 px/ms` (при |dx|>60px) — velocity из последних сэмплов (3.4).
- **Cancel:** короткий свайп → WAAPI-пружина контента в 0 и оверлея за экран; **КРИТИЧЕСКАЯ ДЕТАЛЬ (найдена тестом):** WAAPI без `fill` по завершении откатывается к inline-style — в `onfinish` inline-transform сбрасывается в финальное значение, иначе раздел оставался смещённым, а мобильный layout-viewport «разъезжался» (scrollWidth 495 → innerWidth 470 → координатная рассинхронизация).
- **Handoff при commit:** WAAPI доезжает (170 мс) контент за экран / сосед на 0 → затем ОДИН batched-рендер: `setView(target)` (официальный путь, история через существующий push-эффект — 3.8) + overlay снят + `instantRef` → enter/exit варианты с `duration: 0` — без кадра-разрыва.
- **Вертикальный интент (3.5):** до активации `|dy| > 8 && |dy| > |dx|×1.25` → жест отпущен браузеру (скролл работает, ни одного preventDefault); после активации `preventDefault` на touchmove — вертикальный скролл не вклинивается.
- **Исключения (3.6):** `input, textarea, select, [contenteditable], [data-no-tab-swipe], .pswp, [role=dialog/alertdialog], .search-pop, .pill-nav, .viewer-sheet-backdrop, .search-chip`; горизонтальные скроллеры (`scrollWidth > clientWidth+4` при `overflow-x: auto/scroll` на предках до main); атрибут `data-no-tab-swipe` добавлен на корень `AdminView` и на дропзону `UploadView`.
- **Крайние вкладки (3.7):** Catalog (swipe вправо) / Admin (влево) — neighbor НЕ монтируется, `dx *= 0.35` (лёгкий rubber-band), commit невозможен.
- **Поиск (3.10):** свайп запрещён при открытом поиске. Нюанс, найденный тестом: pointerdown-мимо закрывает поиск РАНЬШЕ touchstart жеста — касание, вызвавшее это закрытие, блокируется через `searchClosedAtRef` (600 мс окно).
- **Synх линзы (3.9):** `applyProgress()` интерполирует якорь линзы между `itemRefs[from]` и `itemRefs[to]` по p (та же пружина панели) — панель и контент живут на одном progress; при отмене линза возвращается к активной вкладке.
- **Performance (3.12):** один источник движения — обработчик touchmove пишет transform напрямую (без своего rAF-цикла); единственный rAF — постоянная пружина линзы; React-рендеров во время свайпа **ноль** (setState только на активации и в финале).
- **History (3.8):** коммит идёт через `setView()` → существующий push-эффект (`history.pushState(snapshot)`) — параллельной истории нет.

---

## 7.1 ИЗМЕНЁННЫЕ ФАЙЛЫ

| FILE | WHY CHANGED | IMPORTANT FUNCTIONS | RISK |
|---|---|---|---|
| `src/components/photo-viewer.tsx` | B1-F1..F5 | lifecycle-эффект (`Promise.all` зонд), scroll-lock-эффект, `sharePhoto/downloadPhoto` (loading-тосты), sheet-разметка | низкий: поведение pswp не заменялось, только конфиг/обвязка |
| `src/app/globals.css` | морф NAV↔SEARCH, прозрачность, авроры/зерно, 48px sheet, `.pill-shell` touch-action:none | `.pill-nav`, `.pill-morph-out`, `.search-pop`, `.aurora`, `.fx-grain`, `html.is-scrolling`, `.viewer-sheet-row` | средний:-touch-action:none на панели меняет панельные жесты — покрыто тестом tap-ов |
| `src/components/portal.tsx` | B2 (listeners, gesture панели, is-scrolling, морф-классы) + B3 (direction, popLayout, swipe-движок, neighbor, lens sync) | `closeSearchPop/openSearch` (useCallback), gesture-эффект панели, swipe-эффект, `pageVariants`, `applyProgress/finish` | высокий: ядро навигации — покрыт 3 E2E-наборами (49+49+95) |
| `src/components/search-bar.tsx` | единый путь закрытия (2.12) | `onKeyDown`, variant onClick | низкий |
| `src/components/admin-view.tsx` | `data-no-tab-swipe` на корне | — | нулевой |
| `src/components/upload-view.tsx` | `data-no-tab-swipe` на дропзоне | — | нулевой |
| `scripts/test-photo-viewer-mobile.mjs` | НОВЫЙ: E2E viewer (ТЗ 1.11) | pointer/pinch-симуляция, scroll-lock/restore, rapid ×10 | — |
| `scripts/test-mobile-nav-search.mjs` | расширен: PH2-секции 8–11 + морф-ассерты | churn-детектор, pill-жесты, interrupt | — |
| `scripts/test-mobile-horizontal-nav.mjs` | НОВЫЙ: E2E горизонтальной навигации (ТЗ 3.11) | CDP touch, intent/границы/поиск | — |
| `scripts/audit-scroll-perf.mjs` | НОВЫЙ: измерение скролла (ТЗ 2.7) | rAF-сэмплер + longtask, throttling ×6 | — |
| `eslint.config.mjs` | ignore `verify/**` (verify-clone внутри песочницы) | — | нулевой |

## 7.2 REMOVED LEGACY / CONFLICTING CODE
| Что удалено | Где | Почему |
|---|---|---|
| «Скопировать изображение» из action sheet | `photo-viewer.tsx` | ТЗ 1.6 «не перегружать»; ClipboardItem+PNG ненадёжен на iOS Safari; покрытие через Share/ссылку |
| `display:none` панели при searchOpen | `portal.tsx` + CSS | ТЗ 2.8: резкий обрыв в первом кадре; заменён морфом (`.pill-morph-out`). display:none остался ТОЛЬКО для клавиатуры (требование ТЗ v4 P0.3 не трогать) |
| Обходной путь закрытия `setSearchOpen(false)+blur()` в SearchBar | `search-bar.tsx` | ТЗ 2.12: два источника закрытия; теперь один `closeSearchPop` |
| Пересоздание листенеров `portal:search-open/close` на каждый рендер | `portal.tsx` | ТЗ 2.13: listener churn |
| `opacity+y` анимация смены вкладок (`mode="wait"`) | `portal.tsx` | ТЗ 3.1: вертикальная анимация противоречит горизонтальной структуре; заменена направленным горизонтальным slide (`popLayout`) |
| `filter: blur(110px)` у аврор, `inset:-50%` у зерна | `globals.css` | ТЗ 2.7: самые дорогие слои (измерено) |

## 7.3 TEST RESULTS

| Проверка | Результат |
|---|---|
| typecheck (`tsc --noEmit`) | **PASS** |
| lint (eslint .) | **PASS** |
| build (production standalone) | **PASS** |
| verify:e2e — `test-s4.mjs` | **PASS** |
| verify:e2e — `test-s5.mjs` | **PASS** |
| verify:e2e — `audit-full.mjs --quick` | **PASS** (проблем: 0) |
| verify:e2e — `stabilize-viewport-audit.mjs` | **PASS** (15 вьюпортов, перекрытий/ошибок нет) |
| photo viewer E2E (`test-photo-viewer-mobile.mjs`) | **PASS 49/0** (дважды подряд) |
| panel/search E2E (`test-mobile-nav-search.mjs`) | **PASS 49/0** |
| horizontal nav E2E (`test-mobile-horizontal-nav.mjs`) | **PASS 95/0** |
| 320×568 | **PASS** (компакт-набор nav-теста) |
| 375×667 | **PASS** (компакт-набор) |
| 390×844 | **PASS** (полные наборы всех трёх тестов) |
| 393×852 | **PASS** (компакт-набор + полный panel) |
| 430×932 | **PASS** (компакт-набор) |
| dark | **PASS** (все тесты идут в дефолтной тёмной теме; светлая — визуально не гонялась в E2E) |
| light | **NOT TESTED** (в E2E) |
| scroll-perf (throttling ×6, до/после) | **PASS** — измерения в §BLOCK 2 |
| clean git clone verify | **PASS** — `62e9e12`: install/typecheck/lint/build |
| REAL IPHONE | **NOT TESTED** |

## 7.4 PERFORMANCE (сводка)
- **Тормозило скролл:** авроры с `filter: blur(110px)` (23×50мс-кадра, maxGap 267 мс, 1071 мс long-tasks за сессию) + постоянные анимации зерна/аврор (770 мс long-tasks без паузы). Измерено на CPU ×6.
- **Изменено:** blur удалён (градиенты уже мягкие), слой зерна 4×→1,16× вьюпорта, пауза анимаций на время скролла (`html.is-scrolling`).
- **Анимируемые свойства теперь:** только `transform: translate3d` и умеренная `opacity` (переходы вкладок, морф панели/поиска, handoff свайпа). Никаких blur/height на странице.
- **rAF-циклы:** один постоянный — пружина линзы панели (стоит, когда линза в покое). Свайп-движок и жест панели пишут transform напрямую из событий; handoff — WAAPI (композитор). Второго независимого rAF на то же движение нет (3.12).
- **React state во время жестов:** не используется (только refs/DOM). setState: 1 на активацию свайпа (монтаж neighbor), 1 batched на commit/cancel.
- **Long tasks** (base, CPU ×6): 2 шт / 138 мс на скролл-сессию против 16 шт / 1071 мс до оптимизации.
- **Ограничения тестов:** headless Chromium ≠ реальный мобильный браузер; throttling ×6 — приближение; REAL IPHONE: NOT TESTED. «60 fps» не заявляем — заявляем измеренные метрики.

## 7.5 MEDIA ARTIFACTS
- `tool-results/mobile-phase2/viewer/photo-viewer-final.mp4` (+ 01-viewer-open.png, 02-action-sheet.png, 03-after-rapid.png)
- `tool-results/mobile-nav/mobile-nav-final.mp4` (обновлён, incl. PH2-секции)
- `tool-results/mobile-phase2/horizontal-navigation-final.mp4` (+ 10-after-swipe-forward.png)
- `tool-results/mobile-phase2/scroll-perf.json`
- В git НЕ входят (по ТЗ артефакты можно не коммитить).

## 7.6 GIT

| SHA | Message | Files |
|---|---|---|
| `81ece82` | fix(viewer): пропорции всех слайдов до init — закрыта гонка «странных положений»; явный body scroll-lock; loading-фидбек share/save; sheet по ТЗ 1.6 | src/components/photo-viewer.tsx |
| `9d9c571` | style(viewer): строки action sheet не менее 48px (ТЗ 1.6) | src/app/globals.css |
| `93d88a6` | test(viewer): E2E photo-viewer-mobile — свайпы/pinch/sheet/scroll-lock, 3 вьюпорта, видео (ТЗ 1.11) | scripts/test-photo-viewer-mobile.mjs |
| `ef8468f` | chore(lint): исключить verify-clone из eslint | eslint.config.mjs |
| `b6ddfb4` | fix(nav): gesture-линза следует за пальцем (commit только на release), стабильные search-листенеры, is-scrolling пауза фоновых анимаций (ТЗ 2.4-2.7, 2.13) | src/components/portal.tsx |
| `e71d25a` | fix(search): единый путь закрытия через portal:search-close — убран обход setSearchOpen+blur (ТЗ 2.12) | src/components/search-bar.tsx |
| `7ec09de` | feat(nav): морф NAV↔SEARCH единым стеклом без display:none, прозрачнее панель, авроры без blur(110px), зерно 1.08x слоя (ТЗ 2.2, 2.8-2.10) | src/app/globals.css |
| `41588ed` | test(nav): PH2-секции — churn, gesture панели, interruptible морф, is-scrolling, прозрачность | scripts/test-mobile-nav-search.mjs |
| `2a0832d` | test(perf): измерение скролла с CPU-throttling ×6 — до/после по каждому слою (ТЗ 2.7) | scripts/audit-scroll-perf.mjs |
| `c4fb73e` | feat(nav): горизонтальная навигация — направленные переходы по индексам, интерактивный edge-swipe с handoff, sync линзы с progress, intent-детект и rubber-band (ТЗ 3.1-3.10) | src/components/portal.tsx |
| `9739386` | feat(admin): data-no-tab-swipe — drag-and-drop зона без tab-swipe (ТЗ 3.6) | src/components/admin-view.tsx |
| `b8edab5` | feat(upload): дропзона с собственным drag — data-no-tab-swipe (ТЗ 3.6) | src/components/upload-view.tsx |
| `62e9e12` | test(nav): E2E horizontal-nav — 5 вьюпортов, свайпы/flick/intent/границы/поиск, видео (ТЗ 3.11) | scripts/test-mobile-horizontal-nav.mjs |

- clean verification clone HEAD = `62e9e12a2d4bb3bf223707b90d6bd48fec48a43d` (= FINAL_HEAD)
- Результат build из свежего clone: **PASS** (production standalone собран без ошибок)
- Коммиты пофайловые, без `git add .`/`-A`; runtime/данные/фото не тронуты; force push не использовался.

## 7.7 OPEN ISSUES
| ID | Priority | Description | Reason not fixed | Recommended next action |
|---|---|---|---|---|
| OI-1 | P2 | Отмена свайпа при резком повороте пальца на 180° после активации жеста остаётся отменой (target фиксируется при активации) | ТЗ фиксирует выбор соседа направлением первого движения; реверс-таргетирование не требовалось | Если владельцу нужно «реверс посреди жеста» — реализовать смену `g.target` при `sign(dx) ≠ dir` (локально в одном месте) |
| OI-2 | P2 | Neighbor-раздел при первом открытии может показать skeleton-кадр (React Query прогревается) | Данные кэшируются после первого захода; полный пре-маунт всех разделов противоречит ленивой загрузке | Опционально: `prefetchQuery` соседних разделов после idle |
| OI-3 | P1 | REAL IPHONE не проверялся | Нет доступа к аппарату из среды | Прогнать чек-лист на реальном iPhone (см. §7.8) |
| OI-4 | P3 | Светлая тема в E2E не гонялась (дефолт dark) | Временной бюджет этапа; светлая тема отличается только значениями токенов | Добавить переключение темы в E2E-контексты на следующем этапе |

## 7.8 REAL IPHONE STATUS

**REAL IPHONE: NOT TESTED**

Все цифры и PASS получены в headless Chromium (Playwright) с `isMobile/hasTouch` и CPU-throttling ×6. Это НЕ заменяет реальный iPhone. Чек-лист для владельца:
1. Viewer: pinch 1x↔5x, pan, свайп ←/→, свайп вниз (закрытие), × из зума, повторное открытие с 1x, Поделиться (системный шит с файлом), Скачать.
2. Панель: тап, drag пальцем по панели (линза за пальцем, выбор на отпускании), морф в поиск (без резкого display:none).
3. Поиск: клавиатура — карточка над ней (`--kb-overlay`), дропдаун вверх, закрытие крестиком/свайпом/Esc-жестом/тапом мимо.
4. Горизонтальный свайп разделов: следует за пальцем, сосед виден, линза едет синхронно; вертикальный скролл не конфликтует; на Каталоге вправо и на Админе влево — только лёгкое сопротивление.
5. Скролл «Остатков»: плавность (главная жалоба — «очень сильно тормозит листание»).
6. Страница не зумится пинчем вне viewer'а; внутри viewer'а пинч работает.

## 8. ФИНАЛЬНЫЙ СТАТУС БЛОКОВ

- **BLOCK 1 PHOTO VIEWER: PASS** (49/49 E2E ×2 прогона)
- **BLOCK 2 LIQUID PANEL: PASS** (49/49 E2E; perf-измерения с до/после)
- **BLOCK 3 HORIZONTAL NAV: PASS** (95/95 E2E, 5 вьюпортов)

Дальнейшие этапы (админка и пр.) НЕ начинались — согласно ТЗ, отчёт передаётся на независимое ревью (ChatGPT) до формирования следующего этапа ADMIN UX SIMPLIFICATION.
