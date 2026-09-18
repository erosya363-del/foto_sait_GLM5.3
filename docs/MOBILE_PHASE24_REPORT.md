# MOBILE PHASE 2.4 — Liquid Nav Refinement · Page Swipe Fix · Glass Toasts · Upload Sheet

Дата: 2026-09-18
START_HEAD: `b1ad9e1`
FINAL_HEAD: см. коммит этого отчёта (docs), код — коммиты ниже в §0.

---

## 0. Состав работ (одной строкой на файл)

| Файл | Что сделано |
|---|---|
| `src/lib/tick.ts` | press-хаптик усилен 16→18 мс @ intensity 0.9; step 16 @ 0.7; tap 22 @ 1.0; `haptic(ms, intensity)`; `styleStealthSwitch()` — switch web-haptics больше не `display:none` |
| `src/components/portal.tsx` | direct tracking при drag (τ≈33 мс); dragModePillRef; release на «Загрузке» = action (sheet), не commit; swipe-коммит `fill:"forwards"` + очистка в `useLayoutEffect` (фикс повторного появления); uploadOpen-гейты свайпа; Escape→upload-close; coexistence-эффект (sheet закрывает поиск + отменяет жест); VIEW_ORDER без upload; sidebar/pill «Загрузка» → sheet |
| `src/app/globals.css` | тёмная линза без ореола (заливка 0.03–0.20, top-edge 0.32, rim 0.12, спекуляр rest .30/press .60/bridge .72); sheen .90→.55; каустики .34→.22; rim .5→.38; covered-подсветка цветом; `--z-sheet`, `--sheet-bg/--sheet-footer-bg`; секция GLASS TOASTS (материал + позиционирование) |
| `src/lib/store.ts` | `uploadOpen` + `setUploadOpen`; restore: легаси `view:"upload"` → `"catalog"` |
| `src/components/upload-sheet.tsx` | НОВЫЙ: glass sheet (mobile bottom sheet / desktop dialog), шаги 1-2-3, dirty/abort guards, kb-overlay, resetDraft; вся логика движка перенесена из upload-view без изменений |
| `src/components/upload-view.tsx` | УДАЛЁН (переехал в upload-sheet) |
| `src/app/layout.tsx` | два Toaster: `.toaster-m` bottom-center (мобайл) + `.toaster-d` top-center (десктоп); `richColors` УДАЛЕНЫ |
| `src/lib/native-bridge.ts` | нативный таб «upload» → `setUploadOpen(true)` (committed view не меняется) |
| Тесты/скрипты | `test-mobile-nav-search` (+секции 16/17, upload-секции переписаны под sheet, 106 ассертов), `test-mobile-horizontal-nav` (детектор повторного появления + sheet-кейсы, 125), `test-v31` (nth(3) вместо upload-view), `audit-full` (PASS H через sheet, upload-строки в PASS B/E пропущены), `stabilize-viewport-audit` (sheet закрывается), `perf-p23` (release не на sheet), `dbg-p24-shots` (12 кадров + mp4), `dbg-p24-sheetclose/dbg-p24-desktop/dbg-p24-reopen` (отладочные) |

---

## SECTION 1 — LIQUID NAV REFINEMENT

### 1.1 Что было не так

- **Лаг линзы (A).** Позиция линзы ВСЕГДА шла пружиной k=150/d=23. Её период
  ≈0.5 c: при drag по панели цель обновлялся каждый кадр, но рендер отставал
  от пальца на десятки пикселей и «догонял» — то самое ощущение «медленного
  хвоста».
- **Мост не «доезжал» (B).** Ширина тоже шла пружиной k=170/d=25 (~0.3 c):
  при быстром проводе стеклянная масса визуально не успевала накрыть обе
  вкладки.
- **Вторая вкладка не реагировала (C).** `is-lens-covered` на второй вкладке
  сжимал контент, но цвет не менялся — вкладка не читалась «накрытой».
