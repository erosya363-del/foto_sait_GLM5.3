/**
 * clean-test-junk.mjs — удаление тестовых артефактов E2E из runtime-БД.
 *
 * Откуда мусор: изолированные E2E-прогоны должны писать в КОПИЮ runtime
 * (scripts/run-isolated.sh), но часть ранних тестов выполнялась по прямой
 * базе — в словарях остались категории «ТестКат-*» и модели «ТестМодель-*».
 * Они попадают в деплой (артефакт выпекается из runtime-зоны) и видны
 * пользователям живого сайта.
 *
 * Безопасность:
 *   1) перед удалением — бэкап runtime (scripts/backup-runtime.sh, метка pre-clean)
 *   2) скрипт ОТКАЗЫВАЕТСЯ удалять, если на тестовые записи ссылается хоть один
 *      вариант каталога (фото/остатки) — тогда нужна ручная разборка
 *
 * Запуск: bun scripts/clean-test-junk.mjs
 */
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";

const db = new PrismaClient({
  datasourceUrl: `file:${process.cwd()}/download/runtime/database/custom.db`,
});

const PATTERN = "Тест";

async function main() {
  console.log("── Бэкап перед чисткой…");
  execSync('bash scripts/backup-runtime.sh "pre-clean"', {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  const testCategories = await db.category.findMany({
    where: { name: { startsWith: PATTERN } },
    select: { id: true, name: true },
  });
  const testModels = await db.model.findMany({
    where: { name: { startsWith: PATTERN } },
    select: { id: true, name: true },
  });

  const catIds = testCategories.map((c) => c.id);
  const modelIds = testModels.map((m) => m.id);

  console.log(
    `   найдено: категорий ${testCategories.length}, моделей ${testModels.length}`
  );
  testCategories.forEach((c) => console.log("     кат:", c.name));
  testModels.forEach((m) => console.log("     мод:", m.name));

  if (testCategories.length === 0 && testModels.length === 0) {
    console.log("✅ Тестового мусора нет — чистка не требуется");
    return;
  }

  // Страховка: на тестовых словарях не должно висеть реальных данных
  const variantsOnTest = await db.productVariant.count({
    where: { OR: [{ categoryId: { in: catIds } }, { modelId: { in: modelIds } }] },
  });
  if (variantsOnTest > 0) {
    console.error(
      `✗ ОТКАЗ: на тестовых категориях/моделях висит вариантов: ${variantsOnTest}. ` +
        `Требуется ручная разборка (это уже не «мусорные словари»).`
    );
    process.exit(1);
  }

  const delModels = await db.model.deleteMany({
    where: { id: { in: modelIds } },
  });
  const delCats = await db.category.deleteMany({
    where: { id: { in: catIds } },
  });
  console.log(
    `   удалено: категорий ${delCats.count}, моделей ${delModels.count}`
  );

  const after = {
    categories: await db.category.count(),
    models: await db.model.count(),
    variants: await db.productVariant.count(),
    photos: await db.photo.count(),
    stockItems: await db.stockItem.count(),
  };
  console.log("── После чистки:", JSON.stringify(after));
  console.log("✅ Чистка завершена (бэкап лежит в download/backups/)");
}

main()
  .catch((e) => {
    console.error("✗ Ошибка чистки:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
