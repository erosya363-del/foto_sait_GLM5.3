# MOBILE PHASE 2.3 — Dynamic Liquid Lens + Haptics + iOS Cold Start + Performance Verification

Дата: 2026-09-18 · Ветка: `main` · Исполнитель: агент (Super Z)

## HEAD

| | commit |
|---|---|
| **START_HEAD (ожидаемый)** | `7826c0e` (Phase 2.2 worklog) |
| **START_HEAD (фактический)** | `7826c0e` — совпадает, посторонних изменений нет (`git status` чист, `reset/clean` не применялись) |
| **FINAL_HEAD** | см. конец отчёта (раздел 23.8) |

---

## 23.1. DYNAMIC LENS — что было / что стало

### Что было (Phase 2.2)
Одна `.pill-bubble` внутри `.pill-shell` (overflow: hidden), одна пружина
позиции (k=150, d=23), ширина писалась мгновенно (`style.width`), «тянучка» —
scaleX `min(|v|·0.0009, 0.12)`, высота линзы фиксированная 52px (top/bottom 6px),
линза никогда не покидала панель.

### Что изменено
Единый rAF-контроллер ведёт **три пружины + bridge-фактор** (§1.11: разделены,
не смешаны):

| Пружина | k | d | Назначение |
|---|---|---|---|
| position | 150 | 23 | полёт линзы по X (без перескока цели — сохранено) |
| **width** (новая) | 170 | 25 | single ↔ bridge без прямоугольных скачков ширины (§1.12) |
| **press** (новая) | 220 | 26 | вспухание 0..1 на pointerdown, сбор на release (§1.5/D) |
| bridge (глад.) | — | — | sin(PI·t), досглаживание смены сегмента (спекуляр) |

**DOM-архитектура (§1.4/E, supplement E/F):** геометрия разделена со стеклом.

```
nav.pill-nav
└── .pill-wrap
    └── .pill-shell          ← GEOMETRY, overflow: VISIBLE (не клипит линзу)
        ├── .pill-surface    ← стекло 64px: backdrop-filter/border/shadow,
        │   └── .pill-caustic   overflow: HIDDEN (единственный клип), ::before спекуляр
        ├── .pill-goo        ← SVG #pill-goo (область фильтра расширена: x -12%, y -45%,
        │   └── .pill-bubble     h 190% — вспухшая линза не клипается канвой)
        ├── .pill-rim
        └── .pill-controls   ← кнопки; контент обёрнут в .pill-item-content
```

Супплемент F соблюдён: НИКАКОГО wrapper-слоя — translate3d + scaleX + scaleY
объединены в одной записи `render()` существующего rAF.

**Геометрия (§1.2/1.3, supplement D):**

| Состояние | База | scaleY | Визуальная высота | Положение |
|---|---|---|---|---|
| REST | 60px (top/bottom 2px) | 0.90 | **54px** | внутри панели, отступы ~5px |
| PRESS | 60px | 0.90 + 0.30·press = 1.20 | **72px** | **выше и ниже панели на ~4px** |
| BRIDGE | 60px | как press (палец на панели) | 72px | масса накрывает обе вкладки |

Коридоры ТЗ соблюдены: REST 52–56px ✓, PRESS 70–76px ✓, scaleY REST ~0.90 ✓,
PRESS 1.18–1.25 ✓. Ширина при press ×1.10 (§1.5: 1.08–1.14).

**Bridge-формула (§1.7/1.8, supplement B):** см. 23.2.

**Position formula (§1.9):** targetX = targetLeft (левая кромка из edge-формулы,
минус полподушки bridge); пружина позиции гонится за ним; клампы не нужны —
edge-формула по построению лежит в пределах панели (подушка максимум 6px).

**Velocity stretch (§1.11, supplement C):** `min(|v|·0.0012, 0.14)` — было
`0.0009/0.12`. Tuning-коридор 0.0010–0.0016 / 0.12–0.18 соблюдён, потолок 0.20
не превышен. scaleY умножается на `(1 − stretch·0.24)` (сохранение объёма).

