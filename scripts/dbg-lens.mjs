/** Отладка шага 4: клик «Загрузка» → что со страницей/линзой/консолью */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) => logs.push(`[PAGEERROR] ${String(e).slice(0, 300)}`));

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const items = page.locator("nav.pill-nav button");
console.log("pill items:", await items.count());
await items.nth(0).click();
await page.waitForTimeout(500);
await items.nth(1).click();
await page.waitForTimeout(700);
console.log("lens after Остатки:", await page.locator(".nav-lens").count());
await items.nth(2).click();
await page.waitForTimeout(700);
console.log("lens after Загрузка:", await page.locator(".nav-lens").count());
console.log("pill-shell:", await page.locator(".pill-shell").count());
console.log("nav.pill-nav:", await page.locator("nav.pill-nav").count());
console.log("view via __portal:", await page.evaluate(() => window.__portal?.getState().view));
console.log("productId:", await page.evaluate(() => window.__portal?.getState().productId));
console.log("body text len:", await page.evaluate(() => document.body.innerText.length));
console.log("header title:", await page.locator("header .font-display").textContent().catch(() => "?"));
await page.screenshot({ path: "download/screenshots/dbg-upload-lens.png" });
console.log("── логи консоли ──");
logs.slice(-12).forEach((l) => console.log(" ", l));
await browser.close();
