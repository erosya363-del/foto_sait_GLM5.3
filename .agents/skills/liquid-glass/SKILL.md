---
name: liquid-glass
description: Проектный стандарт Liquid Glass v5 + Dynamic Press Lens (PHASE 2.3) фото-каталога Askona — нижняя панель-пилюля, поиск, просмотрщик. Использовать при любой правке стекла: токены (--glass-blur/--glass-saturation/--pill-bg), слои панели (pill-shell/pill-surface), физика линзы (press/bridge-пружины), морфы NAV↔SEARCH, хаптика, стеклянные кнопки, safe-area. Запрещает hardcoded blur в JSX и вторые линзы.
---

# Liquid Glass v5 + Dynamic Press Lens (проект Askona)

Единый стеклянный язык интерфейса: нижняя панель-пилюля, подвесной поиск,
чипы, кнопки viewer'а. Референс — iOS 26 Liquid Glass.
PHASE 2.3 добавил физику «живой линзы» (press/bridge) и хаптический маршрут.

## Токены (только они, никаких новых констант)

| Токен | Значение | Смысл |
|---|---|---|
| `--glass-blur` | `40px` | радиус размытия ЛЮБОГО стекла |
| `--glass-saturation` | `2.0` | насыщенность стекла |
| `--pill-bg` | dark `rgba(50,48,44,.28)` / light `rgba(255,255,255,.38)` | фон панели (на `.pill-surface`) |
| `--glass` / `--glass-strong` | общий фон стекла / дропдаунов |
| `--glass-spec` / `--glass-spec-strong` | спекуляр-блики (inset 0 1px 0) |
| `--glass-shadow` | внешняя тень стекла |
| `--lens-press` / `--lens-bridge` | 0..1, пишет rAF-контроллер линзы (спекуляр/давление) |
| `--sab` / `--sat` | safe-area bottom/top (env(), читается один раз) |
| `--z-nav 40 / --z-fab 45 / --z-pop 50 / --z-photo-viewer 10000 / --z-photo-viewer-ui 100000` | слои |

### Задокументированные исключения blur (§8 аудита PHASE 2.3)

