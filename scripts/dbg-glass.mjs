import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 3 });
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
// преломление видно только над контрастным контентом — скроллим каталог с карточками под панель
await page.evaluate(() => window.scrollTo({ top: 320, behavior: "instant" }));
await page.waitForTimeout(700);
// тап по панели (pill-active — плотное стекло + линза)
await page.evaluate(() => {
  document.querySelector(".pill-shell")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 5 }));
});
await page.waitForTimeout(500);
const shell = await page.locator(".pill-shell").boundingBox();
await page.screenshot({
  path: "tool-results/v26-glass-zoom.png",
  clip: { x: shell.x - 6, y: shell.y - 26, width: shell.width + 12, height: shell.height + 34 },
});
// композит-проверка: фильтр жив, feImage заполнен, backdrop навешен
const info = await page.evaluate(() => {
  const f = document.querySelector("svg filter[id^='lg-']");
  const feImg = f?.querySelector("feImage");
  const shell = document.querySelector(".pill-shell");
  return {
    filterId: f?.getAttribute("id"),
    region: f && { x: f.getAttribute("x"), y: f.getAttribute("y"), w: f.getAttribute("width"), h: f.getAttribute("height") },
    mapLen: (feImg?.getAttribute("href") || "").length,
    backdrop: shell ? shell.style.backdropFilter : null,
    computed: shell ? getComputedStyle(shell).backdropFilter : null,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
