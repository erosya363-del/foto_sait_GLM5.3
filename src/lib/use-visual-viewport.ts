"use client";

import { useSyncExternalStore } from "react";

/* ═══ Единый источник состояния клавиатуры/visualViewport (ТЗ P0.3/P0.4 + v4 п.20) ═══
   ОДИН набор слушателей на всё приложение (singleton), ОДНО состояние:
   keyboardOpen + высота клавиатуры. Никаких transform-движений навигации
   на resize — навигация просто скрывается классом (display:none, без
   переходов — ноль кадров «панель в старой позиции»).

   ГЛАВНОЕ (ТЗ v4 п.20): ВЫСОТА клавиатуры и OVERLAY-ПЕРЕКРЫТИЕ — разные
   вещи; раньше одна переменная kb обслуживала обе роли и на Android
   клавиатура учитывалась ДВАЖДЫ (огромная пустота под карточкой поиска):
     • keyboardHeight — общая высота клавиатуры (логика/модалки, --kb-h);
     • keyboardOverlayInset — фактическое перекрытие НИЗА layout viewport.
   Позиционировать fixed search нужно ТОЛЬКО на overlay (--kb-overlay):
   iOS overlay keyboard даёт overlayInset > 0; Android (resizes-content)
   обычно 0, потому что layout viewport уже физически сжался.

   Два механизма детекта (платформы ведут себя по-разному):
   • iOS Safari/PWA: layout-viewport НЕ сжимается — клавиатура перекрывает
     его снизу → overlayInset = innerHeight − (vv.offsetTop + vv.height);
   • Android Chrome (interactiveWidget: resizes-content): layout-viewport
     сжимается сам → вторая метрика: падение clientHeight ниже baseline
     (запомненной высоты без клавиатуры при той же ширине окна).
   Гистерезис 140/80 px — детект не дребезжит на пороге. */

export type ViewportState = {
  /** visualViewport.width (CSS px) */
  width: number;
  /** visualViewport.height (CSS px) — видимая высота */
  height: number;
  /** visualViewport.offsetTop */
  offsetTop: number;
  /** visualViewport.scale (page zoom) */
  scale: number;
  /** Клавиатура открыта (с гистерезисом) */
  keyboardOpen: boolean;
  /** Расчётная высота клавиатуры, px (0 если закрыта) */
  keyboardHeight: number;
  /** PART 1.1 §13.1: НИЖНЯЯ инсет visual viewport относительно layout
   *  (браузерный тулбар/zoom — НЕ keyboardOverlay!).
   *  innerHeight − (vv.offsetTop + vv.height) ≥ 0. */
  visualBottomInset: number;
};

const CLOSED: ViewportState = {
  width: 0,
  height: 0,
  offsetTop: 0,
  scale: 1,
  keyboardOpen: false,
  keyboardHeight: 0,
  visualBottomInset: 0,
};

let state: ViewportState = CLOSED;
const subs = new Set<() => void>();
let installed = false;
let baseH = 0; // высота layout-viewport без клавиатуры (baseline)
let baseW = 0; // ширина baseline (поворот сбрасывает)

function setState(next: ViewportState) {
  // новый объект только при фактическом изменении (useSyncExternalStore-контракт)
  if (
    state.width === next.width &&
    state.height === next.height &&
    state.offsetTop === next.offsetTop &&
    state.scale === next.scale &&
    state.keyboardOpen === next.keyboardOpen &&
    state.keyboardHeight === next.keyboardHeight &&
    state.visualBottomInset === next.visualBottomInset
  ) {
    return;
  }
  state = next;
  subs.forEach((cb) => cb());
}

function isTextField() {
  const el = document.activeElement as HTMLElement | null;
  return Boolean(
    el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
  );
}

