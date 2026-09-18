import { chromium } from "playwright";
const BASE = process.env.E2E_BASE || "http://localhost:3100";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
// desktop: сайдбар «Загрузка»
await page.locator('aside button:has-text("Загрузка")').click();
await page.waitForTimeout(900);
console.log("dialog open:", await page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-label="Загрузка фото"]'))));
const x = await page.locator('[aria-label="Закрыть загрузку"]').count();
console.log("X count:", x);
try {
  await page.click('[aria-label="Закрыть загрузку"]', { timeout: 5000 });
  console.log("click ok");
} catch (e) {
  console.log("click FAIL:", String(e).split("\n").slice(0, 14).join(" | "));
}
await page.waitForTimeout(700);
console.log("dialog after:", await page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-label="Загрузка фото"]'))));
await browser.close();
