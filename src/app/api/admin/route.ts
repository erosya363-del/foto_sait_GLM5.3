import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { purgePhotoFiles } from "@/lib/photo-fs";

export const dynamic = "force-dynamic";

/** Шаг 5: сколько дней фото хранится в корзине до автоочистки */
const TRASH_DAYS = 30;
const TRASH_MS = TRASH_DAYS * 24 * 3600 * 1000;

/** Понятные сообщения вместо голого «Ошибка сервера»:
 *  P2025 — запись уже удалена (устаревший список/двойной тап),
 *  P2024/P1008 — база занята (гонка записи и чтения SQLite),
 *  P2002 — дубликат уникального поля. Реальная ошибка идёт в лог сервера. */
function dbErrorText(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? "";
  if (code === "P2025") return "Запись уже удалена — обновите список";
  if (code === "P2024" || code === "P1008") return "База занята — повторите через пару секунд";
  if (code === "P2002") return "Такая запись уже существует";
  return "Ошибка сервера";
}

/**
 * АВТООЧИСТКА корзины: фото старше 30 дней в корзине удаляются ФИЗИЧЕСКИ
 * (файлы с диска + строка в БД). Товары, удалённые >30 дней назад и у которых
 * не осталось живых фото, тоже стираются физически (фото-файлы + строки + сам товар).
 * Вызывается при обращениях к админ-API.
 */
async function autoPurgeTrash(): Promise<number> {
  const cutoff = new Date(Date.now() - TRASH_MS);
  const stale = await db.photo.findMany({ where: { deletedAt: { lt: cutoff, not: null } } });
  for (const p of stale) {
    await purgePhotoFiles(p.url, p.thumbUrl);
    await db.photo.delete({ where: { id: p.id } }).catch(() => {});
  }
  let purgedVariants = 0;
  const staleVariants = await db.productVariant.findMany({
    where: { deletedAt: { lt: cutoff, not: null } },
    include: { photos: true },
  });
  for (const v of staleVariants) {
    for (const p of v.photos) {
      await purgePhotoFiles(p.url, p.thumbUrl).catch(() => {});
      await db.photo.delete({ where: { id: p.id } }).catch(() => {});
    }
    await db.productVariant.delete({ where: { id: v.id } }).catch(() => {});
    purgedVariants++;
  }
  return stale.length + purgedVariants;
}

/**
 * GET /api/admin — данные для админки:
 *   ?view=trash     → содержимое корзины (фото + вариант + дней до автоочистки)
 *   ?view=variants  → список товаров (вариантов) с счётчиком живых фото
 *   ?view=photos    → все живые фото с ПОЛНОЙ привязкой (п.4 ТЗ: редактирование
 *                     привязки фото — категория/модель/ткань/размер/подпись)
 */
