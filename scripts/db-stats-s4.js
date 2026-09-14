const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const cats = await db.category.findMany({ include: { _count: { select: { models: true, variants: true } } }, orderBy: { sortOrder: 'asc' } });
  console.log('categories:', cats.map(c => `${c.name}(models:${c._count.models}, variants:${c._count.variants})`).join(' | '));
  const totalVar = await db.productVariant.count();
  const totalPhoto = await db.photo.count();
  console.log('TOTAL variants:', totalVar, '| photos:', totalPhoto);
  const week = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const newVar = await db.productVariant.count({ where: { createdAt: { gte: week } } });
  const newPhoto = await db.photo.count({ where: { createdAt: { gte: week } } });
  console.log('NEW 7d: variants', newVar, '| photos', newPhoto);
  const materials = await db.material.findMany({ include: { _count: { select: { variants: true } } } });
  console.log('materials:', materials.map(m => `${m.name}(${m._count.variants})`).join(' | ') || 'none');
  const recent = await db.photo.findMany({
    take: 8, orderBy: { createdAt: 'desc' },
    include: { variant: { include: { model: true, category: true, material: true } } },
  });
  console.log('--- 8 latest photos ---');
  recent.forEach(p => console.log(
    p.createdAt.toISOString().slice(0, 16), '|',
    p.variant.category.name, '>', p.variant.model.name, '>', p.variant.variantName || '-', '|',
    p.url.slice(0, 70)
  ));
  const newestVar = await db.productVariant.findMany({
    take: 8, orderBy: { createdAt: 'desc' },
    include: { model: true, category: true, material: true, _count: { select: { photos: true } } },
  });
  console.log('--- 8 latest variants ---');
  newestVar.forEach(v => console.log(
    v.createdAt.toISOString().slice(0, 16), '|',
    v.category.name, '>', v.model.name, '>', v.variantName || v.material?.name || '-', '| photos:', v._count.photos
  ));
  await db.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
