import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { matchesQuery } from "@/lib/translit";
import type { CatalogItemDto } from "@/lib/portal";

export const dynamic = "force-dynamic";

/** Шаг 4: окно «новизны» — 7 дней */
const WEEK_MS = 7 * 24 * 3600 * 1000;
const isNewVariant = (createdAt: Date, photos: Array<{ createdAt: Date }>) => {
  const fresh = Date.now() - WEEK_MS;
  return createdAt.getTime() >= fresh || photos.some((p) => p.createdAt.getTime() >= fresh);
};

/**
 * GET /api/catalog — три режима:
 *  ?level=categories            → категории со счётчиками моделей/вариантов
 *  ?level=models&category=X     → модели категории со счётчиком вариантов
 *  (по умолчанию)               → варианты (фильтры: category, model, material, size, tags, q)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const level = sp.get("level") || "items";
  const category = sp.get("category") || "";
  const model = sp.get("model") || "";
  const material = sp.get("material") || "";
  const size = sp.get("size") || "";
  const tags = (sp.get("tags") || "").split(",").map((t) => t.trim()).filter(Boolean);
  const q = (sp.get("q") || "").trim();

  if (level === "categories") {
    const cats = await db.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: {
        models: { where: { active: true }, orderBy: { sortOrder: "asc" }, include: { _count: { select: { variants: true } } } },
      },
    });
    return NextResponse.json({
      categories: cats.map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        modelCount: c.models.length,
        variantCount: c.models.reduce((a, m) => a + m._count.variants, 0),
      })),
    });
  }

  if (level === "fresh") {
    // Шаг 4: лента новых фото за 7 дней (фото-уровень, свежие первыми)
    const fresh = new Date(Date.now() - WEEK_MS);
    const photos = await db.photo.findMany({
      where: { deletedAt: null, createdAt: { gte: fresh }, variant: { active: true } },
      orderBy: { createdAt: "desc" },
      take: 14,
      include: { variant: { include: { model: true, category: true } } },
    });
    const total = await db.photo.count({
      where: { deletedAt: null, createdAt: { gte: fresh }, variant: { active: true } },
    });
    return NextResponse.json({
      total,
      items: photos.map((p) => ({
        photoId: p.id,
        url: p.url,
        thumbUrl: p.thumbUrl,
        variantId: p.variantId,
        categoryName: p.variant.category.name,
        modelName: p.variant.model.name,
        variantName: p.variant.variantName,
      })),
    });
  }

  if (level === "fabrics") {
    // Шаг 4: все ткани (материалы с вариантами) — карточки с превью и счётчиками
    const rows = await db.productVariant.findMany({
      where: { active: true, materialId: { not: null } },
      include: { material: true, photos: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    const map = new Map<
      string,
      { id: string; name: string; swatchUrl: string | null; thumb: string | null; variantCount: number; newCount: number }
    >();
    for (const v of rows) {
      if (!v.material) continue;
      const cur =
        map.get(v.material.id) ?? {
          id: v.material.id,
          name: v.material.name,
          swatchUrl: v.material.swatchUrl,
          thumb: v.photos[0]?.thumbUrl ?? null,
          variantCount: 0,
          newCount: 0,
        };
      cur.variantCount++;
      if (isNewVariant(v.createdAt, v.photos)) cur.newCount++;
      map.set(v.material.id, cur);
    }
    const fabrics = [...map.values()]
      .filter((f) => f.variantCount > 0)
      .sort((a, b) => b.newCount - a.newCount || a.name.localeCompare(b.name));
    return NextResponse.json({ fabrics });
  }

  if (level === "models") {
    const cat = await db.category.findFirst({ where: { name: category, active: true } });
    if (!cat) return NextResponse.json({ models: [] });
    const models = await db.model.findMany({
      where: { categoryId: cat.id, active: true },
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { variants: true } } },
    });
    // Шаг 4: сколько вариантов модели «новые» (за 7 дней)
    const week = new Date(Date.now() - WEEK_MS);
    const freshVars = await db.productVariant.findMany({
      where: {
        active: true,
        model: { categoryId: cat.id },
        OR: [{ createdAt: { gte: week } }, { photos: { some: { createdAt: { gte: week }, deletedAt: null } } }],
      },
      select: { modelId: true },
    });
    const newCountByModel = new Map<string, number>();
    for (const v of freshVars) newCountByModel.set(v.modelId, (newCountByModel.get(v.modelId) ?? 0) + 1);
    return NextResponse.json({
      category: { id: cat.id, name: cat.name, icon: cat.icon },
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        latin: m.latin,
        variantCount: m._count.variants,
        newCount: newCountByModel.get(m.id) ?? 0,
      })),
    });
  }

  const rows = await db.productVariant.findMany({
    where: { active: true },
    include: {
      category: true,
      model: true,
      material: true,
      size: true,
      tags: { include: { tag: true } },
      photos: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  let items: (CatalogItemDto & { isNew: boolean })[] = rows.map((v) => ({
    id: v.id,
    categoryId: v.categoryId,
    categoryName: v.category.name,
    modelId: v.modelId,
    modelName: v.model.name,
    variantName: v.variantName,
    materialId: v.materialId,
    materialName: v.material?.name ?? null,
    sizeId: v.sizeId,
    sizeName: v.size?.name ?? null,
    description: v.description,
    tags: v.tags.map((t) => t.tag.name),
    isNew: isNewVariant(v.createdAt, v.photos),
    photos: v.photos.map((p) => ({ id: p.id, url: p.url, thumbUrl: p.thumbUrl, comment: p.comment })),
  }));

  if (category) items = items.filter((i) => i.categoryName === category);
  if (model) items = items.filter((i) => i.modelName === model);
  if (material) items = items.filter((i) => i.materialName === material);
  if (size) items = items.filter((i) => i.sizeName === size);
  if (tags.length) items = items.filter((i) => tags.every((t) => i.tags.includes(t)));
  if (q) items = items.filter((i) => matchesQuery(haystackOf(i), q));

  const facets = {
    categories: [...new Set(items.map((i) => i.categoryName))].sort(),
    models: [...new Set(rows.map((r) => r.model.name))].sort(),
    materials: [...new Set(rows.map((r) => r.material?.name).filter(Boolean) as string[])].sort(),
    sizes: [...new Set(rows.map((r) => r.size?.name).filter(Boolean) as string[])].sort(),
    tags: [...new Set(rows.flatMap((r) => r.tags.map((t) => t.tag.name)))].sort(),
  };

  return NextResponse.json({ items, facets });
}

function haystackOf(i: CatalogItemDto): string {
  return [i.categoryName, i.modelName, i.variantName, i.materialName, i.sizeName, i.description, ...i.tags]
    .filter(Boolean)
    .join(" ");
}
