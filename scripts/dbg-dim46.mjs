/** Debug: dim старой вкладки при drag (ТЗ 4.6) */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE || "http://localhost:3100";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const pillPanel = () =>
  page.evaluate(() => {
    const shell = document.querySelector(".pill-shell");
    const items = [...document.querySelectorAll(".pill-item")].map((el) => {
      const r = el.getBoundingClientRect();
      return { label: el.textContent.trim(), left: r.left, right: r.right, cx: r.left + r.width / 2, width: r.width, covered: el.classList.contains("is-lens-covered"), color: getComputedStyle(el).color };
    });
    return { cy: shell.getBoundingClientRect().top + shell.getBoundingClientRect().height / 2, items };
  });

const panel = await pillPanel();
const catalog = panel.items.find((i) => i.label === "Каталог");
const stock = panel.items.find((i) => i.label === "Остатки");

const drag = async (x, y) => {
  await page.evaluate(({ x, y }) => {
    document.querySelector(".pill-shell").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 }));
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 }));
  }, { x, y });
};
const move = async (x, y) => page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 })), { x, y });

// следим за классами shell
await page.evaluate(() => {
  (window).__shellLog = [];
  const sh = document.querySelector(".pill-shell");
  new MutationObserver((muts) => {
    for (const m of muts) (window).__shellLog.push(sh.className);
  }).observe(sh, { attributes: true, attributeFilter: ["class"] });
  let pd = 0, pm = 0;
  window.addEventListener("pointerdown", () => pd++, true);
  window.addEventListener("pointermove", () => pm++, true);
  (window).__pd = () => pd; (window).__pm = () => pm;
});

await drag(catalog.cx, panel.cy);
await page.waitForTimeout(150);
console.log("after down: pd=", await page.evaluate(() => window.__pd()), " pm=", await page.evaluate(() => window.__pm()));
await move(stock.cx + 14, panel.cy);
await page.waitForTimeout(300);
console.log("after move: pm=", await page.evaluate(() => window.__pm()));
console.log("shellLog:", await page.evaluate(() => window.__shellLog));

const st = await page.evaluate(() => ({
  shellClasses: document.querySelector(".pill-shell")?.className,
  on: document.querySelector(".pill-item.is-on")?.textContent?.trim(),
  onCovered: document.querySelector(".pill-item.is-on")?.classList.contains("is-lens-covered"),
  onColor: getComputedStyle(document.querySelector(".pill-item.is-on")).color,
  coveredLabels: [...document.querySelectorAll(".pill-item.is-lens-covered")].map((e) => e.textContent.trim()),
  mutedVar: getComputedStyle(document.documentElement).getPropertyValue("--muted-foreground"),
}));
console.log(JSON.stringify(st, null, 2));
console.log("panel:", JSON.stringify(panel.items.map((i) => ({ l: i.label, covered: i.covered, color: i.color })), null, 2));
const lens = await page.evaluate(() => {
  const b = document.querySelector(".pill-bubble").getBoundingClientRect();
  return { left: b.left, right: b.right, w: b.width };
});
const panel2 = await pillPanel();
const cat = panel2.items.find((i) => i.label === "Каталог");
const stk = panel2.items.find((i) => i.label === "Остатки");
console.log("lens:", JSON.stringify(lens));
console.log("cat:", JSON.stringify({ left: cat.left, right: cat.right, w: cat.width }));
console.log("stock:", JSON.stringify({ left: stk.left, right: stk.right, cx: stk.cx }));
console.log("overlap with catalog:", Math.min(lens.right, cat.right) - Math.max(lens.left, cat.left));

await browser.close();
