/* Быстрая статистика runtime-БД (только чтение). */
const { PrismaClient } = require('@prisma/client');

const url = process.env.DATABASE_URL || 'file:' + process.cwd() + '/db/custom.db';
const db = new PrismaClient({ datasourceUrl: url });

async function main() {
  console.log('DB:', url);
  console.log('Photo:', await db.photo.count());
  console.log('Photo(trashed):', await db.photo.count({ where: { deletedAt: { not: null } } }));
  console.log('Variant:', await db.productVariant.count());
  console.log('Variant(deleted):', await db.productVariant.count({ where: { deletedAt: { not: null } } }));
  console.log('Category:', await db.category.count());
  console.log('Model:', await db.model.count());
  console.log('Material:', await db.material.count());
  const last = await db.photo.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { url: true, createdAt: true },
  });
  console.log('Last 5 photos:');
  for (const p of last) console.log('  ', p.url, p.createdAt.toISOString());
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
