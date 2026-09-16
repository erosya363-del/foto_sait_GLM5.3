"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowUp, Boxes, Images, Search, UploadCloud, ShieldCheck, X } from "lucide-react";
import {
  usePortal, snapshot, dismissProduct, isPushSuppressed,
  type View, type PortalSnapshot,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { playTick, playStep, vibrateSupported } from "@/lib/tick";
import { useKeyboardOpen } from "@/lib/use-visual-viewport";
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

  /* ── Пилюля: ОДНО статичное стекло + ОДИН движущийся bubble (P0.2/P1.11) ──
     Glass-слой один (backdrop-filter на .pill-shell, никогда не анимируется);
     SVG-displacement-фильтр УДАЛЕН — на Android/Chromium он рендерился
     отдельным слоем и визуально ОТРЫВАЛСЯ от панели (расслаивание стекла).
     Активный пункт = один общий bubble, перемещаемый ТОЛЬКО transform'ом
     (геометрия иконок неизменна). Хаптика .pill-haptic сохранена. */
  const shellRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const itemRefs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});

  /* Bubble: замер позиции активного пункта → translateX (без setState на
     каждый кадр; перерасчёт только на смену вкладки/товара/ширины). */
  useEffect(() => {
    const shell = shellRef.current;
    const bubble = bubbleRef.current;
    if (!shell || !bubble) return;
    const place = () => {
      const activeKey: View | null = productId ? null : view;
      const el = activeKey ? itemRefs.current[activeKey] : null;
      if (!el) {
        bubble.style.opacity = "0";
        return;
      }
      // offsetLeft/offsetWidth — от .pill-shell (position:relative), без reflow-петель:
      // читаем раз за смену состояния, пишем только transform/width
      bubble.style.width = `${el.offsetWidth}px`;
      bubble.style.transform = `translateX(${el.offsetLeft}px)`;
      bubble.style.opacity = "1";
    };
    place();
    // переход включается ПОСЛЕ первой установки — bubble не «прилетает» с нуля
    const raf = requestAnimationFrame(() => bubble.classList.add("is-ready"));
    const ro = new ResizeObserver(place);
    ro.observe(shell);
    window.addEventListener("resize", place);
    let fontsRaf = 0;
    document.fonts?.ready.then(() => {
      fontsRaf = requestAnimationFrame(place);
    });
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(fontsRaf);
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
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
  const [pillTouched, setPillTouched] = useState(false);
  /* Подвесной поиск (шаг 3): открыт из круглой кнопки на пилюле */
  const [searchFabOpen, setSearchFabOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    usePortal.getState().restore();
    window.history.replaceState(snapshot(), "");
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
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setScrolled(window.scrollY > 6));
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

  /* ── Поиск (шаг 3): круглый элемент на пилюле + подвесная карточка над ней ──
   Панель поиска сверху УДАЛЕНА на всех экранах → в DOM теперь ровно ОДИН
   input[data-search-input] (внутри .search-pop) — дубли полей невозможны.
   Открытие: класс is-open СИНХРОННО в жесте тапа + focus() — iOS открывает
   клавиатуру. Закрытие: крестик, свайп вниз, листание, Escape, тап мимо. */
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
  const closeSearchPop = () => {
    document.querySelector(".search-pop")?.classList.remove("is-open");
    setSearchFabOpen(false);
    usePortal.getState().setSearchOpen(false);
  };
  /* П.9 ТЗ: тап по кнопке поиска НЕ ставит фокус — клавиатура не вскакивает,
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
  /* Тап по круглому элементу поиска на пилюле: открыть/закрыть (toggle) */
  const toggleSearch = () => {
    if (searchFabOpen) closeSearchPop();
    else openSearch();
  };

  useEffect(() => {
    const open = () => openSearch(true); /* «/» — сразу к вводу (десктоп) */
    window.addEventListener("portal:search-open", open);
    return () => window.removeEventListener("portal:search-open", open);
  });

  // Тап мимо подвесного поиска — закрыть (кроме самой карточки и кнопки на пилюле:
  // у кнопки свой toggle — иначе pointerdown закрыл бы карточку ДО click)
  useEffect(() => {
    if (!searchFabOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(".search-pop") || t?.closest?.(".pill-search")) return;
      closeSearchPop();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [searchFabOpen]);

  /* СВАЙП ВНИЗ закрывает карточку (шаг 3): палец тянет карточку вниз
     (визуальный след), отпускание при >70px — закрытие. Свайп внутри
     скроллящегося дропдауна результатов закрытию не мешает. */
  useEffect(() => {
    if (!searchFabOpen) return;
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
  }, [searchFabOpen]);

  /* ТЗ v3.0 п.3/5: применение запроса (Enter/чип/ткань) БОЛЬШЕ НЕ закрывает
     карточку поиска — поле остаётся на экране, пользователь может продолжить
     ввод (клавиатура закрылась/открылась — режим жив). Плавающий чип
     «Поиск: «X»» появляется после ЯВНОГО закрытия карточки. Выход из режима —
     только крестик / свайп вниз / Escape / тап мимо / другой раздел. */
  useEffect(() => {
    const close = () => closeSearchPop();
    window.addEventListener("portal:search-close", close);
    return () => window.removeEventListener("portal:search-close", close);
  });

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
      // ГОНКА (v3.1): pswp гасит слой СИНХРОННО в этом же событии — к моменту
      // bubble-фазы viewerOpen уже false, и без этой проверки портал сделал бы
      // ВТОРОЙ back (закрыл и товар). Пока корень pswp в DOM — Esc не наш.
      if (document.querySelector(".pswp")) return;
      if (searchFabOpen) {
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
            Склад мебели · v1.4
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

      {/* Нижняя навигация — плавающая «пилюля». ЕДИНЫЙ стеклянный объект
          (P0.2): backdrop-filter на самой капсуле, никаких отдельных
          движущихся glass-слоёв. Активный пункт = ОДИН bubble (P1.11),
          движется transform'ом, иконки стоят на месте (P1.12).
          Search Mode (P1.13) и клавиатура (P0.3) → панель скрыта (display:none,
          без анимаций — P1.14). Хаптика .pill-haptic сохранена. */}
      <nav
        className={cn("pill-nav lg:hidden", (searchFabOpen || keyboardOpen) && "pill-hidden")}
        aria-label="Нижняя навигация"
      >
        <div
          ref={shellRef}
          className={cn(
            "pill-shell",
            scrolled && !pillTouched && "pill-dim",
            pillTouched && "pill-active",
          )}
        >
          {/* ОДИН общий активный bubble (P1.11): не пересоздаётся по пунктам,
              движется translateX; ширина неизменна — все табы равные */}
          <span ref={bubbleRef} className="pill-bubble" aria-hidden="true" />
          {/* Хроматическая кромка v4: статичное оптическое кольцо на кромке */}
          <span className="pill-rim" aria-hidden="true" />
          {NAV.map(({ key, short, Icon }) => {
            const on = view === key && !productId;
            return (
              <button
                key={key}
                type="button"
                onClick={(e) => {
                  if (key === "catalog") goCatalog(e.currentTarget, true);
                  else {
                    usePortal.getState().setView(key);
                    // iOS: хаптику сыграл .pill-haptic; Android — вибрируем
                    playTick("tap", { hapticOn: vibrateSupported() });
                  }
                }}
                ref={(el) => {
                  itemRefs.current[key] = el;
                }}
                className={cn("pill-item", on && "is-on")}
                aria-current={on ? "page" : undefined}
              >
                {/* Нативный switch под пальцем (Safari 17.4+): прямой тап = системная
                    хаптика на iOS ЛЮБОЙ версии, включая 26.5+, где программные тики
                    запрещены Apple. Невидим (opacity 0 + clip-path), appearance НЕ
                    трогаем — без нативного вида iOS не играет хаптику. Атрибут
                    switch передаётся spread'ом: его ещё нет в React-типах. */}
                <input type="checkbox" {...{ switch: "" }} className="pill-haptic" aria-hidden="true" tabIndex={-1} />
                <Icon size={22} strokeWidth={2.1} />
                <span className="pill-label">{short}</span>
              </button>
            );
          })}
          {/* Шаг 3 (аудит v2.6): поиск — РЯД ПИЛЮЛИ, без разделителя и без
              отдельного круга: тот же размер, что табы */}
          <button
            type="button"
            className={cn("pill-search", searchFabOpen && "is-on")}
            aria-label="Поиск"
            aria-expanded={searchFabOpen}
            onClick={toggleSearch}
          >
            <input type="checkbox" {...{ switch: "" }} className="pill-haptic" aria-hidden="true" tabIndex={-1} />
            <Search size={22} strokeWidth={2.1} />
          </button>
        </div>
      </nav>

      {/* Применённый поиск — плавающий чип над панелью (шаг 3):
          видно активный фильтр + сброс одним тапом */}
      {searchQuery && !searchFabOpen && (
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

      {/* Подвесной поиск (шаг 3) — стеклянная карточка НАД панелью (отступ 12мм):
          ПРЕДСМОНТИРОВАНА (скрыта visibility:hidden), открывается из круглого
          элемента пилюли или по «/» синхронным классом is-open + фокусом в жесте
          (клавиатура iOS). Закрытие: крестик справа, свайп вниз, листание.
          При открытой клавиатуре карточка поднимается над ней (--kb-h). */}
      <div ref={popRef} className={cn("search-pop", searchFabOpen && "is-open")}>
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
