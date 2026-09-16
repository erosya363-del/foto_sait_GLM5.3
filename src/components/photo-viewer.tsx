"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
} from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Info,
  Link2,
  Maximize,
  Minus,
  MoreHorizontal,
  Plus,
  Share2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { usePortal, dismissViewer, type ViewerPhoto } from "@/lib/store";
import { cn } from "@/lib/utils";

/* ═══ Photo Viewer v3.0 (ТЗ п.15–39) ══════════════════════════════════════
   Полноценный просмотрщик фотокаталога:
   • pinch-to-zoom 1x–5x (следует за пальцами, точка под серединой пальцев
     остаётся на месте), pan с жёсткими границами (за viewport не утащить);
   • double tap / double click → 2.5x в точке тапа, обратно → 1x;
   • desktop: wheel-зум (курсор = якорь; страница при этом не скроллится —
     preventDefault только внутри стейджа), drag-pan (grab/grabbing);
   • свайп ←/→ перелистывает ТОЛЬКО при 1x; в зуме жест панрует, а переход
     к соседнему фото — только дотяг за край (>64px overshoot, ТЗ п.31);
   • swipe-down при 1x закрывает; Esc / крестик / Android Back (History API
     портала) — тоже; позиция каталога сохраняется (оверлей, не навигация);
   • прогресс. загрузка: thumb мгновенно, optimized замещает после загрузки
     (п.35/36 — никаких чёрных экранов и мыльных зумов), соседи прелоадятся;
   • нативный Share (Web Share API, файл через canShare), fallback-меню;
   • ⋯ action sheet: bottom sheet на мобиле, компактное меню на десктопе;
   • UI автопрячется через 2.8с бездействия, возвращается по тапу/движению;
   • long-press/контекстное меню НЕ блокируются (п.29/30);
   • prefers-reduced-motion: анимации сокращаются. */

const MIN_SCALE = 1;
const DEFAULT_MAX = 5;
const DOUBLE_TAP_ZOOM = 2.5;
const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };

type Pt = { x: number; y: number };

function fileNameOf(url: string) {
  try {
    return decodeURIComponent(url.split("/").pop() || "photo.jpg");
  } catch {
    return "photo.jpg";
  }
}

function isShareAbort(e: unknown) {
  return e instanceof DOMException && (e.name === "AbortError" || e.name === "NotAllowedError");
}

const slideVariants = {
  enter: (d: number) => ({ opacity: 0, x: d * 56 }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: d * -56 }),
};