**Specular (supplement H):** CSS-переменные `--lens-press`/`--lens-bridge`
пишутся rAF'ом только при изменении (>0.004). Слои складываются: базовый
v5-градиент (верх 0.55) = REST-спекуляр; `.pill-bubble::after` добавляет
`opacity: calc(0.10 + 0.25·press + 0.08·bridge)`. Суммарно ≈ 0.55 REST /
0.80 PRESS / 0.85 bridge-центр — в коридоре §H (0.55 / 0.75–0.85 / 0.70–0.80).
Первые значения (0.55 база у ::after) дали пересвет на кадре 03 — уменьшены,
см. 23.8 (OPEN ISSUES: финальная оценка визуала за владельцем на iPhone).

**Release (§4):** pointerup → `clearGestureVisual()` (covered сняты, bridge→0,
press→0) + commit (`setView`, довозит эффект [view]) или `settleBack()` к
активной вкладке. Все три пружины собираются, rAF гасится по полному покою
(x, w, p одновременно). Ничего не остаётся увеличенным/растянутым/между
вкладками.

**Search-морф (§12):** при открытии поиска во время press/drag панели жест
отменяется ДО морфа (`cancelPanelGestureRef` из эффекта `[searchOpen]`):
covered сняты, press→0, settleBack — под исчезающей панелью не остаётся
вспухшей линзы. Сам горизонтальный морф 2.1 не тронут (тесты секций 5–7, 10 —
PASS без правок).

**Page swipe (§13):** горизонтальный свайп разделов гонит линзу через
`drivePillRef` при press=0 — нормальная, НЕ-pressed геометрия. TAB PANEL DRAG
и PAGE EDGE SWIPE не путаются (press поднимается только касанием панели).

**Photo viewer (§14):** не тронут (`pinchToClose: false`, closeOnVerticalDrag,
scroll-lock, action sheet) — покрыт регрессионным suite 49/49.

---

## 23.2. TWO-TAB BRIDGE

- **Определение from/right:** вкладки сортируются по `offsetLeft` в снимок
  `geo[]` (ОДИН раз на pointerdown — ноль layout-чтений в жесте). `anchor` —
  вкладка, к которой прикреплена линза (инициализируется ближайшей к пальцу).
  Сегмент = (anchor → сосед в сторону пальца). Пересечение ЦЕНТРА соседа
  переключает anchor (это же момент `playStep`).
- **t:** `|fx − center[from]| / |center[to] − center[from]|`, clamp 0..1,
  fx = clientX − shellLeft (реальный палец).
- **bridge:** `sin(PI·t)` — 0 на центрах, 1 посередине.
- **Ширина (supplement B.2/B.3):** TWO-PHASE EDGES дают targetLeft/targetRight:
  движение вправо — фаза 1 (t<0.5): `targetLeft = from.left`,
  `targetRight = lerp(from.right, to.right, easeOutCubic(2t))`; фаза 2 (t≥0.5):
  `targetLeft = lerp(from.left, to.left, easeOutCubic(2t−1))`,
  `targetRight = to.right`; влево — зеркально. ease = `1 − (1−x)³`.
  Подушка `6px·bridge` симметрично. `targetWidth = (right − left)` через
  width-пружину; полная масса моста ≈ `to.right − from.left + 6`.
  sin(PI·t) дополнительно управляет спекуляром (`--lens-bridge`) — то есть
  «edge formula → физическая форма по X, sin → сила растяжения стекла» (B.3).
- **Covered pair:** вкладки, чьи **центры** лежат внутри целевой массы стекла
  `[targetLeft, targetRight]` (честная иллюзия «стекло прошло поверх»,
  supplement G.1). Обновление classList — только при реальной смене пары (§2.4).
  `is-on` не трогается до commit. В середине моста накрыты ОБА пункта, оба
  контента сжаты scale .92.
