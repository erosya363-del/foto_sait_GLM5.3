"use client";

import { motion } from "framer-motion";
import { usePortal, type Warehouse } from "@/lib/store";
import { cn } from "@/lib/utils";

const WAREHOUSES: Warehouse[] = ["Обухово", "Владимир"];

/**
 * Пружинный сегмент-контрол складов (v1.5): скользящая пилюля на пружине,
 * крупная зона тапа. Заменяет <select> в шапке остатков.
 */
export function WarehouseSegmented({ className }: { className?: string }) {
  const warehouse = usePortal((s) => s.warehouse);
  const setWarehouse = usePortal((s) => s.setWarehouse);

  return (
    <div
      role="tablist"
      aria-label="Склад"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-secondary/70 p-1 sm:w-auto",
        className
      )}
    >
      {WAREHOUSES.map((w) => {
        const on = warehouse === w;
        return (
          <button
            key={w}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => setWarehouse(w)}
            className={cn(
              "relative flex-1 justify-center rounded-full px-3.5 py-2 text-[12.5px] font-bold transition-colors sm:flex-none sm:py-1.5 sm:text-[12px]",
              on ? "text-[color:var(--primary-foreground)]" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {on && (
              <motion.span
                layoutId="wh-seg"
                className="absolute inset-0 rounded-full bg-[color:var(--brand)] shadow-lg"
                transition={{ type: "spring", stiffness: 520, damping: 34 }}
              />
            )}
            <span className="relative z-10 whitespace-nowrap">{w}</span>
          </button>
        );
      })}
    </div>
  );
}
