/* Реплика секции жестов v31 с логом pointer-событий — поиск сбоя double-tap */
import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 780 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const productId = await page.evaluate(async () => {
  const r = await fetch("/api/catalog");
  const j = await r.json();
  const item = (j.items ?? []).find((p) => p.photos && p.photos.length > 0);
  return item ? item.id : null;
});
await page.evaluate((id) => window.__portal.getState().openProduct(id, "catalog"), productId);
await page.waitForTimeout(1100);
await page.evaluate(() => window.scrollTo(0, 120));
await page.locator(".photo-frame").first().click();
await page.waitForTimeout(900);

/* ставим логгер указателей */
await page.evaluate(() => {
  window.__ptr = [];
  for (const t of ["pointerdown", "pointerup", "pointercancel"]) {
    document.addEventListener(t, (e) => {
      window.__ptr.push(`${t} t=${performance.now().toFixed(0)} x=${e.clientX?.toFixed(0)} y=${e.clientY?.toFixed(0)} id=${e.pointerId}`);
    }, true);
  }
});
const cdp = await ctx.newCDPSession(page);

/* pinch (как в тесте) */
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [{ x: 120, y: 380 }, { x: 260, y: 380 }],
});
for (let step = 1; step <= 5; step++) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 120 - step * 25, y: 380 },
      { x: 260 + step * 25, y: 380 },
    ],
  });
  await page.waitForTimeout(35);
}
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(900);

/* сброс + double tap */
await page.evaluate(() => window.__pswp.zoomTo(window.__pswp.currSlide.zoomLevels.initial, null, 0));
await page.waitForTimeout(600);
await page.evaluate(() => (window.__ptr.length = 0));
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 380 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 380 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(1500);

const res = await page.evaluate(() => ({
  zoom: window.__pswp?.currSlide?.currZoomLevel,
  initial: window.__pswp?.currSlide?.zoomLevels?.initial,
  ptr: window.__ptr,
}));
console.log("zoom after DT:", res.zoom, "initial:", res.initial);
console.log(res.ptr.join("\n"));
await browser.close();
