import { chromium } from "playwright";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 });
await context.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
const page = await context.newPage();
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(1400);
await page.screenshot({ path: "tool-results/v21-dark-level1.png" });
// открыть поиск: тап по полю панели (вверху) — дропдаун с популярными
await page.click("input[data-search-input]");
await page.waitForTimeout(700);
await page.screenshot({ path: "tool-results/v21-dark-search.png" });
await page.keyboard.press("Escape");
// светлая тема
await page.evaluate(() => {
  document.documentElement.classList.add("light");
  document.documentElement.classList.remove("dark");
});
await page.waitForTimeout(500);
await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
await page.waitForTimeout(500);
await page.screenshot({ path: "tool-results/v21-light-scrolled.png" });
// пилюля крупно в светлой
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(400);
await page.screenshot({ path: "tool-results/v21-light-top.png" });
await browser.close();
console.log("done");
