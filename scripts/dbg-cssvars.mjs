import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 780 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const vars = await p.evaluate(() => ({
  pswpRootZ: getComputedStyle(document.documentElement).getPropertyValue("--pswp-root-z-index"),
  zViewer: getComputedStyle(document.documentElement).getPropertyValue("--z-photo-viewer"),
  cssChunks: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href")),
}));
console.log(JSON.stringify(vars, null, 2));
await b.close();
