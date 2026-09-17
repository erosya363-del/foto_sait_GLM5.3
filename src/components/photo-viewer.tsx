"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  ExternalLink,
  Info,
  Link2,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";
import { usePortal, dismissViewer, type ViewerPhoto } from "@/lib/store";
import { useReducedMotion } from "framer-motion";

/* ═══ Photo Viewer v3.1 — движок PhotoSwipe 5 (P0.6–P0.13 ТЗ) ══════════════
   ПОЧЕМУ БИБЛИОТЕКА: самописный движок v3.0 делал setState на каждый кадр
   пинча (подписка scale.on("change") → setPct) и getBoundingClientRect на
   каждый pointermove → re-render React 60–120 раз/сек + forced reflow —
   главный поток блокировался, viewer «зависал» на реальных устройствах.
   PhotoSwipe: transform'ы вне React, lifecycle под его контролем, pinсh/
   pan/double-tap/swipe-preload из коробки, touch-action только на своей
   поверхности (P0.11). Бизнес-логика (share/save/копирование/история)
   СОХРАНЕНА — заменён только движок отображения и жестов.

   Поведение (ТЗ):
   • pinch 1x–5x за пальцами, pan с границами, двойной тап 1x ⇄ 2.5x;
   • свайп ←/→ ТОЛЬКО при 1x; в зуме — pan, к соседнему — дотяг за край
     (allowPanToNext); pinch никогда не листает (P0.10);
   • PHASE 2.1: pinch НЕ закрывает (pinchToClose:false) — pinch используется
     ТОЛЬКО для зума; закрытие = вертикальный drag при 1x (closeOnVerticalDrag)
     или кнопка × (работает из любого зума, ТЗ 1.4);
   • свайп вниз при 1x закрывает; Esc/×/Android Back (History-слой портала);
   • thumb (420px) мгновенно → optimized (≤1600px) подгружается; соседи ±1
     прелоадятся (P0.12/13); оригинал — только по требованию (меню ⋯);
   • мобильный: НИКАКИХ кнопок −/%/+ (P0.8) — только жесты; десктоп:
     zoom-кнопка + wheel + double-click;
   • нативный Share (canShare({files}) → share({url}) → fallback-меню);
   • тап по фото скрывает/показывает UI (P1.6); ⋯ — явное меню действий;
   • long-press/контекстное меню НЕ блокируются (P1.7). */

const MIN_SCALE = 1;
const DEFAULT_MAX = 5;
const DOUBLE_TAP_ZOOM = 2.5;

type PhotoSwipeInstance = InstanceType<typeof PhotoSwipe>;

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

const DOTS_SVG =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><circle cx="5" cy="12" r="0.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="0.6" fill="currentColor" stroke="none"/></svg>';

