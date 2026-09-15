"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle, Boxes, Check, Copy, ImageIcon, LayoutGrid, Rows3, Tag,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePortal, type StockMode } from "@/lib/store";
import { matchesQuery } from "@/lib/translit";
import { formatPrice, type StockItemDto } from "@/lib/portal";
import { StockCard } from "@/components/stock-card";
import { WarehouseSegmented } from "@/components/warehouse-segmented";

type StockResp = {
  items: StockItemDto[];
  categories: string[];
  meta: { total: number; units: number; saleCount: number; staleCount: number };
};

function qtyClass(qty: number) {
  if (qty >= 6) return "qty-ok";
  if (qty >= 2) return "qty-low";
  return "qty-crit";
}

/* ─────────────────── Компактная строка остатка ─────────────────── */

function StockRow({ item, index }: { item: StockItemDto; index: number }) {
  const [copied, setCopied] = useState(false);
  const openProduct = usePortal((s) => s.openProduct);

  async function copyName(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(item.name);
      setCopied(true);
      toast.success("Название скопировано", { description: item.name });
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  const pm = item.photoMatch;

  return (
    <motion.div
      layout
      className="stock-row spot rise group flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 transition-colors hover:border-[rgba(var(--brand-rgb),0.45)]"
      style={{ animationDelay: `${Math.min(index % 24, 14) * 22}ms` }}
    >
      {/* Количество */}
      <span
        className={cn(
          "qty-badge grid h-9 w-11 shrink-0 place-items-center rounded-lg border border-border bg-secondary text-[14px] font-bold tabular",
          qtyClass(item.qty)
        )}
        title={`${item.qty} шт на складе`}
      >
        {item.qty}
      </span>

      {/* Название и мета */}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold leading-tight">
          {item.name}
          {item.sale && <span className="tag-mini tag-sale shrink-0">−{item.sale.discountPercent}%</span>}
        </p>
        <p className="flex items-center gap-1.5 truncate text-[11.5px] text-muted-foreground">
          {item.category}
          {item.size && <><span className="text-border">·</span>{item.size}</>}
          {item.feature && <><span className="text-border">·</span>{item.feature}</>}
          {item.sale && (
            <span className="font-semibold text-[#fb7185]">
              {formatPrice(item.sale.finalPrice)}
            </span>
          )}
        </p>
      </div>

      {/* Действия — на мобилке компактнее (разбор: «иконки занимают много места») */}
      <button
        type="button"
        onClick={copyName}
        title="Скопировать название"
        aria-label="Скопировать название"
        className="hidden h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:grid sm:h-8 sm:w-8"
      >
        {copied ? <Check size={14} strokeWidth={2.5} className="text-[color:var(--brand)]" /> : <Copy size={13.5} strokeWidth={2} />}
      </button>
      {pm ? (
        <button
          type="button"
          onClick={() => openProduct(pm.variantId, "stock")}
          className="flex h-7 shrink-0 items-center gap-1 rounded-lg border border-[rgba(var(--brand-rgb),0.4)] bg-[color:var(--brand)]/10 px-1.5 text-[11px] font-bold text-[color:var(--brand)] transition-colors hover:bg-[color:var(--brand)]/20 sm:h-8 sm:gap-1.5 sm:px-2.5 sm:text-[11.5px]"
          title={`Совпадение: ${pm.variantName}`}
        >
          <ImageIcon size={13} strokeWidth={2.3} />
          {pm.photoCount > 1 && <span>{pm.photoCount}</span>}
        </button>
      ) : (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-dashed border-border text-muted-foreground/50 sm:h-8 sm:w-8" title="Фото пока нет">
          <ImageIcon size={13} strokeWidth={2} />
        </span>
      )}
    </motion.div>
  );
}

/* ────────────────────────── Раздел остатков ────────────────────── */

export function StockView() {
  const warehouse = usePortal((s) => s.warehouse);
  const mode = usePortal((s) => s.stockMode);
  const setMode = usePortal((s) => s.setStockMode);
  const searchQuery = usePortal((s) => s.searchQuery);
  const [cat, setCat] = useState<string | null>(null);
  const [saleOnly, setSaleOnly] = useState(false);

  const { data, isLoading } = useQuery<StockResp>({
    queryKey: ["stock", warehouse],
    queryFn: async () => {
      const r = await fetch(`/api/stock?warehouse=${encodeURIComponent(warehouse)}`);
      if (!r.ok) throw new Error("Ошибка загрузки остатков");
      return r.json();
    },
    placeholderData: (prev) => prev,
  });

  const items = useMemo(() => {
    let list = data?.items ?? [];
    if (cat) list = list.filter((i) => i.category === cat);
    if (saleOnly) list = list.filter((i) => i.sale);
    if (searchQuery) list = list.filter((i) => matchesQuery([i.name, i.category, i.size, i.feature].filter(Boolean).join(" "), searchQuery));
    return list;
  }, [data, cat, saleOnly, searchQuery]);

  const cats = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of data?.items ?? []) map.set(i.category, (map.get(i.category) ?? 0) + 1);
    return [...map.entries()];
  }, [data]);

  return (
    <div className="flex flex-col gap-3.5">
      {/* Заголовок + статистика */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-bold leading-tight sm:text-2xl">
            Остатки <span className="gradient-text">склада</span>
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {warehouse} · {data?.meta.total ?? "…"} позиций · {data?.meta.units ?? "…"} шт
            {(data?.meta.saleCount ?? 0) > 0 && <> · {data!.meta.saleCount} в распродаже</>}
          </p>
        </div>
        <div className="mode-switch flex items-center gap-0.5 rounded-xl border border-border bg-secondary/60 p-0.5">
          <button
            type="button"
            title="Компактно"
            aria-label="Компактный вид"
            aria-pressed={mode === "compact"}
            onClick={() => setMode("compact" as StockMode)}
            className={cn(
              "relative grid h-8 w-9 place-items-center rounded-lg transition-colors",
              mode === "compact" ? "bg-[color:var(--brand)] text-[color:var(--primary-foreground)]" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Rows3 size={15} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            title="Карточки"
            aria-label="Карточки"
            aria-pressed={mode === "cards"}
            onClick={() => setMode("cards" as StockMode)}
            className={cn(
              "relative grid h-8 w-9 place-items-center rounded-lg transition-colors",
              mode === "cards" ? "bg-[color:var(--brand)] text-[color:var(--primary-foreground)]" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutGrid size={15} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* Разбор §3: переключение склада — заметнее (своя строка, крупнее тап-зоны) */}
      <WarehouseSegmented className="w-full sm:w-auto" />

      {/* Чипы категорий + фильтры */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCat(null)}
          className={cn("chip", !cat && "is-on")}
        >
          <Boxes size={13} strokeWidth={2.3} />
          Все
        </button>
        {cats.map(([name, count]) => (
          <button key={name} type="button" onClick={() => setCat(cat === name ? null : name)} className={cn("chip", cat === name && "is-on")}>
            {name}
            <span className="opacity-60">{count}</span>
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" onClick={() => setSaleOnly(!saleOnly)} className={cn("chip", saleOnly && "is-on")}>
          <Tag size={12} strokeWidth={2.4} />
          Распродажа
        </button>
      </div>

      {/* Применённый глобальный поиск */}
      {searchQuery && (
        <p className="text-[12.5px] text-muted-foreground">
          Фильтр поиска: <span className="font-bold text-foreground">«{searchQuery}»</span> — найдено {items.length}
        </p>
      )}

      {/* Список */}
      {isLoading && !data ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-14 rounded-xl" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-12 text-center">
          <span className="empty-live grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-muted-foreground">
            <AlertTriangle size={26} />
          </span>
          <p className="font-display text-base font-bold">Ничего не найдено</p>
          <p className="text-[13px] text-muted-foreground">Смягчите фильтры или переключите склад.</p>
        </div>
      ) : mode === "compact" ? (
        <div className="flex flex-col gap-1.5">
          {items.map((it, i) => <StockRow key={it.id} item={it} index={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((it, i) => <StockCard key={it.id} item={it} index={i} />)}
        </div>
      )}
    </div>
  );
}
