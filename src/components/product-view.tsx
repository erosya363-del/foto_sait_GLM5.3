"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, MapPin, Maximize2 } from "lucide-react";
import { usePortal, dismissProduct } from "@/lib/store";
import { ProductCrumbs } from "@/components/breadcrumbs";
import type { CatalogItemDto } from "@/lib/portal";

export function ProductView() {
  const { productId, openViewer } = usePortal();

  const { data, isLoading } = useQuery<CatalogItemDto>({
    queryKey: ["product", productId],
    queryFn: async () => {
      const r = await fetch(`/api/catalog?product=${productId}`);
      if (!r.ok) throw new Error("Товар не найден");
      const j = await r.json();
      const found = (j.items as CatalogItemDto[]).find((p) => p.id === productId);
      if (!found) throw new Error("Товар не найден");
      return found;
    },
    enabled: !!productId,
  });

  if (!productId) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Шапка: круглая «Назад» 40px (ведёт к источнику открытия) + крошки пути + счётчик фото */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={dismissProduct}
          aria-label="Назад"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-secondary/70 text-foreground transition-all hover:text-[color:var(--brand)] active:scale-90"
        >
          <ArrowLeft size={18} strokeWidth={2.3} />
        </button>
        <div className="min-w-0 flex-1">
          {data ? (
            <ProductCrumbs
              categoryName={data.categoryName}
              modelName={data.modelName}
              variantName={data.variantName}
            />
          ) : (
            <div className="h-7" />
          )}
        </div>
        {data && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
            <Camera size={12} strokeWidth={2.3} />
            {data.photos.length} фото
          </span>
        )}
      </div>

      {isLoading || !data ? (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <div className="skeleton h-48 lg:h-72" />
          <div className="skeleton h-96" />
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[340px_1fr]">
          {/* Инфопанель — sticky на десктопе */}
          <aside className="glass flex flex-col gap-4 rounded-3xl p-5 lg:sticky lg:top-6">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--brand)]">
                {data.categoryName}
              </p>
              <h1 className="font-display mt-1 text-2xl font-bold leading-tight">{data.modelName}</h1>
              {data.variantName && (
                <p className="mt-0.5 text-[13.5px] font-semibold text-[color:var(--brand)]">{data.variantName}</p>
              )}
              <p className="mt-1 text-[13px] text-muted-foreground">
                {[data.materialName, data.sizeName].filter(Boolean).join(" · ") || "Материал не указан"}
              </p>
            </div>

            {data.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.tags.map((t) => (
                  <span key={t} className="tag-mini">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {data.description && (
              <p className="text-[13px] leading-relaxed text-muted-foreground">{data.description}</p>
            )}

            <div className="hairline" />
            <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <MapPin size={13} className="text-[color:var(--brand)]" />
              Наличие уточняйте в разделе «Остатки»
            </p>
          </aside>

          {/* Вертикальная фотолента */}
          <div className="flex flex-col gap-4">
            {data.photos.map((p, i) => (
              <figure
                key={p.id}
                className="photo-frame group rise"
                onClick={() => openViewer(data.photos.map((ph) => ph.url), i)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") openViewer(data.photos.map((ph) => ph.url), i);
                }}
                style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
              >
                { }
                <img
                  src={p.url}
                  alt={p.comment ?? data.modelName}
                  loading="lazy"
                  onLoad={(e) => e.currentTarget.classList.add("is-loaded")}
                  className="img-fade w-full"
                />
                {/* Подсказка «открыть просмотрщик» — иконка увеличения */}
                <span
                  className="pointer-events-none absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur-md transition-opacity duration-300 group-hover:opacity-100"
                  aria-hidden
                >
                  <Maximize2 size={14} strokeWidth={2.4} />
                </span>
                {p.comment && (
                  <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-4 pb-3 pt-10 text-[12px] font-medium text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    {p.comment}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
