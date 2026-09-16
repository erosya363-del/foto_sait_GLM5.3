"use client";

import { create } from "zustand";

export type View = "catalog" | "stock" | "upload" | "admin";
export type Warehouse = "Обухово" | "Владимир";
export type CatalogMode = "grid" | "rows" | "large";
export type StockMode = "compact" | "cards";

/** Фото для просмотрщика (ТЗ v3.0 п.35/36): thumb показывается мгновенно,
 *  полная версия (optimized) подгружается следом и незаметно замещает —
 *  никакого пустого чёрного экрана и никаких мыльных 5×-зумов с thumbnail. */
export type ViewerPhoto = { url: string; thumbUrl: string };

const SS_KEY = "skovo-portal-state";
/** Предпочтения вида — в localStorage: живут и после закрытия вкладки/браузера.
 *  Остальное (слой каталога, товар) — по-прежнему sessionStorage. */
const LS_PREFS = "skovo-view-prefs";

type ViewPrefs = { catalogMode: CatalogMode; stockMode: StockMode };

function loadPrefs(): Partial<ViewPrefs> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (raw) return JSON.parse(raw) as Partial<ViewPrefs>;
  } catch {
    /* приватный режим */
  }
  // миграция: первый запуск после ввода localStorage — берём из сессии
  try {
    const p = JSON.parse(sessionStorage.getItem(SS_KEY) || "{}") as Partial<Persisted>;
    return { catalogMode: p.catalogMode, stockMode: p.stockMode };
  } catch {
    return {};
  }
}

function savePrefs(p: ViewPrefs) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify(p));
  } catch {
    /* приватный режим — молча игнорируем */
  }
}

type Persisted = {
  view: View;
  productId: string | null;
  productFrom: "catalog" | "stock";
  warehouse: Warehouse;
  catCategory: string | null;
  catModel: string | null;
  catFabrics: boolean;
  catMaterial: string | null;
  searchQuery: string | null;
  catalogMode: CatalogMode;
  stockMode: StockMode;
};

/** Снимок текущего слоя для History API */
export type PortalSnapshot = {
  view: View;
  productId: string | null;
  viewerOpen: boolean;
  catCategory: string | null;
  catModel: string | null;
  catFabrics: boolean;
  catMaterial: string | null;
  searchQuery: string | null;
};

/** Цель прыжка из открытого товара на любой уровень каталога */
export type CatalogJumpTarget = {
  category?: string | null;
  model?: string | null;
  fabrics?: boolean;
  material?: string | null;
};

function loadPersisted(): Partial<Persisted> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(SS_KEY) || "{}") as Partial<Persisted>;
  } catch {
    return {};
  }
}

function savePersisted(p: Persisted) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify(p));
  } catch {
    /* приватный режим — молча игнорируем */
  }
}

type PortalState = {
  view: View;
  productId: string | null;
  productFrom: "catalog" | "stock";
  saleOnly: boolean;
  filtersOpen: boolean;
  viewerPhotos: ViewerPhoto[];
  viewerIndex: number;
  viewerOpen: boolean;
  /** Открыт дропдаун поиска — верхний слой для Escape */
  searchOpen: boolean;
  warehouse: Warehouse;
  /** Дриллдаун каталога: выбранная категория и модель */
  catCategory: string | null;
  catModel: string | null;
  /** Экран «Все ткани» (альтернативный обход каталога по тканям) */
  catFabrics: boolean;
  /** Выбранная ткань внутри «Все ткани» */
  catMaterial: string | null;
  /** Применённый поисковый запрос (Enter/чип/ткань) — null = обычный режим каталога */
  searchQuery: string | null;
  /** Режимы вида */
  catalogMode: CatalogMode;
  stockMode: StockMode;
  /** true после восстановления сессии (F5) — до этого историю не трогаем */
  restored: boolean;
  /** позиция скролла на момент открытия карточки товара */
  savedScrollY: number;
  setView: (v: View) => void;
  openProduct: (id: string, from?: "catalog" | "stock") => void;
  closeProduct: () => void;
  setSaleOnly: (v: boolean) => void;
  setFiltersOpen: (v: boolean) => void;
  openViewer: (photos: ViewerPhoto[], index: number) => void;
  closeViewer: () => void;
  setViewerIndex: (i: number) => void;
  setSearchOpen: (v: boolean) => void;
  setWarehouse: (w: Warehouse) => void;
  setCatCategory: (c: string | null) => void;
  setCatModel: (m: string | null) => void;
  setCatFabrics: (open: boolean) => void;
  setCatMaterial: (m: string | null) => void;
  applySearch: (q: string | null) => void;
  /** Шаг 2: полный сброс каталога + мгновенный скролл наверх (повторный тап «Каталог») */
  resetCatalog: () => void;
  /** Шаг 3: прыжок из ОТКРЫТОГО товара на любой уровень каталога */
  jumpProductToLevel: (target: CatalogJumpTarget) => void;
  setCatalogMode: (m: CatalogMode) => void;
  setStockMode: (m: StockMode) => void;
  /** Контекстная «Назад»: товар → поиск → модель → категория */
  back: () => void;
  restore: () => void;
};

