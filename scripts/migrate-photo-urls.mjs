/**
 * ОДНОРАЗОВАЯ (идемпотентная) миграция URL фото в БД:
 *   /uploads/optimized/X → /api/media/optimized/X
 *   /uploads/thumbs/X    → /api/media/thumbs/X
 * Затрагивается: Photo.url, Photo.thumbUrl, Material.swatchUrl.
 *
 * ПОЧЕМУ: edge-шлюз платформы отдаёт статику только из снапшота деплоя —
 * /uploads/* файлы, которых нет в снапшоте, снаружи 404. /api/* проксируется
 * живьём. После выноса uploads из public/ (runtime → download/runtime) в
 * новых снапшотах /uploads/* файлов вообще не будет — старые ссылки сломались
 * бы внешне после следующего деплоя.
 *
 * БЕЗОПАСНОСТЬ:
 *  — по умолчанию DRY-RUN (показывает, сколько строк изменится);
 *  --apply — выполнить;
 *  — перед --apply сам создаёт резервную копию БД в download/backups/;
 *  — идемпотентен: строки с /api/media/ не трогает, повторный запуск безвреден;
 *  — содержимое файлов не меняется, только префикс URL в строках.
 *
 * Запуск: bun scripts/migrate-photo-urls.mjs [--apply]
 */
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
// Разрешение БД — ТА ЖЕ логика, что в src/lib/runtime.ts (databaseFile):
// RUNTIME_ROOT > env DATABASE_URL (кроме легаси <proj>/db/custom.db) > download/runtime
const PROJECT_ROOT = process.cwd();
const LEGACY_DB = path.join(PROJECT_ROOT, "db", "custom.db");
const DB_FILE = (() => {
  if (process.env.RUNTIME_ROOT) {
    return path.join(process.env.RUNTIME_ROOT, "database", "custom.db");
  }
  const url = process.env.DATABASE_URL;
  if (url?.startsWith("file:")) {
    const p = url.slice(5);
    if (path.isAbsolute(p) && p !== LEGACY_DB) return p;
  }
  return path.join(PROJECT_ROOT, "download", "runtime", "database", "custom.db");
})();

const db = new PrismaClient({ datasourceUrl: `file:${DB_FILE}` });

function remap(url) {
  if (!url) return null;
  if (url.startsWith("/api/media/")) return null; // уже мигрировано
  if (url.startsWith("/uploads/")) return url.replace("/uploads/", "/api/media/");
  return null; // чужой префикс (например /catalog/) — не трогаем
}

console.log(`БД: ${DB_FILE}`);
console.log(`Режим: ${APPLY ? "APPLY (с изменением БД)" : "DRY-RUN (без изменений)"}\n`);

const photos = await db.photo.findMany({
  select: { id: true, url: true, thumbUrl: true },
});
const materials = await db.material.findMany({
  select: { id: true, swatchUrl: true },
});

const photoUpdates = [];
for (const p of photos) {
  const url = remap(p.url);
  const thumbUrl = remap(p.thumbUrl);
  if (url || thumbUrl) photoUpdates.push({ id: p.id, url, thumbUrl });
}
const materialUpdates = [];
for (const m of materials) {
  const swatchUrl = remap(m.swatchUrl);
  if (swatchUrl) materialUpdates.push({ id: m.id, swatchUrl });
}

console.log(`Photo:     к обновлению ${photoUpdates.length} из ${photos.length}`);
console.log(`Material:  к обновлению ${materialUpdates.length} из ${materials.length}`);
if (photoUpdates.length) {
  console.log("Примеры Photo:");
  for (const u of photoUpdates.slice(0, 3))
    console.log(`  ${u.url}  (thumb: ${u.thumbUrl})`);
}

if (!APPLY) {
  console.log("\nDry-run завершён. Для применения: bun scripts/migrate-photo-urls.mjs --apply");
  await db.$disconnect();
  process.exit(0);
}

if (photoUpdates.length === 0 && materialUpdates.length === 0) {
  console.log("\nНечего обновлять — БД уже мигрирована.");
  await db.$disconnect();
  process.exit(0);
}

// Резервная копия перед изменением
const backupDir = path.join(process.cwd(), "download", "backups");
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupPath = path.join(backupDir, `pre-url-migrate-${stamp}.db`);
fs.copyFileSync(DB_FILE, backupPath);
const md5 = execSync(`md5sum "${backupPath}"`).toString().split(" ")[0];
console.log(`\nРезервная копия: ${backupPath} (md5 ${md5})`);

let okPhotos = 0;
for (const u of photoUpdates) {
  const data = {};
  if (u.url) data.url = u.url;
  if (u.thumbUrl) data.thumbUrl = u.thumbUrl;
  await db.photo.update({ where: { id: u.id }, data });
  okPhotos++;
}
let okMaterials = 0;
for (const u of materialUpdates) {
  await db.material.update({ where: { id: u.id }, data: { swatchUrl: u.swatchUrl } });
  okMaterials++;
}

console.log(`\n✅ Обновлено: Photo ${okPhotos}, Material ${okMaterials}`);
console.log("Проверка (должно быть 0 строк с /uploads/):");
const leftPhotos = await db.photo.count({
  where: { OR: [{ url: { startsWith: "/uploads/" } }, { thumbUrl: { startsWith: "/uploads/" } }] },
});
const leftMaterials = await db.material.count({ where: { swatchUrl: { startsWith: "/uploads/" } } });
console.log(`  Photo с /uploads/: ${leftPhotos}, Material с /uploads/: ${leftMaterials}`);

await db.$disconnect();