- **Вибрация пропала (D).** Причина найдена: с Phase 2.3 быстрый тап по
  панели даёт ТОЛЬКО press-тик, а он был 16 мс — на нижней границе
  осязаемости (click-тик 22 мс схлопывается троттлом 60 мс). Сеть
  web-haptics на iOS при этом эмулирует паттерн скрытым switch'ом, который
  пакет прячет через `display:none` — на новых iOS тактильный отклик от
  невидимого контрола может блокироваться. Оба фактора вместе дали
  «вибрации нет».
- **Дешёвые блики (E).** Тёмная линза v5: белый radial 0.55 сверху + ring
  0.30 + screen-спекуляр до суммарной 0.43+; sheen поверхности 0.90,
  каустики 0.34, rim 0.5 — на тёмном фоне и поверх фото складывалось в
  «ореол/грязный свет».
- **Release терял стеклянность (F).** После release press-спекуляр гас
  (базовая opacity ::after была 0.10), и линза читалась плоской заливкой —
  «selected-pill», не стекло.
- **Резкость/плавание (G).** Источник — те же пружинные лаги: линза то
  отставала, то догоняла рывком; плюс при release пружина стартовала почти
  с нулевой скорости после медленного хвоста.

### 1.2 Что изменено

**Скорость (1.1) — DIRECT TRACKING.** В rAF-контроллере появился режим
`a.dragging` (переключается `dragModePillRef` на входе в drag и на
release/cancel/внешней отмене). В режиме drag позиция и ширина идут
экспоненциальным сглаживанием за пальцем:

- позиция: `x += (target − x) · (1 − e^(−dt·30))` — τ≈33 мс, визуально
  «привязана к пальцу»;
- ширина: τ≈38 мс — масса стекла поспевает за мостом;
- velocity считается по ФАКТИЧЕСКОМУ смещению кадра — «тянучка» scaleX
  работает от реальной скорости, без разрыва.

Пружины (k=150/170/220) НЕ удалены: на release/cancel/тап-полёте пружина
подхватывает с текущих x/velocity — упругая физика проявляется на settle,
а не как постоянный тормоз (точно по ТЗ «glass motion, но быстрее»).

**Мост (1.2).** Геометрия TWO-PHASE EDGE STRETCH сохранена (ведущая кромка
easeOutCubic до t=0.5, задняя догоняет после; подушка 6·sin(πt)); с быстрым
width-трекингом масса реально накрывает ОБЕ вкладки на всём сегменте —
подтверждено ассертами E/F (bLeft < center₁ && bRight > center₂) и кадром
`03-dark-bridge.png`.

**Covered tabs (1.3).** Механизм без изменений (центры внутри целевой
массы, `is-on` не трогается до release) + добавлена ПОДСВЕТКА:
`.pill-item.is-lens-covered { color: var(--foreground) }` — вторая вкладка
в мосте теперь и уменьшается, и подсвечивается (на кадре 03 обе подписи
белые, committed — бренд).

**Content press (1.4).** scale .92 СОХРАНЁН (рабочий коридор 0.90–0.95,
середина; ассерты C проходят: scale<0.96 при живой hit-area 44px).

**Dark/photo glass (1.5).** Тёмная линза переписана:
- заливка: radial 0.20 + linear 0.12/0.06/0.03 (было 0.55/0.22/0.10/0.05);
- кромки: crisp top-edge 0.32, тонкий rim 1px 0.12, глубина низа 0.07;
- ВНЕШНИЙ box-shadow ОТСУТСТВУЕТ — нечему создавать ореол;
- press-спекуляр `::after`: белый 0.60→0.40, но базовая opacity
  0.10→0.30 → rest 0.30 / press 0.60 / bridge-центр 0.72 (коридор §H);
- фон панели: sheen 0.90→0.55, каустики 0.34→0.22, rim 0.5→0.38.
Светлая тема НЕ тронута (там кромка/глубина и так работают).