- **Cleanup:** release → `clearGestureVisual()` (все `is-lens-covered` сняты
  через diff, bridge 0, press 0); pointercancel и cancel-извне — то же +
  `settleBack()`. Проверено тестами G/H/I/J (секции 13–14 nav-search).

---

## 23.3. TEXT/ICON PRESS

| Параметр | Значение |
|---|---|
| REST scale | 1 |
| Pressed/covered scale | **0.92** (допуск ТЗ 0.90–0.95) |
| Transition | `transform 180ms var(--ease-spring)` + `opacity 150ms ease` |
| Селектор | `.pill-item.is-lens-covered .pill-item-content` |

Масштабируется wrapper `.pill-item-content` ВНУТРИ кнопки, не сама кнопка:
hit-area 44×44 не уменьшается (§2.1), transform кнопки не конфликтует с
nav-pulse, gesture-логикой и позиционированием. `is-on` и `is-lens-covered` —
разные состояния (G.1): в bridge накрыты оба, committed-класс один.

---

## 23.4. HAPTICS

Диагностика (§5.1): код-путь цел — `playTick` → `haptic()` → web-haptics
`engine.trigger()` (Android: `navigator.vibrate` ≥16 мс; iOS 17.4+: switch-
эмуляция пакета). Троттл 60 мс на оба слоя. Причина «пропавшей» вибрации
архитектурно не найдена (вызовы были) — добавлен недостающий **press-отклик**
(его не существовало: feedback был только на click) и **step на границах**
(`playStep` импортировался, но никогда не вызывался в панели).

| EVENT | FEEDBACK | IMPLEMENTATION |
|---|---|---|
| pointerdown (панель) | мягкий press: звук 1650 Гц + 16 мс | `playTick("press")` в `onDown`, ОДНОВРЕМЕННО с `pressPillRef(true)` (supplement I) |
| Пересечение центра вкладки (drag) | step: 10 мс | `playStep()` в `updateLens` при смене anchor — ровно один раз на границу |
| Release c реальной сменой раздела | tap: 22 мс | `playTick("tap")` в `finish()` после `setView` |
| Release без смены / cancel | без хаптики | — |
| Поиск (кнопка) | tap | `openSearch` → `playTick("tap")` (сохранено) |

Двойной отклик (§5.3): press + click обычного тапа схлопываются троттлом 60 мс
(тест «H. tap: ровно один отклик» — PASS); глобальный click-делегат и явные
вызовы компонентов остаются под тем же троттлом. `.pill-haptic`/скрытые
input'ы НЕ возвращались (запрет соблюдён).

**Rate assertion (§16):** drag через 3 границы с 12 pointermove → ≤7 vibration-
вызовов, связанных с границами, а не с move (PASS в стабе `navigator.vibrate`).

| Устройство | Статус |
|---|---|
| ANDROID VIBRATION | **NOT TESTED** (реальный аппарат недоступен агенту) |
| IPHONE HAPTIC | **NOT TESTED** — честно: switch-эмуляция web-haptics может ощущаться слабее нативной; проверить владельцем. Audio-fallback в коде есть, но не подменяет статус |

Headless-стаб подтверждает ТОЛЬКО маршрут вызовов, не ощущение.

---

## 23.5. IOS STRIP FIX («полоса» при холодном старте)

