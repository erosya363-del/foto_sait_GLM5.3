"use client";

import { useSyncExternalStore } from "react";

/* ═══ Единый источник состояния клавиатуры/visualViewport (ТЗ P0.3/P0.4) ═══
   ОДИН набор слушателей на всё приложение (singleton), ОДНО состояние:
   keyboardOpen + высота клавиатуры. Никаких transform-движений навигации
   на resize — навигация просто скрывается классом (display:none, без
   переходов — ноль кадров «панель в старой позиции»).

   Два механизма детекта (платформы ведут себя по-разному):
   • iOS Safari/PWA: layout-viewport НЕ сжимается — клавиатура перекрывает
     его снизу → kb = innerHeight − (vv.offsetTop + vv.height);
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
};

const CLOSED: ViewportState = {
  width: 0,
  height: 0,
  offsetTop: 0,
  scale: 1,
  keyboardOpen: false,
  keyboardHeight: 0,
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
    state.keyboardHeight === next.keyboardHeight
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

function measure() {
  const vv = window.visualViewport;
  const docEl = document.documentElement;
  let kb = 0;
  if (vv) {
    // iOS: перекрытие layout-viewport клавиатурой
    kb = Math.max(0, window.innerHeight - vv.offsetTop - vv.height);
  }
  // Android resizes-content: layout-viewport сжат при фокусе в поле
  if (isTextField() && baseH > 0 && Math.abs(window.innerWidth - baseW) < 2) {
    kb = Math.max(kb, baseH - docEl.clientHeight);
  }
  // ГИСТЕРЕЗИС: открытие >140px, закрытие <80px — нет дребезга на пороге
  const wasOpen = state.keyboardOpen;
  const open = wasOpen ? kb > 80 : kb > 140;

  docEl.classList.toggle("kb-open", open);
  docEl.style.setProperty("--kb-h", open ? `${Math.round(kb)}px` : "0px");

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
    keyboardHeight: open ? Math.round(kb) : 0,
  });
}

function onOrient() {
  baseH = 0;
  baseW = 0;
  measure();
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const vv = window.visualViewport;
  vv?.addEventListener("resize", measure);
  vv?.addEventListener("scroll", measure);
  window.addEventListener("resize", measure);
  window.addEventListener("orientationchange", onOrient);
  document.addEventListener("focusin", measure);
  document.addEventListener("focusout", measure);
  measure();
}

function uninstall() {
  if (!installed) return;
  installed = false;
  const vv = window.visualViewport;
  vv?.removeEventListener("resize", measure);
  vv?.removeEventListener("scroll", measure);
  window.removeEventListener("resize", measure);
  window.removeEventListener("orientationchange", onOrient);
  document.removeEventListener("focusin", measure);
  document.removeEventListener("focusout", measure);
  document.documentElement.classList.remove("kb-open");
  document.documentElement.style.removeProperty("--kb-h");
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
 *  нужна цифра; координаты обычно решает CSS-переменная --kb-h. */
export function useKeyboardHeight(): number {
  return useSyncExternalStore(
    subscribe,
    () => state.keyboardHeight,
    () => 0
  );
}
