/** Скриншоты v3.1: панель (dark/light), search mode, viewer (тач-эмуляция) */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 780 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1400);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1600);

await page.screenshot({ path: "tool-results/v31-pill-dark.png" });
await page.evaluate(() => {
  document.documentElement.classList.add("light");
  document.documentElement.classList.remove("dark");
});
await page.waitForTimeout(500);
await page.screenshot({ path: "tool-results/v31-pill-light.png" });
await page.evaluate(() => {
  document.documentElement.classList.add("dark");
  document.documentElement.classList.remove("light");
});

// bubble в движении: Каталог → Остатки
await page.locator(".pill-item").nth(1).click();
await page.waitForTimeout(250);
await page.screenshot({ path: "tool-results/v31-bubble-mid.png" });
await page.waitForTimeout(500);

// search mode: панель скрыта, карточка над пилюлей
await page.evaluate(() => document.querySelector(".pill-search")?.click());
await page.waitForTimeout(400);
await page.screenshot({ path: "tool-results/v31-search-mode.png" });
await page.evaluate(() => document.querySelector(".search-pop-close")?.click());
await page.waitForTimeout(300);

// viewer: тач-эмуляция, зум двойным тапом
const productId = await page.evaluate(async () => {
  const r = await fetch("/api/catalog");
  const j = await r.json();
  return (j.items ?? []).find((p) => p.photos?.length)?.id ?? null;
});
await page.evaluate((id) => window.__portal.getState().openProduct(id, "catalog"), productId);
await page.waitForTimeout(1100);
await page.locator(".photo-frame").first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: "tool-results/v31-viewer-open.png" });
const cdp = await ctx.newCDPSession(page);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 380 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(80);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 380 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(700);
await page.screenshot({ path: "tool-results/v31-viewer-zoom.png" });
await page.evaluate(() => window.__pswp?.ui?.actionsClick?.() ?? document.querySelector('button[aria-label="Действия с фотографией"]')?.click());
await page.waitForTimeout(600);
await page.screenshot({ path: "tool-results/v31-viewer-sheet.png" });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// desktop viewer
const dctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const dpage = await dctx.newPage();
await dpage.goto(BASE, { waitUntil: "networkidle" });
await dpage.waitForTimeout(1200);
await dpage.evaluate((id) => window.__portal.getState().openProduct(id, "catalog"), productId);
await dpage.waitForTimeout(1000);
await dpage.locator(".photo-frame").first().click();
await dpage.waitForTimeout(900);
await dpage.screenshot({ path: "tool-results/v31-viewer-desktop.png" });

await browser.close();
console.log("скриншоты v31 готовы: tool-results/v31-*.png");