/* ═══ PART 1.1 §13 — BROWSER BOTTOM INSET (компенсация тулбара) ═══
   Отдельная метрика visualBottomInset = innerHeight − (vv.offsetTop +
   vv.height): НИЖНЯЯ часть layout viewport, невидимая браузерным chrome
   (тулбар) в данный момент. ЭТО НЕ keyboardOverlay: обновляется только при
   ЗАКРЫТОЙ клавиатуре, в html.is-browser и НЕ в standalone PWA.
   Панель (.pill-nav) добавляет её к bottom — визуальное положение перестаёт
   зависеть от collapse/expand тулбара (см. globals.css §13.4; вопрос
   двойного офсета на реальном Safari — REAL DEVICE REQUIRED). */
const BROWSER_INSET_EPSILON = 1.5; // §13.3: не дёргаться на каждый пиксель
const BROWSER_INSET_CLAMP = 160;   // разумный диапазон тулбаров
let insetRaf = 0;
let writtenInset = -1;

function writeBrowserInset(target: number) {
  if (Math.abs(target - writtenInset) < BROWSER_INSET_EPSILON) return;
  writtenInset = target;
  document.documentElement.style.setProperty("--browser-bottom-inset", `${Math.round(target)}px`);
}

/** rAF-батчинг: CSS-переменная пишется НЕ в каждом событии resize/scroll,
 *  а один раз на кадр. React setState на пиксельные resize НЕТ (§13.3). */
function scheduleBrowserInset(target: number) {
  if (insetRaf) return;
  insetRaf = requestAnimationFrame(() => {
    insetRaf = 0;
    writeBrowserInset(target);
  });
}

/** Обновляет --browser-bottom-inset по правилам §13.2: browser-only,
 *  не-PWA, НЕ kb-open. Возвращает true, если условие применимо. */
function updateBrowserBottomInset(kbOpen: boolean, inset: number): boolean {
  const docEl = document.documentElement;
  if (docEl.classList.contains("is-standalone")) return false; // §13.2: не в PWA
  if (!docEl.classList.contains("is-browser") || kbOpen) return false;
  scheduleBrowserInset(Math.min(BROWSER_INSET_CLAMP, Math.max(0, inset)));
  return true;
}

function measure() {
  const vv = window.visualViewport;
  const docEl = document.documentElement;

  /*
   * Реальное перекрытие НИЗА layout viewport.
   *
   * iOS overlay keyboard:
   * > 0
   *
   * Android resizes-content:
   * обычно 0
   */
  const overlayInset = vv
    ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height))
    : 0;

  /* PART 1.1 §13.1: та же арифметика — но как САМОСТОЯТЕЛЬНАЯ метрика
     браузерного тулбара (не клавиатуры). Живёт независимо от kb-open. */
  const visualBottomInset = overlayInset;

  let keyboardHeight = overlayInset;

  /*
   * Android:
   * layout viewport физически уменьшился.
   */
  if (isTextField() && baseH > 0 && Math.abs(window.innerWidth - baseW) < 2) {
    keyboardHeight = Math.max(keyboardHeight, baseH - docEl.clientHeight);
  }

  // ГИСТЕРЕЗИС: открытие >140px, закрытие <80px — нет дребезга на пороге
  const wasOpen = state.keyboardOpen;
  const open = wasOpen ? keyboardHeight > 80 : keyboardHeight > 140;

  docEl.classList.toggle("kb-open", open);

  /*
   * Общая высота — для логики/модалок (--kb-h).
   */
  docEl.style.setProperty("--kb-h", open ? `${Math.round(keyboardHeight)}px` : "0px");

  /*
   * ВАЖНО (ТЗ v4 п.20):
   * позиционировать fixed search надо ТОЛЬКО на фактическое overlay
   * перекрытие (--kb-overlay).
   *
   * Иначе на Android, где viewport уже уменьшен, клавиатура учитывается
   * дважды.
   */
  docEl.style.setProperty("--kb-overlay", open ? `${Math.round(overlayInset)}px` : "0px");

  /* PART 1.1 §13.2: браузерная компенсация — ТОЛЬКО browser (не PWA) и
     НЕ при открытой клавиатуре (kb-open = другая схема позиционирования).
     Пишется напрямую в CSS variable (rAF-батчинг) — без React setState. */
  updateBrowserBottomInset(open, visualBottomInset);

  // baseline помним только БЕЗ клавиатуры и при неизменной ширине (не поворот)
  if (!open && (baseW === 0 || Math.abs(window.innerWidth - baseW) < 2)) {
    baseH = Math.max(baseH, docEl.clientHeight);
    baseW = window.innerWidth;
  }

  setState({
    width: Math.round(vv?.width ?? window.innerWidth),
    height: Math.round(vv?.height ?? window.innerHeight),
    offsetTop: Math.round(vv?.offsetTop ?? 0),
    scale: vv?.scale ?? 1,
    keyboardOpen: open,
    keyboardHeight: open ? Math.round(keyboardHeight) : 0,
    visualBottomInset: Math.round(visualBottomInset),
  });
}

