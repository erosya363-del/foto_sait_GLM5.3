import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e)));
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  window.__backs = [];
  const ob = history.back.bind(history);
  history.back = (...a) => { window.__backs.push("BACK:\n" + new Error().stack.split("\n").slice(1, 5).join("\n")); return ob(...a); };
  window.addEventListener("popstate", (e) => window.__backs.push("POPSTATE:" + JSON.stringify(e.state?.portal ?? null)));
});
const productId = await page.evaluate(async () => {
  const r = await fetch("/api/catalog");
  const j = await r.json();
  return (j.items ?? []).find((p) => p.photos?.length)?.id ?? null;
});
await page.evaluate((id) => window.__portal.getState().openProduct(id, "catalog"), productId);
await page.waitForTimeout(1000);
await page.locator(".photo-frame").first().click();
await page.waitForTimeout(900);
// цикл sheet как в секции 10
await page.locator('button[aria-label="Действия с фотографией"]').click();
await page.waitForTimeout(500);
await page.keyboard.press("Escape"); // закрыть только sheet
await page.waitForTimeout(400);
await page.locator('button[aria-label="Действия с фотографией"]').click();
await page.waitForTimeout(400);
await page.locator(".viewer-sheet-cancel").click();
await page.waitForTimeout(600);
const dump = (l) =>
  page.evaluate((lab) => ({
    lab,
    pswp: document.querySelectorAll(".pswp").length,
    productId: window.__portal.getState().productId,
    view: window.__portal.getState().view,
    viewerOpen: window.__portal.getState().viewerOpen,
    histLen: history.length,
    histState: history.state?.portal ?? null,
    frames: document.querySelectorAll(".photo-frame").length,
  }), l).then((v) => console.log(JSON.stringify(v)));
await dump("перед финальным Esc");
await page.keyboard.press("Escape");
await page.waitForTimeout(700);
await dump("после Esc");
await page.keyboard.press("Escape");
await page.waitForTimeout(700);
await dump("после 2-го Esc");
console.log("BACKS:", JSON.stringify(await page.evaluate(() => window.__backs), null, 1));
await b.close();
