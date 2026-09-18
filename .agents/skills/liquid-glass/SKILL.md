---
name: liquid-glass
description: Проектный стандарт Liquid Glass v5 (iOS 26) фото-каталога Askona — нижняя панель-пилюля, поиск, просмотрщик. Использовать при любой правке стекла: токены (--glass-blur/--glass-saturation/--pill-bg), слои панели, линза, морфы NAV↔SEARCH, стеклянные кнопки, safe-area. Запрещает hardcoded blur в JSX и вторые линзы.
---

# Liquid Glass v5 (проект Askona)

Единый стеклянный язык интерфейса: нижняя панель-пилюля, подвесной поиск,
чипы, кнопки viewer'а. Референс — iOS 26 Liquid Glass.

## Токены (только они, никаких новых констант)

| Токен | Значение | Смысл |
|---|---|---|
| `--glass-blur` | `40px` | радиус размытия ЛЮБОГО стекла |
| `--glass-saturation` | `2.0` | насыщенность стекла |
| `--pill-bg` | dark `rgba(50,48,44,.28)` / light `rgba(255,255,255,.38)` | фон панели |
| `--glass` / `--glass-strong` | общий фон стекла / дропдаунов |
| `--glass-spec` / `--glass-spec-strong` | спекуляр-блики (inset 0 1px 0) |
| `--glass-shadow` | внешняя тень стекла |
| `--sab` / `--sat` | safe-area bottom/top (env(), читается один раз) |
| `--z-nav 40 / --z-fab 45 / --z-pop 50 / --z-photo-viewer 10000 / --z-photo-viewer-ui 100000` | слои |

## Железные правила

1. **JSX: никакого hardcoded blur.** Только `backdrop-blur-[var(--glass-blur)]`.
   Хардкоды разрешены ТОЛЬКО в globals.css (осознанные исключения задокументированы).
2. **Одна линза.** В панели ровно один `.pill-bubble` на rAF-пружине
   (k=150/d=23) с «тянучкой» `scaleX = 1 + min(|v|·0.0009, 0.12)`.
   Вторые/догоняющие линзы ЗАПРЕЩЕНЫ (призрак удаляли — пользователь попросил сам).
3. **Preview ≠ commit.** Линза следует за реальным `clientX` непрерывно;
   `nearestItem` — только на pointerup (Phase 2.1).
4. **Морф NAV↔SEARCH — горизонтальный shared:** панель сжимается в кнопку
   поиска (`scale(0.42,0.85)`, origin `calc(100% - 45px) 50%`), карточка
   растёт каплей из той же точки (`scale(0.14,0.86)`, origin
   `calc(100% - 33px) 50%`, radius 999→22). 260 мс, кривая
   `cubic-bezier(0.22,0.61,0.36,1)`, оба слоя. Не переводить в вертикальный.
5. **Pinch в viewer — только зум.** Закрытие: вертикальный drag при 1x или ×.
6. **iOS-стекло при холодном старте** иногда рисует слой с неверной
   геометрией («пустая полоса под панелью» до первого касания). Защита:
   `transform: translateZ(0)` на `.pill-shell` + серия нуджей
   (layout.tsx до гидратации: 120…7600 мс; boot-splash для standalone PWA).
   Не удалять и не укорачивать серии.
7. **touch-action: none** на `.pill-shell` — pointer-поток линзы не должен
   уходить в скролл. `viewport-fit: cover` + `interactive-widget: resizes-content`
   в viewport-экспорте layout.tsx — не трогать.

## Слои панели (снизу вверх)

`GLASS SHELL (.pill-shell)` → `CAUSTICS (.pill-caustic)` →
`LIQUID LENS (.pill-goo > .pill-bubble, SVG #pill-goo)` →
`RIM (.pill-rim)` → `ICONS+LABELS (.pill-controls, z-4)`.
Кнопки ВСЕГДА выше линзы. Панель никогда не двигается сама
(только morph-классы `pill-morph-out`/`pill-hidden`/`kb-open`).

## Карта файлов

- `src/app/globals.css` — все токены и стекло (секции PILL NAV, search-pop, pswp).
- `src/components/portal.tsx` — пружина линзы, gesture панели, морф-классы.
- `src/components/photo-viewer.tsx` — PhotoSwipe 5, «⋯» = `.pswp__button--actions`
  (стеклянная кнопка), меню — `.viewer-sheet` (v5-стекло).
- `src/app/layout.tsx` — viewport-мета + ios-viewport-nudge (фикс «полосы»).

## Чек-лист перед коммитом стекла

- [ ] Ни одного `backdrop-blur-md/sm/lg/xl` в JSX вне ui/ (проверка: `rg "backdrop-blur-(md|sm|lg|xl)" src`).
- [ ] Панель/поиск/меню на токенах, а не новых rgba-константах.
- [ ] `bash scripts/run-isolated.sh bun scripts/test-pill.mjs` и
      `scripts/test-mobile-nav-search.mjs` — PASS.
- [ ] На реальном iPhone: холодный старт (полоса?), pinch→зум, палец по панели,
      панель→поиск→панель.
