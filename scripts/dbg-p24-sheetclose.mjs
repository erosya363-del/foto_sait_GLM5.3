import { chromium } from "playwright";
const BASE = process.env.E2E_BASE || "http://localhost:3100";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 120)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

await page.click('nav.pill-nav button:has-text("Загрузка")');
await page.waitForTimeout(800);
console.log("sheet open:", await page.evaluate(() => Boolean(document.querySelector("[data-upload-sheet]"))));
const x = await page.locator('[aria-label="Закрыть загрузку"]').count();
console.log("X count:", x);
const box = await page.locator('[aria-label="Закрыть загрузку"]').boundingBox();
console.log("X box:", JSON.stringify(box));
const at = await page.evaluate(() => {
  const el = document.elementFromPoint(355, 60);
  return el ? `${el.tagName}.${String(el.className).slice(0, 60)}` : "none";
});
console.log("elementFromPoint(355,60):", at);
try {
  await page.click('[aria-label="Закрыть загрузку"]', { timeout: 5000 });
  console.log("click ok");
} catch (e) {
  console.log("click FAIL:", String(e).split("\n").slice(0, 6).join(" | "));
}
await page.waitForTimeout(600);
console.log("sheet after click:", await page.evaluate(() => Boolean(document.querySelector("[data-upload-sheet]"))));
await browser.close();
