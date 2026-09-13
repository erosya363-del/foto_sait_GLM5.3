"use client";

import { BedDouble, Sofa, Layers, PackageOpen } from "lucide-react";
import { useCountUp } from "@/hooks/use-count-up";

function Stat({
  Icon,
  label,
  value,
  tone,
}: {
  Icon: typeof BedDouble;
  label: string;
  value: number;
  tone: string;
}) {
  const n = useCountUp(value);
  return (
    <div className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 card-hover sm:p-4">
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-transform duration-300 group-hover:scale-110"
        style={{ background: `rgba(var(--brand-rgb),0.12)`, color: tone }}
      >
        <Icon size={19} strokeWidth={2.1} />
      </span>
      <span className="flex flex-col">
        <span className="stat-num text-lg leading-tight text-foreground sm:text-xl">{n.toLocaleString("ru-RU")}</span>
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

export function StatsStrip({
  total,
  units,
  sale,
  stale,
}: {
  total: number;
  units: number;
  sale: number;
  stale: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
      <Stat Icon={Layers} label="позиций" value={total} tone="#6fe6e2" />
      <Stat Icon={PackageOpen} label="единиц товара" value={units} tone="#11b5b0" />
      <Stat Icon={Sofa} label="распродажа" value={sale} tone="#fb7185" />
      <Stat Icon={BedDouble} label="проверить остаток" value={stale} tone="#fbbf24" />
    </div>
  );
}