**Release glass state (1.6).** Базовый rest-спекуляр 0.30 + crisp кромка
означают: REST AFTER COMMIT = компактная стеклянная линза с живым бликом,
а не плоский selected-fill. Кадры 01 vs 04: материал идентичен press-кадру
02, отличается только геометрия.

**Haptics (1.7).** Маршрут press→step→commit сохранён; отклик усилен:
- press: 16→18 мс @ intensity 0.9 (одиночный тап = ОДИН ощутимый тик —
  троттл 60 мс схлопывает press+click; это осознанный одиночный отклик,
  а НЕ баг двойной вибрации);
- step: 16 @ 0.7, commit-tap: 22 @ 1.0 (через >60 мс после press —
  ощущается как нормальная тактильная последовательность down→commit);
- `haptic(ms, intensity)` проводит интенсивность в движок (switch-эмуляция
  iOS играет тише/громче);
- `styleStealthSwitch()`: switch web-haptics держится «видимым для
  композитора» (1×1px, opacity 0.01, aria-hidden, pointer-events none) —
  РАБОЧИЙ ПРИЁМ (workaround) против возможной блокировки haptic у
  `display:none`-контролов на новых iOS; причина на реальном устройстве
  НЕ доказана — требуется подтверждение владельцем (§6.6-стиль).
  navigator.vibrate на Android не затронут.

**Плавность (1.8).** Убран главный источник «резко/догоняет» (пружинный
лаг в drag). Стык REST→PRESS→BRIDGE→SETTLE бесшовный: press-пружина и
bridge-фактор работают одинаково в обоих режимах, settle наследует
x/velocity от tracking-режима. Скачков геометрии нет (J: rapid ×10 без
залипаний, I: pointercancel — полный возврат).

---

## SECTION 2 — PAGE SWIPE FIX

**Причина дёргания/повторного появления.** В commit-ветке свайпа `done()`
(вызывается из WAAPI `onfinish`) сбрасывал inline `transform` контента ДО
React-коммита смены view. Между WAAPI-finish и коммитом (микротаск React)
старый раздел оставался смонтированным уже БЕЗ смещения → 1–3 кадра
вспышки «старого экрана», затем мгновенный вход нового — визуально
«сначала перетащили, потом ещё раз анимация включилась». Дополнительно
neighbor-оверлей без fill по завершении анимации отскакивал к inline
transform (за экран) — тот же кадр-разрыв.

**Исправление.**
1. Обе анимации коммита (контент → за экран, neighbor → 0) играются с
   `fill: "forwards"` — финальные кадры ДЕРЖАТСЯ, старый view остаётся за
   экраном, neighbor — на месте до самого коммита.
2. `done()` больше не трогает transform: только `setView` + `setSwipe(null)`
   (один batched-рендер: overlay снят, exit.instant/enter.instant).
3. Очистку делает `useLayoutEffect([view, productId])` через
   `swipeClearRef`: cancel() анимаций + сброс inline transform — синхронно
   ДО paint того же кадра, в котором новый view уже на месте. Один
   атомарный paint, ноль кадров с «возвратом».

**Регресс-защита.** В `test-mobile-horizontal-nav` добавлен rAF-сэмплер
(1400 мс вокруг release): ловит кадры с «пустой transform + старый view» и
«пустой экран до коммита» — на всех 5 вьюпортах 0 образцов; «после коммита
вид стабилен (без второго входа)» — PASS. Cancel-ветка не меннялась
(там очистка в onfinish до paint — вспышки не было).

---

## SECTION 3 — TOASTS

- **Где раньше:** один `Toaster position="top-center" richColors` — на
  телефоне уведомления падали сверху (риск под чёлку/системную зону) и
  красились solid-заливками sonner (ярко-зелёный success — скрин владельца).
- **Где теперь:** mobile (<1024px) — BOTTOM-CENTER НАД пилюлей
  (`.toaster-m`); desktop (≥1024px) — top-center (`.toaster-d`). Реализовано
  двумя экземплярами Toaster (позиция sonner статична), лишний скрыт
  `display:none` — дублей на экране нет (ассерт 17).
