#!/usr/bin/env python3
"""v2.8: удаление линзы/драга из пилюли (п.5), чистка шапки (п.6-8), поиск без autofocus (п.9)."""
import re, sys

P = "/home/z/my-project/src/components/portal.tsx"
src = open(P, encoding="utf-8").read()
orig = src

def cut(start_anchor, end_anchor, replacement, must=True):
    """Replace text from start_anchor to end_anchor (inclusive) with replacement."""
    global src
    i = src.find(start_anchor)
    if i < 0:
        if must:
            sys.exit(f"START anchor not found: {start_anchor[:60]!r}")
        return
    j = src.find(end_anchor, i)
    if j < 0:
        sys.exit(f"END anchor not found after {start_anchor[:40]!r}: {end_anchor[:60]!r}")
    j += len(end_anchor)
    src = src[:i] + replacement + src[j:]

# ── A1: вся линза/драг-механика (refs, springs, placeLens…onShellPointerDown) ──
a1_start = '  /* ── Пилюля: Liquid Glass v3 — «жидкая» линза, как в iOS 26 ──────────────'
a1_end = '    window.addEventListener("pointercancel", onEnd);\n  };\n'
cut(a1_start, a1_end, '''  /* ── Пилюля (п.5 ТЗ): БЕЗ плавающей линзы и drag-механики ──────────────
     Панель максимально стабильная: иконки не двигаются, геометрия капсулы
     неизменна при смене вкладок, активный пункт подсвечивается СТАТИЧНЫМ
     стеклом (.pill-item.is-on — цвет/прозрачность, без перемещений).
     Хаптика: нативный switch (.pill-haptic) в каждом пункте играет системный
     тик на iOS при прямом тапе; Android вибрирует через navigator.vibrate. */
  const shellRef = useRef<HTMLDivElement | null>(null);
''')

# ── A2: состояние liquid ──
cut('  /* «Жидкий» переезд линзы — 480 мс после смены активного пункта */\n  const [liquid, setLiquid] = useState(false);\n\n', '', '', must=False)

# ── A3: эффект «жидкого переезда» ──
a3_start = '  // Жидкий эффект: запуск на смену активного пункта пилюли + переезд/схлопывание линзы\n'
a3_end = '  }, [activeKey, productId, view]);\n\n'
cut(a3_start, a3_end, '')

# ── A4: syncLensInstant + useLayoutEffect ──
a4_start = '  // Геометрия пилюли: первичное размещение линзы (без анимации) + повороты/ресайз\n'
a4_end = '    return () => window.removeEventListener("resize", syncLensInstant);\n  }, []);\n\n'
cut(a4_start, a4_end, '')

# ── A5: rAF-анимация SVG-фильтра ──
a5_start = '  // rAF-анимация SVG-фильтра (feTurbulence/feDisplacementMap) за 480 мс — только Chromium\n'
a5_end = '    return () => cancelAnimationFrame(raf);\n  }, [liquid]);\n\n'
cut(a5_start, a5_end, '')

# ── A6: SVG-фильтр в JSX ──
a6_start = '      {/* SVG-фильтр жидкой ряби для пилюли (анимируется по rAF, только Chromium) */}\n'
a6_end = '      </svg>\n\n'
cut(a6_start, a6_end, '')

# ── B1: openSearch без autofocus при тапе (п.9) ──
cut('  const openSearch = () => {\n', '      window.setTimeout(focusVisibleSearchInput, 120);\n    }\n  };\n',
'''  /* П.9 ТЗ: тап по кнопке поиска НЕ ставит фокус — клавиатура не вскакивает,
     viewport не прыгает. Пользователь сам тапает по полю → нативный focus →
     клавиатура. Фокус остаётся ТОЛЬКО у программного открытия по «/» (десктоп). */
  const openSearch = (focusInput = false) => {
    const s = usePortal.getState();
    playTick(); // звук + хаптика (движок)
    if (s.productId) dismissProduct();
    if (s.view !== "catalog" && s.view !== "stock") s.setView("catalog");
    /* ТЕХНИКА «ПРЕДСМОНТИРОВАННАЯ КАРТОЧКА» (flushSync запрещён — он рвал
       AnimatePresence): карточка в DOM всегда, скрыта visibility:hidden.
       Открытие: класс is-open СИНХРОННО — видна в этом же кадре. */
    document.querySelector(".search-pop")?.classList.add("is-open");
    setSearchFabOpen(true);
    if (focusInput && !focusVisibleSearchInput()) {
      // страховка для программного открытия («/») при редких гонках
      window.setTimeout(focusVisibleSearchInput, 120);
    }
  };
''')

