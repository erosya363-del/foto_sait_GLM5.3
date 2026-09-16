import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 760 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
await ctx.addInitScript(() => {
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// 1. Стартовая страница каталога (тёмная)
await page.screenshot({ path: "tool-results/v25-dark-start.png" });

// 2. Поиск: карточка над панелью
await page.evaluate(() => document.querySelector(".pill-search")?.click());
await page.waitForTimeout(500);
await page.keyboard.type("sky");
await page.waitForTimeout(800);
await page.screenshot({ path: "tool-results/v25-dark-search.png" });

// 3. Применённый поиск → чип над панелью
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
await page.screenshot({ path: "tool-results/v25-dark-chip.png" });

// 4. Светлая тема стартовая
await page.evaluate(() => window.__portal.getState().applySearch(null));
await page.evaluate(() => {
  document.documentElement.classList.add("light");
  document.documentElement.classList.remove("dark");
});
await page.waitForTimeout(600);
await page.evaluate(() => window.__portal.getState().resetCatalog());
await page.waitForTimeout(900);
await page.screenshot({ path: "tool-results/v25-light-start.png" });

// 5. Десктоп: карточка поиска под шапкой
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(500);
await page.locator("aside .side-link", { hasText: "Поиск" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: "tool-results/v25-desktop-search.png" });

await browser.close();
console.log("OK: скриншоты v25 сохранены в tool-results/");
