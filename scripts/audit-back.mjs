/**
 * Фокус-тест Back/history (ЭТАП 6) — через page.goBack() (CDP-навигация,
 * т.к. history.back() внутри evaluate глушится патчем Playwright).
 * Запуск: node scripts/audit-back.mjs
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch();
let fails = 0;

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(2000);
  return { ctx, page };
}

async function goBack(page) {
  await page.goBack({ timeout: 8000 }).catch(() => null); // same-document: вернёт null — это норма
  await page.waitForTimeout(900);
}

const portal = (page) =>
  page.evaluate(() => window.history.state?.portal ?? null);

/* S1: корень → категория → модель → Back → уровень КАТЕГОРИИ */
{
  const { ctx, page } = await fresh();
  const cat = page.locator('button.card-hover:has-text("моделей · ")').first();
  await cat.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await cat.count()) {
    await cat.click();
    await page.waitForTimeout(700);
    const model = page.locator("button.card-hover").filter({ hasText: "вариантов фото" }).first();
    await model.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    if (await model.count()) {
      await model.click();
      await page.waitForTimeout(800);
      const deep = await portal(page);
      await goBack(page);
      const st = await portal(page);
      console.log(`S1: deep=${JSON.stringify(deep)} → afterBack=${JSON.stringify(st)}`);
      if (st && st.catCategory && !st.catModel && !st.productId) console.log("✓ S1: Back вернул на уровень категории");
      else if (!st) { console.log("✗ S1: Back выкинул из приложения"); fails++; }
      else { console.log(`✗ S1: неожиданное состояние`); fails++; }
    } else console.log("(i) S1: у первой категории нет моделей — пропущен");
  } else console.log("(i) S1: категории не найдены");
  await ctx.close();
}

/* S2: корень → категория → модель → Back×2 → корень каталога */
{
  const { ctx, page } = await fresh();
  const cat = page.locator('button.card-hover:has-text("моделей · ")').first();
  await cat.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await cat.count()) {
    await cat.click();
    await page.waitForTimeout(700);
    const model = page.locator("button.card-hover").filter({ hasText: "вариантов фото" }).first();
    if (await model.count()) {
      await model.click();
      await page.waitForTimeout(800);
      await goBack(page);
      await goBack(page);
      const st = await portal(page);
      const atRoot = await page.locator('button:has-text("Все ткани")').count();
      console.log(`S2: afterBack×2=${JSON.stringify(st)}, корень виден=${atRoot > 0}`);
      if (st && !st.catCategory && !st.catModel && atRoot > 0) console.log("✓ S2: Back×2 → корень каталога");
      else { console.log("✗ S2: Back×2 не привёл в корень"); fails++; }
    }
  }
  await ctx.close();
}

/* S3: товар → браузерный Back → закрыт */
{
  const { ctx, page } = await fresh();
  const card = page.locator('section[aria-label="Новинки за 7 дней"] button').first();
  await card.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await card.count()) {
    await card.click();
    await page.waitForTimeout(1000);
    const opened = (await portal(page))?.productId ?? null;
    await goBack(page);
    const st = await portal(page);
    console.log(`S3: opened=${opened} → afterBack=${JSON.stringify(st)}`);
    if (opened && st && !st.productId) console.log("✓ S3: браузерный Back закрыл карточку товара");
    else { console.log("✗ S3: товар не закрылся браузерным Back"); fails++; }
  } else console.log("(i) S3: лента новинок пуста — пропущен");
  await ctx.close();
}

/* S4: поиск → Back → поиск снят */
{
  const { ctx, page } = await fresh();
  await page.fill("input[data-search-input]", "sky");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  const q = (await portal(page))?.searchQuery ?? null;
  await goBack(page);
  const st = await portal(page);
  console.log(`S4: query=${q} → afterBack=${JSON.stringify(st?.searchQuery)}`);
  if (q && st && st.searchQuery === null) console.log("✓ S4: Back снял применённый поиск");
  else { console.log("✗ S4: Back не снял поиск"); fails++; }
  await ctx.close();
}

await browser.close();
console.log(fails === 0 ? "\n=== ВСЕ СЦЕНАРИИ BACK OK ===" : `\n=== ПРОВАЛОВ: ${fails} ===`);
process.exit(fails === 0 ? 0 : 1);
