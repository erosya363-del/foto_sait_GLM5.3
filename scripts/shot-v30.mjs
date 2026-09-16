/** v3.0 скриншоты: viewer (панели/зум/sheet), поиск, остатки — для отчёта */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
await ctx.addInitScript(() => {
  try {
    if (!localStorage.getItem("shot-cleaned")) {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("shot-cleaned", "1");
    }
  } catch {}
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1400);

// 1. Поиск: открытая карточка с результатами
await page.locator(".pill-search").click();
await page.waitForTimeout(300);
await page.locator("input[data-search-input]").fill("локо");
await page.waitForTimeout(900);
await page.screenshot({ path: "tool-results/v30-search-open.png" });
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
await page.screenshot({ path: "tool-results/v30-search-applied.png" });
await page.locator(".search-pop-close").click();
await page.waitForTimeout(500);

// 2. Viewer: открыт + панели
const productId = await page.evaluate(async () => {
  const r = await fetch("/api/catalog");
  const j = await r.json();
  const item = (j.items ?? []).find((p) => p.photos && p.photos.length > 1);
  return item ? item.id : null;
});
await page.evaluate((id) => window.__portal.getState().openProduct(id, "catalog"), productId);
await page.waitForTimeout(1100);
await page.evaluate(() => window.scrollTo(0, 140));
await page.locator(".photo-frame").first().click();
await page.waitForTimeout(700);
await page.screenshot({ path: "tool-results/v30-viewer.png" });

// зум 250% через клавиши
await page.keyboard.press("+");
await page.keyboard.press("+");
await page.waitForTimeout(600);
await page.screenshot({ path: "tool-results/v30-viewer-zoom.png" });

// sheet
await page.locator('button[aria-label="Действия с фотографией"]').click();
await page.waitForTimeout(500);
await page.screenshot({ path: "tool-results/v30-viewer-sheet.png" });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// 3. Остатки: новая строка
await page.locator(".pill-shell .pill-item").nth(1).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: "tool-results/v30-stock.png" });

// 4. Десктоп viewer
const dctx = await browser.newContext({ viewport: { width: 1366, height: 850 } });
const dpage = await dctx.newPage();
await dpage.goto(BASE, { waitUntil: "networkidle" });
await dpage.waitForTimeout(1400);
await dpage.evaluate((id) => window.__portal.getState().openProduct(id, "catalog"), productId);
await dpage.waitForTimeout(1100);
await dpage.locator(".photo-frame").first().click();
await dpage.waitForTimeout(700);
await dpage.screenshot({ path: "tool-results/v30-viewer-desktop.png" });
await dctx.close();

await browser.close();
console.log("v30 screenshots done");
