"use client";

import { useQuery } from "@tanstack/react-query";
import { Camera, MapPin, Maximize2 } from "lucide-react";
import { usePortal } from "@/lib/store";
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
      {/* АУДИТ v2.6: отдельная круглая «Назад» УДАЛЕНА — та же кнопка уже есть
         в липкой шапке (на iPhone — слева, на десктопе — справа); раньше
         на экране товара было ДВЕ видимых стрелки назад */}
      <div className="flex items-center gap-2.5">
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
        <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[340px_1fr]">
          <div className="skeleton h-48 lg:h-72" />
          <div className="skeleton h-96" />
        </div>
      ) : (
        /* АУДИТ v2.7: [&>*]:min-w-0 — grid-элементы с min-width:auto
           (строки truncate = nowrap → min-content по всей длине текста)
           раздували трек до ширины длинной строки: колонки (вместе с лентой
           фото) вылезали за правый край iPhone (scrollWidth 434 при 393) —
           «фото выходят за рамки» на самом глубоком уровне каталога */
        <div className="grid items-start gap-4 [&>*]:min-w-0 lg:grid-cols-[340px_1fr]">
          {/* Инфопанель — АУДИТ v2.6 («большая карточка — делай строкой, описание
              лишнее»): компактный блок — заголовок В ОДНУ строку, вариант/
              ткань/размер одной строкой, описание удалено, крупная стеклянная
              карточка ужата (p-4, gap-2.5) */}
          <aside className="glass flex min-w-0 flex-col gap-2.5 rounded-2xl p-4 lg:sticky lg:top-6">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[10.5px] font-bold uppercase tracking-[0.16em] text-[color:var(--brand)]">
                {data.categoryName}
              </p>
            </div>
            <h1 className="font-display truncate text-[17px] font-bold leading-snug lg:text-xl">
              {data.modelName}
            </h1>
            <p className="truncate text-[12.5px] text-muted-foreground">
              {[data.variantName, data.materialName, data.sizeName].filter(Boolean).join(" · ") || "Материал не указан"}
            </p>

            {data.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.tags.map((t) => (
                  <span key={t} className="tag-mini">
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div className="hairline" />
            <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <MapPin size={13} className="shrink-0 text-[color:var(--brand)]" />
              Наличие уточняйте в разделе «Остатки»
            </p>
          </aside>

          {/* Вертикальная фотолента */}
          <div className="flex min-w-0 flex-col gap-4">
            {data.photos.map((p, i) => (
              <figure
                key={p.id}
                className="photo-frame group rise"
                onClick={() => openViewer(data.photos.map((ph) => ({ url: ph.url, thumbUrl: ph.thumbUrl })), i)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") openViewer(data.photos.map((ph) => ({ url: ph.url, thumbUrl: ph.thumbUrl })), i);
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
                  className="pointer-events-none absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur-[var(--glass-blur)] transition-opacity duration-300 group-hover:opacity-100"
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