export const usePortal = create<PortalState>((set, get) => ({
  view: "catalog",
  productId: null,
  productFrom: "catalog",
  saleOnly: false,
  filtersOpen: false,
  viewerPhotos: [],
  viewerIndex: 0,
  viewerOpen: false,
  searchOpen: false,
  warehouse: "Обухово",
  catCategory: null,
  catModel: null,
  catFabrics: false,
  catMaterial: null,
  searchQuery: null,
  catalogMode: "grid",
  stockMode: "compact",
  restored: false,
  savedScrollY: 0,

  setView: (v) => {
    set({ view: v, productId: null });
    persist(get);
  },

  openProduct: (id, from = "catalog") => {
    const saved = typeof window !== "undefined" ? window.scrollY : 0;
    set({ productId: id, productFrom: from, savedScrollY: saved });
    persist(get);
  },

  closeProduct: () => {
    set({ productId: null });
    persist(get);
  },

  setSaleOnly: (v) => set({ saleOnly: v }),
  setFiltersOpen: (v) => set({ filtersOpen: v }),

  openViewer: (photos, index) => set({ viewerOpen: true, viewerPhotos: photos, viewerIndex: index }),

  closeViewer: () => set({ viewerOpen: false, viewerIndex: 0 }),

  setViewerIndex: (i) => set({ viewerIndex: i }),

  setSearchOpen: (v) => set({ searchOpen: v }),

  setWarehouse: (w) => {
    set({ warehouse: w });
    persist(get);
  },

  setCatCategory: (c) => {
    set({ catCategory: c, catModel: null, searchQuery: null, catFabrics: false, catMaterial: null });
    persist(get);
  },

  setCatModel: (m) => {
    set({ catModel: m, searchQuery: null });
    persist(get);
  },

  setCatFabrics: (open) => {
    set({ catFabrics: open, catCategory: null, catModel: null, catMaterial: null, searchQuery: null });
    persist(get);
  },

  setCatMaterial: (m) => {
    set({ catMaterial: m, searchQuery: null });
    persist(get);
  },

  applySearch: (q) => {
    set({ searchQuery: q, catCategory: null, catModel: null, catFabrics: false, catMaterial: null });
    persist(get);
  },

  resetCatalog: () => {
    set({
      catCategory: null,
      catModel: null,
      catFabrics: false,
      catMaterial: null,
      searchQuery: null,
      productId: null,
    });
    if (typeof window !== "undefined") window.scrollTo(0, 0);
    persist(get);
  },

  jumpProductToLevel: (target) => {
    set({
      productId: null,
      view: "catalog",
      searchQuery: null,
      catCategory: target.fabrics ? null : (target.category ?? null),
      catModel: target.fabrics ? null : (target.model ?? null),
      catFabrics: Boolean(target.fabrics),
      catMaterial: target.fabrics ? (target.material ?? null) : null,
    });
    if (typeof window !== "undefined") window.scrollTo(0, 0);
    persist(get);
  },

  setCatalogMode: (m) => {
    set({ catalogMode: m });
    persist(get);
    savePrefs({ catalogMode: get().catalogMode, stockMode: get().stockMode });
  },

  setStockMode: (m) => {
    set({ stockMode: m });
    persist(get);
    savePrefs({ catalogMode: get().catalogMode, stockMode: get().stockMode });
  },

  back: () => {
    const s = get();
    if (s.productId) {
      // закрытие товара делает dismissProduct() (синхронизация с историей)
      return;
    }
    if (s.searchQuery) {
      set({ searchQuery: null, catCategory: null, catModel: null, catFabrics: false, catMaterial: null });
    } else if (s.catMaterial) {
      set({ catMaterial: null });
    } else if (s.catFabrics) {
      set({ catFabrics: false, catMaterial: null });
    } else if (s.catModel) {
      set({ catModel: null });
    } else if (s.catCategory) {
      set({ catCategory: null, catModel: null });
    }
    persist(get);
  },

  /** Восстановление экрана после F5 — вызывается один раз при монтировании.
   *  Приоритет: history.state текущей записи (надёжно при Back-навигации),
   *  затем sessionStorage (новая вкладка). */
  restore: () => {
    if (get().restored) return;
    const st =
      typeof window !== "undefined"
        ? ((window.history.state as { portal?: PortalSnapshot } | null)?.portal ?? null)
        : null;
    const p = loadPersisted();
    const prefs = loadPrefs(); // localStorage приоритетнее сессии для режимов вида
    set({
      view: st?.view ?? p.view ?? "catalog",
      productId: st?.productId ?? p.productId ?? null,
      productFrom: p.productFrom ?? "catalog",
      warehouse: p.warehouse ?? "Обухово",
      catCategory: st?.catCategory ?? p.catCategory ?? null,
      catModel: st?.catModel ?? p.catModel ?? null,
      catFabrics: st?.catFabrics ?? p.catFabrics ?? false,
      catMaterial: st?.catMaterial ?? p.catMaterial ?? null,
      searchQuery: st?.searchQuery ?? p.searchQuery ?? null,
      catalogMode: prefs.catalogMode ?? p.catalogMode ?? "grid",
      stockMode: prefs.stockMode ?? p.stockMode ?? "compact",
      restored: true,
    });
  },
}));