- **Mobile positioning (3.2):** `--offset-bottom/--mobile-offset-bottom =
  calc(max(10px, var(--sab)) + 76px + var(--kb-overlay, 0px)) !important`
  — низ панели (max(10,--sab)) + высота 64px + зазор 12px; при открытой
  клавиатуре тост поднимается на фактическое overlay-перекрытие
  (iOS>0, Android resizes-content≈0 — двойного учёта нет, урок v4 п.20).
  Ассерт: `toast.bottom ≤ pill.top + 2`.
- **Safe-area (3.4):** desktop top учитывает `--sat`; home indicator не
  задет (тост выше панели), Dynamic Island не затронут (тосты снизу).
- **Glass style (3.3):** `richColors` УДАЛЕНЫ. Все тосты: bg
  `var(--glass-strong)` + `backdrop-filter: blur(var(--glass-blur))
  saturate(var(--glass-saturation))`, border `var(--border)`, radius 18px,
  `--shadow-pop`. Статус — ТОЛЬКО акцент иконки + hairline-кольцо границы:
  success `#34d399`, warning `#fbbf24`, error `#fb7185`, info — бренд.
  Никаких сплошных заливок (ассерт «НЕ solid-зелёный» + blur≠none).
- **Content (3.5):** title + description (например «3 фото загружено» /
  «1 не принято — остались в списке для повтора»), duration 9000 мс у
  warning-очереди отказов. Z-index sonner (максимальный) — тост НЕ прячется
  под upload sheet и photo viewer (§5).
- Sheet открыт → тост показывается ПОВЕРХ него (кадр `10-toast-over-nav.png`).

---

## SECTION 4 — UPLOAD SHEET

- **Из view в sheet (4.0/4.2):** `view:"upload"` выведен из ротации:
  `VIEW_ORDER = ["catalog","stock","admin"]`; `NAV`-слот «Загрузка» —
  ACTION: тап/драг-release открывает `store.uploadOpen` (committed view
  не меняется, линза собирается обратно к активной вкладке — ассерты 9e и
  горизонтального свайпа). Легаси `view:"upload"` из истории/sessionStorage
  мигрирует в `"catalog"` (restore + popstate). Заголовок «Загрузка» из
  шапки исчез (раздела больше нет). Сайдбар и нативный таб-бар iOS
  открывают тот же sheet. Upload исключён из page swipe и enter/exit
  переходов.
- **Логика движка сохранена (4.1):** файл `upload-view.tsx` →
  `upload-sheet.tsx` с переносом БЕЗ изменений: валидация типа/размера,
  лимит 10×25 МБ, превью с кэшем object URL (F-004), последовательная
  загрузка с честным N/M и фазами send/proc, partial success (успешные
  убираются, НЕудачные остаются), beforeunload guard, XHR-прогресс,
  `/api/upload` integration (E2E: 2 реальных фото → 2xx → экран успеха).
- **Navigation UX (4.3):** выбран вариант A — существующий слот открывает
  sheet; линза кратко реагирует (press/bridge как на обычной вкладке), но
  committed view остаётся прежним под sheet.
- **Mobile sheet (4.4):** bottom sheet — spring снизу (stiffness 380,
  damping 40 ≈ 280 мс), dimmed backdrop, handle (drag только от handle —
  скролл контента не конфликтует), glass v5 (`--sheet-bg` +
  blur(var(--glass-blur)) saturate(var(--glass-saturation))), rounded-t-28.
  Desktop: центрированная glass-карточка max-w-lg, fade+scale 240 мс.
