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
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-secondary/70 p-1",
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
              "relative rounded-full px-3.5 py-1.5 text-[12px] font-bold transition-colors",
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
