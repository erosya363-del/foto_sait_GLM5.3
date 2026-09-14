import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
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
 *    файлы пишутся в public/uploads/{optimized,thumbs} по абсолютным путям
 *    (paths.ts — якорь DATABASE_URL, работает и в standalone);
 *  — строки Photo создаются с sortOrder = max+1…, общий comment на все;
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

    // ── Вариант: найти по комбинации или создать ──────────────────────
    let variant = await db.productVariant.findFirst({
      where: { categoryId, modelId, materialId, sizeId, deletedAt: null },
    });
    if (!variant) {
      variant = await db.productVariant.create({
        data: { categoryId, modelId, materialId, sizeId },
      });
    }

    // Признаки: привязать к варианту (дубликаты пропускаем)
    if (tagIds.length > 0) {
      await db.productVariantTag.createMany({
        data: tagIds.map((tagId) => ({ variantId: variant.id, tagId })),
        skipDuplicates: true,
      });
    }

    // ── Приём и обработка файлов ──────────────────────────────────────
    const rejected: Array<{ name: string; reason: string }> = [];
    const accepted = files.slice(0, MAX_FILES);
    files.slice(MAX_FILES).forEach((f) => rejected.push({ name: f.name, reason: "Лимит 10 фото за раз" }));

    await ensureDirs();
    const maxAgg = await db.photo.aggregate({
      where: { variantId: variant.id },
      _max: { sortOrder: true },
    });
    let sortOrder = (maxAgg._max.sortOrder ?? -1) + 1;
    let uploaded = 0;

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
        const thumbName = `${name}.jpg`;
        await Promise.all([
          writeFile(path.join(UPLOADS_OPT_DIR, name), optBuf),
          writeFile(path.join(UPLOADS_THUMB_DIR, thumbName), thumbBuf),
        ]);

        await db.photo.create({
          data: {
            variantId: variant.id,
            url: `/uploads/optimized/${name}`,
            thumbUrl: `/uploads/thumbs/${thumbName}`,
            comment,
            sortOrder: sortOrder++,
          },
        });
        uploaded++;
      } catch {
        rejected.push({ name: file.name, reason: "Не удалось обработать изображение" });
      }
    }

    if (uploaded === 0) {
      return NextResponse.json(
        { error: "Ни одно фото не принято", variantId: variant.id, uploaded: 0, rejected },
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