- **Keyboard (4.5):** sheet стоит на `bottom: var(--kb-overlay)` (фактическое
  перекрытие: iOS>0, Android≈0) с плавным переходом 220 мс; max-height =
  `calc(100dvh − max(18px,--sat) − --kb-overlay − 10px)`; скроллится ТОЛЬКО
  внутренний контент (`overscroll-contain`); шапка/handle якорятся; CTA —
  sticky-футер внутри скролла с blur-подложкой. НИКАКИХ трансформов всего
  окна (урок search-pop учтён: overlay считается один раз). Ассерты 16c:
  низ sheet = 300px при --kb-overlay=300, верх ≥ 0.
- **Form structure (4.6):** пошагово: 1) Категория+Модель (обязательные),
  2) Доп. параметры — УСЛОВНЫЙ блок (материал/размер — если есть
  справочники, признаки — зависят от категории, комментарий всегда),
  3) Файлы + отправка; точки прогресса в шапке. Жёстких одинаковых ступеней
  нет — у категории без признаков блока просто не будет.
- **Dirty/close guard (4.7):** чистое состояние закрывается мгновенно
  (backdrop/handle/X/Escape); есть введённое/файлы → inline
  discard-confirm («Остаться»/«Закрыть», без window.confirm); во время
  отправки закрытие backdrop'ом запрещено — отдельный cancel flow:
  «Прервать загрузку?» → abort текущего XHR + остановка очереди
  (abortRef) → toast «Загрузка прервана» → sheet закрывается. BONUS-фикс из
  E2E: `doClose` полностью сбрасывает черновик (`resetDraft`) — компонент
  смонтирован всегда, без сброса reopen показывал прошлый шаг и выбор.
- **Success flow (4.8):** success-экран ВНУТРИ sheet + CTA «Показать в
  каталоге» (закрывает sheet, открывает товар) / «Повторить не принятые» /
  «Загрузить ещё» (очередь отказов сохранена) / «Закрыть»; glass toast —
  дополнительный feedback. Решение осознанное: sheet не закрывается сам.
- **Coexistence (§5):** открытие sheet закрывает поиск и отменяет жест
  панели (эффект [uploadOpen]); page swipe заблокирован гейтом
  `uploadOpen` в обоих местах (touchstart + активация); панель под
  backdrop'ом недоступна; search и upload одновременно не открыть.

---

## SECTION 5 — TESTS

| Проверка | Результат |
|---|---|
| typecheck (`tsc --noEmit`) | PASS (0 ошибок) |
| lint (`eslint .`) | PASS (0 ошибок, 0 предупреждений) |
| build (production standalone) | PASS |
| `test-mobile-nav-search.mjs` | **106/0** (включая P23 A–J dynamic lens, haptics-маршрут, НОВЫЕ 16: sheet guards/dirty/keyboard, 17: glass toasts) |
| `test-mobile-horizontal-nav.mjs` | **125/0** (5 вьюпортов; НОВОЕ: rAF-детектор «нет кадра повторного появления / пустого экрана / вид стабилен»; sheet-кейсы) |
| `test-p23-themes.mjs` | **33/0** (dark/light/landscape × REST/PRESS/BRIDGE/RELEASE/SEARCH) |
| `test-v31.mjs` | **22/0** (секции 1–5) |
| `test-photo-viewer-mobile.mjs` | **49/0** (регресс не задет) |
| `test-s4.mjs` / `test-s5.mjs` | **34/0** / **40/0** (runtime-регресс; upload API через sheet-флоу в аудите) |
| `audit-full.mjs --quick` | **0 находок** (PASS H: upload 2 фото через sheet: шаги → превью 2/10 → POST 2xx → экран успеха) |
| `stabilize-viewport-audit.mjs` | **0 проблем** (60 комбинаций) |
| Perf `perf-p23.mjs` (CPU ×6) | скролл: gaps32 9/8/11, longTasks 0 — в шуме; panel-drag: gaps32 28/27/28 (база 2.3: 32/29/31 — не хуже), longTotal ≈1.6 c (база 1.2–2.1 c); зависимости от blur НЕТ → `--glass-blur: 40px` оставлен |
| Кадры/видео | `tool-results/p24/`: 01–04 тёмная линза (REST/PRESS/BRIDGE/RELEASE), 05–06 поверх контента, 07–09 sheet (шаг 1 / шаг 3+CTA / discard), 10–11 glass toast (над sheet / над каталогом), 12 sheet при клавиатуре, p24-session.mp4 |

