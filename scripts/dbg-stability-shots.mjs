/**
 * dbg-stability-shots.mjs — визуальные материалы отчёта
 * CRITICAL STABILITY PART 1 (ТЗ секция 8-аналоги): 
 *   01 fallback: rest  02 fallback: press  03 fallback: drag/covered
 *   04 full dark: rest 05 full dark: press 06 full: капсула-пересечение
 *   07 sheet 86dvh     08 viewportDebug overlay
 * Результат: tool-results/stability/*.png
 */
import { chromium } from "playwright";
import fs from "fs";

const BASE = process.env.E2E_BASE || "http://localhost:3100";
const OUT = "tool-results/stability";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("  📸", name);
}

const setupPage = async (ctx, url = BASE) => {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1100);
  return page;
};

/* ── Android fallback ── */
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    userAgent: "Mozilla/5.0 (Linux; Android 14; 23049PCD8G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  });
  const page = await setupPage(ctx);
  const geo = await page.evaluate(() => {
    const shell = document.querySelector(".pill-shell");
    const items = [...document.querySelectorAll(".pill-item")].map((el) => {
      const r = el.getBoundingClientRect();
      return { label: el.textContent.trim(), cx: r.left + r.width / 2 };
    });
    return { cy: shell.getBoundingClientRect().top + shell.getBoundingClientRect().height / 2, items };
  });
  const cat = geo.items.find((i) => i.label === "Каталог");
  const stock = geo.items.find((i) => i.label === "Остатки");
  const down = (x, y) => page.evaluate(({ x, y }) => {
    document.querySelector(".pill-shell").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 }));
  }, { x, y });
  const move = async (x, y) => {
    await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 })), { x, y });
    await page.waitForTimeout(320);
  };
  // 01 rest
  await page.waitForTimeout(400);
  await shot(page, "01-fallback-rest");
  // 02 press
  await down(cat.cx, geo.cy);
  await move(cat.cx + 6, geo.cy);
  await page.waitForTimeout(420);
  await shot(page, "02-fallback-press");
  // 03 drag между вкладками (covered обе)
  await move((cat.cx + stock.cx) / 2, geo.cy);
  await page.waitForTimeout(420);
  await shot(page, "03-fallback-drag-covered");
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: 0, clientY: 0, buttons: 0 })));
  await ctx.close();
}

/* ── Full glass dark: rest/press/капсула ── */
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await setupPage(ctx);
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("light");
  });
  await page.waitForTimeout(500);
  const geo = await page.evaluate(() => {
    const shell = document.querySelector(".pill-shell");
    const items = [...document.querySelectorAll(".pill-item")].map((el) => {
      const r = el.getBoundingClientRect();
      return { label: el.textContent.trim(), cx: r.left + r.width / 2 };
    });
    return { cy: shell.getBoundingClientRect().top + shell.getBoundingClientRect().height / 2, items };
  });
  const cat = geo.items.find((i) => i.label === "Каталог");
  const stock = geo.items.find((i) => i.label === "Остатки");
  const down = (x, y) => page.evaluate(({ x, y }) => {
    document.querySelector(".pill-shell").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 }));
  }, { x, y });
  const move = async (x, y) => {
    await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 })), { x, y });
    await page.waitForTimeout(320);
  };
  await shot(page, "04-full-dark-rest");
  await down(cat.cx, geo.cy);
  await move(cat.cx + 6, geo.cy);
  await page.waitForTimeout(420);
  await shot(page, "05-full-dark-press");
  await move((cat.cx + stock.cx) / 2 + 20, geo.cy);
  await page.waitForTimeout(420);
  await shot(page, "06-full-capsule-covered");
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: 0, clientY: 0, buttons: 0 })));
  await ctx.close();
}

/* ── Upload sheet 86dvh + viewportDebug ── */
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  const page = await setupPage(ctx, `${BASE}/?viewportDebug=1`);
  await page.locator('.pill-item:has-text("Загрузка")').click();
  await page.waitForTimeout(900);
  await shot(page, "07-sheet-86dvh-debug");
  await page.locator('[aria-label="Закрыть загрузку"]').click();
  await page.waitForTimeout(600);
  await shot(page, "08-viewportdebug-cold");
  await ctx.close();
}

await browser.close();
console.log(`\n✅ Скриншоты в ${OUT}/`);
