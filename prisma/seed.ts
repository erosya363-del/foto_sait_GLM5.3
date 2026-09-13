/**
 * Сид v1.5 — реальные данные складов Владимир/Обухово.
 * Категории: Диваны (5 моделей, 15 вариантов), Кровати (5 моделей, 11 вариантов).
 * Ткани: Sky Velvet (21 цвет), Casanova (14 цветов).
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const SKY = [ "01","02","03","07","08","10","12","16","17","18","21","30","31","32","38","40","41","42","43","50","99" ];
const CASANOVA = ["beige","celodan","chocolate","desert","grass","grey","ice","lilac","marsala","milk","pudra","scandy","seawave","stone"];

async function main() {
  await db.photo.deleteMany();
  await db.productVariantTag.deleteMany();
  await db.productVariant.deleteMany();
  await db.stockItem.deleteMany();
  await db.model.deleteMany();
  await db.category.deleteMany();
  await db.material.deleteMany();
  await db.size.deleteMany();
  await db.tag.deleteMany();

  // ─── Ткани ──────────────────────────────────────────────────────────────
  const skyMat = await Promise.all(
    SKY.map((n) =>
      db.material.create({
        data: { name: `Sky Velvet ${n}`, type: "Ткань", swatchUrl: "/catalog/texture-velvet.jpg" },
      })
    )
  );
  const casMat = await Promise.all(
    CASANOVA.map((n) =>
      db.material.create({
        data: { name: `Casanova ${n}`, type: "Ткань", swatchUrl: "/catalog/texture-casanova.jpg" },
      })
    )
  );

  // ─── Размеры ────────────────────────────────────────────────────────────
  const sizeNames = ["160×200", "180×200", "200×200", "2–2.5 м", "2.5–3.5 м"];
  const sizes: Record<string, string> = {};
  for (const n of sizeNames) sizes[n] = (await db.size.create({ data: { name: n } })).id;

  // ─── Признаки ───────────────────────────────────────────────────────────
  const tagNames = [
    "Стандарт", "Акция", "Угловой", "Раскладной", "С ПМ", "Без ПМ",
    "Мягкое изголовье", "Со встроенным топпером", "Классические подлокотники", "Анатомический матрас",
  ];
  const tags: Record<string, string> = {};
  for (const n of tagNames) tags[n] = (await db.tag.create({ data: { name: n } })).id;

  // ─── Категории и модели ─────────────────────────────────────────────────
  const sofas = await db.category.create({ data: { name: "Диваны", icon: "sofa", sortOrder: 1 } });
  const beds = await db.category.create({ data: { name: "Кровати", icon: "bed", sortOrder: 2 } });

  const sofaModels = [
    { name: "Магни", latin: "Magni" },
    { name: "Трентон", latin: "Trenton" },
    { name: "Карина ПРО", latin: "Karina PRO" },
    { name: "Локо Про", latin: "Loko Pro" },
    { name: "Ника ПРО", latin: "Nika PRO" },
  ];
  const bedModels = [
    { name: "Alfa", latin: "Alfa" },
    { name: "Mira Nova", latin: "Mira Nova" },
    { name: "Simple", latin: "Simple" },
    { name: "Extra Nova", latin: "Extra Nova" },
    { name: "Pola Nova", latin: "Pola Nova" },
  ];
  const m: Record<string, string> = {};
  let sort = 0;
  for (const { name, latin } of sofaModels)
    m[name] = (await db.model.create({ data: { name, latin, categoryId: sofas.id, sortOrder: sort++ } })).id;
  for (const { name, latin } of bedModels)
    m[name] = (await db.model.create({ data: { name, latin, categoryId: beds.id, sortOrder: sort++ } })).id;

  // ─── Варианты каталога ──────────────────────────────────────────────────
  // 2 фото на вариант: фото модели + образец ткани (как в приложении: бейдж «2»)
  const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];
  let si = 0; // индекс распределения тканей

  type VSpec = {
    model: string; category: string; variantName?: string;
    size?: string; material: string; tags: string[]; photo: string;
  };

  const sofaSpecs: VSpec[] = [
    { model: "Магни", variantName: "Стандарт", size: "2–2.5 м", material: pick(skyMat, si).name, tags: ["Стандарт", "Раскладной"], photo: "/catalog/sofa-magni-1.jpg" },
    { model: "Магни", variantName: "Угловой", size: "2.5–3.5 м", material: pick(skyMat, ++si).name, tags: ["Угловой"], photo: "/catalog/sofa-magni-2.jpg" },
    { model: "Магни", variantName: "С анатомическим матрасом", size: "2.5–3.5 м", material: pick(skyMat, ++si).name, tags: ["Угловой", "Анатомический матрас"], photo: "/catalog/sofa-magni-2.jpg" },
    { model: "Трентон", variantName: "Стандарт", size: "2–2.5 м", material: pick(skyMat, ++si).name, tags: ["Стандарт"], photo: "/catalog/sofa-trenton-1.jpg" },
    { model: "Трентон", variantName: "Акция", size: "2–2.5 м", material: pick(casMat, si).name, tags: ["Акция"], photo: "/catalog/sofa-trenton-1.jpg" },
    { model: "Трентон", variantName: "Со встроенным топпером", size: "2.5–3.5 м", material: pick(skyMat, ++si).name, tags: ["Со встроенным топпером"], photo: "/catalog/sofa-trenton-1.jpg" },
    { model: "Карина ПРО", variantName: "Стандарт", size: "2–2.5 м", material: pick(skyMat, ++si).name, tags: ["Стандарт"], photo: "/catalog/sofa-karina-1.jpg" },
    { model: "Карина ПРО", variantName: "Акция", size: "2–2.5 м", material: pick(casMat, ++si).name, tags: ["Акция"], photo: "/catalog/sofa-karina-1.jpg" },
    { model: "Карина ПРО", variantName: "С классическими подлокотниками", size: "2.5–3.5 м", material: pick(casMat, ++si).name, tags: ["Классические подлокотники"], photo: "/catalog/sofa-karina-1.jpg" },
    { model: "Локо Про", variantName: "Стандарт", size: "2.5–3.5 м", material: pick(skyMat, ++si).name, tags: ["Стандарт"], photo: "/catalog/sofa-loko-1.jpg" },
    { model: "Локо Про", variantName: "Акция", size: "2.5–3.5 м", material: pick(skyMat, ++si).name, tags: ["Акция"], photo: "/catalog/sofa-loko-1.jpg" },
    { model: "Локо Про", variantName: "С анатомическим матрасом", size: "2.5–3.5 м", material: pick(skyMat, ++si).name, tags: ["Анатомический матрас"], photo: "/catalog/sofa-loko-1.jpg" },
    { model: "Локо Про", variantName: "Угловой", size: "2.5–3.5 м", material: pick(casMat, ++si).name, tags: ["Угловой"], photo: "/catalog/sofa-loko-1.jpg" },
    { model: "Ника ПРО", variantName: "Стандарт", size: "2–2.5 м", material: pick(skyMat, ++si).name, tags: ["Стандарт"], photo: "/catalog/sofa-nika-1.jpg" },
    { model: "Ника ПРО", variantName: "Акция", size: "2–2.5 м", material: pick(casMat, ++si).name, tags: ["Акция"], photo: "/catalog/sofa-nika-1.jpg" },
  ];

  const bedSizes = ["160×200", "180×200", "200×200"];
  const bedSpecs: VSpec[] = [];
  const bedPhotos: Record<string, string> = {
    "Alfa": "/catalog/bed-alfa-1.jpg",
    "Mira Nova": "/catalog/bed-mira-1.jpg",
    "Simple": "/catalog/bed-simple-1.jpg",
    "Extra Nova": "/catalog/bed-extra-1.jpg",
    "Pola Nova": "/catalog/bed-pola-1.jpg",
  };
  const bedPlan: Array<[string, number]> = [["Alfa", 2], ["Mira Nova", 2], ["Simple", 2], ["Extra Nova", 2], ["Pola Nova", 3]];
  for (const [name, count] of bedPlan)
    for (let i = 0; i < count; i++)
      bedSpecs.push({
        model: name, size: bedSizes[i], material: pick(skyMat, ++si).name,
        tags: i === 0 ? ["С ПМ", "Мягкое изголовье"] : ["Без ПМ"],
        photo: bedPhotos[name],
      });

  const allSpecs = [...sofaSpecs, ...bedSpecs];
  const sofaNames = new Set(sofaModels.map((x) => x.name));
  for (const spec of allSpecs) {
    const material = [...skyMat, ...casMat].find((x) => x.name === spec.material)!;
    const variant = await db.productVariant.create({
      data: {
        categoryId: sofaNames.has(spec.model) ? sofas.id : beds.id,
        modelId: m[spec.model],
        materialId: material.id,
        sizeId: spec.size ? sizes[spec.size] : null,
        variantName: spec.variantName ?? null,
        tags: { create: spec.tags.map((t) => ({ tagId: tags[t] })) },
      },
    });
    await db.photo.createMany({
      data: [
        { variantId: variant.id, url: spec.photo, thumbUrl: spec.photo, sortOrder: 0 },
        { variantId: variant.id, url: material.swatchUrl!, thumbUrl: material.swatchUrl!, sortOrder: 1, comment: "Образец ткани" },
      ],
    });
  }

  // ─── Остатки: Обухово + Владимир ────────────────────────────────────────
  type SSpec = { name: string; qty: number; category: string; size?: string; feature?: string; warehouse: string; sale?: boolean };
  const stock: SSpec[] = [
    // Обухово — диваны
    { name: "Магни прямой", qty: 4, category: "Диваны", size: "2–2.5 м", feature: "Раскладной", warehouse: "Обухово" },
    { name: "Магни угловой", qty: 2, category: "Диваны", size: "2.5–3.5 м", warehouse: "Обухово" },
    { name: "Магни с анат. матрасом", qty: 1, category: "Диваны", size: "2.5–3.5 м", warehouse: "Обухово", sale: true },
    { name: "Трентон", qty: 5, category: "Диваны", size: "2–2.5 м", warehouse: "Обухово" },
    { name: "Трентон Акция", qty: 3, category: "Диваны", size: "2–2.5 м", warehouse: "Обухово", sale: true },
    { name: "Трентон с топпером", qty: 2, category: "Диваны", size: "2.5–3.5 м", warehouse: "Обухово" },
    { name: "Карина ПРО", qty: 6, category: "Диваны", size: "2–2.5 м", warehouse: "Обухово" },
    { name: "Карина ПРО Акция", qty: 2, category: "Диваны", size: "2–2.5 м", warehouse: "Обухово", sale: true },
    { name: "Карина Про класс. подлокотники", qty: 3, category: "Диваны", size: "2.5–3.5 м", warehouse: "Обухово" },
    { name: "Локо Про угловой", qty: 2, category: "Диваны", size: "2.5–3.5 м", warehouse: "Обухово" },
    { name: "Локо Про Акция", qty: 1, category: "Диваны", size: "2.5–3.5 м", warehouse: "Обухово", sale: true },
    { name: "Ника ПРО", qty: 4, category: "Диваны", size: "2–2.5 м", warehouse: "Обухово" },
    // Обухово — кровати
    { name: "Alfa", qty: 3, category: "Кровати", size: "160×200", feature: "С ПМ", warehouse: "Обухово" },
    { name: "Alfa", qty: 2, category: "Кровати", size: "180×200", warehouse: "Обухово" },
    { name: "Mira Nova", qty: 4, category: "Кровати", size: "160×200", feature: "С ПМ", warehouse: "Обухово" },
    { name: "Simple", qty: 5, category: "Кровати", size: "160×200", feature: "С ПМ", warehouse: "Обухово" },
    { name: "Extra Nova", qty: 2, category: "Кровати", size: "180×200", feature: "С ПМ", warehouse: "Обухово" },
    { name: "Pola Nova", qty: 3, category: "Кровати", size: "160×200", warehouse: "Обухово" },
    { name: "Pola Nova", qty: 1, category: "Кровати", size: "200×200", warehouse: "Обухово", sale: true },
    // Владимир — диваны
    { name: "Магни прямой", qty: 2, category: "Диваны", size: "2–2.5 м", warehouse: "Владимир" },
    { name: "Трентон", qty: 3, category: "Диваны", size: "2–2.5 м", warehouse: "Владимир" },
    { name: "Карина ПРО", qty: 4, category: "Диваны", size: "2–2.5 м", warehouse: "Владимир" },
    { name: "Локо Про угловой", qty: 1, category: "Диваны", size: "2.5–3.5 м", warehouse: "Владимир", sale: true },
    { name: "Ника ПРО", qty: 2, category: "Диваны", size: "2–2.5 м", warehouse: "Владимир" },
    // Владимир — кровати
    { name: "Alfa", qty: 2, category: "Кровати", size: "160×200", feature: "С ПМ", warehouse: "Владимир" },
    { name: "Mira Nova", qty: 3, category: "Кровати", size: "180×200", warehouse: "Владимир" },
    { name: "Simple", qty: 2, category: "Кровати", size: "160×200", feature: "С ПМ", warehouse: "Владимир" },
    { name: "Extra Nova", qty: 1, category: "Кровати", size: "180×200", feature: "С ПМ", warehouse: "Владимир", sale: true },
    { name: "Pola Nova", qty: 2, category: "Кровати", size: "180×200", warehouse: "Владимир" },
    { name: "Alfa", qty: 1, category: "Кровати", size: "180×200", warehouse: "Владимир" },
    { name: "Карина ПРО Акция", qty: 1, category: "Диваны", size: "2–2.5 м", warehouse: "Владимир", sale: true },
    { name: "Simple", qty: 1, category: "Кровати", size: "180×200", warehouse: "Владимир" },
  ];
  for (const { sale, ...s } of stock) await db.stockItem.create({ data: { ...s, hasSale: sale ?? false } });

  const vCount = await db.productVariant.count();
  const pCount = await db.photo.count();
  console.log(`Сид готов: 2 склада, ${stock.length} остатков, 10 моделей, ${vCount} вариантов, ${pCount} фото, ${skyMat.length + casMat.length} тканей`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