**NOT TESTED / REAL IPHONE REQUIRED (честно):**
- Вибрация на реальном устройстве НЕ проверена (headless — только счётчик
  navigator.vibrate-вызовов; iOS switch-эмуляция и stealth-switch-фикс
  требуют живого iPhone 17.4+/26+).
- Скорость следования линзы «как в iOS tab bar» — субъективная оценка
  владельцем (headless-числа: τ≈33 мс — в 15 раз быстрее прежнего периода
  пружины).
- Отсутствие ореола на РЕАЛЬНЫХ фото-карточках в тёмной теме — сверить
  кадры 05/06 на устройстве.
- Холодный старт PWA («полоса») — защиты 2.3 не тронуты, но проверить.
- Клавиатура в upload sheet на реальном iOS (visualViewport overlay) —
  headless-симуляция --kb-overlay.

---

## SECTION 6 — OPEN ISSUES

1. **iOS-хаптика — workaround.** Stealth-switch (не display:none) —
   гипотеза уровня «видимость для композитора»; подтверждение только на
   реальном устройстве. Если не сработает — следующий шаг: свой аудио+вибро
   профиль через native bridge (оболочка AskonaApp).
2. **Тосты поверх upload sheet** намеренно видны (Z выше) — если владельцу
   захочется сдвигать тост выше шапки sheet при открытом сценарии, это
   одна CSS-строка (учёт max(sheet top) в --offset-bottom).
3. **`select.field` на iOS** — системный пикер; внутри sheet выглядит
   нативно, кастомный glass-пикер не делался (вне объёма).
4. **Abort при обработке файла на сервере:** клиент abort'ится мгновенно,
   но если сервер уже начал обработку — фото может доехать (partial
   semantics как раньше; заявлено в confirm-тексте «уже загруженные
   сохранятся»).
5. **Desktop-диалог sheet** не ловит focus-trap (Escape/backdrop/крестик
   есть; tab-цикл не ограничен) — внутренний инструмент, приоритет низкий.
6. **Реальный iPhone** — весь чек-лист §5 NOT TESTED выше; после redeploy
   снять видео: палец по панели (скорость), мост, вибро-последовательность,
   свайп страниц, sheet+клавиатура, тосты.

---

## Приёмка по ТЗ §7 (кратко)

1. линза следует быстрее — PASS (direct tracking τ≈33 мс; D-ассерты)
2. press заметен — PASS (B-ассерты + кадр 02)
3. bridge накрывает обе — PASS (E/F-ассерты + кадр 03)
4. обе covered tabs уменьшаются — PASS (scale .92, ассерты C/E) + подсветка
5. в dark нет дешёвой подсветки/ореола — PASS (кадры 01–04; внешний glow убран)
6. на фото нет грязного свечения — PASS headless (кадры 05–06; финал — на устройстве)
7. after release остаётся стеклянная compact lens — PASS (кадр 04, rest-спекуляр 0.30)
8. есть вибрация/тактильность — PARTIAL (маршрут усилен и покрыт ассертами вызовов; REAL DEVICE NOT TESTED)
9. без резких скачков — PASS (rapid ×10, pointercancel, velocity из фактического смещения)
10–11. свайп без второго появления / один жест — PASS (rAF-детектор, 5 вьюпортов)
12–16. тосты glass, не зелёный solid, bottom-center above pill, safe-area, без конфликта с Dynamic Island/home indicator — PASS (ассерты 17 + кадры 10–11)
17–21. upload не view, sheet/dialog, view не сбрасывается, keyboard не ломает sheet, partial success работает — PASS (16a–d, audit-full PASS H, s5)
