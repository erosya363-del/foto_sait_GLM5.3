"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Фирменный загрузочный сплэш: логотип Askona + прогресс.
 * Скрывается после первого рендера портала (быстро, 1–1.4 c).
 */
export function BootSplash() {
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(8);

  // ФИКС ПОЛОСЫ v3: при первом запуске standalone-PWA iOS раскладывает страницу
  // во вьюпорт без нижнего safe-area. Серия пересчётов вьюпорта под сплэшем —
  // к моменту появления контента вьюпорт уже правильный.
  useEffect(() => {
    const ua = navigator.userAgent || "";
    const iOS = /iP(hone|od|ad)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (!iOS || !standalone) return;
    const nudge = () => {
      try {
        const html = document.documentElement;
        const prev = html.style.minHeight;
        html.style.minHeight = "calc(100dvh + 1px)";
        void html.offsetHeight; // принудительный reflow
        html.style.minHeight = prev;
        window.dispatchEvent(new Event("resize"));
      } catch {
        /* молча */
      }
    };
    const timers = [150, 500, 1000, 1600, 2400, 3200].map((ms) => setTimeout(nudge, ms));
    const onTouch = () => nudge();
    const onVis = () => {
      if (document.visibilityState === "visible") nudge();
    };
    window.addEventListener("touchend", onTouch, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("touchend", onTouch);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setProgress(46), 150);
    const t2 = setTimeout(() => setProgress(78), 450);
    const t3 = setTimeout(() => setProgress(100), 800);
    const t4 = setTimeout(() => setDone(true), 1050);
    return () => [t1, t2, t3, t4].forEach(clearTimeout);
  }, []);

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          key="boot"
          className="boot-bg fixed inset-0 z-[100] grid place-items-center"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04, filter: "blur(10px)" }}
          transition={{ duration: 0.55, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <div className="flex flex-col items-center gap-5">
            {/* Логотип */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="relative"
            >
              <div
                aria-hidden
                className="absolute -inset-8 rounded-full bg-[rgba(var(--brand-rgb),0.18)] blur-2xl"
              />
              { }
              <img
                src="/logo-askona.png"
                alt="Askona"
                className="relative h-10 w-auto object-contain"
                draggable={false}
              />
            </motion.div>

            <div className="flex flex-col items-center gap-2">
              <p className="font-display text-lg font-bold tracking-wide text-foreground">Склад мебели</p>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Askona · фото и остатки
              </p>
            </div>

            <div className="h-[3px] w-28 overflow-hidden rounded-full bg-secondary">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-[var(--brand)] to-[#9db4f5]"
                initial={{ width: "8%" }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
