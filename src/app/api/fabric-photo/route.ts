import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import path from "path";
import { mkdir, unlink, writeFile } from "fs/promises";
import sharp from "sharp";
import { db } from "@/lib/db";
import { UPLOADS_OPT_DIR, UPLOADS_THUMB_DIR } from "@/lib/paths";
import { purgePhotoFiles } from "@/lib/photo-fs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIZE = 25 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * POST /api/fabric-photo — фото каталога ткани (одно, JPG/PNG/WebP).
 * Обработка: EXIF-поворот → до 1200px → WebP q86; миниатюра 480px q80.
 * Привязывается к Material.swatchUrl; предыдущий файл (если был в /uploads/)
 * удаляется с диска, чтобы не копить мусор.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать данные формы" }, { status: 400 });
  }

  const materialId = String(form.get("materialId") ?? "");
  if (!materialId) return NextResponse.json({ error: "Не указана ткань" }, { status: 400 });
  const material = await db.material.findUnique({ where: { id: materialId } });
  if (!material) return NextResponse.json({ error: "Ткань не найдена" }, { status: 404 });

  const file = form.get("photo");
  if (!(file instanceof File)) return NextResponse.json({ error: "Не выбран файл" }, { status: 400 });
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Поддерживаются JPG, PNG и WebP" }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: "Файл пустой" }, { status: 400 });
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: `Файл больше 25 МБ (${(file.size / 1048576).toFixed(1)} МБ)` }, { status: 400 });
  }

  let full: Buffer;
  let thumb: Buffer;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) throw new Error("no dimensions");

    full = await sharp(buf)
      .rotate() // по EXIF
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer();

    thumb = await sharp(buf)
      .rotate()
      .resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "Не удалось обработать изображение (файл повреждён?)" }, { status: 400 });
  }

  // Абсолютные пути runtime-зоны (вне git и .next — см. src/lib/runtime.ts)
  await mkdir(UPLOADS_OPT_DIR, { recursive: true });
  await mkdir(UPLOADS_THUMB_DIR, { recursive: true });

  const name = `${randomUUID()}.webp`;
  const optPath = path.join(UPLOADS_OPT_DIR, name);
  const thumbPath = path.join(UPLOADS_THUMB_DIR, name);

  // URL через /api/media/* — edge проксирует /api/* живьём (см. FIX_REPORT)
  const swatchUrl = `/api/media/optimized/${name}`;
  const thumbUrl = `/api/media/thumbs/${name}`;

  // Старый файл каталога ткани (если был загружен, а не сид из /catalog/) — стереть.
  // Принимаем и легаси-префикс /uploads/ (старые строки БД), и текущий /api/media/
  const oldSwatch = material.swatchUrl;
  const isUploadedSwatch =
    oldSwatch && (oldSwatch.startsWith("/uploads/") || oldSwatch.startsWith("/api/media/"));
  let oldCleaned = false;
  if (isUploadedSwatch && oldSwatch) {
    const oldThumb = oldSwatch.includes("/thumbs/")
      ? oldSwatch
      : oldSwatch.replace("/optimized/", "/thumbs/");
    oldCleaned = await purgePhotoFiles(oldSwatch, oldThumb).catch(() => false);
  }

  // Пишем файлы и строку БД; при сбое — откат файлов, записанных этой попыткой
  try {
    await Promise.all([writeFile(optPath, full), writeFile(thumbPath, thumb)]);
    await db.material.update({ where: { id: materialId }, data: { swatchUrl } });
  } catch (e) {
    await Promise.allSettled([unlink(optPath), unlink(thumbPath)]);
    throw e;
  }

  return NextResponse.json({ ok: true, swatchUrl, thumbUrl, oldCleaned });
}
