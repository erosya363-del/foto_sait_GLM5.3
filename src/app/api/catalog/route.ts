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
/**
 * Правило «нет фото — нет узла» (запрос владельца):
 *  — категория/модель/ткань показываются ТОЛЬКО если внутри есть вариант
 *    с хотя бы одним неудалённым фото;
 *  — счётчики считают только варианты с фото;
 *  — в выдаче вариантов (level=items) варианты без фото скрыты.
 * Админке это не мешает: она читает /api/admin (там видны все варианты).
 */
const withPhotos = { some: { deletedAt: null } };

/** Сколько вариантов с фото в каждой категории/модели (один запрос) */
async function photoVariantCounts() {
  const vars = await db.productVariant.findMany({
    where: { active: true, deletedAt: null, photos: withPhotos },
    select: { modelId: true, model: { select: { categoryId: true } } },
  });
  const byCategory = new Map<string, number>();
  const byModel = new Map<string, number>();
  for (const v of vars) {
    byModel.set(v.modelId, (byModel.get(v.modelId) ?? 0) + 1);
    byCategory.set(v.model.categoryId, (byCategory.get(v.model.categoryId) ?? 0) + 1);
  }
  return { byCategory, byModel };
}

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
    const [cats, counts] = await Promise.all([
      db.category.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
        include: { models: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
      }),
      photoVariantCounts(),
    ]);
    return NextResponse.json({
      categories: cats
        .map((c) => ({
          id: c.id,
          name: c.name,
          icon: c.icon,
          modelCount: c.models.filter((m) => counts.byModel.has(m.id)).length,
          variantCount: counts.byCategory.get(c.id) ?? 0,
        }))
        .filter((c) => c.variantCount > 0),
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
    // Все ткани (материалы с вариантами). Карточка:
    //  — фото каталога ткани (Material.swatchUrl) имеет приоритет;
    //  — иначе последнее (по дате) фото дивана с этой тканью;
    //  — подпись: название + цветовая гамма (colorGroup).
    const rows = await db.productVariant.findMany({
      // «нет фото — нет ткани»: только варианты, у которых есть неудалённые фото
      where: { active: true, deletedAt: null, materialId: { not: null }, photos: withPhotos },
      include: { material: true, photos: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } } },
      orderBy: { createdAt: "asc" },
    });
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        colorGroup: string | null;
        swatchUrl: string | null;
        thumb: string | null;
        variantCount: number;
        newCount: number;
        latestAt: number;
      }
    >();
    for (const v of rows) {
      if (!v.material) continue;
      const cur =
        map.get(v.material.id) ?? {
          id: v.material.id,
          name: v.material.name,
          colorGroup: v.material.colorGroup,
          swatchUrl: v.material.swatchUrl,
          thumb: null as string | null,
          variantCount: 0,
          newCount: 0,
          latestAt: 0,
        };
      cur.variantCount++;
      if (isNewVariant(v.createdAt, v.photos)) cur.newCount++;
      const newest = v.photos[0]; // фото отсортированы по дате (свежие первыми)
      if (newest) {
        const t = newest.createdAt.getTime();
        if (t >= cur.latestAt) {
          cur.latestAt = t;
          cur.thumb = newest.thumbUrl;
        }
      }
      map.set(v.material.id, cur);
    }
    const fabrics = [...map.values()]
      .filter((f) => f.variantCount > 0 && f.thumb) // без фото ткань не показываем
      .sort((a, b) => b.newCount - a.newCount || a.name.localeCompare(b.name));
    return NextResponse.json({ fabrics });
  }

  if (level === "models") {
    const cat = await db.category.findFirst({ where: { name: category, active: true } });
    if (!cat) return NextResponse.json({ models: [] });
    const [models, counts] = await Promise.all([
      db.model.findMany({
        where: { categoryId: cat.id, active: true },
        orderBy: { sortOrder: "asc" },
      }),
      photoVariantCounts(),
    ]);
    // Шаг 4: сколько вариантов модели «новые» (за 7 дней) — только с фото
    const week = new Date(Date.now() - WEEK_MS);
    const freshVars = await db.productVariant.findMany({
      where: {
        active: true,
        deletedAt: null,
        model: { categoryId: cat.id },
        photos: withPhotos,
        OR: [{ createdAt: { gte: week } }, { photos: { some: { createdAt: { gte: week }, deletedAt: null } } }],
      },
      select: { modelId: true },
    });
    const newCountByModel = new Map<string, number>();
    for (const v of freshVars) newCountByModel.set(v.modelId, (newCountByModel.get(v.modelId) ?? 0) + 1);
    return NextResponse.json({
      category: { id: cat.id, name: cat.name, icon: cat.icon },
      models: models
        .map((m) => ({
          id: m.id,
          name: m.name,
          latin: m.latin,
          variantCount: counts.byModel.get(m.id) ?? 0,
          newCount: newCountByModel.get(m.id) ?? 0,
        }))
        .filter((m) => m.variantCount > 0), // «нет фото — нет модели»
    });
  }

  const rows = await db.productVariant.findMany({
    where: { active: true, deletedAt: null },
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

  // «нет фото — нет варианта»: без фото карточка в каталоге не показывается
  const withPics = rows.filter((v) => v.photos.length > 0);

  let items: (CatalogItemDto & { isNew: boolean })[] = withPics.map((v) => ({
    id: v.id,
    categoryId: v.categoryId,
    categoryName: v.category.name,
    modelId: v.modelId,
    modelName: v.model.name,
    variantName: v.variantName,
    materialId: v.materialId,
    materialName: v.material?.name ?? null,
    materialGroup: v.material?.colorGroup ?? null,
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

  // фасеты считаем по вариантам с фото — фильтры не должны вести в пустоту
  const facets = {
    categories: [...new Set(items.map((i) => i.categoryName))].sort(),
    models: [...new Set(items.map((i) => i.modelName))].sort(),
    materials: [...new Set(items.map((i) => i.materialName).filter(Boolean) as string[])].sort(),
    sizes: [...new Set(items.map((i) => i.sizeName).filter(Boolean) as string[])].sort(),
    tags: [...new Set(items.flatMap((i) => i.tags))].sort(),
  };

  return NextResponse.json({ items, facets });
}

function haystackOf(i: CatalogItemDto): string {
  return [i.categoryName, i.modelName, i.variantName, i.materialName, i.sizeName, i.description, ...i.tags]
    .filter(Boolean)
    .join(" ");
}
