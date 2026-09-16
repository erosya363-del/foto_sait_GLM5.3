// E2E Шаг 5: корзина, физическое удаление, быстрое создание товара, регресс.
// Запуск: bash scripts/restart.sh && bun scripts/test-s5.mjs
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";

const ROOT = "/home/z/my-project";
const BASE = "http://localhost:3000";
let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function api(body) {
  const r = await fetch(`${BASE}/api/admin`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

async function makePng(color) {
  return sharp({ create: { width: 50, height: 70, channels: 3, background: color } }).png().toBuffer();
}


const dicts = await (await fetch(`${BASE}/api/dictionaries`)).json();

// ────────────────────────────────────────────────────────────────
// 1. БЫСТРОЕ СОЗДАНИЕ ТОВАРА
// ────────────────────────────────────────────────────────────────
const uniq = Date.now().toString(36);
const qc = await api({
  action: "quickCreateVariant",
  categoryName: `ТестКат-${uniq}`,
  modelName: `ТестМодель-${uniq}`,
  materialId: dicts.materials[0].id,
  variantName: "Тестовая подпись",
});
check("quickCreateVariant создаёт категорию+модель+товар", qc.json.ok === true && qc.json.createdCategory && qc.json.createdModel, JSON.stringify(qc.json));

const dup = await api({
  action: "quickCreateVariant",
  categoryId: qc.json.categoryId,
  modelId: qc.json.modelId,
  materialId: dicts.materials[0].id,
});
check("дубликат товара отклонён (409)", dup.status === 409);

// ────────────────────────────────────────────────────────────────
// 2. ЗАГРУЗКА ФОТО В СОЗДАННЫЙ ТОВАР (штатный /api/upload)
// ────────────────────────────────────────────────────────────────
const fd = new FormData();
fd.append("photos", new File([await makePng({ r: 20, g: 180, b: 170 })], "t1.png", { type: "image/png" }));
fd.append("photos", new File([await makePng({ r: 200, g: 100, b: 30 })], "t2.png", { type: "image/png" }));
fd.append("categoryId", qc.json.categoryId);
fd.append("modelId", qc.json.modelId);
fd.append("materialId", dicts.materials[0].id);
const up = await (await fetch(`${BASE}/api/upload`, { method: "POST", body: fd })).json();
check("upload 2 фото → uploaded:2", up.ok === true && up.uploaded === 2, JSON.stringify(up));

let variants = (await (await fetch(`${BASE}/api/admin?view=variants`)).json()).items;
let mine = variants.find((v) => v.id === qc.json.variantId);
check("вариант в списке с photoCount=2", mine?.photoCount === 2, JSON.stringify(mine));

// ────────────────────────────────────────────────────────────────
// 3. РЕДАКТИРОВАНИЕ + УДАЛЕНИЕ ТОВАРА (вместо «отключения»)
// ────────────────────────────────────────────────────────────────
const ren = await api({ action: "renameVariant", id: qc.json.variantId, variantName: "Обновлённая подпись" });
check("renameVariant ok", ren.json.ok === true);

// Удаление товара: мягкое — товар исчезает, фото (2) уходят в корзину
const delV = await api({ action: "deleteVariant", id: qc.json.variantId });
check("deleteVariant ok, 2 фото → корзина", delV.json.ok === true && delV.json.photosToTrash === 2, JSON.stringify(delV.json));
let variants2 = (await (await fetch(`${BASE}/api/admin?view=variants`)).json()).items;
check("удалённый товар исчез из админки", !variants2.some((v) => v.id === qc.json.variantId));
let catalog = await (await fetch(`${BASE}/api/catalog`)).json();
check("удалённый товар исчез из каталога", !catalog.items.some((i) => i.id === qc.json.variantId));

// Возврат: восстановление любого фото из корзины оживляет товар
let trash0 = (await (await fetch(`${BASE}/api/admin?view=trash`)).json()).items.filter((p) => p.variantId === qc.json.variantId);
check("оба фото товара в корзине", trash0.length === 2, `got ${trash0.length}`);
const rev = await api({ action: "restoreFromTrash", id: trash0[0].id });
check("возврат фото оживил товар (variantRevived)", rev.json.ok === true && rev.json.variantRevived === true, JSON.stringify(rev.json));
variants2 = (await (await fetch(`${BASE}/api/admin?view=variants`)).json()).items;
check("товар вернулся в админку", variants2.some((v) => v.id === qc.json.variantId));
catalog = await (await fetch(`${BASE}/api/catalog`)).json();
check("товар в каталоге с 1 фото", catalog.items.find((i) => i.id === qc.json.variantId)?.photos.length === 1);

// ────────────────────────────────────────────────────────────────
// 3b. СПРАВОЧНИКИ: УДАЛЕНИЕ вместо отключения + защита занятых
// ────────────────────────────────────────────────────────────────
const delCatBusy = await api({ entity: "category", action: "delete", id: qc.json.categoryId });
check("категория в товарах → 409 с числом", delCatBusy.status === 409 && /товар/.test(delCatBusy.json.error), JSON.stringify(delCatBusy.json));
const t1 = await api({ entity: "tag", action: "create", name: `ТестПризнак-${uniq}` });
const delTag = await api({ entity: "tag", action: "delete", id: t1.json.id });
check("свободный признак удаляется", delTag.json.ok === true, JSON.stringify(delTag.json));
const m1 = await api({ entity: "material", action: "create", name: `ТестТкань-${uniq}`, type: "Ткань" });
const delMat = await api({ entity: "material", action: "delete", id: m1.json.id });
check("свободная ткань удаляется", delMat.json.ok === true, JSON.stringify(delMat.json));

// ────────────────────────────────────────────────────────────────
// 4. КОРЗИНА: мягкое удаление → возврат
// ────────────────────────────────────────────────────────────────
const item = catalog.items.find((i) => i.id === qc.json.variantId);
const photoA = item.photos[0];
const del = await fetch(`${BASE}/api/admin?photoId=${photoA.id}`, { method: "DELETE" });
check("DELETE = мягкое удаление", del.ok);
catalog = await (await fetch(`${BASE}/api/catalog`)).json();
check("фото скрылось из каталога", !catalog.items.find((i) => i.id === qc.json.variantId)?.photos.some((p) => p.id === photoA.id));
let trash = await (await fetch(`${BASE}/api/admin?view=trash`)).json();
check("фото в корзине, daysLeft=30", trash.items.some((p) => p.id === photoA.id && p.daysLeft === 30));
const fileOnDisk = path.join(ROOT, "public", photoA.url);
check("файл ещё на диске (мягкость)", fs.existsSync(fileOnDisk));
const rest = await api({ action: "restoreFromTrash", id: photoA.id });
check("restoreFromTrash ok", rest.json.ok === true);
catalog = await (await fetch(`${BASE}/api/catalog`)).json();
check("фото вернулось в каталог", catalog.items.find((i) => i.id === qc.json.variantId)?.photos.some((p) => p.id === photoA.id));

// ────────────────────────────────────────────────────────────────
// 5. ФИЗИЧЕСКОЕ УДАЛЕНИЕ (навсегда)
// ────────────────────────────────────────────────────────────────
await fetch(`${BASE}/api/admin?photoId=${photoA.id}`, { method: "DELETE" });
const purge = await api({ action: "purgePhoto", id: photoA.id });
check("purgePhoto → filesRemoved:true", purge.json.filesRemoved === true, JSON.stringify(purge.json));
check("файл стёрт с диска", !fs.existsSync(fileOnDisk));
trash = await (await fetch(`${BASE}/api/admin?view=trash`)).json();
check("строка исчезла из корзины", !trash.items.some((p) => p.id === photoA.id));

// Защита сид-фото: файлы, чьё имя есть в public/catalog/, физически не удаляются.
// АУДИТ v2.7: сид-фото переехали с префикса /catalog/ на конвейер /uploads/optimized
// + /uploads/thumbs (thumbUrl==url больше нет), защита теперь по НАЛИЧИЮ имени
// в public/catalog (см. photo-fs.isSeedFile), а не по префиксу url.
const item2 = catalog.items.find((i) => i.photos.some((p) => p.url.startsWith("/uploads/optimized/")));
const seedPhoto = item2.photos.find((p) => p.url.startsWith("/uploads/optimized/"));
await fetch(`${BASE}/api/admin?photoId=${seedPhoto.id}`, { method: "DELETE" });
const purgeSeed = await api({ action: "purgePhoto", id: seedPhoto.id });
check("сид-фото (uploads/optimized, имя из catalog) защищено (файл остался)", purgeSeed.json.filesRemoved === false && fs.existsSync(path.join(ROOT, "public", seedPhoto.url)));
await api({ action: "restoreFromTrash", id: seedPhoto.id });

// ────────────────────────────────────────────────────────────────
// 6. ОЧИСТКА КОРЗИНЫ ЦЕЛИКОМ
// ────────────────────────────────────────────────────────────────
const fd2 = new FormData();
fd2.append("photos", new File([await makePng({ r: 90, g: 30, b: 200 })], "t3.png", { type: "image/png" }));
fd2.append("categoryId", qc.json.categoryId);
fd2.append("modelId", qc.json.modelId);
fd2.append("materialId", dicts.materials[0].id);
/* АУДИТ v2.7: сид-фото теперь тоже /uploads/optimized/* — новый файл опознаём
   диффом фото варианта до/после загрузки (upload переименовывает файлы) */
const beforeUp = (await (await fetch(`${BASE}/api/catalog`)).json()).items.find((i) => i.id === qc.json.variantId)?.photos.map((p) => p.id) ?? [];
const up2 = await (await fetch(`${BASE}/api/upload`, { method: "POST", body: fd2 })).json();
if (!up2.ok) console.log("DEBUG up2:", JSON.stringify(up2));
const cat3 = await (await fetch(`${BASE}/api/catalog`)).json();
const afterPhotos = cat3.items.find((i) => i.id === qc.json.variantId).photos;
const p3 = afterPhotos.find((p) => !beforeUp.includes(p.id));
check("новая загрузка опознана диффом", !!p3 && p3.url.startsWith("/uploads/optimized/"), JSON.stringify(p3 ?? {}));
await fetch(`${BASE}/api/admin?photoId=${p3.id}`, { method: "DELETE" });
const pt = await api({ action: "purgeTrash" });
check("purgeTrash ok", pt.json.ok === true && pt.json.purged >= 1, JSON.stringify(pt.json));
check("файл стёрт очисткой корзины", !fs.existsSync(path.join(ROOT, "public", p3.url)));

// ────────────────────────────────────────────────────────────────
// 7. АВТООЧИСТКА 30 ДНЕЙ (симуляция: deletedAt = 40 дней назад)
// ────────────────────────────────────────────────────────────────
const fd3 = new FormData();
fd3.append("photos", new File([await makePng({ r: 10, g: 10, b: 10 })], "t4.png", { type: "image/png" }));
fd3.append("categoryId", qc.json.categoryId);
fd3.append("modelId", qc.json.modelId);
fd3.append("materialId", dicts.materials[0].id);
const up3 = await (await fetch(`${BASE}/api/upload`, { method: "POST", body: fd3 })).json();
if (!up3.ok) { console.log("DEBUG up3:", JSON.stringify(up3)); }
const cat4 = await (await fetch(`${BASE}/api/catalog`)).json();
const item4 = cat4.items.find((i) => i.id === qc.json.variantId);
const p4 = item4?.photos.find((p) => p.url.startsWith("/uploads/"));
if (!p4) {
  console.log("DEBUG: вариант:", item4 ? `фото: ${item4.photos.length}` : "ОТСУТСТВУЕТ В КАТАЛОГЕ");
  const vs = (await (await fetch(`${BASE}/api/admin?view=variants`)).json()).items;
  console.log("DEBUG variants:", vs.filter((v) => v.id === qc.json.variantId));
}
await fetch(`${BASE}/api/admin?photoId=${p4.id}`, { method: "DELETE" });
execSync(`python3 -c "
import sqlite3, time
c = sqlite3.connect('${ROOT}/db/custom.db')
# Prisma хранит DateTime в SQLite как INTEGER (unix ms) — иначе сравнение типов ломает lt
old = int((time.time() - 40*86400) * 1000)
cur = c.execute('SELECT \\"deletedAt\\" FROM photos WHERE \\"id\\"=?', ('${p4.id}',)).fetchone()
print('до:', cur)
upd = c.execute('UPDATE photos SET \\"deletedAt\\"=? WHERE \\"id\\"=?', (old, '${p4.id}'))
c.commit()
print('изменено строк:', upd.rowcount)
"`, { stdio: "pipe" });
const auto = await (await fetch(`${BASE}/api/admin?view=trash`)).json();
check("автоочистка сработала (autoPurged≥1)", auto.autoPurged >= 1, `autoPurged=${auto.autoPurged}`);
check("просроченный файл стёрт", !fs.existsSync(path.join(ROOT, "public", p4.url)));
check("просроченное фото исчезло из корзины", !auto.items.some((p) => p.id === p4.id));

// ────────────────────────────────────────────────────────────────
// 8. РЕГРЕСС: каталог/поиск/остатки/свежее/ткани + страница
// ────────────────────────────────────────────────────────────────
const lvl = async (q) => (await fetch(`${BASE}/api/catalog${q}`)).status;
check("regress: catalog level=categories", (await lvl("?level=categories")) === 200);
check("regress: catalog level=models", (await lvl("?level=models&category=Диваны")) === 200);
check("regress: catalog level=fabrics", (await lvl("?level=fabrics")) === 200);
check("regress: catalog level=fresh", (await lvl("?level=fresh")) === 200);
check("regress: catalog items", (await lvl("")) === 200);
check("regress: search", (await fetch(`${BASE}/api/search?q=магни`)).status === 200);
const stock = await (await fetch(`${BASE}/api/stock?warehouse=Обухово`)).json();
check("regress: stock Обухово", Array.isArray(stock.items) && stock.items.length > 0);
check("regress: главная 200", (await fetch(`${BASE}/`)).status === 200);

// ────────────────────────────────────────────────────────────────
// 9. УБОРКА ТЕСТОВЫХ ДАННЫХ
// ────────────────────────────────────────────────────────────────
const cl = await api({ action: "purgeTrash" });
execSync(`python3 -c "
import sqlite3
c = sqlite3.connect('${ROOT}/db/custom.db')
c.execute('PRAGMA foreign_keys=ON')
c.execute('DELETE FROM product_variants WHERE \\"id\\"=?', ('${qc.json.variantId}',))
c.execute('DELETE FROM models WHERE \\"id\\"=?', ('${qc.json.modelId}',))
c.execute('DELETE FROM categories WHERE \\"id\\"=?', ('${qc.json.categoryId}',))
c.commit()
print('cleanup ok')
"`, { stdio: "pipe" });
const dicts2 = await (await fetch(`${BASE}/api/dictionaries`)).json();
check("уборка: тестовые категория/модель/товар удалены",
  !dicts2.categories.some((c) => c.name === `ТестКат-${uniq}`) &&
  !dicts2.models.some((m) => m.name === `ТестМодель-${uniq}`));

console.log(`\n═══ ШАГ 5 · E2E ═══ ${pass} ✓ / ${fail} ✗`);
for (const r of results) console.log(r);
process.exit(fail ? 1 : 0);
