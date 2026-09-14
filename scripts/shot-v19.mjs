/** Скриншоты v1.9: три режима вида на уровне вариантов + ткани без мусора */
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000", { waitUntil: "networkidle" }).catch(() => {});
await page.waitForSelector(".boot-bg", { state: "detached", timeout: 6000 }).catch(() => {});
await page.waitForTimeout(600);
// каталог → первая категория → первая модель с фото
await page.locator('main button:has-text("моделей")').first().click();
await page.waitForTimeout(800);
await page.locator('main button:has-text("вариантов фото")').first().click();
await page.waitForTimeout(900);
for (const [label, file] of [["Квадраты", "v19-mode-grid"], ["Строки", "v19-mode-rows"], ["Крупно", "v19-mode-large"]]) {
  await page.click(`.mode-switch button[aria-label="${label}"]`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `download/screenshots/${file}.png` });
}
// уровень 1: категории и ткани (узлы без фото скрыты)
await page.evaluate(() => window.__portal.getState().resetCatalog());
await page.waitForTimeout(700);
await page.screenshot({ path: "download/screenshots/v19-level1.png" });
await browser.close();
console.log("shots done");