НЕ стекло-«пилюля», а другие уровни стекла/скримы — свои значения осознанно,
каждое с комментарием в CSS: `.glass`/`.glass-strong`/`.lg-*` (52–56px —
десктопные поверхности), `.search-pop` 36px, `.search-chip` 48px, `.field`
10px (мелкое поле), `.fab-top` 52px, `.pswp__counter` 18px (счётчик viewer'а).
JSX: `upload-view` (скрим 2px/sm — затемнение, НЕ стекло),
`admin-photobank` (sm ×4 — Админка ждёт переделки). Всё остальное в JSX —
только `backdrop-blur-[var(--glass-blur)]`.

## Железные правила

1. **JSX: никакого hardcoded blur.** Только `backdrop-blur-[var(--glass-blur)]`.
   Хардкоды разрешены ТОЛЬКО в globals.css (см. список исключений выше).
2. **Одна линза.** В панели ровно один `.pill-bubble` на ОДНОМ rAF
   с ТРЕМЯ пружинами: position k=150/d=23, width k=170/d=25,
   press k=220/d=26, плюс bridge-фактор sin(PI·t) (спекуляр/подушка ширины).
   Вторые/догоняющие линзы ЗАПРЕЩЕНЫ (призрак удаляли — пользователь просил сам).
3. **Preview ≠ commit.** Линза следует за реальным `clientX` непрерывно;
   `nearestItem` — только на pointerup (Phase 2.1). `is-on` не меняется до
   release; `is-lens-covered` — временный оптический preview (могут быть ОБА).
4. **Морф NAV↔SEARCH — горизонтальный shared:** панель сжимается в кнопку
   поиска (`scale(0.42,0.85)`, origin `calc(100% - 45px) 50%`), карточка
   растёт каплей из той же точки (`scale(0.14,0.86)`, origin
   `calc(100% - 33px) 50%`, radius 999→22). 260 мс, кривая
   `cubic-bezier(0.22,0.61,0.36,1)`, оба слоя. Не переводить в вертикальный.
   Открытие поиска при активном press/drag — жест панели СНАЧАЛА отменяется
   (cancelPanelGestureRef), потом морф.
5. **Pinch в viewer — только зум.** Закрытие: вертикальный drag при 1x или ×.
6. **iOS-стекло при холодном старте** иногда рисует слой с неверной
   геометрией («пустая полоса под панелью» до первого касания). Формулировка
   ОБЯЗАТЕЛЬНО «рабочий приём (workaround) для наблюдаемой проблемы;
   подтверждение на реальном устройстве требуется» — НЕ «доказанная причина».
   Защита (PHASE 2.3 §6): `transform: translateZ(0)` на `.pill-shell` +
   `.pill-surface`; нуджи ТОЛЬКО 120/420/900/1500 мс (layout.tsx до
   гидратации) и 150/500/1000/1500 (boot-splash, standalone PWA);
   ГЛОБАЛЬНЫЙ `window.resize` НЕ dispatch; первый pointerdown/touchstart
   отменяет все оставшиеся нуджи. Не удлинять серии обратно.
7. **touch-action: none** на `.pill-shell` — pointer-поток линзы не должен
   уходить в скролл. `viewport-fit: cover` + `interactive-widget: resizes-content`
   в viewport-экспорте layout.tsx — не трогать.
8. **DYNAMIC PRESS LENS (PHASE 2.3).** Одна линза:
   REST — 54px визуально ВНУТРИ панели (база 60px × scaleY .90, top/bottom 2px);
   PRESS — pointerdown: пружина press → scaleY 1.20 = 72px, линза ВЫШЕ/НИЖЕ
   панели на ~4px с каждой стороны, ширина ×1.10 (никакого клипа:
   `.pill-shell` overflow visible, клип стекла — `.pill-surface`);
   DRAG/BRIDGE — между соседними вкладками ОДНА масса накрывает ОБЕ:
   TWO-PHASE EDGES (ведущая кромка тянется к цели easeOutCubic, задняя
   догоняет после t=0.5) + подушка 6px·sin(PI·t); covered = вкладки, чьи
   центры накрыты целевой массой (класс `.is-lens-covered` — контент
   `.pill-item-content` сжимается scale .92; САМУ кнопку не масштабировать —
   hit-area 44px и nav-pulse не трогать); anchor/`playStep` — по пересечению
   ЦЕНТРА вкладки, один раз на границу; velocity stretch `|v|·0.0012`,
   потолок 0.14 (не выше 0.20); release/cancel — пружинная сборка к вкладке,
   ничего «залипшего» (никакого teleport, рывков ширины, второй линзы).
   Горизонтальный PAGE-SWIPE гоняет линзу в НЕ-pressed геометрии (press=0).
9. **Хаптика панели — только через playTick/playStep (web-haptics).**
   Маршрут: pointerdown → `playTick("press")` (мягкий, 16 мс, одновременно
   с визуальным вспуханием); пересечение центра вкладки в drag → `playStep()`
   ровно один раз на границу; release с реальной сменой раздела →
   `playTick("tap")`. Троттл 60 мс в tick.ts схлопывает press+click обычного
   тапа. `.pill-haptic` и скрытые form-controls в панели ЗАПРЕЩЕНЫ
   (см. шапку tick.ts). Не писать «iPhone haptic PASS» без реального аппарата.

## Слои панели (снизу вверх)

`GEOMETRY SHELL (.pill-shell, overflow: VISIBLE — НЕ клипит линзу)` →
`GLASS SURFACE (.pill-surface: backdrop/backdrop-filter/border/shadow,
overflow: hidden — единственный клип стекла, внутри: .pill-caustic)` →
`LIQUID LENS (.pill-goo > .pill-bubble, SVG #pill-goo с РАСШИРЕННОЙ областью
фильтра x -12%/y -45% — вспухшая линза не клипается)` →
`RIM (.pill-rim)` → `ICONS+LABELS (.pill-controls, z-4; контент кнопок —
`.pill-item-content`)`.
Кнопки ВСЕГДА выше линзы. Панель никогда не двигается сама
(только morph-классы `pill-morph-out`/`pill-hidden`/`kb-open`).

## Карта файлов

- `src/app/globals.css` — все токены и стекло (секции PILL NAV, search-pop, pswp);
  `.pill-surface` — реальное стекло; `.light .pill-bubble` — кромка/глубина
  светлой линзы; `.pill-bubble::after` — press-спекуляр через `--lens-press`.
- `src/components/portal.tsx` — контроллер пружин (ОДИН rAF: render/step/
  settle/drive/press/bridge), gesture панели (geo-снимок, anchor, two-phase,
  covered), `cancelPanelGestureRef` (отмена жеста при открытии поиска).
- `src/lib/tick.ts` — playTick("tap"|"step"|"press") + haptic-троттл 60 мс.
- `src/components/photo-viewer.tsx` — PhotoSwipe 5, «⋯» = `.pswp__button--actions`
  (стеклянная кнопка), меню — `.viewer-sheet` (v5-стекло).
- `src/app/layout.tsx` — viewport-мета + ios-viewport-nudge (серия 4 шт,
  отмена по касанию, без window.resize).

## Чек-лист перед коммитом стекла

- [ ] Ни одного `backdrop-blur-md/sm/lg/xl` в JSX вне ui/ и списка исключений
      (проверка: `rg "backdrop-blur-(md|sm|lg|xl)" src`).
- [ ] Панель/поиск/меню на токенах, а не новых rgba-константах.
- [ ] Обязательные E2E (fail-closed, `bash scripts/run-isolated.sh …`):
      `bun scripts/test-v31.mjs`,
      `bun scripts/test-mobile-nav-search.mjs` (включая dynamic lens A–J + haptics),
      `bun scripts/test-mobile-horizontal-nav.mjs`,
      `bun scripts/test-photo-viewer-mobile.mjs`,
      `bun scripts/test-p23-themes.mjs` (dark/light/landscape).
- [ ] Perf (при правках материала стекла):
      `bun scripts/audit-scroll-perf.mjs`, `bun scripts/perf-p23.mjs`
      (blur 40/32/24 + panel-drag; production-значение 40px НЕ менять без цифр).
- [ ] Контрольные кадры (супплемент J): `bun scripts/dbg-p23-shots.mjs`
      → tool-results/p23/ (01–09 + dynamic-liquid-lens.mp4).
- [ ] На реальном iPhone: холодный старт (полоса?), press-вспухание линзы,
      мост двух вкладок, вибро-отклик (press/step/commit), pinch→зум,
      палец по панели, панель→поиск→панель.
