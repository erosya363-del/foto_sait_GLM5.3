import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e)));
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const productId = await page.evaluate(async () => {
  const r = await fetch("/api/catalog");
  const j = await r.json();
  return (j.items ?? []).find((p) => p.photos?.length)?.id ?? null;
});
await page.evaluate((id) => window.__portal.getState().openProduct(id, "catalog"), productId);
await page.waitForTimeout(1000);
console.log("photo-frames до:", await page.locator(".photo-frame").count());
await page.locator(".photo-frame").first().click();
await page.waitForTimeout(900);
console.log("pswp открыт:", await page.locator(".pswp").count());
await page.keyboard.press("Escape");
await page.waitForTimeout(700);
const st = await page.evaluate(() => ({
  pswp: document.querySelectorAll(".pswp").length,
  productId: window.__portal.getState().productId,
  view: window.__portal.getState().view,
  frames: document.querySelectorAll(".photo-frame").length,
  active: document.activeElement?.tagName,
}));
console.log("после Esc:", JSON.stringify(st));
await b.close();
