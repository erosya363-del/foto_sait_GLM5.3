"use client";

import { useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { usePortal, dismissViewer } from "@/lib/store";

/**
 * Полноэкранный просмотр фото:
 * ← → листание, Escape — закрыть, свайп на телефоне, циклический перелист.
 */
export function PhotoViewer() {
  const { viewerOpen, viewerPhotos, viewerIndex, setViewerIndex } = usePortal();
  const touchX = useRef<number | null>(null);

  const next = useCallback(() => {
    if (!viewerPhotos.length) return;
    setViewerIndex((viewerIndex + 1) % viewerPhotos.length);
  }, [viewerIndex, viewerPhotos.length, setViewerIndex]);

  const prev = useCallback(() => {
    if (!viewerPhotos.length) return;
    setViewerIndex((viewerIndex - 1 + viewerPhotos.length) % viewerPhotos.length);
  }, [viewerIndex, viewerPhotos.length, setViewerIndex]);

  useEffect(() => {
    if (!viewerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") dismissViewer();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [viewerOpen, next, prev]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 48) {
      if (dx < 0) next();
      else prev();
    }
    touchX.current = null;
  };

  return (
    <AnimatePresence>
      {viewerOpen && viewerPhotos.length > 0 && (
        <motion.div
          className="viewer-backdrop fixed inset-0 z-[90] flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр фотографии"
        >
          {/* Верхняя панель */}
          <div className="flex items-center justify-between px-4 pb-2 pt-[max(14px,env(safe-area-inset-top))]">
            <span className="font-display rounded-full bg-white/10 px-3.5 py-1.5 text-[12px] font-bold text-white tabular">
              {viewerIndex + 1} / {viewerPhotos.length}
            </span>
            <button
              type="button"
              onClick={dismissViewer}
              aria-label="Закрыть"
              className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition-all hover:scale-110 hover:bg-white/20 active:scale-95"
            >
              <X size={19} strokeWidth={2.3} />
            </button>
          </div>

          {/* Фото */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.img
                key={viewerIndex}
                src={viewerPhotos[viewerIndex]}
                alt=""
                draggable={false}
                className="max-h-full max-w-full select-none rounded-xl object-contain shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)]"
                initial={{ opacity: 0, x: 44, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -44, scale: 0.96 }}
                transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
              />
            </AnimatePresence>

            {/* Стрелки */}
            <button
              type="button"
              onClick={prev}
              aria-label="Предыдущее фото"
              className="viewer-nav absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/12 text-white sm:left-5 sm:h-12 sm:w-12"
            >
              <ChevronLeft size={24} strokeWidth={2.4} />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Следующее фото"
              className="viewer-nav absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/12 text-white sm:right-5 sm:h-12 sm:w-12"
            >
              <ChevronRight size={24} strokeWidth={2.4} />
            </button>
          </div>

          {/* Счётчик-подсказка */}
          <p className="pb-[max(16px,env(safe-area-inset-bottom))] pt-3 text-center text-[11px] font-medium text-white/45">
            Свайп или стрелки ← → · Esc — закрыть
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