function onOrient() {
  baseH = 0;
  baseW = 0;
  measure();
}

/* CRITICAL STABILITY 5.3: возвращение на вкладку / выход из фона —
   iOS может «проесть» resize/scroll события, и stale KB-состояние
   (kb-open, --kb-overlay ≠ 0) оставляет полосу и смещённую панель.
   measure() на pageshow/visibilitychange сбрасывает всё по факту. */
function onPageShow() {
  baseH = 0;
  baseW = 0;
  measure();
}
function onVisibility() {
  if (document.visibilityState === "visible") measure();
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const vv = window.visualViewport;
  vv?.addEventListener("resize", measure);
  vv?.addEventListener("scroll", measure);
  window.addEventListener("resize", measure);
  window.addEventListener("orientationchange", onOrient);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("focusin", measure);
  document.addEventListener("focusout", measure);
  measure();
}

function uninstall() {
  if (!installed) return;
  installed = false;
  if (insetRaf) {
    cancelAnimationFrame(insetRaf);
    insetRaf = 0;
  }
  writtenInset = -1;
  const vv = window.visualViewport;
  vv?.removeEventListener("resize", measure);
  vv?.removeEventListener("scroll", measure);
  window.removeEventListener("resize", measure);
  window.removeEventListener("orientationchange", onOrient);
  window.removeEventListener("pageshow", onPageShow);
  document.removeEventListener("visibilitychange", onVisibility);
  document.removeEventListener("focusin", measure);
  document.removeEventListener("focusout", measure);
  document.documentElement.classList.remove("kb-open");
  document.documentElement.style.removeProperty("--kb-h");
  document.documentElement.style.removeProperty("--kb-overlay");
  document.documentElement.style.removeProperty("--browser-bottom-inset");
}

function subscribe(cb: () => void) {
  subs.add(cb);
  install();
  return () => {
    subs.delete(cb);
    if (subs.size === 0) uninstall();
  };
}

function getSnapshot(): ViewportState {
  return state;
}

/** Хук состояния visualViewport/клавиатуры. Один слушатель-набор на всё
 *  приложение; ререндер ТОЛЬКО при реальном изменении метрик. Навигация
 *  на каждое событие НЕ двигается transform'ом — только класс kb-open. */
export function useVisualViewport(): ViewportState {
  return useSyncExternalStore(subscribe, getSnapshot, () => CLOSED);
}

/** Примитивный селектор: только факт открытой клавиатуры. Ререндер
 *  потребителя происходит ТОЛЬКО в момент открытия/закрытия (не на каждое
 *  событие scroll/resize visualViewport — техзапрет P0.7). */
export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.keyboardOpen,
    () => false
  );
}

/** Примитивный селектор: высота клавиатуры (px) — для React-UI, которому
 *  нужна цифра; позиционирование fixed-элементов решает CSS-переменная
 *  --kb-overlay (фактическое overlay-перекрытие, НЕ полная высота). */
export function useKeyboardHeight(): number {
  return useSyncExternalStore(
    subscribe,
    () => state.keyboardHeight,
    () => 0
  );
}
