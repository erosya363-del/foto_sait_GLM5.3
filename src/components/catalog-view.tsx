"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowUpRight, BedDouble, Camera, ChevronRight, LayoutGrid, List,
  Search as SearchIcon, Shapes, Sofa, Sparkles, Square, SwatchBook,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortal, type CatalogMode } from "@/lib/store";
import { Breadcrumbs, useCatalogCrumbs } from "@/components/breadcrumbs";
import type { CatalogItemDto } from "@/lib/portal";

type SearchResp = {
  popular: string[];
  fabrics: Array<{ id: string; name: string; swatchUrl: string | null; count: number }>;
  variants: Array<{
    id: string;
    categoryName: string;
    modelName: string;
    variantName: string | null;
    materialName: string | null;
    sizeName: string | null;
    tags: string[];
    isNew?: boolean;
    photo: { url: string; thumbUrl: string } | null;
    photoCount: number;
  }>;
};

type FabricDto = {
  id: string;
  name: string;
  swatchUrl: string | null;
  thumb: string | null;
  variantCount: number;
  newCount: number;
};

type FreshItem = {
  photoId: string;
  url: string;
  thumbUrl: string;
  variantId: string;
  categoryName: string;
  modelName: string;
  variantName: string | null;
};

/** Пилюля NEW на карточках (варианты, ткани, лента новинок) */
function NewBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute z-10 rounded-full bg-[color:var(--brand)] px-2 py-0.5 text-[9.5px] font-extrabold tracking-[0.08em] text-white shadow-lg shadow-[color:var(--brand)]/35",
        className
      )}
    >
      NEW
    </span>
  );
}

function CatIcon({ icon, className }: { icon?: string | null; className?: string }) {
  if (icon === "sofa") return <Sofa className={className} strokeWidth={1.9} />;
  if (icon === "bed") return <BedDouble className={className} strokeWidth={1.9} />;
  return <Shapes className={className} strokeWidth={1.9} />;
}

const MODES: Array<{ key: CatalogMode; Icon: typeof LayoutGrid; label: string }> = [
  { key: "grid", Icon: LayoutGrid, label: "Квадраты" },
  { key: "rows", Icon: List, label: "Строки" },
  { key: "large", Icon: Square, label: "Крупно" },
];

function ModeSwitch() {
  const mode = usePortal((s) => s.catalogMode);
  const setMode = usePortal((s) => s.setCatalogMode);
  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-border bg-secondary/60 p-0.5">
      {MODES.map(({ key, Icon, label }) => (
        <button
          key={key}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={mode === key}
          onClick={() => setMode(key)}
          className={cn(
            "grid h-8 w-9 place-items-center rounded-lg transition-colors",
            mode === key
              ? "bg-[color:var(--brand)] text-[color:var(--primary-foreground)]"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon size={15} strokeWidth={2.2} />
        </button>
      ))}
    </div>
  );
}

/* ───────────────── Уровень 1: категории + новинки + ткани ─────────────── */

/** Лента «Новинки за 7 дней» — свежие фото, горизонтальный скролл */
function FreshStrip() {
  const openProduct = usePortal((s) => s.openProduct);
  const { data } = useQuery<{ items: FreshItem[]; total: number }>({
    queryKey: ["catalog", "level=fresh"],
    queryFn: async () => {
      const r = await fetch("/api/catalog?level=fresh");
      if (!r.ok) throw new Error("Ошибка загрузки");
      return r.json();
    },
  });

  if (!data?.items?.length) return null;

  return (
    <section className="flex flex-col gap-2" aria-label="Новинки за 7 дней">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        <Sparkles size={13} strokeWidth={2.4} className="text-[color:var(--brand)]" />
        Новинки за 7 дней
        <span className="rounded-full bg-[color:var(--brand)]/15 px-1.5 py-px text-[10px] font-extrabold text-[color:var(--brand)]">
          {data.total}
        </span>
      </p>
      <div className="no-scrollbar -mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {data.items.map((p, i) => (
          <motion.button
            key={p.photoId}
            type="button"
            onClick={() => openProduct(p.variantId, "catalog")}
            className="card-hover spot rise group relative w-[122px] shrink-0 snap-start overflow-hidden rounded-2xl border border-border bg-card text-left"
            style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
          >
            <NewBadge className="left-2 top-2" />
            <div className="aspect-[4/5] w-full overflow-hidden bg-muted">
              <img
                src={p.thumbUrl}
                alt={p.modelName}
                loading="lazy"
                onLoad={(e) => e.currentTarget.classList.add("is-loaded")}
                className="img-fade h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
              />
            </div>
            <div className="flex flex-col gap-px p-2">
              <p className="truncate text-[11.5px] font-bold leading-tight">{p.modelName}</p>
              {p.variantName && (
                <p className="truncate text-[10.5px] font-semibold text-[color:var(--brand)]">{p.variantName}</p>
              )}
            </div>
          </motion.button>
        ))}
      </div>
    </section>
  );
}

