import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { matchesQuery } from "@/lib/translit";

export const dynamic = "force-dynamic";

/** Шаг 4: окно «новизны» — 7 дней */
const WEEK_MS = 7 * 24 * 3600 * 1000;

/** Популярные запросы для пустого дропдауна — ФОЛБЭК, если БД пуста.
     ВАЖНО: раньше список был жёстким («Трентон», «Магни»…) и разошёлся с БД —
     владелец тапал чип и получал «Ничего не найдено» (выглядело как сломанный
     поиск). Теперь популярные считаются из БД (см. popularFromDb). */
const POPULAR_FALLBACK = ["Локо", "Карина", "Ника", "sky", "угловой", "акция", "160×200"];

/** Топ моделей, у которых ЕСТЬ фото (единое правило «нет фото — нет узла»):
     честные подсказки вместо протухшего жёсткого списка. */
async function popularFromDb(): Promise<string[]> {
  const rows = await db.productVariant.findMany({
    where: { active: true, deletedAt: null, photos: { some: { deletedAt: null } } },
    include: { model: { select: { name: true } } },
  });
  const counts = new Map<string, number>();
  for (const v of rows) counts.set(v.model.name, (counts.get(v.model.name) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);
  return top.length > 0 ? top : POPULAR_FALLBACK;
}

/**
 * GET /api/search?q=... — единый поиск по каталогу:
 * ткани (со счётчиком вариантов) + варианты фото (с миниатюрами).
 * Транслит включён: «скай» найдёт Sky Velvet, «казанова» — Casanova.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();

  if (!q) {
    return NextResponse.json({ popular: await popularFromDb(), fabrics: [], variants: [] });
  }

  const rows = (
    await db.productVariant.findMany({
      where: { active: true, deletedAt: null },
      include: {
        category: true,
        model: true,
        material: true,
        size: true,
        tags: { include: { tag: true } },
        photos: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      },
    })
  ).filter((v) => v.photos.length > 0); // «нет фото — нет результата» (единое правило с каталогом)

  const hit = rows.filter((v) =>
    matchesQuery(
      [v.category.name, v.model.name, v.model.latin, v.variantName, v.material?.name, v.size?.name, ...v.tags.map((t) => t.tag.name)]
        .filter(Boolean)
        .join(" "),
      q
    )
  );

  // Ткани: группируем по материалу
  const matMap = new Map<string, { id: string; name: string; swatchUrl: string | null; count: number }>();
  for (const v of hit) {
    if (!v.material) continue;
    const cur = matMap.get(v.material.id) ?? {
      id: v.material.id,
      name: v.material.name,
      swatchUrl: v.material.swatchUrl,
      count: 0,
    };
    cur.count++;
    matMap.set(v.material.id, cur);
  }
  const fabrics = [...matMap.values()].sort((a, b) => b.count - a.count);

  // Варианты (карточки с фото)
  const freshMs = Date.now() - WEEK_MS;
  const variants = hit.slice(0, 24).map((v) => ({
    id: v.id,
    categoryName: v.category.name,
    modelName: v.model.name,
    variantName: v.variantName,
    materialName: v.material?.name ?? null,
    sizeName: v.size?.name ?? null,
    tags: v.tags.map((t) => t.tag.name),
    isNew: v.createdAt.getTime() >= freshMs || v.photos.some((p) => p.createdAt.getTime() >= freshMs),
    photo: v.photos[0] ? { url: v.photos[0].url, thumbUrl: v.photos[0].thumbUrl } : null,
    photoCount: v.photos.length,
  }));

  return NextResponse.json({ popular: await popularFromDb(), fabrics, variants });
}
