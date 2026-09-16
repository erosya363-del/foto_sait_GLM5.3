/** Диагностика pswp: zoomLevels при неизвестных w/h + порядок Esc */
import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
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
await page.waitForTimeout(900);
const diag = await page.evaluate(async () => {
  const pswp = window.__pswp;
  const s = pswp.currSlide;
  const before = {
    zoomLevels: { initial: s.zoomLevels.initial, secondary: s.zoomLevels.secondary, max: s.zoomLevels.max },
    curr: s.currZoomLevel,
    dataWH: [s.data.width, s.data.height],
    natural: s.content?.element?.naturalWidth,
  };
  pswp.zoomTo(3, { x: 195, y: 300 }, 0);
  await new Promise((r) => setTimeout(r, 300));
  const after = { curr: s.currZoomLevel, transform: (s.container?.style.transform || "").slice(0, 60) };
  return { before, after };
});
console.log(JSON.stringify(diag, null, 2));
// Esc + sheet probe
await page.evaluate(() => window.__pswp?.ui?.elementBuilders); // no-op
await page.evaluate(() => document.querySelector('button[aria-label="Действия с фотографией"]')?.click());
await page.waitForTimeout(500);
const probe = await page.evaluate(() => {
  window.__escLog = [];
  window.addEventListener(
    "keydown",
    (e) => window.__escLog.push(`win-capture:${e.key}`),
    { capture: true }
  );
  return Boolean(document.querySelector(".viewer-sheet"));
});
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
const after = await page.evaluate(() => ({
  log: window.__escLog,
  pswpAlive: document.querySelectorAll(".pswp").length,
  sheetAlive: document.querySelectorAll(".viewer-sheet").length,
}));
console.log("sheet was open:", probe, JSON.stringify(after));
await browser.close();