# ── B2: путь «/» — с фокусом (десктоп) ──
src = src.replace('    const open = () => openSearch();', '    const open = () => openSearch(true); /* «/» — сразу к вводу (десктоп) */')

# ── B3: шапка — убрать второй логотип и селектор склада (п.6/7) ──
src = src.replace('''          <button
            type="button"
            onClick={() => goCatalog(usePortal.getState().productId != null ? null : undefined)}
            aria-label="На главную — Каталог фото"
            className="header-fade hidden shrink-0 lg:block"
          >
            <img
              src="/logo-askona.png"
              alt="Askona"
              className="h-6 w-auto max-w-[64px] object-contain sm:h-7 sm:max-w-[80px]"
              draggable={false}
            />
          </button>
''', '''          {/* П.6 ТЗ: второй логотип Askona в шапке УДАЛЁН — один основной
              остался в сайдбаре. П.7: селектор «Обухово» из шапки убран. */}
''')
cut('            <div className="mt-1 hidden lg:block">\n              <WarehouseSelect className="w-[102px] text-[9px]" />\n            </div>\n', '', '')

# ── B4: сайдбар — убрать LiveStatus («склад онлайн») ──
cut('          <LiveStatus />\n', '', '')
cut('''  function LiveStatus() {
    return (
      <div className="flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5">
        <span className="live-dot h-2 w-2 shrink-0 rounded-full bg-[color:var(--brand)]" />
        <WarehouseSelect className="w-[110px] border-0 bg-transparent text-[11px]" />
        <span className="h-3 w-px shrink-0 bg-border" />
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">склад онлайн</span>
      </div>
    );
  }
''', '', '')

# ── B5: JSX пилюли — снять линзу, is-liquid, onPointerDown, suppressClick ──
src = src.replace('''          {/* Линза-«жидкость»: тянется за пальцем (x/width через motion-пружины) */}
          <motion.span
            className={cn("nav-lens", dragKey && "is-drag", liquid && "is-squash")}
            style={{ x: lensX, width: lensW }}
            aria-hidden="true"
          >
            <span className="nav-lens-core" />
          </motion.span>
''', '''          {/* П.5 ТЗ: линза-«жидкость» УДАЛЕНА — активный пункт подсвечивает
              статичное стекло .pill-item.is-on, ничего не перемещается */}
''')
src = src.replace('''            liquid && IS_CHROMIUM && "is-liquid"\n''', '')
src = src.replace('          onPointerDown={onShellPointerDown}\n', '')
src = src.replace('''                onClick={(e) => {
                  if (suppressClickRef.current) return; // активация уже сделана в pointerup
                  if (key === "catalog") goCatalog(e.currentTarget, true);''',
'''                onClick={(e) => {
                  if (key === "catalog") goCatalog(e.currentTarget, true);''')

# ── B6: комментарий над пилюлей ──
src = src.replace('''      {/* Нижняя навигация — плавающая «пилюля» (Liquid Glass v6, iOS 18).
          Настоящее преломление: Canvas-карта смещений + feDisplacementMap
          с хроматической аберрацией (Chromium; Safari — чистый blur-fallback).
          Линза-«жидкость» ИДЁТ за пальцем (без растягивания), магнитно
          увеличивает пункт под пальцем и пружиной собирается при отпускании.
          Нативные switch (.pill-haptic) дают системную хаптику на iOS.
          Реакция: листают — стекло растворяется (pill-dim); коснулись —
          плотное активное стекло (pill-active) до тапа мимо. */}''',
'''      {/* Нижняя навигация — плавающая «пилюля» (Liquid Glass v6, iOS 18).
          П.5 ТЗ: никаких движущихся элементов — линза удалена; активный
          пункт = статичная стеклянная подложка (.is-on), геометрия панели
          неизменна. Нативные switch (.pill-haptic) дают хаптику на iOS.
          Реакция: листают — стекло растворяется (pill-dim); коснулись —
          плотное активное стекло (pill-active) до тапа мимо. */}''')

open(P, "w", encoding="utf-8").write(src)
print(f"OK: {len(orig)} → {len(src)} bytes")
