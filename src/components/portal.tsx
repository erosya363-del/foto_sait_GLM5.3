"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
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
import { ViewportDebug } from "@/components/viewport-debug";
import { SearchBar } from "@/components/search-bar";
import { StockView } from "@/components/stock-view";
import { CatalogView } from "@/components/catalog-view";
import { ProductView } from "@/components/product-view";
import { UploadSheet } from "@/components/upload-sheet";
import { AdminView } from "@/components/admin-view";
import { PhotoViewer } from "@/components/photo-viewer";

const NAV: Array<{ key: View; label: string; short: string; Icon: typeof Boxes }> = [
  { key: "catalog", label: "Каталог фото", short: "Каталог", Icon: Images },
  { key: "stock", label: "Остатки", short: "Остатки", Icon: Boxes },
  { key: "upload", label: "Загрузка", short: "Загрузка", Icon: UploadCloud },
  { key: "admin", label: "Админ", short: "Админ", Icon: ShieldCheck },
];

/* PHASE2 ТЗ 3.1: горизонтальная структура разделов — индекс определяет
   направление перехода (newIndex > oldIndex → forward и т.д.).
   PHASE 2.4 §4.2: «upload» ИЗЪЯТ из разделов — это сценарный sheet
   (store.uploadOpen); свайп страниц Каталог → Остатки → Админ. */
const VIEW_ORDER: View[] = ["catalog", "stock", "admin"];

const VIEW_COMPONENTS: Record<View, ComponentType> = {
  catalog: CatalogView,
  stock: StockView,
  /* PHASE 2.4 §4.2: upload больше НЕ раздел — рендерится UploadSheet
     в Portal; здесь стаб для полноты Record (view:"upload" невалиден и
     мигрируется в "catalog" в restore/popstate) */
  upload: () => null,
  admin: AdminView,
};

/* PHASE2 ТЗ 3.1/3.2: направленные горизонтальные переходы. Анимируются
   ТОЛЬКО transform: translate3d и умеренная opacity — никаких blur/height
   на всей странице. custom.dir задаёт сторону входа/выхода; custom.enterX
   (px) — вход с позиции, где палец оставил соседний раздел (handoff после
   интерактивного свайпа); custom.instant — нулевая длительность для кадра
   handoff (контент уже визуально на месте). */
const EASE_OUT: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

const pageVariants = {
  enter: (c: { dir?: number; enterX?: number; instant?: boolean } | undefined) => {
    if (c?.instant) return { x: 0, opacity: 1, transition: { duration: 0 } };
    if (c?.enterX !== undefined)
      return { x: c.enterX, opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } };
    return { x: `${(c?.dir ?? 1) * 42}%`, opacity: 0.6, transition: { duration: 0.24, ease: EASE_OUT } };
  },
  center: { x: 0, opacity: 1, transition: { duration: 0.24, ease: EASE_OUT } },
  exit: (c: { dir?: number; instant?: boolean } | undefined) => {
    if (c?.instant) return { x: 0, opacity: 0, transition: { duration: 0 } };
    return { x: `${-(c?.dir ?? 1) * 46}%`, opacity: 0, transition: { duration: 0.2, ease: "easeIn" as const } };
  },
};

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
    «Обухов (склад)»/«Склад онлайн»/приставок — просто Каталог/Остатки/…)
    PHASE 2.4: ветки «upload» больше нет — это не раздел. */
function useHeaderTitle() {
  const view = usePortal((s) => s.view);
  const productId = usePortal((s) => s.productId);
  if (productId) return "Каталог";
  if (view === "stock") return "Остатки";
  if (view === "admin") return "Админ";
  return "Каталог";
}

/**
 * PHASE 2.4 §4.3: открыть upload sheet (action, НЕ переход раздела).
 * Коисстенция (§5): поиск закрывается корректно, активный жест панели
 * отменяется ДО открытия; committed view остаётся прежним под sheet.
 */
