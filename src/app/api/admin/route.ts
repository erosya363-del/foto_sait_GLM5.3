import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin — управление справочниками.
 * body: { entity: 'category'|'model'|'material'|'size'|'tag', action: 'create'|'rename'|'toggle', ... }
 * Физического удаления нет — только active = false (мягкое скрытие).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });

  const { entity, action } = body as { entity: string; action: string };
  const name: string = String(body.name ?? "").trim();
  const id: string = String(body.id ?? "");

  try {
    if (action === "create") {
      if (!name) return NextResponse.json({ error: "Укажите название" }, { status: 400 });
      if (entity === "category") {
        const dup = await db.category.findFirst({ where: { name } });
        if (dup) return NextResponse.json({ error: `Категория «${name}» уже есть` }, { status: 409 });
        const row = await db.category.create({ data: { name } });
        return NextResponse.json({ ok: true, id: row.id });
      }
      if (entity === "model") {
        const categoryId = String(body.categoryId ?? "");
        if (!categoryId) return NextResponse.json({ error: "Выберите категорию" }, { status: 400 });
        const exists = await db.model.findFirst({ where: { name, categoryId } });
        if (exists) return NextResponse.json({ error: `Модель «${name}» уже есть в этой категории` }, { status: 409 });
        const row = await db.model.create({ data: { name, categoryId } });
        return NextResponse.json({ ok: true, id: row.id });
      }
      if (entity === "material") {
        const type = String(body.type ?? "Ткань");
        const dup = await db.material.findFirst({ where: { name, type } });
        if (dup) return NextResponse.json({ error: `Материал «${name}» уже есть` }, { status: 409 });
        const row = await db.material.create({ data: { name, type } });
        return NextResponse.json({ ok: true, id: row.id });
      }
      if (entity === "size") {
        const dup = await db.size.findFirst({ where: { name } });
        if (dup) return NextResponse.json({ error: `Размер «${name}» уже есть` }, { status: 409 });
        const row = await db.size.create({ data: { name } });
        return NextResponse.json({ ok: true, id: row.id });
      }
      if (entity === "tag") {
        const dup = await db.tag.findFirst({ where: { name } });
        if (dup) return NextResponse.json({ error: `Признак «${name}» уже есть` }, { status: 409 });
        const row = await db.tag.create({ data: { name } });
        return NextResponse.json({ ok: true, id: row.id });
      }
    }

    // Восстановление случайно удалённого фото (для кнопки «Отменить» в уведомлении)
    if (action === "restorePhoto") {
      const variantId = String(body.variantId ?? "");
      const url = String(body.url ?? "");
      const thumbUrl = String(body.thumbUrl ?? "");
      if (!variantId || !url || !thumbUrl) {
        return NextResponse.json({ error: "Недостаточно данных для восстановления" }, { status: 400 });
      }
      const variantExists = await db.productVariant.findFirst({ where: { id: variantId } });
      if (!variantExists) return NextResponse.json({ error: "Вариант товара не найден" }, { status: 404 });
      const agg = await db.photo.aggregate({ where: { variantId }, _max: { sortOrder: true } });
      const row = await db.photo.create({
        data: {
          variantId,
          url,
          thumbUrl,
          comment: body.comment ? String(body.comment) : null,
          sortOrder: (agg._max.sortOrder ?? -1) + 1,
        },
      });
      return NextResponse.json({ ok: true, id: row.id });
    }

    if (action === "rename") {
      if (!id || !name) return NextResponse.json({ error: "Нужны id и название" }, { status: 400 });
      if (entity === "category") await db.category.update({ where: { id }, data: { name } });
      else if (entity === "model") await db.model.update({ where: { id }, data: { name } });
      else if (entity === "material") await db.material.update({ where: { id }, data: { name } });
      else if (entity === "size") await db.size.update({ where: { id }, data: { name } });
      else if (entity === "tag") await db.tag.update({ where: { id }, data: { name } });
      return NextResponse.json({ ok: true });
    }

    if (action === "toggle") {
      if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
      const active = Boolean(body.active);
      if (entity === "category") await db.category.update({ where: { id }, data: { active } });
      else if (entity === "model") await db.model.update({ where: { id }, data: { active } });
      else if (entity === "material") await db.material.update({ where: { id }, data: { active } });
      else if (entity === "size") await db.size.update({ where: { id }, data: { active } });
      else if (entity === "tag") await db.tag.update({ where: { id }, data: { active } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

/** DELETE /api/admin — удалить фото. Возвращает данные фото для возможного восстановления */
export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const photoId = sp.get("photoId");
  if (!photoId) return NextResponse.json({ error: "Нужен photoId" }, { status: 400 });
  const photo = await db.photo.findUnique({ where: { id: photoId } });
  if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
  await db.photo.delete({ where: { id: photoId } });
  return NextResponse.json({
    ok: true,
    photo: { variantId: photo.variantId, url: photo.url, thumbUrl: photo.thumbUrl, comment: photo.comment },
  });
}
