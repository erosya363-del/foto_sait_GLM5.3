"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowUp, Boxes, Images, Search, UploadCloud, ShieldCheck, X } from "lucide-react";
import {
  usePortal, snapshot, dismissProduct, isPushSuppressed,
  type View, type PortalSnapshot,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { playTick, playStep } from "@/lib/tick";
import { useKeyboardOpen } from "@/lib/use-visual-viewport";
import { initNativeIOSBridge } from "@/lib/native-bridge";
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

/* «Жидкий» глитч-рябь (feTurbulence + feDisplacementMap) — УДАЛЕНА вместе с линзой (п.5 ТЗ:
   панель должна быть максимально стабильной) */

/* Склад выбран по умолчанию в store (API не тронут); переключатель склада
   и «склад онлайн» из UI УДАЛЕНЫ — прямая просьба владельца (п.7 ТЗ) */

/** Видим ли элемент — для выбора ПРАВИЛЬного поля поиска.
    НЕ offsetParent (у position:fixed он всегда null — а .search-pop fixed):
    меряем геометрию + computed style.
    БЕЗ проверки opacity: у карточки есть входная анимация (0.22s, opacity 0→1) —
    в первые кадры opacity=0, но карточка УЖЕ та поверхность, где пользователь
    ждёт поле; отказ из-за анимации ломал фокус (fallback успевал раньше). */
function isShown(el: Element | null): el is Element {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return false;
  const st = getComputedStyle(el);
  return st.display !== "none" && st.visibility !== "hidden";
}

/** Заголовок текущего экрана — ТОЛЬКО название вкладки (п.8 ТЗ: никаких
    «Обухов (склад)»/«Склад онлайн»/приставок — просто Каталог/Остатки/…) */
function useHeaderTitle() {
  const view = usePortal((s) => s.view);
  const productId = usePortal((s) => s.productId);
  if (productId) return "Каталог";
  if (view === "stock") return "Остатки";
  if (view === "upload") return "Загрузка";
  if (view === "admin") return "Админ";
  return "Каталог";
}

/**
 * Тап по «Каталог».
 * Уже в каталоге (на любой глубине, включая поиск/ткани/открытый товар) →
 * мгновенный возврат наверх (сброс дриллдауна) + отклик: пульс капсулы +
 * tick-звук. Из другого раздела — обычный переход с тем же откликом.
 * Хаптика — ЕДИНЫМ движком playTick (web-haptics: vibrate на Android,
 * switch-эмуляция на iOS). Скрытые form-controls (.pill-haptic) в панели
 * ЗАПРЕЩЕНЫ: интерактивный <input> внутри <button> — баг-машина двойных
 * фокусов и зумов; НЕ возвращать (см. также tick.ts).
 */
function goCatalog(btn?: HTMLElement | null) {
  const s = usePortal.getState();

  if (s.view === "catalog") {
    s.resetCatalog();
    playTick("tap");

    if (btn) {
      btn.classList.remove("nav-pulse");
      void btn.offsetWidth; // перезапуск анимации
      btn.classList.add("nav-pulse");
      window.setTimeout(() => {
        btn.classList.remove("nav-pulse");
      }, 520);
    }
  } else {
    s.setView("catalog");
    playTick("tap");
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

    /* ── Клавиатура ПЕРЕЕХАЛА в lib/use-visual-viewport.ts (P0.4 ТЗ):
       один singleton-источник keyboardOpen + html.kb-open + --kb-h на всё
       приложение. Панель при клавиатуре ПРОСТО СКРЫВАЕТСЯ классом
       (display:none, без transform-переходов — P0.3/P1.14). */

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClickTick);
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
  useWowEffects();
  const keyboardOpen = useKeyboardOpen(); // подписка держит singleton живым; панель прячет класс .pill-hidden + html.kb-open

  /* ── Нативная iOS-оболочка (AskonaApp): мост «системный таб-бар ↔ SPA» ──
     В Safari/PWA/Android — no-op (флаг __ASKONA_NATIVE_IOS__ не выставлен).
     В нативной оболочке: таб-бар iOS переключает разделы через
     native-tab-change, сайт сообщает о смене раздела через tabChanged. */
  useEffect(() => initNativeIOSBridge(), []);

  /* ── Пилюля: ОДНО статичное стекло + ЖИДКАЯ линза ПОД кнопками ──
     Архитектура (ТЗ v4): GLASS SHELL → BACKGROUND/CAUSTICS → LIQUID LENS →
     RIM → ICONS+LABELS. Активный пункт = линза .pill-bubble внутри .pill-goo
     (SVG-goo-фильтр): линза движется ПЕРМАНЕНТНОЙ rAF-пружиной, «призрак»
     .pill-ghost отстаёт на своей пружине — фильтр растягивает между ними
     «шею», капля отделяется и собирается. Кнопки ВСЕГДА выше линзы (z-слои
     в CSS). Контроллер живёт в ОДНОМ []-эффекте и ПЕРЕЖИВАЕТ смены вкладок:
     быстрые Каталог→Остатки→Загрузка за 100 мс — это одно непрерывное
     движение (меняется только target, rAF не пересоздаётся). */
  const shellRef = useRef<HTMLDivElement | null>(null);
  const gooRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const itemRefs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});

  /* Состояние пружин (refs, НЕ setState — ноль ререндеров в кадре):
     x/velocity — основная линза; ghostX/ghostVelocity — отстающий призрак. */
  const dropAnim = useRef({
    x: 0,
    velocity: 0,

    ghostX: 0,
    ghostVelocity: 0,

    target: 0,

    raf: 0,
    last: 0,

    initialized: false,
  });

  /* Точки управления линзой для эффектов: drive — установить цель/ширину,
     hide — погасить (открыт товар). Заполняются контроллером. */
  const drivePillRef =
    useRef<(x: number, width: number, animate?: boolean) => void>(() => {});

  const hidePillRef = useRef<() => void>(() => {});

  const reducedMotion = useRef(false);

  /* prefers-reduced-motion: капля без хвоста-призрака (функция не страдает) */
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedMotion.current = mq.matches;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /* ── ПОСТОЯННЫЙ SPRING CONTROLLER (ОДИН []-эффект на весь срок жизни) ──
     Прежний эффект пересоздавал rAF на каждую смену вкладки и УБИВАЛ полёт
     при быстрых переходах. Теперь пружины живут здесь, а эффект [view,
     productId] ниже МЕНЯЕТ ТОЛЬКО ЦЕЛЬ (drivePillRef) — полёт не прерывается.
     Никакого setState в кадре: только transform/width/opacity капли. */
  useEffect(() => {
    const shell = shellRef.current;
    const goo = gooRef.current;
    const bubble = bubbleRef.current;
    const ghost = ghostRef.current;

    if (!shell || !goo || !bubble || !ghost) return;

    const a = dropAnim.current;

    const cancel = () => {
      if (a.raf) {
        cancelAnimationFrame(a.raf);
        a.raf = 0;
      }
    };

    const render = () => {
      const stretch = Math.min(
        Math.abs(a.velocity) * 0.0009,
        0.12
      );

      const scaleX = 1 + stretch;
      const scaleY = 1 - stretch * 0.24;

      bubble.style.transform =
        `translate3d(${a.x.toFixed(2)}px,0,0) ` +
        `scaleX(${scaleX.toFixed(4)}) ` +
        `scaleY(${scaleY.toFixed(4)})`;

      ghost.style.transform =
        `translate3d(${a.ghostX.toFixed(2)}px,0,0) scale(0.88)`;
    };

    const settle = (x: number) => {
      cancel();

      a.x = x;
      a.target = x;
      a.velocity = 0;

      a.ghostX = x;
      a.ghostVelocity = 0;

      a.last = 0;

      render();

      goo.classList.remove("is-live");
    };

    const step = (time: number) => {
      a.raf = 0;

      const dt = a.last
        ? Math.min((time - a.last) / 1000, 0.032)
        : 0.016;

      a.last = time;

      /*
       * Main lens:
       * более спокойная пружина.
       * Не должна перескакивать цель.
       */
      const mainForce =
        (a.target - a.x) * 150 -
        a.velocity * 23;

      a.velocity += mainForce * dt;
      a.x += a.velocity * dt;

      /*
       * Ghost:
       * немного медленнее основной линзы.
       */
      const ghostForce =
        (a.target - a.ghostX) * 92 -
        a.ghostVelocity * 17;

      a.ghostVelocity += ghostForce * dt;
      a.ghostX += a.ghostVelocity * dt;

      render();

      const settled =
        Math.abs(a.target - a.x) < 0.25 &&
        Math.abs(a.velocity) < 2 &&
        Math.abs(a.target - a.ghostX) < 0.35 &&
        Math.abs(a.ghostVelocity) < 2;

      if (settled) {
        settle(a.target);
        return;
      }

      a.raf = requestAnimationFrame(step);
    };

    drivePillRef.current = (
      x: number,
      width: number,
      animate = true
    ) => {
      bubble.style.width = `${width}px`;
      ghost.style.width = `${width}px`;

      bubble.style.opacity = "1";

      if (!a.initialized) {
        a.initialized = true;
        settle(x);
        return;
      }

      if (
        !animate ||
        reducedMotion.current
      ) {
        settle(x);
        return;
      }

      /*
       * ВАЖНО:
       *
       * НЕ сбрасываем x/velocity,
       * если линза уже летит.
       *
       * Просто меняем target.
       *
       * Поэтому:
       *
       * Каталог → Остатки → Загрузка
       *
       * за 100 мс превращается в ОДНО непрерывное движение.
       */
      a.target = x;

      goo.classList.add("is-live");

      if (!a.raf) {
        a.last = 0;
        a.raf = requestAnimationFrame(step);
      }
    };

    hidePillRef.current = () => {
      cancel();

      bubble.style.opacity = "0";
      goo.classList.remove("is-live");

      a.velocity = 0;
      a.ghostVelocity = 0;
      a.last = 0;
    };

    const syncPosition = (animate = false) => {
      const state = usePortal.getState();

      if (state.productId) {
        hidePillRef.current();
        return;
      }

      const item = itemRefs.current[state.view];

      if (!item) return;

      drivePillRef.current(
        item.offsetLeft,
        item.offsetWidth,
        animate
      );
    };

    /*
     * Начальная позиция.
     */
    syncPosition(false);

    /*
     * Resize НЕ должен создавать полёт.
     */
    const ro = new ResizeObserver(() => {
      syncPosition(false);
    });

    ro.observe(shell);

    const onResize = () => syncPosition(false);

    window.addEventListener("resize", onResize);

    document.fonts?.ready.then(() => {
      requestAnimationFrame(() => {
        syncPosition(false);
      });
    });

    return () => {
      cancel();
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  /* ── ЦЕЛЬ ЛИНЗЫ: отдельный эффект, меняет ТОЛЬКО target/ширину ──
     Здесь НЕТ cancelAnimationFrame/reset пружин: при быстрой смене вкладок
     текущий полёт продолжается к новой цели (одно непрерывное движение). */
  useEffect(() => {
    if (productId) {
      hidePillRef.current();
      return;
    }

    const item = itemRefs.current[view];

    if (!item) return;

    drivePillRef.current(
      item.offsetLeft,
      item.offsetWidth,
      true
    );
  }, [view, productId]);

  /* Чёлка iPhone (аудит v2.6): meta theme-color всегда в цвет АКТУАЛЬНОЙ темы
     приложения (не системной) — иначе Safari красит зону статуса серой полосой */
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const apply = () => {
      const light = document.documentElement.classList.contains("light");
      meta.setAttribute("content", light ? "#f8f5ef" : "#1d1b18");
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  /* ── Шапка/пилюля: реакция на скролл и касание ────────────────────── */
  const [scrolled, setScrolled] = useState(false);
  /* Режим поиска — ЕДИНСТВЕННЫЙ state: usePortal.searchOpen.
     Дублирующего searchFabOpen больше НЕТ: два источника истины давали
     гонки («клавиатура есть — поиска нет»). popRef — карточка подвесного
     поиска (нужен closeSearchPop, чтобы сначала снять фокус поля). */
  const popRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    usePortal.getState().restore();
    window.history.replaceState(snapshot(), "");
  }, []);

  /* ── PHASE2 B2: gesture на панели — «живая линза» следует за пальцем ──
     ТЗ 2.4/2.5/2.6: VISUAL PREVIEW (линза едет за пальцем на пружине)
     отделён от COMMITTED VIEW (раздел меняется ТОЛЬКО на pointerup).
     Тап (|dx| ≤ 8px) не перехватывается — обычный click кнопки.
     При drag click соседних кнопок гасится capture-листенером на фазе
     захвата (React-делегат корня срабатывает позже — на bubble). */
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    type Hit = { key: View; el: HTMLButtonElement; dist: number };
    let phase: "idle" | "tracking" | "dragging" = "idle";
    let startX = 0;
    let pointerId = -1;

    const nearestItem = (clientX: number): Hit | null => {
      let best: Hit | null = null;
      for (const [key, el] of Object.entries(itemRefs.current) as Array<[View, HTMLButtonElement | null]>) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const d = Math.abs(clientX - (r.left + r.width / 2));
        if (!best || d < best.dist) best = { key, el, dist: d };
      }
      return best;
    };

    const stopDragClick = (e: MouseEvent) => {
      if (phase !== "dragging") return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    const settleBack = () => {
      const s = usePortal.getState();
      const item = itemRefs.current[s.view];
      if (item && !s.productId) {
        drivePillRef.current(item.offsetLeft, item.offsetWidth, true);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (usePortal.getState().productId) return; /* товар открыт — линза скрыта */
      phase = "tracking";
      startX = e.clientX;
      pointerId = e.pointerId;
    };

    const onMove = (e: PointerEvent) => {
      if (phase === "idle" || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      if (phase === "tracking" && Math.abs(dx) > 8) {
        phase = "dragging";
        shell.addEventListener("click", stopDragClick, { capture: true });
      }
      if (phase !== "dragging") return;
      const hit = nearestItem(e.clientX);
      if (hit) {
        drivePillRef.current(hit.el.offsetLeft, hit.el.offsetWidth, true);
      }
    };

    const finish = (clientX: number) => {
      const wasDragging = phase === "dragging";
      phase = "idle";
      if (!wasDragging) return;
      const hit = nearestItem(clientX);
      const s = usePortal.getState();
      if (hit && hit.key !== s.view && !s.productId) {
        /* COMMIT: только на отпускании (ТЗ 2.5). Эффект [view] довезёт линзу. */
        usePortal.getState().setView(hit.key);
        playTick("tap");
        window.setTimeout(() => {
          shell.removeEventListener("click", stopDragClick, { capture: true });
        }, 0);
        return;
      }
      /* Отпустил между вкладками / на текущей — линза плавно settle к ближайшей */
      settleBack();
      window.setTimeout(() => {
        shell.removeEventListener("click", stopDragClick, { capture: true });
      }, 0);
    };

    const onUp = (e: PointerEvent) => {
      if (phase === "idle" || e.pointerId !== pointerId) return;
      finish(e.clientX);
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== pointerId && pointerId !== -1) return;
      const wasDragging = phase === "dragging";
      phase = "idle";
      if (wasDragging) settleBack();
      shell.removeEventListener("click", stopDragClick, { capture: true });
    };

    shell.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });
    return () => {
      shell.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      shell.removeEventListener("click", stopDragClick, { capture: true });
    };
  }, []);

  /* ── КОРЕНЬ КРИТИЧЕСКОГО БАГА v3.0 («клавиатура есть, а поиска нет») ──
     Раньше листание >30px закрывало подвесной поиск. Но когда открывалась
     клавиатура, СТРАНИЦА СКАКЛА САМА: iOS подкручивает документ, чтобы
     показать поле в fixed-карточке, а Android (resizes-content) сжимает
     viewport и клэмпит scrollY — scroll-событие с дельтой >30 закрывало
     карточку, клавиатура оставалась. ТЗ п.1/2/5: search mode — САМОСТОЯТЕЛЬНОЕ
     состояние, скролл/resize/focus/клавиатура его НЕ трогают. Скролл теперь
     управляет только сворачиванием шапки. */
  useEffect(() => {
    let raf = 0;
    let calmTimer = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setScrolled(window.scrollY > 6));
      /* PHASE2 ТЗ 2.7: на время скролла замирают дорогие фоновые анимации
         (зерно/авроры) — html.is-scrolling ставит animation-play-state:paused,
         снимается через 240 мс после последнего события скролла */
      document.documentElement.classList.add("is-scrolling");
      window.clearTimeout(calmTimer);
      calmTimer = window.setTimeout(() => {
        document.documentElement.classList.remove("is-scrolling");
      }, 240);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(calmTimer);
      document.documentElement.classList.remove("is-scrolling");
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  /* Панель — ОДНОГО материала постоянно: скролл и касание НЕ меняют её
     плотность/прозрачность (pill-dim/pill-active удалены из архитектуры;
     НЕ возвращать — см. globals.css, блок MOBILE NAV). */

  /* ── Поиск: подвесная карточка на месте панели ──
   В DOM ровно ОДИН input[data-search-input] (внутри .search-pop) — дубли
   полей невозможны. Открытие: setSearchOpen(true) — React state — ЕДИНСТВЕННЫЙ
   источник DOM-состояния (класс is-open приходит из рендера; никаких
   classList.add вручную). На мобильном кнопка поиска НЕ фокусирует поле
   (клавиатуру открывает тап пользователя по полю); программный фокус —
   только «/» на десктопе. Закрытие: крестик, свайп вниз, Escape, тап мимо —
   ВСЕГДА через closeSearchPop: сначала blur (клавиатура iOS закрывается),
   потом state.

   PHASE2 ТЗ 2.13: closeSearchPop/openSearch — useCallback([]) (стабильные
   идентичности), листенеры portal:search-open/close — []-жизненный цикл.
   Раньше эти эффекты БЕЗ массива зависимостей пересоздавали листенеры
   на КАЖДЫЙ рендер портала (listener churn — п.2.13 ТЗ). */
  const focusVisibleSearchInput = () => {
    const host = document.querySelector<Element>(".search-pop");
    const input = host?.querySelector<HTMLInputElement>("input[data-search-input]");
    /* preventScroll ОБЯЗАТЕЛЕН: фокус на поле внутри position:fixed карточки
       otherwise скроллит ДОКУМЕНТ к «статической позиции» фиксированного
       элемента — страница улетает наверх. preventScroll рвёт эту связь;
       на открытие клавиатуры iOS он не влияет. */
    try {
      input?.focus({ preventScroll: true });
    } catch {
      input?.focus();
    }
    /* Страховка: если в этот же кадр computed visibility ещё «hidden»
       (транзишены наследуются), форсируем reflow и пробуем ещё раз —
       обе попытки остаются внутри жеста тапа (клавиатура iOS откроется) */
    if (input && document.activeElement !== input) {
      void input.offsetHeight;
      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      }
    }
    return Boolean(input);
  };
  const closeSearchPop = useCallback(() => {
    const input =
      popRef.current
        ?.querySelector<HTMLInputElement>(
          "input[data-search-input]"
        );

    /*
     * КРИТИЧНО:
     * сначала blur → клавиатура закрывается,
     * потом state — карточку прячет рендер.
     * Никаких classList.remove вручную:
     * React state = единственный источник DOM.
     */
    input?.blur();

    usePortal
      .getState()
      .setSearchOpen(false);
  }, []);
  /* Тап по кнопке поиска НЕ ставит фокус — клавиатура не вскакивает,
     viewport не прыгает. Пользователь сам тапает по полю → нативный focus →
     клавиатура. Фокус остаётся ТОЛЬКО у программного открытия по «/» (десктоп). */
  const openSearch = useCallback((
    focusInput = false
  ) => {
    const state =
      usePortal.getState();

    playTick("tap");

    if (state.productId) {
      dismissProduct();
    }

    if (
      state.view !== "catalog" &&
      state.view !== "stock"
    ) {
      state.setView("catalog");
    }

    state.setSearchOpen(true);

    /*
     * Только desktop «/» требует
     * программного focus.
     *
     * На мобильном кнопка поиска
     * НЕ должна сама открывать keyboard.
     */
    if (focusInput) {
      requestAnimationFrame(() => {
        focusVisibleSearchInput();
      });
    }
  }, []);
  /* Тап по кнопке поиска на пилюле: открыть/закрыть (toggle) */
  const toggleSearch = () => {
    if (searchOpen) {
      closeSearchPop();
    } else {
      openSearch(false);
    }
  };

  /* PHASE2 ТЗ 2.13: ОДИН стабильный листенер на весь жизненный цикл */
  useEffect(() => {
    const open = () => openSearch(true); /* «/» — сразу к вводу (десктоп) */
    window.addEventListener("portal:search-open", open);
    return () => window.removeEventListener("portal:search-open", open);
  }, [openSearch]);

  // Тап мимо подвесного поиска — закрыть (кроме самой карточки и кнопки на пилюле:
  // у кнопки свой toggle — иначе pointerdown закрыл бы карточку ДО click).
  // Это ЕДИНСТВЕННЫЙ outside-обработчик режима — в Portal. Дублирующий
  // листенер из SearchBar удалён: два глобальных pointerdown конфликтовали.
  useEffect(() => {
    if (!searchOpen) return;

    const onDown = (
      event: PointerEvent
    ) => {
      const target =
        event.target as Element | null;

      if (
        target?.closest?.(".search-pop") ||
        target?.closest?.(".pill-search")
      ) {
        return;
      }

      closeSearchPop();
    };

    window.addEventListener(
      "pointerdown",
      onDown
    );

    return () => {
      window.removeEventListener(
        "pointerdown",
        onDown
      );
    };
  }, [searchOpen]);

  /* СВАЙП ВНИЗ закрывает карточку (шаг 3): палец тянет карточку вниз
     (визуальный след), отпускание при >70px — закрытие. Свайп внутри
     скроллящегося дропдауна результатов закрытию не мешает. */
  useEffect(() => {
    if (!searchOpen) return;
    const pop = popRef.current;
    if (!pop) return;
    let startY = 0;
    let dy = 0;
    let tracking = false;
    let inScroller = false;
    const ts = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const sc = (e.target as Element | null)?.closest?.(".search-dd") as Element | null;
      inScroller = Boolean(sc && sc.scrollHeight > sc.clientHeight + 4);
      startY = e.touches[0].clientY;
      dy = 0;
      tracking = true;
    };
    const tm = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      dy = e.touches[0].clientY - startY;
      if (inScroller || dy <= 0) return;
      pop.style.transition = "none";
      pop.style.transform = `translateY(${Math.min(150, dy * 0.5).toFixed(1)}px)`;
    };
    const te = () => {
      if (!tracking) return;
      tracking = false;
      pop.style.transition = "";
      pop.style.transform = "";
      if (dy > 70 && !inScroller) closeSearchPop();
    };
    pop.addEventListener("touchstart", ts, { passive: true });
    pop.addEventListener("touchmove", tm, { passive: true });
    pop.addEventListener("touchend", te, { passive: true });
    pop.addEventListener("touchcancel", te, { passive: true });
    return () => {
      pop.removeEventListener("touchstart", ts);
      pop.removeEventListener("touchmove", tm);
      pop.removeEventListener("touchend", te);
      pop.removeEventListener("touchcancel", te);
    };
  }, [searchOpen]);

  /* ТЗ v3.0 п.3/5: применение запроса (Enter/чип/ткань) БОЛЬШЕ НЕ закрывает
     карточку поиска — поле остаётся на экране, пользователь может продолжить
     ввод (клавиатура закрылась/открылась — режим жив). Плавающий чип
     «Поиск: «X»» появляется после ЯВНОГО закрытия карточки. Выход из режима —
     только крестик / свайп вниз / Escape / тап мимо / другой раздел. */
  useEffect(() => {
    const close = () => closeSearchPop();
    window.addEventListener("portal:search-close", close);
    return () => window.removeEventListener("portal:search-close", close);
  }, [closeSearchPop]);

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
      // Верхние слои (просмотрщик, drawer фильтров) закрывают себя сами;
      // поле поиска в фокусе тоже — SearchBar гасит Escape stopPropagation'ом
      if (s.viewerOpen || s.filtersOpen) return;
      // ГОНКА (v3.1): pswp гасит слой СИНХРОННО в этом же событии — к моменту
      // bubble-фазы viewerOpen уже false, и без этой проверки портал сделал бы
      // ВТОРОЙ back (закрыл и товар). Пока корень pswp в DOM — Esc не наш.
      if (document.querySelector(".pswp")) return;
      if (searchOpen) {
        e.preventDefault();
        closeSearchPop();
        return;
      }
      if (s.productId) {
        e.preventDefault();
        dismissProduct();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

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
            {/* Шаг 3: поиск тоже уехал из шапки — кнопка в сайдбаре открывает
                ту же подвесную карточку (по центру под шапкой) */}
            <button type="button" onClick={() => openSearch()} className="side-link">
              <Search size={18} strokeWidth={2.1} />
              Поиск
            </button>
          </nav>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-2xl border border-border bg-secondary px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Тема
            </span>
            <ThemeSwitch compact />
          </div>
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            © 2026 Ярослав Федоренко
            <br />
            {/* СТАБИЛИЗАЦИЯ: единый источник версии — next.config.ts собирает
                её из package.json + git SHA на этапе сборки (NEXT_PUBLIC_APP_VERSION).
                Раньше номер был захардкожен («v1.4») и расходился с реальностью. */}
            Склад мебели · {process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
          </p>
        </div>
      </aside>

      {/* Липкая шапка — мобильные и десктоп (в зоне контента).
          Наверху: «Назад» + заголовок раздела + тема. Поисковой строки сверху НЕТ
          (шаги 1/3) — поиск переехал в круглый элемент на нижней панели.
          При скролле шапка становится ПОЛНОСТЬЮ прозрачной — остаётся только
          плавающая «Назад» (крупная). */}
      <div className={cn("sticky top-0 z-40 lg:ml-[248px]", scrolled && "header-collapsed")}>
        <header className="glass flex items-center gap-2 px-3 pb-2 pt-[max(10px,var(--sat))] sm:px-4">
          <div className="lg:hidden">
            <BackButton />
          </div>
          {/* П.6 ТЗ: второй логотип Askona в шапке УДАЛЁН — один основной
              остался в сайдбаре. П.7: селектор «Обухово» из шапки убран. */}
          <div className="header-fade flex min-w-0 flex-1 flex-col items-start lg:flex-none">
            <span className="max-w-[64vw] truncate font-display text-[13px] font-bold leading-none sm:text-[14px] lg:max-w-[46vw]" title={title}>
              {title}
            </span>
          </div>
          <span className="min-w-2 flex-1 lg:block" aria-hidden />
          <div className="hidden lg:block">
            <BackButton />
          </div>
          {/* Переключатель темы: НЕ растворяется при скролле (фикс — «пропадает настройка темы»),
              стеклянная капсула видна всегда */}
          <ThemeSwitch mini />
        </header>
      </div>

      {/* Контент */}
      <main className="relative z-10 pb-[calc(104px+var(--sab))] lg:ml-[248px] lg:pb-10">
        <div className="mx-auto w-full max-w-[1240px] px-4 pt-4 sm:px-6 lg:pt-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={productId ? `product-${productId}` : view}
              /* ФИКС «ПОДЁРГИВАНИЯ» ВКЛАДОК: из анимации УБРАН filter: blur(4px).
                 Блюр всей страницы поверх backdrop-filter-стёкол (Загрузка —
                 гигантская стеклянная панель, Остатки/Админ — стеклянные карточки)
                 заставлял GPU перерисовывать страницу целиком КАЖДЫЙ кадр →
                 тяжёлые вкладки дёргались (Каталог — лёгкий, был плавным).
                 Остались только композиторные opacity+y — то же «погружение».
                 Выход ускорен 0.22→0.13s: меньше пустой паузы mode="wait". */
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.13, ease: "easeIn" } }}
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

      {/* SVG-фильтр эффекта (один на приложение):
          #pill-goo — metaball-слияние: линза отделяется/собирается при смене
          вкладки (blur + alpha-контраст + atop — классический gooey-рецепт).
          #pill-uneven (feTurbulence + feDisplacementMap) УДАЛЁН: панель не
          должна собирать ЧЕТЫРЕ стеклянных механизма одновременно
          (backdrop + displacement + goo + градиенты). Фильтр НЕ в backdrop —
          расслоения стекла на Android нет (урок P0.2). */}
      <svg
        aria-hidden="true"
        focusable="false"
        width="0"
        height="0"
        className="pill-svg-defs"
      >
        <defs>
          <filter
            id="pill-goo"
            x="-8%"
            y="-18%"
            width="116%"
            height="136%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation="4.5"
              result="blur"
            />

            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
              result="goo"
            />

            <feComposite
              in="SourceGraphic"
              in2="goo"
              operator="atop"
            />
          </filter>
        </defs>
      </svg>

      {/* Нижняя навигация — плавающая «пилюля» Liquid Glass. ОДИН shell:
          GLASS SHELL → CAUSTICS → LIQUID LENS (goo, ПОД кнопками) → RIM →
          ICONS+LABELS. Линза живёт ВНУТРИ панели (6px от кромки, не выпирает),
          кнопки ВСЕГДА выше неё. Search Mode (searchOpen) и клавиатура
          (html.kb-open) → панель скрыта display:none, без анимаций.
          Скрытых form-controls (.pill-haptic) в панели НЕТ и НЕ возвращать. */}
      <nav
        className={cn(
          "pill-nav lg:hidden",
          /* PHASE2 ТЗ 2.8–2.10: клавиатура — мгновенный display:none (без
             переходов, как и было); ПОИСК — морф-переход единого стекла:
             панель уходит вниз/сжимается, search surface приезжает снизу.
             CSS-транзишны симметричны и прерываемы в обе стороны. */
          keyboardOpen && "pill-hidden",
          searchOpen && "pill-morph-out"
        )}
        aria-label="Нижняя навигация"
      >
        <div className="pill-wrap">
          <div
            ref={shellRef}
            className="pill-shell"
          >
            {/* Фоновая оптика: статичные каустики (без SVG displacement) */}
            <span
              className="pill-caustic"
              aria-hidden="true"
            />

            {/* Жидкая линза ПОД кнопками: призрак + основная капля.
                pointer-events:none — тапы проходят к кнопкам пилюли */}
            <div
              ref={gooRef}
              className="pill-goo"
              aria-hidden="true"
            >
              <span
                ref={ghostRef}
                className="pill-ghost"
              />

              <span
                ref={bubbleRef}
                className="pill-bubble"
              />
            </div>

            {/* Кромка стекла */}
            <span
              className="pill-rim"
              aria-hidden="true"
            />

            {/* ВСЕ кнопки находятся ВЫШЕ линзы */}
            <div className="pill-controls">
              {NAV.map(({ key, short, Icon }) => {
                const on =
                  view === key &&
                  !productId;

                return (
                  <button
                    key={key}
                    type="button"
                    ref={(element) => {
                      itemRefs.current[key] = element;
                    }}
                    className={cn(
                      "pill-item",
                      on && "is-on"
                    )}
                    aria-current={
                      on ? "page" : undefined
                    }
                    onClick={(event) => {
                      if (key === "catalog") {
                        goCatalog(event.currentTarget);
                        return;
                      }

                      usePortal
                        .getState()
                        .setView(key);

                      playTick("tap");
                    }}
                  >
                    <Icon
                      size={21}
                      strokeWidth={2.05}
                    />

                    <span className="pill-label">
                      {short}
                    </span>
                  </button>
                );
              })}

              {/* Поиск — РЯД ПИЛЮЛИ, без разделителя и без отдельного круга */}
              <button
                type="button"
                className="pill-search"
                aria-label="Поиск"
                aria-expanded={searchOpen}
                onClick={toggleSearch}
              >
                <Search
                  size={21}
                  strokeWidth={2.05}
                />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Применённый поиск — плавающий чип над панелью:
          видно активный фильтр + сброс одним тапом */}
      {searchQuery && !searchOpen && (
        <div className="search-chip" role="status">
          <Search size={13} strokeWidth={2.4} className="shrink-0 text-[color:var(--brand)]" />
          <span className="min-w-0 truncate text-[12.5px] font-semibold text-foreground">
            Поиск: «{searchQuery}»
          </span>
          <button
            type="button"
            aria-label="Сбросить поиск"
            onClick={() => {
              usePortal.getState().applySearch(null);
            }}
            className="search-chip-x"
          >
            <X size={13} strokeWidth={2.6} />
          </button>
        </div>
      )}

      {/* Подвесной поиск — стеклянная карточка НА МЕСТЕ панели (панель скрыта):
          ПРЕДСМОНТИРОВАНА (скрыта visibility:hidden), видимость управляется
          ТОЛЬКО React-состоянием searchOpen (класс is-open из рендера).
          Закрытие: крестик справа, свайп вниз, Escape, тап мимо.
          При открытой клавиатуре карточка поднимается на --kb-overlay
          (реальное перекрытие visualViewport — см. use-visual-viewport). */}
      <div
        ref={popRef}
        className={cn(
          "search-pop",
          searchOpen && "is-open"
        )}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchBar />
          </div>
          <button
            type="button"
            aria-label="Закрыть поиск"
            onClick={closeSearchPop}
            className="search-pop-close"
          >
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
      </div>

      <PhotoViewer />
    </div>
  );

}
