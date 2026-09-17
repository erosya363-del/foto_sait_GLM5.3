"use client";

import { usePortal, type View } from "@/lib/store";

/**
 * Мост «нативная iOS-оболочка (AskonaApp, UIKit + WKWebView) ↔ сайт».
 *
 * Нативный таб-бар (системный UITabBar, Liquid Glass рисует iOS) переключает
 * разделы СПА через CustomEvent "native-tab-change"; сайт сообщает нативной
 * стороне о смене раздела своими силами через window.webkit.messageHandlers.
 *
 * Активируется ТОЛЬКО когда нативная оболочка выставила
 * window.__ASKONA_NATIVE_IOS__ (WKUserScript atDocumentStart). В Safari/PWA/
 * Android/desktop код полностью неактивен — веб-пилюля работает как раньше.
 *
 * Событийный обмен, без polling/timers (п.31 ТЗ).
 */

/** ID вкладок нативного таб-бара (порядок = порядок в RootTabBarController) */
export type NativeTabId = "catalog" | "upload" | "admin" | "stock";

declare global {
  interface Window {
    __ASKONA_NATIVE_IOS__?: boolean;
    webkit?: {
      messageHandlers?: {
        nativeApp?: { postMessage: (message: unknown) => void };
      };
    };
  }
}

export function isNativeIOSShell(): boolean {
  return typeof window !== "undefined" && window.__ASKONA_NATIVE_IOS__ === true;
}

function postToNative(message: Record<string, unknown>): void {
  if (!isNativeIOSShell()) return;
  try {
    window.webkit?.messageHandlers?.nativeApp?.postMessage(message);
  } catch {
    /* мост недоступен — сайт продолжает работать как обычный веб */
  }
}

/** native tab id → валидный View (строго whitelist) */
function toView(tab: unknown): View | null {
  return tab === "catalog" || tab === "upload" || tab === "admin" || tab === "stock"
    ? tab
    : null;
}

let initialized = false;

/**
 * Инициализация моста. Вызывается один раз из Portal (useEffect).
 * Возвращает cleanup (стандарт для React-эффектов).
 */
export function initNativeIOSBridge(): () => void {
  if (!isNativeIOSShell() || initialized || typeof window === "undefined") {
    return () => {};
  }
  initialized = true;

  /* ── Native → Web: нативный таб-бар переключил раздел ──
     Повторный тап «Каталог» (уже в каталоге) → resetCatalog(): мгновенный
     возврат наверх с сбросом дриллдауна — ровно то же поведение, что у
     веб-пилюли (goCatalog). Остальные разделы — обычный setView. */
  const onNativeTabChange = (event: Event) => {
    const detail = (event as CustomEvent<{ tab?: string; source?: string }>).detail;
    const view = toView(detail?.tab);
    if (!view) return;
    const state = usePortal.getState();
    if (view === "catalog") {
      // Переход в каталог ИЛИ повторный тап по активному «Каталог» — оба
      // сценария в пилюле ведут к каталогу с сохранением режима вида
      if (state.view === "catalog") state.resetCatalog();
      else state.setView("catalog");
    } else if (state.view !== view || state.productId) {
      state.setView(view);
    }
  };
  window.addEventListener("native-tab-change", onNativeTabChange);

  /* ── Web → Native: сайт сменил раздел сам (например из заголовка) ──
     Нативная сторона подсветит соответствующий пункт (линза переедет) без
     перезагрузки. Эхо-петля исключена: нативные setSelectedIndex, сделанные
     ради этой синхронизации, обратно событие не шлют. */
  let lastKnownView: View = usePortal.getState().view;
  const unsubscribe = usePortal.subscribe((state) => {
    if (state.view !== lastKnownView) {
      lastKnownView = state.view;
      postToNative({ type: "tabChanged", tab: lastKnownView });
    }
  });

  postToNative({ type: "bridgeReady" });

  return () => {
    window.removeEventListener("native-tab-change", onNativeTabChange);
    unsubscribe();
    initialized = false;
  };
}
