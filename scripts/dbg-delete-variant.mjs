/* Воспроизведение «Ошибка сервера» при deleteVariant: тестовый вариант + тестовое фото */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

try {
  // 1. Тестовый вариант (переиспользуем уже созданную тест-категорию/модель)
  let cat = await db.category.findFirst({ where: { name: "ТЕСТ-КАТЕГОРИЯ-УД" } });
  if (!cat) cat = await db.category.create({ data: { name: "ТЕСТ-КАТЕГОРИЯ-УД" } });
  let model = await db.model.findFirst({ where: { name: "ТЕСТ-МОДЕЛЬ-УД" } });
  if (!model) model = await db.model.create({ data: { name: "ТЕСТ-МОДЕЛЬ-УД", categoryId: cat.id } });

  const variant = await db.productVariant.create({
    data: { categoryId: cat.id, modelId: model.id },
  });
  console.log("variant:", variant.id);

  // 2. Тестовое фото (soft-live), файлы на диске НЕ создаём — purge их не тронет (soft delete)
  const photo = await db.photo.create({
    data: {
      variantId: variant.id,
      url: "/uploads/optimized/__test_delete__.webp",
      thumbUrl: "/uploads/thumbs/__test_delete__.webp",
      sortOrder: 0,
    },
  });
  console.log("photo:", photo.id);

  // 3. Сам deleteVariant — тот же код, что в API route
  const now = new Date();
  const trashed = await db.photo.updateMany({
    where: { variantId: variant.id, deletedAt: null },
    data: { deletedAt: now },
  });
  await db.productVariant.update({
    where: { id: variant.id },
    data: { deletedAt: now, active: false },
  });
  console.log("deleteVariant OK, photosToTrash:", trashed.count);
} catch (e) {
  console.error("REPRODUCED ERROR:", e.constructor?.name, e.code ?? "", e.message);
} finally {
  // Чистим тестовые строки полностью
  await db.photo.deleteMany({ where: { url: { contains: "__test_delete__" } } });
  const tv = await db.productVariant.findMany({ where: { model: { name: "ТЕСТ-МОДЕЛЬ-УД" } } });
  for (const v of tv) await db.productVariant.delete({ where: { id: v.id } }).catch(() => {});
  const m = await db.model.findFirst({ where: { name: "ТЕСТ-МОДЕЛЬ-УД" } });
  if (m) await db.model.delete({ where: { id: m.id } }).catch(() => {});
  const c = await db.category.findFirst({ where: { name: "ТЕСТ-КАТЕГОРИЯ-УД" } });
  if (c) await db.category.delete({ where: { id: c.id } }).catch(() => {});
  console.log("cleanup done");
}
await db.$disconnect();