| | ДО (Phase 2.2) | ПОСЛЕ (PHASE 2.3 §6) |
|---|---|---|
| layout.tsx нуджи | 9 шт: 120…7600 мс | **4 шт: 120/420/900/1500 мс** |
| boot-splash нуджи | 8 шт: 150…6000 мс | **4 шт: 150/500/1000/1500 мс** |
| window.resize | dispatch на каждый нудж | **НЕ dispatch** (§6.5: forced reflow + scale-пульс самого `.pill-shell` достаточны) |
| Отмена по взаимодействию | не было (touchend вызывал ещё один нудж) | **первый pointerdown/touchstart отменяет все оставшиеся таймеры** (capture, §6.3) |
| Нудж во время жеста | возможен до 7.6 c | невозможен: любой жест начинается с тех же событий, которые отменяют серию (§6.4) |
| compositor-хинт | `.pill-shell` translateZ(0) | сохранён + продублирован на `.pill-surface` (§6.1; лишних will-change нет) |

Формулировка причины исправлена на «рабочий приём для наблюдаемой проблемы;
подтверждение на реальном устройстве требуется» (§6.6) — в layout.tsx,
boot-splash.tsx и скилле. Synthetic resize полностью убран.

---

## 23.6. PERF (CPU-throttling ×6, headless, median из 3 прогонов)

### A. Скролл списка «Остатки» (методика audit-scroll-perf)

| Вариант | gaps32 | gaps50 | maxGap | longTasks | longTotal |
|---|---|---|---|---|---|
| **40px (production)** | 13 | 0 | 50 мс | 0 | 0 мс |
| 32px | 9 | 1 | 50 мс | 5 | 280 мс |
| 24px | 10 | 0 | 50 мс | 0 | 0 мс |

### B. Panel drag (press → два моста → release, медленно, §17)

| Вариант | gaps32 | gaps50 | maxGap | longTasks | longTotal |
|---|---|---|---|---|---|
| **40px (production)** | 32 | 3 | 167 мс | 11 | 1164 мс |
| 32px | 29 | 4 | 83 мс | 26 | 1560 мс |
| 24px | 31 | 4 | 100 мс | 18 | 2070 мс |

**Выводы (честно):**
1. Зависимости от радиуса blur НЕТ — различия в шуме headless (24px даже
   «хуже» в panel-drag по longTotal). **RECOMMENDED BLUR: оставить 40px**
   (production не менялся).
2. Panel drag тяжелее скролла (ожидаемо: движение backdrop-стекла + goo) —
   при ×6 throttle видны long-task ~100 мс. Это симуляция слабого CPU:
   на реальном устройстве ожидание ~×6 меньше, но **подтверждение — только
   реальный iPhone** (§7.3: обещаний 60 FPS нет).
3. Структура затраченного не изменилась с Phase 2 (авроры/зерно — главный
   фон; is-scrolling-пауза сохранена).

---

## 23.7. TESTS

| Проверка | Результат |
|---|---|
| typecheck (`tsc --noEmit`) | **PASS** |
| lint (eslint) | **PASS** |
| build (production standalone) | **PASS** |
| test-mobile-nav-search (включая новые секции 12–15: dynamic lens A–J + haptics) | **PASS 85/0** |
| test-v31 (секции 1–5, вкл. новый ассерт pill-surface/shell overflow) | **PASS 22/0** |
| **test-p23-themes (новый: dark/light/landscape × REST/PRESS/BRIDGE/RELEASE/SEARCH)** | **PASS 33/0** |
| test-mobile-horizontal-nav (5 вьюпортов 320–430, page-swipe, линза в non-pressed геометрии) | **PASS 95/0** |
| test-photo-viewer-mobile (viewer не сломан) | **PASS 49/0** |
| verify:e2e (s4 34/0, s5 40/0, audit-full 0 находок, stabilize-viewport) | **PASS** |
| verify:runtime (regression + restore-roundtrip 13/0, production runtime не тронут) | **PASS** |
| Perf 40/32/24 ×3 + panel-drag | PASS (записан tool-results/mobile-phase2/perf-p23.json) |
| Контрольные кадры 01–09 + dynamic-liquid-lens.mp4 (supplement J) | PASS (tool-results/p23/, в Git НЕ входят) |
| DARK | **PASS** |
| LIGHT | **PASS** (было NOT TESTED в 2.2; кромка/глубина `.light .pill-bubble` усилена по кадрам 06–08) |
| LANDSCAPE 844×390 | **PASS** (вспухшая линза не обрезается, не выходит за экран) |
| CLEAN CLONE | см. 23.8 |
| REAL IPHONE | **NOT TESTED** — чек-лист владельцу ниже |

