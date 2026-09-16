/** Диагностика z-order: sheet vs pswp root */
import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
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
await page.locator('button[aria-label="Действия с фотографией"]').click();
await page.waitForTimeout(700);
const probe = await page.evaluate(() => {
  const bd = document.querySelector(".viewer-sheet-backdrop");
  const pswp = document.querySelector(".pswp");
  const el = document.elementFromPoint(12, 12);
  const chain = [];
  let n = el;
  while (n && chain.length < 6) {
    chain.push(`${n.tagName}.${(n.className || "").toString().slice(0, 40)} z=${getComputedStyle(n).zIndex} pos=${getComputedStyle(n).position} ctx=${getComputedStyle(n).isolation}:${getComputedStyle(n).transform !== "none"}`);
    n = n.parentElement;
  }
  return {
    bdZ: bd ? getComputedStyle(bd).zIndex : "no-bd",
    bdParentChainZ: bd ? (() => { let p = bd.parentElement; const arr = []; while (p && arr.length < 5) { arr.push(`${p.tagName}.${(p.className || "").toString().slice(0, 30)} z=${getComputedStyle(p).zIndex} tf=${getComputedStyle(p).transform !== "none"}`); p = p.parentElement; } return arr; })() : [],
    pswpZ: pswp ? getComputedStyle(pswp).zIndex : "no-pswp",
    hit: chain,
  };
});
console.log(JSON.stringify(probe, null, 2));
await browser.close();