function LevelCategories() {
  const setCat = usePortal((s) => s.setCatCategory);
  const setFabrics = usePortal((s) => s.setCatFabrics);
  const crumbs = useCatalogCrumbs();
  const { data } = useQuery<{
    categories: Array<{ id: string; name: string; icon: string | null; modelCount: number; variantCount: number }>;
  }>({
    queryKey: ["catalog", "level=categories"],
    queryFn: async () => {
      const r = await fetch("/api/catalog?level=categories");
      if (!r.ok) throw new Error("Ошибка загрузки");
      return r.json();
    },
  });
  const { data: fabrics } = useQuery<{ fabrics: FabricDto[] }>({
    queryKey: ["catalog", "level=fabrics"],
    queryFn: async () => {
      const r = await fetch("/api/catalog?level=fabrics");
      if (!r.ok) throw new Error("Ошибка загрузки");
      return r.json();
    },
  });

  const fabricCount = fabrics?.fabrics?.length ?? 0;
  const variantTotal = (data?.categories ?? []).reduce((a, c) => a + c.variantCount, 0);

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs crumbs={crumbs} />
      <FreshStrip />
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="col-span-full mb-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Категория → модель → ткань и название. Или используйте{" "}
          <span className="font-bold text-foreground">единый поиск</span> — «sky» покажет все фото этой ткани.
        </div>
        {(data?.categories ?? []).map((c, i) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCat(c.name)}
            className="card-hover spot rise group flex flex-col items-center gap-3 rounded-3xl border border-border bg-card px-4 py-8 text-center"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[color:var(--brand)]/12 text-[color:var(--brand)] transition-transform duration-300 group-hover:scale-110">
              <CatIcon icon={c.icon} className="h-8 w-8" />
            </span>
            <span className="font-display text-[15px] font-bold">{c.name}</span>
            <span className="text-[12px] text-muted-foreground">
              {c.modelCount} моделей · {c.variantCount} вариантов
            </span>
          </button>
        ))}
        {!data && Array.from({ length: 2 }).map((_, i) => <div key={i} className="skeleton h-52 rounded-3xl" />)}
      </div>

      {/* Шаг 4: все ткани — альтернативный обход каталога */}
      <button
        type="button"
        onClick={() => setFabrics(true)}
        className="card-hover spot rise group flex items-center gap-4 rounded-3xl border border-[color:var(--brand)]/30 bg-[color:var(--brand)]/8 px-5 py-4 text-left"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[color:var(--brand)]/14 text-[color:var(--brand)] transition-transform duration-300 group-hover:scale-110">
          <SwatchBook size={22} strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[14.5px] font-bold">Все ткани</span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {fabricCount > 0 ? `${fabricCount} тканей · ${variantTotal} вариантов фото` : "Обзор каталога по тканям"}
          </span>
        </span>
        <ChevronRight size={17} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>
  );
}

/* ───────────────────────── Уровень 2: модели ──────────────────────────── */