function persist(get: () => PortalState) {
  const s = get();
  savePersisted({
    view: s.view,
    productId: s.productId,
    productFrom: s.productFrom,
    warehouse: s.warehouse,
    catCategory: s.catCategory,
    catModel: s.catModel,
    catFabrics: s.catFabrics,
    catMaterial: s.catMaterial,
    searchQuery: s.searchQuery,
    catalogMode: s.catalogMode,
    stockMode: s.stockMode,
  });
}

/** Блокировка пуша в историю на время программного закрытия слоя */
let suppressPush = false;
export function isPushSuppressed() {
  return suppressPush;
}

/** Отладочный доступ к стору из консоли (window.__portal) */
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__portal = usePortal;
}

/** Текущее состояние для записи в history.state.
 *  КРИТИЧНО (ФИКС reload-on-back): сохраняем ВСЕ посторонние поля history.state
 *  (в т.ч. маркер __NA сервиса Next.js App Router). Если затереть их — Next
 *  считает запись «легаси» и на Back делает ПОЛНУЮ перезагрузку страницы
 *  вместо same-document popstate. */
export function snapshot(): Record<string, unknown> {
  const s = usePortal.getState();
  const base =
    typeof window !== "undefined"
      ? ((window.history.state ?? {}) as Record<string, unknown>)
      : {};
  return {
    ...base,
    portal: {
      view: s.view,
      productId: s.productId,
      viewerOpen: s.viewerOpen,
      catCategory: s.catCategory,
      catModel: s.catModel,
      catFabrics: s.catFabrics,
      catMaterial: s.catMaterial,
      searchQuery: s.searchQuery,
    },
  };
}

/**
 * Кнопка «Назад» внутри приложения.
 * Состояние применяется мгновенно (UI не зависит от капризов traversal),
 * а history.back() синхронизирует записи — повторное применение той же
 * поглощается дедупликацией в popstate-обработчике и push-эффекте.
 */
function suppressAndBack(hasLayer: boolean, apply: () => void) {
  suppressPush = true;
  try {
    apply();
    if (hasLayer && typeof window !== "undefined") window.history.back();
  } finally {
    // отпускаем после текущего таска; popstate придёт позже и поглотится дедупликацией
    setTimeout(() => {
      suppressPush = false;
    }, 0);
  }
}

export function dismissProduct() {
  const hasLayer =
    typeof window !== "undefined" && Boolean(window.history.state?.portal?.productId);
  suppressAndBack(hasLayer, () => usePortal.getState().closeProduct());
}

export function dismissViewer() {
  const hasLayer =
    typeof window !== "undefined" && Boolean(window.history.state?.portal?.viewerOpen);
  suppressAndBack(hasLayer, () => usePortal.getState().closeViewer());
}