export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get("view") || "";
  try {
    if (view === "trash") {
      const autoPurged = await autoPurgeTrash();
      const rows = await db.photo.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        include: { variant: { include: { model: true, category: true, material: true } } },
      });
      return NextResponse.json({
        autoPurged,
        trashDays: TRASH_DAYS,
        items: rows.map((p) => ({
          id: p.id,
          url: p.url,
          thumbUrl: p.thumbUrl,
          deletedAt: p.deletedAt,
          daysLeft: Math.max(
            0,
            Math.ceil((TRASH_MS - (Date.now() - (p.deletedAt?.getTime() ?? Date.now()))) / 86400000)
          ),
          variantId: p.variantId,
          variantLabel: [
            p.variant.model.name,
            p.variant.material?.name ?? p.variant.variantName ?? "",
          ]
            .filter(Boolean)
            .join(" · "),
          categoryName: p.variant.category.name,
        })),
      });
    }

    if (view === "variants") {
      const rows = await db.productVariant.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        include: {
          category: true,
          model: true,
          material: true,
          size: true,
          _count: { select: { photos: { where: { deletedAt: null } } } },
        },
      });
      return NextResponse.json({
        items: rows.map((v) => ({
          id: v.id,
          label: [
            v.model.name,
            v.material?.name ?? v.variantName,
            v.size?.name,
          ]
            .filter(Boolean)
            .join(" · "),
          categoryName: v.category.name,
          variantName: v.variantName,
          active: v.active,
          photoCount: v._count.photos,
          createdAt: v.createdAt,
        })),
      });
    }

    if (view === "photos") {
      const rows = await db.photo.findMany({
        where: { deletedAt: null },
        orderBy: [{ variantId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          variant: {
            include: {
              category: true,
              model: true,
              material: true,
              size: true,
              _count: { select: { photos: { where: { deletedAt: null } } } },
            },
          },
        },
      });
      return NextResponse.json({
        items: rows.map((p) => ({
          id: p.id,
          url: p.url,
          thumbUrl: p.thumbUrl,
          comment: p.comment,
          variantId: p.variantId,
          categoryId: p.variant.categoryId,
          categoryName: p.variant.category.name,
          modelId: p.variant.modelId,
          modelName: p.variant.model.name,
          materialId: p.variant.materialId,
          materialName: p.variant.material?.name ?? null,
          sizeId: p.variant.sizeId,
          sizeName: p.variant.size?.name ?? null,
          variantName: p.variant.variantName,
          variantPhotoCount: p.variant._count.photos,
        })),
      });
    }

    return NextResponse.json({ error: "Укажите view=trash, view=variants или view=photos" }, { status: 400 });
  } catch (e) {
    console.error("[admin GET]", new Date().toISOString(), e);
    return NextResponse.json({ error: dbErrorText(e) }, { status: 500 });
  }
}

