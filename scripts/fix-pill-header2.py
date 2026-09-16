#!/usr/bin/env python3
"""v2.8 fix #2: добивание хвостов в portal.tsx (liquid state, LiveStatus, dragKey, itemRefs, is-liquid, sidebar onClick)."""
import sys

P = "/home/z/my-project/src/components/portal.tsx"
src = open(P, encoding="utf-8").read()
fails = []

def rep(old, new, label):
    global src
    if old not in src:
        fails.append(label)
        return
    src = src.replace(old, new)

# 1. Состояние liquid (A2-хвост)
rep('  /* «Жидкий» переезд линзы — 480 мс после смены активного пункта */\n  const [liquid, setLiquid] = useState(false);\n\n', '', 'liquid state')

# 2. Селектор склада в шапке (хвост B3)
rep('            <div className="mt-1 hidden lg:block">\n              <WarehouseSelect className="w-[102px] text-[9px]" />\n            </div>\n', '', 'header select')

# 3. LiveStatus: использование + функция (хвост B4)
rep('          <LiveStatus />\n', '', 'LiveStatus usage')
rep('''  function LiveStatus() {
    return (
      <div className="flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5">
        <span className="live-dot h-2 w-2 shrink-0 rounded-full bg-[color:var(--brand)]" />
        <WarehouseSelect className="w-[110px] border-0 bg-transparent text-[11px]" />
        <span className="h-3 w-px shrink-0 bg-border" />
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">склад онлайн</span>
      </div>
    );
  }
''', '', 'LiveStatus fn')

# 4. is-liquid в className капсулы (с запятой!)
rep(',\n            liquid && IS_CHROMIUM && "is-liquid"', '', 'is-liquid')

# 5. drag-подсветка пункта + ref-колбэк itemRefs
rep('            const on = view === key && !productId;\n            const drag = dragKey === key && !on;\n', '            const on = view === key && !productId;\n', 'drag line')
rep('cn("pill-item", on && "is-on", drag && "is-drag")', 'cn("pill-item", on && "is-on")', 'item cn')
rep('''                ref={(el) => {
                  if (el) itemRefs.current.set(key, el);
                  else itemRefs.current.delete(key);
                }}
''', '', 'item ref cb')

# 6. Сайдбар: кнопка «Поиск» — без передачи события в focusInput-параметр
rep('<button type="button" onClick={openSearch} className="side-link">', '<button type="button" onClick={() => openSearch()} className="side-link">', 'sidebar search btn')

open(P, "w", encoding="utf-8").write(src)
if fails:
    print("NOT FOUND: " + ", ".join(fails))
    sys.exit(1)
print("OK all anchors")
