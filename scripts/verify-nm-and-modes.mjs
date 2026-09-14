/**
 * E2E: 
 *  A) upload «N/M»: 3 файла, ловим счётчик «Загружаем… N/3»/«Фото N из 3»,
 *     финал «3 фото загружено»; после — точечная чистка тестовых фото (10 мин).
 *  B) режимы вида: level-3 каталога → «Крупно» → F5 → режим сохранился;
 *     новый таб того же контекста → режим всё ещё «Крупно» (localStorage).
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3000";
let fails = 0;
const ok = (c, l) => { console.log(`${c ? "PASS" : "FAIL"}  ${l}`); if (!c) fails++; };

const browser = await chromium.launch();

/* ═════════ A: upload N/M ═════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.click('nav.pill-nav button:has-text("Загрузка")');
  await page.waitForTimeout(700);

  const img = fs.readFileSync("public/catalog/cover-1.jpg");
  await page.setInputFiles('input[type="file"]', [
    { name: "nm-a.jpg", mimeType: "image/jpeg", buffer: img },
    { name: "nm-b.jpg", mimeType: "image/jpeg", buffer: img },
    { name: "nm-c.jpg", mimeType: "image/jpeg", buffer: img },
  ]);
  await page.waitForTimeout(300);
  ok((await page.locator("text=Выбрано 3 из 10").count()) === 1, "превью: Выбрано 3 из 10");

  // ловим моментальные значения счётчика (текст кнопки и строки прогресса)
  await page.evaluate(() => {
    window.__nm = { btn: new Set(), line: new Set() };
    const scan = () => {
      document.querySelectorAll("button, span").forEach((el) => {
        const t = (el.textContent || "").trim();
        const m1 = t.match(/^Загружаем… (\d)\/3$/);
        if (m1) window.__nm.btn.add(m1[0]);
        const m2 = t.match(/^Фото (\d) из 3/);
        if (m2) window.__nm.line.add(m2[0]);
      });
    };
    window.__nmTimer = setInterval(scan, 40);
  });

  await page.locator("select.field").first().selectOption({ index: 1 });
  await page.waitForTimeout(250);
  await page.locator("select.field").nth(1).selectOption({ index: 1 });
  await page.waitForTimeout(250);

  await page.click('button:has-text("Загрузить 3 фото")');
  await page
    .waitForSelector('h2:has-text("фото загружено")', { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(300);
  await page.evaluate(() => clearInterval(window.__nmTimer));
  const seen = await page.evaluate(() => ({
    btn: [...(window.__nm?.btn ?? [])],
    line: [...(window.__nm?.line ?? [])],
  }));

  const doneH2 = await page.locator('h2:has-text("3 фото загружено")').count();
  ok(doneH2 === 1, "экран успеха: «3 фото загружено»");
  ok(seen.btn.length > 0, `счётчик на кнопке виден (${seen.btn.join(", ") || "не пойман"})`);
  ok(
    seen.line.some((t) => /Фото [123] из 3/.test(t)),
    `строка «Фото N из 3» видна (${seen.line.join(" | ") || "не пойман"})`
  );

  // точечная чистка: фото за последние 10 минут
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const photos = await db.photo.findMany({ where: { createdAt: { gte: since } } });
  for (const p of photos) {
    await db.photo.delete({ where: { id: p.id } }).catch(() => {});
    const { unlink } = await import("node:fs/promises");
    const path = await import("node:path");
    const { UPLOADS_OPT_DIR, UPLOADS_THUMB_DIR } = await import("../src/lib/paths.ts").catch(() => ({
      UPLOADS_OPT_DIR: "public/uploads/optimized",
      UPLOADS_THUMB_DIR: "public/uploads/thumbs",
    }));
    await unlink(path.join(UPLOADS_OPT_DIR, path.basename(p.url))).catch(() => {});
    await unlink(path.join(UPLOADS_THUMB_DIR, path.basename(p.thumbUrl))).catch(() => {});
  }
  const zeroVars = await db.productVariant.findMany({ where: { createdAt: { gte: since } } });
  for (const v of zeroVars) {
    const n = await db.photo.count({ where: { variantId: v.id } });
    if (n === 0) {
      await db.productVariantTag.deleteMany({ where: { variantId: v.id } }).catch(() => {});
      await db.productVariant.delete({ where: { id: v.id } }).catch(() => {});
    }
  }
  await db.$disconnect();
  console.log(`  (чистка: удалено фото за 10 мин: ${photos.length})`);
  await ctx.close();
}

/* ═════════ B: режимы вида + localStorage ═════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1200);

  // каталог → категория → модель (level 3, ModeSwitch виден)
  await page.click('nav.pill-nav button:has-text("Каталог")');
  await page.waitForTimeout(700);
  const catCard = page.locator('button:has-text("моделей")').first();
  await catCard.click();
  await page.waitForTimeout(700);
  const modelRow = page.locator('button:has-text("вариантов фото")').first();
  await modelRow.click();
  await page.waitForTimeout(700);
  ok((await page.locator(".mode-switch").count()) === 1, "level 3: переключатель вида виден");

  await page.click('.mode-switch button[aria-label="Крупно"]');
  await page.waitForTimeout(300);
  const prefs = await page.evaluate(() => localStorage.getItem("skovo-view-prefs"));
  ok(Boolean(prefs && prefs.includes("large")), `localStorage записан: ${prefs}`);

  // F5 — режим должен восстановиться
  await page.reload({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1200);
  // восстановление может вернуть level 3 (sessionStorage) — тогда сразу видно;
  // если сбросилось в категорию — проходим заново БЕЗ смены режима
  const ensureLevel3 = async () => {
    if ((await page.locator(".mode-switch").count()) === 0) {
      await page.click('nav.pill-nav button:has-text("Каталог")').catch(() => {});
      await page.waitForTimeout(500);
      const c = page.locator('button:has-text("моделей")').first();
      if ((await c.count()) > 0) await c.click();
      await page.waitForTimeout(500);
      const m = page.locator('button:has-text("вариантов фото")').first();
      if ((await m.count()) > 0) await m.click();
      await page.waitForTimeout(600);
    }
  };
  await ensureLevel3();
  const largePressed = await page.locator('.mode-switch button[aria-label="Крупно"]').getAttribute("aria-pressed");
  ok(largePressed === "true", `после F5 активен «Крупно» (aria-pressed=${largePressed})`);

  // новый таб того же контекста (тот же localStorage) — режим тоже «Крупно»
  const page2 = await ctx.newPage();
  await page2.goto(BASE, { waitUntil: "networkidle" }).catch(() => {});
  await page2.waitForTimeout(1200);
  await page2.click('nav.pill-nav button:has-text("Каталог")').catch(() => {});
  await page2.waitForTimeout(500);
  const c2 = page2.locator('button:has-text("моделей")').first();
  if ((await c2.count()) > 0) await c2.click();
  await page2.waitForTimeout(500);
  const m2 = page2.locator('button:has-text("вариантов фото")').first();
  if ((await m2.count()) > 0) await m2.click();
  await page2.waitForTimeout(700);
  const large2 = await page2.locator('.mode-switch button[aria-label="Крупно"]').getAttribute("aria-pressed");
  ok(large2 === "true", "новый таб: «Крупно» сохранился (localStorage живёт между вкладками)");

  await ctx.close();
}

await browser.close();
console.log(fails === 0 ? "\nE2E ЗЕЛЁНЫЙ" : `\nПРОВАЛОВ: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