function LevelModels({ category }: { category: string }) {
  const setModel = usePortal((s) => s.setCatModel);
  const crumbs = useCatalogCrumbs();
  const { data } = useQuery<{
    models: Array<{ id: string; name: string; latin: string | null; variantCount: number; newCount?: number }>;
  }>({
    queryKey: ["catalog", "level=models", category],
    queryFn: async () => {
      const r = await fetch(`/api/catalog?level=models&category=${encodeURIComponent(category)}`);
      if (!r.ok) throw new Error("Ошибка загрузки");
      return r.json();
    },
  });

  return (
    <div className="flex flex-col gap-2.5">
      <Breadcrumbs crumbs={crumbs} />
      {(data?.models ?? []).map((m, i) => (
        <button
          key={m.id}
          type="button"
          onClick={() => setModel(m.name)}
          className="card-hover spot rise group flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-4 text-left"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[color:var(--brand)]/12 font-display text-[15px] font-bold text-[color:var(--brand)]">
            {m.name.slice(0, 2).toUpperCase()}
            {(m.newCount ?? 0) > 0 && <NewBadge className="-right-1.5 -top-1.5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-[14.5px] font-bold">{m.name}</span>
            <span className="text-[12px] text-muted-foreground">{m.variantCount} вариантов фото</span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>
      ))}
      {!data && Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-[72px] rounded-2xl" />)}
    </div>
  );
}

/* ─────────────────── Карточка варианта (общая для уровней) ─────────────── */

function VariantCard({
  v, mode, index,
}: {
  v: {
    id: string; modelName: string; variantName: string | null;
    materialName: string | null; sizeName: string | null;
    tags: string[]; photo: { thumbUrl: string } | null; photoCount: number;
    isNew?: boolean;
  };
  mode: CatalogMode;
  index: number;
}) {
  const openProduct = usePortal((s) => s.openProduct);
  const meta = [v.materialName, v.sizeName].filter(Boolean).join(" · ");

  if (mode === "rows") {
    return (
      <motion.button
        layout
        type="button"
        onClick={() => openProduct(v.id, "catalog")}
        className="card-hover spot rise flex w-full items-center gap-3.5 overflow-hidden rounded-2xl border border-border bg-card p-2.5 text-left"
        style={{ animationDelay: `${Math.min(index % 12, 10) * 40}ms` }}
      >
        <div className="relative h-[72px] w-[96px] shrink-0 overflow-hidden rounded-xl bg-muted">
          {v.isNew && <NewBadge className="left-1.5 top-1.5" />}
          {v.photo && (
            <img
              src={v.photo.thumbUrl}
              alt={v.modelName}
              loading="lazy"
              onLoad={(e) => e.currentTarget.classList.add("is-loaded")}
              className="img-fade h-full w-full object-cover"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[13.5px] font-bold leading-tight">{v.modelName}</p>
          {v.variantName && <p className="truncate text-[12px] font-semibold text-[color:var(--brand)]">{v.variantName}</p>}
          <p className="truncate text-[11.5px] text-muted-foreground">{meta}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {v.tags.slice(0, 2).map((t) => <span key={t} className="tag-mini">{t}</span>)}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1 self-start rounded-full bg-black/45 px-2 py-1 text-[10px] font-bold text-white">
          <Camera size={10} strokeWidth={2.5} />{v.photoCount}
        </span>
      </motion.button>
    );
  }

  const large = mode === "large";
  return (
    <motion.button
      layout
      type="button"
      onClick={() => openProduct(v.id, "catalog")}
      className={cn(
        "card-hover spot group rise flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-left",
        large && "sm:rounded-3xl"
      )}
      style={{ animationDelay: `${Math.min(index % 12, 10) * 40}ms` }}
    >
      {/* Фиксированная пропорция — фото никогда не налезает на текст (анти-джиттер) */}
      <div className={cn("relative w-full overflow-hidden bg-muted", large ? "aspect-[16/10]" : "aspect-[4/3]")}>
        {v.isNew && <NewBadge className="left-2.5 top-2.5" />}
        {v.photo && (
          <img
            src={v.photo.thumbUrl}
            alt={v.modelName}
            loading="lazy"
            onLoad={(e) => e.currentTarget.classList.add("is-loaded")}
            className="img-fade h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        )}
        <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-bold text-white backdrop-blur-md">
          <Camera size={11} strokeWidth={2.5} />
          {v.photoCount}
        </span>
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent py-3 text-[11px] font-bold text-white opacity-0 transition-all duration-300 group-hover:opacity-100">
          Смотреть
          <ArrowUpRight size={13} strokeWidth={2.6} />
        </span>
      </div>
      <div className={cn("flex flex-col gap-1 p-3", large && "p-4")}>
        <p className={cn("font-display font-bold leading-tight", large ? "text-[16px]" : "text-[13px]")}>{v.modelName}</p>
        {v.variantName && (
          <p className="text-[12px] font-semibold text-[color:var(--brand)]">{v.variantName}</p>
        )}
        <p className={cn("text-muted-foreground", large ? "text-[12.5px]" : "text-[11.5px]")}>{meta}</p>
        <div className="flex flex-wrap gap-1">
          {v.tags.slice(0, large ? 3 : 2).map((t) => (
            <span key={t} className="tag-mini">{t}</span>
          ))}
          {v.tags.length > (large ? 3 : 2) && <span className="tag-mini opacity-70">+{v.tags.length - (large ? 3 : 2)}</span>}
        </div>
      </div>
    </motion.button>
  );
}

/* ─────────────── Уровень 3 / результаты поиска: варианты ──────────────── */

function VariantsGrid({ items, mode }: { items: SearchResp["variants"]; mode: CatalogMode }) {
  if (mode === "rows")
    return (
      <div className="flex flex-col gap-2">
        {items.map((v, i) => <VariantCard key={v.id} v={v} mode="rows" index={i} />)}
      </div>
    );
  return (
    <div className={cn("grid gap-3 sm:gap-4", mode === "large" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
      {items.map((v, i) => <VariantCard key={v.id} v={v} mode={mode} index={i} />)}
    </div>
  );
}

function LevelVariants({ category, model }: { category: string; model: string }) {
  const mode = usePortal((s) => s.catalogMode);
  const { data, isLoading } = useQuery<{ items: CatalogItemDto[] }>({
    queryKey: ["catalog", "cat", category, "model", model],
    queryFn: async () => {
      const p = new URLSearchParams({ category, model });
      const r = await fetch(`/api/catalog?${p}`);
      if (!r.ok) throw new Error("Ошибка загрузки");
      return r.json();
    },
    placeholderData: (prev) => prev,
  });

  const items: SearchResp["variants"] = useMemo(
    () =>
      (data?.items ?? []).map((it) => ({
        id: it.id,
        categoryName: it.categoryName,
        modelName: it.modelName,
        variantName: it.variantName ?? null,
        materialName: it.materialName,
        sizeName: it.sizeName,
        tags: it.tags,
        isNew: it.isNew,
        photo: it.photos[0] ? { url: it.photos[0].url, thumbUrl: it.photos[0].thumbUrl } : null,
        photoCount: it.photos.length,
      })),
    [data]
  );

  if (isLoading && !data)
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-56" />)}
      </div>
    );

  if (items.length === 0)
    return (
      <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-14 text-center">
        <span className="empty-live grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-muted-foreground">
          <SwatchBook size={26} />
        </span>
        <p className="font-display text-base font-bold">Фото пока не добавлены</p>
        <p className="text-[13px] text-muted-foreground">Загрузите первые фото через раздел «Загрузка».</p>
      </div>
    );

  return <VariantsGrid items={items} mode={mode} />;
}

/* ─────────────── Уровень «Все ткани» (Шаг 4) ──────────────────────────── */

function LevelFabrics() {
  const setMaterial = usePortal((s) => s.setCatMaterial);
  const crumbs = useCatalogCrumbs();
  const { data } = useQuery<{ fabrics: FabricDto[] }>({
    queryKey: ["catalog", "level=fabrics"],
    queryFn: async () => {
      const r = await fetch("/api/catalog?level=fabrics");
      if (!r.ok) throw new Error("Ошибка загрузки");
      return r.json();
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <Breadcrumbs crumbs={crumbs} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {(data?.fabrics ?? []).map((f, i) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setMaterial(f.name)}
            className="card-hover spot rise group flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-left"
            style={{ animationDelay: `${Math.min(i % 12, 10) * 40}ms` }}
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
              {f.newCount > 0 && <NewBadge className="left-2.5 top-2.5" />}
              {f.thumb ? (
                <img
                  src={f.thumb}
                  alt={f.name}
                  loading="lazy"
                  onLoad={(e) => e.currentTarget.classList.add("is-loaded")}
                  className="img-fade h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              ) : f.swatchUrl ? (
                <img src={f.swatchUrl} alt={f.name} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <span className="grid h-full w-full place-items-center text-muted-foreground">
                  <SwatchBook size={26} />
                </span>
              )}
            </div>
            <div className="flex flex-col gap-0.5 p-3">
              <p className="truncate text-[13px] font-bold">{f.name}</p>
              <p className="text-[11.5px] text-muted-foreground">
                {f.variantCount} вариантов фото
                {f.newCount > 0 && (
                  <span className="ml-1 font-bold text-[color:var(--brand)]">· {f.newCount} новых</span>
                )}
              </p>
            </div>
          </button>
        ))}
        {!data && Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-44" />)}
      </div>
      {data && (data.fabrics ?? []).length === 0 && (
        <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-14 text-center">
          <span className="empty-live grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-muted-foreground">
            <SwatchBook size={26} />
          </span>
          <p className="font-display text-base font-bold">Тканей пока нет</p>
          <p className="text-[13px] text-muted-foreground">Добавьте варианты с тканями через раздел «Загрузка».</p>
        </div>
      )}
    </div>
  );
}

/* ─────── Варианты выбранной ткани (внутри «Все ткани», Шаг 4) ─────────── */

function LevelMaterialVariants({ material }: { material: string }) {
  const mode = usePortal((s) => s.catalogMode);
  const crumbs = useCatalogCrumbs();
  const { data, isLoading } = useQuery<{ items: CatalogItemDto[] }>({
    queryKey: ["catalog", "material", material],
    queryFn: async () => {
      const p = new URLSearchParams({ material });
      const r = await fetch(`/api/catalog?${p}`);
      if (!r.ok) throw new Error("Ошибка загрузки");
      return r.json();
    },
    placeholderData: (prev) => prev,
  });

  const items: SearchResp["variants"] = useMemo(
    () =>
      (data?.items ?? []).map((it) => ({
        id: it.id,
        categoryName: it.categoryName,
        modelName: it.modelName,
        variantName: it.variantName ?? null,
        materialName: it.materialName,
        sizeName: it.sizeName,
        tags: it.tags,
        isNew: it.isNew,
        photo: it.photos[0] ? { url: it.photos[0].url, thumbUrl: it.photos[0].thumbUrl } : null,
        photoCount: it.photos.length,
      })),
    [data]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Breadcrumbs crumbs={crumbs} />
        <ModeSwitch />
      </div>
      {isLoading && !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-56" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-14 text-center">
          <span className="empty-live grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-muted-foreground">
            <SwatchBook size={26} />
          </span>
          <p className="font-display text-base font-bold">Фото этой ткани пока нет</p>
          <p className="text-[13px] text-muted-foreground">Загрузите первые фото через раздел «Загрузка».</p>
        </div>
      ) : (
        <VariantsGrid items={items} mode={mode} />
      )}
    </div>
  );
}

/* ───────────────────── Результаты применённого поиска ─────────────────── */

function SearchResults({ query }: { query: string }) {
  const mode = usePortal((s) => s.catalogMode);
  const crumbs = useCatalogCrumbs();
  const { data, isLoading } = useQuery<SearchResp>({
    queryKey: ["search-full", query],
    queryFn: async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!r.ok) throw new Error("Ошибка поиска");
      return r.json();
    },
    placeholderData: (prev) => prev,
  });

  if (isLoading && !data)
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-56" />)}
      </div>
    );

  const n = data?.variants?.length ?? 0;

  if (n === 0)
    return (
      <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-14 text-center">
        <span className="empty-live grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-muted-foreground">
          <SearchIcon size={26} />
        </span>
        <p className="font-display text-base font-bold">Ничего не найдено</p>
        <p className="text-[13px] text-muted-foreground">
          Работает транслит: «ральф», «скай», «казанова». Попробуйте другой запрос.
        </p>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs crumbs={crumbs} />
      {(data!.fabrics.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Ткани:</span>
          {data!.fabrics.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--brand)]/40 bg-[color:var(--brand)]/10 px-2.5 py-1 text-[12px] font-bold text-[color:var(--brand)]">
              {f.swatchUrl && <img src={f.swatchUrl} alt="" className="h-[18px] w-[18px] rounded-full object-cover" />}
              {f.name}
              <span className="grid h-[16px] min-w-[16px] place-items-center rounded-full bg-[color:var(--brand)] px-1 text-[9.5px] text-white">
                {f.count}
              </span>
            </span>
          ))}
        </div>
      )}
      <p className="text-[13px] text-muted-foreground">
        Найдено вариантов: <span className="font-bold text-foreground">{n}</span> — нажмите, чтобы открыть фото
      </p>
      <VariantsGrid items={data!.variants} mode={mode} />
    </div>
  );
}

/* ─────────────────────────────── Корень ───────────────────────────────── */

export function CatalogView() {
  const catCategory = usePortal((s) => s.catCategory);
  const catModel = usePortal((s) => s.catModel);
  const catFabrics = usePortal((s) => s.catFabrics);
  const catMaterial = usePortal((s) => s.catMaterial);
  const searchQuery = usePortal((s) => s.searchQuery);
  const mode = usePortal((s) => s.catalogMode);
  const crumbs = useCatalogCrumbs();

  // Применённый поиск перекрывает дриллдаун
  if (searchQuery) {
    return (
      <div className="flex flex-col gap-4">
        <SearchResults query={searchQuery} />
      </div>
    );
  }
  // Шаг 4: обход каталога по тканям
  if (catFabrics) {
    return catMaterial ? <LevelMaterialVariants material={catMaterial} /> : <LevelFabrics />;
  }
  if (!catCategory) return <LevelCategories />;
  if (!catModel) return <LevelModels category={catCategory} />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        {/* Шаг 3: путь крошками (было текстом) + режимы вида справа */}
        <Breadcrumbs crumbs={crumbs} />
        <ModeSwitch />
      </div>
      <LevelVariants category={catCategory} model={catModel} />
    </div>
  );
}