export function PhotoViewer() {
  const open = usePortal((s) => s.viewerOpen);
  const photos = usePortal((s) => s.viewerPhotos);
  const rawIndex = usePortal((s) => s.viewerIndex);
  const setViewerIndex = usePortal((s) => s.setViewerIndex);
  const reduced = useReducedMotion();

  const n = photos.length;
  const index = Math.min(Math.max(0, rawIndex), Math.max(0, n - 1));

  const [sheet, setSheet] = useState(false);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

  const pswpRef = useRef<PhotoSwipeInstance | null>(null);
  const closingByAppRef = useRef(false);
  const sheetRef = useRef(false);
  const photosRef = useRef<ViewerPhoto[]>(photos);

  /* PHASE2: синхронизация ref'ов в ЭФФЕКТЕ (react-hooks/refs: запись в ref
     во время рендера запрещена). Ref'ы читаются только в обработчиках/
     колбэках — commit-фаза эффекта им полностью достаточна. */
  useEffect(() => {
    sheetRef.current = sheet;
    photosRef.current = photos;
  }, [sheet, photos]);

  /* Синхронизация натуральных размеров для инфо-строки sheet'а.
     PHASE2: сброс — «adjust state during render» (react-hooks/set-state-in-effect
     запрещает setState в эффекте; guarded-паттерн в рендере — документированная
     альтернатива: сбрасываем при смене фото/открытия, ровно один лишний рендер). */
  const natKey = `${open}-${index}`;
  const [natKeyPrev, setNatKeyPrev] = useState(natKey);
  if (natKeyPrev !== natKey) {
    setNatKeyPrev(natKey);
    setNat(null);
  }

  /* ── PHASE2 B1-F4: ЯВНЫЙ body scroll lock на всё время viewer'а ──
     АУДИТ: PhotoSwipe 5.4.4 НЕ лочит страницу (нет overflow:hidden на
     html/body — только touch-action:none на своей поверхности). Программный
     скролл/якоря/скролл-чейнинг в момент жеста двигали страницу ПОД
     просмотрщиком — вклад в «дёргания» и «странные положения».
     Лочим html.overflow, при снятии возвращаем позицию МГНОВЕННО
     (behavior:"instant" — html scroll-behavior:smooth иначе анимировал бы). */
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const y = window.scrollY;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
      window.scrollTo({ top: y, behavior: "instant" });
    };
  }, [open]);

  /* ── Единственный lifecycle-эффект: open → инстанс pswp, close → destroy ──
     Никаких повторных слушателей на каждое открытие: все подписки живут
     ВНУТРИ инстанса pswp и уничтожаются вместе с ним (P0.6). */
  useEffect(() => {
    if (!open || n === 0) {
      // закрытие из приложения (Back/Esc/свайп) — роняем pswp без побочных close
      if (pswpRef.current) {
        closingByAppRef.current = true;
        pswpRef.current.destroy();
        pswpRef.current = null;
        closingByAppRef.current = false;
      }
      return;
    }

    let destroyed = false;

    /* P0.9/КРИТИЧНО: без width/height pswp считает слайд незумибельным
       (slide.width=0 → pinch/zoomTo молча отключены; на реальном телефоне
       пинч бы не работал). Размеры в БД не хранятся (структуру данных не
       меняем) — берём ПРОПОРЦИИ из thumb (тот же аспект, уже в кэше сетки);
       при загрузке optimized pswp сам пересчитывает fit — важен только
       аспект. Для первого слайда ждём зонд (thumb из кэша — мгновенно). */
    const probeDims = (url: string) =>
      new Promise<{ w: number; h: number } | null>((resolve) => {
        if (!url) return resolve(null);
        const im = new Image();
        const done = (v: { w: number; h: number } | null) => {
          im.onload = null;
          im.onerror = null;
          resolve(v);
        };
        im.onload = () => done({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => done(null);
        window.setTimeout(() => done(null), 500);
        im.src = url;
      });

    const dataSource = photos.map((p) => ({
      src: p.url,
      msrc: p.thumbUrl || p.url,
      width: 0,
      height: 0,
    }));

    (async () => {
      /* PHASE2 B1-F1 «изображение в странном положении»: пропорции ВСЕХ слайдов
         ДОЛЖНЫ быть известны ДО pswp.init(). Раньше не-первые слайды жили с
         width:0 до завершения фонового зонда: быстрый свайп на соседний кадр
         получал слайд без пропорций — Slide.isZoomable() = false (pinch молча
         отключён, ZoomLevel.fit = 1 от нулевого размера) и нулевой layout.
         Thumbs (640px) уже в кэше браузера из сетки — параллельный зонд
         занимает первые миллисекунды; окно гонки закрыто полностью. */
      const dims = await Promise.all(
        photos.map((p) => probeDims(p.thumbUrl || p.url))
      );
      if (destroyed) return;
      dims.forEach((d, i) => {
        if (d && dataSource[i]) {
          dataSource[i].width = d.w;
          dataSource[i].height = d.h;
        }
      });

      const isDesktopPointer =
        typeof window !== "undefined" &&
        window.matchMedia("(hover: hover) and (pointer: fine)").matches;

      const pswp = new PhotoSwipe({
        dataSource,
        index: index,
        showHideAnimationType: reduced ? "none" : "fade",
        bgOpacity: 0.94,
        // P0.8: zoom-кнопка только на десктопе; на тач — жесты
        zoom: isDesktopPointer,
        wheelToZoom: true, // десктоп: колесо = зум (страница под ним не скроллится)
        // PHASE 2.1: pinch = ТОЛЬКО зум, НЕ закрытие (сведение пальцев при 1x
        // больше не закрывает viewer). Close: вертикальный drag при 1x или ×.
        pinchToClose: false,
        closeOnVerticalDrag: true, // свайп вниз при 1x закрывает; в зуме — pan
        allowPanToNext: true, // при 1x свайп листает; в зуме — pan с дотягом за край
        loop: true,
        arrowKeys: true, // ←/→ (Esc встроен)
        preload: [1, 1], // P0.13: только current ± 1
        secondaryZoomLevel: DOUBLE_TAP_ZOOM, // double tap 1x → 2.5x
        maxZoomLevel: DEFAULT_MAX, // P0.9: configured maximum (5x)
        padding: { top: 16, bottom: 16, left: 12, right: 12 },
        // PHASE2 B1: русские подписи системных кнопок (a11y); «×» работает
        // при ЛЮБОМ зуме — нативный close() сразу, без reset-zoom (ТЗ 1.4)
        closeTitle: "Закрыть",
        zoomTitle: "Приблизить",
        arrowPrevTitle: "Предыдущее фото",
        arrowNextTitle: "Следующее фото",
        // History НЕ трогаем — слоями History управляет портал (store/popstate)
      });

      pswp.on("uiRegister", () => {
        // Кнопка ⋯ — единственный видимый вход в действия (P1.5/P1.7)
        pswp.ui?.registerElement({
          name: "actions",
          order: 9,
          isButton: true,
          tagName: "button",
          html: DOTS_SVG,
          title: "Действия с фотографией",
          ariaLabel: "Действия с фотографией",
          onClick: () => setSheet(true),
        });
      });

      pswp.on("change", () => {
        if (destroyed) return;
        const i = pswp.currIndex;
        setNat(null);
        if (i !== usePortal.getState().viewerIndex) setViewerIndex(i);
      });

      pswp.on("loadComplete", (e) => {
        if (destroyed) return;
        const cur = photosRef.current[pswp.currIndex];
        if (cur && e.content?.data?.src === cur.url) {
          setNat({ w: Math.round(e.content.width), h: Math.round(e.content.height) });
        }
      });

      /* Пользователь закрыл pswp (крестик/Esc/свайп вниз при 1x) — синхронизируем
         приложение: dismissViewer() гасит слой истории (suppress+back). */
      pswp.on("close", () => {
        if (destroyed || closingByAppRef.current) return;
        if (usePortal.getState().viewerOpen) dismissViewer();
      });

      if (destroyed) {
        pswp.destroy();
        return;
      }
      pswp.init();
      pswpRef.current = pswp;
      /* Desktop double click 1x ⇄ 2.5x (у pswp double-tap — только для тача;
         ТЗ v3.0 п.19 требует и double click на десктопе). */
      if (isDesktopPointer && pswp.element) {
        pswp.element.addEventListener("dblclick", (e) => {
          e.preventDefault();
          const s = pswpRef.current?.currSlide;
          if (!s) return;
          if (s.currZoomLevel > s.zoomLevels.initial + 0.01) {
            pswp.zoomTo(s.zoomLevels.initial, { x: e.clientX, y: e.clientY }, 260);
          } else {
            pswp.zoomTo(s.zoomLevels.secondary, { x: e.clientX, y: e.clientY }, 260);
          }
        });
      }
      /* Детерминированный z-index (P2.4): photoswipe.css инжектится ленивым
         чанком ПОСЛЕ globals и его :root{--pswp-root-z-index:100000}
         перебивает каскад — ставим инлайн (важнее любого порядка чанков):
         выше app-навигации (--z-nav 40/--z-pop 50), ниже sheet (--z-photo-viewer-ui). */
      pswp.element?.style.setProperty("z-index", "var(--z-photo-viewer)");
      /* Отладочный глобал — только в dev (СТАБИЛИЗАЦИЯ: в production мусор в window не льём) */
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as Record<string, unknown>).__pswp = pswp;
      }
    })();

    /* Доп. клавиши (десктоп): + / − / 0 — зум (остальное делает pswp).
       Capture-фаза + stopImmediatePropagation при открытом sheet — Esc/стрелки
       закрывают ТОЛЬКО sheet, не viewer (pswp слушает document — мы первые). */
    const onKey = (e: KeyboardEvent) => {
      if (sheetRef.current) {
        const block = ["Escape", "ArrowLeft", "ArrowRight", "+", "-", "=", "0", "_"];
        if (block.includes(e.key)) {
          // window-листенеры pswp на document ниже по фазе — гасим жест,
          // чтобы стрелки/Esc не дошли до viewer'а сквозь sheet
          e.stopImmediatePropagation();
          if (e.key === "Escape") setSheet(false); // Esc закрывает ТОЛЬКО sheet
        }
        return;
      }
      const inst = pswpRef.current;
      if (!inst) return;
      if (e.key === "+" || e.key === "=") {
        inst.zoomTo(Math.min(DEFAULT_MAX, (inst.currSlide?.currZoomLevel ?? MIN_SCALE) * 1.4), undefined, 260);
      } else if (e.key === "-" || e.key === "_") {
        inst.zoomTo(Math.max(MIN_SCALE, (inst.currSlide?.currZoomLevel ?? MIN_SCALE) / 1.4), undefined, 260);
      } else if (e.key === "0") {
        inst.zoomTo(MIN_SCALE, undefined, 260);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });

    return () => {
      destroyed = true;
      window.removeEventListener("keydown", onKey, { capture: true });
      const inst = pswpRef.current;
      if (inst) {
        closingByAppRef.current = true;
        inst.destroy();
        pswpRef.current = null;
        closingByAppRef.current = false;
      }
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as Record<string, unknown>).__pswp = null;
      }
      setSheet(false);
    };
    // photos/index — ТОЛЬКО для первичного открытия; внутри pswp листает сам
  }, [open, reduced]);

  /* ── Действия: Share / Download / копирование (сохранены из v3.0) ──── */

  const abs = (u: string) => {
    try {
      return new URL(u, window.location.origin).toString();
    } catch {
      return u;
    }
  };

  /* PHASE2 B1-F2 «зависание после действий»: раньше fetch полного фото шёл
     МОЛЧА (секунды на мобильной сети) — sheet закрывался и ничего не
     происходило. Теперь у долгих операций есть честный loading-тост.
     Viewer не закрывается, зум не сбрасывается — fetch вне рендера. */
  const sharePhoto = useCallback(async () => {
    const p = photosRef.current[index];
    if (!p) return;
    const name = fileNameOf(p.url);
    const progress = toast.loading("Готовим фото…", { description: name });
    try {
      const blob = await fetch(p.url).then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.blob();
      });
      const file = new File([blob], name, { type: blob.type || "image/jpeg" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      /* P1.1: iOS — системный Share Sheet с самим ФАЙЛОМ; text/url не
         подмешиваем (payload файл-only — максимум совместимости) */
      if (nav.canShare?.({ files: [file] })) {
        toast.dismiss(progress);
        await nav.share({ files: [file] });
        return;
      }
      if (navigator.share) {
        toast.dismiss(progress);
        await navigator.share({ title: "Фото со склада Askona", url: abs(p.url) });
        return;
      }
      toast.dismiss(progress);
      setSheet(true); // P1.2: Web Share недоступен — fallback-меню
    } catch (e) {
      toast.dismiss(progress);
      if (isShareAbort(e)) return; // пользователь сам закрыл системный шит
      setSheet(true);
    }
  }, [index]);

  const downloadPhoto = useCallback(async () => {
    const p = photosRef.current[index];
    if (!p) return;
    setSheet(false);
    const name = fileNameOf(p.url);
    const progress = toast.loading("Скачиваем…", { description: name });
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
      toast.success("Скачивание началось", { description: name, id: progress });
    } catch {
      /* сеть недоступна для blob — открываем файл в новой вкладке */
      toast.dismiss(progress);
      window.open(p.url, "_blank", "noopener");
    }
  }, [index]);

  const copyLink = useCallback(async () => {
    const p = photosRef.current[index];
    if (!p) return;
    setSheet(false);
    try {
      await navigator.clipboard.writeText(abs(p.url));
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не удалось скопировать ссылку");
    }
  }, [index]);

  /* PHASE2 B1-F3: «Скопировать изображение» УДАЛЕНО из sheet по ТЗ 1.6
     («не перегружать»): на iOS Safari ClipboardItem+PNG стабильно ненадёжен,
     а ссылка/Share покрывают сценарий «переслать фото». Удаление задокументировано
     в docs/MOBILE_PHASE2_REPORT.md (REMOVED LEGACY). */

  const openOriginal = useCallback(() => {
    const p = photosRef.current[index];
    if (!p) return;
    setSheet(false);
    window.open(p.url, "_blank", "noopener");
  }, [index]);

  if (!open || n === 0) return null;
  const cur = photos[index];

  /* Корень viewer'а — сам PhotoSwipe (body-level overlay выше всей навигации:
     P1.8 — панель/шапка/фильтры скрыты за полноэкранным viewer'ом).
     Скролл-лок фона pswp делает сам (P1.9, восстановление позиции — тоже). */
  return (
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
  );
}
