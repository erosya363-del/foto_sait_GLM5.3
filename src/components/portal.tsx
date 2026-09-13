"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowUp, Boxes, Images, UploadCloud, ShieldCheck } from "lucide-react";
import {
  usePortal, snapshot, dismissProduct, isPushSuppressed,
  type View, type Warehouse, type PortalSnapshot,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { playTick, haptic } from "@/lib/tick";
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
        "cursor-pointer appearance-none rounded-md bg-secondary px-1.5 py-0.5 text-left font-semibold uppercase tracking-[0.14em] text-muted-foreground outline-none transition-colors hover:text-[color:var(--brand)]",
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

/** Заголовок текущего экрана для шапки */
function useHeaderTitle() {
  const view = usePortal((s) => s.view);
  const productId = usePortal((s) => s.productId);
  const searchQuery = usePortal((s) => s.searchQuery);
  const catCategory = usePortal((s) => s.catCategory);
  const catModel = usePortal((s) => s.catModel);
  const catFabrics = usePortal((s) => s.catFabrics);
  const catMaterial = usePortal((s) => s.catMaterial);
  if (productId) return "Фото товара";
  if (view === "catalog") {
    if (searchQuery) {
      const short = searchQuery.length > 12 ? searchQuery.slice(0, 11) + "…" : searchQuery;
      return `Поиск: «${short}»`;
    }
    if (catFabrics) return catMaterial ?? "Все ткани";
    if (catModel) return catModel;
    if (catCategory) return catCategory;
    return "Каталог";
  }
  if (view === "stock") return "Остатки";
  if (view === "upload") return "Загрузка фото";
  return "Админ";
}

/**
 * Шаг 2: тап по «Каталог».
 * Уже в каталоге (на любой глубине, включая поиск/ткани/открытый товар) →
 * мгновенный возврат наверх (сброс дриллдауна) + отклик: пульс капсулы +
 * tick-звук + вибрация (Android; iOS — звук и пульс, vibrate запрещён).
 * Из другого раздела — обычный переход.
 */
function goCatalog(btn?: HTMLElement | null) {
  const s = usePortal.getState();
  if (s.view === "catalog") {
    s.resetCatalog();
    playTick();
    haptic(12);
    if (btn) {
      btn.classList.remove("nav-pulse");
      void btn.offsetWidth; // перезапуск анимации
      btn.classList.add("nav-pulse");
      window.setTimeout(() => btn.classList.remove("nav-pulse"), 700);
    }
  } else {
    s.setView("catalog");
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
        if (usePortal.getState().productId) dismissProduct();
        else usePortal.getState().back();
      }}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-secondary/70 text-foreground transition-colors hover:text-[color:var(--brand)] active:scale-90",
        className
      )}
    >
      <ArrowLeft size={16} strokeWidth={2.3} />
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
      const input = document.getElementById("global-search") as HTMLInputElement | null;
      if (!input) return;
      e.preventDefault();
      input.focus();
    };
    document.addEventListener("keydown", onKey);

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
        <ArrowUp size={17} strokeWidth={2.4} />
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
  const title = useHeaderTitle();
  const searchVisible = view === "catalog" || view === "stock";
  useWowEffects();

  // ── Восстановление после F5 + фиксация стартовой записи истории ──
  useEffect(() => {
    usePortal.getState().restore();
    window.history.replaceState(snapshot(), "");
  }, []);

  // ── History API: каждый новый слой/раздел — отдельная запись ─────
  useEffect(() => {
    if (!restored || isPushSuppressed()) return;
    const cur = (window.history.state as { portal?: PortalSnapshot } | null)?.portal;
    if (
      cur &&
      cur.view === view &&
      cur.productId === productId &&
      cur.viewerOpen === viewerOpen &&
      cur.searchQuery === usePortal.getState().searchQuery &&
      cur.catModel === usePortal.getState().catModel &&
      cur.catCategory === usePortal.getState().catCategory &&
      cur.catFabrics === usePortal.getState().catFabrics &&
      cur.catMaterial === usePortal.getState().catMaterial
    ) {
      return; // запись уже актуальна (после popstate / restore) — не дублируем
    }
    window.history.pushState(snapshot(), "");
  }, [restored, view, productId, viewerOpen]);

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
      if (s.productId) {
        e.preventDefault();
        dismissProduct();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

      {/* Липкая шапка + панель поиска — мобильные и десктоп (в зоне контента) */}
      <div className="sticky top-0 z-40 lg:ml-[248px]">
        <header className="glass flex items-center gap-2 px-3 pb-2 pt-[max(10px,env(safe-area-inset-top))] sm:px-4">
          <div className="lg:hidden">
            <BackButton />
          </div>
          <button
            type="button"
            onClick={() => goCatalog(usePortal.getState().productId != null ? null : undefined)}
            aria-label="На главную — Каталог фото"
            className="shrink-0 max-[359px]:hidden"
          >
            <img
              src="/logo-askona.png"
              alt="Askona"
              className="h-6 w-auto max-w-[64px] object-contain sm:h-7 sm:max-w-[80px]"
              draggable={false}
            />
          </button>
          <div className="flex min-w-0 flex-col items-start">
            <span className="max-w-[46vw] truncate font-display text-[13px] font-bold leading-none sm:text-[14px]" title={title}>
              {title}
            </span>
            <div className="lg:hidden">
              <WarehouseSelect className="mt-1 w-[102px] text-[9px]" />
            </div>
          </div>
          <span className="min-w-2 flex-1" aria-hidden />
          <div className="hidden lg:block">
            <BackButton />
          </div>
          <ThemeSwitch mini />
        </header>

        {searchVisible && (
          <div className="glass border-t border-border/60 px-3 pb-2.5 pt-2 sm:px-4">
            <div className="mx-auto w-full max-w-[860px]">
              <SearchBar />
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

      {/* Нижняя навигация — плавающая «пилюля» (Liquid Glass, как в iOS 26).
          «Линза» активного пункта перетекает между вкладками (layoutId). */}
      <nav className="pill-nav lg:hidden" aria-label="Нижняя навигация">
        <div className="pill-shell">
          {NAV.map(({ key, short, Icon }) => {
            const on = view === key && !productId;
            return (
              <button
                key={key}
                type="button"
                onClick={(e) => (key === "catalog" ? goCatalog(e.currentTarget) : usePortal.getState().setView(key))}
                className={cn("pill-item", on && "is-on")}
                aria-current={on ? "page" : undefined}
              >
                {on && (
                  <motion.span
                    layoutId="nav-lens"
                    className="nav-lens"
                    transition={{ type: "spring", stiffness: 480, damping: 36 }}
                  />
                )}
                <Icon size={21} strokeWidth={2.1} />
                <span className="text-[10px] font-semibold">{short}</span>
              </button>
            );
          })}
        </div>
      </nav>

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
