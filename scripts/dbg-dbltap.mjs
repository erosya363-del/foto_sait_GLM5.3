/** Диагностика double-tap: состояние после каждого касания */
import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 780 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const productId = await page.evaluate(async () => {
  const r = await fetch("/api/catalog");
  const j = await r.json();
  return (j.items ?? []).find((p) => p.photos?.length)?.id ?? null;
});
await page.evaluate((id) => window.__portal.getState().openProduct(id, "catalog"), productId);
await page.waitForTimeout(1000);
await page.locator(".photo-frame").first().click();
await page.waitForTimeout(1000);
const cdp = await ctx.newCDPSession(page);
const state = (label) =>
  page.evaluate((l) => {
    const s = window.__pswp.currSlide;
    return `${l}: zoom=${s.currZoomLevel.toFixed(3)} initial=${s.zoomLevels.initial} sec=${s.zoomLevels.secondary} ui=${window.__pswp.getClassLevel?.() ?? "-"}`;
  }, label).then(console.log);
await state("открыт");
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 380 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(100);
await state("после тапа 1");
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 380 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(150);
await state("сразу после тапа 2");
await page.waitForTimeout(800);
await state("через 800мс");
await browser.close();
