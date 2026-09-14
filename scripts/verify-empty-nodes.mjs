/**
 * Проверка правила «нет фото — нет узла»:
 *  1) создаём вариант БЕЗ фото (категория/модель из справочника, fabric=null,size=null);
 *  2) проверяем: model скрыт в level=models, вариант скрыт в items и search;
 *     категория/модель С фото на месте, счётчики сходятся;
 *  3) создаём ткань без фото-вариантов → ткани не должно быть в level=fabrics;
 *  4) чистим за собой (variant + material), снимаем скриншот-мусор.
 */
const BASE = "http://localhost:3000";
let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fails++;
};

const j = async (url) => (await fetch(BASE + url)).json();

// 1. справочники
const dicts = await j("/api/dictionaries");
const cat = dicts.categories.find((c) => c.active);
const model = dicts.models.find((m) => m.categoryId === cat.id && m.active);
console.log(`база: категория="${cat.name}" модель="${model.name}"`);

// 2. текущее состояние уровня models
const before = await j(`/api/catalog?level=models&category=${encodeURIComponent(cat.name)}`);
const mb = before.models.find((m) => m.name === model.name);
ok(Boolean(mb), "модель с фото видна в level=models до эксперимента");

// 3. создаём вариант без фото напрямую в БД через prisma-клиент стенда
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const ghost = await db.productVariant.create({
  data: { categoryId: cat.id, modelId: model.id, variantName: "AUDIT-GHOST-БЕЗ-ФОТО" },
});
// вторая модель без фото вообще (если есть) — иначе создаём свою модель-призрак
let ghostModel = null;
const modelsWithPhotos = new Set(before.models.map((m) => m.id));
const candidate = dicts.models.find((m) => m.categoryId === cat.id && m.active && !modelsWithPhotos.has(m.id));
if (candidate) {
  ghostModel = await db.model.findUnique({ where: { id: candidate.id } });
} else {
  const maxSort = await db.model.aggregate({ where: { categoryId: cat.id }, _max: { sortOrder: true } });
  ghostModel = await db.model.create({
    data: { categoryId: cat.id, name: "AUDIT-GHOST-МОДЕЛЬ", sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
  });
}

try {
  // 4. ПРОВЕРКИ
  const after = await j(`/api/catalog?level=models&category=${encodeURIComponent(cat.name)}`);
  ok(!after.models.some((m) => m.id === ghostModel.id), "модель без фото СКРЫТА");
  ok(!after.models.some((m) => m.variantCount === 0), "в level=models нет моделей с variantCount=0");

  const items = await j(`/api/catalog?category=${encodeURIComponent(cat.name)}&model=${encodeURIComponent(model.name)}`);
  ok(!items.items.some((i) => i.id === ghost.id), "вариант без фото СКРЫТ в items");
  ok(items.items.every((i) => i.photos.length > 0), "в items только варианты с фото");

  const search = await j(`/api/search?q=AUDIT-GHOST`);
  ok(search.variants.length === 0, "поиск не находит вариант без фото");

  const cats = await j("/api/catalog?level=categories");
  const catRow = cats.categories.find((c) => c.id === cat.id);
  ok(Boolean(catRow), "категория с фото осталась видна");
  ok(cats.categories.every((c) => c.variantCount > 0), "нет категорий с нулём фото-вариантов");

  // счётчик модели = числу вариантов с фото (ghost не считается)
  const mAfter = after.models.find((m) => m.name === model.name);
  const realPhotoVars = await db.productVariant.count({
    where: { modelId: model.id, active: true, deletedAt: null, photos: { some: { deletedAt: null } } },
  });
  ok(mAfter.variantCount === realPhotoVars, `счётчик модели (${mAfter.variantCount}) = вариантам с фото (${realPhotoVars})`);

  // 5. ткань без фото: материал + вариант без фото и без ткани не влияет; проверяем, что fabrics не содержит материалов без фото
  const mats = await j("/api/dictionaries");
  const someMat = mats.materials.find((m) => m.active);
  if (someMat) {
    const ghostMatVar = await db.productVariant.create({
      data: { categoryId: cat.id, modelId: model.id, materialId: someMat.id, variantName: "AUDIT-GHOST-TKAN" },
    });
    const fabrics = await j("/api/catalog?level=fabrics");
    const fRow = fabrics.fabrics.find((f) => f.id === someMat.id);
    const matHasPhotoVars = await db.productVariant.count({
      where: { materialId: someMat.id, active: true, deletedAt: null, photos: { some: { deletedAt: null } } },
    });
    if (matHasPhotoVars === 0) {
      ok(!fRow, `ткань "${someMat.name}" без фото-вариантов СКРЫТА`);
    } else {
      ok(Boolean(fRow), `ткань с фото-вариантами видна (${matHasPhotoVars} шт.)`);
      ok(Boolean(fRow?.thumb), "у видимой ткани есть превью");
    }
    await db.productVariant.delete({ where: { id: ghostMatVar.id } });
  }
} finally {
  await db.productVariant.delete({ where: { id: ghost.id } });
  await db.productVariant.deleteMany({ where: { modelId: ghostModel.id } });
  await db.model.delete({ where: { id: ghostModel.id } });
  await db.$disconnect();
}

console.log(fails === 0 ? "\nВСЕ ПРОВЕРКИ ЗЕЛЁНЫЕ" : `\nПРОВАЛОВ: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
