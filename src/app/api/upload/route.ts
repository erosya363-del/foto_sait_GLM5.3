import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import sharp from "sharp";
import { db } from "@/lib/db";
import { UPLOADS_OPT_DIR, UPLOADS_THUMB_DIR } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES = 10;
const MAX_SIZE = 25 * 1024 * 1024; // 25 МБ
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

type Rejected = { name: string; reason: string };

function publicDir(...parts: string[]) {
  return path.join(process.cwd(), "public", ...parts);
}

/**
 * POST /api/upload — батч-загрузка фото (≤10, JPG/PNG/WebP).
 * Сервер ОБЯЗАТЕЛЬНО проверяет лимит файлов, форматы и размеры —
 * клиентская проверка не считается надёжной.
 * Обработка: EXIF-поворот → до 2000px → WebP q86; миниатюра 640px q80.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать данные формы" }, { status: 400 });
  }

  // ── Серверная проверка лимита файлов ─────────────────────────────
  const files = form.getAll("photos").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Не выбрано ни одного файла" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Максимум ${MAX_FILES} файлов за раз — получено ${files.length}. Уберите лишние и попробуйте снова.` },
      { status: 400 }
    );
  }

  // ── Серверная проверка справочников ──────────────────────────────
  const categoryId = String(form.get("categoryId") ?? "");
  const modelId = String(form.get("modelId") ?? "");
  if (!categoryId || !modelId) {
    return NextResponse.json({ error: "Укажите категорию и модель" }, { status: 400 });
  }

  const [category, model] = await Promise.all([
    db.category.findFirst({ where: { id: categoryId, active: true } }),
    db.model.findFirst({ where: { id: modelId, active: true, categoryId } }),
  ]);
  if (!category) return NextResponse.json({ error: "Категория не найдена" }, { status: 400 });
  if (!model) return NextResponse.json({ error: "Модель не найдена в этой категории" }, { status: 400 });

  const materialId = String(form.get("materialId") ?? "") || null;
  const sizeId = String(form.get("sizeId") ?? "") || null;
  const comment = String(form.get("comment") ?? "").trim() || null;
  const tagIds = String(form.get("tagIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (materialId) {
    const m = await db.material.findFirst({ where: { id: materialId, active: true } });
    if (!m) return NextResponse.json({ error: "Указанный материал не найден" }, { status: 400 });
  }
  if (sizeId) {
    const s = await db.size.findFirst({ where: { id: sizeId, active: true } });
    if (!s) return NextResponse.json({ error: "Указанный размер не найден" }, { status: 400 });
  }
  let tags: Array<{ id: string }> = [];
  if (tagIds.length) {
    tags = await db.tag.findMany({ where: { id: { in: tagIds }, active: true }, select: { id: true } });
  }

  // ── Серверная проверка формата и размера каждого файла ───────────
  const rejected: Rejected[] = [];
  const accepted: Array<{ file: File }> = [];
  for (const f of files) {
    if (!ALLOWED.has(f.type)) {
      rejected.push({
        name: f.name,
        reason: f.type
          ? `формат ${f.type.replace("image/", "").toUpperCase()} не поддерживается`
          : "неизвестный формат",
      });
      continue;
    }
    if (f.size === 0) {
      rejected.push({ name: f.name, reason: "файл пустой" });
      continue;
    }
    if (f.size > MAX_SIZE) {
      rejected.push({ name: f.name, reason: `больше 25 МБ (${(f.size / 1048576).toFixed(1)} МБ)` });
      continue;
    }
    accepted.push({ file: f });
  }

  if (accepted.length === 0) {
    return NextResponse.json({ error: "Ни один файл не прошёл проверку", rejected }, { status: 400 });
  }

  // ── Найти или создать вариант товара ─────────────────────────────
  const variant = await db.productVariant.findFirst({
    where: { categoryId, modelId, materialId, sizeId },
    include: { tags: true },
  });

  const v =
    variant ??
    (await db.productVariant.create({
      data: { categoryId, modelId, materialId, sizeId, description: comment },
      include: { tags: true },
    }));

  if (comment && v.description !== comment) {
    await db.productVariant.update({ where: { id: v.id }, data: { description: comment } }).catch(() => {});
  }

  // Новые признаки — привязать к варианту (без дублей)
  const existingTagIds = new Set(v.tags.map((t) => t.tagId));
  const newTagIds = tags.map((t) => t.id).filter((id) => !existingTagIds.has(id));
  if (newTagIds.length) {
    await db.productVariantTag
      .createMany({ data: newTagIds.map((tagId) => ({ variantId: v.id, tagId })) })
      .catch(() => {});
  }

  // ── Обработка и сохранение изображений ───────────────────────────
  // АБСОЛЮТНЫЕ пути проекта (cwd у standalone = .next/standalone — см. paths.ts)
  const optDir = UPLOADS_OPT_DIR;
  const thumbDir = UPLOADS_THUMB_DIR;
  await mkdir(optDir, { recursive: true });
  await mkdir(thumbDir, { recursive: true });

  const agg = await db.photo.aggregate({ where: { variantId: v.id, deletedAt: null }, _max: { sortOrder: true } });
  const sortOrder = (agg._max.sortOrder ?? -1) + 1;

  const processed: Array<{ url: string; thumbUrl: string }> = [];

  for (const { file } of accepted) {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      // Двойная проверка: реальные пиксели (защита от подмены MIME)
      const meta = await sharp(buf).metadata();
      if (!meta.width || !meta.height) throw new Error("no dimensions");

      const name = `${randomUUID()}.webp`;

      const full = await sharp(buf)
        .rotate() // по EXIF
        .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 86 })
        .toBuffer();

      const thumb = await sharp(buf)
        .rotate()
        .resize(640, 640, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      await writeFile(path.join(optDir, name), full);
      await writeFile(path.join(thumbDir, name), thumb);

      processed.push({ url: `/uploads/optimized/${name}`, thumbUrl: `/uploads/thumbs/${name}` });
    } catch {
      rejected.push({ name: file.name, reason: "не удалось обработать изображение (файл повреждён?)" });
    }
  }

  if (processed.length === 0) {
    return NextResponse.json({ error: "Ни один файл не удалось обработать", rejected }, { status: 400 });
  }

  await db.photo.createMany({
    data: processed.map((p, i) => ({
      variantId: v.id,
      url: p.url,
      thumbUrl: p.thumbUrl,
      sortOrder: sortOrder + i,
    })),
  });

  return NextResponse.json({ ok: true, variantId: v.id, uploaded: processed.length, rejected });
}
