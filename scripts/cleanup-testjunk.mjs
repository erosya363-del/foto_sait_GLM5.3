/**
 * Разовая уборка тестового мусора s5 (категории ТестКат-*): твёрдое удаление
 * вариантов (+их фото с диска и строк), затем моделей и категорий.
 * Живые данные пользователя не трогаем — только имена с префиксом ТестКат-/ТестМодель-.
 */
import { PrismaClient } from "@prisma/client";
import { unlink } from "fs/promises";
import path from "path";

const db = new PrismaClient();
const PUB = process.env.PUBLIC_DIR ?? path.join(process.cwd(), "public");

async function rmFile(url) {
  if (!url?.startsWith("/uploads/")) return; // сид-фото из public/catalog не трогаем
  const rel = url.replace("/uploads/", "");
  for (const dir of ["optimized", "thumbs"]) {
    try { await unlink(path.join(PUB, "uploads", dir, path.basename(url))); } catch {}
  }
}

const junkCats = await db.category.findMany({ where: { name: { startsWith: "ТестКат-" } } });
for (const cat of junkCats) {
  const variants = await db.productVariant.findMany({ where: { categoryId: cat.id } });
  for (const v of variants) {
    const photos = await db.photo.findMany({ where: { variantId: v.id } });
    for (const p of photos) {
      await rmFile(p.url);
      await rmFile(p.thumbUrl);
    }
    await db.photo.deleteMany({ where: { variantId: v.id } });
    await db.productVariantTag.deleteMany({ where: { variantId: v.id } });
    await db.productVariant.delete({ where: { id: v.id } });
    console.log("variant hard-deleted:", v.id);
  }
  await db.model.deleteMany({ where: { categoryId: cat.id } });
  await db.category.delete({ where: { id: cat.id } });
  console.log("category hard-deleted:", cat.name);
}
console.log("cleanup done");
await db.$disconnect();
