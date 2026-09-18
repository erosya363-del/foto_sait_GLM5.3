"use client";

import { useEffect, useRef, useState } from "react";
import { usePortal } from "@/lib/store";

/**
 * CRITICAL STABILITY 5.1/5.2 — DEBUG OVERLAY полосы снизу.
 *
 * Активация ТОЛЬКО query-параметром:  ?viewportDebug=1
 * Без параметра компонент ничего не рендерит (production-visible НЕТ).
 * Владелец открывает ссылку с параметром на реальном устройстве, снимает
 * значения в момент появления полосы → видно, КТО создаёт gap:
 *   innerHeight ≠ docEl.clientHeight        → layout viewport расходится
 *   vv.height + vv.offsetTop ≠ innerHeight  → keyboard overlay (iOS)
 *   docEl.clientHeight < innerHeight        → Android resizes-content
 *   pill.bottom > innerHeight               → панель ниже вьюпорта (полоса)
 *   --kb-overlay ≠ 0 при закрытом поле      → stale KB state
 *
 * Журнал событий (последние 10) показывает transition:
 * cold start → search → keyboard → close → tab switch.
 */

type LogRow = { t: string; ev: string; ih: number; vh: number; vo: number };

function readMetrics() {
  const vv = window.visualViewport;
  const docEl = document.documentElement;
  const body = document.body;
  const pill = document.querySelector<HTMLElement>(".pill-shell");
  const pop = document.querySelector<HTMLElement>(".search-pop");
  const sheet = document.querySelector<HTMLElement>("[data-upload-sheet]");
  const css = getComputedStyle(docEl);
  const pillRect = pill?.getBoundingClientRect();
  const popRect = pop?.getBoundingClientRect();
  const sheetRect = sheet?.getBoundingClientRect();
  return {
    ih: Math.round(window.innerHeight),
    dh: Math.round(docEl.clientHeight),
    vh: Math.round(vv?.height ?? 0),
    vo: Math.round(vv?.offsetTop ?? 0),
    pt: Math.round(vv?.pageTop ?? 0),
    scale: (vv?.scale ?? 1).toFixed(3),
    bodyH: Math.round(body.getBoundingClientRect().height),
    docScrollH: Math.round(docEl.scrollHeight),
    dvhEst: Math.round((body.getBoundingClientRect().height / 1) * 1), // справочно
    sab: css.getPropertyValue("--sab").trim() || "0px",
    kbOverlay: css.getPropertyValue("--kb-overlay").trim() || "0px",
    kbH: css.getPropertyValue("--kb-h").trim() || "0px",
    browserInset: css.getPropertyValue("--browser-bottom-inset").trim() || "0px",
    pillBottom: pillRect ? Math.round(pillRect.bottom) : null,
    pillTop: pillRect ? Math.round(pillRect.top) : null,
    popBottom: popRect ? Math.round(popRect.bottom) : null,
    sheetBottom: sheetRect ? Math.round(sheetRect.bottom) : null,
    sheetTop: sheetRect ? Math.round(sheetRect.top) : null,
    kbOpen: docEl.classList.contains("kb-open"),
    glass: docEl.classList.contains("glass-fallback")
      ? "fallback"
      : docEl.classList.contains("glass-full")
        ? "full"
        : "?",
    mode: docEl.classList.contains("is-standalone")
      ? "standalone"
      : docEl.classList.contains("is-browser")
        ? "browser"
        : "?",
    searchOpen: usePortal.getState().searchOpen,
    uploadOpen: usePortal.getState().uploadOpen,
    view: usePortal.getState().view,
  };
}

