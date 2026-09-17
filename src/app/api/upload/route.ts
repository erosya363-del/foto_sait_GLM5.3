import { NextRequest, NextResponse } from "next/server";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { db } from "@/lib/db";
import { UPLOADS_OPT_DIR, UPLOADS_THUMB_DIR } from "@/lib/paths";

/**
 * Загрузка фото товара (мобильная «Загрузка» и мастер создания в админке).
 *
 * Контракт (восстановлен по компонентам и схеме; оригинал был утерян вместе
 * с незакоммиченным файлом — УРОК: всё важное немедленно в git):
 *  — FormData: photos[] (jpeg/png/webp, ≤25 МБ, ≤10 шт.), categoryId*,
 *    modelId*, materialId?, sizeId?, comment?, tagIds? («,»-join id);
 *  — вариант ищется по (категория+модель+материал+размер); если нет — создаётся;
 *  — каждый файл: sharp → optimized (до 1600px) + thumb (420px);
 *    файлы пишутся в RUNTIME-зону download/runtime/uploads/{optimized,thumbs}
 *    по абсолютным путям (src/lib/runtime.ts — вне git и .next, переживает
 *    деплой/rebuild); URL раздачи — /api/media/* (edge проксирует /api/*
 *    живьём, новые фото видны снаружи сразу — см. docs/FIX_REPORT.md);
 *  — строки Photo создаются с sortOrder = max+1…, общий comment на все;
 *  — ОТКАТ ЧАСТИЧНОЙ ЗАПИСИ: если строка БД не создалась — файлы,
 *    записанные ЭТИМ запросом (уникальные имена — они не могли существовать
 *    раньше), удаляются; файлы, существовавшие до POST, не трогаются;
 *  — если вариант создан этим запросом и ни одно фото не сохранилось —
 *    пустой вариант удаляется;
 *  — ответ: { ok, variantId, uploaded, rejected: [{ name, reason }] }.
 */

export const runtime = "nodejs";

const MAX_FILES = 10;
const MAX_SIZE = 25 * 1024 * 1024;
const ACCEPT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Уникальное имя файла: не доверяем оригинальному имени вообще. */
function uniqueName(ext: string): string {
  return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
}

