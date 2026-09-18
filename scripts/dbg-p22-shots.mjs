/* Визуальный контроль Phase 2.2: панель (одна линза), «⋯»-стекло, sheet v5 */
import { chromium } from "playwright";
const base = process.env.E2E_BASE || "http://localhost:3000";
const out = "tool-results";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(3500);

/* 1. Панель с одной линзой (стартовый Каталог) */
await p.waitForSelector(".pill-shell", { timeout: 15000 });
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/p22-panel.png`, clip: { x: 0, y: 660, width: 390, height: 120 } });

/* 2. Viewer: каталог → карточка модели → фото → топ-бар с «⋯» */
await p.locator(".pill-item").nth(0).tap();
await p.waitForTimeout(800);
await p.locator(".card-hover").first().click();
await p.waitForSelector(".photo-frame", { timeout: 10000 });
await p.locator(".photo-frame").first().click();
await p.waitForSelector(".pswp--open", { timeout: 10000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/p22-viewer-topbar.png`, clip: { x: 0, y: 0, width: 390, height: 90 } });

/* 3. Sheet действий (v5-стекло) */
await p.locator(".pswp__button--actions").tap();
await p.waitForTimeout(700);
await p.screenshot({ path: `${out}/p22-sheet.png`, clip: { x: 0, y: 780 - 420, width: 390, height: 420 } });

/* ghost-проверка */
const ghost = await p.evaluate(() => document.querySelectorAll(".pill-ghost").length);
console.log("pill-ghost count =", ghost);
await b.close();
console.log("DONE");
