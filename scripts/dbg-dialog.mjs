import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.evaluate(() => window.__portal.setState({ view: "admin" }));
await page.waitForTimeout(600);
await page.locator('button[role="tab"]:has-text("Фото")').click();
await page.waitForTimeout(800);
const pencil = page.locator('main button[aria-label="Редактировать привязку фото"]').first();
if (await pencil.count()) {
  await pencil.click();
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const el = document.querySelector("[data-slot='dialog-content']");
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const parent = el.parentElement;
    const pcs = parent ? getComputedStyle(parent) : null;
    const gp = parent?.parentElement ? getComputedStyle(parent.parentElement) : null;
    return {
      found: true,
      top: cs.top, position: cs.position, transform: cs.transform.slice(0, 60),
      maxHeight: cs.maxHeight, height: el.getBoundingClientRect().height,
      parentTag: parent?.tagName, parentPos: pcs?.position, parentTransform: pcs?.transform?.slice(0, 40),
      gpTag: gp ? gp.tagName : null, gpFilter: gp?.filter?.slice(0, 40), gpTransform: gp?.transform?.slice(0, 40),
      inBody: !!el.closest("body"), scrollY: window.scrollY,
    };
  });
  console.log(JSON.stringify(info, null, 2));
} else {
  console.log("no photos / no pencil");
}
await browser.close();
