"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence, animate, useMotionValue } from "framer-motion";
import { ArrowLeft, ArrowUp, Boxes, Images, Search, UploadCloud, ShieldCheck } from "lucide-react";
import {
  usePortal, snapshot, dismissProduct, isPushSuppressed,
  type View, type Warehouse, type PortalSnapshot,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { playTick, playStep, vibrateSupported } from "@/lib/tick";
import { ThemeSwitch } from "@/components/theme-switch";
import { BootSplash } from "@/components/boot-splash";
import { SearchBar } from "@/components/search-bar";
import { StockView } from "@/components/stock-view";
import { CatalogView } from "@/components/catalog-view";
import { ProductView } from "@/components/product-view";
import { UploadView } from "@/components/upload-view";
import { AdminView } from "@/components/admin-view";
import { PhotoViewer } from "@/components/photo-viewer";

const NAV: Array<{ key: View; label: string; short: string; Icon: typeof Boxes }> = [
  { key: "catalog", label: "Каталог фото", short: "Каталог", Icon: Images },
  { key: "stock", label: "Остатки", short: "Остатки", Icon: Boxes },
  { key: "upload", label: "Загрузка", short: "Загрузка", Icon: UploadCloud },
  { key: "admin", label: "Админ", short: "Админ", Icon: ShieldCheck },
];

/* «Жидкий» глитч-рябь (feTurbulence + feDisplacementMap) — только Chromium;
   в остальных браузерах — плавный сквош линзы без фильтра. */
const IS_CHROMIUM =
  typeof navigator !== "undefined" &&
  /Chrom(e|ium)|Edg\/|OPR\/|SamsungBrowser/.test(navigator.userAgent);

const WAREHOUSES: Warehouse[] = ["Обухово", "Владимир"];

/** Селектор склада — фиксированная ширина, чтобы шапка не прыгала при смене */
function WarehouseSelect({ className }: { className?: string }) {
  const warehouse = usePortal((s) => s.warehouse);
  const setWarehouse = usePortal((s) => s.setWarehouse);
  return (
    <select
      value={warehouse}
      onChange={(e) => setWarehouse(e.target.value as Warehouse)}
      aria-label="Склад"
      className={cn(
        "cursor-pointer appearance-none rounded-full border border-border bg-secondary/80 px-2.5 py-1 text-left font-semibold uppercase tracking-[0.14em] text-muted-foreground shadow-[inset_0_1px_0_var(--glass-spec)] backdrop-blur-md outline-none transition-colors hover:border-[var(--border-strong)] hover:text-foreground active:scale-95",
        className
      )}
    >
      {WAREHOUSES.map((w) => (
        <option key={w} value={w}>
          {w}
        </option>
      ))}
    </select>
  );
}

/** Заголовок текущего экрана — только раздел, ничего лишнего (просьба пользователя) */
function useHeaderTitle() {
  const view = usePortal((s) => s.view);
  const productId = usePortal((s) => s.productId);
  if (productId) return "Фото товара";
  if (view === "stock") return "Askona Остатки";
  if (view === "upload") return "Askona Загрузка фото";
  if (view === "admin") return "Askona Админ";
  return "Askona Каталог";
}

/**
 * Шаг 2: тап по «Каталог».
 * Уже в каталоге (на любой глубине, включая поиск/ткани/открытый товар) →
 * мгновенный возврат наверх (сброс дриллдауна) + отклик: пульс капсулы +
 * tick-звук + вибрация (Android; iOS — звук и пульс, vibrate запрещён).
 * Из другого раздела — обычный переход, но с тем же tick-откликом, что и у
 * остальных пунктов пилюли (иначе тап «Каталог» — единственный без звука).
 */
function goCatalog(btn?: HTMLElement | null, fromPill = false) {
  const s = usePortal.getState();
  /* iOS: системную хаптику уже сыграл нативный switch (.pill-haptic) под пальцем —
     движок дублировал бы тик; на Android (и в сайдбаре) вибрируем как обычно. */
  const hapticOn = fromPill ? vibrateSupported() : undefined;
  if (s.view === "catalog") {
    s.resetCatalog();
    playTick("tap", { hapticOn });
    if (btn) {
      btn.classList.remove("nav-pulse");
      void btn.offsetWidth; // перезапуск анимации
      btn.classList.add("nav-pulse");
      window.setTimeout(() => btn.classList.remove("nav-pulse"), 700);
    }
  } else {
    s.setView("catalog");
    playTick("tap", { hapticOn });
  }
}

function BackButton({ className }: { className?: string }) {
  const productId = usePortal((s) => s.productId);
  const searchQuery = usePortal((s) => s.searchQuery);
  const catModel = usePortal((s) => s.catModel);
  const catCategory = usePortal((s) => s.catCategory);
  const catFabrics = usePortal((s) => s.catFabrics);
  const catMaterial = usePortal((s) => s.catMaterial);
  const canBack = Boolean(productId || searchQuery || catModel || catCategory || catFabrics || catMaterial);
  if (!canBack) return null;
  return (
    <button
      type="button"
      aria-label="Назад"
      onClick={() => {
        playTick();
        if (usePortal.getState().productId) dismissProduct();
        // ФИКС F-001: слои каталога теперь В ИСТОРИИ (push-эффект следит за cat*/
        // searchQuery), поэтому встроенной «Назад» достаточно применить back() —
        // пуш-эффект сам создаст запись согласованному состоянию, а браузерный
        // Back проходит те же уровни послойно (suppressAndBack здесь нельзя:
        // popstate применит состояние ПРЕДЫДУЩЕЙ записи и перепрыгнет слой).
        else usePortal.getState().back();
      }}
      className={cn("lg-back", className)}
    >
      <ArrowLeft size={20} strokeWidth={2.3} />
    </button>
  );
}

/**
 * Вау-эффекты (один listeners-набор на всё приложение):
 *  — spotlight: карточки .spot подсвечиваются вокруг курсора (--mx/--my);
 *  — магнитный логотип .magnet тянется к курсору;
 *  — «/» фокусирует поиск (как в Linear/GitHub);
 *  — открытая клавиатура (visualViewport) прячет нижнюю навигацию.
 */
function useWowEffects() {
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const t = e.target as Element | null;
      const spot = t?.closest?.(".spot") as HTMLElement | null;
      if (spot) {
        const r = spot.getBoundingClientRect();
        spot.style.setProperty("--mx", `${e.clientX - r.left}px`);
        spot.style.setProperty("--my", `${e.clientY - r.top}px`);
      }
      const mag = t?.closest?.(".magnet") as HTMLElement | null;
      document.querySelectorAll<HTMLElement>(".magnet").forEach((m) => {
        if (m !== mag) m.style.transform = "";
      });
      if (mag) {
        const r = mag.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        mag.style.transform = `translate(${(dx * 5).toFixed(1)}px, ${(dy * 3).toFixed(1)}px)`;
      }
    };
    // Листенер всегда (пассивный, дешёвый): реальный десктоп имеет pointer:fine,
    // а на тач-устройствах glow просто не виден — CSS-эффект живёт на :hover
    document.addEventListener("pointermove", onMove, { passive: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      // Портал сам решит: сфокусировать панельный поиск или открыть подвесной
      window.dispatchEvent(new CustomEvent("portal:search-open"));
    };
    document.addEventListener("keydown", onKey);

    /* Единый тактильный отклик на ВСЁ нажимаемое (кроме пилюли — у неё своя
       логика с drag-to-select): tick-звук + вибрация (Android) на каждый тап.
       Двойные срабатывания с явными playTick() компонентов схлопывает
       троттл 60 мс в tick.ts. disabled-кнопки click не кидают — safe. */
    const onClickTick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as Element | null;
      const hit = t?.closest?.("button, [role='button'], a[href], select, summary") as Element | null;
      if (hit && !hit.hasAttribute("disabled")) playTick();
    };
    document.addEventListener("click", onClickTick, { passive: true });

    const vv = window.visualViewport;
    const onVV = () => {
      if (!vv) return;
      const open = window.innerHeight - vv.height > 140;
      document.documentElement.classList.toggle("kb-open", open);
    };
    vv?.addEventListener("resize", onVV);
    vv?.addEventListener("scroll", onVV);

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClickTick);
      vv?.removeEventListener("resize", onVV);
      vv?.removeEventListener("scroll", onVV);
      document.documentElement.classList.remove("kb-open");
    };
  }, []);
}

