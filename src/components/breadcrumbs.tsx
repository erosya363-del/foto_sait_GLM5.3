"use client";

import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortal } from "@/lib/store";

export type Crumb = {
  key: string;
  label: string;
  onPress?: () => void;
  current?: boolean;
};

/* ─── Переходы из крошек (учитывают открытый товар) ─────────────────────── */

function jumpTo(target: {
  category?: string | null;
  model?: string | null;
  fabrics?: boolean;
  material?: string | null;
}) {
  const s = usePortal.getState();
  if (s.productId) {
    // из ОТКРЫТОГО товара: закрываем, применяем уровень, скролл наверх;
    // push-эффект создаст запись — браузерный Back вернёт к товару
    s.jumpProductToLevel(target);
  } else if (target.fabrics) {
    s.setCatFabrics(true);
    if (target.material) s.setCatMaterial(target.material);
  } else if (target.category != null) {
    s.setCatCategory(target.category);
    if (target.model) s.setCatModel(target.model);
  }
}

export function goCatalogTop() {
  usePortal.getState().resetCatalog();
}

export function goCategory(cat: string) {
  jumpTo({ category: cat, model: null });
}

export function goModel(cat: string, model: string) {
  jumpTo({ category: cat, model });
}

export function goFabrics() {
  jumpTo({ fabrics: true });
}

export function goMaterial(name: string) {
  jumpTo({ fabrics: true, material: name });
}

/* ─── Лента крошек ──────────────────────────────────────────────────────── */

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] | null }) {
  const ref = useRef<HTMLDivElement>(null);

  // текущее (правое) звено может не влезть — автоскролл ленты к нему
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [crumbs]);

  if (!crumbs || crumbs.length < 2) return null;

  return (
    <div
      ref={ref}
      className="no-scrollbar flex items-center gap-1 overflow-x-auto whitespace-nowrap"
      role="navigation"
      aria-label="Путь в каталоге"
    >
      {crumbs.map((c, i) => (
        <span key={c.key} className="inline-flex shrink-0 items-center gap-1">
          {i > 0 && <ChevronRight size={14} strokeWidth={2.4} className="shrink-0 text-muted-foreground/70" />}
          {c.onPress && !c.current ? (
            <button
              type="button"
              onClick={c.onPress}
              className="rounded-full bg-secondary px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground active:scale-95"
            >
              {c.label}
            </button>
          ) : (
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[11.5px] font-bold",
                c.current
                  ? "bg-[color:var(--brand)]/14 text-[color:var(--brand)]"
                  : "text-muted-foreground"
              )}
            >
              {c.label}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/* ─── Крошки каталога по состоянию стора ───────────────────────────────── */

export function useCatalogCrumbs(): Crumb[] | null {
  const searchQuery = usePortal((s) => s.searchQuery);
  const catFabrics = usePortal((s) => s.catFabrics);
  const catMaterial = usePortal((s) => s.catMaterial);
  const catCategory = usePortal((s) => s.catCategory);
  const catModel = usePortal((s) => s.catModel);

  if (searchQuery) {
    const short = searchQuery.length > 18 ? searchQuery.slice(0, 17) + "…" : searchQuery;
    return [
      { key: "root", label: "Каталог", onPress: goCatalogTop },
      { key: "search", label: `Поиск: «${short}»`, current: true },
    ];
  }
  if (catFabrics) {
    const crumbs: Crumb[] = [{ key: "root", label: "Каталог", onPress: goCatalogTop }];
    if (catMaterial) {
      crumbs.push({ key: "fabrics", label: "Все ткани", onPress: goFabrics });
      crumbs.push({ key: "material", label: catMaterial, current: true });
    } else {
      crumbs.push({ key: "fabrics", label: "Все ткани", current: true });
    }
    return crumbs;
  }
  if (catCategory && catModel) {
    return [
      { key: "root", label: "Каталог", onPress: goCatalogTop },
      { key: "cat", label: catCategory, onPress: () => goCategory(catCategory) },
      { key: "model", label: catModel, current: true },
    ];
  }
  if (catCategory) {
    return [
      { key: "root", label: "Каталог", onPress: goCatalogTop },
      { key: "cat", label: catCategory, current: true },
    ];
  }
  return null; // уровень 1 — крошек нет
}

/* ─── Крошки в шапке товара ─────────────────────────────────────────────── */

export function ProductCrumbs({
  categoryName,
  modelName,
  variantName,
}: {
  categoryName?: string | null;
  modelName?: string | null;
  variantName?: string | null;
}) {
  if (!categoryName || !modelName) return null;
  const crumbs: Crumb[] = [
    { key: "root", label: "Каталог", onPress: goCatalogTop },
    { key: "cat", label: categoryName, onPress: () => goCategory(categoryName) },
  ];
  // из модели прыжок в её варианты (товар закрывается)
  crumbs.push({ key: "model", label: modelName, onPress: () => goModel(categoryName, modelName) });
  if (variantName) crumbs.push({ key: "variant", label: variantName, current: true });
  else crumbs[crumbs.length - 1] = { key: "model", label: modelName, current: true };

  return <Breadcrumbs crumbs={crumbs} />;
}
