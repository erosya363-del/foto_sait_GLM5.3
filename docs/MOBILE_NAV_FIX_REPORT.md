# MOBILE NAV FIX REPORT — Liquid Glass панель + режим поиска (ТЗ v4)

Дата: 2026-09-17 · Репозиторий: `erosya363-del/foto_sait_GLM5.3` (main)

```text
Commit before: 0531652 (docs: v3 — первопричина исчезновения фото при деплое)
Commit after:  см. git log — fix(mobile-nav): rebuild liquid glass navigation and keyboard search
```

## Что сделано

Мобильная нижняя панель и поиск пересобраны по архитектуре ТЗ v4 (без косметики
поверх старого — конфликтующие слои и дублирующая логика удалены полностью):

```text
GLASS SHELL → BACKGROUND / CAUSTICS → LIQUID ACTIVE LENS → GLASS HIGHLIGHT / RIM → ICONS + LABELS
```

Иконки и текст ВСЕГДА выше жидкой линзы (`.pill-controls` z-index: 4 против
линзы z-index: 1 и кромки z-index: 3). Панель не меняет геометрию, прозрачность
и положение при скролле и касании.

## Удалено

```text
- searchFabOpen / setSearchFabOpen      (второй state поиска — источник гонок)
- pillTouched + pointerdown-эффект      («панель темнеет от касания»)
- pill-dim / pill-active                (смена плотности от скролла/тапа, CSS+JSX)
- .pill-haptic                          (скрытые <input switch> внутри кнопок — 4 шт.)
- #pill-uneven                          (feTurbulence + feDisplacementMap SVG)
- старый animation-effect [view, productId]  (уничтожал rAF-полёт на смене вкладок)
- prevDropX + вся логика fromPill/hapticOn/vibrateSupported в goCatalog
- дублирующий outside-pointerdown из SearchBar (режимом управляет ТОЛЬКО Portal)
- ручные classList.add/remove("is-open")     (React state = единственный источник DOM)
- формула +64px + 12mm + var(--kb-h) в .search-pop (огромная пустота над клавиатурой)
- transition: bottom 0.3s               (карточка должна ехать С visualViewport)
- min-height: 236px у .search-dd        (искусственная пустая коробка)
- html.kb-open .search-dd { top: ... }  (дропдаун ВНИЗ под клавиатуру)
- --pill-bg-dim / --pill-bg-active / --caust-4 / --caust-blend / --caust-opacity
- native-ios-shell .search-pop оверрайд с 12mm/--kb-h
```

## Добавлено

```text
+ один state поиска: usePortal.searchOpen (навигация, aria-expanded, карточка, чип, Escape, свайп)
+ одна мобильная навигация: nav.pill-nav > .pill-wrap > .pill-shell (caustic + goo + rim + controls)
+ постоянный spring-контроллер ([]-эффект): пружины живут вечно, смена вкладки
  меняет ТОЛЬКО target → Каталог→Остатки→Загрузка за 100 мс = одно непрерывное движение
+ отдельный target-эффект [view, productId]: только drivePillRef/hidePillRef, без cancelAnimationFrame
+ liquid lens ПОД кнопками внутри панели: 6px от кромки (shell 64px, линза 52px), не выпирает
+ стабильный glass shell: без transition геометрии, touch-action: manipulation
+ ослабленная линза (полупрозрачное мятное стекло вместо бирюзового шара):
  dark drop-a 0.44 / drop-b 0.30 / drop-c 0.24; light drop-a 0.52 / drop-b 0.34 / drop-c 0.25
+ --kb-overlay (use-visual-viewport п.20): разделены keyboardHeight (общая, --kb-h для модалок)
  и overlay-перекрытие (позиционирование fixed search); Android учитывает клавиатуру ОДИН раз
+ .search-pop = место панели: bottom max(12px, --sab); при клавиатуре calc(--kb-overlay + 8px)
+ результаты поиска ВСЕГДА ВВЕРХ: bottom calc(100% + 8px), max-height 42dvh (34dvh при kb)
+ closeSearchPop: input.blur() ПЕРВЫМ делом → клавиатура закрывается, потом state
+ openSearch(focusInput): фокус только у «/» на десктопе; кнопка поиска клавиатуру не открывает
+ fx-vignette 20 / fx-grain 21 (было 44/45 — зерно лежало ПОВЕРХ панели)
```

## Проверки

```text
typecheck:            PASS (tsc --noEmit)
lint:                 PASS (eslint .)
build:                PASS (next build, standalone + prune)
мобильная навигация:  PASS (DOM: 1×nav.pill-nav, 1×shell/bubble/ghost, 0×input в кнопках)
rapid switching:      PASS (10 циклов Каталог→Остатки→Загрузка→Админ, паузы 85/95/60 мс:
                      console.error=0, pageerror=0, requestfailed=0; линза под активной
                      вкладкой после каждого цикла; is-live в середине полёта — телепорта нет)
search:               PASS (pill-nav display:none; карточка у safe-area, зазор ~12px — без 64px/12mm)
keyboard simulation:  PASS (kb-open + --kb-overlay:300px → низ карточки ≈308px, НЕ 417+;
                      дропдаун ВВЕРХ: top:auto + bottom:calc(100%+8px) в базе и в kb-open)
закрытие поиска:      PASS (blur снят, kb-open убран, панель вернулась)
dark:                 PASS (скриншоты 01–04, 06)
light:                NOT TESTED визуально (токены обновлены симметрично; геометрия общая)
```

Тест: `scripts/test-mobile-nav-search.mjs` (390×844, fail-closed через e2e-guard,
изоляция production-сборки: `bash scripts/run-isolated.sh bun scripts/test-mobile-nav-search.mjs`).
Итог прогона: **PASS=33 FAIL=0**.

Артефакты (tool-results/mobile-nav/, в git не входят):
`01-catalog.png`, `02-stock.png`, `03-upload.png`, `04-admin.png`,
`05-search-no-keyboard.png`, `06-search-keyboard.png`, `mobile-nav-final.mp4`
(Каталог→Остатки→Загрузка→Админ→быстрые переходы→Поиск→клавиатура→закрытие).

## Real iPhone: NOT TESTED

Главный критерий — реальная мобильная панель после deploy. Чек-лист приёмки (п.29 ТЗ):
одна панель; линза внутри панели и не перекрывает иконки; непрерывность при быстрых
тапах; shell не меняется от скролла/касания; поиск исчезает вместе с панелью,
карточка на её месте; при клавиатуре карточка ≈8px над системной панелью iOS, без
пустого зазора ~100px; системные ↑↓✓ Safari остаются как есть; закрытие поиска —
blur → клавиатура уходит → навигация возвращается; light/dark — одна геометрия.

## Запреты на будущее (для следующих правок)

Не возвращать: `searchFabOpen`, `pillTouched`, `.pill-haptic`, `pill-dim/active`,
второй SVG displacement, `filter: blur()` на nav, анимации `bottom/left`,
`transition: all`, setState в animation frame, `12mm`, `+64px`, дропдаун вниз при
клавиатуре, скрытые form-controls в навигации, вторую нижнюю панель.
Хаптика панели — только `playTick("tap")` (см. шапку `src/lib/tick.ts`).
