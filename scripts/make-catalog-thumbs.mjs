/**
 * АУДИТ v2.7 (скорость/загрузка): сид-фото каталога лежат в /catalog/*.jpg
 * (1344×768, ~100–130КБ) и используются КАК ЕСТЬ и для лент превью 78–92px
 * (thumbUrl == url), и для ленты товара. Стартовая страница качала ~534КБ
 * картинок ради миниатюр.
 *
 * Скрипт (идемпотентный):
 *  1. public/catalog/*.jpg → sharp →
 *       public/uploads/optimized/<name>.jpg  (≤1600px, q78) — лента товара
 *       public/uploads/thumbs/<name>.jpg     (≤420px,  q70) — все превью
 *  2. БД: Photo.url/thumbUrl '/catalog/x.jpg' → '/uploads/optimized|x/x.jpg'
 *         Material.swatchUrl '/catalog/x.jpg' → '/uploads/thumbs/x.jpg'
 * Структура БД не меняется — только значения путей (как у загруженных фото:
 * тот же конвейер, те же папки, что в api/upload + photo-fs).
 */
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { readdirSync, existsSync, mkdirSync, statSync } from "fs";
import path from "path";

const ROOT = "/home/z/my-project";
const SRC = path.join(ROOT, "public", "catalog");
const OPT = path.join(ROOT, "public", "uploads", "optimized");
const THB = path.join(ROOT, "public", "uploads", "thumbs");
const db = new PrismaClient({
  datasources: { db: { url: "file:/home/z/my-project/db/custom.db" } },
});

for (const d of [OPT, THB]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

const files = readdirSync(SRC).filter((f) => /\.jpe?g$/i.test(f));
console.log(`найдено ${files.length} jpg в public/catalog`);

let made = 0;
for (const f of files) {
  const src = path.join(SRC, f);
  const optPath = path.join(OPT, f);
  const thbPath = path.join(THB, f);
  const needOpt = !existsSync(optPath) || statSync(optPath).mtime < statSync(src).mtime;
  const needThb = !existsSync(thbPath) || statSync(thbPath).mtime < statSync(src).mtime;
  if (needOpt) {
    await sharp(src).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toFile(optPath);
    made++;
  }
  if (needThb) {
    await sharp(src).rotate().resize({ width: 420, height: 420, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70, mozjpeg: true }).toFile(thbPath);
    made++;
  }
}
console.log(`создано файлов: ${made}`);

// ── БД: Photo ──
const photos = await db.photo.findMany({ where: { url: { startsWith: "/catalog/" } }, select: { id: true, url: true, thumbUrl: true } });
let pUpd = 0;
for (const p of photos) {
  const name = p.url.split("/").pop();
  if (!name || !/\.jpe?g$/i.test(name)) continue;
  const newUrl = `/uploads/optimized/${name}`;
  const newThumb = `/uploads/thumbs/${name}`;
  if (!existsSync(path.join(OPT, name))) continue; // файл не создан — не мапим
  const data = {};
  if (p.url === `/catalog/${name}`) data.url = newUrl;
  if (p.thumbUrl === `/catalog/${name}`) data.thumbUrl = newThumb;
  if (Object.keys(data).length) {
    await db.photo.update({ where: { id: p.id }, data });
    pUpd++;
  }
}
console.log(`Photo обновлено: ${pUpd} из ${photos.length}`);

// ── БД: Material.swatchUrl (превью свотча 18px — thumb достаточно) ──
const fabrics = await db.material.findMany({ where: { swatchUrl: { startsWith: "/catalog/" } }, select: { id: true, swatchUrl: true } });
let fUpd = 0;
for (const f of fabrics) {
  const name = f.swatchUrl.split("/").pop();
  if (!name || !existsSync(path.join(THB, name))) continue;
  await db.material.update({ where: { id: f.id }, data: { swatchUrl: `/uploads/thumbs/${name}` } });
  fUpd++;
}
console.log(`Fabric обновлено: ${fUpd} из ${fabrics.length}`);

await db.$disconnect();
console.log("ГОТОВО");