export function PhotoViewer() {
  const open = usePortal((s) => s.viewerOpen);
  const photos = usePortal((s) => s.viewerPhotos);
  const rawIndex = usePortal((s) => s.viewerIndex);
  const setViewerIndex = usePortal((s) => s.setViewerIndex);
  const reduced = useReducedMotion();

  const n = photos.length;
  const index = Math.min(Math.max(0, rawIndex), Math.max(0, n - 1));

  const [uiOn, setUiOn] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [pct, setPct] = useState(100);
  const [dir, setDir] = useState(1);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [fullReady, setFullReady] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const fitImgRef = useRef<HTMLImageElement | null>(null);
  const fitRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const maxRef = useRef(DEFAULT_MAX);

  const scale = useMotionValue(1);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const pointers = useRef(new Map<number, Pt>());
  const mode = useRef<"none" | "pan" | "pinch">("none");
  const panStart = useRef({ px: 0, py: 0, x0: 0, y0: 0, t: 0, lastX: 0 });
  const pinchStart = useRef({ dist: 1, mid: { x: 0, y: 0 } as Pt, s0: 1, x0: 0, y0: 0 });
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const tapTimer = useRef<number | null>(null);
  const uiTimer = useRef<number | null>(null);
  const sheetRef = useRef(false);
  const overshoot = useRef(0);

  sheetRef.current = sheet;

  /* ── Геометрия ─────────────────────────────────────────────────────── */

  const clampPos = useCallback((s: number, nx: number, ny: number) => {
    const f = fitRef.current;
    const mx = Math.max(0, ((f.w || 0) * (s - 1)) / 2);
    const my = Math.max(0, ((f.h || 0) * (s - 1)) / 2);
    return {
      x: Math.min(mx, Math.max(-mx, nx)),
      y: Math.min(my, Math.max(-my, ny)),
    };
  }, []);

  const measureFit = useCallback(() => {
    const el = fitImgRef.current;
    if (!el) return;
    // offsetWidth/Height — layout-размер БЕЗ учёта transform (мы в зуме — ок)
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 4 && h > 4) {
      fitRef.current = { w, h };
      if (nat) {
        maxRef.current = Math.min(5, Math.max(2.5, (nat.w / w) * 1.25));
      }
    }
  }, [nat]);

  const stopAnims = useCallback(() => {
    scale.stop();
    x.stop();
    y.stop();
  }, [scale, x, y]);

  const resetZoom = useCallback(() => {
    stopAnims();
    scale.set(MIN_SCALE);
    x.set(0);
    y.set(0);
    setPct(100);
  }, [scale, x, y, stopAnims]);

  /** Зум к целевому масштабу с сохранением точки якоря (курсор/тап/центр) */
  const zoomAt = useCallback(
    (target: number, anchor?: Pt, animated = true) => {
      const stage = stageRef.current;
      const rect = stage?.getBoundingClientRect();
      const s0 = scale.get();
      const s1 = Math.min(maxRef.current, Math.max(MIN_SCALE, target));
      const cx = anchor && rect ? anchor.x - rect.left - rect.width / 2 : 0;
      const cy = anchor && rect ? anchor.y - rect.top - rect.height / 2 : 0;
      const contentX = (cx - x.get()) / s0;
      const contentY = (cy - y.get()) / s0;
      const cl = clampPos(s1, cx - contentX * s1, cy - contentY * s1);
      if (!animated || reduced) {
        stopAnims();
        scale.set(s1);
        x.set(cl.x);
        y.set(cl.y);
        return;
      }
      animate(scale, s1, SPRING);
      animate(x, cl.x, SPRING);
      animate(y, cl.y, SPRING);
    },
    [clampPos, reduced, scale, stopAnims, x, y]
  );

  const snapBack = useCallback(() => {
    const cl = clampPos(scale.get(), x.get(), y.get());
    if (reduced) {
      x.set(cl.x);
      y.set(cl.y);
      return;
    }
    animate(x, cl.x, { type: "spring", stiffness: 500, damping: 40 });
    animate(y, cl.y, { type: "spring", stiffness: 500, damping: 40 });
  }, [clampPos, reduced, scale, x, y]);

  /* ── Листание ──────────────────────────────────────────────────────── */

  const go = useCallback(
    (d: number) => {
      if (n < 2) return;
      setDir(d);
      setViewerIndex((index + d + n) % n);
    },
    [index, n, setViewerIndex]
  );

  /* Сброс зума при смене фото (стандарт просмотрщиков) + замер fit-размера */
  useEffect(() => {
    if (!open) return;
    resetZoom();
    setFullReady(false);
    setNat(null);
    maxRef.current = DEFAULT_MAX;
    let tries = 0;
    let raf = 0;
    const tick = () => {
      measureFit();
      if (fitRef.current.w < 4 && tries++ < 24) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, open, resetZoom, measureFit]);

  /* Прелоад соседей (полные версии) — листание без пустых кадров */
  useEffect(() => {
    if (!open || n === 0) return;
    for (const d of [-1, 1]) {
      const p = photos[(index + d + n) % n];
      if (p) {
        const im = new Image();
        im.src = p.url;
      }
    }
  }, [open, index, n, photos]);

  /* ── UI: автоскрытие панелей через 2.8с бездействия ────────────────── */
  const bumpUi = useCallback(() => {
    setUiOn(true);
    if (uiTimer.current) window.clearTimeout(uiTimer.current);
    uiTimer.current = window.setTimeout(() => {
      if (sheetRef.current) return;
      setUiOn(false);
    }, 2800);
  }, []);

  useEffect(() => {
    if (!open) return;
    bumpUi();
    return () => {
      if (uiTimer.current) window.clearTimeout(uiTimer.current);
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
    };
  }, [open, bumpUi]);

  /* Проценты масштаба — подписка на MotionValue (без ререндера на каждый кадр:
     React сам отбрасывает set с тем же значением) */
  useEffect(() => {
    const un = scale.on("change", (v) => setPct(Math.round(v * 100)));
    return un;
  }, [scale]);

  /* ── Открытие: lock скролла фона (позиция каталога сохраняется) ────── */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /* ── Клавиатура (п.39): Esc ← → + − 0 ─────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (sheetRef.current) {
          setSheet(false);
          return;
        }
        dismissViewer();
      } else if (e.key === "ArrowRight") {
        go(1);
      } else if (e.key === "ArrowLeft") {
        go(-1);
      } else if (e.key === "+" || e.key === "=") {
        zoomAt(scale.get() * 1.4);
      } else if (e.key === "-" || e.key === "_") {
        zoomAt(scale.get() / 1.4);
      } else if (e.key === "0") {
        zoomAt(MIN_SCALE);
      } else {
        return;
      }
      bumpUi();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go, zoomAt, scale, bumpUi]);

  /* ── Wheel-зум (desktop): якорь = курсор; preventDefault ТОЛЬКО здесь ── */
  useEffect(() => {
    const stage = stageRef.current;
    if (!open || !stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopAnims();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
      zoomAt(scale.get() * factor, { x: e.clientX, y: e.clientY }, false);
      bumpUi();
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [open, zoomAt, scale, stopAnims, bumpUi]);

  /* ── Жесты: pointer events (pinch / pan / свайпы / двойной тап) ────── */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* старые браузеры — работаем и без capture */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stopAnims();
    bumpUi();
    if (pointers.current.size === 1) {
      mode.current = "pan";
      panStart.current = {
        px: e.clientX,
        py: e.clientY,
        x0: x.get(),
        y0: y.get(),
        t: performance.now(),
        lastX: e.clientX,
      };
      overshoot.current = 0;
      /* ВАЖНО: lastTap здесь НЕ сбрасываем — он хранит ПЕРВЫЙ тап пары
         «двойной тап»; сброс в pointerdown убивал детект (пара не собиралась) */
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        s0: scale.get(),
        x0: x.get(),
        y0: y.get(),
      };
      mode.current = "pinch";
      // второй палец отменяет одиночный тап/UI-переключение
      if (tapTimer.current) {
        window.clearTimeout(tapTimer.current);
        tapTimer.current = null;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === "mouse") bumpUi(); // движение мыши возвращает панели
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = stageRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;

    if (mode.current === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const st = pinchStart.current;
      const s1 = Math.min(maxRef.current, Math.max(MIN_SCALE, st.s0 * (dist / st.dist)));
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      // точка контента под серединой пальцев следует за серединой (пинч «за пальцами»)
      const contentX = (st.mid.x - left - cx - st.x0) / st.s0;
      const contentY = (st.mid.y - top - cy - st.y0) / st.s0;
      const cl = clampPos(
        s1,
        mid.x - left - cx - contentX * s1,
        mid.y - top - cy - contentY * s1
      );
      scale.set(s1);
      x.set(cl.x);
      y.set(cl.y);
    } else if (mode.current === "pan") {
      const st = panStart.current;
      const dx = e.clientX - st.px;
      const dy = e.clientY - st.py;
      const s = scale.get();
      if (s > 1.001) {
        // пан увеличенного фото — с жёсткими границами (п.17), дотяг за край
        // копится в overshoot и на отпускании решает: соседнее фото или назад
        const cl = clampPos(s, st.x0 + dx, st.y0 + dy);
        overshoot.current = st.x0 + dx - cl.x;
        x.set(cl.x);
        y.set(cl.y);
      } else {
        // 1x: свайп-перелист/закрытие решаются на pointerup порогами
        st.x0 = x.get();
        st.y0 = y.get();
        st.px = e.clientX;
        st.py = e.clientY;
        void dy;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (mode.current === "pinch") {
      if (pointers.current.size === 1) {
        // остался один палец — бесшовно продолжаем пан с этой точки
        const [p] = [...pointers.current.values()];
        mode.current = "pan";
        panStart.current = {
          px: p.x,
          py: p.y,
          x0: x.get(),
          y0: y.get(),
          t: performance.now(),
          lastX: p.x,
        };
      } else if (pointers.current.size === 0) {
        mode.current = "none";
        snapBack();
      }
      return;
    }
    mode.current = "none";
    if (pointers.current.size > 0) return;
    const st = panStart.current;
    const dx = e.clientX - st.px;
    const dy = e.clientY - st.py;
    const moved = Math.hypot(dx, dy);
    const s = scale.get();
    const now = performance.now();

    /* Двойной тап / двойной клик (п.18/19): 1x → 2.5x в точке тапа, назад → 1x */
    const lt = lastTap.current;
    if (lt.t > 0 && now - lt.t < 320 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 28 && moved < 14) {
      lastTap.current = { t: 0, x: 0, y: 0 };
      if (tapTimer.current) {
        window.clearTimeout(tapTimer.current);
        tapTimer.current = null;
      }
      if (s > 1.02) zoomAt(MIN_SCALE);
      else zoomAt(DOUBLE_TAP_ZOOM, { x: e.clientX, y: e.clientY });
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };

    if (s <= 1.001) {
      /* 1x: перелист строго горизонтальным свайпом, закрытие — свайпом вниз */
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        go(dx < 0 ? 1 : -1);
        return;
      }
      if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.3) {
        dismissViewer();
        return;
      }
      if (moved < 14 && e.pointerType !== "mouse") {
        /* одиночный тап — показать/скрыть панели (с задержкой на двойной тап);
           движение мыши уже возвращает UI, клик мыши ничего не переключает */
        tapTimer.current = window.setTimeout(() => {
          tapTimer.current = null;
          setUiOn((v) => !v);
        }, 300);
      }
      return;
    }

    /* Зум: дотяг за край — чёткий дополнительный жест перехода (п.31) */
    if (Math.abs(overshoot.current) > 64) {
      go(overshoot.current > 0 ? -1 : 1);
      return;
    }
    snapBack();
  };

  /* ── Действия: Share / Download / копирование (п.24–28) ───────────── */

  const abs = (u: string) => {
    try {
      return new URL(u, window.location.origin).toString();
    } catch {
      return u;
    }
  };

  const sharePhoto = useCallback(async () => {
    const p = photos[index];
    if (!p) return;
    const name = fileNameOf(p.url);
    try {
      const blob = await fetch(p.url).then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.blob();
      });
      const file = new File([blob], name, { type: blob.type || "image/jpeg" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      /* iPhone/iOS: системный Share Sheet с самим ФАЙЛОМ (сохранить в Фото,
         отправить в мессенджер и т.д.); Android — системный Share Sheet */
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: "Фото со склада Askona", text: name });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "Фото со склада Askona", text: name, url: abs(p.url) });
        return;
      }
      setSheet(true); // Web Share недоступен (часть desktop) — fallback-меню
    } catch (e) {
      if (isShareAbort(e)) return; // пользователь сам закрыл системный шит
      setSheet(true);
    }
  }, [photos, index]);

  const downloadPhoto = useCallback(async () => {
    const p = photos[index];
    if (!p) return;
    setSheet(false);
    const name = fileNameOf(p.url);
    try {
      const blob = await fetch(p.url).then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.blob();
      });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 4000);
      toast.success("Скачивание началось", { description: name });
    } catch {
      /* сеть недоступна для blob — открываем оригинал в новой вкладке */
      window.open(p.url, "_blank", "noopener");
    }
  }, [photos, index]);

  const copyLink = useCallback(async () => {
    const p = photos[index];
    if (!p) return;
    setSheet(false);
    try {
      await navigator.clipboard.writeText(abs(p.url));
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не удалось скопировать ссылку");
    }
  }, [photos, index]);

  const canCopyImage = typeof window !== "undefined" && "ClipboardItem" in window;

  const copyImage = useCallback(async () => {
    const p = photos[index];
    if (!p) return;
    setSheet(false);
    try {
      const blob = await fetch(p.url).then((r) => r.blob());
      const bmp = await createImageBitmap(blob);
      const cv = document.createElement("canvas");
      cv.width = bmp.width;
      cv.height = bmp.height;
      cv.getContext("2d")?.drawImage(bmp, 0, 0);
      const png = await new Promise<Blob | null>((res) => cv.toBlob(res, "image/png"));
      if (!png) throw new Error("png failed");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      toast.success("Изображение скопировано в буфер");
    } catch {
      toast.error("Браузер не поддерживает копирование изображений");
    }
  }, [photos, index]);

  const openOriginal = useCallback(() => {
    const p = photos[index];
    if (!p) return;
    setSheet(false);
    window.open(p.url, "_blank", "noopener");
  }, [photos, index]);

  const actualSize = useCallback(() => {
    const f = fitRef.current;
    const target = nat && f.w > 4 ? nat.w / f.w : 1;
    zoomAt(Math.max(MIN_SCALE, target));
  }, [nat, zoomAt]);

  if (!open || n === 0) return null;
  const cur = photos[index];

  return (
    <motion.div
      key="viewer"
      className="viewer-backdrop fixed inset-0 z-[90] flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.24 }}
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр фотографии"
    >
      {/* Верхняя панель: × · счётчик · ⋯ (автоскрытие, п.22/38) */}
      <div className="viewer-top" data-hidden={!uiOn}>
        <button
          type="button"
          className="vbtn"
          onClick={() => dismissViewer()}
          aria-label="Закрыть (Esc)"
        >
          <X size={19} strokeWidth={2.3} />
        </button>
        <span className="viewer-count tabular" aria-live="polite">
          {index + 1} / {n}
        </span>
        <button
          type="button"
          className="vbtn"
          onClick={() => {
            setSheet(true);
            bumpUi();
          }}
          aria-label="Действия с фотографией"
          aria-expanded={sheet}
        >
          <MoreHorizontal size={20} strokeWidth={2.3} />
        </button>
      </div>

      {/* Стейдж: pinch/pan/swipe/wheel/double-tap; long-press и контекстное
          меню НЕ блокируются (п.29/30) — только touch-action на самом стейдже */}
      <div
        ref={stageRef}
        className="viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={index}
            className="viewer-slide"
            custom={dir}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reduced ? 0 : 0.28, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <motion.div className="viewer-zoom" style={{ scale, x, y }}>
              {/* thumb: мгновенный кадр; optimized незаметно замещает (п.35) */}
              <img
                ref={fitImgRef}
                src={cur.thumbUrl || cur.url}
                alt=""
                draggable={false}
                className="viewer-img"
                onLoad={measureFit}
              />
              <img
                src={cur.url}
                alt={fileNameOf(cur.url)}
                draggable={false}
                className={cn("viewer-img viewer-img-full", fullReady && "is-ready")}
                onLoad={(e) => {
                  setFullReady(true);
                  setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
                }}
              />
            </motion.div>
          </motion.div>
        </AnimatePresence>

        {n > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Предыдущее фото"
              className="viewer-nav vbtn nav-l"
            >
              <ChevronLeft size={24} strokeWidth={2.4} />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Следующее фото"
              className="viewer-nav vbtn nav-r"
            >
              <ChevronRight size={24} strokeWidth={2.4} />
            </button>
          </>
        )}
      </div>

      {/* Нижняя панель: − · % · + · Fit · Share · Скачать (п.20/26/38) */}
      <div className="viewer-bar" data-hidden={!uiOn}>
        <button
          type="button"
          className="vbtn"
          onClick={() => {
            zoomAt(scale.get() / 1.4);
            bumpUi();
          }}
          aria-label="Уменьшить"
        >
          <Minus size={19} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          className="viewer-pct tabular"
          onClick={() => {
            if (Math.abs(scale.get() - MIN_SCALE) < 0.02) actualSize();
            else zoomAt(MIN_SCALE);
            bumpUi();
          }}
          title="Тап: реальный размер ⇄ вписать в экран"
        >
          {pct}%
        </button>
        <button
          type="button"
          className="vbtn"
          onClick={() => {
            zoomAt(scale.get() * 1.4);
            bumpUi();
          }}
          aria-label="Увеличить"
        >
          <Plus size={19} strokeWidth={2.4} />
        </button>
        <span className="viewer-sep" aria-hidden />
        <button
          type="button"
          className="vbtn"
          onClick={() => {
            zoomAt(MIN_SCALE);
            bumpUi();
          }}
          aria-label="Вписать в экран"
        >
          <Maximize size={17} strokeWidth={2.3} />
        </button>
        <button
          type="button"
          className="vbtn"
          onClick={sharePhoto}
          aria-label="Поделиться"
        >
          <Share2 size={18} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          className="vbtn"
          onClick={downloadPhoto}
          aria-label="Скачать фото"
        >
          <Download size={18} strokeWidth={2.2} />
        </button>
      </div>

      {/* ⋯ Action sheet: bottom sheet на мобиле, меню на десктопе (п.28) */}
      <AnimatePresence>
        {sheet && (
          <motion.div
            key="sheet"
            className="viewer-sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
            onClick={() => setSheet(false)}
          >
            <motion.div
              className="viewer-sheet"
              role="menu"
              aria-label="Действия с фотографией"
              initial={{ y: 70, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              transition={{ type: "spring", stiffness: 460, damping: 38 }}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="viewer-sheet-handle" aria-hidden />
              <p className="viewer-sheet-title">Действия с фото</p>
              {typeof navigator !== "undefined" && "share" in navigator && (
                <button type="button" className="viewer-sheet-row" onClick={sharePhoto}>
                  <Share2 size={17} strokeWidth={2.2} />
                  Поделиться…
                </button>
              )}
              <button type="button" className="viewer-sheet-row" onClick={downloadPhoto}>
                <Download size={17} strokeWidth={2.2} />
                Скачать фото
              </button>
              <button type="button" className="viewer-sheet-row" onClick={copyLink}>
                <Link2 size={17} strokeWidth={2.2} />
                Скопировать ссылку
              </button>
              {canCopyImage && (
                <button type="button" className="viewer-sheet-row" onClick={copyImage}>
                  <Copy size={17} strokeWidth={2.2} />
                  Скопировать изображение
                </button>
              )}
              <button type="button" className="viewer-sheet-row" onClick={openOriginal}>
                <ExternalLink size={17} strokeWidth={2.2} />
                Открыть оригинал
              </button>
              <p className="viewer-sheet-info">
                <Info size={14} className="shrink-0" />
                <span className="min-w-0 truncate tabular">
                  {fileNameOf(cur.url)}
                  {nat ? ` · ${nat.w}×${nat.h} px` : ""}
                  {` · фото ${index + 1} из ${n}`}
                </span>
              </p>
              <button
                type="button"
                className="viewer-sheet-row viewer-sheet-cancel"
                onClick={() => setSheet(false)}
              >
                Отмена
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