function openUploadSheet() {
  const s = usePortal.getState();

  if (s.searchOpen) {
    s.setSearchOpen(false);
  }

  if (!s.uploadOpen) {
    s.setUploadOpen(true);
  }

  playTick("tap");
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
  const uploadOpen = usePortal((s) => s.uploadOpen); // PHASE 2.4 §4.2

  /* ── Нативная iOS-оболочка (AskonaApp): мост «системный таб-бар ↔ SPA» ──
     В Safari/PWA/Android — no-op (флаг __ASKONA_NATIVE_IOS__ не выставлен).
     В нативной оболочке: таб-бар iOS переключает разделы через
     native-tab-change, сайт сообщает о смене раздела через tabChanged. */
  useEffect(() => initNativeIOSBridge(), []);

  /* ── Пилюля: ОДНО статичное стекло + ЖИДКАЯ линза ПОД кнопками ──
     Архитектура (ТЗ v4): GLASS SHELL → BACKGROUND/CAUSTICS → LIQUID LENS →
     RIM → ICONS+LABELS. Активный пункт = линза .pill-bubble внутри .pill-goo
     (SVG-goo-фильтр): линза движется ПЕРМАНЕНТНОЙ rAF-пружиной с «тянучкой»
     (scaleX по скорости — растяжение при разгоне, сужение при оседании).
     PHASE 2.2: ВТОРАЯ ЛИНЗА-ПРИЗРАК (.pill-ghost) УДАЛЕНА — визуально не
     успевала за основной и читалась как отдельный «догоняющий» блоб.
     Осталась ОДНА капля. Кнопки ВСЕГДА выше линзы (z-слои в CSS).
     Контроллер живёт в ОДНОМ []-эффекте и ПЕРЕЖИВАЕТ смены вкладок:
     быстрые Каталог→Остатки→Загрузка за 100 мс — это одно непрерывное
     движение (меняется только target, rAF не пересоздаётся). */
  const shellRef = useRef<HTMLDivElement | null>(null);
  const gooRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const itemRefs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});

  /* Состояние пружин (refs, НЕ setState — ноль ререндеров в кадре).
     PHASE 2.3: ТРИ пружины в ОДНОМ rAF (§1.11/1.12 — не хаотично, а
     разделённые) + bridge-фактор:
       position (k=150, d=23) — полёт линзы;
       width    (k=170, d=25) — ширина: single ↔ bridge без скачков;
       press    (k=220, d=26) — вспухание 0..1 (высота выше панели, спекуляр);
       bridge   0..1 — «сила растяжения» sin(PI·t) — спекуляр/стекло. */
  const dropAnim = useRef({
    x: 0,
    velocity: 0,

    target: 0,

    w: 0,
    wv: 0,
    targetW: 0,

    p: 0,
    pv: 0,
    targetP: 0,

    bridge: 0,
    bridgeTarget: 0,

    /* PHASE 2.4 §1.1: режим ПРЯМОГО слежения (активный drag по панели):
       позиция/ширина идут экспоненциальным сглаживанием за пальцем,
       пружины подключаются на release/settle. */
    dragging: false,

    /* Кэш последней записи в style — пропуск идентичных записей */
    lastW: -1,
    lastP: -1,
    lastBridge: -1,

    raf: 0,
    last: 0,

    initialized: false,
  });

  /* Точки управления линзой для эффектов: drive — цель/ширина,
     press — вспухание (pointerdown/up), bridge — сила растяжения,
     hide — погасить (открыт товар). Заполняются контроллером. */
  const drivePillRef =
    useRef<(x: number, width: number, animate?: boolean) => void>(() => {});

  const pressPillRef = useRef<(on: boolean) => void>(() => {});

  /* PHASE 2.4 §1.1: включение/выключение прямого слежения (active drag) */
  const dragModePillRef = useRef<(on: boolean) => void>(() => {});

  const bridgePillRef = useRef<(b: number) => void>(() => {});

  const hidePillRef = useRef<() => void>(() => {});

  /* PHASE 2.3 §12: отмена активного жеста панели (например, открылся поиск) */
  const cancelPanelGestureRef = useRef<() => void>(() => {});

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

    if (!shell || !goo || !bubble) return;

    const a = dropAnim.current;

    const cancel = () => {
      if (a.raf) {
        cancelAnimationFrame(a.raf);
        a.raf = 0;
      }
    };

    /* PHASE 2.3: ЕДИНСТВЕННОЕ место записи геометрии линзы (supplement F:
       никакого wrapper-слоя — translate3d + scaleX + scaleY объединены).
       scaleX = 1 + velocity stretch (коэфф. 0.0012, потолок 0.14 — supplement C);
       scaleY = rest 0.90 (54px внутри панели 64px) → press 1.20 (72px — линза
       выпирает выше/ниже панели, §1.3/D), объём сохраняется от velocity. */
    const render = () => {
      /* CRITICAL STABILITY 4.1/4.3: линза в drag — ЕДИНАЯ капсула press-размера.
         velocity-тянучка оставлена ТОЛЬКО как очень лёгкий акцент: максимум
         НЕСКОЛЬКО процентов (потолок 0.14 → 0.04, ТЗ 4.3 «можно оставить ОЧЕНЬ
         небольшое velocity stretch, но максимум несколько процентов»).
         Растяжения в мост/«колбасу» больше нет по определению: ширина в жесте
         задаётся gesture-контроллером как константа press-капсулы. */
      const stretch = Math.min(
        Math.abs(a.velocity) * 0.001,
        0.04
      );

      const scaleX = 1 + stretch;
      const scaleY = (0.9 + 0.3 * a.p) * (1 - stretch * 0.24);

      bubble.style.transform =
        `translate3d(${a.x.toFixed(2)}px,0,0) ` +
        `scaleX(${scaleX.toFixed(4)}) ` +
        `scaleY(${scaleY.toFixed(4)})`;

      /* width-пружина: пишем только при изменении (layout — только у линзы) */
      if (Math.abs(a.w - a.lastW) > 0.05) {
        a.lastW = a.w;
        bubble.style.width = `${a.w.toFixed(2)}px`;
      }

      /* Спекуляр линзы реагирует на давление (supplement H):
         rest 0.55 → press +0.18 → bridge-центр +0.06 — см. .pill-bubble::after */
      if (Math.abs(a.p - a.lastP) > 0.004) {
        a.lastP = a.p;
        bubble.style.setProperty("--lens-press", a.p.toFixed(3));
      }
      if (Math.abs(a.bridge - a.lastBridge) > 0.004) {
        a.lastBridge = a.bridge;
        bubble.style.setProperty("--lens-bridge", a.bridge.toFixed(3));
      }
    };

    const settle = (x: number) => {
      cancel();

      a.x = x;
      a.target = x;
      a.velocity = 0;

      a.w = a.targetW;
      a.wv = 0;

      a.p = a.targetP;
      a.pv = 0;

      a.bridge = a.bridgeTarget;

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
       * PHASE 2.4 §1.1 — DIRECT TRACKING при активном drag по панели:
       * экспоненциальное сглаживание с τ≈33 мс — линза визуально
       * «привязана» к пальцу (iPhone tab bar feel), без медленного
       * хвоста пружины k=150 (период ~0.5 c — тот самый «лаг»).
       * velocity считается по ФАКТИЧЕСКОМУ смещению кадра — тянучка
       * scaleX (§1.8) работает от реальной скорости, без разрыва.
       * Упругая физика проявляется на release: dragMode снимается,
       * пружина подхватывает с текущих x/velocity — без скачка.
       */
      if (a.dragging) {
        /* CRITICAL STABILITY 4.8: τ≈22 мс (экспериментальная сетка ТЗ:
           16/22/28/33 — выбран самый быстрый без headless-дрожания;
           rate = 1000/τ ≈ 45). Ощущение direct manipulation;
           ширина капсулы — сглаживание с чуть большим τ (36 мс): размер
           визуально постоянен, без импульсного «дыхания». */
        const kx = 1 - Math.exp(-dt * 45);
        const nx = a.x + (a.target - a.x) * kx;
        a.velocity = dt > 0 ? (nx - a.x) / dt : 0;
        a.x = nx;

        const kw = 1 - Math.exp(-dt * 28);
        const nw = a.w + (a.targetW - a.w) * kw;
        a.wv = dt > 0 ? (nw - a.w) / dt : 0;
        a.w = nw;
      } else {
        /*
         * Position spring (k=150, d=23) — settle/release/полёт по тапу.
         * Не должна перескакивать цель.
         */
        const mainForce =
          (a.target - a.x) * 150 -
          a.velocity * 23;

        a.velocity += mainForce * dt;
        a.x += a.velocity * dt;

        /*
         * Width spring (k=170, d=25) — PHASE 2.3 §1.12:
         * single → bridge → single без прямоугольных скачков ширины.
         */
        const widthForce =
          (a.targetW - a.w) * 170 -
          a.wv * 25;

        a.wv += widthForce * dt;
        a.w += a.wv * dt;
      }

      /*
       * Press spring (k=220, d=26) — PHASE 2.3 §1.5/D:
       * вспухание на pointerdown, пружинный сбор на release.
       */
      const pressForce =
        (a.targetP - a.p) * 220 -
        a.pv * 26;

      a.pv += pressForce * dt;
      a.p += a.pv * dt;

      /* bridge: геометрия sin(PI·t) уже плавная — досглаживаем смену сегмента;
         при активном drag подстройка мгновеннее (масса обязана поспевать) */
      a.bridge += (a.bridgeTarget - a.bridge) * Math.min(1, dt * (a.dragging ? 34 : 20));

      render();

      const settled =
        !a.dragging &&
        Math.abs(a.target - a.x) < 0.25 &&
        Math.abs(a.velocity) < 2 &&
        Math.abs(a.targetW - a.w) < 0.25 &&
        Math.abs(a.wv) < 2 &&
        Math.abs(a.targetP - a.p) < 0.005 &&
        Math.abs(a.pv) < 0.4;

      if (settled) {
        settle(a.target);
        return;
      }

      a.raf = requestAnimationFrame(step);
    };

    const ensureRaf = () => {
      if (!a.raf) {
        a.last = 0;
        a.raf = requestAnimationFrame(step);
      }
    };

    drivePillRef.current = (
      x: number,
      width: number,
      animate = true
    ) => {
      /* PHASE 2.3: ширина идёт через ПРУЖИНУ (targetW), а не мгновенной
         записью — переходы single ↔ bridge пружинные (§1.12). */
      a.targetW = width;

      bubble.style.opacity = "1";

      if (!a.initialized) {
        a.initialized = true;
        a.w = width;
        a.lastW = width;
        bubble.style.width = `${width.toFixed(2)}px`;
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

      ensureRaf();
    };

    /* PHASE 2.3 §1.5/D: вспухание линзы (press). При reduce-motion
       геометрия не анимируется — остаётся только отклик контента. */
    pressPillRef.current = (on: boolean) => {
      if (reducedMotion.current) return;

      a.targetP = on ? 1 : 0;

      if (on) goo.classList.add("is-live");

      ensureRaf();
    };

    /* PHASE 2.4 §1.1: прямой режим слежения включается при входе в drag
       и выключается на release/cancel — пружины подхватывают с текущих
       x/velocity, скачка геометрии нет. */
    dragModePillRef.current = (on: boolean) => {
      a.dragging = on;

      if (!on) return;

      goo.classList.add("is-live");
      ensureRaf();
    };

    /* PHASE 2.3 §B.3: сила растяжения стекла (sin(PI·t)); подушку ширины
       считает gesture, сюда приходит готовое значение 0..1 — для спекуляра */
    bridgePillRef.current = (b: number) => {
      a.bridgeTarget = b;

      ensureRaf();
    };

    hidePillRef.current = () => {
      cancel();

      bubble.style.opacity = "0";
      goo.classList.remove("is-live");

      a.velocity = 0;
      a.wv = 0;
      a.pv = 0;
      a.dragging = false;
      a.targetP = 0;
      a.p = 0;
      a.lastP = -1;
      a.bridgeTarget = 0;
      a.bridge = 0;
      a.lastBridge = -1;
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
     * CRITICAL STABILITY 6.4: resize НЕ должен создавать полёт, и — главное —
     * ВЕРТИКАЛЬНЫЕ resize (скрытие/показ browser-chrome toolbar) НЕ должны
     * пересчитывать/сбрасывать геометрию линзы: горизонтальной позиции линзы
     * интересны ТОЛЬКО ширина shell и геометрия вкладок. Подмена цели на ту же
     * самую выглядела как reset/settle (панель «прыгала» при движении тулбара
     * в браузере). Теперь: пересинк ТОЛЬКО при фактической смене ширины shell
     * (±0.5px); высотные колебания игнорируются полностью.
     */
    let lastSyncShellW = shell.clientWidth;

    const ro = new ResizeObserver(() => {
      const w = shell.clientWidth;
      if (Math.abs(w - lastSyncShellW) < 0.5) return; /* высота/toolbar — мимо */
      lastSyncShellW = w;
      syncPosition(false);
    });

    ro.observe(shell);

    const onResize = () => {
      const w = shell.clientWidth;
      if (Math.abs(w - lastSyncShellW) < 0.5) return;
      lastSyncShellW = w;
      syncPosition(false);
    };

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
  /* PHASE2 3.10: момент последнего автоматического закрытия поиска (тап мимо).
     Касание, которое ЭТО закрытие вызвало, не должно продолжиться свайпом
     раздела: pointerdown вне поиска срабатывает РАНЬШЕ touchstart жеста. */
  const searchClosedAtRef = useRef(0);
  useEffect(() => {
    usePortal.getState().restore();
    window.history.replaceState(snapshot(), "");
  }, []);

  /* ── PHASE2 B2 + PHASE 2.3: gesture панели — ЕДИНАЯ физическая линза ──
     ТЗ 2.4–2.6: VISUAL PREVIEW (линза следует за пальцем) отделён от
     COMMITTED VIEW (раздел меняется ТОЛЬКО на pointerup); тап (|dx| ≤ 8px)
     не перехватывается. PHASE 2.3 добавляет физику стекла:
       PRESS     — pointerdown: линза вспухает (height 54→72px, width ×1.10),
                   content сжимается, мягкий haptic ОДНОВРЕМЕННО с визуалом;
       DRAG      — линза непрерывно следует за реальным clientX;
       BRIDGE    — между соседними вкладками ОДНА масса накрывает ОБЕ:
                   TWO-PHASE EDGE STRETCH (supplement B) — ведущая кромка
                   тянется к цели, задняя догоняет после середины сегмента;
                   bridge = sin(PI·t) — подушка ширины + спекуляр;
       SETTLE    — release: commit/settleBack, сбор к одной вкладке;
                   cancel/pointercancel — полный возврат без изменений.
     is-lens-covered = вкладки, чьи центры накрыты целевой массой стекла
     (обновляется только при СМЕНЕ пары); is-on НЕ меняется до commit.
     Пересечение центра вкладки = смена anchor + ОДИН playStep (§5.2 B).
     Ноль React-state в кадре: только refs/классы/пружины (§2.4). */
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    type Hit = { key: View; el: HTMLButtonElement; dist: number };
    type TabGeo = { key: View; left: number; width: number; right: number; center: number };

    let phase: "idle" | "tracking" | "dragging" = "idle";
    let startX = 0;
    let pointerId = -1;
    /* Левая кромка shell в viewport-координатах — ОДИН layout-чтение
       при входе в drag, дальше только математика (§15/2.4). */
    let dragLeft = 0;

    /* Снимок геометрии вкладок — ОДИН раз на pointerdown; без layout-чтений
       в цикле жеста. */
    let geo: TabGeo[] = [];
    let anchorIdx = 0;            // вкладка, к которой «прикреплена» линза
    let coveredKeys: View[] = []; // текущие is-lens-covered

    const snapshotGeo = (): TabGeo[] => {
      const list: TabGeo[] = [];
      for (const [key, el] of Object.entries(itemRefs.current) as Array<[View, HTMLButtonElement | null]>) {
        if (!el) continue;
        const left = el.offsetLeft;
        const width = el.offsetWidth;
        list.push({ key, left, width, right: left + width, center: left + width / 2 });
      }
      list.sort((m, n) => m.left - n.left);
      return list;
    };

    /* Зона вкладки = область ближе к её центру (границы — середины между
       центрами) — та же квантизация, что у commit через nearestItem. */
    const zoneAt = (fx: number): number => {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < geo.length; i++) {
        const d = Math.abs(fx - geo[i].center);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best;
    };

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

    /* Обновление is-lens-covered ТОЛЬКО при реальной смене пары (§2.4) */
    const setCovered = (keys: View[]) => {
      const same =
        keys.length === coveredKeys.length &&
        keys.every((k) => coveredKeys.includes(k));
      if (same) return;
      for (const [key, el] of Object.entries(itemRefs.current) as Array<[View, HTMLButtonElement | null]>) {
        if (!el) continue;
        const was = coveredKeys.includes(key);
        const now = keys.includes(key);
        if (was !== now) el.classList.toggle("is-lens-covered", now);
      }
      coveredKeys = keys;
    };

    const stopDragClick = (e: MouseEvent) => {
      if (phase !== "dragging") return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    const unbindClickGuard = () => {
      shell.removeEventListener("click", stopDragClick, { capture: true });
    };

    const settleBack = () => {
      const s = usePortal.getState();
      const item = itemRefs.current[s.view];
      if (item && !s.productId) {
        drivePillRef.current(item.offsetLeft, item.offsetWidth, true);
      }
    };

    /* Полная сборка стекла после release/cancel (§4/K-16: ничего «залипшего») */
    const clearGestureVisual = () => {
      setCovered([]);
      bridgePillRef.current(0);
      pressPillRef.current(false);
    };

    /* PHASE 2.4 §1.1: сборка ВКЛЮЧАЯ прямой режим слежения (пружины
       подхватывают геометрию на release/cancel) */
    const endDragMode = () => {
      dragModePillRef.current(false);
    };

    /* TWO-PHASE EDGE STRETCH УДАЛЁН (CRITICAL STABILITY 4.1–4.3).
       Новая модель по ТЗ: при drag линза — ЕДИНАЯ КАПСУЛА press-размера
       (width = pressWidth anchor-вкладки, height = press), следует за пальцем
       (τ≈22 мс) и НЕ меняет размер. Мост как растяжение больше не существует;
       bridge-фактор в спекуляр больше не подаётся (0).
       pressScale — ТЗ 4.2: +15–20% к обычной ширине (выбрано 1.18). */
    const pressScale = 1.18;
    /* Минимальное перекрытие линзы и вкладки, при котором вкладка считается
       covered (ТЗ 4.4: реальное пересечение lensRect vs вкладок, ОБЕ
       одновременно накрытые — covered; исключает шум касания кромкой в 1px). */
    const COVER_MIN = 6;
    /* Ширина shell — снимок на входе в drag (клапм капсулы внутри панели) */
    let shellW = 0;

    const capsuleW = (idx: number): number =>
      Math.max(24, geo[idx].width * pressScale);

    /* Единая капсула: центр = палец (кламп в панель), размер — press-константа;
       covered = РЕАЛЬНОЕ пересечение [left, left+w] с каждой вкладкой. */
    const applyFollow = (fx: number) => {
      const w = capsuleW(anchorIdx);
      const left = Math.max(0, Math.min(shellW - w, fx - w / 2));

      drivePillRef.current(left, w, true);
      bridgePillRef.current(0);

      const cov: View[] = [];
      for (const tab of geo) {
        const overlap =
          Math.min(left + w, tab.right) - Math.max(left, tab.left);
        if (overlap >= Math.min(COVER_MIN, tab.width * 0.25)) cov.push(tab.key);
      }
      if (cov.length === 0) cov.push(geo[zoneAt(fx)].key);
      setCovered(cov);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (usePortal.getState().productId) return; /* товар открыт — линза скрыта */
      /* Кнопка поиска — свой отклик: press/drag линзы на ней не начинаем */
      if ((e.target as Element | null)?.closest?.(".pill-search")) return;
      phase = "tracking";
      startX = e.clientX;
      pointerId = e.pointerId;
      geo = snapshotGeo();
      shellW = shell.clientWidth;
      anchorIdx = zoneAt(e.clientX - shell.getBoundingClientRect().left);
      coveredKeys = [];
      /* PRESS: визуал + хаптика ОДНОВРЕМЕННО (§1.5/I); ширина — press-капсула
         ×1.18 (ТЗ 4.2), высота растёт пружиной press (54→72px) */
      pressPillRef.current(true);
      playTick("press");
      const tab = geo[anchorIdx];
      if (tab) {
        drivePillRef.current(tab.left, tab.width * pressScale, true);
        setCovered([tab.key]);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (phase === "idle" || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      if (phase === "tracking" && Math.abs(dx) > 8) {
        phase = "dragging";
        dragLeft = shell.getBoundingClientRect().left;
        shellW = shell.clientWidth;
        shell.addEventListener("click", stopDragClick, { capture: true });
        /* PHASE 2.4 §1.1: активный drag — прямое слежение за пальцем (τ≈22 мс);
           CRITICAL STABILITY 4.6: на время drag подсветка is-on старой вкладки
           гаснет (CSS .pill-shell.is-dragging) — highlight определяет ТОЛЬКО
           covered; committed view сохраняется логически до commit. */
        shell.classList.add("is-dragging");
        dragModePillRef.current(true);
      }
      if (phase !== "dragging") return;
      /* НЕПРЕРЫВНЫЙ preview за РЕАЛЬНЫМ пальцем; nearestItem — ТОЛЬКО в finish().
         CRITICAL STABILITY 4.3: линза едет единой капсулой press-размера. */
      const fx = e.clientX - dragLeft;
      const z = zoneAt(fx);
      if (z !== anchorIdx) {
        anchorIdx = z;
        playStep();
      }
      applyFollow(fx);
    };

    const finish = (clientX: number) => {
      const wasDragging = phase === "dragging";
      const wasTracking = phase === "tracking";
      phase = "idle";
      shell.classList.remove("is-dragging");
      endDragMode();
      /* §4: линза НИКОГДА не остаётся увеличенной/растянутой/над панелью;
         CRITICAL STABILITY 4.7: press-размер → плавный settle → нормальный rest */
      clearGestureVisual();
      unbindClickGuard();
      if (wasDragging) {
        const hit = nearestItem(clientX);
        const s = usePortal.getState();
        if (hit && hit.key !== s.view && !s.productId) {
          /* PHASE 2.4 §4.3: «Загрузка» — ACTION (glass sheet), не раздел:
             committed view остаётся прежним под sheet; линза возвращается
             к активной вкладке сама (settleBack), sheet открывается. */
          if (hit.key === "upload") {
            usePortal.getState().setUploadOpen(true);
            playTick("tap");
            settleBack();
            return;
          }
          /* COMMIT: только на отпускании (ТЗ 2.5). Эффект [view] довезёт линзу. */
          usePortal.getState().setView(hit.key);
          playTick("tap"); /* commit haptic (§5.2 C) */
          return;
        }
        /* Отпустил между вкладками / на текущей — плавный settle к активной */
        settleBack();
        return;
      }
      if (wasTracking) {
        /* Простой тап: press соберётся пружиной; коммит сделает click
           кнопки (он НЕ подавлен) — двойного отклика нет (§5.3). */
        settleBack();
      }
    };

    const onUp = (e: PointerEvent) => {
      if (phase === "idle" || e.pointerId !== pointerId) return;
      finish(e.clientX);
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== pointerId && pointerId !== -1) return;
      const wasActive = phase !== "idle";
      phase = "idle";
      if (wasActive) {
        shell.classList.remove("is-dragging");
        endDragMode();
        clearGestureVisual();
        settleBack();
      }
      unbindClickGuard();
    };

    shell.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });

    /* PHASE 2.3 §12: отмена активного жеста извне (открылся поиск и т.п.) */
    cancelPanelGestureRef.current = () => {
      if (phase === "idle") return;
      phase = "idle";
      shell.classList.remove("is-dragging");
      endDragMode();
      clearGestureVisual();
      settleBack();
      unbindClickGuard();
    };

    return () => {
      shell.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      unbindClickGuard();
    };
  }, []);

  /* PHASE 2.3 §12: если поиск открывается ВО ВРЕМЯ press/drag панели
     (второй палец, «/» на десктопе) — жест корректно отменяется ДО морфа:
     под исчезающей панелью не остаётся вспухшей линзы и covered-классов. */
  useEffect(() => {
    if (searchOpen) cancelPanelGestureRef.current();
  }, [searchOpen]);

  /* PHASE 2.4 §5: коисстенция upload sheet — открытие закрывает поиск,
     сбрасывает жест панели; под sheet свайп страниц и drag панели
     заблокированы backdrop'ом + гейтами свайпа. */
  useEffect(() => {
    if (!uploadOpen) return;
    cancelPanelGestureRef.current();
    if (usePortal.getState().searchOpen) {
      usePortal.getState().setSearchOpen(false);
    }
  }, [uploadOpen]);

  /* ── PHASE2 B3: горизонтальная навигация по вкладкам ──
   Направление переходов — по индексам VIEW_ORDER (3.1). Интерактивный
   edge-swipe (3.3–3.7): раздел следует за пальцем, соседний монтируется
   рядом; НОЛЬ React-рендеров на кадр (3.12) — только прямые transform-записи
   и WAAPI-анимации handoff; линза панели получает общий progress (3.9). */
  const mainRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const neighborRef = useRef<HTMLDivElement | null>(null);
  const dirRef = useRef<1 | -1>(1);
  const instantRef = useRef(false);
  const busyRef = useRef(false);
  const [swipe, setSwipe] = useState<{ dir: 1 | -1; target: View; top: number } | null>(null);
  type SwipeGesture = {
    dir: 1 | -1;
    target: View;
    startX: number;
    startY: number;
    lastX: number;
    lastT: number;
    vx: number;
    dx: number;
    w: number;
    active: boolean;
    edge: boolean;
  };
  const swipeRef = useRef<SwipeGesture | null>(null);

  /* PHASE 2.4 §2: отложенная очистка inline-transform/WAAPI после КОММИТА
     смены view. Раньше done() сбрасывал transform ДО React-коммита — старый
     view вспыхивал на 1–3 кадра («повторное появление»). Теперь финальные
     кадры держит fill:"forwards", а сброс делает useLayoutEffect ниже. */
  const swipeClearRef = useRef<(() => void) | null>(null);

  /* PHASE 2.4 §2: очистка геометрии свайпа — строго ПОСЛЕ коммита render'а,
     в котором новый view смонтирован instant, а соседний overlay снят:
     один атомарный paint, без кадра с возвратом старого view. */
  useLayoutEffect(() => {
    const cleanup = swipeClearRef.current;
    if (!cleanup) return;
    swipeClearRef.current = null;
    cleanup();
  }, [view, productId]);

  /* Направление ТАП-перехода — вычисляется В РЕНДЕРЕ (ref-корректировка,
     разрешённый паттерн), чтобы enter-вариант нового кадра знал сторону. */
  const prevViewRef = useRef(view);
  if (prevViewRef.current !== view) {
    const a = VIEW_ORDER.indexOf(prevViewRef.current);
    const b = VIEW_ORDER.indexOf(view);
    if (a >= 0 && b >= 0) dirRef.current = b > a ? 1 : -1;
    prevViewRef.current = view;
  }
  /* custom.instant/enterX живут один кадр handoff — снимаем после коммита */
  useEffect(() => {
    instantRef.current = false;
  }, [view, productId]);

  /* ── PHASE2 B3: интерактивный edge-swipe разделов (ТЗ 3.3–3.10) ──
   Один touch-поток на весь срок жизни []-эффекта; в кадре — только
   transform-записи (3.12). Вертикальный интент (3.5) отпускает жест
   браузеру ДО активации; после активации touchmove preventDefault —
   вертикальный скролл не вклинивается. Коммит: |dx|>25% ширины ИЛИ
   velocity>0.5 px/ms (3.4). Края — rubber-band без коммита (3.7). */
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const detach = () => {
      window.removeEventListener("touchmove", onTm);
      window.removeEventListener("touchend", onTe);
      window.removeEventListener("touchcancel", onTc);
    };

    const gatesClosed = () => {
      const st = usePortal.getState();
      return st.viewerOpen || st.searchOpen || st.filtersOpen || st.uploadOpen || Boolean(st.productId);
    };

    const isExcluded = (target: Element | null): boolean => {
      if (!target) return true;
      if (
        target.closest(
          'input, textarea, select, [contenteditable], [data-no-tab-swipe], .pswp, [role="dialog"], [role="alertdialog"], .search-pop, .pill-nav, .viewer-sheet-backdrop, .search-chip'
        )
      )
        return true;
      /* Горизонтальный скроллер на пути жеста — он владеет осью X (3.6) */
      let el: Element | null = target;
      while (el && el !== main) {
        if (el.scrollWidth > el.clientWidth + 4) {
          const ox = getComputedStyle(el).overflowX;
          if (ox === "auto" || ox === "scroll") return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    const applyProgress = (dx: number) => {
      const g = swipeRef.current;
      if (!g || !contentRef.current) return;
      contentRef.current.style.transform = `translate3d(${dx.toFixed(1)}px,0,0)`;
      const nb = neighborRef.current;
      if (nb) nb.style.transform = `translate3d(${(g.dir * g.w + dx).toFixed(1)}px,0,0)`;
      /* 3.9: линза панели = общий navigation progress между якорями вкладок */
      const from = itemRefs.current[usePortal.getState().view];
      const to = itemRefs.current[g.target];
      if (from && to) {
        const p = Math.min(1, Math.abs(dx) / g.w);
        const x = from.offsetLeft + (to.offsetLeft - from.offsetLeft) * p;
        const width = from.offsetWidth + (to.offsetWidth - from.offsetWidth) * p;
        drivePillRef.current(x, width, true);
      }
    };

    const onTs = (e: TouchEvent) => {
      if (busyRef.current || swipeRef.current) return;
      if (e.touches.length !== 1) return;
      /* 3.10: поиск/товар/фильтры/просмотрщик открыты — свайпа нет.
         Касание, которое только что закрыло поиск тапом мимо, тоже
         не продолжается свайпом (pointerdown сработал раньше touchstart). */
      const stNow = usePortal.getState();
      if (stNow.viewerOpen || stNow.searchOpen || stNow.filtersOpen || stNow.uploadOpen || Boolean(stNow.productId)) return;
      if (performance.now() - searchClosedAtRef.current < 600) return;
      if (isExcluded(e.target as Element | null)) return;
      const t0 = e.touches[0];
      swipeRef.current = {
        dir: 1,
        target: usePortal.getState().view,
        startX: t0.clientX,
        startY: t0.clientY,
        lastX: t0.clientX,
        lastT: performance.now(),
        vx: 0,
        dx: 0,
        w: window.innerWidth,
        active: false,
        edge: false,
      };
      window.addEventListener("touchmove", onTm, { passive: false });
      window.addEventListener("touchend", onTe);
      window.addEventListener("touchcancel", onTc);
    };

    const onTm = (e: TouchEvent) => {
      const g = swipeRef.current;
      if (!g || e.touches.length !== 1) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const now = performance.now();

      if (!g.active) {
        const dx0 = x - g.startX;
        const dy0 = y - g.startY;
        /* 3.5 intent: вертикаль сильнее горизонтали → НЕ наш жест */
        if (Math.abs(dy0) > 8 && Math.abs(dy0) > Math.abs(dx0) * 1.25) {
          detach();
          swipeRef.current = null;
          return;
        }
        if (Math.abs(dx0) < 12 || Math.abs(dx0) <= Math.abs(dy0) * 1.25) return;
        /* 3.10: re-check на момент активации — тап мимо мог ЗАКРЫТЬ поиск
           (pointerdown outside срабатывает раньше touchstart), но жест,
           начавшийся в поиске, всё равно не должен переключать раздел. */
        if (gatesClosed()) {
          detach();
          swipeRef.current = null;
          return;
        }
        /* АКТИВАЦИЯ: фиксируем направление и соседний раздел */
        const st = usePortal.getState();
        const idx = VIEW_ORDER.indexOf(st.view);
        g.dir = dx0 < 0 ? 1 : -1;
        const targetIdx = idx + g.dir;
        g.edge = targetIdx < 0 || targetIdx >= VIEW_ORDER.length;
        if (!g.edge) {
          g.target = VIEW_ORDER[targetIdx];
          const header = document.querySelector("header");
          setSwipe({
            dir: g.dir,
            target: g.target,
            top: header ? header.getBoundingClientRect().bottom : 0,
          });
        }
        g.active = true;
      }

      /* Горизонталь захвачена — не пускаем вертикальный скролл (3.5) */
      e.preventDefault();

      const dxRaw = x - g.startX;
      /* 3.7: крайние вкладки — лёгкий rubber-band без коммита */
      const dx = g.edge ? dxRaw * 0.35 : dxRaw;
      const dt = Math.max(1, now - g.lastT);
      g.vx = (x - g.lastX) / dt;
      g.lastX = x;
      g.lastT = now;
      g.dx = dx;
      applyProgress(dx);
    };

    const finish = (committed: boolean) => {
      const g = swipeRef.current;
      detach();
      swipeRef.current = null;
      if (!g || !g.active) return;
      const c = contentRef.current;
      const nb = neighborRef.current;
      const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

      const doCommit =
        committed && !g.edge && nb !== null &&
        (Math.abs(g.dx) > g.w * 0.25 || (Math.abs(g.vx) > 0.5 && Math.abs(g.dx) > 60));

      if (!doCommit) {
        /* Отмена: пружина обратно (контент → 0, сосед → за экран).
           КРИТИЧНО: WAAPI без fill по завершении ОТКАТЫВАЕТСЯ к inline-style —
           поэтому в onfinish сбрасываем inline transform в финальное значение
           (иначе раздел зависал смещённым и мобильный viewport разъезжался). */
        busyRef.current = true;
        const anims: Animation[] = [];
        if (c) {
          const a = c.animate([{ transform: c.style.transform || "translate3d(0,0,0)" }, { transform: "translate3d(0px,0,0)" }], { duration: 190, easing: EASE });
          a.onfinish = () => {
            a.cancel();
            if (contentRef.current) contentRef.current.style.transform = "";
            setSwipe(null);
            busyRef.current = false;
          };
          a.oncancel = a.onfinish;
          anims.push(a);
        }
        if (nb) {
          nb.animate([{ transform: nb.style.transform || `translate3d(${g.dir * g.w}px,0,0)` }, { transform: `translate3d(${g.dir * g.w}px,0,0)` }], { duration: 190, easing: EASE });
        }
        const item = itemRefs.current[usePortal.getState().view];
        if (item) drivePillRef.current(item.offsetLeft, item.offsetWidth, true);
        if (!anims.length) {
          setSwipe(null);
          busyRef.current = false;
        }
        return;
      }

      /* КОММИТ: handoff — контент уезжает за экран, сосед встаёт на 0,
         затем мгновенная смена view (3.8: через официальный setView). */
      busyRef.current = true;
      instantRef.current = true;

      /* ── PHASE 2.4 §2: ПОЧЕМУ fill:"forwards" ──
         Раньше done() сбрасывал inline transform ДО React-коммита:
         между WAAPI-finish и коммитом старый view оставался смонтирован
         без смещения → кадры-два вспышки «старого экрана» («повторное
         появление»). Теперь финальные кадры ДЕРЖАТ обе анимации
         (контент за экраном, сосед на 0) до самого коммита; сброс
         выполняет useLayoutEffect [view] после монтажа нового view. */
      const anims: Animation[] = [];
      const done = () => {
        /* ОДИН batched-рендер: overlay снят, старый view мгновенно ушёл
           (exit.instant), новый встал на 0 (enter.instant) — без кадра-разрыва.
           inline transform здесь НЕ трогаем — его чистит useLayoutEffect. */
        usePortal.getState().setView(g.target);
        setSwipe(null);
        playTick("tap");
        busyRef.current = false;
      };
      if (c) {
        const a = c.animate([{ transform: c.style.transform || "translate3d(0,0,0)" }, { transform: `translate3d(${-g.dir * g.w}px,0,0)` }], { duration: 170, easing: EASE, fill: "forwards" });
        a.onfinish = done;
        a.oncancel = done;
        anims.push(a);
      } else done();
      if (nb) {
        const b = nb.animate([{ transform: nb.style.transform || `translate3d(${g.dir * g.w}px,0,0)` }, { transform: "translate3d(0px,0,0)" }], { duration: 170, easing: EASE, fill: "forwards" });
        anims.push(b);
      }
      swipeClearRef.current = () => {
        for (const an of anims) {
          try {
            an.cancel();
          } catch {
            /* уже завершена */
          }
        }
        if (contentRef.current) contentRef.current.style.transform = "";
      };
    };

    const onTe = (e: TouchEvent) => {
      if (e.touches.length === 0) finish(true);
    };
    const onTc = () => finish(false);

    main.addEventListener("touchstart", onTs, { passive: true });
    return () => {
      main.removeEventListener("touchstart", onTs);
      detach();
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
      searchClosedAtRef.current = performance.now();
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
        /* PHASE 2.4: легаси view:"upload" из истории — больше не раздел */
        view: st?.view === "upload" ? "catalog" : (st?.view ?? "catalog"),
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
      /* PHASE 2.4 §4.7: upload sheet — верхний слой: закрывается guard'ом
         (discard/abort), sheet слушает portal:upload-close */
      if (s.uploadOpen) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("portal:upload-close"));
        return;
      }
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

      {/* CRITICAL STABILITY 5.1/5.2: debug overlay полосы снизу —
          ТОЛЬКО с ?viewportDebug=1 (без параметра не рендерится) */}
      <ViewportDebug />

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
                onClick={(e) =>
                  key === "catalog"
                    ? goCatalog(e.currentTarget)
                    : key === "upload"
                      ? openUploadSheet() /* PHASE 2.4 §4.3: sheet, не раздел */
                      : usePortal.getState().setView(key)
                }
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

      {/* Контент. PHASE2 ТЗ 3.1: направленные горизонтальные переходы —
          custom.dir из VIEW_ORDER; popLayout — одновременный вход/выход;
          вертикальные opacity+y УБРАНЫ для переключения вкладок (3.1). */}
      <main ref={mainRef} className="relative z-10 overflow-x-clip pb-[calc(104px+var(--sab))] lg:ml-[248px] lg:pb-10">
        <div
          ref={contentRef}
          data-tab-swipe-content=""
          className="mx-auto w-full max-w-[1240px] px-4 pt-4 sm:px-6 lg:pt-6"
        >
          <AnimatePresence
            mode="popLayout"
            initial={false}
            custom={{ dir: dirRef.current, instant: instantRef.current }}
          >
            <motion.div
              key={productId ? `product-${productId}` : view}
              custom={{ dir: dirRef.current, instant: instantRef.current }}
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
            >
              {productId ? (
                <ProductView />
              ) : (
                (() => {
                  const Current = VIEW_COMPONENTS[view];
                  return <Current />;
                })()
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* PHASE2 ТЗ 3.3: neighbor-раздел рядом с текущим во время свайпа.
          Монтируется ОДИН раз на активации жеста (один рендер), движется
          transform-записями (ноль рендеров на кадр), снимается атомарно
          с коммитом/отменой. pointer-events:none — превью не кликабельно. */}
      {swipe && (
        <div
          ref={neighborRef}
          data-tab-swipe-neighbor=""
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-30 overflow-hidden lg:hidden"
          style={{ top: swipe.top }}
        >
          <div className="mx-auto w-full max-w-[1240px] px-4 pt-4 sm:px-6 lg:pt-6">
            {(() => {
              const Neighbor = VIEW_COMPONENTS[swipe.target];
              return <Neighbor />;
            })()}
          </div>
        </div>
      )}

      {/* SVG-фильтр эффекта (один на приложение):
          #pill-goo — metaball-слияние: линза отделяется/собирается при смене
          вкладки (blur + alpha-контраст + atop — классический gooey-рецепт).
          #pill-uneven (feTurbulence + feDisplacementMap) УДАЛЁН: панель не
          должна собирать ЧЕТЫРЕ стеклянных механизма одновременно
          (backdrop + displacement + goo + градиенты). Фильтр НЕ в backdrop —
          расслоения стекла на Android нет (урок P0.2).
          PHASE 2.3: область фильтра РАСШИРЕНА (y -45% / h 190%) — вспухшая
          линза (выше/ниже панели) не клипается канвой фильтра. */}
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
            x="-12%"
            y="-45%"
            width="124%"
            height="190%"
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
          GEOMETRY SHELL (overflow: visible) → GLASS SURFACE (клип стекла) →
          CAUSTICS → LIQUID LENS (goo, ПОД кнопками; при press МОЖЕТ выходить
          за 64px панели — PHASE 2.3 §1.4/E) → RIM → ICONS+LABELS.
          В покое линза внутри панели, при касании — вспухает.
          Кнопки ВСЕГДА выше неё. Search Mode (searchOpen) и клавиатура
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
            {/* PHASE 2.3 §1.4/E: РЕАЛЬНОЕ стекло переехало в .pill-surface —
                единственный слой с overflow:hidden (клип стекла); сам shell
                НЕ клипит линзу — она может выходить выше/ниже панели */}
            <div className="pill-surface">
              {/* Фоновая оптика: статичные каустики (без SVG displacement) */}
              <span
                className="pill-caustic"
                aria-hidden="true"
              />
            </div>

            {/* Жидкая линза ПОД кнопками: ОДНА капля (PHASE 2.2: призрак
                удалён — не успевал за основной линзой).
                pointer-events:none — тапы проходят к кнопкам пилюли */}
            <div
              ref={gooRef}
              className="pill-goo"
              aria-hidden="true"
            >
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

                      /* PHASE 2.4 §4.3: «Загрузка» — action-opener glass sheet:
                         committed view НЕ меняется, page swipe не ломается */
                      if (key === "upload") {
                        openUploadSheet();
                        return;
                      }

                      usePortal
                        .getState()
                        .setView(key);

                      playTick("tap");
                    }}
                  >
                    {/* PHASE 2.3 §2/G: сжимается КОНТЕНТ под давлением стекла
                        (is-lens-covered), не сама кнопка — hit-area 44px целая,
                        transform кнопки не конфликтует с nav-pulse/жестом */}
                    <span className="pill-item-content">
                      <Icon
                        size={21}
                        strokeWidth={2.05}
                      />

                      <span className="pill-label">
                        {short}
                      </span>
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

      {/* PHASE 2.4 §4: Upload — glass sheet (mobile) / dialog (desktop).
          Сам гейтится store.uploadOpen; live-цикл внутри компонента. */}
      <UploadSheet />
    </div>
  );

}