export function ViewportDebug() {
  const [enabled, setEnabled] = useState(false);
  const [m, setM] = useState<ReturnType<typeof readMetrics> | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);

  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("viewportDebug") !== "1") return;
    } catch {
      return;
    }
    // setState только вне синхронного вызова эффекта (react-hooks правило):
    let raf0 = requestAnimationFrame(() => {
      setEnabled(true);
      setM(readMetrics());
    });

    const push = (ev: string) => {
      const x = readMetrics();
      setLog((prev) => [
        ...prev.slice(-9),
        { t: new Date().toLocaleTimeString("ru-RU", { hour12: false }) + "." + String(Date.now() % 1000).padStart(3, "0"), ev, ih: x.ih, vh: x.vh, vo: x.vo },
      ]);
      setM(x);
    };

    const onResize = () => push("resize");
    const onVVResize = () => push("vv.resize");
    const onVVScroll = () => push("vv.scroll");
    const onScroll = () => push("scroll");
    const onOrient = () => push("orientationchange");
    const onPageShow = () => push("pageshow");
    const onVis = () => {
      if (document.visibilityState === "visible") push("visibility=visible");
    };
    const onFocusIn = (e: FocusEvent) => push(`focusin ${(e.target as HTMLElement)?.tagName || "?"}`);
    const onFocusOut = (e: FocusEvent) => push(`focusout ${(e.target as HTMLElement)?.tagName || "?"}`);

    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onVVResize);
    window.visualViewport?.addEventListener("scroll", onVVScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("orientationchange", onOrient);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    const iv = window.setInterval(() => setM(readMetrics()), 1000);

    return () => {
      cancelAnimationFrame(raf0);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onVVResize);
      window.visualViewport?.removeEventListener("scroll", onVVScroll);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("orientationchange", onOrient);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      window.clearInterval(iv);
    };
  }, []);

  if (!enabled || !m) return null;

  const gapBottom = m.pillBottom != null ? m.ih - m.pillBottom : null;

  return (
    <div
      data-viewport-debug=""
      className="fixed left-2 top-2 z-[9999] max-h-[92dvh] w-[min(92vw,340px)] overflow-y-auto rounded-xl border border-white/25 bg-black/85 p-3 font-mono text-[10px] leading-[1.45] text-lime-200 shadow-2xl backdrop-blur-md"
      spellCheck={false}
    >
      <p className="mb-1 font-bold text-white">VIEWPORT DEBUG (?viewportDebug=1)</p>
      <Row k="innerHeight" v={m.ih} warn={m.dh !== m.ih} />
      <Row k="docEl.clientHeight" v={m.dh} warn={m.dh !== m.ih} />
      <Row k="vv.height" v={m.vh} />
      <Row k="vv.offsetTop" v={m.vo} warn={m.vo > 0 && !m.kbOpen} />
      <Row k="vv.pageTop" v={m.pt} />
      <Row k="vv.scale" v={m.scale} />
      <Row k="body height" v={m.bodyH} warn={m.bodyH < m.ih} />
      <Row k="scrollHeight" v={m.docScrollH} />
      <Row k="--sab" v={m.sab} />
      <Row k="--kb-overlay" v={m.kbOverlay} warn={!m.kbOpen && m.kbOverlay !== "0px"} />
      <Row k="--kb-h" v={m.kbH} />
      {/* PART 1.1 §13.4: метрики браузерной компенсации тулбара.
          visualBottomInset = ih − (vo + vh): нижняя невидимая часть layout
          viewport (тулбар). warn: переменная не 0 при закрытом поле —
          кандидат на источник прыжка панели. */}
      <Row k="visualBottomInset" v={Math.max(0, m.ih - (m.vo + m.vh))} warn={!m.kbOpen && m.ih - (m.vo + m.vh) > 2} />
      <Row k="--browser-bottom-inset" v={m.browserInset} warn={!m.kbOpen && m.mode === "browser" && m.browserInset !== "0px" && m.vo === 0 && m.vh !== 0 && m.ih - (m.vo + m.vh) <= 0} />
      <Row k="pill.top" v={m.pillTop} />
      <Row k="pill.bottom" v={m.pillBottom} warn={m.pillBottom != null && m.pillBottom > m.ih} />
      <Row k="gap под панелью" v={gapBottom} warn={gapBottom != null && gapBottom > 24} />
      <Row k="search-pop.bottom" v={m.popBottom} />
      <Row k="sheet.top/bottom" v={m.sheetTop != null ? `${m.sheetTop}/${m.sheetBottom}` : "—"} />
      <Row k="kb-open" v={String(m.kbOpen)} />
      <Row k="glass" v={m.glass} />
      <Row k="mode" v={m.mode} />
      <Row k="searchOpen/uploadOpen" v={`${m.searchOpen}/${m.uploadOpen}`} />
      <Row k="view" v={m.view} />
      <p className="mt-1.5 font-bold text-white">Журнал (последние 10):</p>
      <div className="max-h-28 overflow-y-auto whitespace-nowrap text-[9.5px] text-lime-300/85">
        {log.map((r, i) => (
          <div key={i}>
            {r.t} {r.ev}: ih={r.ih} vh={r.vh} vo={r.vo}
          </div>
        ))}
      </div>
      <p className="mt-1 text-[9px] text-white/50">
        жёлтый = расхождение (кандидат на источник полосы)
      </p>
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: string | number | null; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-white/70">{k}</span>
      <span className={warn ? "font-bold text-amber-300" : ""}>{String(v ?? "—")}</span>
    </div>
  );
}
