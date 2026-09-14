/**
 * Очистка тестового мусора аудита: фото/варианты, созданные за последние 2 часа
 * загрузкой /api/upload из аудита (файлы audit-*.png и тестовые аплоады).
 * Запуск: bun scripts/cleanup-audit-junk.mjs [--dry]
 */
import { db as prisma } from "../src/lib/db.ts";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { UPLOADS_OPT_DIR, UPLOADS_THUMB_DIR } from "../src/lib/paths.ts";

const dry = process.argv.includes("--dry");
const since = new Date(Date.now() - 2 * 3600 * 1000);

const photos = await prisma.photo.findMany({ where: { createdAt: { gte: since } } });
console.log(`Фото за 2 ч: ${photos.length}`);
for (const p of photos) {
  console.log(`  del photo ${p.id} ${p.url}`);
  if (!dry) {
    await prisma.photo.delete({ where: { id: p.id } }).catch(() => {});
    const f1 = path.join(UPLOADS_OPT_DIR, path.basename(p.url));
    const f2 = path.join(UPLOADS_THUMB_DIR, path.basename(p.thumbUrl));
    await unlink(f1).catch(() => {});
    await unlink(f2).catch(() => {});
  }
}

// Варианты, созданные за 2 ч и оставшиеся без фото (мусор аудита)
const variants = await prisma.productVariant.findMany({
  where: { createdAt: { gte: since } },
  include: { _count: { select: { photos: true } } },
});
for (const v of variants) {
  if (v._count.photos === 0) {
    console.log(`  del variant ${v.id} (0 фото)`);
    if (!dry) {
      await prisma.productVariantTag.deleteMany({ where: { variantId: v.id } }).catch(() => {});
      await prisma.productVariant.delete({ where: { id: v.id } }).catch(() => {});
    }
  } else {
    console.log(`  keep variant ${v.id} (${v._count.photos} фото)`);
  }
}
console.log(dry ? "DRY — ничего не удалено" : "Очистка завершена");
