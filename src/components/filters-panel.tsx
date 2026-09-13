"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type StockFilters = {
  bedPm: Set<string>;
  sofaKind: Set<string>;
  kpbKind: Set<string>;
  sizes: Set<string>;
  staleOnly: boolean;
};

export const EMPTY_FILTERS: StockFilters = {
  bedPm: new Set(),
  sofaKind: new Set(),
  kpbKind: new Set(),
  sizes: new Set(),
  staleOnly: false,
};

export function filtersCount(f: StockFilters): number {
  return f.bedPm.size + f.sofaKind.size + f.kpbKind.size + f.sizes.size + (f.staleOnly ? 1 : 0);
}

function toggle(set: Set<string>, v: string): Set<string> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={cn("chip", on && "is-on")} aria-pressed={on}>
      {on && <Check size={13} strokeWidth={2.6} />}
      {children}
    </button>
  );
}

/** Содержимое фильтров — общее для мобильного drawer и десктопного поповера */
export function FiltersPanel({
  filters,
  setFilters,
  sizes,
}: {
  filters: StockFilters;
  setFilters: (f: StockFilters) => void;
  sizes: string[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <Section title="Кровати">
        {["С ПМ", "Без ПМ"].map((v) => (
          <Chip key={v} on={filters.bedPm.has(v)} onClick={() => setFilters({ ...filters, bedPm: toggle(filters.bedPm, v) })}>
            {v}
          </Chip>
        ))}
      </Section>
      <Section title="Диваны">
        {["Прямой", "Угловой"].map((v) => (
          <Chip
            key={v}
            on={filters.sofaKind.has(v)}
            onClick={() => setFilters({ ...filters, sofaKind: toggle(filters.sofaKind, v) })}
          >
            {v}
          </Chip>
        ))}
      </Section>
      <Section title="КПБ">
        {["Евро", "Семейный", "Двуспальный", "Полуторный"].map((v) => (
          <Chip
            key={v}
            on={filters.kpbKind.has(v)}
            onClick={() => setFilters({ ...filters, kpbKind: toggle(filters.kpbKind, v) })}
          >
            {v}
          </Chip>
        ))}
      </Section>
      <Section title="Размеры">
        {sizes.slice(0, 14).map((v) => (
          <Chip key={v} on={filters.sizes.has(v)} onClick={() => setFilters({ ...filters, sizes: toggle(filters.sizes, v) })}>
            {v}
          </Chip>
        ))}
      </Section>
      <Section title="Склад">
        <Chip on={filters.staleOnly} onClick={() => setFilters({ ...filters, staleOnly: !filters.staleOnly })}>
          Требует проверки остатка
        </Chip>
      </Section>
    </div>
  );
}
