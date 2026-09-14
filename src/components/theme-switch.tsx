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

export function ThemeSwitch({ compact = false, mini = false }: { compact?: boolean; mini?: boolean }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  const active = mounted ? theme ?? "system" : "system";

  return (
    <div
      role="radiogroup"
      aria-label="Тема оформления"
      className={cn(
        "relative inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-secondary p-1",
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
              on
                ? "text-[color:var(--brand)] shadow-[0_0_14px_rgba(var(--brand-rgb),0.35)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {on && (
              <span className="absolute inset-0 rounded-full bg-[rgba(var(--brand-rgb),0.14)] ring-1 ring-[rgba(var(--brand-rgb),0.4)]" />
            )}
            <Icon size={mini ? 14 : 15} strokeWidth={2.1} className="relative" />
          </button>
        );
      })}
    </div>
  );
}
