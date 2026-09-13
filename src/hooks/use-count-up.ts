"use client";

import { useEffect, useRef, useState } from "react";

/** Плавный счётчик для статистики */
export function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(target);
  const prev = useRef(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const from = prev.current;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else prev.current = target;
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      prev.current = target;
    };
  }, [target, duration]);

  return value;
}
