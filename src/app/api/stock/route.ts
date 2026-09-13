import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  STOCK_STALE_DAYS,
  staleDays,
  bedPm,
  sofaKind,
  kpbKind,
  normalizeSize,
  normalizeName,
  type StockItemDto,
  type PhotoMatch,
} from "@/lib/portal";

export const dynamic = "force-dynamic";

/**
 * GET /api/stock — остатки выбранного склада (?warehouse=Обухово|Владимир).
 * Каждый элемент обогащён связкой с фотокаталогом (photoMatch),
 * чтобы кнопка «Смотреть фото» работала сразу.
 */
export async function GET(req: NextRequest) {
  const generatedAt = new Date().toISOString();
  const warehouse = req.nextUrl.searchParams.get("warehouse") || "Обухово";

  const [items, variants] = await Promise.all([
    db.stockItem.findMany({ where: { warehouse }, orderBy: { name: "asc" } }),
    db.productVariant.findMany({
      where: { active: true },
      include: {
        category: true,
        model: true,
        size: true,
        material: true,
        photos: { orderBy: { sortOrder: "asc" } },
      },
    }),
  ]);

  // Индекс вариантов каталога для матчинга: нормализованное имя модели + категория
  type Cand = {
    variantId: string;
    categoryName: string;
    modelName: string;
    modelNameNorm: string;
    sizeName: string | null;
    materialName: string | null;
    coverUrl: string;
    photoCount: number;
    label: string;
  };
  const cands: Cand[] = variants
    .filter((v) => v.photos.length > 0)
    .map((v) => ({
    variantId: v.id,
    categoryName: v.category.name,
    modelName: v.model.name,
    modelNameNorm: normalizeName(v.model.name),
    sizeName: v.size?.name ?? null,
    materialName: v.material?.name ?? null,
    coverUrl: v.photos[0]?.thumbUrl ?? v.photos[0]?.url ?? "",
    photoCount: v.photos.length,
    label: [v.category.name, v.model.name, v.material?.name, v.size?.name].filter(Boolean).join(" · "),
  }));

  function matchFor(name: string, category: string, size: string | null) {
    const n = normalizeName(name);
    const hits = cands.filter((c) => {
      if (c.categoryName !== category) return false;
      // имя модели должно встречаться в названии позиции остатка
      return n.includes(c.modelNameNorm);
    });
    if (hits.length === 0) return { best: null as PhotoMatch | null, all: [] as PhotoMatch[] };

    // ткани, упомянутые в названии остатка (для проверки конфликта материала)
    const mentionedMaterials = cands
      .map((c) => c.materialName)
      .filter(Boolean)
      .map((m) => normalizeName(m as string));

    const scored = hits.map((c) => {
      const sizeEq = size && c.sizeName && normalizeSize(size) === normalizeSize(c.sizeName);
      const conflict =
        c.materialName &&
        mentionedMaterials.some((m) => n.includes(m) && m !== normalizeName(c.materialName as string));
      return { c, conf: (sizeEq && !conflict ? "high" : "medium") as "high" | "medium" };
    });
    scored.sort((a, b) => (a.conf === b.conf ? 0 : a.conf === "high" ? -1 : 1));

    const all: PhotoMatch[] = scored.map(({ c, conf }) => ({
      variantId: c.variantId,
      coverUrl: c.coverUrl,
      photoCount: c.photoCount,
      confidence: conf,
      variantName: c.label,
    }));
    // уникальных вариантов может быть несколько — показываем список
    const uniq = new Map<string, PhotoMatch>();
    for (const m of all) if (!uniq.has(m.variantId)) uniq.set(m.variantId, m);
    return { best: all[0] ?? null, all: [...uniq.values()] };
  }

  const dto: StockItemDto[] = items.map((it) => {
    const d = staleDays(it.modifiedDate, generatedAt);
    const { best, all } = matchFor(it.name, it.category, it.size);
    return {
      id: it.id,
      name: it.name,
      qty: it.qty,
      category: it.category,
      size: it.size,
      feature: it.feature,
      series: it.series,
      modifiedDate: it.modifiedDate,
      stale: d != null && d >= STOCK_STALE_DAYS,
      staleDays: d != null && d >= STOCK_STALE_DAYS ? d : null,
      sale:
        it.hasSale && it.oldPrice && it.finalPrice && it.discountPercent
          ? { oldPrice: it.oldPrice, finalPrice: it.finalPrice, discountPercent: it.discountPercent }
          : null,
      photoMatch: best,
      photoMatches: all,
    };
  });

  const categories = [...new Set(items.map((i) => i.category))];
  const sizes = [...new Set(items.map((i) => i.size).filter(Boolean) as string[])].sort();
  const units = items.reduce((a, b) => a + b.qty, 0);

  return NextResponse.json({
    items: dto,
    categories,
    sizes,
    warehouse,
    meta: {
      generatedAt,
      total: dto.length,
      units,
      saleCount: dto.filter((d) => d.sale).length,
      staleCount: dto.filter((d) => d.stale).length,
      version: "2.1.0",
    },
  });
}
