import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/dictionaries — все справочники (для фильтров, загрузки и админки) */
export async function GET() {
  const [categories, models, materials, sizes, tags] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.model.findMany({ include: { category: true }, orderBy: { name: "asc" } }),
    db.material.findMany({ orderBy: { name: "asc" } }),
    db.size.findMany({ orderBy: { name: "asc" } }),
    db.tag.findMany({ orderBy: { name: "asc" } }),
  ]);

  return NextResponse.json({
    categories: categories.map((c) => ({ id: c.id, name: c.name, active: c.active })),
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      categoryId: m.categoryId,
      categoryName: m.category.name,
      active: m.active,
    })),
    materials: materials.map((m) => ({ id: m.id, name: m.name, type: m.type, active: m.active })),
    sizes: sizes.map((s) => ({ id: s.id, name: s.name, active: s.active })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, active: t.active })),
  });
}