**REAL IPHONE чек-лист (после redeploy):**
1. Холодный запуск Safari/PWA — нет «полосы» (защита теперь 4 нуджа ≤1.5 c + отмена по касанию).
2. Тап «Каталог» — линза вспухает выше панели (~4px), текст чуть сжимается, мягкий тик.
3. Не отпуская — вести Каталог→Остатки: линза за пальцем, у середины ОДНА масса накрывает обе.
4. Остановка на середине — капля висит на обеих вкладках, спекуляр усилен.
5. Отпустить на Остатках — сбор на Остатках, высота в панель, commit-тик.
6. Отпустить не дотянув — возврат к исходной вкладке без смены раздела.
7. Вибро: press / границы / commit различимы? (iOS — switch-эмуляция, честный статус см. 23.4)
8. Поиск: панель втекает в кнопку поиска (морф не сломан), встречный жест отменяется.
9. Скролл «Остатков» — без регресса лагов.
10. Светлая тема: линза видна кромкой/глубиной на белой панели и на фото.

---

## 23.8. OPEN ISSUES + FINAL HEAD

**OPEN ISSUES (не скрывать):**
- **OI-1 iOS cold-start workaround:** реальный статус защит «полосы» на
  настоящем iPhone НЕ подтверждён (headless не воспроизводит баг). Серия
  сокращена по ТЗ; если «полоса» вернётся — возвращать точечно (не через
  удлинение серий), по протоколу диагностики dbg-strip.mjs.
- **OI-2 iPhone haptic:** switch-эмуляция web-haptics не проверена рукой;
  физический PASS невозможен без аппарата (см. 23.4).
- **OI-3 Specular intensity:** значения `::after` (0.10/0.25/0.08) подобраны
  по headless-кадрам; на реальном экране (P3, яркость) возможна подстройка ±.
  Аналогично кромка `.light .pill-bubble` — стартовая точка ТЗ (ring .065) на
  белой панели была невидима, усилена до ring .28 + глубина; финальная оценка
  за владельцем (supplement A: «заметна, но не серый овал»).
- **OI-4 Panel-drag long tasks под CPU×6** — ожидаемо тяжёлое стекло;
  при жалобах на реальном устройстве первым кандидатом упрощения является
  SVG goo-фильтр линзы (`no-goo` вариант в perf-скрипте готов).
- **OI-5** `/api/media`-кэш и v1.7.0-маркер edge — вне зоны этапа (см. FIX_REPORT §17).

**GIT:** коммиты пофайлово (без `git add .`), последовательность:
1. `feat(glass): dynamic expanding single-lens gesture physics` — portal.tsx
2. `feat(glass): pill-surface split, press-lens material, light rim, content press` — globals.css
3. `fix(haptics): soft press tick + boundary step route` — tick.ts
4. `fix(ios): cold-start nudges capped at 1.5s, cancel on first touch, no synthetic resize` — layout.tsx, boot-splash.tsx
5. `test(glass): dynamic lens A-J, themes, perf, frames` — scripts/*
6. `docs(skill): liquid-glass standard — press lens, haptics, exceptions` — .agents/skills/liquid-glass
7. `docs(phase2.3): MOBILE_PHASE23_REPORT` — docs/ + worklog

**FINAL_HEAD:** фиксируется в конце сессии (см. финальное сообщение агенту
и `git log origin/main`); чистый clone-verify: install/typecheck/lint/build.

**После этого — СТОП:** Админку НЕ начинать; материалы передаются на
независимое ревью (ChatGPT), затем redeploy + real-iPhone чек-лист §23.7.
