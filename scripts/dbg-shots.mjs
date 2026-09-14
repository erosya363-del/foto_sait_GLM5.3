import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(900);

// 1. Каталог наверху (полная шапка + панель поиска + пилюля)
await page.screenshot({ path: "tool-results/v2-top.png" });

// 2. Свёрнутая шапка + пилюля-dim + кружок
await page.evaluate(() => window.scrollTo({ top: 108, behavior: "instant" }));
await page.waitForTimeout(600);
await page.screenshot({ path: "tool-results/v2-scrolled.png" });

// 3. Подвесной поиск
await page.locator(".search-fab").click();
await page.waitForTimeout(500);
await page.keyboard.type("магни");
await page.waitForTimeout(700);
await page.screenshot({ path: "tool-results/v2-search-pop.png" });
await page.keyboard.press("Escape");

// 4. Админка: 3 раздела
await page.locator(".pill-item").nth(3).click();
await page.waitForTimeout(900);
await page.screenshot({ path: "tool-results/v2-admin-products.png" });
await page.locator('[role="tab"]:has-text("Справочники")').click();
await page.waitForTimeout(700);
await page.screenshot({ path: "tool-results/v2-admin-dicts.png" });

await browser.close();
console.log("screenshots done");
