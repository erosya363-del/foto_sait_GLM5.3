import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
// применяем существующий запрос
await page.evaluate(() => document.querySelector(".pill-search")?.click());
await page.waitForTimeout(400);
await page.keyboard.type("sky");
await page.waitForTimeout(700);
await page.keyboard.press("Enter");
await page.waitForTimeout(800);
// переоткрываем — поле пустым не является; очищаем, чтобы увидеть последние
await page.evaluate(() => document.querySelector(".pill-search")?.click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const x = document.querySelector(".search-pop input + button, .search-pop button[aria-label='Очистить поиск']");
  x?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(500);
const label = await page.locator(".search-pop .search-dd p").first().textContent().catch(() => null);
const chips = await page.locator(".search-pop .search-dd button").allTextContents();
console.log("LABEL:", label, "| CHIPS:", JSON.stringify(chips));
await page.screenshot({ path: "tool-results/v26-recent-final.png" });
await browser.close();
