"use client";

import { Check, Copy, ImageIcon, Layers3, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { usePortal } from "@/lib/store";
import { formatPrice, type StockItemDto } from "@/lib/portal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function qtyClass(qty: number) {
  if (qty >= 6) return "qty-ok";
  if (qty >= 2) return "qty-low";
  return "qty-crit";
}

export function StockCard({ item, index }: { item: StockItemDto; index: number }) {
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

  const photos = item.photoMatch;

  return (
    <motion.article
      layout
      className="card-hover spot group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 rise"
      style={{ animationDelay: `${Math.min(index % 20, 12) * 30}ms` }}
    >
      {/* Верх: имя + копирование */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold leading-snug text-foreground">{item.name}</h3>
        <button
          type="button"
          onClick={copyName}
          title="Скопировать название"
          aria-label="Скопировать название"
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-secondary text-muted-foreground transition-all duration-300",
            "hover:border-[rgba(var(--brand-rgb),0.5)] hover:text-[color:var(--brand)] active:scale-90",
            copied && "border-[rgba(var(--brand-rgb),0.6)] text-[color:var(--brand)]"
          )}
        >
          {copied ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} strokeWidth={2} />}
        </button>
      </div>

      {/* Количество + метки */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "qty-badge inline-flex items-baseline gap-1 rounded-lg border border-border bg-secondary px-2.5 py-1 text-[15px]",
            qtyClass(item.qty)
          )}
        >
          {item.qty}
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">шт</span>
        </span>
        {item.size && <span className="tag-mini">{item.size}</span>}
        {item.stale && (
          <span className="tag-mini tag-warn inline-flex items-center gap-1">
            <AlertTriangle size={11} strokeWidth={2.4} />
            остаток {item.staleDays} дн
          </span>
        )}
        {item.sale && <span className="tag-mini tag-sale">−{item.sale.discountPercent}%</span>}
      </div>

      {/* Распродажа */}
      {item.sale && (
        <div className="flex items-baseline gap-2 rounded-xl border border-[rgba(251,113,133,0.25)] bg-[rgba(251,113,133,0.07)] px-3 py-2">
          <s className="text-xs text-muted-foreground tabular">{formatPrice(item.sale.oldPrice)}</s>
          <b className="font-display text-[15px] font-bold text-[#fb7185] tabular">
            {formatPrice(item.sale.finalPrice)}
          </b>
        </div>
      )}

      {/* Низ: связка с фотокаталогом */}
      {photos ? (
        item.photoMatches.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="btn-ghost shine flex w-full items-center justify-center gap-2 py-2 text-[13px]">
                <ImageIcon size={15} strokeWidth={2.2} />
                Смотреть фото · {item.photoMatches.length}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-xl border-border">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Найдено несколько вариантов
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {item.photoMatches.map((m) => (
                <DropdownMenuItem
                  key={m.variantId}
                  onClick={() => openProduct(m.variantId, "stock")}
                  className="cursor-pointer gap-2.5 rounded-lg py-2.5"
                >
                  { }
                  <img src={m.coverUrl} alt="" className="h-10 w-14 rounded-md object-cover" />
                  <span className="flex flex-col">
                    <span className="text-[12px] font-semibold leading-tight">{m.variantName}</span>
                    <span className="text-[11px] text-muted-foreground">{m.photoCount} фото</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            type="button"
            onClick={() => openProduct(photos.variantId, "stock")}
            className="btn-brand shine flex w-full items-center justify-center gap-2 py-2 text-[13px]"
            title={`Совпадение: ${photos.variantName}`}
          >
            <ImageIcon size={15} strokeWidth={2.2} />
            Смотреть фото
            <span className="rounded-full bg-black/15 px-1.5 text-[10px] font-bold">{photos.photoCount}</span>
          </button>
        )
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground">
          <Layers3 size={14} className="opacity-60" />
          Фото пока нет
        </div>
      )}
    </motion.article>
  );
}
