/** Сравнение надёжности навигации по пилюле: locator.click vs touchscreen.tap. */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const browser = await chromium.launch();

async function sectionOf(page) {
  return page.evaluate(() => {
    const h = document.querySelector("header h1, header [data-section-title], header");
    return (h?.textContent || "").trim().slice(0, 20);
  });
}

for (const method of ["locator", "touch"]) {
  let ok = 0;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const targets = ["Остатки", "Загрузка", "Админ", "Каталог", "Остатки", "Каталог", "Админ", "Загрузка", "Остатки", "Каталог"];
  for (const t of targets) {
    try {
      if (method === "locator") {
        await page.locator("nav.pill-nav button", { hasText: t }).click({ force: true });
      } else {
        const bb = await page.locator("nav.pill-nav button", { hasText: t }).boundingBox();
        await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
      }
      await page.waitForTimeout(700);
      const sec = await sectionOf(page);
      const good = sec.toLowerCase().includes(t.slice(0, 5).toLowerCase());
      if (good) ok++;
      else console.log(`  ${method}: ${t} → заголовок «${sec}» ✗`);
    } catch (e) {
      console.log(`  ${method}: ${t} → ERROR ${String(e).split("\n")[0].slice(0, 80)}`);
    }
  }
  console.log(`${method}: ${ok}/10 навигаций успешны`);
  await ctx.close();
}
await browser.close();