async function ensureDirs() {
  await mkdir(UPLOADS_OPT_DIR, { recursive: true });
  await mkdir(UPLOADS_THUMB_DIR, { recursive: true });
}

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const categoryId = String(fd.get("categoryId") ?? "").trim();
    const modelId = String(fd.get("modelId") ?? "").trim();
    if (!categoryId || !modelId) {
      return NextResponse.json({ error: "Выберите категорию и модель" }, { status: 400 });
    }

    // Справочники должны существовать (клиент шлёт только из селектов)
    const [category, model] = await Promise.all([
      db.category.findUnique({ where: { id: categoryId } }),
      db.model.findUnique({ where: { id: modelId } }),
    ]);
    if (!category) return NextResponse.json({ error: "Категория не найдена" }, { status: 400 });
    if (!model) return NextResponse.json({ error: "Модель не найдена" }, { status: 400 });

    const materialId = String(fd.get("materialId") ?? "").trim() || null;
    const sizeId = String(fd.get("sizeId") ?? "").trim() || null;
    const comment = String(fd.get("comment") ?? "").trim().slice(0, 200) || null;
    const tagIds = String(fd.get("tagIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const files = fd.getAll("photos").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "Добавьте хотя бы одно фото" }, { status: 400 });
    }

    // ── Приём и подготовка файлов (ДО создания варианта — ФИКС F-003:
    //    если все файлы отклонены, пустой вариант в каталоге не появляется) ──
    const rejected: Array<{ name: string; reason: string }> = [];
    const accepted = files.slice(0, MAX_FILES);
    files.slice(MAX_FILES).forEach((f) => rejected.push({ name: f.name, reason: "Лимит 10 фото за раз" }));

    await ensureDirs();
    const prepared: Array<{
      name: string; thumbName: string; optBuf: Buffer; thumbBuf: Buffer;
    }> = [];

    for (const file of accepted) {
      const ext = ACCEPT[file.type];
      if (!ext) {
        rejected.push({ name: file.name, reason: "Формат не поддерживается" });
        continue;
      }
      if (file.size > MAX_SIZE) {
        rejected.push({ name: file.name, reason: "Файл больше 25 МБ" });
        continue;
      }
      if (file.size === 0) {
        rejected.push({ name: file.name, reason: "Файл пустой" });
        continue;
      }

      try {
        const buf = Buffer.from(await file.arrayBuffer());

        // Optimized: длинная сторона ≤1600px, качество 82 — исходный формат сохраняем
        const img = sharp(buf, { failOn: "error" }).rotate();
        const meta = await img.metadata();
        const wide = (meta.width ?? 0) >= (meta.height ?? 0);
        const opt = img.resize({
          width: wide ? 1600 : undefined,
          height: wide ? undefined : 1600,
          fit: "inside",
          withoutEnlargement: true,
        });
        const optBuf =
          ext === "png"
            ? await opt.png({ compressionLevel: 9 }).toBuffer()
            : ext === "webp"
              ? await opt.webp({ quality: 82 }).toBuffer()
              : await opt.jpeg({ quality: 82, mozjpeg: true }).toBuffer();

        // Thumb: превью 420px по длинной стороне (JPEG — всегда)
        const thumbBuf = await sharp(buf, { failOn: "error" })
          .rotate()
          .resize(420, 420, { fit: "inside" })
          .jpeg({ quality: 72, mozjpeg: true })
          .toBuffer();

        const name = uniqueName(ext);
        prepared.push({ name, thumbName: `${name}.jpg`, optBuf, thumbBuf });
      } catch {
        rejected.push({ name: file.name, reason: "Не удалось обработать изображение" });
      }
    }

    if (prepared.length === 0) {
      return NextResponse.json(
        { error: "Ни одно фото не принято", uploaded: 0, rejected },
        { status: 400 }
      );
    }

    // ── Вариант: найти по комбинации или создать (только когда есть фото) ──
    let variant = await db.productVariant.findFirst({
      where: { categoryId, modelId, materialId, sizeId, deletedAt: null },
    });
    let variantCreatedHere = false;
    if (!variant) {
      variant = await db.productVariant.create({
        data: { categoryId, modelId, materialId, sizeId },
      });
      variantCreatedHere = true;
    }

    // Признаки: привязать к варианту (дубликаты отсекаем вручную — skipDuplicates
    // в createMany недоступен для SQLite в текущем клиенте Prisma)
    if (tagIds.length > 0) {
      const existing = await db.productVariantTag.findMany({
        where: { variantId: variant.id, tagId: { in: tagIds } },
        select: { tagId: true },
      });
      const have = new Set(existing.map((e) => e.tagId));
      const fresh = [...new Set(tagIds)].filter((t) => !have.has(t));
      if (fresh.length > 0) {
        await db.productVariantTag.createMany({
          data: fresh.map((tagId) => ({ variantId: variant.id, tagId })),
        });
      }
    }

    const maxAgg = await db.photo.aggregate({
      where: { variantId: variant.id },
      _max: { sortOrder: true },
    });
    let sortOrder = (maxAgg._max.sortOrder ?? -1) + 1;
    let uploaded = 0;

    for (const p of prepared) {
      const optPath = path.join(UPLOADS_OPT_DIR, p.name);
      const thumbPath = path.join(UPLOADS_THUMB_DIR, p.thumbName);
      try {
        await Promise.all([writeFile(optPath, p.optBuf), writeFile(thumbPath, p.thumbBuf)]);
        await db.photo.create({
          data: {
            variantId: variant.id,
            url: `/api/media/optimized/${p.name}`,
            thumbUrl: `/api/media/thumbs/${p.thumbName}`,
            comment,
            sortOrder: sortOrder++,
          },
        });
        uploaded++;
      } catch {
        // ОТКАТ ЧАСТИЧНОЙ ЗАПИСИ: имена p.name/p.thumbName генерируются
        // уникально (Date.now+random) — эти файлы созданы ТОЛЬКО этой попыткой,
        // их удаление не задевает чужие данные. Существовавшие до POST файлы
        // не трогаются никогда.
        await Promise.allSettled([unlink(optPath), unlink(thumbPath)]);
        rejected.push({ name: p.name, reason: "Не удалось сохранить файл" });
      }
    }

    if (uploaded === 0) {
      // Вариант создан ЭТИМ запросом и остался пуст — убираем оболочку
      // (иначе в каталоге появится пустышка; найденный ранее вариант не трогаем)
      if (variantCreatedHere) {
        await db.productVariantTag
          .deleteMany({ where: { variantId: variant.id } })
          .catch(() => {});
        await db.productVariant.delete({ where: { id: variant.id } }).catch(() => {});
      }
      return NextResponse.json(
        { error: "Ни одно фото не принято", uploaded: 0, rejected },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, variantId: variant.id, uploaded, rejected });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка загрузки" },
      { status: 500 }
    );
  }
}