/** Прогресс чтения сверху + кнопка «Наверх» */
function ScrollHud() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      setProgress(max > 4 ? Math.min(1, window.scrollY / max) : 0);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <>
      <div className="scroll-progress" aria-hidden>
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <button
        type="button"
        aria-label="Наверх"
        title="Наверх"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className={cn("fab-top", progress > 0.14 && "is-show")}
      >
        <ArrowUp size={20} strokeWidth={2.3} />
      </button>
    </>
  );
}

export function Portal() {
  const view = usePortal((s) => s.view);
  const productId = usePortal((s) => s.productId);
  const viewerOpen = usePortal((s) => s.viewerOpen);
  const viewerPhotos = usePortal((s) => s.viewerPhotos);
  const savedScrollY = usePortal((s) => s.savedScrollY);
  const restored = usePortal((s) => s.restored);
  const searchOpen = usePortal((s) => s.searchOpen);
  const searchQuery = usePortal((s) => s.searchQuery);
  const catCategory = usePortal((s) => s.catCategory);
  const catModel = usePortal((s) => s.catModel);
  const catFabrics = usePortal((s) => s.catFabrics);
  const catMaterial = usePortal((s) => s.catMaterial);
  const title = useHeaderTitle();
  const searchVisible = view === "catalog" || view === "stock";
  useWowEffects();

  /* ── Пилюля: Liquid Glass v3 — «жидкая» линза, как в iOS 26 ──────────────
     Линза живёт НА УРОВНЕ КАПСУЛЫ и ТЯНЕТСЯ от опорного пункта к пальцу,
     охватывая 2 блока/ряд (растягивание, как в видео), затем пружиной
     собирается в пункт. Пункт под пальцем магнитно увеличивается и
     подсвечивается фирменным цветом (эффект «магнитной линзы»).
     Хаптика: нативный switch (.pill-haptic) в каждом пункте играет системный
     тик на iOS при прямом тапе; Android вибрирует через navigator.vibrate. */
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const shellRef = useRef<HTMLDivElement | null>(null);
  const rectsRef = useRef(new Map<string, { left: number; width: number }>());
  const anchorRef = useRef<string | null>(null);
  const lensX = useMotionValue(0);
  const lensW = useMotionValue(0);
  const dragRef = useRef<{ on: boolean; key: string | null }>({ on: false, key: null });
  const suppressClickRef = useRef(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const reduceMotion = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const apply = () => {
      reduceMotion.current = mq.matches;
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  const DRAG_SPRING = { type: "spring", stiffness: 620, damping: 48 } as const;
  const SETTLE_SPRING = { type: "spring", stiffness: 470, damping: 34 } as const;

  const measurePill = () => {
    const m = new Map<string, { left: number; width: number }>();
    for (const [key, el] of itemRefs.current) m.set(key, { left: el.offsetLeft, width: el.offsetWidth });
    rectsRef.current = m;
  };

  const placeLens = (key: string, anim = true) => {
    const r = rectsRef.current.get(key);
    if (!r) return;
    animate(lensX, r.left, anim ? SETTLE_SPRING : { duration: 0 });
    animate(lensW, r.width, anim ? SETTLE_SPRING : { duration: 0 });
  };

  const collapseLens = (anim = true) => {
    animate(lensW, 0, anim ? SETTLE_SPRING : { duration: 0 });
  };

  /* Капсула тянется от опорного пункта к пальцу — «захват 2 блоков или ряда»:
     пункт под пальцем поглощается ЦЕЛИКОМ, между пунктами капсула тянется
     за пальцем с упругим «хвостом» (12px) */
  const stretchLensTo = (clientX: number) => {
    const shell = shellRef.current;
    if (!shell) return;
    const anchor = rectsRef.current.get(anchorRef.current ?? "catalog");
    if (!anchor) return;
    const sw = shell.clientWidth;
    const fx = clientX - shell.getBoundingClientRect().left;
    const aL = anchor.left;
    const aR = anchor.left + anchor.width;
    const cur = dragRef.current.key ? rectsRef.current.get(dragRef.current.key) : null;
    let left = Math.min(aL, fx);
    let right = Math.max(aR, fx);
    if (cur) {
      left = Math.min(left, cur.left);
      right = Math.max(right, cur.left + cur.width);
    } else if (fx > aR) {
      right = fx + 12;
    } else if (fx < aL) {
      left = fx - 12;
    }
    left = Math.max(6, left);
    right = Math.min(sw - 6, right);
    if (right - left < anchor.width) right = left + anchor.width; // минимум — пункт
    animate(lensX, left, DRAG_SPRING);
    animate(lensW, right - left, DRAG_SPRING);
  };

  /* Магнитная линза: пункт под пальцем увеличивается и подсвечивается (cyan, как в видео) */
  const magnifyAt = (clientX: number) => {
    if (reduceMotion.current) return;
    for (const [, el] of itemRefs.current) {
      const r = el.getBoundingClientRect();
      const d = Math.abs(clientX - (r.left + r.width / 2));
      const inf = Math.max(0, 1 - d / 90);
      const icon = el.querySelector("svg");
      const label = el.querySelector<HTMLElement>(".pill-label");
      if (icon) icon.style.transform = inf > 0.02 ? `scale(${(1 + 0.34 * inf).toFixed(3)})` : "";
      if (label) label.style.transform = inf > 0.02 ? `translateY(${(-2 * inf).toFixed(1)}px)` : "";
      el.style.color = inf > 0.45 ? "var(--brand)" : "";
    }
  };
  const resetMagnify = () => {
    for (const [, el] of itemRefs.current) {
      const icon = el.querySelector("svg");
      const label = el.querySelector<HTMLElement>(".pill-label");
      if (icon) icon.style.transform = "";
      if (label) label.style.transform = "";
      el.style.color = "";
    }
  };

  const pillActivate = (key: string) => {
    if (key === "catalog") {
      goCatalog(itemRefs.current.get("catalog") ?? null, true);
    } else {
      usePortal.getState().setView(key as View);
      // iOS: системную хаптику уже сыграл .pill-haptic под пальцем — не дублируем
      playTick("tap", { hapticOn: vibrateSupported() });
    }
  };

  /** Пункт пилюли под точкой (палец может чуть съезжать — допуск ±12px) */
  const keyAtPoint = (x: number, y: number): string | null => {
    for (const [key, el] of itemRefs.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 12 && y <= r.bottom + 12) return key;
    }
    return null;
  };

  const onShellPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    /* Guard: синтетический pointerdown (тесты/код) может прийти без координат —
       вне капсулы drag не начинаем, чтобы не растянуть линзу фантомно */
    const shellBox = e.currentTarget.getBoundingClientRect();
    if (e.clientX === 0 && e.clientY === 0) return;
    if (e.clientX < shellBox.left - 1 || e.clientX > shellBox.right + 1 || e.clientY < shellBox.top - 1 || e.clientY > shellBox.bottom + 1) return;
    const key = keyAtPoint(e.clientX, e.clientY);
    dragRef.current = { on: true, key };
    anchorRef.current = key ?? view;
    setDragKey(key);
    stretchLensTo(e.clientX);
    magnifyAt(e.clientX);
    /* БЕЗ setPointerCapture: capture ретаргетит click на капсулу — нативный
       switch .pill-haptic не получил бы клик, и iOS 26.5+ не сыграл бы хаптику.
       Слушатели на window ведут палец даже за пределами пилюли. */
    const onMove = (ev: PointerEvent) => {
      const k = keyAtPoint(ev.clientX, ev.clientY);
      if (k && k !== dragRef.current.key) {
        dragRef.current.key = k;
        setDragKey(k);
        playStep(); // тихий tick + лёгкая вибрация на каждом пункте
      }
      stretchLensTo(ev.clientX);
      magnifyAt(ev.clientX);
    };
    const onEnd = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (!dragRef.current.on) return;
      dragRef.current.on = false;
      anchorRef.current = null;
      const k = keyAtPoint(ev.clientX, ev.clientY) ?? dragRef.current.key;
      setDragKey(null);
      resetMagnify();
      if (!k) {
        placeLens(view); // палец ушёл с пилюли — линза возвращается к активному
        return;
      }
      // активация здесь: синтетический click подавляем (сработал бы на старом пункте)
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 500);
      pillActivate(k);
      // страховка: если view не изменился (повторный тап) — линза всё равно собирается
      placeLens(k);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  /* ── Шапка/пилюля: реакция на скролл и касание ────────────────────── */
  const [scrolled, setScrolled] = useState(false);
  const [pillTouched, setPillTouched] = useState(false);
  /* Подвесной поиск (открыт из кружка) */
  const [searchFabOpen, setSearchFabOpen] = useState(false);
  /* «Жидкий» переезд линзы — 480 мс после смены активного пункта */
  const [liquid, setLiquid] = useState(false);

  useEffect(() => {
    usePortal.getState().restore();
    window.history.replaceState(snapshot(), "");
  }, []);

  // Скролл: сворачивает шапку (>6px), закрывает подвесной поиск при реальном листании
  useEffect(() => {
    let raf = 0;
    let lastY = window.scrollY;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        setScrolled(y > 6);
        if (Math.abs(y - lastY) > 30) {
          lastY = y;
          setSearchFabOpen((open) => {
            if (open) usePortal.getState().setSearchOpen(false);
            return false;
          });
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Касание: пилюля становится активной до тапа в другое место
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const hit = (e.target as Element | null)?.closest?.(".pill-shell");
      setPillTouched(Boolean(hit));
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  // Жидкий эффект: запуск на смену активного пункта пилюли + переезд/схлопывание линзы
  const activeKey = productId ? `product:${productId}` : view;
  const prevActiveKey = useRef(activeKey);
  useEffect(() => {
    if (prevActiveKey.current === activeKey) return;
    prevActiveKey.current = activeKey;
    setLiquid(true);
    const t = window.setTimeout(() => setLiquid(false), 500);
    if (!dragRef.current.on) {
      // открыт товар — линза жидко схлопывается; вернулись в раздел — перетекает на пункт
      if (productId) collapseLens(true);
      else placeLens(view, true);
    }
    return () => window.clearTimeout(t);
  }, [activeKey, productId, view]);

  // Геометрия пилюли: первичное размещение линзы (без анимации) + повороты/ресайз
  const viewRef = useRef(view);
  const productIdRef = useRef(productId);
  viewRef.current = view;
  productIdRef.current = productId;
  const syncLensInstant = () => {
    measurePill();
    if (productIdRef.current) collapseLens(false);
    else placeLens(viewRef.current, false);
  };
  useLayoutEffect(() => {
    syncLensInstant();
    window.addEventListener("resize", syncLensInstant);
    return () => window.removeEventListener("resize", syncLensInstant);
  }, []);

  // rAF-анимация SVG-фильтра (feTurbulence/feDisplacementMap) за 480 мс — только Chromium
  const turbRef = useRef<SVGFETurbulenceElement>(null);
  const dispRef = useRef<SVGFEDisplacementMapElement>(null);
  useEffect(() => {
    if (!liquid || !IS_CHROMIUM) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const disp = dispRef.current;
    const turb = turbRef.current;
    if (!disp || !turb) return;
    const start = performance.now();
    const DUR = 480;
    let raf = 0;
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / DUR);
      const k = (1 - p) * (1 - p); // затухание 1→0
      disp.setAttribute("scale", (17 * k).toFixed(2));
      turb.setAttribute(
        "baseFrequency",
        `${(0.012 + 0.05 * k).toFixed(4)} ${(0.09 + 0.14 * k).toFixed(4)}`
      );
      if (p < 1) raf = requestAnimationFrame(frame);
      else disp.setAttribute("scale", "0");
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [liquid]);

  /* ── Поиск: из пилюли, из кружка или по «/» ─────────────────────── */
  const openSearch = () => {
    const s = usePortal.getState();
    playTick(); // звук + хаптика (движок)
    if (s.productId) dismissProduct();
    if (s.view !== "catalog" && s.view !== "stock") s.setView("catalog");
    if (scrolled) setSearchFabOpen(true);
    window.setTimeout(
      () => (document.getElementById("global-search") as HTMLInputElement | null)?.focus(),
      scrolled ? 130 : 80
    );
  };

  useEffect(() => {
    const open = () => openSearch();
    window.addEventListener("portal:search-open", open);
    return () => window.removeEventListener("portal:search-open", open);
  });

  // Тап мимо подвесного поиска — закрыть его
  useEffect(() => {
    if (!searchFabOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(".search-pop") || t?.closest?.(".search-fab")) return;
      setSearchFabOpen(false);
      usePortal.getState().setSearchOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [searchFabOpen]);

  // ── History API: каждый новый слой/раздел — отдельная запись ─────
  // ФИКС F-001: в deps включены ВСЕ слои (cat*/searchQuery) — раньше запись
  // пушилась только на смену view/productId/viewerOpen, поэтому дриллдаун
  // каталога не попадал в историю и браузерный Back выкидывал из приложения.
  useEffect(() => {
    if (!restored || isPushSuppressed()) return;
    const cur = (window.history.state as { portal?: PortalSnapshot } | null)?.portal;
    if (
      cur &&
      cur.view === view &&
      cur.productId === productId &&
      cur.viewerOpen === viewerOpen &&
      cur.searchQuery === searchQuery &&
      cur.catModel === catModel &&
      cur.catCategory === catCategory &&
      cur.catFabrics === catFabrics &&
      cur.catMaterial === catMaterial
    ) {
      return; // запись уже актуальна (после popstate / restore) — не дублируем
    }
    window.history.pushState(snapshot(), "");
  }, [restored, view, productId, viewerOpen, searchQuery, catCategory, catModel, catFabrics, catMaterial]);

  // ── Браузерный Back/Forward: применяем верхний слой из истории ───
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const st = (e.state as { portal?: PortalSnapshot } | null)?.portal;
      const s = usePortal.getState();
      const viewerOk = Boolean(st?.viewerOpen) && s.viewerPhotos.length > 0;
      usePortal.setState({
        viewerOpen: viewerOk,
        viewerIndex: viewerOk ? s.viewerIndex : 0,
        productId: st?.productId ?? null,
        view: st?.view ?? "catalog",
        searchQuery: st ? st.searchQuery : null,
        catCategory: st ? st.catCategory : null,
        catModel: st ? st.catModel : null,
        catFabrics: st ? st.catFabrics : false,
        catMaterial: st ? st.catMaterial : null,
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ── Возврат позиции скролла после закрытия карточки товара ───────
  const prevProductId = useRef<string | null>(null);
  useEffect(() => {
    const wasOpen = prevProductId.current != null;
    prevProductId.current = productId;
    if (wasOpen && productId == null && savedScrollY > 0) {
      const y = savedScrollY;
      // AnimatePresence на кадр схлопывает документ — ждём высоту и возвращаем позицию
      let tries = 0;
      let raf = 0;
      const tick = () => {
        tries++;
        const tall = document.documentElement.scrollHeight >= y + window.innerHeight * 0.8;
        if (tall || tries > 60) {
          window.scrollTo({ top: y, behavior: "instant" });
        } else {
          raf = requestAnimationFrame(tick);
        }
      };
      const start = setTimeout(tick, 380);
      return () => {
        clearTimeout(start);
        cancelAnimationFrame(raf);
      };
    }
  }, [productId, savedScrollY]);

  // ── Escape закрывает только ВЕРХНИЙ открытый слой ────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const s = usePortal.getState();
      // Верхние слои (просмотрщик, drawer фильтров, дропдаун поиска) закрывают себя сами
      if (s.viewerOpen || s.filtersOpen || s.searchOpen) return;
      if (searchFabOpen) {
        e.preventDefault();
        setSearchFabOpen(false);
        return;
      }
      if (s.productId) {
        e.preventDefault();
        dismissProduct();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchFabOpen]);

  return (
    <div className="relative min-h-dvh">
      {/* Фоновые эффекты */}
      <div className="ambient" aria-hidden>
        <span className="ambient-grid" />
        <span className="aurora aurora-a" />
        <span className="aurora aurora-b" />
        <span className="aurora aurora-c" />
        {/* ФИКС ПОЛОСЫ v3: плоский низ — кромка всегда == фону html */}
        <span className="fx-skirt" />
      </div>

      {/* SVG-фильтр жидкой ряби для пилюли (анимируется по rAF, только Chromium) */}
      <svg aria-hidden focusable="false" width="0" height="0" style={{ position: "absolute", pointerEvents: "none" }}>
        <defs>
          <filter id="nav-liquid" x="-20%" y="-60%" width="140%" height="220%" colorInterpolationFilters="sRGB">
            <feTurbulence ref={turbRef} type="fractalNoise" baseFrequency="0.012 0.09" numOctaves={2} seed={7} result="noise" />
            <feDisplacementMap ref={dispRef} in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      {/* Плёночная фактура поверх контента (не перехватывает события) */}
      <div className="fx-vignette" aria-hidden />
      <div className="fx-grain" aria-hidden />

      {/* Прогресс чтения + «Наверх» */}
      <ScrollHud />

      <BootSplash />

      {/* Сайдбар — десктоп */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col justify-between border-r border-border p-4 lg:flex">
        <div>
          <button
            type="button"
            onClick={() => goCatalog(usePortal.getState().productId != null ? null : undefined)}
            className="magnet group mb-8 flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-secondary"
          >
            <img
              src="/logo-askona.png"
              alt="Askona"
              className="h-8 w-auto max-w-[62px] object-contain object-left transition-transform duration-300 group-hover:scale-105"
              draggable={false}
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-display text-[13px] font-bold leading-tight whitespace-nowrap">Склад мебели</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Askona
              </span>
            </span>
          </button>

          <nav className="flex flex-col gap-1.5" aria-label="Основная навигация">
            {NAV.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={(e) => (key === "catalog" ? goCatalog(e.currentTarget) : usePortal.getState().setView(key))}
                className={cn("side-link", view === key && !productId && "is-on")}
              >
                <Icon size={18} strokeWidth={2.1} />
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-4">
          <LiveStatus />
          <div className="flex items-center justify-between rounded-2xl border border-border bg-secondary px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Тема
            </span>
            <ThemeSwitch compact />
          </div>
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            © 2026 Ярослав Федоренко
            <br />
            Склад мебели · v1.4
          </p>
        </div>
      </aside>

      {/* Липкая шапка + панель поиска — мобильные и десктоп (в зоне контента).
          Наверху: «Назад» + заголовок раздела + тема. При скролле шапка становится
          ПОЛНОСТЬЮ прозрачной — остаются только плавающие «Назад» (крупная) и
          кружок поиска слева (search-fab), как просил пользователь. */}
      <div className={cn("sticky top-0 z-40 lg:ml-[248px]", scrolled && "header-collapsed")}>
        <header className="glass flex items-center gap-2 px-3 pb-2 pt-[max(10px,env(safe-area-inset-top))] sm:px-4">
          <div className="lg:hidden">
            <BackButton />
          </div>
          <button
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
          <div className="header-fade flex min-w-0 flex-1 flex-col items-start lg:flex-none">
            <span className="max-w-[64vw] truncate font-display text-[13px] font-bold leading-none sm:text-[14px] lg:max-w-[46vw]" title={title}>
              {title}
            </span>
            <div className="mt-1 hidden lg:block">
              <WarehouseSelect className="w-[102px] text-[9px]" />
            </div>
          </div>
          <span className="min-w-2 flex-1 lg:block" aria-hidden />
          <div className="hidden lg:block">
            <BackButton />
          </div>
          {/* Переключатель темы: НЕ растворяется при скролле (фикс — «пропадает настройка темы»),
              стеклянная капсула видна всегда */}
          <ThemeSwitch mini />
        </header>

        {searchVisible && (
          <div className="search-collapse glass border-t border-border/60 px-3 sm:px-4">
            <div>
              <div className="mx-auto w-full max-w-[860px] pb-2.5 pt-2">
                <SearchBar />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Контент */}
      <main className="relative z-10 pb-[calc(108px+env(safe-area-inset-bottom))] lg:ml-[248px] lg:pb-10">
        <div className="mx-auto w-full max-w-[1240px] px-4 pt-4 sm:px-6 lg:pt-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={productId ? `product-${productId}` : view}
              initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, filter: "blur(4px)" }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {productId ? (
                <ProductView />
              ) : view === "stock" ? (
                <StockView />
              ) : view === "catalog" ? (
                <CatalogView />
              ) : view === "upload" ? (
                <UploadView />
              ) : (
                <AdminView />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Нижняя навигация — плавающая «пилюля» (Liquid Glass v3, iOS 26).
          Линза-«жидкость» живёт на уровне капсулы: тянется за пальцем, охватывая
          2 блока/ряд (drag-to-select), магнитно увеличивает пункт под пальцем
          и пружиной собирается при отпускании. Нативные switch (.pill-haptic)
          в пунктах дают системную хаптику на iOS при прямом тапе.
          Реакция: листают — стекло растворяется (pill-dim); коснулись —
          плотное активное стекло (pill-active) до тапа мимо. */}
      <nav className="pill-nav lg:hidden" aria-label="Нижняя навигация">
        <div
          ref={shellRef}
          className={cn(
            "pill-shell",
            scrolled && !pillTouched && "pill-dim",
            pillTouched && "pill-active",
            liquid && IS_CHROMIUM && "is-liquid"
          )}
          onPointerDown={onShellPointerDown}
        >
          {/* Линза-«жидкость»: тянется за пальцем (x/width через motion-пружины) */}
          <motion.span
            className={cn("nav-lens", dragKey && "is-drag", liquid && "is-squash")}
            style={{ x: lensX, width: lensW }}
            aria-hidden="true"
          >
            <span className="nav-lens-core" />
          </motion.span>
          {NAV.map(({ key, short, Icon }) => {
            const on = view === key && !productId;
            const drag = dragKey === key && !on;
            return (
              <button
                key={key}
                type="button"
                ref={(el) => {
                  if (el) itemRefs.current.set(key, el);
                  else itemRefs.current.delete(key);
                }}
                onClick={(e) => {
                  if (suppressClickRef.current) return; // активация уже сделана в pointerup
                  if (key === "catalog") goCatalog(e.currentTarget, true);
                  else {
                    usePortal.getState().setView(key);
                    // iOS: хаптику сыграл .pill-haptic; Android — вибрируем
                    playTick("tap", { hapticOn: vibrateSupported() });
                  }
                }}
                className={cn("pill-item", on && "is-on", drag && "is-drag")}
                aria-current={on ? "page" : undefined}
              >
                {/* Нативный switch под пальцем (Safari 17.4+): прямой тап = системная
                    хаптика на iOS ЛЮБОЙ версии, включая 26.5+, где программные тики
                    запрещены Apple. Невидим (opacity 0 + clip-path), appearance НЕ
                    трогаем — без нативного вида iOS не играет хаптику. Атрибут
                    switch передаётся spread'ом: его ещё нет в React-типах. */}
                <input type="checkbox" {...{ switch: "" }} className="pill-haptic" aria-hidden="true" tabIndex={-1} />
                <Icon size={24} strokeWidth={2.1} />
                <span className="pill-label">{short}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Кружок поиска — вместо свернувшейся панели при скролле (каталог/остатки) */}
      {searchVisible && scrolled && !searchFabOpen && (
        <button
          type="button"
          aria-label="Открыть поиск"
          onClick={openSearch}
          className={cn("search-fab lg:hidden", searchQuery && "has-query")}
        >
          <Search size={20} strokeWidth={2.3} />
        </button>
      )}

      {/* Подвесной поиск — стеклянная карточка (не панель): открыт из кружка или по «/» при скролле.
          Листание (>30px) сжимает обратно в кружок. */}
      {searchVisible && searchFabOpen && (
        <div className="search-pop lg:hidden">
          <SearchBar />
        </div>
      )}

      <PhotoViewer />
    </div>
  );

  function LiveStatus() {
    return (
      <div className="flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5">
        <span className="live-dot h-2 w-2 shrink-0 rounded-full bg-[color:var(--brand)]" />
        <WarehouseSelect className="w-[110px] border-0 bg-transparent text-[11px]" />
        <span className="h-3 w-px shrink-0 bg-border" />
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">склад онлайн</span>
      </div>
    );
  }
}
