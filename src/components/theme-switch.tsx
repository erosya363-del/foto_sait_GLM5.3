"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { key: "system", label: "Как в системе", Icon: Monitor },
  { key: "light", label: "Светлая", Icon: Sun },
  { key: "dark", label: "Тёмная", Icon: Moon },
] as const;

const emptySubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

/**
 * Стеклянная капсула (.lg-theme — мутное стекло, блюр 80px) с нейтральной
 * «линзой» на активной опции (var(--lens-bg)/var(--lens-border), как линза
 * пилюли) — без бирюзовых обводок и свечения. Текст/иконки — сплошные цвета.
 */
export function ThemeSwitch({ compact = false, mini = false }: { compact?: boolean; mini?: boolean }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  const active = mounted ? theme ?? "system" : "system";

  return (
    <div
      role="radiogroup"
      aria-label="Тема оформления"
      className={cn(
        "lg-theme items-center gap-0.5",
        compact && !mini ? "scale-90" : ""
      )}
    >
      {OPTIONS.map(({ key, label, Icon }) => {
        const on = active === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => setTheme(key)}
            className={cn(
              "relative grid place-items-center rounded-full transition-all duration-300 active:scale-90",
              mini ? "h-7 w-7" : "h-8 w-8",
              on ? "text-[color:var(--foreground)]" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {on && (
              <span className="absolute inset-0 rounded-full border border-[color:var(--lens-border)] bg-[color:var(--lens-bg)] shadow-[inset_0_1px_0_var(--glass-spec-strong)]" />
            )}
            <Icon size={mini ? 14 : 15} strokeWidth={2.1} className="relative" />
          </button>
        );
      })}
    </div>
  );
}