/**
 * POST /api/admin — управление справочниками, корзиной и товарами.
 * body: { entity, action, ... }
 * Справочники: create/rename/delete (занятое в товарах — отказ 409)
 * Корзина:     restoreFromTrash / purgePhoto / purgeTrash
 * Товары:      quickCreateVariant / renameVariant / deleteVariant (мягкое)
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });

  const { entity, action } = body as { entity: string; action: string };
  const name: string = String(body.name ?? "").trim();
  const id: string = String(body.id ?? "");

  try {
    // ── Корзина: вернуть фото из корзины (и оживить удалённый товар) ──
    if (action === "restoreFromTrash") {
      if (!id) return NextResponse.json({ error: "Нужен photoId" }, { status: 400 });
      const photo = await db.photo.findUnique({ where: { id } });
      if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
      if (!photo.deletedAt) return NextResponse.json({ ok: true, note: "фото не в корзине" });
      const restored = await db.photo.update({ where: { id }, data: { deletedAt: null } });
      // Если товар был удалён (все фото в корзине) — возврат любого фото оживляет товар
      const variant = await db.productVariant.findUnique({ where: { id: photo.variantId } });
      if (variant?.deletedAt) {
        await db.productVariant.update({
          where: { id: variant.id },
          data: { deletedAt: null, active: true },
        });
      }
      return NextResponse.json({ ok: true, id: restored.id, variantRevived: Boolean(variant?.deletedAt) });
    }

    // ── Корзина: удалить фото ФИЗИЧЕСКИ (файлы + строка) ─────────────
    if (action === "purgePhoto") {
      if (!id) return NextResponse.json({ error: "Нужен photoId" }, { status: 400 });
      const photo = await db.photo.findUnique({ where: { id } });
      if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
      const filesRemoved = await purgePhotoFiles(photo.url, photo.thumbUrl);
      await db.photo.delete({ where: { id } });
      return NextResponse.json({ ok: true, filesRemoved });
    }

    // ── Корзина: очистить полностью (физически) ──────────────────────
    if (action === "purgeTrash") {
      const rows = await db.photo.findMany({ where: { deletedAt: { not: null } } });
      let filesRemoved = 0;
      for (const p of rows) {
        if (await purgePhotoFiles(p.url, p.thumbUrl)) filesRemoved++;
        await db.photo.delete({ where: { id: p.id } }).catch(() => {});
      }
      return NextResponse.json({ ok: true, purged: rows.length, filesRemoved });
    }

    // ── Фото: ПЕРЕПРИВЯЗКА без перезагрузки файла (п.4 ТЗ) ───────────
    // Пример ошибки из ТЗ: фото кровати случайно привязали к дивану —
    // админ меняет категорию/модель/ткань/размер, ФАЙЛ остаётся на диске.
    // Фото присоединяется к варианту (категория+модель+ткань+размер);
    // если такого варианта нет — он создаётся; опустевший старый — чистится.
    if (action === "movePhoto") {
      if (!id) return NextResponse.json({ error: "Нужен id фото" }, { status: 400 });
      const photo = await db.photo.findUnique({ where: { id } });
      if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
      if (photo.deletedAt) return NextResponse.json({ error: "Фото в корзине — сначала верните его" }, { status: 400 });

      const categoryId = String(body.categoryId ?? "");
      const modelId = String(body.modelId ?? "");
      if (!categoryId) return NextResponse.json({ error: "Выберите категорию" }, { status: 400 });
      if (!modelId) return NextResponse.json({ error: "Выберите модель" }, { status: 400 });
      const category = await db.category.findUnique({ where: { id: categoryId } });
      if (!category) return NextResponse.json({ error: "Категория не найдена" }, { status: 404 });
      const model = await db.model.findUnique({ where: { id: modelId } });
      if (!model || model.categoryId !== categoryId) {
        return NextResponse.json({ error: "Модель не относится к выбранной категории" }, { status: 400 });
      }
      const materialId = String(body.materialId ?? "") || null;
      const sizeId = String(body.sizeId ?? "") || null;
      const variantName = String(body.variantName ?? "").trim() || null;

      // Целевой вариант: та же связка, что у quickCreateVariant (дубликаты недопустимы)
      let target = await db.productVariant.findFirst({
        where: { categoryId, modelId, materialId, sizeId, deletedAt: null },
      });
      if (!target) {
        target = await db.productVariant.create({
          data: { categoryId, modelId, materialId, sizeId, variantName },
        });
      } else if (variantName !== null && target.variantName !== variantName) {
        await db.productVariant.update({ where: { id: target.id }, data: { variantName } });
      }

      const oldVariantId = photo.variantId;
      await db.photo.update({ where: { id }, data: { variantId: target.id } });

      // Старый вариант опустел и не в корзине — физически удаляем пустую оболочку
      // (ТОЛЬКО если нет вообще ни одного фото — иначе сломается «Вернуть» из корзины)
      let cleanedOld = false;
      if (oldVariantId !== target.id) {
        const left = await db.photo.count({ where: { variantId: oldVariantId } });
        if (left === 0) {
          const old = await db.productVariant.findUnique({ where: { id: oldVariantId } });
          if (old && !old.deletedAt) {
            await db.productVariant.delete({ where: { id: oldVariantId } }).catch(() => {});
            cleanedOld = true;
          }
        }
      }
      return NextResponse.json({ ok: true, variantId: target.id, moved: oldVariantId !== target.id, cleanedOld });
    }

    // ── Товары: быстрое создание (категория/модель — на лету) ────────
    if (action === "quickCreateVariant") {
      // Категория: готовый id → проверяем; имя → найти или создать
      let categoryId = String(body.categoryId ?? "");
      const categoryName = String(body.categoryName ?? "").trim();
      let createdCategory = false;
      if (!categoryId && categoryName) {
        const dup = await db.category.findFirst({ where: { name: categoryName } });
        if (dup) categoryId = dup.id;
        else {
          const row = await db.category.create({ data: { name: categoryName } });
          categoryId = row.id;
          createdCategory = true;
        }
      }
      if (!categoryId) return NextResponse.json({ error: "Выберите или введите категорию" }, { status: 400 });

      let modelId = String(body.modelId ?? "");
      const modelName = String(body.modelName ?? "").trim();
      let createdModel = false;
      if (!modelId && modelName) {
        const dup = await db.model.findFirst({ where: { name: modelName, categoryId } });
        if (dup) modelId = dup.id;
        else {
          const row = await db.model.create({ data: { name: modelName, categoryId } });
          modelId = row.id;
          createdModel = true;
        }
      }
      if (!modelId) return NextResponse.json({ error: "Выберите или введите модель" }, { status: 400 });

      const materialId = String(body.materialId ?? "") || null;
      const sizeId = String(body.sizeId ?? "") || null;
      const variantName = String(body.variantName ?? "").trim() || null;

      // Дубликат варианта = та же категория+модель+материал+размер
      const dup = await db.productVariant.findFirst({
        where: { categoryId, modelId, materialId, sizeId },
      });
      if (dup) {
        return NextResponse.json(
          { error: "Такой товар уже есть — загрузите фото в него через «Загрузку»", variantId: dup.id },
          { status: 409 }
        );
      }

      const variant = await db.productVariant.create({
        data: { categoryId, modelId, materialId, sizeId, variantName },
      });
      return NextResponse.json({
        ok: true,
        variantId: variant.id,
        categoryId,
        modelId,
        createdCategory,
        createdModel,
      });
    }

    // ── Товары: УДАЛИТЬ (мягко): исчезает из админки и каталога, фото — в корзину.
    // Вернуть: «Вернуть» любого фото из корзины оживляет товар. Через 30 дней — физическая чистка.
    if (action === "deleteVariant") {
      if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
      const variant = await db.productVariant.findUnique({ where: { id } });
      if (!variant) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
      const now = new Date();
      const trashed = await db.photo.updateMany({
        where: { variantId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      await db.productVariant.update({
        where: { id },
        data: { deletedAt: now, active: false },
      });
      return NextResponse.json({ ok: true, photosToTrash: trashed.count });
    }

    // ── Ткани: задать/очистить цветовую гамму ────────────────────────
    if (action === "setFabricGroup") {
      if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
      const colorGroup = String(body.colorGroup ?? "").trim() || null;
      await db.material.update({ where: { id }, data: { colorGroup } });
      return NextResponse.json({ ok: true });
    }

    // ── Ткани: привязать/очистить фото каталога ткани (swatch) ───────
    if (action === "setFabricPhoto") {
      if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
      const swatchUrl = String(body.swatchUrl ?? "").trim();
      await db.material.update({ where: { id }, data: { swatchUrl: swatchUrl || null } });
      return NextResponse.json({ ok: true });
    }

    // ── Справочники: УДАЛИТЬ (вместо отключения). Занято в товарах — отказ с числом. ──
    if (action === "delete") {
      if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
      if (entity === "category") {
        const used = await db.productVariant.count({ where: { categoryId: id } });
        if (used) return NextResponse.json({ error: `Используется в ${used} товарах — сначала удалите их` }, { status: 409 });
        await db.category.delete({ where: { id } });
        return NextResponse.json({ ok: true });
      }
      if (entity === "model") {
        const used = await db.productVariant.count({ where: { modelId: id } });
        if (used) return NextResponse.json({ error: `Используется в ${used} товарах — сначала удалите их` }, { status: 409 });
        await db.model.delete({ where: { id } });
        return NextResponse.json({ ok: true });
      }
      if (entity === "material") {
        const used = await db.productVariant.count({ where: { materialId: id } });
        if (used) return NextResponse.json({ error: `Используется в ${used} товарах — сначала удалите их` }, { status: 409 });
        await db.material.delete({ where: { id } });
        return NextResponse.json({ ok: true });
      }
      if (entity === "size") {
        const used = await db.productVariant.count({ where: { sizeId: id } });
        if (used) return NextResponse.json({ error: `Используется в ${used} товарах — сначала удалите их` }, { status: 409 });
        await db.size.delete({ where: { id } });
        return NextResponse.json({ ok: true });
      }
      if (entity === "tag") {
        const used = await db.productVariantTag.count({ where: { tagId: id } });
        if (used) return NextResponse.json({ error: `Признак навешан на ${used} товарах — сначала снимите` }, { status: 409 });
        await db.tag.delete({ where: { id } });
        return NextResponse.json({ ok: true });
      }
    }

    // ── Товары: переименовать вариант (подпись) ──────────────────────
    if (action === "renameVariant") {
      if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
      const variantName = String(body.variantName ?? "").trim() || null;
      await db.productVariant.update({ where: { id }, data: { variantName } });
      return NextResponse.json({ ok: true });
    }

    // ── Товары: скрыть/вернуть вариант ───────────────────────────────
    if (action === "toggleVariant") {
      if (!id) return NextResponse.json({ error: "Нужен id" }, { status: 400 });
      const active = Boolean(body.active);
      await db.productVariant.update({ where: { id }, data: { active } });
      return NextResponse.json({ ok: true });
    }

    // ── Справочники: создание ────────────────────────────────────────
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
        const colorGroup = String(body.colorGroup ?? "").trim() || null;
        const dup = await db.material.findFirst({ where: { name, type } });
        if (dup) return NextResponse.json({ error: `Материал «${name}» уже есть` }, { status: 409 });
        const row = await db.material.create({ data: { name, type, colorGroup } });
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

    // ── Восстановление случайно удалённого фото (кнопка «Отменить») ──
    if (action === "restorePhoto") {
      const variantId = String(body.variantId ?? "");
      const url = String(body.url ?? "");
      const thumbUrl = String(body.thumbUrl ?? "");
      if (!variantId || !url || !thumbUrl) {
        return NextResponse.json({ error: "Недостаточно данных для восстановления" }, { status: 400 });
      }
      const variantExists = await db.productVariant.findFirst({ where: { id: variantId } });
      if (!variantExists) return NextResponse.json({ error: "Вариант товара не найден" }, { status: 404 });
      const agg = await db.photo.aggregate({
        where: { variantId, deletedAt: null },
        _max: { sortOrder: true },
      });
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

    // ── Справочники: переименование ──────────────────────────────────
    if (action === "rename") {
      if (!id || !name) return NextResponse.json({ error: "Нужны id и название" }, { status: 400 });
      if (entity === "category") await db.category.update({ where: { id }, data: { name } });
      else if (entity === "model") await db.model.update({ where: { id }, data: { name } });
      else if (entity === "material") await db.material.update({ where: { id }, data: { name } });
      else if (entity === "size") await db.size.update({ where: { id }, data: { name } });
      else if (entity === "tag") await db.tag.update({ where: { id }, data: { name } });
      return NextResponse.json({ ok: true });
    }

    // ── Справочники: скрыть/вернуть ──────────────────────────────────
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
    console.error("[admin POST]", new Date().toISOString(), e);
    return NextResponse.json({ error: dbErrorText(e) }, { status: 500 });
  }
}

/**
 * DELETE /api/admin?photoId=X — удалить фото.
 * Шаг 5: теперь это МЯГКОЕ удаление → корзина (deletedAt = now).
 * Файлы остаются на диске до «Удалить навсегда» из корзины или автоочистки (30 дней).
 * Ответ содержит данные фото — для совместимости со старым undo-тостом.
 */
export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const photoId = sp.get("photoId");
  if (!photoId) return NextResponse.json({ error: "Нужен photoId" }, { status: 400 });
  const photo = await db.photo.findUnique({ where: { id: photoId } });
  if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
  await db.photo.update({ where: { id: photoId }, data: { deletedAt: new Date() } });
  return NextResponse.json({
    ok: true,
    photo: { id: photo.id, variantId: photo.variantId, url: photo.url, thumbUrl: photo.thumbUrl, comment: photo.comment },
  });
}
