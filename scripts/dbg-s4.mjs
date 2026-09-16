import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
page.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text().slice(0, 200)); });
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const freshCards = page.locator('section[aria-label="Новинки за 7 дней"] button');
await freshCards.first().click();
await page.waitForTimeout(700);
console.log("product open:", await page.locator('button[aria-label="Назад"]').first().isVisible());

const catNav = page.locator('nav.pill-nav button:has-text("Каталог")');
await catNav.click();
await page.waitForTimeout(600);

const st = await page.evaluate(() => {
  const s = window.__portal?.getState?.();
  const btns = [...document.querySelectorAll("main button")].slice(0, 8).map((b) => b.textContent?.trim().slice(0, 24));
  return {
    view: s?.view, productId: s?.productId, cat: s?.catCategory, model: s?.catModel,
    scrollY: window.scrollY,
    mainButtons: btns,
    fabricsVisible: !!([...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Все ткани") && b.offsetParent)),
  };
});
console.log(JSON.stringify(st, null, 2));
await browser.close();
